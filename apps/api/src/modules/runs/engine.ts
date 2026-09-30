// One async controller per run: the scheduler, the agent loop, handoffs, the
// review loop, guards, budgets, mood and every state change the UI renders.
// The engine is the single writer of its run's agents and tasks while it is
// live; every change is persisted first, then published as an event.
//
// The brain rides on the same loop: work, verify, self-critique, fix per task
// (an evidence-first reflexion check before a finish is accepted, at most two
// extra rounds, an adaptive step budget); strategy addenda per role and per
// cat, tuned when they underperform and adopted by runtime JEV; dynamic roles
// defined from context; an unlimited org where any cat can hire helpers and
// the CEO lets a struggling cat go; the run tracker (run.stage).
//
// A run belongs to a company kind (studio by default, or fund): the company
// template seeds its specialist roles, guides the CEO's plan, titles the
// CEO, writes the final report spec and maps the tracker onto its stages.
// Tool calls carry the company, the cat's role key, its capability grants
// and the approval path for sensitive connector tools (the CEO decides crew
// requests, the owner the rest).
import {
  ACTIVITY_LABEL,
  ROLE_LABEL,
  TIERS,
  activityForStatus,
  activityForTool,
  assignCoat,
  leadCatName,
  pickCatName,
  type AgentDTO,
  type AgentRole,
  type BudgetBody,
  type CompanyKind,
  type CallPurpose,
  type ContextXrayDTO,
  type EventMap,
  type EventType,
  type HandoffDTO,
  type HumanMessageBody,
  type LessonDTO,
  type MeetingDTO,
  type MeetingKind,
  type RoleDTO,
  type RunDTO,
  type RunStage,
  type Risk,
  type Severity,
  type StrategyVersionDTO,
  type TaskDTO,
  type TaskPatchBody,
  type TaskStatus,
  type Tier,
  type UsageTotals,
} from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import { LlmError, type ChatRequest, type ChatResult, type Logger, type ResolvedModel, type ToolCall, type ToolSpec, type Usage } from "../../core/ports";
import type { ContextBuild, ContextInput, StepRecord, ToolContext, ToolResult } from "../../core/services";
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
  type PlannedTask,
} from "./controls";
import {
  CEO_SYSTEM,
  COMPANY,
  MEETING_TITLE,
  ceoPacket,
  kickoffText,
  meetingHoldMs,
  meetingLine,
  ownerOnly,
  parseCeoReply,
  syncText,
  wrapupText,
  type CeoVerdict,
  type SyncNext,
} from "./company";
import { EvidenceLog, REFLEXION, REFLEXION_SYSTEM, StepBudget, initialSteps, parseReflexion, precheck, reflexionPacket, type Evidence, type Verdict } from "./brain";
import { createBrainJudge, planAdopt, planHire, planLetGo, planRole, type BrainJudge } from "./judge";
import { ORG, budgetLeftShare, canAffordHire, depthOf, hireReason, letGoReason, type BudgetView, type HireKind } from "./org";
import { LIMITS, OUTPUT_CAP, RepeatGuard, TITLES, bounded, moodFor, roleCap, withArticle } from "./policy";
import {
  BRAIN_DEFAULTS,
  brainOf,
  type BrainMemory,
  type BrainOptions,
  type CompanyTemplateView,
  type OutcomeKind,
  type RunsDeps,
  type StageTaskView,
  type StrategySubject,
  type ToolExtras,
} from "./ports";
import { emptyUsage, progressOf, type MindSnapshot, type RunsRepo } from "./repo";
import {
  ARCHETYPES,
  ROLE_GEN,
  ROLE_SYSTEM,
  archetypeTools,
  baseRoleOf,
  closestRole,
  fallbackCharter,
  parseRoleReply,
  roleCharterText,
  rolePacket,
  roleSlug,
  roleTitle,
  toolSubset,
} from "./roles";
import { stageFromBoard, stageMoves } from "./stage";
import { VOICE, batchLine, statusLine, thinkingLine, toolLine } from "./voice";

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
  /** a handoff child whose hire runtime JEV already approved (orch.hire) */
  hireOk: boolean;
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
  /** the most recent failure, for the let-go reason */
  lastFailure: string | null;
  /** recent failure causes, newest first (coaching and the let-go decision read them) */
  failures: string[];
  /** tasks it finished well in this run */
  done: number;
  /** runtime JEV answered coach once already */
  coached: boolean;
  /** the failure count the let-go question was last asked at */
  askedAt: number;
  /** what the latest prompt carried, for the mind panel */
  mind: MindSnapshot | null;
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

interface Hire {
  kind: HireKind;
  reason: string;
  /** the hiring cat: the CEO, or the cat that asked for help */
  by: LiveAgent | null;
  /** the new cat's place in the org: its parent (the CEO for plan hires, the asking cat for helpers) */
  parent: LiveAgent | null;
}

/** The owner's org settings for this run. */
export interface OrgSettings {
  ceoName: string;
  /** cats in the run at most, the CEO included; 0 = unlimited */
  maxAgents: number;
  /** levels below the CEO; 0 = unlimited */
  maxDepth: number;
}

export const DEFAULT_ORG: OrgSettings = { ceoName: "Oyen", maxAgents: 0, maxDepth: 0 };

/** The dynamic-role part of a context build, on top of ContextInput (the context module reads these fields). */
interface BrainLayers {
  roleKey: string;
  charter: { version: number; title: string; text: string } | null;
  addenda: Array<{ scope: "role" | "agent"; version: number; text: string }>;
}

interface Brief {
  goal: string;
  projectName: string;
  workspaceDigest: string;
  history: string | null;
}

export interface EngineHooks {
  onSeq(runId: string, seq: number): void;
  /** the run ended in this process; its meetings are handed over for later snapshots */
  onClosed(runId: string, meetings: MeetingDTO[]): void;
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
  /** hydrate: meetings rebuilt from the event log, when the service has one */
  meetings?: MeetingDTO[];
  /** the owner's org settings (CEO name, maxAgents, maxDepth); defaults when absent */
  org?: Partial<OrgSettings>;
}

const TERMINAL_TASK: ReadonlySet<TaskStatus> = new Set(["done", "failed", "blocked", "cancelled"]);
export const TERMINAL_RUN: ReadonlySet<RunDTO["status"]> = new Set(["done", "failed", "stopped"]);
const NUDGE = "System: reply with a tool call. When the task is complete, call finish with a short summary of the result.";
/** an owner reply that approves a tool call */
const OWNER_YES = /^\s*(yes|y|approve|approved|ok|okay|go|go ahead|sure|allow|allowed)\b/i;

/** The company kind of a run; anything unknown reads as studio. */
export function companyOf(run: Pick<RunDTO, "company">): CompanyKind {
  return run.company === "fund" ? "fund" : "studio";
}

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

/** setTimeout that rejects with the signal's reason on abort and clears its timer. */
function sleepFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
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

/** The strategy addendum cap the JEV plan checks (context STRATEGY_MAX_TOKENS). */
const REFLEXION_STRATEGY_CAP = 120;

/** Why a lesson is in a cat's head: its scope and its track record. */
function lessonReason(l: LessonDTO): string {
  const scope = l.scope === "global" ? "A crew-wide lesson" : l.scope === "role" ? `A lesson for every ${l.role ?? "crew"} cat` : "A lesson from this project";
  const record = l.uses > 0 ? `, ${l.wins} of ${l.uses} uses went well` : ", not used yet";
  return `${scope} that matches this task${record}.`;
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
  private readonly meetings: MeetingDTO[] = [];
  /** cats sitting in a meeting right now: agent id -> meeting id */
  private readonly seated = new Map<string, string>();
  /** kickoff and wrap-up hold every dispatch until the meeting ends */
  private holds = 0;
  private kickedOff = false;
  private wrapping = false;

  private ticking = false;
  private dirty = false;
  private finishing = false;
  private closed = false;
  private finalReports = 0;
  /** the most recent task event: the run can only end right after the lead's final report is done */
  private lastEvent: "final_done" | "lead_failed" | "other" = "other";
  private leadFailure: string | null = null;
  private brief: Brief | null = null;
  private history: string | null | undefined = undefined;
  private digestStale = true;

  // ------------------------------------------------------------ brain
  private readonly brain: BrainMemory | null;
  private readonly opts: BrainOptions;
  private readonly org: OrgSettings;
  private readonly judge: BrainJudge;
  /** dynamic roles of the project, by id */
  private readonly roles = new Map<string, RoleDTO>();
  private rolesCreated = 0;
  /** active strategy per subject ("role:<key>", "agent:<id>"), as last read or adopted */
  private readonly strategies = new Map<string, StrategyVersionDTO | null>();
  /** subjects with a tuning pass in flight: a role's dispatch (or a coached cat) waits for the result */
  private readonly tuning = new Map<string, Promise<void>>();
  /** runtime JEV orch.hire answers for queue hires, per role key, pool size and queue length */
  private readonly hireMemo = new Map<string, "hire" | "self" | "wait">();
  private departures = 0;
  /** role key -> the name of the last cat of that role that was let go (for the replacement's reason) */
  private readonly leftByRole = new Map<string, string>();
  /** a company's stages are wider than RunStage (the fund tracker): the event carries the string */
  private stage: string | null = null;
  private readonly company: CompanyKind;
  /** the company template; null for a studio run or when no catalog is wired */
  private readonly template: CompanyTemplateView | null;

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
    this.brain = brainOf(init.deps.memory);
    this.opts = { ...BRAIN_DEFAULTS, ...(init.deps.brain ?? {}) };
    this.company = companyOf(init.run);
    this.template = this.company !== "studio" && init.deps.companies ? init.deps.companies.template(this.company) : null;
    this.org = {
      ceoName: leadCatName(init.org?.ceoName ?? DEFAULT_ORG.ceoName),
      maxAgents: Math.max(0, Math.floor(init.org?.maxAgents ?? 0)),
      maxDepth: Math.max(0, Math.floor(init.org?.maxDepth ?? 0)),
    };
    this.judge = createBrainJudge({
      judge: init.deps.judge ?? init.deps.llm.judge ?? null,
      kv: init.ctx.kv,
      clock: init.ctx.clock,
      log: this.log,
      save: (row) => (this.closed ? Promise.resolve() : this.repo.insertBrainDecision(row)),
      publish: (decision, agentId) => this.emit("decision", { decision }, agentId, null),
    });
  }

  // ------------------------------------------------------- construction
  /** A brand new run: publishes run.created, spawns the lead, creates the plan task, starts. */
  static async start(init: EngineInit): Promise<RunEngine> {
    const e = new RunEngine(init);
    await e.emit("run.created", { run: e.view });
    const automation = await e.automationAvailable();
    const roles = (Object.keys(ROLE_LABEL) as AgentRole[]).filter((r) => r !== "lead" && (automation || r !== "operator"));
    await e.seedCompanyRoles();
    await e.loadRoles();
    const known = [...e.roles.values()].slice(0, 8).map((r) => `${r.title} (${r.archetype})`);
    const planSpec = [
      `Goal: ${e.run.goal}`,
      `Plan the work for the crew. Call create_tasks once with at most ${LIMITS.maxTasksPerCall} small, verifiable tasks:`,
      "title, spec, acceptance (a short list), role, deps (keys or positions of earlier tasks) and review (true for code changes).",
      `Roles: ${roles.join(", ")}.`,
      ...(e.opts.org
        ? [
            `For a specialist the roles do not name, add role_title (for example "Accessibility auditor") next to the closest role.${known.length ? ` Specialists this project already has: ${known.join(", ")}.` : ""}`,
          ]
        : []),
      ...(e.template ? e.template.planGuide : []),
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
    const lead = await e.spawnAgent("lead", plan, { kind: "lead", reason: hireReason("lead", ROLE_LABEL.lead), by: null, parent: null });
    plan.dto.assigneeId = lead.dto.id;
    await e.insertTask(plan);
    await e.advanceStage("goal", `${lead.dto.name} has the goal`);
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
    for (const a of agents) e.agents.set(a.id, e.liveAgent(a));
    await e.loadRoles([...agents.map((a) => a.roleId), ...tasks.map((t) => t.roleId)]);
    for (const dto of tasks) {
      const h = byChild.get(dto.id);
      const kind: TaskKind =
        dto.role === "lead" && dto.title === TITLES.plan
          ? "plan"
          : dto.role === "lead" && (dto.title.startsWith(TITLES.final) || dto.title.startsWith(TITLES.legacyFinal))
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
        hireOk: kind === "handoff",
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
    // a meeting cut by the restart is over: nobody is in the room any more
    const at = init.ctx.clock.now();
    for (const m of init.meetings ?? []) e.meetings.push(m.endedAt === null ? { ...m, endedAt: at } : m);
    e.kickedOff = e.meetings.some((m) => m.kind === "kickoff") || [...e.tasks.values()].some((t) => t.kind === "plan" && t.dto.status === "done");
    const lastEnded = [...e.tasks.values()]
      .filter((t) => t.dto.endedAt !== null)
      .sort((x, y) => (y.dto.endedAt ?? 0) - (x.dto.endedAt ?? 0))[0];
    if (lastEnded?.kind === "final" && lastEnded.dto.status === "done") e.lastEvent = "final_done";
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
    e.departures = agents.filter((a) => a.leftReason).length;
    for (const a of agents) if (a.leftReason) e.leftByRole.set(e.keyOf(a), a.name);
    e.stage = e.boardStage();
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

  meetingList(): MeetingDTO[] {
    return this.meetings.map((m) => ({ ...m, agentIds: [...m.agentIds], agenda: [...m.agenda], notes: [...m.notes] }));
  }

  /** dynamic roles this run uses (by its agents or tasks) */
  roleList(): RoleDTO[] {
    const used = new Set<string>();
    for (const a of this.agents.values()) if (a.dto.roleId) used.add(a.dto.roleId);
    for (const t of this.tasks.values()) if (t.dto.roleId) used.add(t.dto.roleId);
    return [...used].map((id) => this.roles.get(id)).filter((r): r is RoleDTO => !!r);
  }

  get stageNow(): RunStage {
    // a fund stage ("backtest") rides in the RunStage slot of the wire types
    return (this.stage ?? this.boardStage()) as RunStage;
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
    this.hooks.onClosed(this.run.id, this.meetingList());
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

  // ------------------------------------------------------ brain helpers
  private liveAgent(dto: AgentDTO): LiveAgent {
    return {
      dto,
      lastFailure: null,
      failures: [],
      done: 0,
      coached: false,
      askedAt: 0,
      mind: null,
      busy: false,
      waiting: false,
      ctl: null,
      consecutiveFailures: 0,
      cleanSteps: 0,
      justPassed: false,
      humanWait: null,
    };
  }

  /** Pool key of an agent or a task: its dynamic role's key, else its base role. */
  private keyOf(x: { role: AgentRole; roleId?: string | null }): string {
    const r = x.roleId ? this.roles.get(x.roleId) : undefined;
    return r ? r.key : x.role;
  }

  private titleOf(x: { role: AgentRole; roleId?: string | null }): string {
    const r = x.roleId ? this.roles.get(x.roleId) : undefined;
    return r ? r.title : ROLE_LABEL[x.role];
  }

  /** The project's dynamic roles, plus any by id (a role another project run created). */
  private async loadRoles(ids: Array<string | null | undefined> = []): Promise<void> {
    try {
      for (const r of await this.repo.projectRoles(this.project.id)) this.roles.set(r.id, r);
      const missing = ids.filter((id): id is string => !!id && !this.roles.has(id));
      if (missing.length) for (const r of await this.repo.rolesByIds(missing)) this.roles.set(r.id, r);
    } catch (e) {
      this.log.log("warn", "roles load failed", { error: redact(errMsg(e)) });
    }
  }

  private boardStage(): string {
    if (this.template && this.deps.companies) {
      const tasks = [...this.tasks.values()].map((t) => ({ ...this.stageTask(t), status: t.dto.status }));
      const s = this.deps.companies.boardStage(this.company, tasks, this.run.status);
      if (s) return s;
    }
    const board = [...this.tasks.values()].map((t) => ({ role: t.dto.role, status: t.dto.status, kind: t.kind }));
    return stageFromBoard(board, this.run.status, [...this.agents.values()].filter(alive).length);
  }

  private stageTask(t: LiveTask): StageTaskView {
    return { title: t.dto.title, roleKey: this.keyOf(t.dto), archetype: t.dto.role, kind: t.kind };
  }

  /**
   * Moves the tracker (forward only, or back to working after a failed review) and publishes run.stage.
   * A company template maps the studio beat (and the task that started) onto its own stages.
   */
  private async advanceStage(next: RunStage, reason: string, loopBack = false, task?: LiveTask): Promise<void> {
    let target: string = next;
    if (this.template && this.deps.companies) {
      const mapped = this.deps.companies.mapStage(this.company, next, task ? this.stageTask(task) : null);
      if (!mapped || !this.deps.companies.stageMoves(this.company, this.stage, mapped, loopBack)) return;
      target = mapped;
    } else if (!stageMoves(this.stage as RunStage | null, next, loopBack)) return;
    const previous = this.stage;
    this.stage = target;
    await this.emit("run.stage", { stage: target as RunStage, previous: previous as RunStage | null, reason: bounded(reason, 160) });
  }

  /** A company template's specialists become the project's dynamic roles (once per project), with the template charters. */
  private async seedCompanyRoles(): Promise<void> {
    const t = this.template;
    if (!t || t.roles.length === 0) return;
    let existing: RoleDTO[] = [];
    try {
      existing = await this.repo.projectRoles(this.project.id);
    } catch (e) {
      this.log.log("warn", "roles read failed", { error: redact(errMsg(e)) });
      return;
    }
    for (const r of t.roles) {
      if (existing.some((x) => x.key === r.key)) continue;
      const now = this.ctx.clock.now();
      const role: RoleDTO = {
        id: this.ctx.clock.id(),
        projectId: this.project.id,
        runId: this.run.id,
        key: r.key,
        title: r.title,
        archetype: r.archetype,
        charter: roleCharterText(r.title, r.archetype, r.charter),
        charterVersion: 1,
        tools: toolSubset(r.archetype, r.tools),
        reason: bounded(`${t.label} template: the ${r.title} role`, ROLE_GEN.reasonChars),
        createdBy: null,
        createdAt: now,
      };
      try {
        await this.repo.insertRole(role, now, null);
        await this.emit("role.created", { role, reason: role.reason, byAgentId: null });
      } catch (e) {
        this.log.log("warn", "company role insert failed", { role: r.key, error: redact(errMsg(e)) });
      }
    }
  }

  /** Capability tools the company grants this cat (trading); none in a studio run. */
  private grantsOf(a: LiveAgent): string[] {
    if (!this.template || !this.deps.companies) return [];
    return this.deps.companies.grantsFor(this.company, this.keyOf(a.dto), a.dto.role);
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

  /**
   * Persist and publish agent.status whenever status, activity, mood, text or task change.
   * `boundary` publishes even without a visible change: every step boundary reaches the UI.
   */
  private async setAgent(
    a: LiveAgent,
    patch: Partial<Pick<AgentDTO, "status" | "activity" | "statusText" | "currentTaskId" | "steps">>,
    boundary = false,
  ): Promise<void> {
    if (this.closed) return;
    if (patch.statusText) patch = { ...patch, statusText: statusLine(patch.statusText, LIMITS.statusChars) };
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
    if (!visible && !boundary && next.steps === prev.steps) return;
    next.updatedAt = this.ctx.clock.now();
    await this.repo.saveAgentState(next);
    if (visible || boundary) {
      await this.emit(
        "agent.status",
        { status: next.status, activity: next.activity, mood: next.mood, statusText: next.statusText, taskId: next.currentTaskId },
        next.id,
        next.currentTaskId,
      );
    }
  }

  /**
   * Hires one cat for `forTask`'s role (its dynamic role when it has one).
   * The CEO is named from the owner's ceoName (Oyen by default); every other
   * cat gets a cute name no one in this run has. Its parent is the cat that
   * hired it, so the org can grow to any depth.
   */
  private async spawnAgent(role: AgentRole, forTask: LiveTask, hire: Hire): Promise<LiveAgent> {
    const id = this.ctx.clock.id();
    const crew = [...this.agents.values()];
    const taken = new Set(crew.map((a) => a.dto.name));
    const name = pickCatName(id, role, taken, this.org.ceoName);
    // the lead is always ginger; everyone else wears a coat no one in this run has
    const look = assignCoat(id, role, crew.map((a) => a.dto.look.coat));
    const dyn = role !== "lead" && forTask.dto.roleId ? (this.roles.get(forTask.dto.roleId) ?? null) : null;
    let tier: Tier = "balanced";
    try {
      const target = forTask.targetId ? this.tasks.get(forTask.targetId) : undefined;
      const failures = target ? target.rounds : 0;
      const r = await this.deps.decisions.modelTier({
        runId: this.run.id,
        role,
        task: { title: forTask.dto.title, spec: forTask.dto.spec, acceptance: forTask.dto.acceptance },
        signals: { priorFailures: failures, risk: role === "security" || role === "operator", files: 0 },
        available: [...TIERS],
      });
      tier = r.tier;
    } catch (e) {
      this.log.log("warn", "modelTier failed, using balanced", { error: redact(errMsg(e)) });
    }
    const now = this.ctx.clock.now();
    const lead = this.lead() ?? null;
    const parent = role === "lead" ? null : (hire.parent ?? lead);
    const dto: AgentDTO = {
      id,
      runId: this.run.id,
      parentId: parent?.dto.id ?? null,
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
      roleTitle: dyn ? dyn.title : role === "lead" && this.template?.leadTitle ? this.template.leadTitle : ROLE_LABEL[role],
      archetype: role,
      roleId: dyn?.id ?? null,
      hireReason: role === "lead" ? null : hire.reason,
      hiredBy: hire.by?.dto.id ?? null,
      leftReason: null,
    };
    const a = this.liveAgent(dto);
    this.agents.set(id, a);
    await this.repo.insertAgent(dto);
    await this.emit("agent.spawned", { agent: dto, reason: hire.reason, hiredBy: hire.by?.dto.id ?? null }, id, null);
    if (hire.by && hire.by !== a && role !== "lead") {
      await this.emit("agent.say", { text: clip(`Welcome aboard, ${name}. ${hire.reason}.`, LIMITS.sayChars), to: id }, hire.by.dto.id, forTask.dto.id);
    }
    return a;
  }

  private async markPass(a: LiveAgent): Promise<void> {
    a.justPassed = true;
    a.consecutiveFailures = 0;
    a.askedAt = 0;
    a.done++;
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
    /** a dynamic role; `role` is then its archetype */
    roleId?: string | null;
    hireOk?: boolean;
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
      roleId: input.roleId ?? null,
    };
    return {
      dto,
      kind: input.kind,
      hireOk: input.hireOk ?? false,
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
    // completeWork and failTask set final_done / lead_failed right after this
    this.lastEvent = "other";
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
    // a kickoff or wrap-up holds the floor: nobody starts work until it ends (it kicks on the way out)
    if (this.run.status !== "running" || this.finishing || this.holds > 0) return;
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
      // a role being tuned waits: its next task starts with the new strategy
      if (this.tuning.has(`role:${this.keyOf(t.dto)}`)) continue;
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

  /** A cat of the task's role (its dynamic role when it has one) that is free, or a new hire, or null (the task waits). */
  private async pickAgent(t: LiveTask): Promise<LiveAgent | null> {
    const key = this.keyOf(t.dto);
    const usable = (a: LiveAgent) => !a.busy && !this.seated.has(a.dto.id) && !this.tuning.has(`agent:${a.dto.id}`);
    if (t.dto.assigneeId) {
      const owner = this.agents.get(t.dto.assigneeId);
      if (owner && alive(owner) && this.keyOf(owner.dto) === key) return usable(owner) ? owner : null;
    }
    const pool = [...this.agents.values()].filter((a) => alive(a) && this.keyOf(a.dto) === key);
    const free = pool.find(usable);
    if (free) return free;
    // a cat of this role is in a meeting or being coached: wait for it instead of hiring another
    if (pool.some((a) => !a.busy)) return null;
    const hire = await this.hireFor(t, pool);
    if (!hire || t.dto.status !== "ready" || this.closed) return null;
    return this.spawnAgent(t.dto.role, t, hire);
  }

  // ---------------------------------------------------------- the org
  private budgetView(): BudgetView {
    const u = this.run.usage;
    return { budgetTokens: this.run.budgetTokens, usedTokens: u.inputTokens + u.outputTokens, budgetUsd: this.run.budgetUsd, usedUsd: u.costUsd };
  }

  private crewSize(): number {
    return [...this.agents.values()].filter(alive).length;
  }

  private depthOfAgent(a: LiveAgent | null): number {
    return a ? depthOf(a.dto.id, (id) => this.agents.get(id)?.dto.parentId) : 0;
  }

  /**
   * Whether a task with no free cat gets a new one, who hires it and why.
   *   the role has no cat: the plan (or an approved handoff) needs one, the CEO hires it
   *   an approved handoff to a busy role: the asking cat hires a helper below itself
   *   every cat of the role is busy and a slot is free: runtime JEV orch.hire, hire or wait
   * The owner's maxAgents is a hard cap; 0 is unlimited.
   */
  private async hireFor(t: LiveTask, pool: LiveAgent[]): Promise<Hire | null> {
    const role = t.dto.role;
    const title = this.titleOf(t.dto);
    const key = this.keyOf(t.dto);
    const lead = this.lead() ?? null;
    const creator = t.dto.createdBy ? (this.agents.get(t.dto.createdBy) ?? null) : null;
    if (!this.opts.org) {
      if (pool.length >= roleCap(role)) return null;
      if (pool.length > 0) return { kind: "queue", reason: hireReason("queue", title, { waiting: 1 }), by: lead, parent: lead };
      return t.kind === "handoff" && creator
        ? { kind: "handoff", reason: hireReason("handoff", title, { by: creator.dto.name, task: t.dto.title }), by: creator, parent: creator }
        : { kind: "needed", reason: hireReason("needed", title, { task: t.dto.title }), by: lead, parent: lead };
    }
    // the company has exactly one CEO
    if (role === "lead") return pool.length === 0 ? { kind: "lead", reason: hireReason("lead", ROLE_LABEL.lead), by: null, parent: null } : null;
    const crew = this.crewSize();
    if (this.org.maxAgents > 0 && crew >= this.org.maxAgents) return null;
    const asker = t.kind === "handoff" && t.hireOk && creator && creator !== lead ? creator : null;
    if (pool.length === 0) {
      const replaces = this.leftByRole.get(key);
      if (asker) return { kind: "handoff", reason: hireReason("handoff", title, { by: asker.dto.name, task: t.dto.title }), by: asker, parent: asker };
      if (replaces) return { kind: "replacement", reason: hireReason("replacement", title, { replaces, task: t.dto.title }), by: lead, parent: lead };
      return { kind: "needed", reason: hireReason("needed", title, { task: t.dto.title }), by: lead, parent: lead };
    }
    // optional hires only when a cat could start right now
    if (this.activeCount() >= this.maxConcurrent) return null;
    if (asker) return { kind: "helper", reason: hireReason("helper", title, { by: asker.dto.name, task: t.dto.title }), by: asker, parent: asker };
    const waiting = [...this.tasks.values()].filter((x) => x.dto.status === "ready" && this.keyOf(x.dto) === key).length;
    const memo = `${key}:${pool.length}:${Math.min(3, waiting)}`;
    let answer = this.hireMemo.get(memo);
    if (!answer) {
      const d = await this.judge.run(
        planHire({
          runId: this.run.id,
          kind: "queue",
          asker: lead ? { id: lead.dto.id, name: lead.dto.name, title: ROLE_LABEL.lead } : null,
          roleKey: key,
          role,
          title,
          task: { title: t.dto.title, spec: t.dto.spec },
          pool: pool.length,
          waiting,
          crew,
          maxAgents: this.org.maxAgents,
          depth: 1,
          maxDepth: this.org.maxDepth,
          affordable: canAffordHire(this.budgetView(), crew),
          budgetLeftShare: budgetLeftShare(this.budgetView()),
        }),
      );
      answer = d.result;
      this.hireMemo.set(memo, answer);
    }
    if (answer !== "hire") return null;
    return { kind: "queue", reason: hireReason("queue", title, { waiting }), by: lead, parent: lead };
  }

  /**
   * A cat asks to hand work off and no cat of the target role is free:
   * runtime JEV orch.hire decides whether to hire one or let the asker do it
   * itself. True means the handoff goes ahead.
   */
  private async approveHandoffHire(a: LiveAgent, toRole: AgentRole, roleId: string | null, title: string, spec: string): Promise<{ ok: boolean; why: string }> {
    if (!this.opts.org) return { ok: true, why: "" };
    const key = this.keyOf({ role: toRole, roleId });
    const pool = [...this.agents.values()].filter((x) => alive(x) && x !== a && this.keyOf(x.dto) === key);
    if (pool.some((x) => !x.busy && !this.seated.has(x.dto.id))) return { ok: true, why: "" };
    const crew = this.crewSize();
    const d = await this.judge.run(
      planHire({
        runId: this.run.id,
        kind: "handoff",
        asker: { id: a.dto.id, name: a.dto.name, title: this.titleOf(a.dto) },
        roleKey: key,
        role: toRole,
        title: this.titleOf({ role: toRole, roleId }),
        task: { title, spec },
        pool: pool.length,
        waiting: [...this.tasks.values()].filter((x) => x.dto.status === "ready" && this.keyOf(x.dto) === key).length,
        crew,
        maxAgents: this.org.maxAgents,
        depth: this.depthOfAgent(a) + 1,
        maxDepth: this.org.maxDepth,
        affordable: pool.length > 0 || canAffordHire(this.budgetView(), crew),
        budgetLeftShare: budgetLeftShare(this.budgetView()),
      }),
    );
    return { ok: d.result === "hire", why: d.decision.action };
  }

  /**
   * A crew cat with three failures in a row (JEV orch.playbooks) is idle:
   * runtime JEV orch.let_go decides to let it go, coach it (a strategy of its
   * own, tuned and adopted like a role's), or keep it. A cat let go leaves
   * the company; its open tasks and the work it failed go back on the board
   * for a replacement.
   */
  private async maybeLetGo(a: LiveAgent): Promise<void> {
    if (!this.opts.org || this.closed || this.finishing || this.run.status !== "running") return;
    if (!alive(a) || a.busy || a.dto.role === "lead" || this.seated.has(a.dto.id)) return;
    if (a.consecutiveFailures < ORG.askAfter || a.askedAt === a.consecutiveFailures) return;
    a.askedAt = a.consecutiveFailures;
    const crew = this.crewSize();
    const d = await this.judge.run(
      planLetGo({
        runId: this.run.id,
        agent: { id: a.dto.id, name: a.dto.name, title: this.titleOf(a.dto), role: a.dto.role },
        consecutive: a.consecutiveFailures,
        failures: a.failures,
        done: a.done,
        coached: a.coached,
        departures: this.departures,
        maxDepartures: ORG.maxDepartures,
        canReplace: canAffordHire(this.budgetView(), crew - 1),
      }),
    );
    if (d.result === "coach") {
      a.coached = true;
      const lead = this.lead();
      if (lead && lead !== a) await this.emit("agent.say", { text: clip(`${a.dto.name}, let us look at how you work before the next task.`, LIMITS.sayChars), to: a.dto.id }, lead.dto.id, null);
      if (this.opts.tuning) this.startTuning({ kind: "agent", key: a.dto.id, role: a.dto.role, title: this.titleOf(a.dto) }, a);
      return;
    }
    if (d.result !== "let_go" || !alive(a) || a.busy || this.closed) return;
    await this.letGo(a);
  }

  private async letGo(a: LiveAgent): Promise<void> {
    this.departures++;
    const reason = letGoReason(a.consecutiveFailures, a.lastFailure);
    const lead = this.lead() ?? null;
    a.dto = { ...a.dto, leftReason: reason };
    await this.setAgent(a, { status: "stopped", currentTaskId: null, statusText: VOICE.leaving });
    const requeued: string[] = [];
    for (const t of [...this.tasks.values()]) {
      if (t.dto.assigneeId !== a.dto.id) continue;
      const open = t.dto.status === "queued" || t.dto.status === "ready";
      // the work it failed goes back too, for the replacement to redo
      const failed = t.kind === "work" && (t.dto.status === "failed" || (t.dto.status === "blocked" && !this.isDepBlocked(t)));
      if (!open && !failed) continue;
      t.failReason = null;
      await this.saveTask(t, { status: "queued", assigneeId: null, ...(failed ? { resultSummary: null, endedAt: null } : {}) });
      requeued.push(t.dto.id);
    }
    this.leftByRole.set(this.keyOf(a.dto), a.dto.name);
    await this.emit("agent.left", { agentId: a.dto.id, reason, byAgentId: lead?.dto.id ?? null, requeued }, a.dto.id, null);
    if (lead) await this.emit("agent.say", { text: clip(`${a.dto.name}, thank you for your work here. ${reason}.`, LIMITS.sayChars), to: a.dto.id }, lead.dto.id, null);
    this.kick();
  }

  // -------------------------------------------------------- learning
  /** One outcome of a cat's role (its dynamic role key when it has one); any role that underperforms gets tuned, the CEO's too. */
  private async roleOutcome(a: LiveAgent, t: LiveTask, outcome: "win" | "loss", kind: OutcomeKind, cause: string): Promise<void> {
    if (this.closed) return;
    if (outcome === "loss") a.failures = [bounded(`${kind.replace("_", " ")}: ${t.dto.title}${cause ? `: ${cause}` : ""}`, 240), ...a.failures].slice(0, 5);
    if (!this.brain) return;
    try {
      const r = await this.brain.recordRoleOutcome({
        role: this.keyOf(a.dto),
        runId: this.run.id,
        taskId: t.dto.id,
        agentId: a.dto.id,
        outcome,
        kind,
        cause: bounded(cause ? `${t.dto.title}: ${cause}` : t.dto.title, 300),
      });
      if (r.tuneDue && this.opts.tuning) this.startTuning({ kind: "role", key: this.keyOf(a.dto), role: a.dto.role, title: a.dto.roleId ? this.titleOf(a.dto) : null }, null);
    } catch (e) {
      this.log.log("warn", "role outcome record failed", { error: redact(errMsg(e)) });
    }
  }

  /** One tuning pass per subject at a time, tracked like a task loop (the run waits for it before it ends). */
  private startTuning(subject: StrategySubject, about: LiveAgent | null): void {
    const k = `${subject.kind}:${subject.key}`;
    if (!this.brain || this.tuning.has(k) || this.closed || this.finishing) return;
    const p = this.tune(subject, about).finally(() => {
      this.tuning.delete(k);
      this.kick();
    });
    this.tuning.set(k, p);
    this.track(p);
  }

  /**
   * Autonomous prompt engineering: one fast-tier candidate addendum from the
   * subject's failures, scored offline by the evals replay against the
   * current one, then runtime JEV prompt.adopt answers adopt, keep or merge.
   * An adopted version reaches the subject's very next step.
   */
  private async tune(subject: StrategySubject, about: LiveAgent | null): Promise<void> {
    const brain = this.brain;
    if (!brain) return;
    const lead = this.lead();
    const title = subject.title ?? ROLE_LABEL[subject.role];
    const who = subject.kind === "agent" && about ? about.dto.name : `the ${title.toLowerCase()} role`;
    if (lead && !lead.busy && !this.seated.has(lead.dto.id)) await this.setAgent(lead, { statusText: subject.kind === "agent" && about ? VOICE.coaching(about.dto.name) : VOICE.tuning(who) });
    const proposal = await brain.proposeStrategy({
      subject,
      runId: this.run.id,
      context: this.deps.context,
      specsFor: (r) => this.deps.tools.specsFor(r),
      ...(subject.kind === "agent" && about ? { cases: about.failures.map((f) => ({ outcome: "loss" as const, kind: "agent", cause: f })) } : {}),
      signal: this.runAbort.signal,
    });
    if (!proposal || this.closed) return;
    // the candidate call was billed by the memory module: the run's totals and budget count it too
    if (proposal.call) await this.addRunTotals({ ...proposal.call, calls: 1 });
    const d = await this.judge.run(
      planAdopt({
        runId: this.run.id,
        agentId: about?.dto.id ?? null,
        subject: subject.kind,
        subjectKey: subject.key,
        role: subject.role,
        title,
        current: proposal.current ? { version: proposal.current.version, text: proposal.current.text } : null,
        candidate: proposal.candidate,
        merged: proposal.merged,
        evidence: proposal.evidence,
        causes: proposal.causes,
        ruleAdopt: proposal.eval.adopt,
        capTokens: REFLEXION_STRATEGY_CAP,
      }),
    );
    const saved = await brain.applyStrategy({
      proposal,
      choice: d.result,
      decision: { id: d.decision.id, confidence: d.decision.confidence, verified: d.decision.verified, stamp: d.decision.stamp },
      reason: d.decision.action,
    });
    if (saved.status !== "active" || this.closed) return;
    this.strategies.set(`${subject.kind}:${subject.key}`, saved);
    const choice = d.result === "merge" ? "merge" : "adopt";
    await this.emit(
      "strategy.updated",
      {
        subject: subject.kind,
        subjectKey: subject.key,
        role: subject.role,
        roleTitle: title,
        version: saved.version,
        previousVersion: proposal.current?.version ?? null,
        text: saved.text,
        choice,
        reason: bounded(saved.reason || proposal.eval.reason, 300),
        scores: { current: proposal.evidence.scores.current, candidate: proposal.evidence.scores.candidate },
      },
      about?.dto.id ?? lead?.dto.id ?? null,
      null,
    );
    if (lead) {
      const first = saved.text.split("\n")[0]?.replace(/^[-*\s]+/, "") ?? "";
      const to = subject.kind === "agent" && about ? about.dto.id : null;
      await this.emit("agent.say", { text: clip(`New ${who} playbook v${saved.version}: ${first}`, LIMITS.sayChars), to }, lead.dto.id, null);
      if (!lead.busy && !this.seated.has(lead.dto.id)) await this.setAgent(lead, { statusText: VOICE.playbook(subject.kind === "agent" && about ? about.dto.name : title.toLowerCase(), saved.version) });
    }
  }

  /**
   * A cat asked for a specialist title. Runtime JEV orch.role decides new or
   * existing and the archetype; a new role gets one fast-tier charter call
   * (capped) and a tool subset of its archetype. Null keeps the task on its
   * base role.
   */
  private async resolveRole(by: LiveAgent, requested: AgentRole, raw: string, task: { title: string; spec: string }, signal: AbortSignal): Promise<{ role: AgentRole; roleId: string | null } | null> {
    if (!this.opts.org) return null;
    const title = roleTitle(raw);
    if (!title || baseRoleOf(title)) return null;
    const key = roleSlug(title);
    if (!key) return null;
    const known = [...this.roles.values()].find((r) => r.key === key);
    if (known) return { role: known.archetype, roleId: known.id };
    const automation = await this.automationAvailable();
    const archetypes = ARCHETYPES.filter((r) => automation || r !== "operator");
    const d = await this.judge.run(
      planRole({
        runId: this.run.id,
        agentId: by.dto.id,
        goal: this.run.goal,
        title,
        key,
        requested: requested === "lead" ? "engineer" : requested,
        task,
        existing: [...this.roles.values()].map((r) => ({ key: r.key, title: r.title, archetype: r.archetype })),
        archetypes,
        created: this.rolesCreated,
        cap: ROLE_GEN.maxPerRun,
      }),
    );
    const archetype = d.result.archetype;
    if (d.result.need === "existing") {
      const close = d.result.reuse ? [...this.roles.values()].find((r) => r.key === d.result.reuse) : closestRole(title, archetype, [...this.roles.values()]);
      return close ? { role: close.archetype, roleId: close.id } : { role: archetype, roleId: null };
    }
    await this.setAgent(by, { statusText: VOICE.definingRole(title) });
    const tools = archetypeTools(archetype);
    let charter = fallbackCharter(title, archetype, task);
    let subset = tools;
    try {
      const fast = await this.deps.llm.resolve({ tier: "fast", role: archetype });
      const res = await fast.provider.chat({
        model: fast.model,
        system: ROLE_SYSTEM,
        messages: [{ role: "user", content: rolePacket({ goal: this.run.goal, title, archetype, task, tools }) }],
        maxOutputTokens: ROLE_GEN.outputTokens,
        temperature: 0,
        responseFormat: "json",
        signal,
      });
      const planTask = by.dto.currentTaskId ? this.tasks.get(by.dto.currentTaskId) : undefined;
      if (planTask) await this.recordUsage(by, planTask, fast.provider.id, res.model || fast.model, "plan", res.usage, res.latencyMs, res.retries, true, null);
      const parsed = parseRoleReply(res.text);
      if (parsed) {
        charter = roleCharterText(title, archetype, parsed.lines);
        subset = toolSubset(archetype, parsed.tools);
      }
    } catch (e) {
      if (signal.aborted) throw signal.reason;
      this.log.log("warn", "role charter call failed, using the default charter", { error: redact(errMsg(e)) });
    }
    const now = this.ctx.clock.now();
    const role: RoleDTO = {
      id: this.ctx.clock.id(),
      projectId: this.project.id,
      runId: this.run.id,
      key,
      title,
      archetype,
      charter,
      charterVersion: 1,
      tools: subset,
      reason: bounded(`${by.dto.name} asked for ${withArticle(title)} for ${task.title}`, ROLE_GEN.reasonChars),
      createdBy: by.dto.id,
      createdAt: now,
    };
    try {
      await this.repo.insertRole(role, now, d.decision.id);
    } catch (e) {
      // another run of the project defined the same key meanwhile: use that one
      await this.loadRoles();
      const other = [...this.roles.values()].find((r) => r.key === key);
      if (other) return { role: other.archetype, roleId: other.id };
      this.log.log("warn", "role insert failed", { error: redact(errMsg(e)) });
      return { role: archetype, roleId: null };
    }
    this.roles.set(role.id, role);
    this.rolesCreated++;
    await this.emit("role.created", { role, reason: role.reason, byAgentId: by.dto.id }, by.dto.id, null);
    return { role: archetype, roleId: role.id };
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
    // done only when the lead's final report is the last thing that ended, after every other task ended
    if (this.lastEvent === "final_done") {
      const bad = [...this.tasks.values()].filter((t) => t.dto.status === "failed" || t.dto.status === "blocked").length;
      return this.finishRun("done", bad > 0 ? `${bad} task${bad === 1 ? "" : "s"} failed or blocked` : null);
    }
    if (this.lastEvent === "lead_failed") return this.finishRun("failed", bounded(`Lead task failed: ${this.leadFailure ?? "unknown"}`, 400));
    if (this.finalReports >= LIMITS.finalReportsCap) return this.finishRun("done", "final report limit reached");
    if (this.wrapping) return;
    const lead = this.lead();
    const crew = [...this.agents.values()].filter((a) => alive(a) && a !== lead);
    if (lead && crew.length > 0) {
      // the whole crew meets before the lead writes the report; the meeting counts as a live loop
      this.wrapping = true;
      this.track(this.wrapupThenReport(lead, crew));
      return;
    }
    await this.createFinalReport();
    this.dirty = true;
  }

  private async createFinalReport(): Promise<void> {
    this.finalReports++;
    const lead = this.lead();
    const t = this.makeTask({
      title: this.finalReports === 1 ? TITLES.final : `${TITLES.final} ${this.finalReports}`,
      spec:
        this.template?.finalSpec ??
        "Every crew task has ended. Read the results below, then call finish with the final report for the owner: what was done, what failed or is blocked, and the next steps.",
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
  }

  /** Tracks a background promise like a task loop: completion waits for it, the scheduler wakes after it. */
  private track(work: Promise<void>): void {
    const p: Promise<void> = work
      .catch((e) => {
        if (!(e instanceof Halt)) this.log.log("error", "company step failed", { error: redact(errMsg(e)) });
      })
      .finally(() => {
        this.loops.delete(p);
        this.kick();
      });
    this.loops.add(p);
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
      if (alive(a)) await this.setAgent(a, { status: status === "done" ? "done" : "idle", currentTaskId: null, statusText: status === "done" ? VOICE.done : null });
    }
    // the tracker lands on shipped before the run reports done
    if (status === "done") await this.advanceStage("shipped", reason ? `Shipped: ${reason}` : "Shipped to the owner");
    await this.emitUsage();
    await this.emit("run.status", { status, reason });
    if (status === "done") await this.learn();
    this.hooks.onClosed(this.run.id, this.meetingList());
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
    const finals = this.taskList().filter((t) => t.role === "lead" && t.status === "done" && this.tasks.get(t.id)?.kind === "final");
    const leadTasks = finals.length ? finals : this.taskList().filter((t) => t.role === "lead" && t.status === "done");
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
    if (alive(a) && !TERMINAL_RUN.has(this.run.status) && this.run.status !== "stopping" && !this.seated.has(a.dto.id)) {
      await this.setAgent(a, { status: "idle", currentTaskId: null, statusText: this.idleLine(a) });
    }
    await this.maybeLetGo(a);
  }

  /** The line of a cat between tasks: the CEO keeps watch, a cat with nothing queued takes a coffee break. */
  private idleLine(a: LiveAgent): string {
    if (a.dto.role === "lead") return VOICE.ceoIdle;
    const next = [...this.tasks.values()].some((t) => t.dto.role === a.dto.role && (t.dto.status === "queued" || t.dto.status === "ready"));
    return next ? VOICE.idle : VOICE.coffee;
  }

  private async beginTask(a: LiveAgent, t: LiveTask): Promise<void> {
    const now = this.ctx.clock.now();
    if (a.dto.role === "lead" && this.pendingLeadNotes.length) {
      t.notes.push(...this.pendingLeadNotes);
      this.pendingLeadNotes = [];
    }
    await this.saveTask(t, { status: "running", assigneeId: a.dto.id, attempts: t.dto.attempts + 1, startedAt: t.dto.startedAt ?? now });
    a.cleanSteps = 0;
    if (this.template && t.kind === "final") await this.advanceStage("working", `${a.dto.name} writes the report`, false, t);
    if (a.dto.role !== "lead" && t.kind !== "review") {
      await this.advanceStage("working", `${a.dto.name} started ${t.dto.title}`, false, t);
      if (a.dto.role === "qa" && (t.kind === "work" || t.kind === "handoff")) await this.advanceStage("testing", `${a.dto.name} is testing: ${t.dto.title}`);
    }
    await this.setAgent(a, { status: "thinking", currentTaskId: t.dto.id, statusText: thinkingLine(a.dto.role, t.dto.title, 0, false) });
    // the CEO deals each planned task to the cat that picks it up
    const lead = this.lead();
    if (t.kind === "work" && t.dto.attempts === 1 && lead && lead !== a && t.dto.createdBy === lead.dto.id) {
      await this.emit("agent.say", { text: clip(`${a.dto.name}, ${t.dto.title} is yours.`, LIMITS.sayChars), to: a.dto.id }, lead.dto.id, t.dto.id);
    }
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
      if (target && target.dto.status === "review") {
        await this.advanceStage("review", `The fix for ${target.dto.title} is up for review`);
        await this.startReview(target, result, a.dto.id);
      }
      return;
    }
    if (t.dto.review && (t.kind === "work" || t.kind === "handoff")) {
      await this.saveTask(t, { status: "review", resultSummary: result });
      await this.advanceStage("review", `${t.dto.title} is up for review`);
      await this.startReview(t, result, a.dto.id);
      return;
    }
    await this.saveTask(t, { status: "done", resultSummary: result, endedAt: now });
    await this.markPass(a);
    if (t.kind === "final") this.lastEvent = "final_done";
    else if (t.kind === "work") await this.signOff(t, a, "delivery");
    await this.roleOutcome(a, t, "win", "done", "");
  }

  /** The CEO approves a delivery or a passed review with one short line to the cat that did it. */
  private async signOff(t: LiveTask, owner: LiveAgent | undefined, how: "delivery" | "review"): Promise<void> {
    const lead = this.lead();
    if (!lead || !owner || owner === lead) return;
    const text = how === "review" ? `Approved: ${t.dto.title}. Nice work, ${owner.dto.name}.` : `Signed off: ${t.dto.title}. Thanks, ${owner.dto.name}.`;
    await this.emit("agent.say", { text: clip(text, LIMITS.sayChars), to: owner.dto.id }, lead.dto.id, t.dto.id);
    if (!lead.busy && !this.seated.has(lead.dto.id)) await this.setAgent(lead, { statusText: VOICE.signedOff(t.dto.title) });
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
    await this.roleOutcome(reviewer, rt, "win", "done", "");
    const target = rt.targetId ? this.tasks.get(rt.targetId) : undefined;
    if (!target || target.dto.status !== "review") return;
    target.rounds++;
    target.reviewNotes.push(notes);
    const owner = target.dto.assigneeId ? this.agents.get(target.dto.assigneeId) : undefined;
    if (owner) await this.roleOutcome(owner, target, verdict === "pass" ? "win" : "loss", verdict === "pass" ? "review_pass" : "review_fail", notes.join("; "));
    if (verdict === "pass") {
      await this.saveTask(target, {
        status: "done",
        endedAt: now,
        resultSummary: bounded(`${target.dto.resultSummary ?? ""}\nReview passed (round ${target.rounds}).`, LIMITS.resultChars),
      });
      if (owner) await this.markPass(owner);
      await this.signOff(target, owner, "review");
      return;
    }
    target.reworked = true;
    await this.advanceStage("working", `Review of ${target.dto.title} failed: back to work`, true);
    if (owner) {
      owner.lastFailure = bounded(`review of ${target.dto.title}: ${notes[0] ?? "failed"}`, 100);
      await this.markFail(owner);
    }
    try {
      await this.reviewFailed(reviewer, rt, target, owner, notes, now);
    } finally {
      if (owner) await this.maybeLetGo(owner);
    }
  }

  private async reviewFailed(reviewer: LiveAgent, rt: LiveTask, target: LiveTask, owner: LiveAgent | undefined, notes: string[], now: number): Promise<void> {
    if (target.rounds < LIMITS.maxReviewRounds) {
      if (!(await this.syncMeeting(reviewer, target, owner, notes, "fix"))) return;
      return this.createFix(target, notes, rt, false);
    }

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
    const fixable = (next === "another_round" || next === "change_approach") && target.rounds < LIMITS.hardReviewRounds;
    const sync: SyncNext = next === "exit_done" ? "exit_done" : fixable ? (next === "change_approach" ? "change_approach" : "fix") : "escalate";
    if (!(await this.syncMeeting(reviewer, target, owner, notes, sync))) return;
    if (next === "exit_done") {
      await this.saveTask(target, {
        status: "done",
        endedAt: now,
        resultSummary: bounded(`${target.dto.resultSummary ?? ""}\nAccepted after ${target.rounds} review rounds with open notes: ${notes.join("; ")}`, LIMITS.resultChars),
      });
      return;
    }
    if (fixable) return this.createFix(target, notes, rt, next === "change_approach");
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
    a.lastFailure = bounded(`blocked on ${t.dto.title}`, 100);
    await this.markFail(a);
    await this.roleOutcome(a, t, "loss", "blocked", summary);
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
    a.lastFailure = bounded(`${t.dto.title} failed (${reason})`, 100);
    await this.markFail(a);
    await this.roleOutcome(a, t, "loss", "failed", reason);
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
  /**
   * Work, verify, self-critique, fix: the model steps until it finishes; a
   * finish of real work goes through the self-check (evidence first) and may
   * send the cat into at most two extra rounds. The step budget adapts to the
   * task's size and the cat's progress, never past the hard cap.
   */
  private async agentLoop(a: LiveAgent, t: LiveTask, signal: AbortSignal): Promise<Outcome> {
    const role = a.dto.role;
    const timer = new TaskTimer(() => this.ctx.clock.now());
    const baseSpecs = this.specsFor(a);
    const brief = await this.briefFor();
    const lessons = await this.lessonsFor(a, t);
    await this.loadStrategies(a);
    let resolved = await this.resolveModel(a, t, signal, timer);
    const guard = new RepeatGuard();
    const budget = new StepBudget(initialSteps(t.kind, t.dto.acceptance.length, t.dto.spec.length));
    const evidence = new EvidenceLog();
    let steps: StepRecord[] = [];
    let summary: string | null = null;
    let compactions = 0;
    let textOnly = 0;
    let overflowRetried = false;
    let lastFailed = false;
    let checks = 0;
    let rounds = 0;

    while (true) {
      await this.checkpoint(a, t, signal, timer);
      if (!budget.allows()) return { kind: "failed", reason: budget.reason() };
      if (timer.elapsed() > LIMITS.taskWallClockMs) return { kind: "failed", reason: "time limit reached (15 minutes of work on one task)" };
      a.justPassed = false;
      // step boundary: the UI always hears that this cat is thinking before the model call
      await this.setAgent(a, { status: "thinking", statusText: thinkingLine(role, t.dto.title, budget.used, lastFailed) }, true);

      // the charter layer is read every step: an adopted strategy reaches the very next step
      const layers = this.layersFor(a);
      // capability tools join per step: find_tools, the connector tools this task loaded, the company's grants
      const specs = await this.stepSpecs(a, t, baseSpecs);
      // the venue skills the crew learned join the memory layer every step: what one cat learns, every cat reads next step
      const venue = await this.venueLessons(a);
      const input = { ...this.contextInput(a, t, specs, brief, venue.length ? [...venue, ...lessons] : lessons, steps, summary, resolved, textOnly > 0), ...layers };
      let build = this.deps.context.build(input);
      if (build.needsCompaction && steps.length > 1) {
        await this.setAgent(a, { statusText: VOICE.compacting });
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
            await this.setAgent(a, { statusText: VOICE.compacting });
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
      a.mind = this.mindOf(a, t, layers, lessons);
      await this.saveXray(a, t, build, compactions, result.usage.cachedTokens);
      await this.setAgent(a, { steps: a.dto.steps + 1 });
      if (result.text.trim()) await this.emit("agent.say", { text: clip(result.text, LIMITS.sayChars), to: null }, a.dto.id, t.dto.id);

      if (result.toolCalls.length === 0) {
        textOnly++;
        lastFailed = false;
        const step: StepRecord = { assistant: { text: redact(result.text), toolCalls: [] }, results: [] };
        steps.push(step);
        budget.record(step);
        if (textOnly >= LIMITS.noProgressLimit) return { kind: "failed", reason: `no progress: ${LIMITS.noProgressLimit} replies without a tool call` };
        continue;
      }
      textOnly = 0;
      // tools run with the model's exact arguments (file content must land on disk unchanged);
      // only what is kept, published or shown is redacted
      const exec = await this.executeCalls(a, t, result.toolCalls, signal, guard, timer);
      const shown = result.toolCalls.map((c) => ({ ...c, arguments: redact(c.arguments) }));
      const step: StepRecord = { assistant: { text: redact(result.text), toolCalls: shown }, results: exec.results };
      steps.push(step);
      evidence.record(step);
      budget.record(step);
      lastFailed = exec.anyError;
      a.cleanSteps = exec.anyError ? 0 : a.cleanSteps + 1;
      await this.setAgent(a, {});
      if (exec.tripped) return { kind: "failed", reason: exec.tripped };
      if (!exec.end) continue;
      const end = exec.end;
      if (end.kind !== "finished" || end.blocked || !this.selfCheckApplies(a, t)) return end;
      // the self-check: evidence first, then the claim
      const finish = result.toolCalls.find((c) => c.name === "finish");
      const files = finish ? parseArgs("finish", finishArgs, finish.arguments) : null;
      if (files?.ok) evidence.declare(files.value.files);
      checks++;
      const v = await this.selfCheck(a, t, evidence.snapshot(), end.summary, checks, signal);
      if (v.verdict === "pass") return end;
      await this.roleOutcome(a, t, "loss", "reflexion", v.critique);
      if (rounds >= REFLEXION.maxExtraRounds) {
        // the last check still found a gap: the finish is accepted with the open point noted
        return { ...end, summary: bounded(`${end.summary}\nOpen after the self-check: ${v.critique}`, LIMITS.resultChars) };
      }
      rounds++;
      budget.extend(REFLEXION.roundSteps);
      const note = `Not finished yet. Self-check ${checks}: ${v.critique} Address it, then call finish again.`;
      step.results = step.results.map((r) => (finish && r.callId === finish.id ? { ...r, output: note, ok: false } : r));
      await this.setAgent(a, { status: "working", activity: "review", statusText: VOICE.anotherRound(v.critique) });
    }
  }

  /** The self-check runs on real work only: not the CEO's plan and report, not reviews. */
  private selfCheckApplies(a: LiveAgent, t: LiveTask): boolean {
    return this.opts.reflexion && a.dto.role !== "lead" && (t.kind === "work" || t.kind === "fix" || t.kind === "handoff");
  }

  /** Rule verdict on conclusive evidence; otherwise one fast-tier critic call (150 output tokens). Publishes agent.reflexion. */
  private async selfCheck(a: LiveAgent, t: LiveTask, ev: Evidence, summary: string, check: number, signal: AbortSignal): Promise<Verdict & { by: "rule" | "critic" }> {
    await this.setAgent(a, { status: "thinking", activity: "review", statusText: VOICE.selfCheck });
    let by: "rule" | "critic" = "rule";
    let v = precheck(ev);
    if (!v) {
      by = "critic";
      // JEV be.reflexion_gating failure_policy: a critic that fails or answers nothing usable passes the finish
      v = (await this.critic(a, t, ev, summary, check, signal)) ?? { verdict: "pass", critique: "The self-check gave no usable verdict; the finish stands." };
    }
    await this.emit(
      "agent.reflexion",
      {
        taskId: t.dto.id,
        check,
        verdict: v.verdict,
        critique: clip(redact(v.critique), REFLEXION.critiqueChars),
        by,
        evidence: { files: ev.files.length, checks: ev.checks.length, failedChecks: ev.checks.filter((c) => !c.ok).length },
      },
      a.dto.id,
      t.dto.id,
    );
    return { ...v, by };
  }

  private async critic(a: LiveAgent, t: LiveTask, ev: Evidence, summary: string, check: number, signal: AbortSignal): Promise<Verdict | null> {
    try {
      const fast = await this.deps.llm.resolve({ tier: "fast", role: a.dto.role });
      const started = this.ctx.clock.now();
      let res: ChatResult;
      try {
        res = await fast.provider.chat({
          model: fast.model,
          system: REFLEXION_SYSTEM,
          messages: [{ role: "user", content: reflexionPacket({ title: t.dto.title, acceptance: t.dto.acceptance, summary, evidence: ev, check }) }],
          maxOutputTokens: REFLEXION.outputTokens,
          temperature: 0,
          responseFormat: "json",
          signal,
        });
      } catch (e) {
        if (!signal.aborted) {
          const zero: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 };
          await this.recordUsage(a, t, fast.provider.id, fast.model, "reflect", zero, this.ctx.clock.now() - started, 0, false, bounded(errMsg(e), 300));
        }
        throw e;
      }
      await this.recordUsage(a, t, fast.provider.id, res.model || fast.model, "reflect", res.usage, res.latencyMs, res.retries, true, null);
      return parseReflexion(res.text);
    } catch (e) {
      if (signal.aborted) throw signal.reason;
      this.log.log("warn", "self-check critic failed, the finish stands", { error: redact(errMsg(e)) });
      return null;
    }
  }

  /** The cat's tools: its archetype's, cut to the dynamic role's subset when it has one. */
  private specsFor(a: LiveAgent): ToolSpec[] {
    const all = this.deps.tools.specsFor(a.dto.role);
    const dyn = a.dto.roleId ? this.roles.get(a.dto.roleId) : undefined;
    if (!dyn || dyn.tools.length === 0) return all;
    const keep = new Set(dyn.tools);
    const cut = all.filter((s) => keep.has(s.name));
    return cut.some((s) => s.name === "finish") ? cut : all;
  }

  /** The registry tools plus the capability tools of this step (the tools service decides which). */
  private async stepSpecs(a: LiveAgent, t: LiveTask, base: ToolSpec[]): Promise<ToolSpec[]> {
    if (!this.deps.tools.taskSpecs) return base;
    try {
      const more = await this.deps.tools.taskSpecs({ role: a.dto.role, runId: this.run.id, taskId: t.dto.id, grants: this.grantsOf(a) });
      if (!more.length) return base;
      const names = new Set(base.map((x) => x.name));
      return [...base, ...more.filter((x) => !names.has(x.name))];
    } catch (e) {
      this.log.log("warn", "capability tools failed, using the registry tools", { error: redact(errMsg(e)) });
      return base;
    }
  }

  /** The ready trading venues' crew skills for this cat's role, as memory layer entries (never marked used: they are not lessons). */
  private async venueLessons(a: LiveAgent): Promise<LessonDTO[]> {
    if (!this.deps.tools.venueNotes) return [];
    try {
      const notes = await this.deps.tools.venueNotes(a.dto.role);
      return notes.map((n) => ({
        id: `venue:${n.venueId}:v${n.version}`,
        scope: "global" as const,
        role: null,
        projectId: null,
        text: n.text,
        tags: ["venue"],
        status: "active" as const,
        uses: 0,
        wins: 0,
        losses: 0,
        score: 1,
        createdAt: 0,
        lastUsedAt: null,
      }));
    } catch (e) {
      this.log.log("warn", "venue notes failed", { error: redact(errMsg(e)) });
      return [];
    }
  }

  /** The charter layer of a cat: its dynamic role's charter and the addenda of its role and its own. */
  private layersFor(a: LiveAgent): BrainLayers {
    const dyn = a.dto.roleId ? this.roles.get(a.dto.roleId) : undefined;
    const addenda: BrainLayers["addenda"] = [];
    const roleS = this.strategies.get(`role:${this.keyOf(a.dto)}`);
    const ownS = this.strategies.get(`agent:${a.dto.id}`);
    if (roleS && roleS.status === "active" && roleS.text) addenda.push({ scope: "role", version: roleS.version, text: roleS.text });
    if (ownS && ownS.status === "active" && ownS.text) addenda.push({ scope: "agent", version: ownS.version, text: ownS.text });
    return { roleKey: this.keyOf(a.dto), charter: dyn ? { version: dyn.charterVersion, title: dyn.title, text: dyn.charter } : null, addenda };
  }

  /** The active strategies of a cat's role and of the cat itself, read once per subject and kept fresh on adoption. */
  private async loadStrategies(a: LiveAgent): Promise<void> {
    if (!this.brain) return;
    for (const subject of [{ kind: "role" as const, key: this.keyOf(a.dto) }, { kind: "agent" as const, key: a.dto.id }]) {
      const k = `${subject.kind}:${subject.key}`;
      if (this.strategies.has(k)) continue;
      try {
        this.strategies.set(k, await this.brain.activeStrategy(subject));
      } catch (e) {
        this.log.log("warn", "strategy load failed", { error: redact(errMsg(e)) });
      }
    }
  }

  /** What the latest prompt carried, for GET .../mind (persisted with the X-ray). */
  private mindOf(a: LiveAgent, t: LiveTask, layers: BrainLayers, lessons: LessonDTO[]): MindSnapshot {
    const ids = [this.strategies.get(`role:${layers.roleKey}`), this.strategies.get(`agent:${a.dto.id}`)]
      .filter((x): x is StrategyVersionDTO => !!x && x.status === "active" && !!x.text)
      .map((x) => x.id);
    const version = [
      layers.charter || layers.addenda.length ? `c${layers.charter?.version ?? 1}` : "",
      ...layers.addenda.map((x) => `${x.scope === "role" ? "r" : "a"}${x.version}`),
    ]
      .filter(Boolean)
      .join(".");
    return {
      taskId: t.dto.id,
      taskTitle: t.dto.title,
      layerVersion: version,
      charterVersion: layers.charter?.version ?? 1,
      addendumIds: ids,
      lessons: lessons.slice(0, 5).map((l) => ({ id: l.id, text: clip(redact(l.text), 400), reason: lessonReason(l) })),
    };
  }

  /** Step boundary: honors budget and pause (in-flight work already finished), throws on abort. */
  private async checkpoint(a: LiveAgent, t: LiveTask, signal: AbortSignal, timer: TaskTimer): Promise<void> {
    if (signal.aborted) throw signal.reason;
    if (this.run.status === "running" && this.overBudget()) await this.pause("budget");
    if (this.run.status !== "paused") return;
    timer.stop();
    await this.setAgent(a, { status: "waiting", statusText: VOICE.paused });
    while (this.run.status === "paused") {
      await abortable<void>(signal, (resolve) => this.resumeWaiters.push(resolve));
    }
    if (signal.aborted) throw signal.reason;
    timer.start();
    await this.setAgent(a, { status: "thinking", statusText: VOICE.resumed(t.dto.title) });
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

  /** Usage billed elsewhere (the memory module's tuning call) joins the run's totals and budget. */
  private async addRunTotals(d: UsageTotals): Promise<void> {
    if (this.closed) return;
    addUsage(this.run.usage, d);
    await this.repo.addRunUsage(this.run.id, d, this.ctx.clock.now());
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
      await this.repo.upsertSnapshot(this.run.id, x, a.mind);
    } catch (e) {
      this.log.log("warn", "xray snapshot failed", { error: redact(errMsg(e)) });
    }
  }

  // ---------------------------------------------------------- company
  /**
   * One meeting: seat everyone, publish meeting.started, hold the room for a
   * short, readable time, then publish meeting.ended with notes and
   * decisions. Cats that are not inside a task loop walk back to their desk
   * afterwards; the caller moves a busy host on. An abort still closes the
   * room (decision "Cut short") and returns false.
   */
  private async holdMeeting(m: {
    kind: MeetingKind;
    title: string;
    host: LiveAgent;
    attendees: LiveAgent[];
    presenters: LiveAgent[];
    agenda: string[];
    notes: string[];
    decisions: string[];
    opening: string;
    to: string | null;
    taskId: string | null;
    signal: AbortSignal;
    /** hold every dispatch while the meeting runs (kickoff, wrap-up) */
    global?: boolean;
  }): Promise<boolean> {
    if (this.closed || m.signal.aborted) return false;
    const people = [...new Set([m.host, ...m.attendees])].filter(alive);
    const dto: MeetingDTO = {
      id: this.ctx.clock.id(),
      kind: m.kind,
      title: bounded(m.title, COMPANY.titleChars),
      agentIds: people.map((p) => p.dto.id),
      agenda: m.agenda,
      notes: [],
      startedAt: this.ctx.clock.now(),
      endedAt: null,
    };
    this.meetings.push(dto);
    for (const p of people) this.seated.set(p.dto.id, dto.id);
    if (m.global) this.holds++;
    let held = false;
    let failure: unknown = null;
    try {
      await this.emit("meeting.started", { meetingId: dto.id, kind: dto.kind, title: dto.title, agentIds: dto.agentIds, agenda: dto.agenda }, m.host.dto.id, m.taskId);
      const presenting = new Set(m.presenters.map((p) => p.dto.id));
      for (const p of people) {
        const talks = presenting.has(p.dto.id);
        await this.setAgent(p, { status: talks ? "working" : "waiting", activity: talks ? "review" : "wait", statusText: meetingLine(m.kind) });
      }
      if (m.opening) await this.emit("agent.say", { text: clip(m.opening, LIMITS.sayChars), to: m.to }, m.host.dto.id, m.taskId);
      await sleepFor(meetingHoldMs(this.deps.llm.company?.meetingMs), m.signal);
      held = true;
    } catch (e) {
      if (!m.signal.aborted) failure = e;
    } finally {
      dto.notes = m.notes;
      dto.endedAt = this.ctx.clock.now();
      for (const p of people) if (this.seated.get(p.dto.id) === dto.id) this.seated.delete(p.dto.id);
      if (m.global) this.holds--;
      await this.emit("meeting.ended", { meetingId: dto.id, kind: dto.kind, notes: dto.notes, decisions: held ? m.decisions : ["Cut short"] }, m.host.dto.id, m.taskId);
    }
    if (failure) throw failure;
    if (held && !TERMINAL_RUN.has(this.run.status) && this.run.status !== "stopping") {
      for (const p of people) {
        if (!p.busy && alive(p) && !this.seated.has(p.dto.id)) await this.setAgent(p, { status: "idle", statusText: p.dto.role === "lead" ? VOICE.ceoIdle : VOICE.backAtDesk });
      }
    }
    this.kick();
    return held;
  }

  /** After the plan: one cat per planned role takes its desk, then the lead walks the crew through the board. */
  private async kickoff(lead: LiveAgent, plan: LiveTask, created: LiveTask[], signal: AbortSignal): Promise<void> {
    for (const x of created) {
      if (x.dto.role === "lead") continue;
      const key = this.keyOf(x.dto);
      if ([...this.agents.values()].some((a) => alive(a) && this.keyOf(a.dto) === key)) continue;
      if (this.opts.org && this.org.maxAgents > 0 && this.crewSize() >= this.org.maxAgents) break;
      await this.spawnAgent(x.dto.role, x, { kind: "needed", reason: hireReason("needed", this.titleOf(x.dto), { task: x.dto.title }), by: lead, parent: lead });
    }
    const crew = [...this.agents.values()].filter((a) => alive(a) && a !== lead && !a.busy && !this.seated.has(a.dto.id));
    if (crew.length === 0) return;
    await this.advanceStage("hired", `${crew.length} cat${crew.length === 1 ? "" : "s"} hired for the plan`);
    const titleOf = (id: string) => this.tasks.get(id)?.dto.title ?? id;
    const items = created.map((x) => ({ title: x.dto.title, role: x.dto.role, review: x.dto.review, after: x.dto.deps.map(titleOf), ...(x.dto.roleId ? { roleTitle: this.titleOf(x.dto) } : {}) }));
    // who starts on what: tasks with nothing open before them, dealt in order per role
    const turn = new Map<string, number>();
    const starters = created
      .filter((x) => x.dto.role !== "lead" && this.depState(x) === "ready")
      .map((x) => {
        const key = this.keyOf(x.dto);
        const i = turn.get(key) ?? 0;
        turn.set(key, i + 1);
        const who = crew.filter((a) => this.keyOf(a.dto) === key)[i];
        return { name: who?.dto.name ?? this.titleOf(x.dto), title: x.dto.title };
      });
    const text = kickoffText(items, starters);
    const held = await this.holdMeeting({ kind: "kickoff", title: MEETING_TITLE.kickoff, host: lead, attendees: crew, presenters: [lead], ...text, to: null, taskId: plan.dto.id, signal });
    if (held) await this.setAgent(lead, { status: "working", activity: "plan", statusText: VOICE.dealing });
  }

  /** A failed review: reviewer, owner and lead meet on the notes before the fix. False when the run stopped meanwhile. */
  private async syncMeeting(reviewer: LiveAgent, target: LiveTask, owner: LiveAgent | undefined, notes: string[], next: SyncNext): Promise<boolean> {
    const lead = this.lead();
    const free = (x: LiveAgent | undefined): x is LiveAgent => !!x && x !== reviewer && alive(x) && !x.busy && !this.seated.has(x.dto.id);
    const attendees = [owner, lead].filter(free);
    if (attendees.length === 0) return true;
    const text = syncText({ reviewerName: reviewer.dto.name, ownerName: owner?.dto.name ?? null, taskTitle: target.dto.title, notes, round: target.rounds, next });
    return this.holdMeeting({
      kind: "sync",
      title: MEETING_TITLE.sync(target.dto.title),
      host: reviewer,
      attendees,
      presenters: [reviewer],
      ...text,
      to: owner?.dto.id ?? null,
      taskId: target.dto.id,
      signal: this.runAbort.signal,
    });
  }

  /** Every crew task has ended: the whole crew meets, then the lead gets the final report task. */
  private async wrapupThenReport(lead: LiveAgent, crew: LiveAgent[]): Promise<void> {
    try {
      const items = [...this.tasks.values()]
        .filter((t) => (t.kind === "work" || t.kind === "handoff") && (t.dto.status === "done" || t.dto.status === "failed" || t.dto.status === "blocked"))
        .sort((x, y) => (x.dto.endedAt ?? 0) - (y.dto.endedAt ?? 0))
        .map((t) => ({ title: t.dto.title, status: t.dto.status, by: t.dto.assigneeId ? (this.agents.get(t.dto.assigneeId)?.dto.name ?? null) : null }));
      const text = wrapupText(items, lead.dto.name);
      const held = await this.holdMeeting({
        kind: "wrapup",
        title: MEETING_TITLE.wrapup,
        host: lead,
        attendees: crew,
        presenters: [lead],
        ...text,
        to: null,
        taskId: null,
        signal: this.runAbort.signal,
        global: true,
      });
      if (held && !this.closed && !this.finishing) await this.createFinalReport();
    } finally {
      this.wrapping = false;
    }
  }

  /**
   * The CEO decides a crew question. Owner-only topics skip the model; any
   * other question gets one fast-tier call capped at 120 output tokens. A
   * failed or unreadable answer sends the question to the owner.
   */
  private async ceoDecide(a: LiveAgent, lead: LiveAgent, t: LiveTask, question: string, signal: AbortSignal): Promise<CeoVerdict> {
    if (ownerOnly(question)) return { decision: "owner", answer: "" };
    try {
      const fast = await this.deps.llm.resolve({ tier: "fast", role: "lead" });
      const res = await fast.provider.chat({
        model: fast.model,
        system: CEO_SYSTEM,
        messages: [{ role: "user", content: ceoPacket({ goal: this.run.goal, askerName: a.dto.name, askerRole: a.dto.role, taskTitle: t.dto.title, question }) }],
        maxOutputTokens: COMPANY.ceoOutputTokens,
        temperature: 0,
        responseFormat: "json",
        signal,
      });
      await this.recordUsage(lead, t, fast.provider.id, res.model || fast.model, "step", res.usage, res.latencyMs, res.retries, true, null);
      const v = parseCeoReply(res.text);
      if (v) return v;
      this.log.log("warn", "the CEO reply was not a verdict, asking the owner");
    } catch (e) {
      if (signal.aborted) throw signal.reason;
      this.log.log("warn", "CEO decision failed, asking the owner", { error: redact(errMsg(e)) });
    }
    return { decision: "owner", answer: "" };
  }

  /**
   * The approval path for a destructive or sensitive connector tool. A crew
   * cat asks the CEO, who decides it (owner-only topics go on to the owner);
   * the CEO's own calls go straight to the owner. The owner approves with a
   * reply that starts with yes, approve, ok or go.
   */
  private async approveTool(a: LiveAgent, t: LiveTask, req: { tool: string; risk: Risk; summary: string }, signal: AbortSignal, timer: TaskTimer): Promise<{ approved: boolean; answer: string }> {
    const question = bounded(`May I run ${req.tool}, ${withArticle(req.risk)} tool? ${req.summary}`, 900);
    const lead = this.lead();
    const fromOwner = (out: ControlOut) => {
      const reply = out.output.replace(/^The human replied: /, "");
      return { approved: OWNER_YES.test(reply), answer: bounded(reply, COMPANY.answerChars) };
    };
    if (a.dto.role === "lead" || !lead || lead === a) return fromOwner(await this.askOwner(a, t, question, signal, timer, null));
    const requestId = await this.raise(a, lead, question, t);
    await this.emit("agent.say", { text: clip(question, LIMITS.sayChars), to: lead.dto.id }, a.dto.id, t.dto.id);
    const verdict = await this.ceoDecide(a, lead, t, question, signal);
    if (verdict.decision === "owner") {
      await this.emit("agent.say", { text: clip(`${a.dto.name}, ${req.tool} is for the owner to allow. I am asking.`, LIMITS.sayChars), to: a.dto.id }, lead.dto.id, t.dto.id);
      return fromOwner(await this.askOwner(a, t, question, signal, timer, { requestId, lead }));
    }
    const approved = verdict.decision === "approve";
    await this.emit("request.decided", { requestId, byAgentId: lead.dto.id, byOwner: false, answer: verdict.answer, approved }, lead.dto.id, t.dto.id);
    await this.emit("agent.say", { text: clip(verdict.answer, LIMITS.sayChars), to: a.dto.id }, lead.dto.id, t.dto.id);
    return { approved, answer: `${lead.dto.name} (the CEO): ${verdict.answer}` };
  }

  private async raise(from: LiveAgent, to: LiveAgent | null, question: string, t: LiveTask): Promise<string> {
    const requestId = this.ctx.clock.id();
    await this.emit("request.raised", { requestId, fromAgentId: from.dto.id, toAgentId: to?.dto.id ?? null, question: bounded(question, 600), toOwner: to === null }, from.dto.id, t.dto.id);
    return requestId;
  }

  // ------------------------------------------------------- tool calls
  private isControl(name: string): boolean {
    return isControlTool(name) || this.deps.tools.isControl(name);
  }

  /**
   * Runs one step's calls in model order. `calls` carry the model's exact
   * arguments: workspace tools execute with them untouched (the tools service
   * redacts its own events and tool_calls row); control tools only persist or
   * publish, so they get redacted arguments.
   */
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
    const limit = LIMITS.identicalCallLimit;
    const skipped = (c: ToolCall): StepResult => ({ callId: c.id, tool: c.name, output: "Skipped: the task already ended.", ok: false });
    const blocked = (c: ToolCall): StepResult => ({
      callId: c.id,
      tool: c.name,
      output: `Blocked: the same ${c.name} call was repeated ${limit} times in a row with the same result.`,
      ok: false,
    });
    const tripReason = (tool: string) => `the same ${tool} call was repeated ${limit} times in a row with the same result`;
    const settle = (c: ToolCall, r: StepResult) => {
      results.push(r);
      if (!tripped && guard.record(c.name, c.arguments, r.output, r.ok) >= limit) tripped = tripReason(c.name);
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
          if (guard.wouldRepeat(c.name, c.arguments) >= limit) {
            tripped = tripReason(c.name);
            return { call: c, pre: blocked(c) };
          }
          return { call: c, pre: null };
        });
        const live = plan.filter((p) => !p.pre).map((p) => p.call);
        if (live.length) await this.setAgent(a, { status: "working", activity: activityForTool(live[0]!.name), statusText: batchLine(live, a.dto.steps) }, true);
        const outs = await Promise.all(plan.map((p) => (p.pre ? Promise.resolve(p.pre) : this.runTool(a, t, p.call, signal, timer))));
        for (let k = 0; k < outs.length; k++) {
          const p = plan[k]!;
          if (p.pre) results.push(p.pre);
          else settle(p.call, outs[k]!);
        }
        continue;
      }
      i++;
      if (guard.wouldRepeat(call.name, call.arguments) >= limit) {
        tripped = tripReason(call.name);
        results.push(blocked(call));
        continue;
      }
      if (this.isControl(call.name)) {
        const r = await this.runControl(a, t, { ...call, arguments: redact(call.arguments) }, signal, timer);
        settle(call, r.result);
        if (r.end) end = r.end;
      } else {
        await this.announce(a, call);
        settle(call, await this.runTool(a, t, call, signal, timer));
      }
    }
    return { results, anyError, tripped, end };
  }

  /** Step boundary during tools: the cat's activity and a friendly line for this call. */
  private async announce(a: LiveAgent, call: ToolCall): Promise<void> {
    await this.setAgent(a, { status: "working", activity: activityForTool(call.name), statusText: toolLine(call.name, call.arguments, a.dto.steps) }, true);
  }

  /**
   * Workspace tools: the tools service validates, runs, redacts, inserts the
   * tool_calls row and publishes tool.call / tool.result under its own callId
   * (the id the UI resolves through toolCall()). The engine adds nothing to
   * that log; it only turns the result into the model's step record.
   */
  private async runTool(a: LiveAgent, t: LiveTask, call: ToolCall, signal: AbortSignal, timer: TaskTimer): Promise<StepResult> {
    const started = this.ctx.clock.now();
    let res: ToolResult & { callId?: string };
    const toolCtx: ToolContext & ToolExtras = {
      runId: this.run.id,
      agentId: a.dto.id,
      taskId: t.dto.id,
      projectId: this.project.id,
      root: this.root,
      role: a.dto.role,
      signal,
      company: this.company,
      roleKey: this.keyOf(a.dto),
      grants: this.grantsOf(a),
      approve: (req) => this.approveTool(a, t, req, signal, timer),
    };
    try {
      res = await this.deps.tools.execute(call, toolCtx);
    } catch (e) {
      if (signal.aborted) throw signal.reason;
      this.log.log("warn", "tool execute threw", { tool: call.name, error: redact(errMsg(e)) });
      res = { output: `Tool error: ${errMsg(e)}`, ok: false, durationMs: this.ctx.clock.now() - started };
    }
    if (signal.aborted) throw signal.reason;
    if (!res.callId) this.log.log("warn", "tools service returned no callId: the call is not inspectable", { tool: call.name });
    if (res.ok && !this.deps.tools.isReadOnly(call.name)) this.digestStale = true;
    return { callId: call.id, tool: call.name, output: this.deps.context.truncateOutput(redact(res.output ?? "")), ok: res.ok };
  }

  /** Control tools never reach the tools service: the engine logs and publishes them itself. */
  private async runControl(a: LiveAgent, t: LiveTask, call: ToolCall, signal: AbortSignal, timer: TaskTimer): Promise<{ result: StepResult; end?: Outcome }> {
    const callId = this.ctx.clock.id();
    const activity = activityForTool(call.name);
    await this.announce(a, call);
    await this.emit("tool.call", { callId, tool: call.name, activity, argsPreview: clip(call.arguments, LIMITS.previewChars) }, a.dto.id, t.dto.id);
    const started = this.ctx.clock.now();
    let out: ControlOut;
    try {
      out = await this.control(a, t, call, signal, timer);
    } catch (e) {
      if (signal.aborted) throw signal.reason;
      out = { output: `Error: ${errMsg(e)}`, ok: false };
    }
    const output = redact(out.output);
    const durationMs = Math.max(0, this.ctx.clock.now() - started);
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
          ok: out.ok,
          durationMs,
          createdAt: this.ctx.clock.now(),
        });
      } catch (e) {
        this.log.log("warn", "tool call log failed", { error: redact(errMsg(e)) });
      }
    }
    await this.emit("tool.result", { callId, tool: call.name, ok: out.ok, summary: clip(output, LIMITS.previewChars), durationMs }, a.dto.id, t.dto.id);
    return { result: { callId: call.id, tool: call.name, output: this.deps.context.truncateOutput(output), ok: out.ok }, end: out.end };
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
        await this.setAgent(a, { statusText: statusLine(p.value.text, LIMITS.statusChars) });
        return { output: "Noted.", ok: true };
      }
      case "ask_human":
        return this.controlAskHuman(a, t, call, signal, timer);
      case "handoff":
        return this.controlHandoff(a, t, call, signal, timer);
      case "create_tasks":
        return this.controlCreateTasks(a, t, call, signal);
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

  /** The lead is the CEO: a crew question reaches the lead first; only the lead's own questions go straight to the owner. */
  private async controlAskHuman(a: LiveAgent, t: LiveTask, call: ToolCall, signal: AbortSignal, timer: TaskTimer): Promise<ControlOut> {
    const p = parseArgs("ask_human", askHumanArgs, call.arguments);
    if (!p.ok) return { output: p.error, ok: false };
    const question = bounded(p.value.question, 1000);
    const lead = this.lead();
    if (a.dto.role !== "lead" && lead && lead !== a) return this.askLead(a, lead, t, question, signal, timer);
    return this.askOwner(a, t, question, signal, timer, null);
  }

  private async askLead(a: LiveAgent, lead: LiveAgent, t: LiveTask, question: string, signal: AbortSignal, timer: TaskTimer): Promise<ControlOut> {
    const requestId = await this.raise(a, lead, question, t);
    await this.saveTask(t, { status: "waiting" });
    timer.stop();
    a.waiting = true;
    await this.setAgent(a, { status: "waiting", activity: "ask", statusText: VOICE.askingLead(lead.dto.name, question) });
    await this.emit("agent.say", { text: clip(question, LIMITS.sayChars), to: lead.dto.id }, a.dto.id, t.dto.id);
    this.kick();
    // an idle CEO visibly weighs the question; a busy one answers without leaving its own task
    const free = !lead.busy && !this.seated.has(lead.dto.id);
    if (free) await this.setAgent(lead, { status: "thinking", activity: "think", statusText: VOICE.weighing(a.dto.name) });
    const settleLead = async (statusText: string) => {
      if (free && alive(lead) && !lead.busy && !this.seated.has(lead.dto.id) && !TERMINAL_RUN.has(this.run.status)) await this.setAgent(lead, { status: "idle", statusText });
    };
    let verdict: CeoVerdict;
    try {
      verdict = await this.ceoDecide(a, lead, t, question, signal);
    } catch (e) {
      if (this.run.status !== "stopping") await settleLead(VOICE.ceoIdle);
      throw e;
    }
    if (verdict.decision === "owner") {
      await this.emit("agent.say", { text: clip(`${a.dto.name}, this one is for the owner. I am asking.`, LIMITS.sayChars), to: a.dto.id }, lead.dto.id, t.dto.id);
      await settleLead(VOICE.escalating(a.dto.name));
      return this.askOwner(a, t, question, signal, timer, { requestId, lead });
    }
    const approved = verdict.decision === "approve";
    await this.emit("request.decided", { requestId, byAgentId: lead.dto.id, byOwner: false, answer: verdict.answer, approved }, lead.dto.id, t.dto.id);
    await this.emit("agent.say", { text: clip(verdict.answer, LIMITS.sayChars), to: a.dto.id }, lead.dto.id, t.dto.id);
    await settleLead(VOICE.answered(a.dto.name));
    a.waiting = false;
    timer.start();
    await this.saveTask(t, { status: "running" });
    await this.setAgent(a, { status: "working", statusText: VOICE.resumed(t.dto.title) });
    return { output: `${lead.dto.name} (the lead) ${approved ? "approved" : "declined"}: ${verdict.answer}`, ok: true };
  }

  /** Waits for the owner. `via`: the lead escalated a crew question, so its request closes with the owner's answer too. */
  private async askOwner(
    a: LiveAgent,
    t: LiveTask,
    question: string,
    signal: AbortSignal,
    timer: TaskTimer,
    via: { requestId: string; lead: LiveAgent } | null,
  ): Promise<ControlOut> {
    const from = via ? via.lead : a;
    const asked = via ? `${a.dto.name} asks: ${question}` : question;
    const requestId = await this.raise(from, null, asked, t);
    if (t.dto.status !== "waiting") await this.saveTask(t, { status: "waiting" });
    timer.stop();
    a.waiting = true;
    await this.setAgent(a, { status: "approval", statusText: VOICE.asking(question) });
    await this.emit("agent.say", { text: clip(asked, LIMITS.sayChars), to: "human" }, from.dto.id, t.dto.id);
    this.kick();
    const answer = await abortable<string>(signal, (resolve) => {
      a.humanWait = { taskId: t.dto.id, resolve };
    });
    a.humanWait = null;
    const reply = bounded(answer, COMPANY.answerChars);
    await this.emit("request.decided", { requestId, byAgentId: null, byOwner: true, answer: reply, approved: true }, a.dto.id, t.dto.id);
    if (via) {
      await this.emit(
        "request.decided",
        { requestId: via.requestId, byAgentId: via.lead.dto.id, byOwner: false, answer: bounded(`The owner says: ${reply}`, COMPANY.answerChars), approved: true },
        via.lead.dto.id,
        t.dto.id,
      );
    }
    a.waiting = false;
    timer.start();
    await this.saveTask(t, { status: "running" });
    await this.setAgent(a, { status: "working", statusText: VOICE.resumed(t.dto.title) });
    return { output: `The human replied: ${answer}`, ok: true };
  }

  private async controlHandoff(a: LiveAgent, t: LiveTask, call: ToolCall, signal: AbortSignal, timer: TaskTimer): Promise<ControlOut> {
    const p = parseArgs("handoff", handoffArgs, call.arguments);
    if (!p.ok) return { output: p.error, ok: false };
    let toRole = p.value.toRole as AgentRole;
    // the unlimited org: a cat may hire a helper of its own role (runtime JEV decides below)
    if (toRole === a.dto.role && !this.opts.org) return { output: "Hand off to a different role, or do this part yourself.", ok: false };
    if (toRole === "lead") return { output: "The CEO does not take handoffs. Ask with ask_human, or do this part yourself.", ok: false };
    const chain = this.opts.org ? this.org.maxDepth : LIMITS.maxHandoffDepth;
    if (chain > 0 && this.handoffDepth(t) + 1 > chain) {
      return { output: `Handoff depth limit reached (${chain}). Finish this part yourself or report the blocker in finish.`, ok: false };
    }
    if (this.tasks.size >= LIMITS.maxTasksPerRun) return { output: "The run has reached its task limit.", ok: false };
    if (toRole === "operator" && !(await this.automationAvailable())) return { output: "The operator is not available: local automation is off on this machine.", ok: false };
    // any cat can define a role from context
    const dyn = p.value.roleTitle ? await this.resolveRole(a, toRole, p.value.roleTitle, { title: p.value.title, spec: p.value.spec }, signal) : null;
    toRole = dyn?.role ?? toRole;
    const roleId = dyn?.roleId ?? null;
    const approved = await this.approveHandoffHire(a, toRole, roleId, p.value.title, p.value.spec);
    if (!approved.ok) {
      await this.setAgent(a, { statusText: VOICE.selfServe(p.value.title) });
      return { output: `Do this part yourself: the company is not hiring for it (${approved.why}).`, ok: true };
    }
    const summary = bounded(p.value.summary || p.value.spec, 1200);
    const child = this.makeTask({
      title: p.value.title,
      spec: p.value.spec || p.value.title,
      acceptance: p.value.acceptance,
      role: toRole,
      roleId,
      deps: [],
      review: false,
      priority: t.dto.priority + 1,
      parentId: t.dto.id,
      createdBy: a.dto.id,
      assigneeId: null,
      kind: "handoff",
      handoff: summary,
      hireOk: true,
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
    await this.setAgent(a, { status: "waiting", statusText: VOICE.waitingOn(this.titleOf(child.dto), child.dto.title) });
    this.kick();
    await abortable<void>(signal, (resolve) => {
      if (isTerminal(child)) resolve();
      else child.waiters.push(resolve);
    });
    a.waiting = false;
    timer.start();
    await this.saveTask(t, { status: "running" });
    await this.setAgent(a, { status: "working", statusText: VOICE.resumed(t.dto.title) });
    const who = child.dto.assigneeId ? this.agents.get(child.dto.assigneeId)?.dto.name : null;
    return {
      output: `Handoff to ${who ?? this.titleOf(child.dto)} (${toRole}) ended ${child.dto.status}: ${child.dto.resultSummary ?? "no summary"}`,
      ok: child.dto.status === "done",
    };
  }

  private async controlCreateTasks(a: LiveAgent, t: LiveTask, call: ToolCall, signal: AbortSignal): Promise<ControlOut> {
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
    const created: LiveTask[] = [];
    // the first published plan opens with a kickoff: nothing is dealt until the crew has met
    const kickoff = t.kind === "plan" && !this.kickedOff && planned.some((x) => x.role !== "lead");
    if (kickoff) {
      this.kickedOff = true;
      this.holds++;
    }
    try {
      await this.insertPlanned(a, t, planned, ids, resolved.deps, lines, created, signal);
      if (kickoff) await this.kickoff(a, t, created, signal);
    } finally {
      if (kickoff) this.holds--;
    }
    this.kick();
    return { output: `Created ${planned.length} task${planned.length === 1 ? "" : "s"}:\n${lines.join("\n")}`, ok: true };
  }

  private async insertPlanned(
    a: LiveAgent,
    t: LiveTask,
    planned: PlannedTask[],
    ids: string[],
    deps: string[][],
    lines: string[],
    created: LiveTask[],
    signal: AbortSignal,
  ): Promise<void> {
    for (let i = 0; i < planned.length; i++) {
      const x = planned[i]!;
      // a specialist title: runtime JEV orch.role picks a new role or an existing one
      const dyn = x.roleTitle && x.role !== "lead" ? await this.resolveRole(a, x.role, x.roleTitle, { title: x.title, spec: x.spec }, signal) : null;
      const task = this.makeTask({
        id: ids[i],
        title: x.title,
        spec: x.spec || x.title,
        acceptance: x.acceptance,
        role: dyn?.role ?? x.role,
        roleId: dyn?.roleId ?? null,
        deps: deps[i]!,
        review: x.review,
        priority: x.priority,
        parentId: t.dto.id,
        createdBy: a.dto.id,
        assigneeId: null,
        kind: "work",
      });
      await this.insertTask(task);
      created.push(task);
      const after = task.dto.deps.map((d) => this.tasks.get(d)?.dto.title ?? d);
      const who = task.dto.roleId ? `${this.titleOf(task.dto)}, ${task.dto.role}` : task.dto.role;
      lines.push(`- ${task.dto.id} ${task.dto.title} (${who})${after.length ? ` after: ${after.join(", ")}` : ""}${task.dto.review ? " [review]" : ""}`);
    }
    if (t.kind === "plan" && a.dto.role === "lead" && created.some((x) => x.dto.role !== "lead")) {
      await this.advanceStage("planned", `${created.length} task${created.length === 1 ? "" : "s"} on the board`);
    }
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
