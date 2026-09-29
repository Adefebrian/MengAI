// Cross-module service contracts. A module that needs another module's
// behavior depends on the interface here and receives the implementation
// from core/container.ts (dependency injection). The implementing module
// exports a factory from its index.ts whose `service` satisfies the
// interface. This keeps the modular monolith acyclic while every module is
// built in parallel: the orchestrator never imports memory internals, the
// tools never import automation internals, and so on.
import type {
  AgentDTO,
  AgentRole,
  AssetDTO,
  BudgetBody,
  AuditEntryDTO,
  AutomationStatus,
  CallPurpose,
  Capability,
  ContextXrayDTO,
  CreateAssetBody,
  CreateProjectBody,
  CreateRunBody,
  DecisionDTO,
  EstimateRunBody,
  FileNodeDTO,
  FindingDTO,
  HandsMethod,
  HandsParams,
  HandsResults,
  HumanMessageBody,
  KillSwitchResult,
  LessonDTO,
  LessonScope,
  LlmCallDTO,
  ModelPrice,
  OwnerSettings,
  ProjectDTO,
  ProviderDTO,
  Risk,
  RunDTO,
  RunEstimate,
  RunSnapshotDTO,
  ScanDTO,
  ScanKind,
  Severity,
  SkillDTO,
  TaskDTO,
  TaskPatchBody,
  Tier,
  ToolCallDetail,
} from "@mengai/shared";
import type { ChatMessage, Judge, LlmRouter, MediaRouter, ToolCall, ToolSpec, Usage } from "./ports";

// ---------------------------------------------------------------- providers
/** providers module: BYOK registry, tier routing, media routing, JEV transport. */
export interface ProvidersService {
  /** chat routing: tier (+ role override) -> provider + model */
  readonly llm: LlmRouter;
  /** image / video routing */
  readonly media: MediaRouter;
  /** JEV transport backed by the owner's `jev` provider key; unverified when missing */
  readonly judge: Judge;
  list(): Promise<ProviderDTO[]>;
}

// -------------------------------------------------------------------- usage
export interface RecordCallInput {
  runId: string | null;
  agentId: string | null;
  taskId: string | null;
  providerId: string;
  model: string;
  purpose: CallPurpose;
  usage: Usage;
  latencyMs: number;
  retries: number;
  ok: boolean;
  error: string | null;
}

/** usage module: owns llm_calls, prices and cost math. */
export interface UsageService {
  /** persists the call with its computed cost and returns it */
  record(input: RecordCallInput): Promise<LlmCallDTO>;
  cost(model: string, usage: Usage): Promise<number>;
  prices(): Promise<Record<string, ModelPrice>>;
  listCalls(runId: string): Promise<LlmCallDTO[]>;
}

// ------------------------------------------------------------------- memory
export interface RetrieveQuery {
  text: string;
  role: AgentRole;
  projectId: string;
  limit?: number;
  /** hard cap for the returned lessons' estimated tokens (default 400) */
  tokenBudget?: number;
}

/** memory module: lessons, outcomes, promotion, skills, run digests. */
export interface MemoryService {
  retrieve(q: RetrieveQuery): Promise<LessonDTO[]>;
  markUsed(lessonIds: string[], ctx: { runId: string; taskId: string }): Promise<void>;
  /** closes every lesson use recorded for this task as a win or a loss */
  recordOutcome(ctx: { runId: string; taskId: string; success: boolean }): Promise<void>;
  record(input: {
    text: string;
    tags?: string[];
    role: AgentRole | null;
    projectId: string | null;
    runId: string | null;
    scope?: LessonScope;
  }): Promise<LessonDTO>;
  /** automatic reflection after a failed or reworked task (fast tier, 150 token cap) */
  reflect(input: {
    runId: string;
    taskId: string;
    projectId: string;
    role: AgentRole;
    taskTitle: string;
    outcome: string;
    notes: string[];
  }): Promise<LessonDTO | null>;
  saveSkill(input: { name: string; description: string; role: AgentRole | null; steps: SkillDTO["steps"] }): Promise<SkillDTO>;
  findSkills(q: { text: string; role?: AgentRole; limit?: number }): Promise<SkillDTO[]>;
  /** prior-runs history for the brief, at most ~300 tokens, null when none */
  runDigest(projectId: string): Promise<string | null>;
  saveRunDigest(input: { projectId: string; runId: string; text: string }): Promise<void>;
}

// ---------------------------------------------------------------------- jev
/** jev module: product decision catalog on top of the Judge port. */
export interface DecisionService {
  route(input: {
    runId: string;
    goal: string;
    task: { title: string; spec: string };
    candidates: AgentRole[];
  }): Promise<{ role: AgentRole; split: boolean; decision: DecisionDTO }>;
  modelTier(input: {
    runId: string;
    role: AgentRole;
    task: { title: string; spec: string; acceptance: string[] };
    signals: { priorFailures: number; risk: boolean; files: number; history?: Partial<Record<Tier, { uses: number; wins: number }>> };
    available: Tier[];
  }): Promise<{ tier: Tier; decision: DecisionDTO }>;
  loopExit(input: {
    runId: string;
    goal: string;
    round: number;
    gates: Array<{ name: string; ok: boolean }>;
    open: Array<{ severity: Severity; title: string }>;
    recurring: number;
  }): Promise<{ next: "exit_done" | "another_round" | "change_approach" | "escalate"; meetsAsk: number; decision: DecisionDTO }>;
  escalate(input: {
    runId: string;
    proposal: string;
    impact: string;
    reversibleHint: boolean;
  }): Promise<{ decider: "crew" | "lead" | "human"; reversible: number; decision: DecisionDTO }>;
  promoteLesson(input: {
    lesson: string;
    context: string;
    existing: string[];
    projects: number;
  }): Promise<{ scope: "global" | "project" | "discard"; durable: number; decision: DecisionDTO }>;
  severity(input: {
    runId: string | null;
    finding: { kind: ScanKind; rule: string; title: string; detail: string };
    ruleSeverity: Severity;
  }): Promise<{ severity: Severity; decision: DecisionDTO }>;
  list(runId?: string): Promise<DecisionDTO[]>;
}

// ---------------------------------------------------------------- workspace
export interface ReadResult {
  content: string;
  totalLines: number;
  truncated: boolean;
  /** sha256 of the whole file, used for "unchanged since last read" dedupe */
  hash: string;
  binary: boolean;
  size: number;
}

/** workspace module: every file op is jailed to root (realpath checked, no symlink escape). */
export interface WorkspaceService {
  list(root: string, rel?: string, depth?: number): Promise<FileNodeDTO[]>;
  read(root: string, rel: string, range?: { from?: number; to?: number }): Promise<ReadResult>;
  write(root: string, rel: string, content: string): Promise<{ bytes: number; created: boolean }>;
  edit(root: string, rel: string, find: string, replace: string, all?: boolean): Promise<{ replacements: number }>;
  remove(root: string, rel: string): Promise<{ removed: boolean }>;
  search(root: string, pattern: string, glob?: string, limit?: number): Promise<Array<{ path: string; line: number; text: string }>>;
  /** compact tree summary for the run brief, at most ~300 tokens */
  digest(root: string): Promise<string>;
  /** throws when rel escapes root; returns the absolute real path */
  resolveInside(root: string, rel: string): Promise<string>;
}

// ------------------------------------------------------------------- assets
export interface AssetsService {
  /** images resolve when stored; videos return a queued asset and finish in the background */
  generate(input: CreateAssetBody & { runId?: string; workspaceRoot?: string; signal?: AbortSignal }): Promise<AssetDTO>;
}

// ----------------------------------------------------------------- security
export interface SecurityService {
  scan(input: {
    projectId: string;
    root: string;
    kinds: ScanKind[];
    runId?: string | null;
    /** OSV lookups need network consent */
    network: boolean;
    signal?: AbortSignal;
  }): Promise<{ scan: ScanDTO; findings: FindingDTO[] }>;
}

// --------------------------------------------------------------- automation
export class ApprovalDeniedError extends Error {
  constructor(message: string, public readonly approvalId: string | null) {
    super(message);
    this.name = "ApprovalDeniedError";
  }
}

export interface AuthorizeInput {
  runId: string | null;
  agentId: string | null;
  capability: Capability;
  /** verb, e.g. "shell.exec", "fs.delete", "network.fetch", "browser.open" */
  action: string;
  /** what it acts on: a command, a path, a url, an app */
  target: string;
  detail: Record<string, unknown>;
  /** classifier result when the caller already knows; otherwise the gate classifies */
  risk?: Risk;
  signal?: AbortSignal;
}

/** automation module: capability grants, risk gate, approvals, hash-chained audit. */
export interface AutomationService {
  status(): Promise<AutomationStatus>;
  /** resolves when allowed (possibly after a human approval); throws ApprovalDeniedError otherwise */
  authorize(input: AuthorizeInput): Promise<{ approvalId: string | null; risk: Risk }>;
  /** authorize + call the hands helper + audit, in one step */
  perform<M extends HandsMethod>(input: {
    runId: string | null;
    agentId: string | null;
    method: M;
    params: HandsParams[M];
    signal?: AbortSignal;
  }): Promise<HandsResults[M]>;
  audit(entry: Omit<AuditEntryDTO, "seq" | "ts" | "prevHash" | "hash">): Promise<AuditEntryDTO>;
}

// ------------------------------------------------------------------ context
export interface StepRecord {
  assistant: { text: string; toolCalls: ToolCall[] };
  results: Array<{ callId: string; tool: string; output: string; ok: boolean }>;
}

export interface ContextInput {
  role: AgentRole;
  runId: string;
  agentId: string;
  taskId: string | null;
  tools: ToolSpec[];
  brief: { goal: string; projectName: string; workspaceDigest: string; history: string | null };
  lessons: LessonDTO[];
  task: {
    title: string;
    spec: string;
    acceptance: string[];
    depSummaries: string[];
    handoff: string | null;
    /** human messages and reviewer notes addressed to this agent */
    notes: string[];
  } | null;
  steps: StepRecord[];
  summary: string | null;
  /** per-call input budget in tokens */
  budgetTokens: number;
  contextWindow: number;
  model: string;
}

export interface ContextBuild {
  request: {
    system: string;
    messages: ChatMessage[];
    tools: ToolSpec[];
    cacheSystem: boolean;
    cacheKey: string;
  };
  xray: ContextXrayDTO;
  estimatedTokens: number;
  /** true when steps no longer fit the budget: call compact() first */
  needsCompaction: boolean;
}

/** context module: prompt layout, budgets, compaction, truncation, token estimates. */
export interface ContextService {
  charter(role: AgentRole): string;
  build(input: ContextInput): ContextBuild;
  compact(input: {
    steps: StepRecord[];
    summary: string | null;
    keepRecent: number;
    /** optional LLM summarizer (fast tier); extractive fallback when absent or failing */
    summarize?: (text: string) => Promise<string>;
  }): Promise<{ summary: string; steps: StepRecord[]; tokensBefore: number; tokensAfter: number }>;
  estimateTokens(text: string, model?: string): number;
  /** feed back the vendor-reported prompt size so estimates self-calibrate per model */
  calibrate(model: string, estimated: number, actual: number): void;
  /** head + tail truncation with a range hint, for tool outputs */
  truncateOutput(text: string, maxChars?: number): string;
}

// --------------------------------------------------------------- killswitch
/** core/killswitch.ts: modules register stop hooks; POST /api/killswitch runs them all. */
export interface KillSwitch {
  register(name: string, hook: () => Promise<number>): void;
  trigger(by: "user" | "shortcut" | "tray" | "system"): Promise<KillSwitchResult>;
}

// ----------------------------------------------------------------- settings
/** settings module: owner preferences with defaults; every module reads through this. */
export interface SettingsService {
  get(): Promise<OwnerSettings>;
  patch(patch: Partial<OwnerSettings>): Promise<OwnerSettings>;
}

// ----------------------------------------------------------------- projects
/** projects module: project records and their jailed workspace roots. */
export interface ProjectsService {
  list(): Promise<ProjectDTO[]>;
  get(id: string): Promise<ProjectDTO>;
  create(input: CreateProjectBody): Promise<ProjectDTO>;
  remove(id: string): Promise<void>;
  /** absolute, realpath-resolved workspace root; throws notFound */
  root(id: string): Promise<string>;
  touchRun(id: string, runId: string): Promise<void>;
}

// -------------------------------------------------------------------- tools
export interface ToolContext {
  runId: string;
  agentId: string;
  taskId: string | null;
  projectId: string;
  /** absolute workspace root of the project */
  root: string;
  role: AgentRole;
  signal?: AbortSignal;
}

export interface ToolResult {
  output: string;
  ok: boolean;
  durationMs: number;
}

/**
 * tools module: one registry of tool specs per role (ROLE_TOOLS) and the
 * execution of every non-control tool. Control tools (finish, note,
 * ask_human, handoff, create_tasks, update_task, list_tasks, crew_status,
 * submit_review, report_issue) have their schemas here but are executed by
 * the runs module, which checks isControl() first.
 */
export interface ToolsService {
  specsFor(role: AgentRole): ToolSpec[];
  isControl(tool: string): boolean;
  /** tools that only read (safe to run in parallel within one step) */
  isReadOnly(tool: string): boolean;
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult>;
}

// --------------------------------------------------------------------- runs
/** runs module: the orchestrator. Routes in @mengai/shared Routes under /api/runs. */
export interface RunsService {
  create(input: CreateRunBody): Promise<RunDTO>;
  estimate(input: EstimateRunBody): Promise<RunEstimate>;
  list(): Promise<RunDTO[]>;
  snapshot(runId: string): Promise<RunSnapshotDTO>;
  pause(runId: string): Promise<RunDTO>;
  resume(runId: string): Promise<RunDTO>;
  stop(runId: string, reason?: string): Promise<RunDTO>;
  message(runId: string, input: HumanMessageBody): Promise<void>;
  setBudget(runId: string, input: BudgetBody): Promise<RunDTO>;
  patchTask(runId: string, taskId: string, patch: TaskPatchBody): Promise<TaskDTO>;
  stopAgent(runId: string, agentId: string): Promise<AgentDTO>;
  xray(runId: string, agentId: string): Promise<ContextXrayDTO>;
  toolCall(runId: string, callId: string): Promise<ToolCallDetail>;
  /** stops every live run; registered on the kill switch. Returns how many. */
  stopAll(reason: string): Promise<number>;
}
