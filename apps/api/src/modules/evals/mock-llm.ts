// Scripted LLM doubles for tests and the integration wave (replaying the real
// orchestrator with no network). ScriptedProvider implements the LlmProvider
// port: it answers from a script, meters every prompt with the same counting
// rule as the benchmark, and simulates the vendor prefix cache (OpenAI-style
// automatic prefix for openai_chat, breakpoints for anthropic_messages).
// MockLlmRouter implements the LlmRouter port over one or more providers.
import type { AgentRole, ProviderModel, ProviderProtocol, Tier } from "@mengai/shared";
import { LlmError, type ChatRequest, type ChatResult, type LlmProvider, type LlmRouter, type ResolvedModel, type ToolCall } from "../../core/ports/llm";
import { charEstimate, measurePrompt, PrefixCache, toolCallsJson, type CacheModel, type Estimator } from "./meter";

export interface ScriptedTurn {
  text?: string;
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> | string; id?: string }>;
  stopReason?: ChatResult["stopReason"];
  /** override the estimated output size */
  outputTokens?: number;
  latencyMs?: number;
  /** throw this instead of answering (retry, guard and circuit breaker tests) */
  error?: LlmError;
}

export type Script = ScriptedTurn[] | ((req: ChatRequest, index: number) => ScriptedTurn | null);

export interface ScriptedProviderOptions {
  id?: string;
  protocol?: ProviderProtocol;
  script: Script;
  estimate?: Estimator;
  /** simulated vendor cache; false disables it (default by protocol) */
  cache?: CacheModel | false;
  /** when the script runs out: answer with a finish call (default) or throw */
  onExhausted?: "finish" | "error";
  models?: ProviderModel[];
}

export interface ScriptedCall {
  request: ChatRequest;
  result: ChatResult;
}

export class ScriptedProvider implements LlmProvider {
  readonly id: string;
  readonly protocol: ProviderProtocol;
  readonly calls: ScriptedCall[] = [];
  private index = 0;
  private readonly cache: PrefixCache | null;
  private readonly est: Estimator;

  constructor(private readonly opts: ScriptedProviderOptions) {
    this.id = opts.id ?? "scripted";
    this.protocol = opts.protocol ?? "openai_chat";
    this.est = opts.estimate ?? charEstimate;
    const model = opts.cache === undefined ? (this.protocol === "anthropic_messages" ? "breakpoints" : "prefix") : opts.cache;
    this.cache = model === false ? null : new PrefixCache(model);
  }

  /** turns left in an array script (Infinity for a function script) */
  get remaining(): number {
    return Array.isArray(this.opts.script) ? Math.max(0, this.opts.script.length - this.index) : Number.POSITIVE_INFINITY;
  }

  private next(req: ChatRequest): ScriptedTurn | null {
    const s = this.opts.script;
    const turn = Array.isArray(s) ? (s[this.index] ?? null) : s(req, this.index);
    this.index++;
    return turn;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    if (req.signal?.aborted) throw new LlmError("aborted", "request aborted");
    let turn = this.next(req);
    if (!turn) {
      if (this.opts.onExhausted === "error") throw new LlmError("server", "script exhausted");
      turn = { toolCalls: [{ name: "finish", arguments: { summary: "Script finished.", ok: true } }] };
    }
    if (turn.error) throw turn.error;

    const m = measurePrompt(req, this.est);
    const key = req.cacheKey ?? "default";
    const cachedTokens = this.cache ? this.cache.read(key, m.prefixes) : 0;
    const cacheWriteTokens = this.cache && this.protocol === "anthropic_messages" ? Math.max(0, this.cache.writable(m.prefixes) - cachedTokens) : 0;

    const n = this.index - 1;
    const toolCalls: ToolCall[] = (turn.toolCalls ?? []).map((tc, i) => ({
      id: tc.id ?? `call_${n}_${i}`,
      name: tc.name,
      arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments ?? {}),
    }));
    const text = turn.text ?? "";
    let outputTokens = turn.outputTokens ?? this.est(text) + (toolCalls.length > 0 ? this.est(toolCallsJson(toolCalls)) : 0);
    let stopReason: ChatResult["stopReason"] = turn.stopReason ?? (toolCalls.length > 0 ? "tool_use" : "end");
    if (req.maxOutputTokens !== undefined && outputTokens > req.maxOutputTokens) {
      outputTokens = req.maxOutputTokens;
      stopReason = "length";
    }
    if (req.onDelta && text) req.onDelta(text);

    const result: ChatResult = {
      text,
      toolCalls,
      stopReason,
      usage: { inputTokens: m.inputTokens, outputTokens, cachedTokens, cacheWriteTokens },
      model: req.model,
      latencyMs: turn.latencyMs ?? 0,
      retries: 0,
    };
    this.calls.push({ request: req, result });
    return result;
  }

  async listModels(): Promise<ProviderModel[]> {
    return this.opts.models ?? [{ id: "mock-model", label: "Mock model", contextWindow: 128_000, caps: ["chat", "tools"] }];
  }
}

export interface MockLlmRouterOptions {
  /** used for every tier without its own provider (default: a ScriptedProvider that always finishes) */
  provider?: LlmProvider;
  tiers?: Partial<Record<Tier, LlmProvider>>;
  /** model id per resolve, default `mock-<tier>` */
  model?: string | ((opts: { tier: Tier; role?: AgentRole }) => string);
  contextWindow?: number;
  configured?: boolean;
}

export class MockLlmRouter implements LlmRouter {
  readonly resolved: Array<{ tier: Tier; role?: AgentRole }> = [];
  private readonly fallback: LlmProvider;

  constructor(private readonly opts: MockLlmRouterOptions = {}) {
    this.fallback = opts.provider ?? new ScriptedProvider({ script: [] });
  }

  async resolve(o: { tier: Tier; role?: AgentRole }): Promise<ResolvedModel> {
    this.resolved.push({ tier: o.tier, role: o.role });
    if (this.opts.configured === false) throw new LlmError("auth", "no chat provider configured");
    const provider = this.opts.tiers?.[o.tier] ?? this.fallback;
    const m = this.opts.model;
    const model = typeof m === "function" ? m(o) : (m ?? `mock-${o.tier}`);
    return { provider, model, contextWindow: this.opts.contextWindow ?? 128_000 };
  }

  async configured(): Promise<boolean> {
    return this.opts.configured ?? true;
  }
}
