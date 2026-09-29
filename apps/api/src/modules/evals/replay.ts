// Replays a scenario suite under the legacy policy and the v2 policy and
// meters every call with the same estimator (the ContextService's).
//   legacy: fixed 2,076 + 1,800 static tokens, the legacy engine's 4,000-char output
//           cap, unbounded history inside a wake, 39-message trim between wakes, no cache.
//   v2:     ContextService.build for every call, tool outputs through
//           truncateOutput, compact() when the build says so (the fast-tier
//           summarize call is charged), simulated vendor prefix cache.
// Both policies replay the identical scripted steps, so output tokens match
// and only the prompt policy differs.
import type { EvalRunDTO, LessonDTO } from "@mengai/shared";
import type { ToolCall, ToolSpec } from "../../core/ports/llm";
import type { ContextInput, ContextService, StepRecord } from "../../core/services";
import { LEGACY, LEGACY_PLANNING_NUDGE, legacyConversation, legacyRawCap, legacyToolOutput, type LegacyMessage } from "./legacy";
import { billableInput, measurePrompt, PrefixCache, toolCallsJson, type CacheModel, type Estimator } from "./meter";
import type { ScenarioFixture, SuiteFixture } from "./suites";
import { synthOutput } from "./synth";

export type Policy = "legacy" | "v2";
export type Metrics = EvalRunDTO["metrics"];

/** per-call input budget: min(12k, 40% of the model window) (architecture section 7) */
export function budgetFor(contextWindow: number): number {
  return Math.min(12_000, Math.floor(contextWindow * 0.4));
}

/** instructions the fast-tier summarizer gets on top of the folded steps */
export const SUMMARIZE_OVERHEAD_TOKENS = 200;

/** Headline method (JEV be.eval_baseline): v2 on OpenAI-style automatic prefix caching, legacy uncached. */
export const DEFAULT_V2_CACHE: CacheModel = "prefix";

export interface ScenarioResult {
  id: string;
  role: string;
  /** every call fit the model context window */
  passed: boolean;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  billableInputTokens: number;
  maxPromptTokens: number;
  compactions: number;
}

export interface PolicyReplay {
  policy: Policy;
  metrics: Metrics;
  scenarios: ScenarioResult[];
}

export interface SuiteReplay {
  suite: string;
  legacy: PolicyReplay;
  v2: PolicyReplay;
  /** 1 - v2 / legacy on billableInputTokens, in percent, one decimal */
  savingsPct: number;
}

export interface ReplayDeps {
  context: ContextService;
  specsFor: (role: ScenarioFixture["role"]) => ToolSpec[];
}

interface ScriptedStep {
  say: string;
  toolCalls: ToolCall[];
  results: Array<{ callId: string; tool: string; raw: string; ok: boolean }>;
  outputTokens: number;
}

function scriptSteps(s: ScenarioFixture, est: Estimator): ScriptedStep[] {
  return s.steps.map((step, i) => {
    const toolCalls: ToolCall[] = step.tools.map((t, j) => ({ id: `call_${i}_${j}`, name: t.name, arguments: JSON.stringify(t.args) }));
    const results = step.tools.map((t, j) => ({
      callId: `call_${i}_${j}`,
      tool: t.name,
      raw: synthOutput(`${s.id}:${i}:${j}`, t.name, t.outputChars, t.ok ?? true),
      ok: t.ok ?? true,
    }));
    return { say: step.say, toolCalls, results, outputTokens: est(step.say) + est(toolCallsJson(toolCalls)) };
  });
}

function taskText(s: ScenarioFixture): string {
  const t = s.task;
  if (!t) return `Goal: ${s.goal}`;
  return [`Goal: ${s.goal}`, `Task: ${t.title}`, t.spec, `Acceptance criteria:`, ...t.acceptance.map((a) => `- ${a}`)].join("\n");
}

function emptyResult(s: ScenarioFixture): ScenarioResult {
  return { id: s.id, role: s.role, passed: true, calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, billableInputTokens: 0, maxPromptTokens: 0, compactions: 0 };
}

function recordCall(r: ScenarioResult, input: number, output: number, cached: number): void {
  r.calls++;
  r.inputTokens += input;
  r.outputTokens += output;
  r.cachedTokens += cached;
  r.maxPromptTokens = Math.max(r.maxPromptTokens, input);
}

export function replayLegacy(s: ScenarioFixture, suite: SuiteFixture, est: Estimator, cache: PrefixCache | null = null): ScenarioResult {
  const r = emptyResult(s);
  const steps = scriptSteps(s, est);
  // convo[0] stands for the fixed system prompt; its size is the measured legacy constant.
  let convo: LegacyMessage[] = [
    { role: "system", content: "legacy-system" },
    { role: "user", content: `[from lead] ${taskText(s)}` },
    { role: "user", content: LEGACY_PLANNING_NUDGE },
  ];
  const cacheKey = `legacy-${suite.id}-${s.id}`;
  for (let i = 0; i < steps.length; i++) {
    // one wake runs up to LEGACY.wakeTurns turns; the trim only happens between wakes
    if (i > 0 && i % LEGACY.wakeTurns === 0) convo = legacyConversation(convo, LEGACY.keepRecent);
    const m = measurePrompt(
      { system: convo[0]!.content, messages: convo.slice(1).map((x) => ({ role: x.role === "system" ? "user" : x.role, content: x.content, toolCalls: x.toolCalls, toolCallId: x.toolCallId })) },
      est,
      { fixedSystemTokens: LEGACY.systemTokens, fixedToolTokens: LEGACY.toolTokens },
    );
    const cached = cache ? cache.read(cacheKey, m.prefixes) : 0;
    const step = steps[i]!;
    recordCall(r, m.inputTokens, step.outputTokens, cached);
    if (m.inputTokens > suite.contextWindow) r.passed = false;
    convo.push({ role: "assistant", content: step.say, toolCalls: step.toolCalls });
    for (const res of step.results) convo.push({ role: "tool", toolCallId: res.callId, content: legacyToolOutput(legacyRawCap(res.tool, res.raw), LEGACY.toolOutputMax) });
  }
  r.billableInputTokens = billableInput(r.inputTokens, r.cachedTokens);
  return r;
}

function serializeFolded(steps: StepRecord[], summary: string | null): string {
  const parts: string[] = summary ? [summary] : [];
  for (const s of steps) {
    parts.push(s.assistant.text);
    for (const c of s.assistant.toolCalls) parts.push(`${c.name} ${c.arguments}`);
    for (const res of s.results) parts.push(res.output);
  }
  return parts.join("\n");
}

function lessonsFor(s: ScenarioFixture): LessonDTO[] {
  return s.lessons.map((text, i) => ({
    id: `lesson-${s.id}-${i}`,
    scope: "project",
    role: s.role,
    projectId: s.project,
    text,
    tags: [],
    status: "active",
    uses: 4,
    wins: 3,
    losses: 1,
    score: 0.67,
    createdAt: 0,
    lastUsedAt: null,
  }));
}

export async function replayV2(s: ScenarioFixture, suite: SuiteFixture, deps: ReplayDeps, cache: PrefixCache): Promise<ScenarioResult> {
  const est: Estimator = (t) => deps.context.estimateTokens(t, suite.model);
  const r = emptyResult(s);
  const steps = scriptSteps(s, est);
  const budget = budgetFor(suite.contextWindow);
  const base: Omit<ContextInput, "steps" | "summary"> = {
    role: s.role,
    runId: `eval-${suite.id}-${s.id}`,
    agentId: `agent-${s.id}`,
    taskId: s.task ? `task-${s.id}` : null,
    tools: deps.specsFor(s.role),
    brief: { goal: s.goal, projectName: s.project, workspaceDigest: s.workspaceDigest, history: null },
    lessons: lessonsFor(s),
    task: s.task
      ? { title: s.task.title, spec: s.task.spec, acceptance: s.task.acceptance, depSummaries: s.task.depSummaries ?? [], handoff: s.task.handoff ?? null, notes: [] }
      : null,
    budgetTokens: budget,
    contextWindow: suite.contextWindow,
    model: suite.model,
  };

  let history: StepRecord[] = [];
  let summary: string | null = null;
  for (let i = 0; i < steps.length; i++) {
    let build = deps.context.build({ ...base, steps: history, summary });
    if (build.needsCompaction && history.length > 2) {
      const keepRecent = Math.max(2, Math.floor(history.length / 2));
      const folded = history.slice(0, history.length - keepRecent);
      const c = await deps.context.compact({ steps: history, summary, keepRecent });
      // charge the fast-tier summarize call the engine makes in production
      recordCall(r, SUMMARIZE_OVERHEAD_TOKENS + est(serializeFolded(folded, summary)), est(c.summary), 0);
      r.compactions++;
      history = c.steps;
      summary = c.summary;
      build = deps.context.build({ ...base, steps: history, summary });
    }
    const m = measurePrompt(build.request, est);
    const cached = cache.read(build.request.cacheKey, m.prefixes);
    const step = steps[i]!;
    recordCall(r, m.inputTokens, step.outputTokens, cached);
    if (m.inputTokens > suite.contextWindow) r.passed = false;
    history.push({
      assistant: { text: step.say, toolCalls: step.toolCalls },
      results: step.results.map((res) => ({ callId: res.callId, tool: res.tool, output: deps.context.truncateOutput(res.raw), ok: res.ok })),
    });
  }
  r.billableInputTokens = billableInput(r.inputTokens, r.cachedTokens);
  return r;
}

export function aggregate(results: ScenarioResult[]): Metrics {
  const m: Metrics = { scenarios: results.length, passed: 0, calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, billableInputTokens: 0, maxPromptTokens: 0 };
  for (const r of results) {
    if (r.passed) m.passed++;
    m.calls += r.calls;
    m.inputTokens += r.inputTokens;
    m.outputTokens += r.outputTokens;
    m.cachedTokens += r.cachedTokens;
    m.maxPromptTokens = Math.max(m.maxPromptTokens, r.maxPromptTokens);
  }
  m.billableInputTokens = billableInput(m.inputTokens, m.cachedTokens);
  return m;
}

export function savingsPct(legacy: Metrics, v2: Metrics): number {
  if (legacy.billableInputTokens <= 0) return 0;
  return Math.round((1 - v2.billableInputTokens / legacy.billableInputTokens) * 1000) / 10;
}

export interface ReplayOptions {
  /** where a cached v2 prefix may end (default "prefix": OpenAI automatic caching, the default model) */
  v2Cache?: CacheModel;
  /** legacy cache model; null = no cache, the measured baseline (default null) */
  legacyCache?: CacheModel | null;
}

export async function replaySuite(suite: SuiteFixture, deps: ReplayDeps, opts: ReplayOptions = {}): Promise<SuiteReplay> {
  const est: Estimator = (t) => deps.context.estimateTokens(t, suite.model);
  const legacyCache = opts.legacyCache ? new PrefixCache(opts.legacyCache) : null;
  const legacy = suite.scenarios.map((s) => replayLegacy(s, suite, est, legacyCache));
  const cache = new PrefixCache(opts.v2Cache ?? DEFAULT_V2_CACHE);
  const v2: ScenarioResult[] = [];
  for (const s of suite.scenarios) v2.push(await replayV2(s, suite, deps, cache));
  const lm = aggregate(legacy);
  const vm = aggregate(v2);
  return { suite: suite.id, legacy: { policy: "legacy", metrics: lm, scenarios: legacy }, v2: { policy: "v2", metrics: vm, scenarios: v2 }, savingsPct: savingsPct(lm, vm) };
}
