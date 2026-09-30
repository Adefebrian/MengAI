// What the runs module needs from the rest of the monolith. Every entry is a
// service interface from core/services.ts (or a port), injected by
// core/container.ts. The orchestrator never imports another module.
import type {
  AgentRole,
  ApprovalDTO,
  CompanyKind,
  MengaiEvent,
  Risk,
  RunStage,
  RunStatus,
  StrategyChoice,
  StrategyEvidenceDTO,
  StrategyVersionDTO,
  TaskStatus,
} from "@mengai/shared";
import type {
  AutomationService,
  ContextService,
  DecisionService,
  KillSwitch,
  MemoryService,
  ProjectsService,
  SettingsService,
  ToolsService,
  UsageService,
  WorkspaceService,
} from "../../core/services";
import type { Judge, LlmRouter, ToolSpec } from "../../core/ports";

export interface RunsDeps {
  projects: ProjectsService;
  llm: LlmRouter & CompanyPace & JudgeHint;
  usage: UsageService;
  context: ContextService;
  memory: MemoryService & MemoryPromotion & Partial<BrainMemory>;
  tools: ToolsService & CapabilityTools;
  decisions: DecisionService;
  settings: SettingsService;
  killswitch: KillSwitch;
  automation: AutomationService;
  /** workspace digest for the run brief (not in the W1 table; see the runs report) */
  workspace: WorkspaceService;
  /** pending approvals for the run snapshot; the automation interface has no list call yet */
  approvals?: { list(runId: string): Promise<ApprovalDTO[]> };
  /**
   * Optional read side of the event log (the events module's EventBus.after).
   * When wired, the snapshot of a run that is not live in this process
   * rebuilds its meetings from meeting.started / meeting.ended.
   */
  eventLog?: { after(seq: number, runId: string | null, limit: number): Promise<MengaiEvent[]> };
  /** brain switches; everything is on when absent (production). The test harness turns the model-calling parts off by default. */
  brain?: Partial<BrainOptions>;
  /**
   * The product's runtime JEV (the owner's jev provider key): prompt.adopt,
   * orch.role, orch.hire and orch.let_go. Without it every brain decision
   * takes its deterministic fallback, stamped UNVERIFIED BY JEV.
   */
  judge?: Judge;
  /** company templates (the companies module); without it every run is a studio run */
  companies?: CompanyCatalog;
}

/** One company template as the engine reads it (the companies module's CompanyTemplate, structurally). */
export interface CompanyTemplateView {
  kind: CompanyKind;
  label: string;
  /** the CEO cat's display title (the fund's CIO); null keeps the base label */
  leadTitle: string | null;
  roles: ReadonlyArray<{ key: string; title: string; archetype: AgentRole; charter: readonly string[]; tools: readonly string[] }>;
  planGuide: readonly string[];
  finalSpec: string | null;
}

export interface StageTaskView {
  title: string;
  roleKey: string;
  archetype: AgentRole;
  kind: string;
}

/** The companies module's service, structurally. */
export interface CompanyCatalog {
  template(kind: CompanyKind | null | undefined): CompanyTemplateView;
  mapStage(kind: CompanyKind, beat: RunStage, task: StageTaskView | null): string | null;
  stageMoves(kind: CompanyKind, current: string | null, next: string, loopBack?: boolean): boolean;
  boardStage(kind: CompanyKind, tasks: ReadonlyArray<StageTaskView & { status: TaskStatus }>, status: RunStatus): string | null;
  grantsFor(kind: CompanyKind, roleKey: string, archetype: AgentRole): string[];
}

/** The capability side of the tools service (connectors and trading); absent in older wiring and tests. */
export interface CapabilityTools {
  taskSpecs?(input: { role: AgentRole; runId: string; taskId: string | null; grants?: readonly string[] }): Promise<ToolSpec[]>;
}

/** What the engine adds to every tool call (the tools module's CapabilityContext, structurally). */
export interface ToolExtras {
  company?: CompanyKind;
  roleKey?: string;
  grants?: readonly string[];
  approve?(req: { tool: string; risk: Risk; summary: string }): Promise<{ approved: boolean; answer: string }>;
}

export interface BrainOptions {
  /** the self-check before a finish (rule verdicts, fast-tier critic on ambiguous evidence) */
  reflexion: boolean;
  /** strategy tuning for roles and cats that underperform (fast tier, offline eval, JEV prompt.adopt) */
  tuning: boolean;
  /** the unlimited org: JEV hire decisions, helpers at any depth, dynamic roles, letting go */
  org: boolean;
}

export const BRAIN_DEFAULTS: BrainOptions = { reflexion: true, tuning: true, org: true };

export type OutcomeKind = "done" | "review_pass" | "review_fail" | "failed" | "blocked" | "reflexion";

export interface StrategySubject {
  kind: "role" | "agent";
  /** role key (base role or dynamic role key) or agent id */
  key: string;
  role: AgentRole;
  title?: string | null;
}

/** A scored candidate addendum (the memory module's StrategyProposal, structurally). */
export interface StrategyProposalView {
  subject: StrategySubject;
  current: StrategyVersionDTO | null;
  candidate: string;
  merged: string | null;
  version: number;
  eval: { adopt: boolean; reason: string; legacyBillableInputTokens: number; candidate: { tokens: number; billableInputTokens: number } };
  evidence: StrategyEvidenceDTO;
  causes: string[];
  /** the candidate call as billed: the engine adds it to the run's totals */
  call?: { inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens: number; costUsd: number } | null;
}

/**
 * The crew's brain on the memory side (the memory module implements it;
 * the container passes its service). Structural, so the orchestrator never
 * imports the memory module. When a memory service lacks it, outcomes and
 * strategy tuning are skipped.
 */
export interface BrainMemory {
  recordRoleOutcome(input: {
    role: string;
    runId: string | null;
    taskId: string | null;
    agentId: string | null;
    outcome: "win" | "loss";
    kind: OutcomeKind;
    cause: string;
  }): Promise<{ tuneDue: boolean; rate: number; samples: number }>;
  proposeStrategy(input: {
    subject: StrategySubject;
    runId: string | null;
    context: ContextService;
    specsFor?: (role: AgentRole) => ToolSpec[];
    cases?: Array<{ outcome: "win" | "loss"; kind: string; cause: string }>;
    signal?: AbortSignal;
  }): Promise<StrategyProposalView | null>;
  applyStrategy(input: {
    /** the exact object proposeStrategy returned (it carries the tuning lock) */
    proposal: StrategyProposalView;
    choice: StrategyChoice;
    decision: { id: string | null; confidence: number | null; verified: boolean; stamp: string | null } | null;
    reason?: string;
  }): Promise<StrategyVersionDTO>;
  activeStrategy(subject: { kind: "role" | "agent"; key: string }): Promise<StrategyVersionDTO | null>;
  strategiesByIds(ids: string[]): Promise<StrategyVersionDTO[]>;
  strategyHistory(subject: { kind: "role" | "agent"; key: string }, limit?: number): Promise<StrategyVersionDTO[]>;
}

const BRAIN_METHODS = [
  "recordRoleOutcome",
  "proposeStrategy",
  "applyStrategy",
  "activeStrategy",
  "strategiesByIds",
  "strategyHistory",
] as const satisfies ReadonlyArray<keyof BrainMemory>;

/** The memory service's brain, when it has every method. */
export function brainOf(memory: Partial<BrainMemory>): BrainMemory | null {
  return BRAIN_METHODS.every((m) => typeof memory[m] === "function") ? (memory as BrainMemory) : null;
}

/**
 * Optional judge a router may carry: the scripted demo crew plays the
 * runtime JEV too (deps.judge wins when both are set).
 */
export interface JudgeHint {
  judge?: Judge;
}

/**
 * Optional pace hint a router may carry. The scripted demo crew holds
 * meetings for 6 to 10 s so every beat is watchable; tests use a few ms.
 * Without it a meeting is held for COMPANY.meetingMs.
 */
export interface CompanyPace {
  company?: { meetingMs?: readonly [number, number] };
}

/** Optional memory extension: promote lessons that earned it after a run. */
export interface MemoryPromotion {
  promoteEligible?(input: { projectId: string; runId: string }): Promise<unknown>;
}
