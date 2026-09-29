// Prompt metering shared by the eval replay and the ScriptedProvider.
// One counting rule for every policy: the same estimator over the same
// serialized pieces (system, tool schemas, messages), plus a fixed per-message
// overhead. The simulated vendor prefix cache counts a prefix as cached when it
// is byte-identical to a prefix of the previous call with the same cache key
// and at least 1,024 tokens. Two models of where a prefix may end:
//   breakpoints: only at declared cache breakpoints (system+tools when
//                cacheSystem, then messages flagged cacheBreakpoint); this is the
//                Anthropic cache_control behavior and the conservative default.
//   prefix:      at any message boundary, rounded down to 128-token blocks; this
//                is OpenAI's automatic prompt caching (gpt-4o-mini, the default).
import { DEFAULT_CHAT_MODEL, priceFor } from "@mengai/shared";
import type { ChatMessage, ToolSpec } from "../../core/ports/llm";

export type Estimator = (text: string) => number;

export const MESSAGE_OVERHEAD = 4;
export const REPLY_PRIMING = 3;
export const IMAGE_TOKENS = 85;
export const MIN_CACHE_PREFIX_TOKENS = 1024;
export const PREFIX_BLOCK_TOKENS = 128;

export type CacheModel = "breakpoints" | "prefix";

/** Cached prompt tokens are weighted at the default model's cached/input price ratio (gpt-4o-mini: 0.5). */
export const CACHED_WEIGHT = (() => {
  const p = priceFor(DEFAULT_CHAT_MODEL).price;
  return p.input > 0 ? p.cachedInput / p.input : 1;
})();

export function charEstimate(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}

export function contentText(content: ChatMessage["content"]): { text: string; images: number } {
  if (typeof content === "string") return { text: content, images: 0 };
  let images = 0;
  const parts: string[] = [];
  for (const p of content) {
    if (p.type === "text") parts.push(p.text);
    else images++;
  }
  return { text: parts.join("\n"), images };
}

export function toolCallsJson(calls: ReadonlyArray<{ name: string; arguments: string }>): string {
  return JSON.stringify(calls.map((c) => ({ name: c.name, arguments: c.arguments })));
}

export function messageTokens(m: Pick<ChatMessage, "content" | "toolCalls">, est: Estimator): number {
  const { text, images } = contentText(m.content);
  const calls = m.toolCalls && m.toolCalls.length > 0 ? est(toolCallsJson(m.toolCalls)) : 0;
  return MESSAGE_OVERHEAD + est(text) + images * IMAGE_TOKENS + calls;
}

export function toolsTokens(tools: readonly ToolSpec[] | undefined, est: Estimator): number {
  return tools && tools.length > 0 ? est(JSON.stringify(tools)) : 0;
}

export interface MeteredPrompt {
  system: string;
  messages: Array<Pick<ChatMessage, "role" | "content" | "toolCalls" | "toolCallId" | "cacheBreakpoint">>;
  tools?: ToolSpec[];
  cacheSystem?: boolean;
}

export interface CachePrefix {
  hash: string;
  tokens: number;
  /** ends at a declared cache breakpoint */
  breakpoint: boolean;
}

export interface PromptMeasure {
  inputTokens: number;
  /** every message boundary, shortest first: hash of the exact bytes and the token count so far */
  prefixes: CachePrefix[];
  layers: { system: number; tools: number; messages: number };
}

export interface MeasureOptions {
  /** fixed sizes for prompts whose static part is a measured constant (legacy) */
  fixedSystemTokens?: number;
  fixedToolTokens?: number;
}

export function measurePrompt(p: MeteredPrompt, est: Estimator, opts: MeasureOptions = {}): PromptMeasure {
  const hasher = new Bun.CryptoHasher("sha256");
  const system = opts.fixedSystemTokens !== undefined ? MESSAGE_OVERHEAD + opts.fixedSystemTokens : p.system ? MESSAGE_OVERHEAD + est(p.system) : 0;
  const tools = opts.fixedToolTokens ?? toolsTokens(p.tools, est);
  let tokens = system + tools;
  hasher.update(p.system);
  hasher.update("\u0000tools\u0000");
  hasher.update(JSON.stringify(p.tools ?? []));
  const prefixes: CachePrefix[] = [{ hash: hasher.copy().digest("hex"), tokens, breakpoint: p.cacheSystem === true }];
  let messages = 0;
  for (const m of p.messages) {
    const t = messageTokens(m, est);
    messages += t;
    tokens += t;
    hasher.update("\u0000msg\u0000");
    hasher.update(JSON.stringify({ r: m.role, c: m.content, t: m.toolCalls ?? null, i: m.toolCallId ?? null }));
    prefixes.push({ hash: hasher.copy().digest("hex"), tokens, breakpoint: m.cacheBreakpoint === true });
  }
  return { inputTokens: tokens + REPLY_PRIMING, prefixes, layers: { system, tools, messages } };
}

/** Simulated vendor prefix cache, one entry per cache key (the previous call only). */
export class PrefixCache {
  private last = new Map<string, Set<string>>();

  constructor(
    readonly model: CacheModel = "breakpoints",
    readonly minTokens = MIN_CACHE_PREFIX_TOKENS,
  ) {}

  private candidates(prefixes: readonly CachePrefix[]): CachePrefix[] {
    return this.model === "breakpoints" ? prefixes.filter((p) => p.breakpoint) : [...prefixes];
  }

  private size(tokens: number): number {
    return this.model === "prefix" ? Math.floor(tokens / PREFIX_BLOCK_TOKENS) * PREFIX_BLOCK_TOKENS : tokens;
  }

  /** Cached tokens for this call; remembers this call's prefixes for the next call with the same key. */
  read(cacheKey: string, prefixes: readonly CachePrefix[]): number {
    const prev = this.last.get(cacheKey);
    const cand = this.candidates(prefixes);
    let cached = 0;
    if (prev) {
      for (const p of cand) if (p.tokens >= this.minTokens && prev.has(p.hash)) cached = Math.max(cached, this.size(p.tokens));
    }
    this.last.set(cacheKey, new Set(cand.map((p) => p.hash)));
    return cached;
  }

  /** Largest prefix a cache write would store (Anthropic-style write accounting). */
  writable(prefixes: readonly CachePrefix[]): number {
    let best = 0;
    for (const p of this.candidates(prefixes)) if (p.tokens >= this.minTokens) best = Math.max(best, this.size(p.tokens));
    return best;
  }

  reset(): void {
    this.last.clear();
  }
}

/** Full-rate-equivalent input tokens: uncached + cached x CACHED_WEIGHT. */
export function billableInput(inputTokens: number, cachedTokens: number): number {
  return inputTokens - cachedTokens + Math.round(cachedTokens * CACHED_WEIGHT);
}
