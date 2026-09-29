// Fakes for the runs tests: a scripted LlmRouter and in-memory stand-ins for
// every service the orchestrator depends on. Test-only; nothing imports this
// outside *.test.ts files.
import { ROLE_TOOLS, type AgentRole, type DecisionDTO, type LlmCallDTO, type OwnerSettings, type ProjectDTO, type Tier } from "@mengai/shared";
import type { AppConfig, ModuleContext } from "../../core/module";
import { LlmError, type BlobStore, type ChatRequest, type ChatResult, type LlmProvider, type LlmRouter, type ToolCall, type Usage } from "../../core/ports";
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
import { CONTROL_TOOLS } from "./controls";
import { createRunsModule } from "./index";
import type { MemoryPromotion, RunsDeps } from "./ports";

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
  /** 0-based call index for this role */
  n: number;
  req: ChatRequest;
}

export type Script = Partial<Record<AgentRole, Reply[]>> | ((info: CallInfo) => Reply);

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
function parseSystem(system: string): { role: AgentRole; title: string } {
  const role = /role=(\w+)/.exec(system)?.[1] as AgentRole;
  const title = /task=(.*)/.exec(system)?.[1] ?? "";
  return { role, title };
}

export function scriptedRouter(script: Script) {
  const perRole = new Map<AgentRole, number>();
  const calls: CallInfo[] = [];
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
      const { role, title } = parseSystem(req.system);
      const n = perRole.get(role) ?? 0;
      perRole.set(role, n + 1);
      const info: CallInfo = { role, title, n, req };
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
  const router: LlmRouter & { calls: CallInfo[]; signals: AbortSignal[]; resolved: Array<{ tier: Tier; role?: AgentRole }>; configuredValue: boolean } = {
    calls,
    signals,
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
      return {
        request: {
          system: `role=${input.role}\ntask=${input.task?.title ?? ""}`,
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

export function fakeTools(handler?: (call: ToolCall, ctx: ToolContext) => ToolResult | Promise<ToolResult>) {
  const executed: Array<{ call: ToolCall; ctx: ToolContext }> = [];
  const service: ToolsService & { executed: typeof executed } = {
    executed,
    specsFor: (role) => ROLE_TOOLS[role].map((name) => ({ name, description: name, parameters: { type: "object" } })),
    isControl: (n) => (CONTROL_TOOLS as readonly string[]).includes(n),
    isReadOnly: (n) => READ_ONLY.has(n),
    async execute(call, ctx) {
      executed.push({ call, ctx });
      if (handler) return handler(call, ctx);
      return { output: `ok ${call.name}`, ok: true, durationMs: 4 };
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
  settings?: Partial<OwnerSettings>;
  tools?: ReturnType<typeof fakeTools>;
  decisions?: ReturnType<typeof fakeDecisions>;
  context?: ReturnType<typeof fakeContext>;
  automation?: AutomationService;
  db?: Awaited<ReturnType<typeof createTestDb>>;
  clock?: ReturnType<typeof fakeClock>;
}

export async function harness(opts: HarnessOptions) {
  const db = opts.db ?? (await createTestDb());
  const clock = opts.clock ?? fakeClock();
  const events = captureEvents(clock);
  const ctx: ModuleContext = { config: CONFIG, db, kv: memoryKv(), blob: noBlob, vault: memoryVault(), clock, logger: silentLogger, events };
  const llm = scriptedRouter(opts.script);
  const tools = opts.tools ?? fakeTools();
  const usage = fakeUsage();
  const memory = fakeMemory();
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
