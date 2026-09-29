// Anthropic Messages adapter (anthropic_messages presets). Native prompt
// caching: cache_control on the system block and the last tool when
// cacheSystem, and on every message flagged cacheBreakpoint, never more than
// 4 breakpoints per request (the API limit). Usage is normalized so
// inputTokens is the full prompt: input + cache writes + cache reads.
import type { ProviderModel } from "@mengai/shared";
import { LlmError } from "../ports/llm";
import type { ChatMessage, ChatRequest, ChatResult, ContentPart, LlmProvider, ToolCall, Usage } from "../ports/llm";
import {
  createUrlGuard,
  httpError,
  joinUrl,
  readSse,
  transportError,
  withTimeout,
  type FetchFn,
  type UrlGuardOptions,
} from "./llm-openai";

export const ANTHROPIC_VERSION = "2023-06-01";
export const MAX_CACHE_BREAKPOINTS = 4;
const DEFAULT_MAX_TOKENS = 8192;

export interface AnthropicChatConfig {
  id: string;
  /** https://api.anthropic.com (with or without a trailing /v1) */
  baseUrl: string;
  apiKey: string | null;
  guard: UrlGuardOptions;
  label?: string;
  version?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetch?: FetchFn;
  now?: () => number;
}

type Json = Record<string, unknown>;
type Block = Json;

const EPHEMERAL = { type: "ephemeral" } as const;

export function anthropicUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return /\/v1$/.test(base) ? joinUrl(base, path) : joinUrl(base, `/v1${path}`);
}

function partBlocks(content: string | ContentPart[]): Block[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  const out: Block[] = [];
  for (const p of content) {
    if (p.type === "text") {
      if (p.text) out.push({ type: "text", text: p.text });
    } else {
      out.push({ type: "image", source: { type: "base64", media_type: p.mime, data: p.dataBase64 } });
    }
  }
  return out;
}

function toolInput(args: string): Json {
  try {
    const v = JSON.parse(args || "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : { value: v };
  } catch {
    return {};
  }
}

function blocksFor(m: ChatMessage): Block[] {
  if (m.role === "tool") {
    const inner = partBlocks(m.content);
    return [{ type: "tool_result", tool_use_id: m.toolCallId ?? "", content: inner.length ? inner : [{ type: "text", text: "(empty)" }] }];
  }
  if (m.role === "assistant") {
    const out = partBlocks(m.content).filter((b) => b.type === "text");
    for (const tc of m.toolCalls ?? []) out.push({ type: "tool_use", id: tc.id, name: tc.name, input: toolInput(tc.arguments) });
    return out;
  }
  return partBlocks(m.content);
}

export interface AnthropicBody {
  body: Json;
  /** how many cache_control markers were placed */
  breakpoints: number;
}

/**
 * Builds the Messages body. Breakpoint priority when over the limit of 4:
 * system first (it caches tools + system, the prefix every agent of a role
 * shares), then message breakpoints latest first (each covers the longest
 * prefix), then the last-tool marker, which is redundant when the system
 * block is marked because tools precede system in Anthropic's prefix order.
 */
export function buildAnthropicBody(req: ChatRequest, stream: boolean): AnthropicBody {
  const messages: Array<{ role: "user" | "assistant"; content: Block[] }> = [];
  const marks: Block[] = [];
  for (const m of req.messages) {
    const role = m.role === "assistant" ? "assistant" : "user";
    let blocks = blocksFor(m);
    if (blocks.length === 0) blocks = [{ type: "text", text: "(empty)" }];
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
    if (m.cacheBreakpoint) marks.push(blocks[blocks.length - 1]!);
  }
  if (req.responseFormat === "json") {
    const tail = messages[messages.length - 1];
    const note = { type: "text", text: "Respond with one JSON object only, no prose." };
    if (tail && tail.role === "user") tail.content.push(note);
    else messages.push({ role: "user", content: [note] });
  }

  const body: Json = {
    model: req.model,
    max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    messages,
  };
  let used = 0;
  if (req.system) {
    const sys: Block = { type: "text", text: req.system };
    if (req.cacheSystem) {
      sys.cache_control = EPHEMERAL;
      used++;
    }
    body.system = [sys];
  }
  const room = Math.max(0, MAX_CACHE_BREAKPOINTS - used);
  for (const b of room > 0 ? marks.slice(-room) : []) {
    b.cache_control = EPHEMERAL;
    used++;
  }
  if (req.tools?.length) {
    const tools: Block[] = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    if (req.cacheSystem && used < MAX_CACHE_BREAKPOINTS) {
      tools[tools.length - 1]!.cache_control = EPHEMERAL;
      used++;
    }
    body.tools = tools;
    if (req.toolChoice === "required") body.tool_choice = { type: "any" };
    else if (req.toolChoice === "none") body.tool_choice = { type: "none" };
    else if (req.toolChoice === "auto") body.tool_choice = { type: "auto" };
  }
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (stream) body.stream = true;
  return { body, breakpoints: used };
}

function n(v: unknown): number {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
}

/** input_tokens excludes cached parts; the port wants the full prompt size. */
export function normalizeAnthropicUsage(u: unknown): Usage {
  const o = (u && typeof u === "object" ? u : {}) as Json;
  const write = n(o.cache_creation_input_tokens);
  const read = n(o.cache_read_input_tokens);
  return { inputTokens: n(o.input_tokens) + write + read, outputTokens: n(o.output_tokens), cachedTokens: read, cacheWriteTokens: write };
}

function mapStop(reason: unknown, toolCalls: number): ChatResult["stopReason"] {
  if (toolCalls > 0 && reason !== "max_tokens") return "tool_use";
  if (reason === "max_tokens" || reason === "model_context_window_exceeded") return "length";
  if (reason === "refusal") return "filter";
  return "end";
}

export function parseAnthropicResponse(j: Json, fallbackModel: string): Omit<ChatResult, "latencyMs" | "retries"> {
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const b of (Array.isArray(j.content) ? j.content : []) as Json[]) {
    if (b.type === "text" && typeof b.text === "string") text += b.text;
    else if (b.type === "tool_use") toolCalls.push({ id: String(b.id ?? `toolu_${toolCalls.length}`), name: String(b.name ?? ""), arguments: JSON.stringify(b.input ?? {}) });
  }
  return {
    text,
    toolCalls,
    stopReason: mapStop(j.stop_reason, toolCalls.length),
    usage: normalizeAnthropicUsage(j.usage),
    model: typeof j.model === "string" && j.model ? j.model : fallbackModel,
  };
}

const STREAM_ERROR_STATUS: Record<string, number> = {
  overloaded_error: 529,
  rate_limit_error: 429,
  api_error: 500,
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
};

export function createAnthropicChat(cfg: AnthropicChatConfig): LlmProvider {
  const now = cfg.now ?? Date.now;
  const vendor = cfg.label ?? "anthropic";
  const guard = createUrlGuard(cfg.guard, now);
  const doFetch = (url: string, init: RequestInit) => (cfg.fetch ?? globalThis.fetch)(url, { ...init, redirect: "manual" });
  const headers = (): Record<string, string> => ({
    "content-type": "application/json",
    "anthropic-version": cfg.version ?? ANTHROPIC_VERSION,
    ...(cfg.apiKey ? { "x-api-key": cfg.apiKey } : {}),
    ...cfg.headers,
  });

  async function readStream(res: Response, req: ChatRequest): Promise<Omit<ChatResult, "latencyMs" | "retries">> {
    if (!res.body) throw new LlmError("server", `${vendor}: empty stream`);
    let text = "";
    let model = req.model;
    let stop: unknown = null;
    let usage: Json = {};
    const blocks = new Map<number, { type: string; id: string; name: string; json: string }>();
    try {
      for await (const ev of readSse(res.body)) {
        let j: Json;
        try {
          j = JSON.parse(ev.data) as Json;
        } catch {
          continue;
        }
        const type = String(j.type ?? ev.event ?? "");
        if (type === "error") {
          const e = (j.error ?? {}) as Json;
          throw httpError(STREAM_ERROR_STATUS[String(e.type)] ?? 500, JSON.stringify(j), new Headers(), vendor);
        }
        if (type === "message_start") {
          const m = (j.message ?? {}) as Json;
          if (typeof m.model === "string") model = m.model;
          usage = { ...usage, ...((m.usage ?? {}) as Json) };
        } else if (type === "content_block_start") {
          const b = (j.content_block ?? {}) as Json;
          blocks.set(Number(j.index ?? blocks.size), { type: String(b.type), id: String(b.id ?? ""), name: String(b.name ?? ""), json: "" });
          if (b.type === "text" && typeof b.text === "string" && b.text) {
            text += b.text;
            req.onDelta?.(b.text);
          }
        } else if (type === "content_block_delta") {
          const d = (j.delta ?? {}) as Json;
          if (d.type === "text_delta" && typeof d.text === "string") {
            text += d.text;
            req.onDelta?.(d.text);
          } else if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
            const b = blocks.get(Number(j.index));
            if (b) b.json += d.partial_json;
          }
        } else if (type === "message_delta") {
          const d = (j.delta ?? {}) as Json;
          if (d.stop_reason) stop = d.stop_reason;
          const u = (j.usage ?? {}) as Json;
          for (const [k, v] of Object.entries(u)) if (v !== null && v !== undefined) usage[k] = v;
        } else if (type === "message_stop") {
          break;
        }
      }
    } catch (e) {
      throw transportError(e, req.signal, vendor);
    }
    const toolCalls: ToolCall[] = [...blocks.entries()]
      .filter(([, b]) => b.type === "tool_use")
      .sort((a, b) => a[0] - b[0])
      .map(([i, b]) => ({ id: b.id || `toolu_${i}`, name: b.name, arguments: b.json || "{}" }));
    return { text, toolCalls, stopReason: mapStop(stop, toolCalls.length), usage: normalizeAnthropicUsage(usage), model };
  }

  return {
    id: cfg.id,
    protocol: "anthropic_messages",
    async chat(req: ChatRequest): Promise<ChatResult> {
      const started = now();
      const url = anthropicUrl(cfg.baseUrl, "/messages");
      await guard(url);
      const stream = typeof req.onDelta === "function";
      const { body } = buildAnthropicBody(req, stream);
      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { ...headers(), accept: stream ? "text/event-stream" : "application/json" },
          body: JSON.stringify(body),
          signal: withTimeout(req.signal, cfg.timeoutMs ?? (stream ? 300_000 : 180_000)),
        });
      } catch (e) {
        throw transportError(e, req.signal, vendor);
      }
      if (!res.ok) throw httpError(res.status, await res.text().catch(() => ""), res.headers, vendor);
      let out: Omit<ChatResult, "latencyMs" | "retries">;
      if (stream && !(res.headers.get("content-type") ?? "").includes("application/json")) {
        out = await readStream(res, req);
      } else {
        let j: Json;
        try {
          j = (await res.json()) as Json;
        } catch (e) {
          throw transportError(e, req.signal, vendor);
        }
        out = parseAnthropicResponse(j, req.model);
        if (stream && out.text) req.onDelta?.(out.text);
      }
      return { ...out, latencyMs: now() - started, retries: 0 };
    },
    async listModels(signal?: AbortSignal): Promise<ProviderModel[]> {
      const url = `${anthropicUrl(cfg.baseUrl, "/models")}?limit=100`;
      await guard(url);
      let res: Response;
      try {
        res = await doFetch(url, { headers: headers(), signal: withTimeout(signal, 15_000) });
      } catch (e) {
        throw transportError(e, signal, vendor);
      }
      if (!res.ok) throw httpError(res.status, await res.text().catch(() => ""), res.headers, vendor);
      const j = (await res.json().catch(() => ({}))) as Json;
      return ((Array.isArray(j.data) ? j.data : []) as Json[])
        .filter((m) => typeof m.id === "string" && m.id)
        .map((m) => ({
          id: String(m.id),
          ...(typeof m.display_name === "string" && m.display_name !== m.id ? { label: m.display_name } : {}),
          ...(n(m.max_input_tokens) ? { contextWindow: n(m.max_input_tokens) } : {}),
        }));
    },
  };
}
