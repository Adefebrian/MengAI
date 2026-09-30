// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Fakes for the runs tests: a scripted LlmRouter and in-memory stand-ins for
// every service the orchestrator depends on. Test-only; nothing imports this
// outside *.test.ts files.
import {
  ROLE_TOOLS,
  activityForTool,
  type AgentRole,
  type DecisionDTO,
  type LlmCallDTO,
  type OwnerSettings,
  type ProjectDTO,
  type StrategyChoice,
  type StrategyVersionDTO,
  type Tier,
} from "@mengai/shared";
import type { AppConfig, ModuleContext } from "../../core/module";
import { LlmError, type BlobStore, type ChatRequest, type ChatResult, type JevAnswer, type Judge, type LlmProvider, type LlmRouter, type ToolCall, type Usage } from "../../core/ports";
import type {
  AutomationService,
  ContextInput,
  ContextService,
  DecisionService,
  KillSwitch,
  MemoryService,
  ProjectsService,
  RecordCallInput,
  SettingsService,
  ToolContext,
  ToolResult,
  ToolsService,
  UsageService,
  WorkspaceService,
} from "../../core/services";
import { notFound } from "../../lib/http";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { REFLEXION_SYSTEM } from "./brain";
import { CEO_SYSTEM, packetQuestion } from "./company";
import { CONTROL_TOOLS } from "./controls";
import { createRunsModule } from "./index";
import type { BrainMemory, BrainOptions, CompanyPace, MemoryPromotion, OutcomeKind, RunsDeps, StrategyProposalView, StrategySubject } from "./ports";
import { ROLE_SYSTEM } from "./roles";
import { bounded } from "./policy";
import { createRunsRepo } from "./repo";

export interface Reply {
  text?: string;
  calls?: Array<{ name: string; args?: unknown }>;
  usage?: Partial<Usage>;
  error?: LlmError;
  /** resolves before the reply is returned (aborts reject it) */
  wait?: Promise<void>;
  /** hang until the request signal aborts */
  hang?: boolean;
  before?: () => void;
}

export interface CallInfo {
  role: AgentRole;
  title: string;
  /** a dynamic role's title, when the cat has one */
  roleTitle: string | null;
  /** strategy addenda in its charter layer, "role:v1" and "agent:v2" */
  strategies: string[];
  /** 0-based call index for this role */
  n: number;
  req: ChatRequest;
}

export type Script = Partial<Record<AgentRole, Reply[]>> | ((info: CallInfo) => Reply);

/** The CEO decision call: the question in, the lead's raw JSON reply (or an error) out. */
export type CeoScript = (question: string) => { text?: string; error?: Error; wait?: Promise<void> };

/** The fast-tier side calls of the brain: the self-check critic and the dynamic role charter. */
export interface SideScript {
  /** the critic's raw reply for one self-check (default: a pass) */
  reflexion?: (packet: string, n: number) => { text?: string; error?: Error };
  /** the charter call's raw reply (default: two lines and the qa tools) */
  role?: (packet: string) => { text?: string; error?: Error };
}

const CEO_APPROVE = JSON.stringify({ decision: "approve", answer: "Approved. Go ahead." });

const DEFAULT_USAGE: Usage = { inputTokens: 100, outputTokens: 10, cachedTokens: 0, cacheWriteTokens: 0 };

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function waitAbortable(p: Promise<void>, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new LlmError("aborted", "aborted"));
    signal?.addEventListener("abort", () => reject(new LlmError("aborted", "aborted")), { once: true });
    p.then(resolve, reject);
  });
}

/** Parses the fake context's system prompt: "role=<role>\ntask=<title>". */
function parseSystem(system: string): { role: AgentRole; title: string; roleTitle: string | null; strategies: string[] } {
  const role = /role=(\w+)/.exec(system)?.[1] as AgentRole;
  const title = /task=(.*)/.exec(system)?.[1] ?? "";
  const roleTitle = /title=(.*)/.exec(system)?.[1] ?? null;
  const strategies = [...system.matchAll(/strategy=(\w+:v\d+)/g)].map((m) => m[1]!);
  return { role, title, roleTitle, strategies };
}

export function scriptedRouter(script: Script, ceo?: CeoScript, meetingMs: readonly [number, number] = [0, 0], side: SideScript = {}) {
  const perRole = new Map<AgentRole, number>();
  const calls: CallInfo[] = [];
  const ceoCalls: ChatRequest[] = [];
  const reflexionCalls: ChatRequest[] = [];
  const roleCalls: ChatRequest[] = [];
  const signals: AbortSignal[] = [];
  let seq = 0;
  const provider: LlmProvider = {
    id: "prov-test",
    protocol: "openai_chat",
    async listModels() {
      return [];
    },
    async chat(req: ChatRequest): Promise<ChatResult> {
      if (req.signal) signals.push(req.signal);
      if (req.system.startsWith("Summarize")) {
        return { text: "summary of earlier steps", toolCalls: [], stopReason: "end", usage: { ...DEFAULT_USAGE, outputTokens: 5 }, model: req.model, latencyMs: 1, retries: 0 };
      }
      const firstText = () => {
        const c = req.messages[0]?.content;
        return typeof c === "string" ? c : "";
      };
      if (req.system === REFLEXION_SYSTEM) {
        reflexionCalls.push(req);
        const r = side.reflexion ? side.reflexion(firstText(), reflexionCalls.length) : { text: JSON.stringify({ verdict: "pass", critique: "Evidence covers the acceptance." }) };
        if (r.error) throw r.error;
        return { text: r.text ?? "", toolCalls: [], stopReason: "end", usage: { ...DEFAULT_USAGE, outputTokens: 30 }, model: req.model, latencyMs: 1, retries: 0 };
      }
      if (req.system === ROLE_SYSTEM) {
        roleCalls.push(req);
        const r = side.role
          ? side.role(firstText())
          : { text: JSON.stringify({ charter: ["Test the page like a first visitor.", "Name every check you ran and its exit code."], tools: ["fs_read", "fs_search", "shell_run"] }) };
        if (r.error) throw r.error;
        return { text: r.text ?? "", toolCalls: [], stopReason: "end", usage: { ...DEFAULT_USAGE, outputTokens: 60 }, model: req.model, latencyMs: 1, retries: 0 };
      }
      if (req.system === CEO_SYSTEM) {
        ceoCalls.push(req);
        const content = req.messages[0]?.content;
        const r = ceo ? ceo(packetQuestion(typeof content === "string" ? content : "")) : { text: CEO_APPROVE };
        if (r.wait) await waitAbortable(r.wait, req.signal);
        if (r.error) throw r.error;
        return { text: r.text ?? CEO_APPROVE, toolCalls: [], stopReason: "end", usage: { ...DEFAULT_USAGE, outputTokens: 20 }, model: req.model, latencyMs: 2, retries: 0 };
      }
      const { role, title, roleTitle, strategies } = parseSystem(req.system);
      const n = perRole.get(role) ?? 0;
      perRole.set(role, n + 1);
      const info: CallInfo = { role, title, roleTitle, strategies, n, req };
      calls.push(info);
      let reply: Reply | undefined;
      if (typeof script === "function") reply = script(info);
      else reply = script[role]?.[n];
      if (!reply) reply = { calls: [{ name: "finish", args: { summary: `auto finish ${role} ${n}` } }] };
      reply.before?.();
      if (reply.hang) await waitAbortable(new Promise<void>(() => {}), req.signal);
      if (reply.wait) await waitAbortable(reply.wait, req.signal);
      if (reply.error) throw reply.error;
      if (req.signal?.aborted) throw new LlmError("aborted", "aborted");
      const toolCalls: ToolCall[] = (reply.calls ?? []).map((c) => ({ id: `call_${++seq}`, name: c.name, arguments: JSON.stringify(c.args ?? {}) }));
      return {
        text: reply.text ?? "",
        toolCalls,
        stopReason: toolCalls.length ? "tool_use" : "end",
        usage: { ...DEFAULT_USAGE, ...reply.usage },
        model: req.model,
        latencyMs: 3,
        retries: 0,
      };
    },
  };
  const router: LlmRouter &
    CompanyPace & {
      calls: CallInfo[];
      ceoCalls: ChatRequest[];
      reflexionCalls: ChatRequest[];
      roleCalls: ChatRequest[];
      signals: AbortSignal[];
      resolved: Array<{ tier: Tier; role?: AgentRole }>;
      configuredValue: boolean;
    } = {
    calls,
    ceoCalls,
    reflexionCalls,
    roleCalls,
    signals,
    // meetings are held for a few ms in tests
    company: { meetingMs },
    resolved: [],
    configuredValue: true,
    async resolve(opts) {
      router.resolved.push(opts);
      return { provider, model: opts.tier === "fast" ? "gpt-4o-mini" : "gpt-4o-mini", contextWindow: 128_000 };
    },
    async configured() {
      return router.configuredValue;
    },
  };
  return router;
}

export function fakeContext(opts: { compactWhen?: (input: ContextInput) => boolean } = {}) {
  const builds: ContextInput[] = [];
  const compactions: number[] = [];
  const service: ContextService & { builds: ContextInput[]; compactions: number[] } = {
    builds,
    compactions,
    charter: (role) => `charter for ${role}`,
    build(input) {
      builds.push(input);
      const brain = input as ContextInput & { roleKey?: string; charter?: { title: string } | null; addenda?: Array<{ scope: string; version: number }> | null };
      const extra = [
        brain.charter ? `\ntitle=${brain.charter.title}` : "",
        ...(brain.addenda ?? []).map((a) => `\nstrategy=${a.scope}:v${a.version}`),
      ].join("");
      return {
        request: {
          system: `role=${input.role}\ntask=${input.task?.title ?? ""}${extra}`,
          messages: [{ role: "user", content: JSON.stringify({ task: input.task, steps: input.steps.length, summary: input.summary }) }],
          tools: input.tools,
          cacheSystem: true,
          cacheKey: `${input.role}:${input.runId}`,
        },
        xray: {
          agentId: input.agentId,
          taskId: input.taskId,
          model: input.model,
          budget: input.budgetTokens,
          layers: [
            { layer: "charter", tokens: 300, cached: true },
            { layer: "recent", tokens: 40 * input.steps.length, cached: false },
          ],
          totalTokens: 300 + 40 * input.steps.length,
          compactions: 0,
          lastCachedTokens: 0,
          createdAt: 0,
        },
        estimatedTokens: 300 + 40 * input.steps.length,
        needsCompaction: opts.compactWhen ? opts.compactWhen(input) : false,
      };
    },
    async compact({ steps, summary, keepRecent, summarize }) {
      let text = summary ?? "";
      try {
        if (summarize) text = await summarize(JSON.stringify(steps.slice(0, -keepRecent)));
      } catch {
        text = "extractive";
      }
      compactions.push(steps.length);
      return { summary: text, steps: steps.slice(-keepRecent), tokensBefore: 1000, tokensAfter: 200 };
    },
    estimateTokens: (t) => Math.ceil(t.length / 4),
    calibrate() {},
    truncateOutput: (t, max = 3000) => (t.length > max ? t.slice(0, max) : t),
  };
  return service;
}

const READ_ONLY = new Set(["fs_list", "fs_read", "fs_search", "recall", "web_fetch", "web_search"]);

/**
 * Stand-in for the tools service with the same logging contract as the real
 * one: once bound to the module context (the harness does it), every execute
 * publishes tool.call and tool.result and inserts the tool_calls row under its
 * own callId, with redacted args and output, and returns that callId.
 * Redaction here goes through policy.bounded (same patterns as lib/redact).
 */
export function fakeTools(handler?: (call: ToolCall, ctx: ToolContext) => ToolResult | Promise<ToolResult>) {
  const executed: Array<{ call: ToolCall; ctx: ToolContext; callId: string }> = [];
  let bound: ModuleContext | null = null;
  let n = 0;
  const service: ToolsService & { executed: typeof executed; bind(ctx: ModuleContext): void } = {
    executed,
    bind(ctx) {
      bound = ctx;
    },
    specsFor: (role) => ROLE_TOOLS[role].map((name) => ({ name, description: name, parameters: { type: "object" } })),
    isControl: (n) => (CONTROL_TOOLS as readonly string[]).includes(n),
    isReadOnly: (n) => READ_ONLY.has(n),
    async execute(call, ctx) {
      const callId = `tc_${++n}`;
      executed.push({ call, ctx, callId });
      const who = { runId: ctx.runId, agentId: ctx.agentId, taskId: ctx.taskId };
      const argsJson = bounded(call.arguments, 50_000);
      if (bound) await bound.events.publish({ type: "tool.call", ...who, data: { callId, tool: call.name, activity: activityForTool(call.name), argsPreview: bounded(argsJson, 160) } });
      const res = handler ? await handler(call, ctx) : { output: `ok ${call.name}`, ok: true, durationMs: 4 };
      const output = bounded(res.output, 200_000);
      if (bound) {
        await createRunsRepo(bound.db).insertToolCall({ id: callId, ...who, tool: call.name, args: argsJson, output, ok: res.ok, durationMs: res.durationMs, createdAt: bound.clock.now() });
        await bound.events.publish({ type: "tool.result", ...who, data: { callId, tool: call.name, ok: res.ok, summary: bounded(output, 160), durationMs: res.durationMs } });
      }
      return { ...res, output, callId };
    },
  };
  return service;
}

export function fakeUsage() {
  const calls: LlmCallDTO[] = [];
  let n = 0;
  const cost = (u: Usage) => (u.inputTokens * 1 + u.outputTokens * 2) / 1_000_000;
  const service: UsageService & { calls: LlmCallDTO[] } = {
    calls,
    async record(input: RecordCallInput) {
      const dto: LlmCallDTO = {
        id: `llm_${++n}`,
        runId: input.runId,
        agentId: input.agentId,
        taskId: input.taskId,
        providerId: input.providerId,
        model: input.model,
        purpose: input.purpose,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        cachedTokens: input.usage.cachedTokens,
        cacheWriteTokens: input.usage.cacheWriteTokens,
        costUsd: cost(input.usage),
        latencyMs: input.latencyMs,
        retries: input.retries,
        ok: input.ok,
        error: input.error,
        createdAt: 0,
      };
      calls.push(dto);
      return dto;
    },
    async cost(_model, usage) {
      return cost(usage);
    },
    async prices() {
      return {};
    },
    async listCalls(runId) {
      return calls.filter((c) => c.runId === runId);
    },
  };
  return service;
}

export function fakeMemory() {
  const log = {
    digests: [] as Array<{ projectId: string; runId: string; text: string }>,
    outcomes: [] as Array<{ runId: string; taskId: string; success: boolean }>,
    reflections: [] as Array<{ taskTitle: string; outcome: string; notes: string[] }>,
    promoted: 0,
    used: [] as string[],
  };
  const service: MemoryService & MemoryPromotion & { log: typeof log } = {
    log,
    async retrieve() {
      return [];
    },
    async markUsed(ids) {
      log.used.push(...ids);
    },
    async recordOutcome(ctx) {
      log.outcomes.push(ctx);
    },
    async record() {
      throw new Error("not used");
    },
    async reflect(input) {
      log.reflections.push({ taskTitle: input.taskTitle, outcome: input.outcome, notes: input.notes });
      return null;
    },
    async saveSkill() {
      throw new Error("not used");
    },
    async findSkills() {
      return [];
    },
    async runDigest() {
      return null;
    },
    async saveRunDigest(input) {
      log.digests.push(input);
    },
    async promoteEligible() {
      log.promoted++;
    },
  };
  return service;
}

/**
 * In-memory BrainMemory: role outcomes, versioned strategies. A subject is
 * due for tuning after `tuneAfter` losses in a row with nothing attempted
 * since; the candidate text comes from `candidate` (null = no usable one).
 */
export function fakeBrain(
  opts: {
    tuneAfter?: number;
    candidate?: (subject: StrategySubject) => string | null;
    ruleAdopt?: boolean;
    /** the candidate's replay costs more than legacy (the prompt.adopt precheck keeps it) */
    overLegacy?: boolean;
    /** active strategies that exist before the run */
    seed?: StrategyVersionDTO[];
  } = {},
) {
  const tuneAfter = opts.tuneAfter ?? 3;
  const trace = {
    outcomes: [] as Array<{ role: string; agentId: string | null; outcome: "win" | "loss"; kind: OutcomeKind; cause: string }>,
    proposals: [] as StrategyProposalView[],
    applied: [] as Array<{ subject: StrategySubject; choice: StrategyChoice; verified: boolean; stamp: string | null }>,
  };
  const rows: StrategyVersionDTO[] = [...(opts.seed ?? [])];
  const lastTry = new Map<string, number>();
  let n = 0;
  const brain: BrainMemory & { trace: typeof trace; rows: StrategyVersionDTO[] } = {
    trace,
    rows,
    async recordRoleOutcome(input) {
      trace.outcomes.push({ role: input.role, agentId: input.agentId, outcome: input.outcome, kind: input.kind, cause: input.cause });
      const mine = trace.outcomes.filter((o) => o.role === input.role);
      const since = mine.slice(lastTry.get(`role:${input.role}`) ?? 0);
      const tail = since.slice(-tuneAfter);
      const tuneDue = tail.length >= tuneAfter && tail.every((o) => o.outcome === "loss");
      return { tuneDue, rate: mine.filter((o) => o.outcome === "win").length / mine.length, samples: mine.length };
    },
    async proposeStrategy(input) {
      const k = `${input.subject.kind}:${input.subject.key}`;
      lastTry.set(k, trace.outcomes.filter((o) => o.role === input.subject.key).length);
      const text = opts.candidate ? opts.candidate(input.subject) : `- Check the work before finishing (${input.subject.key}).`;
      if (!text) return null;
      const current = rows.find((r) => r.subject === input.subject.kind && r.subjectKey === input.subject.key && r.status === "active") ?? null;
      const p: StrategyProposalView = {
        subject: input.subject,
        current,
        candidate: text,
        merged: current ? `${text}\n${current.text}` : null,
        version: rows.filter((r) => r.subject === input.subject.kind && r.subjectKey === input.subject.key && r.status !== "rejected").length + 1,
        eval: { adopt: opts.ruleAdopt ?? true, reason: "addresses 2 of 2 recent failures", legacyBillableInputTokens: 10_000, candidate: { tokens: 12, billableInputTokens: 1_200 } },
        evidence: {
          scores: { current: 0, candidate: 0.9 },
          addressed: { current: 0, candidate: 2, losses: 2 },
          billableInputTokens: { current: 1_100, candidate: opts.overLegacy ? 20_000 : 1_200, legacy: 10_000 },
          tokens: { current: current?.tokens ?? 0, candidate: Math.ceil(text.length / 4) },
        },
        causes: (input.cases ?? []).map((c) => c.cause),
      };
      trace.proposals.push(p);
      return p;
    },
    async applyStrategy(input) {
      const p = input.proposal;
      trace.applied.push({ subject: p.subject, choice: input.choice, verified: input.decision?.verified ?? false, stamp: input.decision?.stamp ?? null });
      const adopt = input.choice !== "keep";
      if (adopt) for (const r of rows) if (r.subject === p.subject.kind && r.subjectKey === p.subject.key && r.status === "active") r.status = "retired";
      const text = input.choice === "merge" && p.merged ? p.merged : p.candidate;
      const row: StrategyVersionDTO = {
        id: `strategy_${++n}`,
        subject: p.subject.kind,
        subjectKey: p.subject.key,
        role: p.subject.role,
        version: p.version,
        text,
        tokens: Math.ceil(text.length / 4),
        status: adopt ? "active" : "rejected",
        choice: input.choice,
        reason: input.reason ?? p.eval.reason,
        decision: input.decision,
        evidence: p.evidence,
        createdAt: n,
      };
      rows.push(row);
      return row;
    },
    async activeStrategy(subject) {
      return rows.find((r) => r.subject === subject.kind && r.subjectKey === subject.key && r.status === "active") ?? null;
    },
    async strategiesByIds(ids) {
      return rows.filter((r) => ids.includes(r.id));
    },
    async strategyHistory(subject) {
      return rows.filter((r) => r.subject === subject.kind && r.subjectKey === subject.key).reverse();
    },
  };
  return brain;
}

/** A verified runtime JEV that answers from a script: (decisionId, state) -> answers, or null for an outage. */
export function fakeJudge(answer: (decisionId: string, state: Record<string, unknown>) => Partial<Record<string, JevAnswer>> | null) {
  const calls: Array<{ decisionId: string; state: Record<string, unknown> }> = [];
  const judge: Judge & { calls: typeof calls } = {
    calls,
    async configured() {
      return true;
    },
    async decide(req) {
      calls.push({ decisionId: req.decisionId, state: req.state });
      const a = answer(req.decisionId, req.state);
      if (!a) return { verified: false, stamp: "UNVERIFIED BY JEV", error: "scripted outage", latencyMs: 1 };
      const answers: Record<string, JevAnswer> = {};
      for (const [k, v] of Object.entries(a)) if (v) answers[k] = v;
      return { verified: true, model: "jev-test", answers, latencyMs: 2 };
    },
  };
  return judge;
}

/** A choice answer with the given confidence. */
export const choice = (c: string, confidence = 0.9): JevAnswer => ({ type: "choice", choice: c, confidence, probabilities: { [c]: confidence } });

function decision(decisionId: string, action: string): DecisionDTO {
  return { id: `d_${decisionId}`, runId: null, decisionId, answers: {}, action, confidence: null, verified: false, stamp: "UNVERIFIED BY JEV", latencyMs: 0, createdAt: 0 };
}

export function fakeDecisions(opts: { loopExit?: "exit_done" | "another_round" | "change_approach" | "escalate"; tier?: Tier } = {}) {
  const log = { loopExit: 0, modelTier: 0 };
  const service: DecisionService & { log: typeof log } = {
    log,
    async route(input) {
      return { role: input.candidates[0]!, split: false, decision: decision("orch.route", "route") };
    },
    async modelTier() {
      log.modelTier++;
      return { tier: opts.tier ?? "balanced", decision: decision("orch.model", "tier") };
    },
    async loopExit() {
      log.loopExit++;
      return { next: opts.loopExit ?? "exit_done", meetsAsk: 0.5, decision: decision("orch.loop_exit", "exit") };
    },
    async escalate() {
      return { decider: "human", reversible: 0.5, decision: decision("orch.escalate", "human") };
    },
    async promoteLesson() {
      return { scope: "discard", durable: 0, decision: decision("mem.promote", "discard") };
    },
    async severity(input) {
      return { severity: input.ruleSeverity, decision: decision("sec.severity", "keep") };
    },
    async list() {
      return [];
    },
  };
  return service;
}

export function fakeSettings(over: Partial<OwnerSettings> = {}): SettingsService {
  let s: OwnerSettings = {
    defaultBudgetTokens: 400_000,
    defaultBudgetUsd: 5,
    maxConcurrentAgents: 4,
    ceoName: "Oyen",
    maxAgents: 0,
    maxDepth: 0,
    allowNetworkTools: false,
    motion: "full",
    prices: {},
    ...over,
  };
  return {
    async get() {
      return s;
    },
    async patch(p) {
      s = { ...s, ...p };
      return s;
    },
  };
}

export function fakeKillswitch() {
  const hooks = new Map<string, () => Promise<number>>();
  const ks: KillSwitch & { hooks: typeof hooks } = {
    hooks,
    register(name, hook) {
      hooks.set(name, hook);
    },
    async trigger() {
      let stoppedRuns = 0;
      for (const h of hooks.values()) stoppedRuns += await h();
      return { stoppedRuns, killedProcesses: 0 };
    },
  };
  return ks;
}

export function fakeAutomation(available = false): AutomationService {
  return {
    async status() {
      return { available, reason: available ? null : "server mode", permissions: { accessibility: false, screen: false }, active: false };
    },
    async authorize() {
      return { approvalId: null, risk: "read" };
    },
    async perform() {
      throw new Error("not used");
    },
    async audit() {
      throw new Error("not used");
    },
  };
}

export function fakeProjects(ids: string[] = ["p1", "p2"]): ProjectsService & { touched: string[] } {
  const touched: string[] = [];
  const project = (id: string): ProjectDTO => ({ id, name: `Project ${id}`, workspacePath: `/tmp/ws-${id}`, createdAt: 0, updatedAt: 0, lastRunId: null });
  return {
    touched,
    async list() {
      return ids.map(project);
    },
    async get(id) {
      if (!ids.includes(id)) throw notFound("project");
      return project(id);
    },
    async create() {
      throw new Error("not used");
    },
    async remove() {},
    async root(id) {
      if (!ids.includes(id)) throw notFound("project");
      return `/tmp/ws-${id}`;
    },
    async touchRun(_id, runId) {
      touched.push(runId);
    },
  };
}

export function fakeWorkspace(): WorkspaceService {
  const no = async (): Promise<never> => {
    throw new Error("not used");
  };
  return { list: no, read: no, write: no, edit: no, remove: no, search: no, resolveInside: no, digest: async () => "src/ (2 files)" };
}

const noBlob: BlobStore = {
  async put() {
    throw new Error("not used");
  },
  async get() {
    return null;
  },
  async delete() {},
  async exists() {
    return false;
  },
};

const CONFIG: AppConfig = {
  mode: "local",
  version: "test",
  dataDir: "/tmp/mengai-test",
  workspacesDir: "/tmp/mengai-test/ws",
  webDir: null,
  allowedOrigins: [],
  allowedHosts: ["127.0.0.1"],
  controlToken: null,
};

export interface HarnessOptions {
  script: Script;
  ceo?: CeoScript;
  /** meeting hold range in ms (default 0) */
  meetingMs?: readonly [number, number];
  eventLog?: RunsDeps["eventLog"];
  settings?: Partial<OwnerSettings>;
  tools?: ReturnType<typeof fakeTools>;
  decisions?: ReturnType<typeof fakeDecisions>;
  context?: ReturnType<typeof fakeContext>;
  automation?: AutomationService;
  db?: Awaited<ReturnType<typeof createTestDb>>;
  clock?: ReturnType<typeof fakeClock>;
  /** brain switches; the harness turns them all off unless a test opts in */
  brain?: Partial<BrainOptions>;
  /** the in-memory brain memory (outcomes, strategies); none by default */
  brainMemory?: ReturnType<typeof fakeBrain>;
  /** the runtime JEV; none by default (every brain decision falls back, stamped) */
  judge?: Judge;
  /** fast-tier side calls: the self-check critic and the role charter */
  side?: SideScript;
  /** company templates (the companies module's service); none by default: every run is a studio run */
  companies?: RunsDeps["companies"];
  /** a tools service of its own (for example one with taskSpecs) instead of fakeTools */
  toolsService?: RunsDeps["tools"];
}

export async function harness(opts: HarnessOptions) {
  const db = opts.db ?? (await createTestDb());
  const clock = opts.clock ?? fakeClock();
  const events = captureEvents(clock);
  const ctx: ModuleContext = { config: CONFIG, db, kv: memoryKv(), blob: noBlob, vault: memoryVault(), clock, logger: silentLogger, events };
  const llm = scriptedRouter(opts.script, opts.ceo, opts.meetingMs, opts.side);
  const tools = opts.tools ?? fakeTools();
  tools.bind(ctx);
  const usage = fakeUsage();
  const memory = opts.brainMemory ? Object.assign(fakeMemory(), opts.brainMemory) : fakeMemory();
  const decisions = opts.decisions ?? fakeDecisions();
  const context = opts.context ?? fakeContext();
  const killswitch = fakeKillswitch();
  const projects = fakeProjects();
  const deps: RunsDeps = {
    projects,
    llm,
    usage,
    context,
    memory,
    tools,
    decisions,
    settings: fakeSettings(opts.settings),
    killswitch,
    automation: opts.automation ?? fakeAutomation(false),
    workspace: fakeWorkspace(),
    eventLog: opts.eventLog,
    brain: { reflexion: false, tuning: false, org: false, ...(opts.brain ?? {}) },
    ...(opts.judge ? { judge: opts.judge } : {}),
    ...(opts.companies ? { companies: opts.companies } : {}),
    ...(opts.toolsService ? { tools: opts.toolsService } : {}),
  };
  const mod = createRunsModule(ctx, deps);
  await mod.ready;
  const svc = mod.service;

  /** poll a condition; state driven, not time driven */
  async function until(pred: () => boolean | Promise<boolean>, what = "condition", timeoutMs = 4000): Promise<void> {
    const end = Date.now() + timeoutMs;
    while (!(await pred())) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await Bun.sleep(1);
    }
  }

  const runStatus = async (runId: string) => (await svc.snapshot(runId)).run.status;
  const untilStatus = (runId: string, status: string) => until(async () => (await runStatus(runId)) === status, `run ${status}`);

  return { db, clock, events, ctx, deps, llm, tools, usage, memory, decisions, context, killswitch, projects, mod, svc, until, untilStatus };
}
