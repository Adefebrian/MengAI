// One async controller per run: the scheduler, the agent loop, handoffs, the
// review loop, guards, budgets, mood and every state change the UI renders.
// The engine is the single writer of its run's agents and tasks while it is
// live; every change is persisted first, then published as an event.
import {
  ACTIVITY_LABEL,
  ROLE_LABEL,
  TIERS,
  activityForStatus,
  activityForTool,
  catLook,
  pickCatName,
  type AgentDTO,
  type AgentRole,
  type BudgetBody,
  type CallPurpose,
  type ContextXrayDTO,
  type EventMap,
  type EventType,
  type HandoffDTO,
  type HumanMessageBody,
  type LessonDTO,
  type RunDTO,
  type Severity,
  type TaskDTO,
  type TaskPatchBody,
  type TaskStatus,
  type Tier,
  type UsageTotals,
} from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import { LlmError, type ChatRequest, type ChatResult, type Logger, type ResolvedModel, type ToolCall, type ToolSpec, type Usage } from "../../core/ports";
import type { ContextBuild, ContextInput, StepRecord, ToolResult } from "../../core/services";
import { badRequest, conflict, notFound } from "../../lib/http";
import { clip, redact } from "../../lib/redact";
import {
  askHumanArgs,
  createTasksArgs,
  finishArgs,
  handoffArgs,
  isControlTool,
  listTasksArgs,
  noteArgs,
  parseArgs,
  reportIssueArgs,
  resolveDeps,
  submitReviewArgs,
  updateTaskArgs,
} from "./controls";
import { LIMITS, OUTPUT_CAP, RepeatGuard, TITLES, bounded, moodFor, roleCap } from "./policy";
import type { RunsDeps } from "./ports";
import { emptyUsage, progressOf, type RunsRepo } from "./repo";

// ------------------------------------------------------------------ types
type TaskKind = "plan" | "final" | "work" | "review" | "fix" | "handoff";
type HaltKind = "run_stopped" | "agent_stopped" | "task_cancelled" | "task_requeued";

/** Abort reason carried by every AbortController the engine owns. */
export class Halt extends Error {
  constructor(public readonly kind: HaltKind) {
    super(`halted: ${kind}`);
    this.name = "Halt";
  }
}

interface Issue {
  severity: Severity;
  title: string;
  detail: string;
}

interface LiveTask {
  dto: TaskDTO;
  kind: TaskKind;
  /** review and fix tasks: the task under review */
  targetId: string | null;
  /** handoff children: the compact summary from the parent */
  handoff: string | null;
  handoffId: string | null;
  /** human messages and lead notes for the next prompt (in memory only) */
  notes: string[];
  issues: Issue[];
  /** review targets: completed review rounds and their notes */
  rounds: number;
  reviewNotes: string[][];
  reworked: boolean;
  failReason: string | null;
  waiters: Array<() => void>;
  ctl: AbortController | null;
}

interface LiveAgent {
  dto: AgentDTO;
  busy: boolean;
  /** waiting on a handoff child or a human: does not count as active */
  waiting: boolean;
  ctl: AbortController | null;
  consecutiveFailures: number;
  cleanSteps: number;
  justPassed: boolean;
  humanWait: { taskId: string; resolve: (text: string) => void } | null;
}

type Outcome =
  | { kind: "finished"; summary: string; blocked?: boolean }
  | { kind: "review"; verdict: "pass" | "fail"; notes: string[] }
  | { kind: "failed"; reason: string }
  | { kind: "halted"; halt: HaltKind };

type StepResult = StepRecord["results"][number];

interface ControlOut {
  output: string;
  ok: boolean;
  end?: Outcome;
}

interface Brief {
  goal: string;
  projectName: string;
  workspaceDigest: string;
  history: string | null;
}

export interface EngineHooks {
  onSeq(runId: string, seq: number): void;
  onClosed(runId: string): void;
}

export interface EngineInit {
  ctx: ModuleContext;
  deps: RunsDeps;
  repo: RunsRepo;
  run: RunDTO;
  project: { id: string; name: string };
  root: string;
  maxConcurrent: number;
  hooks: EngineHooks;
}

const TERMINAL_TASK: ReadonlySet<TaskStatus> = new Set(["done", "failed", "blocked", "cancelled"]);
export const TERMINAL_RUN: ReadonlySet<RunDTO["status"]> = new Set(["done", "failed", "stopped"]);
const NUDGE = "System: reply with a tool call. When the task is complete, call finish with a short summary of the result.";

const isTerminal = (t: LiveTask) => TERMINAL_TASK.has(t.dto.status);
const alive = (a: LiveAgent) => a.dto.status !== "stopped" && a.dto.status !== "error";
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Promise that settles through `register` or rejects when the signal aborts. */
function abortable<T>(signal: AbortSignal, register: (resolve: (v: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    register((v) => {
      signal.removeEventListener("abort", onAbort);
      resolve(v);
    });
  });
}

/** Active time per task: waiting on a human, a handoff or a pause does not count. */
class TaskTimer {
  private acc = 0;
  private since: number | null;
  constructor(private readonly now: () => number) {
    this.since = now();
  }
  stop() {
    if (this.since !== null) this.acc += this.now() - this.since;
    this.since = null;
  }
  start() {
    if (this.since === null) this.since = this.now();
  }
  elapsed() {
    return this.acc + (this.since === null ? 0 : this.now() - this.since);
  }
}

function addUsage(into: UsageTotals, d: UsageTotals): void {
  into.inputTokens += d.inputTokens;
  into.outputTokens += d.outputTokens;
  into.cachedTokens += d.cachedTokens;
  into.cacheWriteTokens += d.cacheWriteTokens;
  into.costUsd += d.costUsd;
  into.calls += d.calls;
}

// ----------------------------------------------------------------- engine
export class RunEngine {
  run: RunDTO;
  private readonly ctx: ModuleContext;
  private readonly deps: RunsDeps;
  private readonly repo: RunsRepo;
  private readonly hooks: EngineHooks;
  private readonly log: Logger;
  private readonly project: { id: string; name: string };
  private readonly root: string;
  private readonly maxConcurrent: number;

  private readonly agents = new Map<string, LiveAgent>();
  private readonly tasks = new Map<string, LiveTask>();
  private readonly handoffs = new Map<string, HandoffDTO>();
  private readonly loops = new Set<Promise<void>>();
  private readonly runAbort = new AbortController();
  private resumeWaiters: Array<() => void> = [];
  private pendingLeadNotes: string[] = [];

  private ticking = false;
  private dirty = false;
  private finishing = false;
  private closed = false;
  private finalReports = 0;
  private lastEvent: "lead_done" | "lead_failed" | "other" = "other";
  private leadFailure: string | null = null;
  private brief: Brief | null = null;
  private history: string | null | undefined = undefined;
  private digestStale = true;

  private constructor(init: EngineInit) {
    this.ctx = init.ctx;
    this.deps = init.deps;
    this.repo = init.repo;
    this.run = init.run;
    this.project = init.project;
    this.root = init.root;
    this.maxConcurrent = Math.max(1, Math.floor(init.maxConcurrent || 1));
    this.hooks = init.hooks;
    this.log = init.ctx.logger.child({ module: "runs", runId: init.run.id });
  }

  // ------------------------------------------------------- construction
  /** A brand new run: publishes run.created, spawns the lead, creates the plan task, starts. */
  static async start(init: EngineInit): Promise<RunEngine> {
    const e = new RunEngine(init);
    await e.emit("run.created", { run: e.view });
    const automation = await e.automationAvailable();
    const roles = (Object.keys(ROLE_LABEL) as AgentRole[]).filter((r) => r !== "lead" && (automation || r !== "operator"));
    const planSpec = [
      `Goal: ${e.run.goal}`,
      `Plan the work for the crew. Call create_tasks once with at most ${LIMITS.maxTasksPerCall} small, verifiable tasks:`,
      "title, spec, acceptance (a short list), role, deps (keys or positions of earlier tasks) and review (true for code changes).",
      `Roles: ${roles.join(", ")}.`,
      "If the goal is trivial, do it without tasks. Then call finish with a short plan summary.",
    ].join("\n");
    const plan = e.makeTask({
      title: TITLES.plan,
      spec: planSpec,
      acceptance: ["Every part of the goal is covered by a task", "Dependencies between tasks are explicit"],
      role: "lead",
      deps: [],
      review: false,
      priority: 1000,
      parentId: null,
      createdBy: null,
      assigneeId: null,
      kind: "plan",
    });
    const lead = await e.spawnAgent("lead", plan);
    plan.dto.assigneeId = lead.dto.id;
    await e.insertTask(plan);
    e.kick();
    return e;
  }

  /** A run that is not live in this process (paused by a restart): rebuild it from the tables. */
  static async hydrate(init: EngineInit): Promise<RunEngine> {
    const e = new RunEngine(init);
    const [agents, tasks, handoffs] = await Promise.all([
      init.repo.listAgents(init.run.id),
      init.repo.listTasks(init.run.id),
      init.repo.listHandoffs(init.run.id),
    ]);
    for (const h of handoffs) e.handoffs.set(h.id, h);
    const byChild = new Map(handoffs.map((h) => [h.taskId, h] as const));
    for (const a of agents) {
      e.agents.set(a.id, { dto: a, busy: false, waiting: false, ctl: null, consecutiveFailures: 0, cleanSteps: 0, justPassed: false, humanWait: null });
    }
    for (const dto of tasks) {
      const h = byChild.get(dto.id);
      const kind: TaskKind =
        dto.role === "lead" && dto.title === TITLES.plan
          ? "plan"
          : dto.role === "lead" && dto.title.startsWith(TITLES.final)
            ? "final"
            : dto.parentId && dto.role === "reviewer" && dto.title.startsWith(TITLES.reviewPrefix)
              ? "review"
              : dto.parentId && dto.title.startsWith(TITLES.fixPrefix)
                ? "fix"
                : h
                  ? "handoff"
                  : "work";
      e.tasks.set(dto.id, {
        dto,
        kind,
        targetId: kind === "review" || kind === "fix" ? dto.parentId : null,
        handoff: h?.summary ?? null,
        handoffId: h?.id ?? null,
        notes: [],
        issues: [],
        rounds: 0,
        reviewNotes: [],
        reworked: false,
        failReason: null,
        waiters: [],
        ctl: null,
      });
    }
    for (const t of e.tasks.values()) {
      if (t.kind === "final") e.finalReports++;
      const target = t.targetId ? e.tasks.get(t.targetId) : undefined;
      if (!target) continue;
      if (t.kind === "review" && t.dto.status === "done") {
        target.rounds++;
        target.reviewNotes.push([t.dto.resultSummary ?? ""]);
      }
      if (t.kind === "fix") target.reworked = true;
    }
    const lastEnded = [...e.tasks.values()]
      .filter((t) => t.dto.endedAt !== null)
      .sort((x, y) => (y.dto.endedAt ?? 0) - (x.dto.endedAt ?? 0))[0];
    if (lastEnded?.dto.role === "lead" && lastEnded.dto.status === "done") e.lastEvent = "lead_done";
    else if (lastEnded?.dto.role === "lead" && lastEnded.dto.status === "failed") {
      e.lastEvent = "lead_failed";
      e.leadFailure = lastEnded.dto.resultSummary;
    }
    // in-flight work did not survive the restart: requeue it (attempts are kept)
    for (const t of e.tasks.values()) {
      if (t.dto.status === "running" || t.dto.status === "waiting" || t.dto.status === "ready") await e.saveTask(t, { status: "queued" });
    }
    for (const a of e.agents.values()) {
      if (alive(a) && (a.dto.status !== "idle" || a.dto.currentTaskId)) await e.setAgent(a, { status: "idle", currentTaskId: null, statusText: null });
    }
    // a task left in review with no open reviewer or fix task gets a fresh review
    for (const t of [...e.tasks.values()]) {
      if (t.dto.status !== "review") continue;
      const open = [...e.tasks.values()].some((c) => c.targetId === t.dto.id && !isTerminal(c));
      if (!open) await e.startReview(t, t.dto.resultSummary ?? "", t.dto.assigneeId);
    }
    return e;
  }

  // ------------------------------------------------------------- views
  get view(): RunDTO {
    return { ...this.run, usage: { ...this.run.usage }, progress: progressOf([...this.tasks.values()].map((t) => t.dto)) };
  }

  get status(): RunDTO["status"] {
    return this.run.status;
  }

  agentList(): AgentDTO[] {
    return [...this.agents.values()].map((a) => ({ ...a.dto, usage: { ...a.dto.usage } }));
  }

  taskList(): TaskDTO[] {
    return [...this.tasks.values()].map((t) => t.dto).sort((x, y) => x.createdAt - y.createdAt || (x.id < y.id ? -1 : 1));
  }

  handoffList(): HandoffDTO[] {
    return [...this.handoffs.values()].sort((x, y) => x.createdAt - y.createdAt);
  }

  overBudget(): boolean {
    const u = this.run.usage;
    const tokens = u.inputTokens + u.outputTokens;
    return (this.run.budgetTokens > 0 && tokens >= this.run.budgetTokens) || (this.run.budgetUsd > 0 && u.costUsd >= this.run.budgetUsd);
  }

  // ----------------------------------------------------------- control
  async pause(reason: string | null): Promise<void> {
    if (this.run.status !== "running" || this.closed) return;
    this.run.status = "paused";
    this.run.statusReason = reason;
    await this.repo.setRunStatus(this.run.id, "paused", reason, this.ctx.clock.now(), null);
    await this.emit("run.status", { status: "paused", reason });
  }

  async resume(): Promise<void> {
    if (this.run.status !== "paused" || this.closed) return;
    this.run.status = "running";
    this.run.statusReason = null;
    await this.repo.setRunStatus(this.run.id, "running", null, this.ctx.clock.now(), null);
    await this.emit("run.status", { status: "running", reason: null });
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const w of waiters) w();
    this.kick();
  }

  /** Aborts every signal, waits briefly for loops to unwind, then marks everything stopped. */
  async stop(reason: string): Promise<void> {
    if (TERMINAL_RUN.has(this.run.status) || this.run.status === "stopping" || this.closed) return;
    this.finishing = true;
    this.run.status = "stopping";
    this.run.statusReason = reason;
    // abort first and synchronously, so a loop that triggered the stop unwinds at once
    this.runAbort.abort(new Halt("run_stopped"));
    await this.repo.setRunStatus(this.run.id, "stopping", reason, this.ctx.clock.now(), null);
    await this.emit("run.status", { status: "stopping", reason });
    let grace: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...this.loops]),
      new Promise<void>((resolve) => {
        grace = setTimeout(resolve, LIMITS.stopGraceMs);
      }),
    ]);
    clearTimeout(grace);
    const now = this.ctx.clock.now();
    for (const t of this.tasks.values()) {
      if (!isTerminal(t)) await this.saveTask(t, { status: "cancelled", endedAt: now });
    }
    for (const a of this.agents.values()) {
      if (a.dto.status !== "stopped") await this.setAgent(a, { status: "stopped", currentTaskId: null, statusText: null });
    }
    this.run.status = "stopped";
    this.run.endedAt = now;
    await this.repo.setRunStatus(this.run.id, "stopped", reason, now, now);
    await this.emit("run.status", { status: "stopped", reason });
    this.hooks.onClosed(this.run.id);
  }

  /** Process shutdown: abort work without changing statuses (boot recovery pauses the run). */
  shutdown(): void {
    this.closed = true;
    this.runAbort.abort(new Halt("run_stopped"));
  }

  async message(input: HumanMessageBody): Promise<void> {
    const text = bounded(input.text, LIMITS.noteChars);
    const lead = this.lead();
    let target: LiveAgent | undefined;
    if (input.agentId) {
      target = this.agents.get(input.agentId);
      if (!target) throw notFound("agent");
    } else if (lead?.humanWait) {
      target = lead;
    } else {
      const askers = [...this.agents.values()].filter((a) => a.humanWait);
      target = askers.length === 1 ? askers[0] : lead;
    }
    if (target?.humanWait) {
      const w = target.humanWait;
      target.humanWait = null;
      w.resolve(text);
      return;
    }
    const current = target?.dto.currentTaskId ? this.tasks.get(target.dto.currentTaskId) : undefined;
    if (current && !isTerminal(current)) {
      current.notes.push(`Human: ${text}`);
      return;
    }
    if (lead && alive(lead)) {
      // nobody is on it right now: the lead picks the message up as a small task
      const t = this.makeTask({
        title: "Human message",
        spec: `The human wrote:\n${text}\nAct on it: adjust the plan with update_task or create_tasks when needed, then call finish with a short answer.`,
        acceptance: ["The message is answered or acted on"],
        role: "lead",
        deps: [],
        review: false,
        priority: 900,
        parentId: null,
        createdBy: null,
        assigneeId: lead.dto.id,
        kind: "work",
      });
      await this.insertTask(t);
      this.kick();
      return;
    }
    this.pendingLeadNotes.push(`Human: ${text}`);
  }

  async setBudget(input: BudgetBody): Promise<void> {
    if (input.budgetTokens !== undefined) this.run.budgetTokens = input.budgetTokens;
    if (input.budgetUsd !== undefined) this.run.budgetUsd = input.budgetUsd;
    await this.repo.setRunBudget(this.run.id, this.run.budgetTokens, this.run.budgetUsd, this.ctx.clock.now());
    await this.emitUsage();
  }

  async patchTask(taskId: string, patch: TaskPatchBody): Promise<TaskDTO> {
    const t = this.tasks.get(taskId);
    if (!t) throw notFound("task");
    if (patch.assigneeId) {
      const a = this.agents.get(patch.assigneeId);
      if (!a || !alive(a) || a.dto.role !== t.dto.role) throw badRequest("assigneeId must be a live agent with the task's role", "invalid_assignee");
    }
    const changes: Partial<TaskDTO> = {};
    if (patch.priority !== undefined) changes.priority = patch.priority;
    if (patch.assigneeId !== undefined) changes.assigneeId = patch.assigneeId;
    const now = this.ctx.clock.now();

    if (patch.status === "cancelled") {
      if (t.dto.status === "done") throw conflict("task is already done");
      if (t.dto.status !== "cancelled") {
        await this.saveTask(t, { ...changes, status: "cancelled", endedAt: now });
        t.ctl?.abort(new Halt("task_cancelled"));
        await this.closeChildren(t, "cancelled by the human");
        await this.releaseTarget(t, "cancelled by the human");
      } else if (Object.keys(changes).length) await this.saveTask(t, changes);
    } else if (patch.status === "queued") {
      const ctl = t.ctl;
      await this.closeChildren(t, "requeued by the human");
      t.rounds = 0;
      t.reviewNotes = [];
      await this.saveTask(t, { ...changes, status: "queued", resultSummary: null, endedAt: null });
      ctl?.abort(new Halt("task_requeued"));
    } else if (Object.keys(changes).length) {
      await this.saveTask(t, changes);
    }
    const result = t.dto;
    this.kick();
    return result;
  }

  async stopAgent(agentId: string): Promise<AgentDTO> {
    const a = this.agents.get(agentId);
    if (!a) throw notFound("agent");
    if (a.dto.status === "stopped") return a.dto;
    const t = a.dto.currentTaskId ? this.tasks.get(a.dto.currentTaskId) : undefined;
    await this.setAgent(a, { status: "stopped", currentTaskId: null, statusText: null });
    if (a.ctl) a.ctl.abort(new Halt("agent_stopped"));
    else if (t && !isTerminal(t)) await this.saveTask(t, { status: "queued", assigneeId: null });
    const result = a.dto;
    this.kick();
    return result;
  }

  // ---------------------------------------------------------- events
  private async emit<T extends EventType>(type: T, data: EventMap[T], agentId: string | null = null, taskId: string | null = null): Promise<void> {
    if (this.closed) return;
    try {
      // payloads are snapshots: later in-memory changes must never leak into published events
      const ev = await this.ctx.events.publish({ type, runId: this.run.id, agentId, taskId, data: structuredClone(data) });
      this.hooks.onSeq(this.run.id, ev.seq);
    } catch (e) {
      this.log.log("warn", "event publish failed", { type, error: redact(errMsg(e)) });
    }
  }

  private async emitUsage(): Promise<void> {
    const v = this.view;
    await this.emit("run.usage", { usage: v.usage, budgetTokens: v.budgetTokens, budgetUsd: v.budgetUsd, progress: v.progress });
  }

  // ----------------------------------------------------------- agents
  private lead(): LiveAgent | undefined {
    return [...this.agents.values()].find((a) => a.dto.role === "lead" && alive(a));
  }

  private moodOf(a: LiveAgent) {
    const live = [...this.agents.values()].filter(alive).length || 1;
    return moodFor({
      justPassed: a.justPassed,
      consecutiveFailures: a.consecutiveFailures,
      cleanSteps: a.cleanSteps,
      tokensUsed: a.dto.usage.inputTokens + a.dto.usage.outputTokens,
      budgetShare: this.run.budgetTokens > 0 ? this.run.budgetTokens / live : 0,
      runElapsedMs: this.ctx.clock.now() - (this.run.startedAt ?? this.run.createdAt),
    });
  }

  /** Persist and publish agent.status whenever status, activity, mood, text or task change. */
  private async setAgent(a: LiveAgent, patch: Partial<Pick<AgentDTO, "status" | "activity" | "statusText" | "currentTaskId" | "steps">>): Promise<void> {
    if (this.closed) return;
    const prev = a.dto;
    const next: AgentDTO = { ...prev, ...patch };
    if (patch.status && patch.activity === undefined) next.activity = activityForStatus(patch.status);
    a.dto = next;
    next.mood = this.moodOf(a);
    const visible =
      next.status !== prev.status ||
      next.activity !== prev.activity ||
      next.mood !== prev.mood ||
      next.statusText !== prev.statusText ||
      next.currentTaskId !== prev.currentTaskId;
    if (!visible && next.steps === prev.steps) return;
    next.updatedAt = this.ctx.clock.now();
    await this.repo.saveAgentState(next);
    if (visible) {
      await this.emit(
        "agent.status",
        { status: next.status, activity: next.activity, mood: next.mood, statusText: next.statusText, taskId: next.currentTaskId },
        next.id,
        next.currentTaskId,
      );
    }
  }

  private async spawnAgent(role: AgentRole, forTask: LiveTask): Promise<LiveAgent> {
    const id = this.ctx.clock.id();
    const taken = new Set([...this.agents.values()].map((a) => a.dto.name));
    const name = pickCatName(id, role, taken);
    const look = catLook(id);
    let tier: Tier = "balanced";
    try {
      const target = forTask.targetId ? this.tasks.get(forTask.targetId) : undefined;
      const r = await this.deps.decisions.modelTier({
        runId: this.run.id,
        role,
        task: { title: forTask.dto.title, spec: forTask.dto.spec, acceptance: forTask.dto.acceptance },
        signals: { priorFailures: target?.rounds ?? 0, risk: role === "security" || role === "operator", files: 0 },
        available: [...TIERS],
      });
      tier = r.tier;
    } catch (e) {
      this.log.log("warn", "modelTier failed, using balanced", { error: redact(errMsg(e)) });
    }
    const creator = forTask.dto.createdBy ? this.agents.get(forTask.dto.createdBy) : undefined;
    const now = this.ctx.clock.now();
    const dto: AgentDTO = {
      id,
      runId: this.run.id,
      parentId: role === "lead" ? null : (creator?.dto.id ?? this.lead()?.dto.id ?? null),
      role,
      name,
      look: { coat: look.coat, seed: look.seed },
      tier,
      status: "idle",
      activity: "rest",
      mood: "calm",
      statusText: null,
      currentTaskId: null,
      steps: 0,
      usage: emptyUsage(),
      createdAt: now,
      updatedAt: now,
    };
    const a: LiveAgent = { dto, busy: false, waiting: false, ctl: null, consecutiveFailures: 0, cleanSteps: 0, justPassed: false, humanWait: null };
    this.agents.set(id, a);
    await this.repo.insertAgent(dto);
    await this.emit("agent.spawned", { agent: dto }, id, null);
    return a;
  }

  private async markPass(a: LiveAgent): Promise<void> {
    a.justPassed = true;
    a.consecutiveFailures = 0;
    if (!this.closed) await this.repo.addAgentOutcome(a.dto.id, true, this.ctx.clock.now());
    await this.setAgent(a, {});
  }

  private async markFail(a: LiveAgent): Promise<void> {
    a.justPassed = false;
    a.consecutiveFailures++;
    if (!this.closed) await this.repo.addAgentOutcome(a.dto.id, false, this.ctx.clock.now());
    await this.setAgent(a, {});
  }

  private activeCount(): number {
    let n = 0;
    for (const a of this.agents.values()) if (a.busy && !a.waiting) n++;
    return n;
  }

  // ------------------------------------------------------------ tasks
  private makeTask(input: {
    id?: string;
    title: string;
    spec: string;
    acceptance: string[];
    role: AgentRole;
    deps: string[];
    review: boolean;
    priority: number;
    parentId: string | null;
    createdBy: string | null;
    assigneeId: string | null;
    kind: TaskKind;
    targetId?: string | null;
    handoff?: string | null;
  }): LiveTask {
    const now = this.ctx.clock.now();
    const dto: TaskDTO = {
      id: input.id ?? this.ctx.clock.id(),
      runId: this.run.id,
      parentId: input.parentId,
      title: bounded(input.title, 200),
      spec: bounded(input.spec, 8000),
      acceptance: input.acceptance.map((s) => bounded(s, 400)).filter(Boolean).slice(0, 12),
      role: input.role,
      assigneeId: input.assigneeId,
      status: "queued",
      priority: input.priority,
      deps: input.deps,
      review: input.review,
      attempts: 0,
      resultSummary: null,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      endedAt: null,
    };
    return {
      dto,
      kind: input.kind,
      targetId: input.targetId ?? null,
      handoff: input.handoff ?? null,
      handoffId: null,
      notes: [],
      issues: [],
      rounds: 0,
      reviewNotes: [],
      reworked: false,
      failReason: null,
      waiters: [],
      ctl: null,
    };
  }

  private async insertTask(t: LiveTask): Promise<void> {
    this.tasks.set(t.dto.id, t);
    this.lastEvent = "other";
    await this.repo.insertTask(t.dto);
    await this.emit("task.created", { task: t.dto }, t.dto.createdBy, t.dto.id);
  }

  /** Persist, publish task.updated, and release waiters when the task ends. */
  private async saveTask(t: LiveTask, patch: Partial<TaskDTO>): Promise<void> {
    if (this.closed) return;
    const before = t.dto.status;
    t.dto = { ...t.dto, ...patch, updatedAt: this.ctx.clock.now() };
    await this.repo.saveTask(t.dto);
    await this.emit("task.updated", { task: t.dto }, t.dto.assigneeId, t.dto.id);
    if (!TERMINAL_TASK.has(before) && isTerminal(t)) this.onTerminal(t);
  }

  private onTerminal(t: LiveTask): void {
    if (t.dto.role !== "lead") this.lastEvent = "other";
    const waiters = t.waiters;
    t.waiters = [];
    for (const w of waiters) w();
    const parent = t.kind === "handoff" && t.dto.parentId ? this.tasks.get(t.dto.parentId) : undefined;
    if (parent && parent.ctl === null) {
      // the parent's loop is gone (restart or requeue): hand it the result as a note
      parent.notes.push(`Handoff result from ${ROLE_LABEL[t.dto.role]} (${t.dto.status}): ${t.dto.resultSummary ?? "no summary"}`);
    }
  }

  /** queued -> ready when every dependency is done or cancelled; blocked when one failed. */
  private depState(t: LiveTask): "ready" | "waiting" | "blocked" {
    let state: "ready" | "waiting" | "blocked" = "ready";
    for (const id of t.dto.deps) {
      const d = this.tasks.get(id);
      if (!d) continue;
      if (d.dto.status === "failed" || d.dto.status === "blocked") return "blocked";
      if (d.dto.status !== "done" && d.dto.status !== "cancelled") state = "waiting";
    }
    if (state === "ready") {
      for (const c of this.tasks.values()) {
        if (c.kind === "handoff" && c.dto.parentId === t.dto.id && !isTerminal(c)) return "waiting";
      }
    }
    return state;
  }

  private isDepBlocked(t: LiveTask): boolean {
    return t.dto.status === "blocked" && t.dto.resultSummary === TITLES.depBlocked;
  }

  private handoffDepth(t: LiveTask): number {
    let d = 0;
    let cur: LiveTask | undefined = t;
    while (cur && cur.kind === "handoff" && cur.dto.parentId) {
      d++;
      cur = this.tasks.get(cur.dto.parentId);
    }
    return d;
  }

  private async closeChildren(t: LiveTask, why: string): Promise<void> {
    const now = this.ctx.clock.now();
    for (const c of [...this.tasks.values()]) {
      if ((c.targetId === t.dto.id || (c.kind === "handoff" && c.dto.parentId === t.dto.id)) && !isTerminal(c)) {
        const ctl = c.ctl;
        await this.saveTask(c, { status: "cancelled", endedAt: now, resultSummary: bounded(`Cancelled: parent ${why}`, 200) });
        ctl?.abort(new Halt("task_cancelled"));
      }
    }
  }

  /** A review or fix task was cancelled: the task under review is accepted as it is. */
  private async releaseTarget(t: LiveTask, why: string): Promise<void> {
    if (t.kind !== "review" && t.kind !== "fix") return;
    const target = t.targetId ? this.tasks.get(t.targetId) : undefined;
    if (!target || target.dto.status !== "review") return;
    await this.saveTask(target, {
      status: "done",
      endedAt: this.ctx.clock.now(),
      resultSummary: bounded(`${target.dto.resultSummary ?? ""}\nReview ${why}.`, LIMITS.resultChars),
    });
  }

  // -------------------------------------------------------- scheduler
  /** Coalesced scheduler wakeup; safe to call from anywhere. */
  kick(): void {
    if (this.closed) return;
    if (this.ticking) {
      this.dirty = true;
      return;
    }
    this.ticking = true;
    void (async () => {
      try {
        do {
          this.dirty = false;
          await this.schedule();
        } while (this.dirty && !this.closed);
      } catch (e) {
        this.log.log("error", "scheduler failed", { error: redact(errMsg(e)) });
      } finally {
        this.ticking = false;
      }
    })();
  }

  private async schedule(): Promise<void> {
    if (this.run.status !== "running" || this.finishing) return;
    const now = this.ctx.clock.now();
    for (const t of [...this.tasks.values()]) {
      if (t.dto.status !== "queued" && !this.isDepBlocked(t)) continue;
      const s = this.depState(t);
      if (s === "blocked" && t.dto.status === "queued") await this.saveTask(t, { status: "blocked", resultSummary: TITLES.depBlocked, endedAt: now });
      else if (s === "ready") await this.saveTask(t, { status: "ready", ...(t.dto.status === "blocked" ? { resultSummary: null, endedAt: null } : {}) });
      else if (s === "waiting" && t.dto.status === "blocked") await this.saveTask(t, { status: "queued", resultSummary: null, endedAt: null });
    }

    const ready = [...this.tasks.values()]
      .filter((t) => t.dto.status === "ready")
      .sort((x, y) => y.dto.priority - x.dto.priority || x.dto.createdAt - y.dto.createdAt || (x.dto.id < y.dto.id ? -1 : 1));
    let dispatched = 0;
    let automation: boolean | null = null;
    for (const t of ready) {
      if (this.run.status !== "running" || this.closed) return;
      if (this.activeCount() >= this.maxConcurrent) break;
      if (t.dto.role === "operator") {
        if (automation === null) automation = await this.automationAvailable();
        if (!automation) {
          await this.saveTask(t, { status: "failed", endedAt: now, resultSummary: "Failed: local automation is not available on this machine" });
          continue;
        }
      }
      const agent = await this.pickAgent(t);
      if (!agent || t.dto.status !== "ready") continue;
      this.dispatch(agent, t);
      dispatched++;
    }
    if (dispatched === 0) await this.checkCompletion();
  }

  private async pickAgent(t: LiveTask): Promise<LiveAgent | null> {
    if (t.dto.assigneeId) {
      const owner = this.agents.get(t.dto.assigneeId);
      if (owner && alive(owner) && owner.dto.role === t.dto.role) return owner.busy ? null : owner;
    }
    const pool = [...this.agents.values()].filter((a) => a.dto.role === t.dto.role && alive(a));
    const idle = pool.find((a) => !a.busy);
    if (idle) return idle;
    if (pool.length < roleCap(t.dto.role)) return this.spawnAgent(t.dto.role, t);
    return null;
  }

  private dispatch(a: LiveAgent, t: LiveTask): void {
    a.busy = true;
    // claimed in memory right away so the next scheduler pass cannot double-dispatch; persisted by beginTask
    t.dto = { ...t.dto, status: "running", assigneeId: a.dto.id };
    const p: Promise<void> = this.runTask(a, t)
      .catch((e) => this.log.log("error", "task loop crashed", { taskId: t.dto.id, error: redact(errMsg(e)) }))
      .finally(() => {
        this.loops.delete(p);
        this.kick();
      });
    this.loops.add(p);
  }

  private async checkCompletion(): Promise<void> {
    if (this.run.status !== "running" || this.finishing || this.loops.size > 0) return;
    const open = [...this.tasks.values()].filter((t) => !isTerminal(t));
    if (open.length > 0) {
      // nothing is running and nothing could be dispatched: whatever is left cannot move
      const now = this.ctx.clock.now();
      let changed = false;
      for (const t of open) {
        if (t.dto.status === "queued" || t.dto.status === "review" || t.dto.status === "waiting") {
          changed = true;
          await this.saveTask(t, {
            status: "blocked",
            endedAt: now,
            resultSummary: bounded(`Stalled: nothing left in the run can unblock this task. ${t.dto.resultSummary ?? ""}`, LIMITS.resultChars),
          });
        }
      }
      if (changed) this.dirty = true;
      return;
    }
    if (this.lastEvent === "lead_done") {
      const bad = [...this.tasks.values()].filter((t) => t.dto.status === "failed" || t.dto.status === "blocked").length;
      return this.finishRun("done", bad > 0 ? `${bad} task${bad === 1 ? "" : "s"} failed or blocked` : null);
    }
    if (this.lastEvent === "lead_failed") return this.finishRun("failed", bounded(`Lead task failed: ${this.leadFailure ?? "unknown"}`, 400));
    if (this.finalReports >= LIMITS.finalReportsCap) return this.finishRun("done", "final report limit reached");
    this.finalReports++;
    const lead = this.lead();
    const t = this.makeTask({
      title: this.finalReports === 1 ? TITLES.final : `${TITLES.final} ${this.finalReports}`,
      spec: "Every crew task has ended. Read the results below, then call finish with the final report for the human: what was done, what failed or is blocked, and the next steps.",
      acceptance: ["States what was delivered", "Lists anything failed or blocked"],
      role: "lead",
      deps: [],
      review: false,
      priority: 1000,
      parentId: null,
      createdBy: null,
      assigneeId: lead?.dto.id ?? null,
      kind: "final",
    });
    await this.insertTask(t);
    this.dirty = true;
  }

  private async finishRun(status: "done" | "failed", reason: string | null): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    const now = this.ctx.clock.now();
    this.run.status = status;
    this.run.statusReason = reason;
    this.run.endedAt = now;
    await this.repo.setRunStatus(this.run.id, status, reason, now, now);
    for (const a of this.agents.values()) {
      if (alive(a)) await this.setAgent(a, { status: status === "done" ? "done" : "idle", currentTaskId: null, statusText: null });
    }
    await this.emitUsage();
    await this.emit("run.status", { status, reason });
    if (status === "done") await this.learn();
    this.hooks.onClosed(this.run.id);
  }

  /** Post-run learning: run digest, lesson outcomes, reflection on failed or reworked work, promotion. */
  private async learn(): Promise<void> {
    const { memory } = this.deps;
    const runId = this.run.id;
    const projectId = this.run.projectId;
    const safe = async (what: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        this.log.log("warn", `${what} failed`, { error: redact(errMsg(e)) });
      }
    };
    // outcomes first, so the promotion pass (inside saveRunDigest and below) sees this run's wins
    for (const t of this.tasks.values()) {
      if (t.dto.attempts === 0 || (t.dto.status !== "done" && t.dto.status !== "failed")) continue;
      await safe("recordOutcome", () => memory.recordOutcome({ runId, taskId: t.dto.id, success: t.dto.status === "done" }));
    }
    for (const t of this.tasks.values()) {
      const failed = t.dto.status === "failed" && t.kind !== "review";
      if (!failed && !t.reworked) continue;
      const outcome = failed ? `failed: ${t.failReason ?? t.dto.resultSummary ?? "unknown"}` : `reworked after ${t.rounds} review rounds`;
      const notes = [...t.reviewNotes.flat(), ...t.issues.map((i) => `[${i.severity}] ${i.title}`)].slice(0, 12);
      await safe("reflect", () =>
        memory.reflect({ runId, taskId: t.dto.id, projectId, role: t.dto.role, taskTitle: t.dto.title, outcome: bounded(outcome, 400), notes }),
      );
    }
    const leadTasks = this.taskList().filter((t) => t.role === "lead" && t.status === "done");
    const report = leadTasks[leadTasks.length - 1]?.resultSummary ?? "";
    await safe("saveRunDigest", () => memory.saveRunDigest({ projectId, runId, text: bounded(`Goal: ${this.run.goal}\nOutcome: ${report}`, 1500) }));
    const promote = memory.promoteEligible;
    if (promote) await safe("promoteEligible", () => promote.call(memory, { projectId, runId }));
  }

  // -------------------------------------------------------- task loop
  private async runTask(a: LiveAgent, t: LiveTask): Promise<void> {
    const ctl = new AbortController();
    const onRunAbort = () => ctl.abort(this.runAbort.signal.reason);
    if (this.runAbort.signal.aborted) ctl.abort(this.runAbort.signal.reason);
    else this.runAbort.signal.addEventListener("abort", onRunAbort, { once: true });
    a.ctl = ctl;
    t.ctl = ctl;
    let outcome: Outcome;
    try {
      await this.beginTask(a, t);
      outcome = await this.agentLoop(a, t, ctl.signal);
      // a cancel, requeue or stop that landed during the last step wins over its result
      if (ctl.signal.aborted) {
        const r: unknown = ctl.signal.reason;
        outcome = { kind: "halted", halt: r instanceof Halt ? r.kind : "run_stopped" };
      }
    } catch (e) {
      if (ctl.signal.aborted) {
        const r: unknown = ctl.signal.reason;
        outcome = { kind: "halted", halt: r instanceof Halt ? r.kind : "run_stopped" };
      } else {
        this.log.log("error", "agent loop error", { taskId: t.dto.id, error: redact(errMsg(e)) });
        outcome = { kind: "failed", reason: `internal error: ${clip(errMsg(e), 200)}` };
      }
    } finally {
      this.runAbort.signal.removeEventListener("abort", onRunAbort);
      // a requeued task may already run in a new loop: only clear what this loop owns
      if (a.ctl === ctl) a.ctl = null;
      if (t.ctl === ctl) t.ctl = null;
      a.humanWait = null;
    }
    try {
      await this.applyOutcome(a, t, outcome);
    } catch (e) {
      this.log.log("error", "applying task outcome failed", { taskId: t.dto.id, error: redact(errMsg(e)) });
    }
    a.busy = false;
    a.waiting = false;
    if (alive(a) && !TERMINAL_RUN.has(this.run.status) && this.run.status !== "stopping") {
      await this.setAgent(a, { status: "idle", currentTaskId: null, statusText: null });
    }
  }

  private async beginTask(a: LiveAgent, t: LiveTask): Promise<void> {
    const now = this.ctx.clock.now();
    if (a.dto.role === "lead" && this.pendingLeadNotes.length) {
      t.notes.push(...this.pendingLeadNotes);
      this.pendingLeadNotes = [];
    }
    await this.saveTask(t, { status: "running", assigneeId: a.dto.id, attempts: t.dto.attempts + 1, startedAt: t.dto.startedAt ?? now });
    a.cleanSteps = 0;
    await this.setAgent(a, { status: "thinking", currentTaskId: t.dto.id, statusText: clip(t.dto.title, LIMITS.statusChars) });
    if (t.handoffId) {
      const h = this.handoffs.get(t.handoffId);
      if (h && h.toAgentId !== a.dto.id) {
        const next = { ...h, toAgentId: a.dto.id };
        this.handoffs.set(h.id, next);
        await this.repo.setHandoffTarget(h.id, a.dto.id);
        await this.emit("handoff", { handoff: next }, h.fromAgentId, t.dto.id);
      }
    }
  }

  private async applyOutcome(a: LiveAgent, t: LiveTask, o: Outcome): Promise<void> {
    switch (o.kind) {
      case "halted":
        if (o.halt === "agent_stopped" && !isTerminal(t)) await this.saveTask(t, { status: "queued", assigneeId: null });
        return;
      case "failed":
        return this.failTask(a, t, o.reason);
      case "finished":
        // an agent that reports its task blocked ends it as blocked (dependents block); the lead's word is final
        if (o.blocked && a.dto.role !== "lead") return this.blockTask(a, t, o.summary);
        return this.completeWork(a, t, o.summary);
      case "review":
        return this.completeReview(a, t, o.verdict, o.notes);
    }
  }

  private async completeWork(a: LiveAgent, t: LiveTask, summary: string): Promise<void> {
    if (isTerminal(t)) return;
    const issues = t.issues.map((i) => `- [${i.severity}] ${i.title}${i.detail ? `: ${i.detail}` : ""}`);
    const result = bounded(issues.length ? `${summary}\nIssues:\n${issues.join("\n")}` : summary, LIMITS.resultChars);
    const now = this.ctx.clock.now();
    if (t.kind === "fix") {
      await this.saveTask(t, { status: "done", resultSummary: result, endedAt: now });
      const target = t.targetId ? this.tasks.get(t.targetId) : undefined;
      if (target && target.dto.status === "review") await this.startReview(target, result, a.dto.id);
      return;
    }
    if (t.dto.review && (t.kind === "work" || t.kind === "handoff")) {
      await this.saveTask(t, { status: "review", resultSummary: result });
      await this.startReview(t, result, a.dto.id);
      return;
    }
    await this.saveTask(t, { status: "done", resultSummary: result, endedAt: now });
    await this.markPass(a);
    if (a.dto.role === "lead") this.lastEvent = "lead_done";
  }

  private async startReview(target: LiveTask, summary: string, ownerId: string | null): Promise<void> {
    const round = target.rounds + 1;
    const prior = target.reviewNotes.flat();
    const spec = [
      `Review the work on "${target.dto.title}" (round ${round} of at most ${LIMITS.maxReviewRounds}).`,
      `Task spec:\n${target.dto.spec}`,
      target.dto.acceptance.length ? `Acceptance:\n${target.dto.acceptance.map((s) => `- ${s}`).join("\n")}` : "",
      `Owner's summary:\n${summary || "none"}`,
      prior.length ? `Earlier review notes:\n${prior.map((s) => `- ${s}`).join("\n")}` : "",
      "Inspect the workspace, then call submit_review with verdict pass or fail and concrete notes.",
    ]
      .filter(Boolean)
      .join("\n");
    const r = this.makeTask({
      title: `${TITLES.reviewPrefix}${target.dto.title}`,
      spec,
      acceptance: target.dto.acceptance,
      role: "reviewer",
      deps: [],
      review: false,
      priority: target.dto.priority + 1,
      parentId: target.dto.id,
      createdBy: ownerId,
      assigneeId: null,
      kind: "review",
      targetId: target.dto.id,
    });
    await this.insertTask(r);
    this.kick();
  }

  private async completeReview(reviewer: LiveAgent, rt: LiveTask, verdict: "pass" | "fail", notes: string[]): Promise<void> {
    if (isTerminal(rt)) return;
    const now = this.ctx.clock.now();
    await this.saveTask(rt, { status: "done", endedAt: now, resultSummary: bounded(`${verdict}: ${notes.join("; ") || "no notes"}`, LIMITS.resultChars) });
    await this.markPass(reviewer);
    const target = rt.targetId ? this.tasks.get(rt.targetId) : undefined;
    if (!target || target.dto.status !== "review") return;
    target.rounds++;
    target.reviewNotes.push(notes);
    const owner = target.dto.assigneeId ? this.agents.get(target.dto.assigneeId) : undefined;
    if (verdict === "pass") {
      await this.saveTask(target, {
        status: "done",
        endedAt: now,
        resultSummary: bounded(`${target.dto.resultSummary ?? ""}\nReview passed (round ${target.rounds}).`, LIMITS.resultChars),
      });
      if (owner) await this.markPass(owner);
      return;
    }
    target.reworked = true;
    if (owner) await this.markFail(owner);
    if (target.rounds < LIMITS.maxReviewRounds) return this.createFix(target, notes, rt, false);

    const counts = new Map<string, number>();
    for (const round of target.reviewNotes) {
      for (const n of new Set(round.map((s) => s.trim().toLowerCase()))) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const recurring = [...counts.values()].filter((c) => c > 1).length;
    const open = [
      ...rt.issues.map((i) => ({ severity: i.severity, title: i.title })),
      ...notes.map((n) => ({ severity: "medium" as Severity, title: clip(n, 120) })),
    ].slice(0, 12);
    let next: "exit_done" | "another_round" | "change_approach" | "escalate" = "escalate";
    try {
      const r = await this.deps.decisions.loopExit({ runId: this.run.id, goal: this.run.goal, round: target.rounds, gates: [{ name: "review", ok: false }], open, recurring });
      next = r.next;
    } catch (e) {
      this.log.log("warn", "loopExit failed, escalating", { error: redact(errMsg(e)) });
    }
    if (next === "exit_done") {
      await this.saveTask(target, {
        status: "done",
        endedAt: now,
        resultSummary: bounded(`${target.dto.resultSummary ?? ""}\nAccepted after ${target.rounds} review rounds with open notes: ${notes.join("; ")}`, LIMITS.resultChars),
      });
      return;
    }
    if ((next === "another_round" || next === "change_approach") && target.rounds < LIMITS.hardReviewRounds) {
      return this.createFix(target, notes, rt, next === "change_approach");
    }
    // escalate: block the task (its dependents block) and pause the run for the human
    await this.saveTask(target, {
      status: "blocked",
      endedAt: now,
      resultSummary: bounded(`Review did not converge after ${target.rounds} rounds: ${notes.join("; ")}`, LIMITS.resultChars),
    });
    await this.pause(bounded(`review: "${target.dto.title}" did not pass after ${target.rounds} rounds`, 300));
  }

  private async createFix(target: LiveTask, notes: string[], rt: LiveTask, changeApproach: boolean): Promise<void> {
    const spec = [
      changeApproach ? "The previous fixes did not pass review. Change the approach." : "",
      `Fix "${target.dto.title}" per the review notes (after round ${target.rounds}).`,
      `Review notes:\n${(notes.length ? notes : ["no notes given"]).map((s) => `- ${s}`).join("\n")}`,
      `Original spec:\n${target.dto.spec}`,
      "When done, call finish with what you changed.",
    ]
      .filter(Boolean)
      .join("\n");
    const fix = this.makeTask({
      title: `${TITLES.fixPrefix}${target.dto.title}`,
      spec,
      acceptance: target.dto.acceptance,
      role: target.dto.role,
      deps: [],
      review: false,
      priority: target.dto.priority + 1,
      parentId: target.dto.id,
      createdBy: rt.dto.assigneeId,
      assigneeId: target.dto.assigneeId,
      kind: "fix",
      targetId: target.dto.id,
    });
    await this.insertTask(fix);
    this.kick();
  }

  private async blockTask(a: LiveAgent, t: LiveTask, summary: string): Promise<void> {
    if (isTerminal(t)) return;
    t.failReason = `blocked: ${summary}`;
    const now = this.ctx.clock.now();
    await this.saveTask(t, { status: "blocked", endedAt: now, resultSummary: bounded(`Blocked: ${summary}`, LIMITS.resultChars) });
    await this.markFail(a);
    const target = t.kind === "fix" && t.targetId ? this.tasks.get(t.targetId) : undefined;
    if (target && target.dto.status === "review") {
      await this.saveTask(target, { status: "blocked", endedAt: now, resultSummary: bounded(`Blocked: fix was blocked: ${summary}`, LIMITS.resultChars) });
    }
  }

  private async failTask(a: LiveAgent, t: LiveTask, reason: string): Promise<void> {
    if (isTerminal(t)) return;
    t.failReason = reason;
    const now = this.ctx.clock.now();
    await this.saveTask(t, { status: "failed", endedAt: now, resultSummary: bounded(`Failed: ${reason}`, LIMITS.resultChars) });
    await this.markFail(a);
    if (t.kind === "fix" || t.kind === "review") {
      const target = t.targetId ? this.tasks.get(t.targetId) : undefined;
      if (target && target.dto.status === "review") {
        target.failReason = `${t.kind} failed: ${reason}`;
        await this.saveTask(target, { status: "failed", endedAt: now, resultSummary: bounded(`Failed: ${t.kind} task failed: ${reason}`, LIMITS.resultChars) });
      }
    }
    if (a.dto.role === "lead") {
      this.lastEvent = "lead_failed";
      this.leadFailure = reason;
    }
  }

  // ------------------------------------------------------- agent loop
  private async agentLoop(a: LiveAgent, t: LiveTask, signal: AbortSignal): Promise<Outcome> {
    const role = a.dto.role;
    const timer = new TaskTimer(() => this.ctx.clock.now());
    const specs = this.deps.tools.specsFor(role);
    const brief = await this.briefFor();
    const lessons = await this.lessonsFor(a, t);
    let resolved = await this.resolveModel(a, t, signal, timer);
    const guard = new RepeatGuard();
    let steps: StepRecord[] = [];
    let summary: string | null = null;
    let compactions = 0;
    let stepCount = 0;
    let textOnly = 0;
    let overflowRetried = false;

    while (true) {
      await this.checkpoint(a, t, signal, timer);
      if (stepCount >= LIMITS.maxStepsPerTask) return { kind: "failed", reason: `step limit reached (${LIMITS.maxStepsPerTask} steps)` };
      if (timer.elapsed() > LIMITS.taskWallClockMs) return { kind: "failed", reason: "time limit reached (15 minutes of work on one task)" };
      a.justPassed = false;
      await this.setAgent(a, { status: "thinking" });

      const input = this.contextInput(a, t, specs, brief, lessons, steps, summary, resolved, textOnly > 0);
      let build = this.deps.context.build(input);
      if (build.needsCompaction && steps.length > 1) {
        const c = await this.compact(a, t, steps, summary, LIMITS.keepRecentSteps, signal);
        steps = c.steps;
        summary = c.summary;
        compactions++;
        build = this.deps.context.build({ ...input, steps, summary });
      }

      let result: ChatResult;
      try {
        result = await this.chat(a, t, resolved, build, signal);
      } catch (e) {
        if (signal.aborted) throw e;
        if (e instanceof LlmError) {
          if (e.kind === "context_length" && !overflowRetried && steps.length > 1) {
            overflowRetried = true;
            const c = await this.compact(a, t, steps, summary, 1, signal);
            steps = c.steps;
            summary = c.summary;
            compactions++;
            continue;
          }
          const next = await this.onProviderError(e);
          if (next === "retry") {
            resolved = await this.resolveModel(a, t, signal, timer);
            continue;
          }
          if (next === "stop") throw signal.aborted ? signal.reason : new Halt("run_stopped");
          return { kind: "failed", reason: `provider error (${e.kind}): ${clip(e.message, 200)}` };
        }
        throw e;
      }
      overflowRetried = false;
      stepCount++;
      await this.saveXray(a, t, build, compactions, result.usage.cachedTokens);
      await this.setAgent(a, { steps: a.dto.steps + 1 });
      if (result.text.trim()) await this.emit("agent.say", { text: clip(result.text, LIMITS.sayChars), to: null }, a.dto.id, t.dto.id);

      if (result.toolCalls.length === 0) {
        textOnly++;
        steps.push({ assistant: { text: redact(result.text), toolCalls: [] }, results: [] });
        if (textOnly >= LIMITS.noProgressLimit) return { kind: "failed", reason: `no progress: ${LIMITS.noProgressLimit} replies without a tool call` };
        continue;
      }
      textOnly = 0;
      const calls = result.toolCalls.map((c) => ({ ...c, arguments: redact(c.arguments) }));
      const exec = await this.executeCalls(a, t, calls, signal, guard, timer);
      steps.push({ assistant: { text: redact(result.text), toolCalls: calls }, results: exec.results });
      a.cleanSteps = exec.anyError ? 0 : a.cleanSteps + 1;
      await this.setAgent(a, {});
      if (exec.tripped) return { kind: "failed", reason: exec.tripped };
      if (exec.end) return exec.end;
    }
  }

  /** Step boundary: honors budget and pause (in-flight work already finished), throws on abort. */
  private async checkpoint(a: LiveAgent, t: LiveTask, signal: AbortSignal, timer: TaskTimer): Promise<void> {
    if (signal.aborted) throw signal.reason;
    if (this.run.status === "running" && this.overBudget()) await this.pause("budget");
    if (this.run.status !== "paused") return;
    timer.stop();
    await this.setAgent(a, { status: "waiting", statusText: "Paused" });
    while (this.run.status === "paused") {
      await abortable<void>(signal, (resolve) => this.resumeWaiters.push(resolve));
    }
    if (signal.aborted) throw signal.reason;
    timer.start();
    await this.setAgent(a, { status: "thinking", statusText: clip(t.dto.title, LIMITS.statusChars) });
  }

  private async resolveModel(a: LiveAgent, t: LiveTask, signal: AbortSignal, timer: TaskTimer): Promise<ResolvedModel> {
    while (true) {
      await this.checkpoint(a, t, signal, timer);
      try {
        return await this.deps.llm.resolve({ tier: a.dto.tier, role: a.dto.role });
      } catch (e) {
        if (signal.aborted) throw signal.reason;
        if (e instanceof LlmError) {
          const next = await this.onProviderError(e);
          if (next === "stop") throw signal.aborted ? signal.reason : new Halt("run_stopped");
          if (next === "fail") await this.pause(bounded(`model: ${e.message}`, 300));
        } else {
          await this.pause(bounded(`model: no ${a.dto.tier} model is available (${errMsg(e)})`, 300));
        }
      }
    }
  }

  /** auth stops the run; transient errors (already retried by the adapter) pause it; the rest fail the task. */
  private async onProviderError(e: LlmError): Promise<"retry" | "stop" | "fail"> {
    if (e.kind === "auth") {
      void this.stop(bounded(`auth: the model provider rejected the API key (${e.message})`, 300));
      return "stop";
    }
    if (e.transient || e.kind === "aborted") {
      await this.pause(bounded(`provider: ${e.kind}${e.status ? ` ${e.status}` : ""}: ${e.message}`, 300));
      return "retry";
    }
    return "fail";
  }

  private contextInput(
    a: LiveAgent,
    t: LiveTask,
    tools: ToolSpec[],
    brief: Brief,
    lessons: LessonDTO[],
    steps: StepRecord[],
    summary: string | null,
    resolved: ResolvedModel,
    nudge: boolean,
  ): ContextInput {
    const window = resolved.contextWindow || 128_000;
    let depSummaries: string[];
    if (t.kind === "final") {
      depSummaries = [...this.tasks.values()]
        .filter((x) => x.dto.role !== "lead" && x.kind !== "review" && x.kind !== "fix")
        .slice(0, 24)
        .map((x) => clip(`${x.dto.title} [${x.dto.status}]: ${x.dto.resultSummary ?? "no summary"}`, 300));
    } else {
      depSummaries = t.dto.deps
        .map((id) => this.tasks.get(id))
        .filter((d): d is LiveTask => !!d)
        .map((d) => clip(`${d.dto.title} [${d.dto.status}]: ${d.dto.resultSummary ?? "no summary"}`, LIMITS.depSummaryChars));
    }
    return {
      role: a.dto.role,
      runId: this.run.id,
      agentId: a.dto.id,
      taskId: t.dto.id,
      tools,
      brief,
      lessons,
      task: {
        title: t.dto.title,
        spec: t.dto.spec,
        acceptance: t.dto.acceptance,
        depSummaries,
        handoff: t.handoff,
        notes: nudge ? [...t.notes, NUDGE] : [...t.notes],
      },
      steps,
      summary,
      budgetTokens: Math.min(LIMITS.inputBudgetCap, Math.floor(window * LIMITS.inputBudgetShare)),
      contextWindow: window,
      model: resolved.model,
    };
  }

  private async briefFor(): Promise<Brief> {
    if (this.brief && !this.digestStale) return this.brief;
    let digest = this.brief?.workspaceDigest ?? "";
    try {
      digest = bounded(await this.deps.workspace.digest(this.root), 2400);
    } catch (e) {
      this.log.log("warn", "workspace digest failed", { error: redact(errMsg(e)) });
    }
    if (this.history === undefined) {
      try {
        const h = await this.deps.memory.runDigest(this.project.id);
        this.history = h ? bounded(h, 2000) : null;
      } catch (e) {
        this.history = null;
        this.log.log("warn", "run digest failed", { error: redact(errMsg(e)) });
      }
    }
    this.digestStale = false;
    this.brief = { goal: this.run.goal, projectName: this.project.name, workspaceDigest: digest, history: this.history ?? null };
    return this.brief;
  }

  private async lessonsFor(a: LiveAgent, t: LiveTask): Promise<LessonDTO[]> {
    try {
      const lessons = await this.deps.memory.retrieve({
        text: `${t.dto.title}\n${t.dto.spec}`.slice(0, 2000),
        role: a.dto.role,
        projectId: this.project.id,
        limit: 5,
        tokenBudget: 400,
      });
      if (lessons.length) await this.deps.memory.markUsed(lessons.map((l) => l.id), { runId: this.run.id, taskId: t.dto.id });
      return lessons;
    } catch (e) {
      this.log.log("warn", "lesson retrieval failed", { error: redact(errMsg(e)) });
      return [];
    }
  }

  private purposeOf(t: LiveTask): CallPurpose {
    return t.kind === "plan" ? "plan" : t.kind === "review" ? "review" : "step";
  }

  private async chat(a: LiveAgent, t: LiveTask, resolved: ResolvedModel, build: ContextBuild, signal: AbortSignal): Promise<ChatResult> {
    const hasTools = build.request.tools.length > 0;
    const req: ChatRequest = {
      model: resolved.model,
      system: build.request.system,
      messages: build.request.messages,
      tools: hasTools ? build.request.tools : undefined,
      toolChoice: hasTools ? "auto" : undefined,
      maxOutputTokens: OUTPUT_CAP[a.dto.role],
      cacheKey: build.request.cacheKey,
      cacheSystem: build.request.cacheSystem,
      signal,
    };
    const started = this.ctx.clock.now();
    try {
      const res = await resolved.provider.chat(req);
      await this.recordUsage(a, t, resolved.provider.id, res.model || resolved.model, this.purposeOf(t), res.usage, res.latencyMs, res.retries, true, null);
      try {
        this.deps.context.calibrate(resolved.model, build.estimatedTokens, res.usage.inputTokens);
      } catch {
        // calibration is best effort
      }
      return res;
    } catch (e) {
      if (!signal.aborted) {
        const zero: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 };
        await this.recordUsage(a, t, resolved.provider.id, resolved.model, this.purposeOf(t), zero, this.ctx.clock.now() - started, 0, false, bounded(errMsg(e), 300));
      }
      throw e;
    }
  }

  private async recordUsage(
    a: LiveAgent,
    t: LiveTask,
    providerId: string,
    model: string,
    purpose: CallPurpose,
    usage: Usage,
    latencyMs: number,
    retries: number,
    ok: boolean,
    error: string | null,
  ): Promise<void> {
    if (this.closed) return;
    let cost = 0;
    try {
      const call = await this.deps.usage.record({ runId: this.run.id, agentId: a.dto.id, taskId: t.dto.id, providerId, model, purpose, usage, latencyMs, retries, ok, error });
      cost = call.costUsd;
    } catch (e) {
      this.log.log("warn", "usage record failed", { error: redact(errMsg(e)) });
      cost = await this.deps.usage.cost(model, usage).catch(() => 0);
    }
    const d: UsageTotals = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      costUsd: cost,
      calls: 1,
    };
    addUsage(this.run.usage, d);
    addUsage(a.dto.usage, d);
    const now = this.ctx.clock.now();
    await this.repo.addRunUsage(this.run.id, d, now);
    await this.repo.addAgentUsage(a.dto.id, d, now);
    await this.emitUsage();
    if (this.run.status === "running" && this.overBudget()) await this.pause("budget");
  }

  private async compact(a: LiveAgent, t: LiveTask, steps: StepRecord[], summary: string | null, keepRecent: number, signal: AbortSignal) {
    const summarize = async (text: string): Promise<string> => {
      const fast = await this.deps.llm.resolve({ tier: "fast", role: a.dto.role });
      const res = await fast.provider.chat({
        model: fast.model,
        system: "Summarize these earlier agent steps so the same agent can continue its task. Keep file paths, decisions, errors and open items. Plain text, at most 200 words.",
        messages: [{ role: "user", content: text }],
        maxOutputTokens: 400,
        temperature: 0,
        signal,
      });
      await this.recordUsage(a, t, fast.provider.id, res.model || fast.model, "summarize", res.usage, res.latencyMs, res.retries, true, null);
      return redact(res.text);
    };
    const r = await this.deps.context.compact({ steps, summary, keepRecent, summarize });
    await this.emit("memory.compacted", { agentId: a.dto.id, tokensBefore: r.tokensBefore, tokensAfter: r.tokensAfter }, a.dto.id, t.dto.id);
    return r;
  }

  private async saveXray(a: LiveAgent, t: LiveTask, build: ContextBuild, compactions: number, cached: number): Promise<void> {
    if (this.closed) return;
    const x: ContextXrayDTO = { ...build.xray, agentId: a.dto.id, taskId: t.dto.id, compactions, lastCachedTokens: cached, createdAt: this.ctx.clock.now() };
    try {
      await this.repo.upsertSnapshot(this.run.id, x);
    } catch (e) {
      this.log.log("warn", "xray snapshot failed", { error: redact(errMsg(e)) });
    }
  }

  // ------------------------------------------------------- tool calls
  private isControl(name: string): boolean {
    return isControlTool(name) || this.deps.tools.isControl(name);
  }

  private async executeCalls(
    a: LiveAgent,
    t: LiveTask,
    calls: ToolCall[],
    signal: AbortSignal,
    guard: RepeatGuard,
    timer: TaskTimer,
  ): Promise<{ results: StepResult[]; anyError: boolean; tripped: string | null; end: Outcome | null }> {
    const results: StepResult[] = [];
    let tripped: string | null = null;
    let end: Outcome | null = null;
    let anyError = false;
    const skipped = (c: ToolCall): StepResult => ({ callId: c.id, tool: c.name, output: "Skipped: the task already ended.", ok: false });
    const blocked = (c: ToolCall): StepResult => ({ callId: c.id, tool: c.name, output: `Blocked: the same ${c.name} call was repeated ${LIMITS.identicalCallLimit} times.`, ok: false });
    const repeated = (c: ToolCall) => guard.call(c.name, c.arguments) >= LIMITS.identicalCallLimit;
    const settle = (r: StepResult) => {
      results.push(r);
      if (!r.ok) {
        anyError = true;
        if (!tripped && guard.error(r.tool, r.output) >= LIMITS.identicalErrorLimit) tripped = `the same ${r.tool} error happened ${LIMITS.identicalErrorLimit} times`;
      }
    };

    let i = 0;
    while (i < calls.length) {
      const call = calls[i]!;
      if (tripped || end) {
        results.push(skipped(call));
        i++;
        continue;
      }
      if (!this.isControl(call.name) && this.deps.tools.isReadOnly(call.name)) {
        // read-only calls run in parallel; results keep the model's order
        const batch: ToolCall[] = [];
        while (i < calls.length && !this.isControl(calls[i]!.name) && this.deps.tools.isReadOnly(calls[i]!.name)) batch.push(calls[i++]!);
        const plan = batch.map((c): { call: ToolCall; pre: StepResult | null } => {
          if (tripped) return { call: c, pre: skipped(c) };
          if (repeated(c)) {
            tripped = `the same ${c.name} call was repeated ${LIMITS.identicalCallLimit} times`;
            return { call: c, pre: blocked(c) };
          }
          return { call: c, pre: null };
        });
        const outs = await Promise.all(plan.map((p) => (p.pre ? Promise.resolve(p.pre) : this.runTool(a, t, p.call, signal))));
        for (const r of outs) settle(r);
        continue;
      }
      i++;
      if (repeated(call)) {
        tripped = `the same ${call.name} call was repeated ${LIMITS.identicalCallLimit} times`;
        results.push(blocked(call));
        continue;
      }
      if (this.isControl(call.name)) {
        const r = await this.runControl(a, t, call, signal, timer);
        settle(r.result);
        if (r.end) end = r.end;
      } else {
        settle(await this.runTool(a, t, call, signal));
      }
    }
    return { results, anyError, tripped, end };
  }

  private async announce(a: LiveAgent, t: LiveTask, call: ToolCall, callId: string): Promise<void> {
    const activity = activityForTool(call.name);
    await this.setAgent(a, { status: "working", activity });
    await this.emit("tool.call", { callId, tool: call.name, activity, argsPreview: clip(call.arguments, LIMITS.previewChars) }, a.dto.id, t.dto.id);
  }

  private async settleTool(a: LiveAgent, t: LiveTask, call: ToolCall, callId: string, res: ToolResult): Promise<StepResult> {
    const output = redact(res.output ?? "");
    const durationMs = Math.max(0, Math.round(res.durationMs || 0));
    if (!this.closed) {
      try {
        await this.repo.insertToolCall({
          id: callId,
          runId: this.run.id,
          agentId: a.dto.id,
          taskId: t.dto.id,
          tool: call.name,
          args: call.arguments.slice(0, LIMITS.argsStoreChars),
          output: output.slice(0, LIMITS.toolOutputStoreChars),
          ok: res.ok,
          durationMs,
          createdAt: this.ctx.clock.now(),
        });
      } catch (e) {
        this.log.log("warn", "tool call log failed", { error: redact(errMsg(e)) });
      }
    }
    await this.emit("tool.result", { callId, tool: call.name, ok: res.ok, summary: clip(output, LIMITS.previewChars), durationMs }, a.dto.id, t.dto.id);
    return { callId: call.id, tool: call.name, output: this.deps.context.truncateOutput(output), ok: res.ok };
  }

  private async runTool(a: LiveAgent, t: LiveTask, call: ToolCall, signal: AbortSignal): Promise<StepResult> {
    const callId = this.ctx.clock.id();
    await this.announce(a, t, call, callId);
    const started = this.ctx.clock.now();
    let res: ToolResult;
    try {
      res = await this.deps.tools.execute(call, {
        runId: this.run.id,
        agentId: a.dto.id,
        taskId: t.dto.id,
        projectId: this.project.id,
        root: this.root,
        role: a.dto.role,
        signal,
      });
    } catch (e) {
      if (signal.aborted) throw signal.reason;
      res = { output: `Tool error: ${errMsg(e)}`, ok: false, durationMs: this.ctx.clock.now() - started };
    }
    if (signal.aborted) throw signal.reason;
    if (res.ok && !this.deps.tools.isReadOnly(call.name)) this.digestStale = true;
    return this.settleTool(a, t, call, callId, res);
  }

  private async runControl(a: LiveAgent, t: LiveTask, call: ToolCall, signal: AbortSignal, timer: TaskTimer): Promise<{ result: StepResult; end?: Outcome }> {
    const callId = this.ctx.clock.id();
    await this.announce(a, t, call, callId);
    const started = this.ctx.clock.now();
    let out: ControlOut;
    try {
      out = await this.control(a, t, call, signal, timer);
    } catch (e) {
      if (signal.aborted) throw signal.reason;
      out = { output: `Error: ${errMsg(e)}`, ok: false };
    }
    const result = await this.settleTool(a, t, call, callId, { output: out.output, ok: out.ok, durationMs: this.ctx.clock.now() - started });
    return { result, end: out.end };
  }

  private findTask(ref: string): LiveTask | undefined {
    const r = ref.trim();
    return this.tasks.get(r) ?? [...this.tasks.values()].find((x) => x.dto.title.toLowerCase() === r.toLowerCase());
  }

  private async automationAvailable(): Promise<boolean> {
    try {
      return (await this.deps.automation.status()).available;
    } catch {
      return false;
    }
  }

  private async control(a: LiveAgent, t: LiveTask, call: ToolCall, signal: AbortSignal, timer: TaskTimer): Promise<ControlOut> {
    const fail = (output: string): ControlOut => ({ output, ok: false });
    switch (call.name) {
      case "finish": {
        if (t.kind === "review") return fail("This is a review task: call submit_review with verdict pass or fail and your notes.");
        const p = parseArgs("finish", finishArgs, call.arguments);
        if (!p.ok) return fail(p.error);
        const files = p.value.files.length ? `\nFiles: ${p.value.files.join(", ")}` : "";
        const summary = bounded(`${p.value.summary || "Finished without a summary."}${files}`, LIMITS.resultChars);
        return { output: "Task finished.", ok: true, end: { kind: "finished", summary, blocked: p.value.blocked } };
      }
      case "note": {
        const p = parseArgs("note", noteArgs, call.arguments);
        if (!p.ok) return fail(p.error);
        await this.setAgent(a, { statusText: clip(p.value.text, LIMITS.statusChars) });
        return { output: "Noted.", ok: true };
      }
      case "ask_human":
        return this.controlAskHuman(a, t, call, signal, timer);
      case "handoff":
        return this.controlHandoff(a, t, call, signal, timer);
      case "create_tasks":
        return this.controlCreateTasks(a, t, call);
      case "update_task":
        return this.controlUpdateTask(t, call);
      case "list_tasks": {
        const p = parseArgs("list_tasks", listTasksArgs, call.arguments);
        if (!p.ok) return fail(p.error);
        const rows = this.taskList()
          .filter((x) => !p.value.status || x.status === p.value.status)
          .slice(0, 40)
          .map((x) => {
            const who = x.assigneeId ? this.agents.get(x.assigneeId)?.dto.name : null;
            const res = x.resultSummary ? ` | ${clip(x.resultSummary, 120)}` : "";
            return `${x.id} | ${x.status} | ${x.role} | ${x.title} | ${who ?? "-"}${res}`;
          });
        return { output: rows.length ? rows.join("\n") : "No tasks.", ok: true };
      }
      case "crew_status": {
        const rows = [...this.agents.values()].map((x) => {
          const task = x.dto.currentTaskId ? this.tasks.get(x.dto.currentTaskId)?.dto.title : null;
          const tokens = x.dto.usage.inputTokens + x.dto.usage.outputTokens;
          return `${x.dto.name} (${x.dto.role}): ${x.dto.status}, ${ACTIVITY_LABEL[x.dto.activity]}, task: ${task ?? "none"}, steps ${x.dto.steps}, tokens ${tokens}`;
        });
        return { output: rows.join("\n") || "No crew yet.", ok: true };
      }
      case "submit_review": {
        if (t.kind !== "review") return fail("submit_review is only for review tasks. Call finish when your task is done.");
        const p = parseArgs("submit_review", submitReviewArgs, call.arguments);
        if (!p.ok) return fail(p.error);
        const notes = p.value.notes.map((n) => bounded(n, 600)).filter(Boolean).slice(0, 12);
        return { output: "Review submitted.", ok: true, end: { kind: "review", verdict: p.value.verdict ?? "fail", notes } };
      }
      case "report_issue": {
        const p = parseArgs("report_issue", reportIssueArgs, call.arguments);
        if (!p.ok) return fail(p.error);
        const issue: Issue = {
          severity: p.value.severity,
          title: bounded(p.value.title, 200),
          detail: bounded(`${p.value.where ? `${p.value.where} ` : ""}${p.value.detail}`, 1000),
        };
        t.issues.push(issue);
        await this.emit("agent.say", { text: clip(`Issue (${issue.severity}): ${issue.title}`, LIMITS.sayChars), to: null }, a.dto.id, t.dto.id);
        return { output: `Issue recorded (${issue.severity}).`, ok: true };
      }
      default:
        return fail(`The ${call.name} tool is not available in this run.`);
    }
  }

  private async controlAskHuman(a: LiveAgent, t: LiveTask, call: ToolCall, signal: AbortSignal, timer: TaskTimer): Promise<ControlOut> {
    const p = parseArgs("ask_human", askHumanArgs, call.arguments);
    if (!p.ok) return { output: p.error, ok: false };
    const question = bounded(p.value.question, 1000);
    await this.saveTask(t, { status: "waiting" });
    timer.stop();
    a.waiting = true;
    await this.setAgent(a, { status: "approval", statusText: clip(question, LIMITS.statusChars) });
    await this.emit("agent.say", { text: clip(question, LIMITS.sayChars), to: "human" }, a.dto.id, t.dto.id);
    this.kick();
    const answer = await abortable<string>(signal, (resolve) => {
      a.humanWait = { taskId: t.dto.id, resolve };
    });
    a.humanWait = null;
    a.waiting = false;
    timer.start();
    await this.saveTask(t, { status: "running" });
    await this.setAgent(a, { status: "working", statusText: clip(t.dto.title, LIMITS.statusChars) });
    return { output: `The human replied: ${answer}`, ok: true };
  }

  private async controlHandoff(a: LiveAgent, t: LiveTask, call: ToolCall, signal: AbortSignal, timer: TaskTimer): Promise<ControlOut> {
    const p = parseArgs("handoff", handoffArgs, call.arguments);
    if (!p.ok) return { output: p.error, ok: false };
    const toRole = p.value.toRole as AgentRole;
    if (toRole === a.dto.role) return { output: "Hand off to a different role, or do this part yourself.", ok: false };
    if (this.handoffDepth(t) + 1 > LIMITS.maxHandoffDepth) {
      return { output: `Handoff depth limit reached (${LIMITS.maxHandoffDepth}). Finish this part yourself or report the blocker in finish.`, ok: false };
    }
    if (this.tasks.size >= LIMITS.maxTasksPerRun) return { output: "The run has reached its task limit.", ok: false };
    if (toRole === "operator" && !(await this.automationAvailable())) return { output: "The operator is not available: local automation is off on this machine.", ok: false };
    const summary = bounded(p.value.summary || p.value.spec, 1200);
    const child = this.makeTask({
      title: p.value.title,
      spec: p.value.spec || p.value.title,
      acceptance: p.value.acceptance,
      role: toRole,
      deps: [],
      review: false,
      priority: t.dto.priority + 1,
      parentId: t.dto.id,
      createdBy: a.dto.id,
      assigneeId: null,
      kind: "handoff",
      handoff: summary,
    });
    const h: HandoffDTO = {
      id: this.ctx.clock.id(),
      runId: this.run.id,
      taskId: child.dto.id,
      fromAgentId: a.dto.id,
      toAgentId: null,
      toRole,
      summary,
      createdAt: this.ctx.clock.now(),
    };
    child.handoffId = h.id;
    this.handoffs.set(h.id, h);
    await this.insertTask(child);
    await this.repo.insertHandoff(h);
    await this.emit("handoff", { handoff: h }, a.dto.id, child.dto.id);
    await this.saveTask(t, { status: "waiting" });
    timer.stop();
    a.waiting = true;
    await this.setAgent(a, { status: "waiting", statusText: clip(`Waiting on ${ROLE_LABEL[toRole]}: ${child.dto.title}`, LIMITS.statusChars) });
    this.kick();
    await abortable<void>(signal, (resolve) => {
      if (isTerminal(child)) resolve();
      else child.waiters.push(resolve);
    });
    a.waiting = false;
    timer.start();
    await this.saveTask(t, { status: "running" });
    await this.setAgent(a, { status: "working", statusText: clip(t.dto.title, LIMITS.statusChars) });
    const who = child.dto.assigneeId ? this.agents.get(child.dto.assigneeId)?.dto.name : null;
    return {
      output: `Handoff to ${who ?? ROLE_LABEL[toRole]} (${toRole}) ended ${child.dto.status}: ${child.dto.resultSummary ?? "no summary"}`,
      ok: child.dto.status === "done",
    };
  }

  private async controlCreateTasks(a: LiveAgent, t: LiveTask, call: ToolCall): Promise<ControlOut> {
    const p = parseArgs("create_tasks", createTasksArgs, call.arguments);
    if (!p.ok) return { output: p.error, ok: false };
    const planned = p.value.tasks;
    if (planned.length > LIMITS.maxTasksPerCall) return { output: `At most ${LIMITS.maxTasksPerCall} tasks per call. Split the plan.`, ok: false };
    if (this.tasks.size + planned.length > LIMITS.maxTasksPerRun) return { output: `The run would exceed ${LIMITS.maxTasksPerRun} tasks.`, ok: false };
    if (planned.some((x) => x.role === "operator") && !(await this.automationAvailable())) {
      return { output: "The operator role is not available: local automation is off on this machine. Plan without it.", ok: false };
    }
    const ids = planned.map(() => this.ctx.clock.id());
    const resolved = resolveDeps(planned, ids, [...this.tasks.values()].map((x) => ({ id: x.dto.id, title: x.dto.title })));
    if (!resolved.ok) return { output: resolved.error, ok: false };
    const lines: string[] = [];
    for (let i = 0; i < planned.length; i++) {
      const x = planned[i]!;
      const task = this.makeTask({
        id: ids[i],
        title: x.title,
        spec: x.spec || x.title,
        acceptance: x.acceptance,
        role: x.role,
        deps: resolved.deps[i]!,
        review: x.review,
        priority: x.priority,
        parentId: t.dto.id,
        createdBy: a.dto.id,
        assigneeId: null,
        kind: "work",
      });
      await this.insertTask(task);
      const after = task.dto.deps.map((d) => this.tasks.get(d)?.dto.title ?? d);
      lines.push(`- ${task.dto.id} ${task.dto.title} (${task.dto.role})${after.length ? ` after: ${after.join(", ")}` : ""}${task.dto.review ? " [review]" : ""}`);
    }
    this.kick();
    return { output: `Created ${planned.length} task${planned.length === 1 ? "" : "s"}:\n${lines.join("\n")}`, ok: true };
  }

  private async controlUpdateTask(self: LiveTask, call: ToolCall): Promise<ControlOut> {
    const p = parseArgs("update_task", updateTaskArgs, call.arguments);
    if (!p.ok) return { output: p.error, ok: false };
    const x = this.findTask(p.value.ref);
    if (!x) return { output: `Unknown task "${p.value.ref}". Use an id from list_tasks.`, ok: false };
    if (x === self) return { output: "You cannot update the task you are working on. Call finish instead.", ok: false };
    const changes: Partial<TaskDTO> = {};
    const now = this.ctx.clock.now();
    if (p.value.priority !== undefined) changes.priority = Math.max(-1000, Math.min(1000, Math.round(p.value.priority)));
    const editing = p.value.title !== undefined || p.value.spec !== undefined || p.value.acceptance !== undefined;
    if (editing) {
      if (x.dto.status !== "queued" && x.dto.status !== "ready") return { output: "Only queued or ready tasks can be edited.", ok: false };
      if (p.value.title) changes.title = bounded(p.value.title, 200);
      if (p.value.spec !== undefined) changes.spec = bounded(p.value.spec, 8000);
      if (p.value.acceptance) changes.acceptance = p.value.acceptance.map((s) => bounded(s, 400)).slice(0, 12);
    }
    if (p.value.note) x.notes.push(`Lead: ${bounded(p.value.note, LIMITS.noteChars)}`);
    const st = p.value.status;
    if (st === "cancelled" || st === "cancel" || st === "canceled") {
      if (x.dto.status === "done") return { output: "That task is already done.", ok: false };
      const ctl = x.ctl;
      await this.saveTask(x, { ...changes, status: "cancelled", endedAt: now });
      ctl?.abort(new Halt("task_cancelled"));
      await this.closeChildren(x, "cancelled by the lead");
      await this.releaseTarget(x, "cancelled by the lead");
    } else if (st === "queued" || st === "requeue" || st === "retry") {
      if (!["failed", "blocked", "cancelled"].includes(x.dto.status)) return { output: "Only failed, blocked or cancelled tasks can be requeued.", ok: false };
      x.rounds = 0;
      x.reviewNotes = [];
      await this.saveTask(x, { ...changes, status: "queued", resultSummary: null, endedAt: null });
    } else if (st !== undefined) {
      return { output: "status can be cancelled or queued.", ok: false };
    } else if (Object.keys(changes).length) {
      await this.saveTask(x, changes);
    }
    this.kick();
    return { output: `Updated ${x.dto.title} (${x.dto.status}).`, ok: true };
  }
}
