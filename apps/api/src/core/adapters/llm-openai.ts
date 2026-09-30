// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// OpenAI Chat Completions adapter for every openai_chat preset (OpenAI,
// DeepSeek, OpenRouter, Gemini compat, Groq, Mistral, Ollama, custom...).
// Known vendor refusals self-heal through the table in llm-quirks, per
// provider and model; on the official OpenAI host a model that refuses
// tools while reasoning moves to the Responses API (llm-openai-responses)
// and only falls back to reasoning_effort "none" when that path fails.
// The owner's per-tier reasoning effort becomes reasoning_effort (default
// sends nothing). Reasoning state a vendor attaches to its own tool calls
// (DeepSeek and Kimi reasoning_content, OpenRouter reasoning_details, Gemini
// thought signatures in extra_content) is kept per tool call id and sent back
// with that call, because those models refuse a tool turn without it.
// This file also hosts the small HTTP kit the sibling provider adapters
// share: the base URL guard (SSRF), status and body -> LlmError mapping,
// Retry-After parsing and an SSE reader. Pure fetch, no SDK.
import type { Mode, ProviderModel } from "@mengai/shared";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { redact } from "../../lib/redact";
import { LlmError } from "../ports/llm";
import type { ChatMessage, ChatRequest, ChatResult, ContentPart, LlmProvider, ToolCall, Usage } from "../ports/llm";
import { buildResponsesBody, createResponsesStream, parseResponsesResult, responsesErrorStatus } from "./llm-openai-responses";
import {
  ALTERNATIVES_RE,
  cloneQuirks,
  createEchoStore,
  createQuirkStore,
  diagnose,
  effortFor,
  emptyQuirks,
  JSON_WORD_RE,
  NO_TOOLS_RE,
  refusalContext,
  refusesField,
  toolsUnsupportedError,
  UNSUPPORTED_RE,
  type EchoStore,
  type MaxTokensField,
  type QuirkStore,
  type WorkingQuirks,
} from "./llm-quirks";

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type LookupFn = (host: string) => Promise<Array<{ address: string; family: number }>>;

// ------------------------------------------------------------ URL guard

export interface UrlGuardOptions {
  mode: Mode;
  /** preset flagged local (Ollama, LM Studio): allowed only in local mode */
  localPreset?: boolean;
  /**
   * check the address even in local mode: for URLs a vendor hands back
   * (media downloads), which must never reach loopback or the LAN
   */
  publicOnly?: boolean;
  /** DNS resolver, injectable for tests; defaults to node:dns lookup(all) */
  lookup?: LookupFn;
}

export class UnsafeUrlError extends Error {
  constructor(
    message: string,
    /** blocked = never allowed; unresolved = DNS failed (may be transient) */
    public readonly reason: "blocked" | "unresolved" = "blocked",
  ) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function ipv4Blocked(ip: string): boolean {
  const p = ip.split(".").map((x) => Number(x));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Expands an IPv6 literal to 8 hextets; null when malformed. */
function expandIpv6(ip: string): number[] | null {
  let s = (ip.toLowerCase().split("%")[0] ?? "").trim();
  const v4 = s.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const p = v4.slice(2).map(Number);
    if (p.some((x) => !Number.isInteger(x) || x > 255)) return null;
    s = `${v4[1]}${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`;
  }
  const parse = (part: string) => (part ? part.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)) : []);
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = parse(halves[0] ?? "");
  const tail = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if ([...head, ...tail].some((x) => Number.isNaN(x))) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

function ipv6Blocked(ip: string): boolean {
  const h = expandIpv6(ip);
  if (!h) return true;
  const [a, b] = h as [number, number];
  // ::/8 covers ::, ::1, v4-compatible and v4-mapped (::ffff:x) forms
  if (a === 0) {
    const mapped = h[5] === 0xffff && h.slice(0, 5).every((x) => x === 0);
    if (mapped) return ipv4Blocked(`${h[6]! >> 8}.${h[6]! & 255}.${h[7]! >> 8}.${h[7]! & 255}`);
    return true;
  }
  if ((a & 0xfe00) === 0xfc00) return true; // unique local
  if ((a & 0xffc0) === 0xfe80) return true; // link-local
  if ((a & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation
  if (a === 0x0064 && b === 0xff9b) return true; // NAT64
  if (a === 0x2002) return ipv4Blocked(`${h[1]! >> 8}.${h[1]! & 255}.${h[2]! >> 8}.${h[2]! & 255}`); // 6to4
  return false;
}

/** true for loopback, private, link-local, CGNAT, multicast and reserved addresses */
export function isBlockedAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return ipv4Blocked(address);
  if (kind === 6) return ipv6Blocked(address);
  return true;
}

const defaultLookup: LookupFn = async (host) => {
  const r = await dnsLookup(host, { all: true, verbatim: true });
  return r.map((x) => ({ address: x.address, family: x.family }));
};

/**
 * Validates a provider base URL. Always: http(s) only, no credentials.
 * Server mode: https only, no local presets, and every resolved address must
 * be public. https matters twice here: plain http would put the key on the
 * wire, and a DNS rebind between this check and fetch's own lookup lands on
 * a TLS handshake that an internal host cannot pass for the public name.
 * Local mode (desktop app on 127.0.0.1): localhost is fine (Ollama, LM
 * Studio), unless publicOnly is set for a vendor-returned URL.
 */
export async function assertSafeUrl(raw: string, opts: UrlGuardOptions): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("base URL is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("base URL must use http or https");
  if (url.username || url.password) throw new UnsafeUrlError("base URL must not contain credentials");
  if (opts.mode === "local" && !opts.publicOnly) return url;
  if (opts.mode === "server") {
    if (opts.localPreset) throw new UnsafeUrlError("local providers (Ollama, LM Studio) are available in the Mac app only");
    if (url.protocol !== "https:") throw new UnsafeUrlError("base URL must use https in server mode");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new UnsafeUrlError("base URL points to a private, loopback or link-local address");
    return url;
  }
  if (/(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i.test(host)) {
    throw new UnsafeUrlError("base URL points to a local hostname");
  }
  let addrs: Array<{ address: string }>;
  try {
    addrs = await (opts.lookup ?? defaultLookup)(host);
  } catch {
    throw new UnsafeUrlError(`cannot resolve host ${host}`, "unresolved");
  }
  if (addrs.length === 0) throw new UnsafeUrlError(`cannot resolve host ${host}`, "unresolved");
  for (const a of addrs) {
    if (isBlockedAddress(a.address)) throw new UnsafeUrlError(`host ${host} resolves to a private, loopback or link-local address`);
  }
  return url;
}

/**
 * Per-adapter guard with a short positive cache, so every request re-checks
 * DNS at most once a minute per origin (limits DNS rebinding windows without a
 * lookup on every call). Throws LlmError: blocked -> bad_request, DNS -> network.
 */
export function createUrlGuard(opts: UrlGuardOptions, now: () => number = Date.now, ttlMs = 60_000): (url: string) => Promise<void> {
  const ok = new Map<string, number>();
  return async (url: string) => {
    // keyed on the origin, so a cached https pass never covers an http URL
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      throw new LlmError("bad_request", "base URL is not a valid URL");
    }
    const until = ok.get(origin);
    if (until && until > now()) return;
    try {
      await assertSafeUrl(url, opts);
    } catch (e) {
      if (e instanceof UnsafeUrlError) {
        throw new LlmError(e.reason === "unresolved" ? "network" : "bad_request", `blocked base URL: ${e.message}`);
      }
      throw e;
    }
    ok.set(origin, now() + ttlMs);
  };
}

// ------------------------------------------------------------ error mapping

export function parseRetryAfter(headers: Headers, now: number = Date.now()): number | null {
  const ms = headers.get("retry-after-ms");
  if (ms !== null && ms.trim() !== "" && Number.isFinite(Number(ms))) return Math.max(0, Number(ms));
  const ra = headers.get("retry-after");
  if (ra === null || ra.trim() === "") return null;
  const secs = Number(ra);
  if (Number.isFinite(secs)) return Math.max(0, Math.round(secs * 1000));
  const at = Date.parse(ra);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

function short(text: string, max = 300): string {
  const clean = redact(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

/** Pulls { message, type, code } out of any vendor error body (JSON or text). */
export function errorDetails(bodyText: string): { message: string; type: string; code: string } {
  let message = "";
  let type = "";
  let code = "";
  try {
    const j = JSON.parse(bodyText) as unknown;
    const root = (Array.isArray(j) ? j[0] : j) as Record<string, unknown> | null;
    const e = (root && typeof root === "object" && "error" in root ? root.error : root) as unknown;
    if (typeof e === "string") message = e;
    else if (e && typeof e === "object") {
      const o = e as Record<string, unknown>;
      message = String(o.message ?? o.detail ?? (root as Record<string, unknown>)?.message ?? "");
      type = String(o.type ?? o.status ?? "");
      code = o.code === undefined || o.code === null ? "" : String(o.code);
    }
    if (!message && root && typeof root === "object") message = String((root as Record<string, unknown>).message ?? (root as Record<string, unknown>).detail ?? "");
  } catch {
    message = bodyText;
  }
  return { message: short(message || ""), type, code };
}

const CONTEXT_RE =
  /context[ _-]?(length|window)|maximum context|prompt is too long|prompt too long|input is too long|too many (input |prompt )?tokens|reduce the length of the (messages|prompt|input)/i;

/** Maps an HTTP failure to the port's error kinds. Messages are redacted and short. */
export function httpError(status: number, bodyText: string, headers: Headers, vendor = "provider"): LlmError {
  const d = errorDetails(bodyText);
  const hay = `${d.type} ${d.code} ${d.message}`;
  const msg = `${vendor} ${status}: ${d.message || d.type || "request failed"}`;
  const retryAfter = parseRetryAfter(headers);
  if (status === 401 || status === 403) return new LlmError("auth", msg, status);
  if (status === 429) {
    if (/insufficient_quota|check your plan and billing/i.test(hay)) return new LlmError("auth", `${vendor} 429: quota exhausted, check the account billing`, status);
    return new LlmError("rate_limit", msg, status, retryAfter);
  }
  if (status === 529 || status === 503 || (status >= 500 && /overloaded/i.test(hay))) return new LlmError("overloaded", msg, status, retryAfter);
  if (status === 413) return new LlmError("context_length", msg, status);
  if ((status === 400 || status === 422) && CONTEXT_RE.test(hay)) return new LlmError("context_length", msg, status);
  if (status === 404) return new LlmError("not_found", msg, status);
  if (status === 408) return new LlmError("timeout", msg, status, retryAfter);
  if (status >= 500) return new LlmError("server", msg, status, retryAfter);
  if (status >= 300 && status < 400) return new LlmError("bad_request", `${vendor} ${status}: unexpected redirect, check the base URL`, status);
  return new LlmError("bad_request", msg, status);
}

/** Maps a thrown fetch or stream error. Caller abort wins over timeouts. */
export function transportError(err: unknown, callerSignal?: AbortSignal, vendor = "provider"): LlmError {
  if (err instanceof LlmError) return err;
  if (callerSignal?.aborted) return new LlmError("aborted", `${vendor}: request aborted`);
  const name = (err as { name?: string } | null)?.name ?? "";
  if (name === "TimeoutError" || name === "AbortError") return new LlmError("timeout", `${vendor}: request timed out`);
  const message = err instanceof Error ? err.message : String(err);
  return new LlmError("network", `${vendor}: network error: ${short(message, 200)}`);
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

// ------------------------------------------------------------ SSE

export interface SseEvent {
  event: string | null;
  data: string;
}

/** Minimal text/event-stream reader: handles split chunks, CRLF, comments, multi-line data. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let event: string | null = null;
  let data: string[] = [];
  const line = function* (raw: string): Generator<SseEvent> {
    if (raw === "") {
      if (data.length) yield { event, data: data.join("\n") };
      event = null;
      data = [];
      return;
    }
    if (raw.startsWith(":")) return;
    const i = raw.indexOf(":");
    const field = i === -1 ? raw : raw.slice(0, i);
    let value = i === -1 ? "" : raw.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // keep a trailing CR until we know whether LF follows
      const hold = buf.endsWith("\r") ? "\r" : "";
      const text = hold ? buf.slice(0, -1) : buf;
      const parts = text.split(/\r\n|\n|\r/);
      buf = (parts.pop() ?? "") + hold;
      for (const p of parts) yield* line(p);
    }
    buf += decoder.decode();
    for (const p of buf.split(/\r\n|\n|\r/)) yield* line(p);
    yield* line("");
  } finally {
    try {
      await reader.cancel();
    } catch {
      // stream already closed
    }
  }
}

// ------------------------------------------------------------ OpenAI chat

export interface OpenAiChatConfig {
  /** providers table row id */
  id: string;
  baseUrl: string;
  apiKey: string | null;
  guard: UrlGuardOptions;
  /** vendor label for error messages */
  label?: string;
  headers?: Record<string, string>;
  /** max_tokens field name; default max_completion_tokens on api.openai.com, max_tokens elsewhere */
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  timeoutMs?: number;
  fetch?: FetchFn;
  now?: () => number;
  /** what this provider taught about each model (see llm-quirks); one store per provider row */
  quirks?: QuirkStore;
}

type Json = Record<string, unknown>;

function textOf(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .map((p) => (p.type === "text" ? p.text : "[image omitted]"))
    .join("\n");
}

function userContent(content: string | ContentPart[]): string | Json[] {
  if (typeof content === "string") return content;
  return content.map((p) =>
    p.type === "text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.dataBase64}` } },
  );
}

/** The system prompt folded into the first user turn, for models that refuse the system and developer roles. */
function foldSystem(system: string, out: Json[]): void {
  const first = out[0];
  if (first && first.role === "user") {
    const c = first.content;
    first.content = typeof c === "string" ? `${system}\n\n${c}` : [{ type: "text", text: system }, ...(c as Json[])];
  } else {
    out.unshift({ role: "user", content: system });
  }
}

function toOpenAiMessages(system: string, messages: ChatMessage[], systemAs?: "developer" | "user", echo?: EchoStore): Json[] {
  const out: Json[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId ?? "", content: textOf(m.content) });
    } else if (m.role === "assistant") {
      const msg: Json = { role: "assistant", content: textOf(m.content) || null };
      if (m.toolCalls?.length) {
        // the vendor's own reasoning for this tool turn goes back with it (see EchoStore)
        const saved = echo?.get(m.toolCalls[0]!.id)?.message;
        if (saved && typeof saved === "object") Object.assign(msg, saved);
        msg.tool_calls = m.toolCalls.map((tc) => {
          const call: Json = { id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments || "{}" } };
          const extra = echo?.get(tc.id)?.extra;
          if (extra && typeof extra === "object") call.extra_content = extra;
          return call;
        });
      } else if (msg.content === null) msg.content = "";
      out.push(msg);
    } else {
      out.push({ role: "user", content: userContent(m.content) });
    }
  }
  if (system) {
    if (systemAs === "user") foldSystem(system, out);
    else out.unshift({ role: systemAs ?? "system", content: system });
  }
  return out;
}

/** Optional request fields a compatible vendor may reject as unsupported (the generic heal). */
const OPTIONAL_PARAMS = ["prompt_cache_key", "stream_options", "temperature", "max_tokens", "max_completion_tokens", "response_format"] as const;
type OptionalParam = (typeof OPTIONAL_PARAMS)[number];

const isMaxTokensField = (p: OptionalParam): p is MaxTokensField => p === "max_tokens" || p === "max_completion_tokens";
const otherMaxTokensField = (f: MaxTokensField): MaxTokensField => (f === "max_tokens" ? "max_completion_tokens" : "max_tokens");

export interface OpenAiBodyOptions {
  stream: boolean;
  /** the vendor default for the output cap field; a learned rename in quirks wins */
  maxTokensField: MaxTokensField;
  quirks?: WorkingQuirks;
  /** vendor reasoning state to send back with its tool calls; left out when the model refused it */
  echo?: EchoStore;
}

export function buildOpenAiBody(req: ChatRequest, opts: OpenAiBodyOptions): Json {
  const q = opts.quirks ?? cloneQuirks(undefined);
  const drop = q.drop;
  const body: Json = { model: req.model, messages: toOpenAiMessages(req.system, req.messages, q.system, q.noEcho ? undefined : opts.echo) };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    if (req.toolChoice && !drop.has("tool_choice")) body.tool_choice = req.toolChoice;
    if (req.parallelToolCalls !== undefined && !drop.has("parallel_tool_calls")) body.parallel_tool_calls = req.parallelToolCalls;
  }
  // the owner's effort for this tier, or the low effort a reasoning model takes tools at (llm-quirks effortFor)
  const effort = effortFor(req, q, "chat");
  if (effort) body.reasoning_effort = effort;
  // the output cap is never dropped (budget control); only its field name varies per vendor
  if (req.maxOutputTokens !== undefined) body[q.maxTokensField ?? opts.maxTokensField] = req.maxOutputTokens;
  if (req.temperature !== undefined) {
    if (q.temperatureOne) body.temperature = 1;
    else if (!drop.has("temperature")) body.temperature = req.temperature;
  }
  if (req.topP !== undefined && !drop.has("top_p")) body.top_p = req.topP;
  if (req.responseFormat === "json" && !q.jsonOff) body.response_format = { type: "json_object" };
  if (req.cacheKey && !drop.has("prompt_cache_key")) body.prompt_cache_key = req.cacheKey;
  if (opts.stream) {
    body.stream = true;
    if (!drop.has("stream_options")) body.stream_options = { include_usage: true };
  }
  return body;
}

function n(v: unknown): number {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
}

/**
 * Normalizes OpenAI-style usage: prompt_tokens includes the cached part;
 * cached tokens come from prompt_tokens_details.cached_tokens (OpenAI,
 * OpenRouter, Gemini compat), input_tokens_details.cached_tokens (Responses
 * API) or prompt_cache_hit_tokens (DeepSeek).
 */
export function normalizeOpenAiUsage(u: unknown): Usage {
  const o = (u && typeof u === "object" ? u : {}) as Json;
  const details = (o.prompt_tokens_details ?? o.input_tokens_details ?? {}) as Json;
  const input = n(o.prompt_tokens ?? o.input_tokens);
  const output = n(o.completion_tokens ?? o.output_tokens);
  const cached = Math.min(input, Math.max(n(details.cached_tokens), n(o.prompt_cache_hit_tokens), n(o.cached_tokens)));
  const cacheWrite = Math.min(Math.max(0, input - cached), Math.max(n(details.cache_write_tokens), n(o.cache_creation_input_tokens)));
  return { inputTokens: input, outputTokens: output, cachedTokens: cached, cacheWriteTokens: cacheWrite };
}

function mapFinish(reason: unknown, toolCalls: number): ChatResult["stopReason"] {
  if (toolCalls > 0) return "tool_use";
  if (reason === "length") return "length";
  if (reason === "content_filter") return "filter";
  return "end";
}

function contentText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p && typeof p === "object" && typeof (p as Json).text === "string" ? String((p as Json).text) : "")).join("");
  return "";
}

export function parseOpenAiResponse(j: Json, fallbackModel: string): Omit<ChatResult, "latencyMs" | "retries"> {
  const choice = (Array.isArray(j.choices) ? j.choices[0] : undefined) as Json | undefined;
  const msg = (choice?.message ?? {}) as Json;
  const raw = Array.isArray(msg.tool_calls) ? (msg.tool_calls as Json[]) : [];
  const toolCalls: ToolCall[] = raw
    .filter((tc) => tc && typeof tc === "object" && tc.function)
    .map((tc, i) => {
      const fn = tc.function as Json;
      const args = fn.arguments;
      return {
        id: typeof tc.id === "string" && tc.id ? tc.id : `call_${i}`,
        name: String(fn.name ?? ""),
        arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
      };
    });
  return {
    text: contentText(msg.content),
    toolCalls,
    stopReason: mapFinish(choice?.finish_reason, toolCalls.length),
    usage: normalizeOpenAiUsage(j.usage),
    model: typeof j.model === "string" && j.model ? j.model : fallbackModel,
  };
}

/** Merges streamed reasoning_details parts by index: text-like strings grow, everything else is replaced. */
function mergeDetails(into: Json[], parts: unknown): void {
  if (!Array.isArray(parts)) return;
  for (const raw of parts as Json[]) {
    if (!raw || typeof raw !== "object") continue;
    const at = typeof raw.index === "number" ? raw.index : into.length;
    const cur = into[at] ?? {};
    for (const [k, v] of Object.entries(raw)) {
      cur[k] = typeof v === "string" && typeof cur[k] === "string" && !["type", "format", "id"].includes(k) ? `${cur[k] as string}${v}` : v;
    }
    into[at] = cur;
  }
}

/**
 * Keeps what a vendor attached to its own tool calls, keyed by the vendor's
 * call ids: the message-level reasoning under the first call, and each call's
 * extra_content. Synthesized ids (a vendor that sent none) are never keyed.
 */
function rememberEcho(echo: EchoStore, toolCalls: ToolCall[], vendorIds: ReadonlySet<string>, message: Json, extras: ReadonlyMap<string, Json>): void {
  if (toolCalls.length === 0) return;
  const msg: Json = {};
  if (typeof message.reasoning_content === "string" && message.reasoning_content) msg.reasoning_content = message.reasoning_content;
  if (Array.isArray(message.reasoning_details) && message.reasoning_details.length) msg.reasoning_details = message.reasoning_details;
  toolCalls.forEach((tc, i) => {
    if (!vendorIds.has(tc.id)) return;
    const value: Json = {};
    if (i === 0 && Object.keys(msg).length) value.message = msg;
    const extra = extras.get(tc.id);
    if (extra) value.extra = extra;
    if (Object.keys(value).length) echo.set(tc.id, value);
  });
}

function authHeaders(apiKey: string | null): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

const isOptionalParam = (v: unknown): v is OptionalParam => typeof v === "string" && (OPTIONAL_PARAMS as readonly string[]).includes(v);

/**
 * Optional fields the vendor rejected as unsupported in a 400 or 422 body.
 * Value errors ("'messages' must contain the word 'json' ... response_format",
 * "max_completion_tokens is too large") name a field without rejecting it,
 * so they return nothing and surface as bad_request. A structured OpenAI
 * error (error.param + an unsupported code or message) is trusted first;
 * otherwise a field counts only when an unsupported phrase and the field
 * name share one clause, before any "expected one of" or "use X instead" tail.
 * Only OPTIONAL_PARAMS can ever be returned; a structured error naming any
 * other param (for example "messages") returns nothing.
 */
export function unsupportedParams(errText: string, sent: Json): OptionalParam[] {
  const text = errText.slice(0, 4000);
  if (JSON_WORD_RE.test(text)) return [];
  try {
    const j = JSON.parse(text) as { error?: { param?: unknown; code?: unknown; message?: unknown } };
    const e = j && typeof j === "object" ? j.error : undefined;
    // a named param outside the allowlist (messages, model, tools...) is required or not ours
    // to drop, so the error is a real bad_request whatever the message says
    if (e && typeof e === "object" && typeof e.param === "string" && e.param) {
      if (!isOptionalParam(e.param)) return [];
      return e.param in sent && UNSUPPORTED_RE.test(`${String(e.code ?? "")} ${String(e.message ?? "")}`) ? [e.param] : [];
    }
  } catch {
    // not JSON: fall through to the clause scan
  }
  const found = new Set<OptionalParam>();
  for (const raw of text.split(/[.;!?](?:\s|$)|\n/)) {
    const clause = raw.split(ALTERNATIVES_RE)[0] ?? "";
    if (!UNSUPPORTED_RE.test(clause)) continue;
    for (const p of OPTIONAL_PARAMS) {
      if (p in sent && new RegExp(`\\b${p}\\b`).test(clause)) found.add(p);
    }
  }
  return [...found];
}

/** At most this many heals per call; every heal must change the request, so loops end sooner. */
const MAX_HEALS = 6;
/** Statuses a Responses attempt may fail with before the adapter falls back to Chat Completions. */
const RESPONSES_FALLBACK = new Set([400, 404, 405, 422]);

type ChatOut = Omit<ChatResult, "latencyMs" | "retries">;

export function createOpenAiChat(cfg: OpenAiChatConfig): LlmProvider {
  const now = cfg.now ?? Date.now;
  const vendor = cfg.label ?? "provider";
  const guard = createUrlGuard(cfg.guard, now);
  const official = /^https:\/\/api\.openai\.com(\/|$)/.test(cfg.baseUrl);
  const maxTokensField = cfg.maxTokensField ?? (official ? "max_completion_tokens" : "max_tokens");
  const store = cfg.quirks ?? createQuirkStore();
  const echo = createEchoStore();
  const doFetch = (url: string, init: RequestInit) => (cfg.fetch ?? globalThis.fetch)(url, { ...init, redirect: "manual" });
  const timeoutFor = (stream: boolean) => cfg.timeoutMs ?? (stream ? 300_000 : 180_000);

  async function post(url: string, body: Json, stream: boolean, signal: AbortSignal | undefined): Promise<Response> {
    try {
      return await doFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: stream ? "text/event-stream" : "application/json",
          ...authHeaders(cfg.apiKey),
          ...cfg.headers,
        },
        body: JSON.stringify(body),
        signal: withTimeout(signal, timeoutFor(stream)),
      });
    } catch (e) {
      throw transportError(e, signal, vendor);
    }
  }

  async function readStream(res: Response, req: ChatRequest): Promise<ChatOut> {
    let text = "";
    let finish: unknown = null;
    let usage: unknown = null;
    let model = req.model;
    let reasoning = "";
    const details: Json[] = [];
    const calls = new Map<number, { id: string; name: string; args: string; extra?: Json }>();
    if (!res.body) throw new LlmError("server", `${vendor}: empty stream`);
    try {
      for await (const ev of readSse(res.body)) {
        if (ev.data === "[DONE]") break;
        let j: Json;
        try {
          j = JSON.parse(ev.data) as Json;
        } catch {
          continue;
        }
        if (j.error) {
          const e = j.error as Json;
          const status = typeof e.code === "number" ? e.code : /overloaded/i.test(String(e.message ?? e.type ?? "")) ? 529 : 500;
          throw httpError(status, JSON.stringify(j), new Headers(), vendor);
        }
        if (typeof j.model === "string" && j.model) model = j.model;
        if (j.usage) usage = j.usage;
        for (const ch of (Array.isArray(j.choices) ? j.choices : []) as Json[]) {
          const d = (ch.delta ?? {}) as Json;
          if (typeof d.content === "string" && d.content) {
            text += d.content;
            req.onDelta?.(d.content);
          }
          if (typeof d.reasoning_content === "string") reasoning += d.reasoning_content;
          mergeDetails(details, d.reasoning_details);
          for (const tc of (Array.isArray(d.tool_calls) ? d.tool_calls : []) as Json[]) {
            const idx = typeof tc.index === "number" ? tc.index : tc.id ? calls.size : Math.max(0, calls.size - 1);
            const cur = calls.get(idx) ?? { id: "", name: "", args: "" };
            const fn = (tc.function ?? {}) as Json;
            if (typeof tc.id === "string" && tc.id) cur.id = tc.id;
            if (typeof fn.name === "string" && fn.name && !cur.name) cur.name = fn.name;
            if (typeof fn.arguments === "string") cur.args += fn.arguments;
            if (tc.extra_content && typeof tc.extra_content === "object") cur.extra = { ...cur.extra, ...(tc.extra_content as Json) };
            calls.set(idx, cur);
          }
          if (ch.finish_reason) finish = ch.finish_reason;
        }
      }
    } catch (e) {
      throw transportError(e, req.signal, vendor);
    }
    const sorted = [...calls.entries()].sort((a, b) => a[0] - b[0]);
    const toolCalls = sorted.map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, arguments: c.args }));
    const extras = new Map<string, Json>();
    for (const [, c] of sorted) if (c.id && c.extra) extras.set(c.id, c.extra);
    const message: Json = { reasoning_content: reasoning, reasoning_details: details.filter(Boolean) };
    rememberEcho(echo, toolCalls, new Set(sorted.map(([, c]) => c.id).filter(Boolean)), message, extras);
    return { text, toolCalls, stopReason: mapFinish(finish, toolCalls.length), usage: normalizeOpenAiUsage(usage), model };
  }

  async function readJson(res: Response, req: ChatRequest): Promise<Json> {
    let j: Json;
    try {
      j = (await res.json()) as Json;
    } catch (e) {
      throw transportError(e, req.signal, vendor);
    }
    return j;
  }

  async function readChat(res: Response, req: ChatRequest, stream: boolean): Promise<ChatOut> {
    if (stream && !(res.headers.get("content-type") ?? "").includes("application/json")) return readStream(res, req);
    const j = await readJson(res, req);
    if (!Array.isArray(j.choices) && j.error) {
      const code = Number((j.error as Json).code);
      throw httpError(Number.isInteger(code) && code >= 400 ? code : 502, JSON.stringify(j), res.headers, vendor);
    }
    const out = parseOpenAiResponse(j, req.model);
    const msg = ((Array.isArray(j.choices) ? (j.choices[0] as Json | undefined) : undefined)?.message ?? {}) as Json;
    const raw = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []) as Json[];
    const vendorIds = new Set(raw.map((tc) => (tc && typeof tc.id === "string" ? tc.id : "")).filter(Boolean));
    const extras = new Map<string, Json>();
    for (const tc of raw) if (tc && typeof tc.id === "string" && tc.extra_content && typeof tc.extra_content === "object") extras.set(tc.id, tc.extra_content as Json);
    rememberEcho(echo, out.toolCalls, vendorIds, msg, extras);
    // not streamed (JSON answer, or a model that may not stream): the whole text is one delta
    if (req.onDelta && out.text) req.onDelta(out.text);
    return out;
  }

  async function readResponses(res: Response, req: ChatRequest, stream: boolean): Promise<ChatOut> {
    if (stream && !(res.headers.get("content-type") ?? "").includes("application/json")) {
      if (!res.body) throw new LlmError("server", `${vendor}: empty stream`);
      const acc = createResponsesStream(req.model, req.onDelta);
      try {
        for await (const ev of readSse(res.body)) {
          if (ev.data === "[DONE]") break;
          let j: Json;
          try {
            j = JSON.parse(ev.data) as Json;
          } catch {
            continue;
          }
          const step = acc.push(String(j.type ?? ev.event ?? ""), j);
          if (step === "done") break;
          if (step) throw httpError(step.error.status, step.error.body, new Headers(), vendor);
        }
      } catch (e) {
        throw transportError(e, req.signal, vendor);
      }
      const r = acc.result();
      return { ...r, usage: normalizeOpenAiUsage(r.usage) };
    }
    const j = await readJson(res, req);
    if (j.error && !Array.isArray(j.output)) {
      const e = j.error as Json;
      throw httpError(responsesErrorStatus(String(e.code ?? ""), String(e.message ?? "")), JSON.stringify(j), res.headers, vendor);
    }
    const r = parseResponsesResult(j, req.model);
    if (req.onDelta && r.text) req.onDelta(r.text);
    return { ...r, usage: normalizeOpenAiUsage(r.usage) };
  }

  /** The generic heal for allowlisted optional fields; true when the request changed. */
  function genericHeal(errText: string, body: Json, q: WorkingQuirks): boolean {
    let changed = false;
    for (const p of unsupportedParams(errText, body)) {
      if (isMaxTokensField(p)) {
        const field = q.maxTokensField ?? maxTokensField;
        // renamed once per call, never removed: a vendor refusing both names gets a bad_request
        if (p === field && !q.fieldSwapped) {
          q.maxTokensField = otherMaxTokensField(field);
          q.fieldSwapped = changed = true;
        }
      } else if (p === "response_format") {
        // JSON mode is dropped for this call only and asked for again next time
        if (!q.jsonOff) q.jsonOff = changed = true;
      } else if (!q.drop.has(p)) {
        q.drop.add(p);
        if (p === "temperature") q.temperatureOne = false;
        changed = true;
      }
    }
    return changed;
  }

  function noTools(req: ChatRequest, status: number | null): LlmError {
    // remembered at once: every later tool call with this model fails fast with the same sentence
    store.set(req.model, { ...(store.get(req.model) ?? emptyQuirks()), noTools: true });
    return toolsUnsupportedError(vendor, req.model, status);
  }

  /** Chat Completions with the heal loop. "responses" means the official host told us to switch. */
  async function viaChat(req: ChatRequest, q: WorkingQuirks): Promise<{ out: ChatOut; healed: boolean } | "responses"> {
    const url = joinUrl(cfg.baseUrl, "/chat/completions");
    await guard(url);
    const hasTools = Boolean(req.tools?.length);
    let healed = false;
    for (let heal = 0; ; heal++) {
      const stream = typeof req.onDelta === "function" && !q.noStream;
      const body = buildOpenAiBody(req, { stream, maxTokensField, quirks: q, echo });
      const res = await post(url, body, stream, req.signal);
      if (res.ok) return { out: await readChat(res, req, stream), healed };
      const errText = await res.text().catch(() => "");
      // OpenRouter answers a model without tool support with 404 "No endpoints found that support tool use"
      if (res.status === 404 && hasTools && NO_TOOLS_RE.test(errText)) throw noTools(req, res.status);
      if ((res.status !== 400 && res.status !== 422) || heal >= MAX_HEALS || CONTEXT_RE.test(errText)) {
        throw httpError(res.status, errText, res.headers, vendor);
      }
      const verdict = diagnose(refusalContext({ status: res.status, text: errText, sent: body, wire: "chat", hasTools, official }), q);
      if (verdict === "tools_unsupported") throw noTools(req, res.status);
      if (verdict.includes("openai.reasoning_tools_responses")) return "responses";
      if (verdict.length === 0 && !genericHeal(errText, body, q)) throw httpError(res.status, errText, res.headers, vendor);
      healed = true;
    }
  }

  /**
   * The Responses API with the same heal table. Returns null when the path
   * itself fails (an unknown 400, a 404 on this account...), so the caller
   * falls back to Chat Completions with reasoning turned down. Account and
   * transport failures (auth, rate limits, 5xx, network) are thrown as they
   * are: they say nothing about the path.
   */
  async function viaResponses(req: ChatRequest, q: WorkingQuirks): Promise<{ out: ChatOut; healed: boolean } | null> {
    const url = joinUrl(cfg.baseUrl, "/responses");
    await guard(url);
    let healed = false;
    for (let heal = 0; ; heal++) {
      const stream = typeof req.onDelta === "function" && !q.noStream;
      const body = buildResponsesBody(req, { stream, quirks: q });
      const res = await post(url, body, stream, req.signal);
      if (res.ok) return { out: await readResponses(res, req, stream), healed };
      const errText = await res.text().catch(() => "");
      if (!RESPONSES_FALLBACK.has(res.status) || CONTEXT_RE.test(errText)) throw httpError(res.status, errText, res.headers, vendor);
      if (res.status === 400 || res.status === 422) {
        const c = refusalContext({ status: res.status, text: errText, sent: body, wire: "responses", hasTools: true, official });
        const verdict = heal < MAX_HEALS ? diagnose(c, q) : [];
        if (verdict === "tools_unsupported") throw noTools(req, res.status);
        if (verdict.length > 0) {
          healed = true;
          continue;
        }
        // JSON mode refused on this path: dropped for the call, like response_format on Chat Completions
        if (heal < MAX_HEALS && "text" in body && !q.jsonOff && !JSON_WORD_RE.test(errText) && (refusesField(c, "text.format") || refusesField(c, "text"))) {
          q.jsonOff = true;
          continue;
        }
      }
      return null;
    }
  }

  return {
    id: cfg.id,
    protocol: "openai_chat",
    async chat(req: ChatRequest): Promise<ChatResult> {
      const started = now();
      const hasTools = Boolean(req.tools?.length);
      const q = cloneQuirks(store.get(req.model));
      if (hasTools && q.noTools) throw toolsUnsupportedError(vendor, req.model);
      let changed = false;
      for (;;) {
        if (hasTools && official && q.responses && !q.responsesFailed) {
          const r = await viaResponses(req, q);
          if (r) {
            if (changed || r.healed) store.set(req.model, q);
            return { ...r.out, latencyMs: now() - started, retries: 0 };
          }
          // the Responses path failed: Chat Completions with reasoning turned down, remembered once accepted
          q.responses = false;
          q.responsesFailed = true;
          q.reasoningEffort ??= "none";
          changed = true;
          continue;
        }
        const r = await viaChat(req, q);
        if (r === "responses") {
          changed = true;
          continue;
        }
        // remember only what the vendor then accepted; JSON mode never outlives the call
        if (r.healed || changed) store.set(req.model, q);
        return { ...r.out, latencyMs: now() - started, retries: 0 };
      }
    },
    async listModels(signal?: AbortSignal): Promise<ProviderModel[]> {
      const url = joinUrl(cfg.baseUrl, "/models");
      await guard(url);
      let res: Response;
      try {
        res = await doFetch(url, { headers: { accept: "application/json", ...authHeaders(cfg.apiKey), ...cfg.headers }, signal: withTimeout(signal, 15_000) });
      } catch (e) {
        throw transportError(e, signal, vendor);
      }
      if (!res.ok) throw httpError(res.status, await res.text().catch(() => ""), res.headers, vendor);
      const j = (await res.json().catch(() => ({}))) as Json;
      const list = (Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : []) as Json[];
      return list
        .map((m): ProviderModel | null => {
          const id = typeof m.id === "string" ? m.id : typeof m.name === "string" ? m.name : "";
          if (!id) return null;
          const ctx = n(m.context_length ?? m.context_window ?? m.max_context_length);
          const label = typeof m.name === "string" && m.name !== id ? m.name : undefined;
          return { id, ...(label ? { label } : {}), ...(ctx ? { contextWindow: ctx } : {}) };
        })
        .filter((m): m is ProviderModel => m !== null);
    },
  };
}
