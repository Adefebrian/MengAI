// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Known vendor refusals and their self-heals, shared by every chat adapter.
// A vendor that refuses one part of a request (temperature on a reasoning
// model, the system role, tool_choice, streaming for an unverified org...)
// gets the same request back with that one part changed, and the change is
// remembered per provider and model once the vendor accepts it. A model that
// cannot call tools at all ends the call with one plain sentence, because no
// cat can run on it. Anything not in this table stays a bad_request carrying
// the vendor text. The owner's reasoning effort per tier (ChatRequest.reasoning)
// goes through here too: effortFor picks what one request sends, and a model
// that refuses the value gets the nearest one it lists, or none at all.
// No imports from the adapters (they import this file).
import type { ReasoningEffort } from "@mengai/shared";
import { LlmError, type ChatRequest } from "../ports/llm";

type Json = Record<string, unknown>;

export type MaxTokensField = "max_tokens" | "max_completion_tokens";
/** Request fields a model can refuse outright; dropped from every later request. */
export type DroppableField = "temperature" | "top_p" | "prompt_cache_key" | "stream_options" | "tool_choice" | "parallel_tool_calls";
/** Reasoning effort that lets a model take tools on Chat Completions, lowest first; omit = do not send it. */
export type ReasoningEffortHeal = "none" | "minimal" | "low" | "omit";
/** An effort the owner can set (default sends nothing). */
export type OwnerEffort = Exclude<ReasoningEffort, "default">;
/** What a model accepts in place of an owner effort it refused; omit = leave the field out. */
export type EffortSwap = Partial<Record<OwnerEffort, string>>;
/** Anthropic thinking: min = the smallest budget, off = never sent, adaptive = the model sizes it. */
export type ThinkingQuirk = "min" | "off" | "adaptive";

/** What one provider has taught the adapter about one model. */
export interface ModelQuirks {
  drop: Set<DroppableField>;
  /** temperature pinned to 1: reasoning and thinking models accept only the default */
  temperatureOne?: boolean;
  maxTokensField?: MaxTokensField;
  /** where the system prompt goes when the model refuses the system role */
  system?: "developer" | "user";
  /** Chat Completions takes tools from this model only at this reasoning effort; omit = the field is refused outright */
  reasoningEffort?: ReasoningEffortHeal;
  /** owner efforts this model refused as values, and what it takes instead */
  effortSwap?: EffortSwap;
  /** Anthropic extended thinking, as this model taught it */
  thinking?: ThinkingQuirk;
  /** vendor state echoed back with tool calls (reasoning_content, thought signatures) is refused */
  noEcho?: boolean;
  /** OpenAI official host: tool calls go through the Responses API, reasoning stays on */
  responses?: boolean;
  /** the Responses path failed for this model once: never tried again */
  responsesFailed?: boolean;
  /** streaming refused (an unverified organization, for example): one answer, emitted whole */
  noStream?: boolean;
  /** the conversation must end on a user turn (no assistant prefill) */
  userLast?: boolean;
  /** the model cannot call tools at all */
  noTools?: boolean;
}

/** Quirks for the call in flight: the sticky part plus heals that never outlive one call. */
export interface WorkingQuirks extends ModelQuirks {
  /** JSON mode refused for this call; asked for again next time */
  jsonOff?: boolean;
  /** the max-tokens field was renamed during this call (renamed once, never removed) */
  fieldSwapped?: boolean;
  /** thinking off for this call: the tool turn it continues has no thinking block to send back */
  thinkingOff?: boolean;
}

export function emptyQuirks(): ModelQuirks {
  return { drop: new Set() };
}

export function cloneQuirks(q: ModelQuirks | undefined): WorkingQuirks {
  const base = q ?? emptyQuirks();
  return { ...base, drop: new Set(base.drop), ...(base.effortSwap ? { effortSwap: { ...base.effortSwap } } : {}) };
}

/** The sticky part of a working copy: per-call heals (JSON mode, thinking off for one turn) are never remembered. */
export function stickyQuirks(q: WorkingQuirks): ModelQuirks {
  const { jsonOff: _json, fieldSwapped: _swapped, thinkingOff: _thinking, ...rest } = q;
  return { ...rest, drop: new Set(q.drop), ...(q.effortSwap ? { effortSwap: { ...q.effortSwap } } : {}) };
}

// ------------------------------------------------------------ reasoning effort

/** Effort values in cost order, for picking the nearest one a vendor lists. */
const EFFORT_RANK = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

/** The owner's effort for this request, or null when it is missing or default. */
export function ownerEffort(req: Pick<ChatRequest, "reasoning">): OwnerEffort | null {
  const r = req.reasoning;
  return r && r !== "default" ? r : null;
}

/**
 * The reasoning effort one request sends, or null for none. A model that
 * refused the field sends nothing ever again. On Chat Completions a tool call
 * uses the effort the tool heal found (reasoning models that take tools only
 * at a low effort); otherwise the owner's effort, swapped for what this model
 * accepts when it refused the value. The Responses path keeps reasoning on,
 * so the tool heal never applies there.
 */
export function effortFor(req: ChatRequest, q: ModelQuirks, wire: "chat" | "responses"): string | null {
  if (q.reasoningEffort === "omit") return null;
  if (wire === "chat" && req.tools?.length && q.reasoningEffort) return q.reasoningEffort;
  const owner = ownerEffort(req);
  if (!owner) return null;
  const sent = q.effortSwap?.[owner] ?? owner;
  return sent === "omit" ? null : sent;
}

/** Anthropic thinking budget per owner effort, before the output cap shrinks it. */
export const THINKING_BUDGET: Record<Exclude<OwnerEffort, "none">, number> = { low: 2048, medium: 8192, high: 24576 };
/** The smallest budget Anthropic accepts. */
export const MIN_THINKING_BUDGET = 1024;

/**
 * The thinking block for one Anthropic request, or null for none. none and
 * default send nothing; low, medium and high get a budget that leaves the
 * answer at least a quarter of the output cap (and 1024 tokens), because the
 * vendor counts thinking inside max_tokens and refuses a budget at or above
 * it. A cap too small for the minimum budget means no thinking for the call.
 */
export function thinkingFor(req: ChatRequest, maxTokens: number, q: WorkingQuirks): Json | null {
  const owner = ownerEffort(req);
  if (!owner || owner === "none" || q.thinking === "off" || q.thinkingOff) return null;
  if (q.thinking === "adaptive") return { type: "adaptive" };
  const room = maxTokens - Math.max(MIN_THINKING_BUDGET, Math.floor(maxTokens / 4));
  const budget = q.thinking === "min" ? MIN_THINKING_BUDGET : Math.min(THINKING_BUDGET[owner], room);
  if (budget < MIN_THINKING_BUDGET || budget >= maxTokens) return null;
  return { type: "enabled", budget_tokens: budget };
}

// ------------------------------------------------------------ echo store

/**
 * Vendor state a model needs back with its own tool calls, keyed by tool
 * call id: Anthropic thinking blocks (a tool turn must start with the thinking
 * that led to it while thinking is on), DeepSeek and Kimi reasoning_content,
 * OpenRouter reasoning_details and Gemini thought signatures. The port's
 * messages carry only text and tool calls, so each adapter keeps what it saw
 * here and puts it back when the same tool call id comes around. Bounded;
 * a lost entry only means the heal path (thinking off for that turn).
 */
export interface EchoStore {
  get(callId: string): Json | undefined;
  set(callId: string, value: Json): void;
}

export function createEchoStore(limit = 512): EchoStore {
  const map = new Map<string, Json>();
  return {
    get: (id) => map.get(id),
    set(id, value) {
      if (!id) return;
      map.delete(id);
      map.set(id, value);
      while (map.size > limit) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
  };
}

/**
 * Per provider memory of model quirks. The providers module keeps one store
 * per provider row and hands it to every adapter it builds for that row, so
 * what the connection test learns is what the crew's calls start from; the
 * store is dropped when the row changes (new URL or key, maybe a new vendor).
 */
export interface QuirkStore {
  get(model: string): ModelQuirks | undefined;
  set(model: string, quirks: ModelQuirks): void;
  clear(): void;
}

export function createQuirkStore(limit = 256): QuirkStore {
  const map = new Map<string, ModelQuirks>();
  return {
    get: (model) => map.get(model),
    set(model, quirks) {
      map.delete(model);
      map.set(model, stickyQuirks(quirks));
      while (map.size > limit) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
    clear: () => map.clear(),
  };
}

// ------------------------------------------------------------ refusal context

export type Wire = "chat" | "responses" | "anthropic";

export interface RefusalContext {
  status: number;
  /** vendor body, first 4000 characters */
  text: string;
  /** structured error.param and error.code when the vendor sent them */
  param: string;
  code: string;
  /** the request body the vendor refused */
  sent: Json;
  wire: Wire;
  hasTools: boolean;
  /** base URL is api.openai.com */
  official: boolean;
}

function structured(text: string): { param: string; code: string } {
  try {
    const j = JSON.parse(text) as unknown;
    const root = (Array.isArray(j) ? j[0] : j) as Json | null;
    const e = (root && typeof root === "object" && "error" in root ? root.error : root) as Json | null;
    if (!e || typeof e !== "object") return { param: "", code: "" };
    const param = typeof e.param === "string" ? e.param : "";
    const code = e.code === undefined || e.code === null ? String(e.type ?? "") : String(e.code);
    return { param, code };
  } catch {
    return { param: "", code: "" };
  }
}

export function refusalContext(input: { status: number; text: string; sent: Json; wire: Wire; hasTools: boolean; official: boolean }): RefusalContext {
  const text = input.text.slice(0, 4000);
  return { ...input, text, ...structured(text) };
}

// ------------------------------------------------------------ patterns

/** The vendor says a field is not accepted at all (not that its value is wrong). */
export const UNSUPPORTED_RE = /unsupported|unrecognized|unknown|not supported|not permitted|extra inputs/i;
/** JSON mode needs the prompt to mention json: a prompt problem, never a field to drop. */
export const JSON_WORD_RE = /\bword\s+\\?['"`]?json\b/i;
/** Text after these words lists what the vendor accepts or suggests instead, not what it rejected. */
export const ALTERNATIVES_RE = /\b(?:expected|one of|instead|use|allowed|valid|supported (?:fields|parameters|values|arguments) are)\b/i;
/** A vendor refusing tools because reasoning is on for this model. */
export const REASONING_TOOLS_RE = /reasoning_effort[\s\S]*(function )?tools|tools[\s\S]*reasoning_effort/i;
/** A model that cannot call tools at all, in the words of Ollama, OpenRouter, Gemini, Mistral, vLLM, DeepSeek and others. */
export const NO_TOOLS_RE =
  /does not support (?:function[ _-]?calling|tools\b|tool[ _-]?(?:use|calling|calls)\b)|\b(?:function[ _-]?calling|tool[ _-]?(?:use|calling)|tools)\b (?:is |are )?not (?:supported|enabled|available)|no endpoints found that support tool use|tool choice requires --enable-auto-tool-choice|model (?:cannot|can't|can not) (?:use|call) tools/i;
const ONLY_ONE_RE =
  /only (?:the default \(1(?:\.0)?\) value|1(?:\.0)?) (?:value )?(?:is )?(?:allowed|supported)|may only be set to 1(?:\.0)?\b|must be (?:set to |exactly |equal to )?1(?:\.0)?(?![\d.]| *(?:and|or|to|-))|only supports? (?:a )?temperature (?:of )?1(?:\.0)?\b/i;
const FIELD_REFUSED_RE = /unsupported|unrecognized|unknown|not supported|not permitted|not allowed|extra inputs|deprecated|does not support/i;

/** Sentences of the body, each cut before any "expected one of" or "use X instead" tail. */
function clauses(text: string): string[] {
  return text.split(/[.;!?](?:\s|$)|\n/).map((raw) => raw.split(ALTERNATIVES_RE)[0] ?? "");
}

function wordRe(field: string): RegExp {
  return new RegExp(`\\b${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
}

/** True when the vendor refuses `field` itself: a structured param first, else one clause naming it with a refusal phrase. */
export function refusesField(c: RefusalContext, field: string, phrase: RegExp = FIELD_REFUSED_RE): boolean {
  if (c.param) {
    if (c.param !== field) return false;
    return phrase.test(`${c.code} ${c.text}`);
  }
  const re = wordRe(field);
  return clauses(c.text).some((cl) => re.test(cl) && phrase.test(cl));
}

function paramIs(c: RefusalContext, ...fields: string[]): boolean {
  return !c.param || fields.some((f) => c.param === f || c.param.startsWith(`${f}.`) || c.param.startsWith(`${f}[`));
}

/** The reasoning effort the refused request carried (reasoning_effort, or reasoning.effort on the Responses API). */
function sentEffort(c: RefusalContext): string | undefined {
  const flat = c.sent.reasoning_effort;
  if (typeof flat === "string") return flat;
  const nested = c.sent.reasoning;
  return nested && typeof nested === "object" && typeof (nested as Json).effort === "string" ? String((nested as Json).effort) : undefined;
}

/** A model that cannot turn reasoning off (Gemini's thinking-only models, for example). */
const THINKING_ONLY_RE = /only works in thinking mode|(?:thinking|reasoning) (?:cannot|can't|can not) be (?:disabled|turned off)|does not support (?:disabling|turning off) (?:thinking|reasoning)/i;
const EFFORT_NAME_RE = /reasoning[_. ]?effort|reasoningEffort/i;
const EFFORT_VALUE_RE =
  /does not support ['"`]?(?:none|minimal|low|medium|high|xhigh)\b|unsupported value|invalid value|not a valid|must be one of|supported values|input should be|invalid reasoning effort|expected one of/i;

/** Effort values the vendor lists as accepted, read only after a list marker (the refused value comes before it). */
function listedEfforts(text: string): string[] {
  const tail = text.split(/supported values|must be one of|one of|expected|input should be|valid values|supported:/i).slice(1).join(" ");
  return EFFORT_RANK.filter((e) => new RegExp(`['"\`]?\\b${e}\\b['"\`]?`, "i").test(tail));
}

/** The listed value nearest to the refused one, ties to the cheaper side, so cost never grows silently. */
function nearestEffort(refused: string, listed: string[]): string | undefined {
  const at = (EFFORT_RANK as readonly string[]).indexOf(refused);
  if (at < 0) return undefined;
  let best: string | undefined;
  let gap = Infinity;
  for (const e of listed) {
    const d = Math.abs((EFFORT_RANK as readonly string[]).indexOf(e) - at);
    if (e !== refused && d < gap) {
      best = e;
      gap = d;
    }
  }
  return best;
}

/** The owner effort whose request sent `sent`: the one already swapped to it, else `sent` itself. */
function ownerOf(q: WorkingQuirks, sent: string): OwnerEffort {
  for (const [k, v] of Object.entries(q.effortSwap ?? {})) if (v === sent) return k as OwnerEffort;
  return sent as OwnerEffort;
}

const ECHO_FIELDS = ["reasoning_content", "reasoning_details", "extra_content"] as const;

function echoSent(sent: Json): boolean {
  const msgs = Array.isArray(sent.messages) ? (sent.messages as Json[]) : [];
  return msgs.some((m) => ECHO_FIELDS.some((f) => f in m) || (Array.isArray(m.tool_calls) && (m.tool_calls as Json[]).some((tc) => "extra_content" in tc)));
}

// ------------------------------------------------------------ the table

export type HealOutcome = boolean | "tools_unsupported";

export interface Refusal {
  id: string;
  /** a real vendor message this rule answers (tests replay every one) */
  example: string;
  /** which wires the rule applies to */
  wires: readonly Wire[];
  /** changes the working quirks; false when it does not apply or changes nothing (loop guard) */
  apply(c: RefusalContext, q: WorkingQuirks): HealOutcome;
}

const EFFORT_ORDER: ReasoningEffortHeal[] = ["none", "minimal", "low", "omit"];

function nextEffort(c: RefusalContext, current: ReasoningEffortHeal): ReasoningEffortHeal {
  const at = EFFORT_ORDER.indexOf(current);
  const tail = c.text.split(/supported values|must be one of|one of|expected|input should be|valid values/i).slice(1).join(" ");
  for (const e of EFFORT_ORDER.slice(at + 1)) {
    if (e === "omit") break;
    if (tail && new RegExp(`['"\`]?\\b${e}\\b['"\`]?`, "i").test(tail)) return e;
  }
  // no list, or nothing lower than what was refused: try the next step, then leave the field out
  return tail ? "omit" : (EFFORT_ORDER[at + 1] ?? "omit");
}

export const KNOWN_REFUSALS: readonly Refusal[] = [
  {
    id: "openai.reasoning_tools_responses",
    example:
      "Function tools with reasoning_effort are not supported for gpt-6-luna in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
    wires: ["chat"],
    apply(c, q) {
      if (!c.hasTools || !c.official || q.responses || q.responsesFailed) return false;
      if (!REASONING_TOOLS_RE.test(c.text) || !/\/responses\b/.test(c.text)) return false;
      q.responses = true;
      return true;
    },
  },
  {
    id: "reasoning_tools_effort_none",
    example: "Function tools with reasoning_effort are not supported for gpt-6-luna in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
    wires: ["chat"],
    apply(c, q) {
      if (!c.hasTools || !REASONING_TOOLS_RE.test(c.text) || !paramIs(c, "reasoning_effort", "tools")) return false;
      if (q.reasoningEffort === undefined) {
        q.reasoningEffort = "none";
        return true;
      }
      // it refuses tools while reasoning and refuses the field that turns reasoning down
      return q.reasoningEffort === "omit" ? "tools_unsupported" : false;
    },
  },
  {
    id: "reasoning_effort_value",
    example: "Unsupported value: 'reasoning_effort' does not support 'none' with this model. Supported values are: 'minimal', 'low', 'medium', and 'high'.",
    wires: ["chat"],
    apply(c, q) {
      // the tool heal's own value only; an owner effort refused as a value is the next rule
      if (!c.hasTools || !q.reasoningEffort || q.reasoningEffort === "omit" || c.sent.reasoning_effort !== q.reasoningEffort) return false;
      if (!paramIs(c, "reasoning_effort") || !/reasoning_effort/i.test(c.text)) return false;
      if (!/does not support ['"`]?(?:none|minimal|low)\b|unsupported value|invalid value|not a valid|must be one of|supported values|input should be/i.test(c.text)) return false;
      q.reasoningEffort = nextEffort(c, q.reasoningEffort);
      return true;
    },
  },
  {
    id: "reasoning_effort_owner_value",
    example: "Unsupported value: 'reasoning.effort' does not support 'none' with this model. Supported values are: 'minimal', 'low', 'medium', and 'high'.",
    wires: ["chat", "responses"],
    apply(c, q) {
      const sent = sentEffort(c);
      if (!sent || (c.wire === "chat" && c.hasTools && q.reasoningEffort && sent === q.reasoningEffort)) return false;
      const thinkingOnly = sent === "none" && THINKING_ONLY_RE.test(c.text);
      if (!thinkingOnly && (!paramIs(c, "reasoning_effort", "reasoning", "reasoningEffort") || !EFFORT_NAME_RE.test(c.text) || !EFFORT_VALUE_RE.test(c.text))) return false;
      const listed = listedEfforts(c.text);
      // a model that cannot stop reasoning and lists nothing: the lowest effort every vendor names
      const next = thinkingOnly && listed.length === 0 ? "low" : nearestEffort(sent, listed);
      const owner = ownerOf(q, sent);
      const value = next && next !== sent ? next : "omit";
      if (q.effortSwap?.[owner] === value) return false;
      q.effortSwap = { ...q.effortSwap, [owner]: value };
      return true;
    },
  },
  {
    id: "reasoning_effort_unsupported",
    example: "Unrecognized request argument supplied: reasoning_effort",
    wires: ["chat", "responses"],
    apply(c, q) {
      if (sentEffort(c) === undefined || q.reasoningEffort === "omit") return false;
      const refused =
        refusesField(c, "reasoning_effort") ||
        refusesField(c, "reasoningEffort") ||
        refusesField(c, "reasoning.effort") ||
        (c.param === "reasoning" && UNSUPPORTED_RE.test(`${c.code} ${c.text}`));
      if (!refused) return false;
      q.reasoningEffort = "omit";
      return true;
    },
  },
  {
    id: "stream_refused",
    example:
      "Your organization must be verified to stream this model. Please go to: https://platform.openai.com/settings/organization/general and click on Verify Organization. If you just verified, it can take up to 15 minutes for access to propagate.",
    wires: ["chat", "responses", "anthropic"],
    apply(c, q) {
      if (c.sent.stream !== true || q.noStream || !paramIs(c, "stream")) return false;
      const said =
        /must be verified to stream|does not support stream(?:ing)?\b|stream(?:ing)? (?:is |mode is )?not (?:supported|available|allowed)/i.test(c.text) ||
        (c.param === "stream" && UNSUPPORTED_RE.test(`${c.code} ${c.text}`));
      if (!said) return false;
      q.noStream = true;
      return true;
    },
  },
  {
    id: "tools_unsupported",
    example: "registry.ollama.ai/library/gemma2:latest does not support tools",
    wires: ["chat", "responses", "anthropic"],
    apply(c) {
      if (!c.hasTools || !paramIs(c, "tools", "tool_choice")) return false;
      if (NO_TOOLS_RE.test(c.text)) return "tools_unsupported";
      return c.param === "tools" && UNSUPPORTED_RE.test(`${c.code} ${c.text}`) ? "tools_unsupported" : false;
    },
  },
  {
    id: "system_role",
    example: "Unsupported value: 'messages[0].role' does not support 'system' with this model.",
    wires: ["chat"],
    apply(c, q) {
      if (!paramIs(c, "messages")) return false;
      const msgs = Array.isArray(c.sent.messages) ? (c.sent.messages as Json[]) : [];
      const lead = msgs[0]?.role;
      if (lead !== "system" && lead !== "developer") return false;
      const devRefused = /does not support ['"`]?developer\b|developer (?:instruction|role|message)s? (?:is |are )?not (?:enabled|supported|allowed)/i.test(c.text);
      const sysRefused =
        /does not support ['"`]?system\b|\bsystem (?:role|message|prompt|instruction)s? (?:is |are )?not (?:supported|enabled|allowed)|role ['"`]?system['"`]? is not supported|system_instruction is not (?:supported|enabled)/i.test(c.text);
      if (devRefused && q.system !== "user") {
        q.system = "user";
        return true;
      }
      if (!sysRefused) return false;
      if (q.system === undefined) {
        q.system = c.official ? "developer" : "user";
        return true;
      }
      if (q.system === "developer") {
        q.system = "user";
        return true;
      }
      return false;
    },
  },
  {
    id: "temperature_one",
    example: "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.",
    wires: ["chat", "responses", "anthropic"],
    apply(c, q) {
      if (!("temperature" in c.sent) || c.sent.temperature === 1 || q.temperatureOne || !paramIs(c, "temperature")) return false;
      if (!/temperature/i.test(c.text) || !ONLY_ONE_RE.test(c.text)) return false;
      q.temperatureOne = true;
      q.drop.delete("temperature");
      return true;
    },
  },
  {
    id: "temperature_unsupported",
    example: "Unsupported parameter: 'temperature' is not supported with this model.",
    wires: ["chat", "responses", "anthropic"],
    apply(c, q) {
      if (!("temperature" in c.sent) || q.drop.has("temperature") || !refusesField(c, "temperature")) return false;
      q.drop.add("temperature");
      q.temperatureOne = false;
      return true;
    },
  },
  {
    id: "top_p",
    example: "`temperature` and `top_p` cannot both be specified for this model. Please use only one.",
    wires: ["chat", "responses", "anthropic"],
    apply(c, q) {
      if (!("top_p" in c.sent) || q.drop.has("top_p")) return false;
      const both = /\btop_p\b[\s\S]{0,80}(?:cannot both be|or unset|must be unset)|cannot both be specified[\s\S]{0,40}\btop_p\b/i.test(c.text) && paramIs(c, "top_p", "temperature");
      if (!both && !refusesField(c, "top_p")) return false;
      q.drop.add("top_p");
      return true;
    },
  },
  {
    id: "tool_choice",
    example: "Thinking may not be enabled when tool_choice forces tool use.",
    wires: ["chat", "responses", "anthropic"],
    apply(c, q) {
      if (!("tool_choice" in c.sent) || q.drop.has("tool_choice")) return false;
      const forced = /may not be enabled when tool_choice forces tool use|tool_choice[\s\S]{0,40}\b(?:required|any)\b[\s\S]{0,40}not supported/i.test(c.text) && paramIs(c, "tool_choice");
      if (!forced && !refusesField(c, "tool_choice")) return false;
      q.drop.add("tool_choice");
      return true;
    },
  },
  {
    id: "parallel_tool_calls",
    example: "Unsupported parameter: 'parallel_tool_calls' is not supported with this model.",
    wires: ["chat", "responses"],
    apply(c, q) {
      if (!("parallel_tool_calls" in c.sent) || q.drop.has("parallel_tool_calls") || !refusesField(c, "parallel_tool_calls")) return false;
      q.drop.add("parallel_tool_calls");
      return true;
    },
  },
  {
    id: "echo_refused",
    example: "Invalid request: messages[1]: Extra inputs are not permitted, field: 'reasoning_content'",
    wires: ["chat"],
    apply(c, q) {
      if (q.noEcho || !echoSent(c.sent) || !paramIs(c, "messages")) return false;
      if (!/reasoning_content|reasoning_details|extra_content|thought_signature/i.test(c.text) || !FIELD_REFUSED_RE.test(c.text)) return false;
      q.noEcho = true;
      return true;
    },
  },
  {
    id: "anthropic.thinking_block_missing",
    example:
      "messages.1.content.0.type: Expected `thinking` or `redacted_thinking`, but found `tool_use`. When `thinking` is enabled, a final `assistant` message must start with a thinking block (preceeding the lastmost set of `tool_use` and `tool_result` blocks). We recommend you include thinking blocks from previous turns. To avoid this requirement, disable `thinking`.",
    wires: ["anthropic"],
    apply(c, q) {
      if (!c.sent.thinking || q.thinkingOff) return false;
      if (!/expected [`'"]?thinking[`'"]? or [`'"]?redacted_thinking|must start with a thinking block/i.test(c.text)) return false;
      // this turn only: the next tool loop starts with thinking again
      q.thinkingOff = true;
      return true;
    },
  },
  {
    id: "anthropic.thinking_budget",
    example: "`max_tokens` must be greater than `thinking.budget_tokens`. Please consult our documentation at https://docs.claude.com/en/docs/build-with-claude/extended-thinking#max-tokens-and-context-window-size",
    wires: ["anthropic"],
    apply(c, q) {
      const t = c.sent.thinking as Json | undefined;
      if (!t || t.type !== "enabled" || q.thinking === "off") return false;
      if (!/max_tokens`?\s+must be greater than\s+`?(?:thinking\.)?budget_tokens|budget_tokens`?[\s\S]{0,40}(?:less|smaller|lower) than[\s\S]{0,20}max_tokens/i.test(c.text)) return false;
      q.thinking = q.thinking === "min" ? "off" : "min";
      return true;
    },
  },
  {
    id: "anthropic.thinking_adaptive",
    example: "thinking.type.enabled is not supported for this model. Use thinking.type.adaptive instead.",
    wires: ["anthropic"],
    apply(c, q) {
      const t = c.sent.thinking as Json | undefined;
      if (!t || t.type !== "enabled" || q.thinking === "adaptive" || q.thinking === "off") return false;
      if (!/adaptive/i.test(c.text) || !/thinking\.type\.enabled|type ['"`]?enabled['"`]?|budget_tokens/i.test(c.text) || !/not supported|deprecated|no longer|use /i.test(c.text)) return false;
      q.thinking = "adaptive";
      return true;
    },
  },
  {
    id: "anthropic.thinking_unsupported",
    example: "claude-3-5-haiku-20241022 does not support thinking.",
    wires: ["anthropic"],
    apply(c, q) {
      if (!c.sent.thinking || q.thinking === "off") return false;
      if (!/does not support (?:extended )?thinking|thinking is not (?:supported|available|enabled) (?:for|on|with)/i.test(c.text) && !refusesField(c, "thinking")) return false;
      q.thinking = "off";
      return true;
    },
  },
  {
    id: "assistant_prefill",
    example: "This model does not support assistant message prefill. The conversation must end with a user message.",
    wires: ["anthropic"],
    apply(c, q) {
      if (q.userLast) return false;
      if (!/does not support assistant message prefill|must end with a user (?:message|turn)|final message must be (?:a|from the) user/i.test(c.text)) return false;
      q.userLast = true;
      return true;
    },
  },
];

/**
 * Runs the table over one refusal, most specific rule first, and applies the
 * first one that changes something: one precise heal per retry, so a broader
 * rule never undoes a narrower one (temperature pinned to 1, then dropped).
 * Returns that rule's id, "tools_unsupported" when the model cannot call
 * tools, or an empty list when nothing known applies. A JSON-word error is a
 * prompt problem and never matches anything.
 */
export function diagnose(c: RefusalContext, q: WorkingQuirks): string[] | "tools_unsupported" {
  if (JSON_WORD_RE.test(c.text)) return [];
  for (const rule of KNOWN_REFUSALS) {
    if (!rule.wires.includes(c.wire)) continue;
    const out = rule.apply(c, q);
    if (out === "tools_unsupported") {
      q.noTools = true;
      return out;
    }
    if (out) return [rule.id];
  }
  return [];
}

export const TOOLS_ADVICE = "pick another model for the crew";
/** The connection test's verdict for a model that answers but cannot call tools. */
export const TOOLS_PROBE_FAIL = `Answered, but this model cannot call tools; ${TOOLS_ADVICE}`;

/** The plain sentence a run fails with when its model cannot call tools. */
export function toolsUnsupportedError(vendor: string, model: string, status: number | null = null): LlmError {
  return new LlmError("bad_request", `${vendor}: ${model} cannot call tools; ${TOOLS_ADVICE}`, status, null, "tools_unsupported");
}
