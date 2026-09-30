// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// OpenAI Responses API wire (POST /v1/responses), used on the official host
// for models that refuse function tools on Chat Completions while reasoning
// is on. Reasoning stays on here. This file only translates: the port's
// messages, tools, tool calls and tool results to input items, and output
// items, stream events and usage back. Stateless (store false): the whole
// conversation is sent each turn, like Chat Completions. The adapter in
// llm-openai.ts owns transport, heals and the fallback.
import type { ChatMessage, ChatRequest, ChatResult, ContentPart, ToolCall } from "../ports/llm";
import { effortFor, type WorkingQuirks } from "./llm-quirks";

type Json = Record<string, unknown>;

function textOf(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content.map((p) => (p.type === "text" ? p.text : "[image omitted]")).join("\n");
}

/** The port's turns as Responses input items (EasyInputMessage, function_call, function_call_output). */
export function toResponsesInput(messages: ChatMessage[]): Json[] {
  const out: Json[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ type: "function_call_output", call_id: m.toolCallId ?? "", output: textOf(m.content) });
    } else if (m.role === "assistant") {
      const text = textOf(m.content);
      if (text) out.push({ role: "assistant", content: text });
      for (const tc of m.toolCalls ?? []) {
        out.push({ type: "function_call", call_id: tc.id, name: tc.name, arguments: tc.arguments || "{}" });
      }
    } else if (typeof m.content === "string") {
      out.push({ role: "user", content: m.content });
    } else {
      out.push({
        role: "user",
        content: m.content.map((p) =>
          p.type === "text" ? { type: "input_text", text: p.text } : { type: "input_image", image_url: `data:${p.mime};base64,${p.dataBase64}` },
        ),
      });
    }
  }
  return out;
}

/**
 * Builds the Responses body. The output cap is always sent (max_output_tokens);
 * strict is off so any JSON Schema is accepted; the owner's effort for the
 * tier is reasoning.effort (default sends nothing: the model decides).
 */
export function buildResponsesBody(req: ChatRequest, opts: { stream: boolean; quirks: WorkingQuirks }): Json {
  const q = opts.quirks;
  const body: Json = { model: req.model, input: toResponsesInput(req.messages), store: false };
  if (req.system) body.instructions = req.system;
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false }));
    if (req.toolChoice && !q.drop.has("tool_choice")) body.tool_choice = req.toolChoice;
    if (req.parallelToolCalls !== undefined && !q.drop.has("parallel_tool_calls")) body.parallel_tool_calls = req.parallelToolCalls;
  }
  if (req.maxOutputTokens !== undefined) body.max_output_tokens = req.maxOutputTokens;
  const effort = effortFor(req, q, "responses");
  if (effort) body.reasoning = { effort };
  if (req.temperature !== undefined) {
    if (q.temperatureOne) body.temperature = 1;
    else if (!q.drop.has("temperature")) body.temperature = req.temperature;
  }
  if (req.topP !== undefined && !q.drop.has("top_p")) body.top_p = req.topP;
  if (req.responseFormat === "json" && !q.jsonOff) body.text = { format: { type: "json_object" } };
  if (req.cacheKey && !q.drop.has("prompt_cache_key")) body.prompt_cache_key = req.cacheKey;
  if (opts.stream) body.stream = true;
  return body;
}

export interface ResponsesOutcome {
  text: string;
  toolCalls: ToolCall[];
  stopReason: ChatResult["stopReason"];
  /** raw usage object; the adapter normalizes it (input_tokens_details.cached_tokens) */
  usage: unknown;
  model: string;
}

function stopOf(status: unknown, incomplete: unknown, toolCalls: number): ChatResult["stopReason"] {
  if (toolCalls > 0) return "tool_use";
  const reason = incomplete && typeof incomplete === "object" ? (incomplete as Json).reason : null;
  if (status === "incomplete" && reason === "content_filter") return "filter";
  if (status === "incomplete") return "length";
  return "end";
}

function messageText(item: Json): string {
  const parts = Array.isArray(item.content) ? (item.content as Json[]) : [];
  return parts.map((p) => (p && p.type === "output_text" && typeof p.text === "string" ? p.text : "")).join("");
}

function callOf(item: Json, i: number): ToolCall {
  const args = item.arguments;
  return {
    id: typeof item.call_id === "string" && item.call_id ? item.call_id : typeof item.id === "string" && item.id ? item.id : `call_${i}`,
    name: String(item.name ?? ""),
    arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
  };
}

/** Reads a non-streamed response object. */
export function parseResponsesResult(j: Json, fallbackModel: string): ResponsesOutcome {
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const item of (Array.isArray(j.output) ? j.output : []) as Json[]) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "message") text += messageText(item);
    else if (item.type === "function_call") toolCalls.push(callOf(item, toolCalls.length));
  }
  return {
    text,
    toolCalls,
    stopReason: stopOf(j.status, j.incomplete_details, toolCalls.length),
    usage: j.usage,
    model: typeof j.model === "string" && j.model ? j.model : fallbackModel,
  };
}

/** HTTP-like status for an error carried inside a stream or a 200 body, so the shared error mapping applies. */
export function responsesErrorStatus(code: string, message: string): number {
  const hay = `${code} ${message}`;
  if (/rate_limit/i.test(hay)) return 429;
  if (/overloaded|slow_down/i.test(hay)) return 529;
  if (/context_length|context_window|too_long|too many tokens/i.test(hay)) return 400;
  if (/invalid_api_key|authentication|permission/i.test(code)) return 401;
  if (/invalid|unsupported|bad_request|not_found|model_not_found/i.test(code)) return 400;
  return 500;
}

export type StreamStep = { error: { status: number; body: string } } | "done" | null;

/**
 * Folds Responses stream events into one outcome: text deltas (forwarded to
 * onDelta as they arrive), function calls by item id (arguments deltas, then
 * the done event is authoritative), usage and status from the final event.
 */
export function createResponsesStream(fallbackModel: string, onDelta?: (text: string) => void) {
  let text = "";
  let model = fallbackModel;
  let usage: unknown = null;
  let status: unknown = null;
  let incomplete: unknown = null;
  const calls = new Map<string, { order: number; item: Json; args: string }>();
  const call = (id: string, order: number) => {
    let c = calls.get(id);
    if (!c) {
      c = { order, item: {}, args: "" };
      calls.set(id, c);
    }
    return c;
  };
  const finish = (r: Json) => {
    if (typeof r.model === "string" && r.model) model = r.model;
    if (r.usage) usage = r.usage;
    status = r.status ?? status;
    incomplete = r.incomplete_details ?? incomplete;
    // the final object repeats every output item: it fills in anything the deltas missed
    let order = calls.size;
    for (const item of (Array.isArray(r.output) ? r.output : []) as Json[]) {
      if (item?.type !== "function_call") continue;
      const id = String(item.id ?? item.call_id ?? `item_${order}`);
      const c = call(id, order++);
      c.item = { ...c.item, ...item };
      if (typeof item.arguments === "string" && item.arguments) c.args = item.arguments;
    }
  };
  return {
    push(type: string, j: Json): StreamStep {
      switch (type) {
        case "response.created":
        case "response.in_progress": {
          const r = (j.response ?? {}) as Json;
          if (typeof r.model === "string" && r.model) model = r.model;
          return null;
        }
        case "response.output_text.delta":
          if (typeof j.delta === "string" && j.delta) {
            text += j.delta;
            onDelta?.(j.delta);
          }
          return null;
        case "response.output_item.added":
        case "response.output_item.done": {
          const item = (j.item ?? {}) as Json;
          if (item.type !== "function_call") return null;
          const c = call(String(item.id ?? item.call_id ?? `item_${Number(j.output_index ?? calls.size)}`), Number(j.output_index ?? calls.size));
          c.item = { ...c.item, ...item };
          if (typeof item.arguments === "string" && (item.arguments || type === "response.output_item.done")) c.args = item.arguments || c.args;
          return null;
        }
        case "response.function_call_arguments.delta": {
          if (typeof j.delta === "string") call(String(j.item_id ?? ""), Number(j.output_index ?? calls.size)).args += j.delta;
          return null;
        }
        case "response.function_call_arguments.done": {
          if (typeof j.arguments === "string") call(String(j.item_id ?? ""), Number(j.output_index ?? calls.size)).args = j.arguments;
          return null;
        }
        case "response.completed":
        case "response.incomplete":
          finish((j.response ?? {}) as Json);
          return "done";
        case "response.failed": {
          const r = (j.response ?? {}) as Json;
          const e = (r.error ?? {}) as Json;
          const body = JSON.stringify({ error: { message: String(e.message ?? "response failed"), code: e.code ?? null } });
          return { error: { status: responsesErrorStatus(String(e.code ?? ""), String(e.message ?? "")), body } };
        }
        case "error": {
          const e = (j.error && typeof j.error === "object" ? j.error : j) as Json;
          const body = JSON.stringify({ error: { message: String(e.message ?? "stream error"), code: e.code ?? null, param: e.param ?? null } });
          return { error: { status: responsesErrorStatus(String(e.code ?? ""), String(e.message ?? "")), body } };
        }
        default:
          return null;
      }
    },
    result(): ResponsesOutcome {
      const toolCalls = [...calls.values()]
        .filter((c) => c.item.type === "function_call" || c.item.name)
        .sort((a, b) => a.order - b.order)
        .map((c, i) => callOf({ ...c.item, arguments: c.args || (typeof c.item.arguments === "string" ? c.item.arguments : "") || "{}" }, i));
      return { text, toolCalls, stopReason: stopOf(status, incomplete, toolCalls.length), usage, model };
    },
  };
}
