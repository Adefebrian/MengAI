// Wire DTOs. Every timestamp is epoch milliseconds, every id a UUIDv7 string.
// These are the only shapes the API returns and the web app renders. Secrets
// never appear here: providers expose a 4 character key hint at most.
import type {
  Activity,
  AgentRole,
  AgentStatus,
  ApprovalScope,
  ApprovalStatus,
  AssetKind,
  AssetStatus,
  AuditActor,
  AuditOutcome,
  CallPurpose,
  Capability,
  ContextLayer,
  FindingStatus,
  LessonScope,
  LessonStatus,
  Mode,
  Mood,
  PermissionMode,
  ProviderCap,
  ProviderProtocol,
  Risk,
  RunStatus,
  ScanKind,
  ScanStatus,
  Severity,
  TaskStatus,
  Tier,
} from "./enums";
import type { MeetingKind } from "./events";

export interface HealthDTO {
  ok: boolean;
  mode: Mode;
  version: string;
  /** true once at least one chat provider with a key is configured */
  configured: boolean;
  automation: { available: boolean; accessibility: boolean; screen: boolean };
  jev: { configured: boolean };
}

export interface SessionDTO {
  authenticated: boolean;
  mode: Mode;
  /** server mode only: true until the owner account exists */
  needsSetup: boolean;
  owner?: { id: string; email: string };
}

export interface ProjectDTO {
  id: string;
  name: string;
  /** absolute path of the jailed workspace root */
  workspacePath: string;
  createdAt: number;
  updatedAt: number;
  lastRunId: string | null;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  calls: number;
}

export interface RunDTO {
  id: string;
  projectId: string;
  goal: string;
  status: RunStatus;
  statusReason: string | null;
  budgetTokens: number;
  budgetUsd: number;
  usage: UsageTotals;
  /** 0..1 from the task DAG: done tasks / all non-cancelled tasks */
  progress: number;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
}

export interface CatLook {
  /** coat id from cats.ts COATS */
  coat: string;
  /** 0..2^31 seed that drives quirks and loop phase offsets */
  seed: number;
}

export interface AgentDTO {
  id: string;
  runId: string;
  parentId: string | null;
  role: AgentRole;
  /** friendly cat name, unique per run (Kopi, Mochi, ...) */
  name: string;
  look: CatLook;
  tier: Tier;
  status: AgentStatus;
  activity: Activity;
  mood: Mood;
  /** short human text for the status line, never raw tool output */
  statusText: string | null;
  currentTaskId: string | null;
  steps: number;
  usage: UsageTotals;
  createdAt: number;
  updatedAt: number;
  /** display title of its role: the base role label ("Engineer") or a dynamic role title ("Launch tester") */
  roleTitle?: string;
  /** the base role behind the cat's pose and default tools; equals `role` */
  archetype?: AgentRole;
  /** the dynamic role (RoleDTO.id) this cat was hired for, null for a base role */
  roleId?: string | null;
  /** why the cat was hired, null for the CEO */
  hireReason?: string | null;
  /** the cat that hired it (the CEO, or the cat that asked for a helper) */
  hiredBy?: string | null;
  /** set when the cat was let go: the short reason */
  leftReason?: string | null;
}

export interface TaskDTO {
  id: string;
  runId: string;
  parentId: string | null;
  title: string;
  spec: string;
  acceptance: string[];
  role: AgentRole;
  assigneeId: string | null;
  status: TaskStatus;
  priority: number;
  deps: string[];
  review: boolean;
  attempts: number;
  resultSummary: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  /** the dynamic role (RoleDTO.id) that owns this task; `role` is then its archetype */
  roleId?: string | null;
}

export interface HandoffDTO {
  id: string;
  runId: string;
  taskId: string;
  fromAgentId: string;
  toAgentId: string | null;
  toRole: AgentRole;
  summary: string;
  createdAt: number;
}

export interface ProviderModel {
  id: string;
  label?: string;
  contextWindow?: number;
  caps?: ProviderCap[];
}

export interface ProviderDTO {
  id: string;
  /** preset id from providers.ts, or "custom" */
  preset: string;
  label: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  hasKey: boolean;
  /** last 4 characters of the key, for recognition only */
  keyHint: string | null;
  models: ProviderModel[];
  caps: ProviderCap[];
  lastTestAt: number | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TierMapping {
  tier: Tier;
  providerId: string | null;
  model: string | null;
}

export interface ModelRouting {
  tiers: TierMapping[];
  /** optional per-role tier override */
  roleTiers: Partial<Record<AgentRole, Tier>>;
  /** provider + model used for image generation */
  image: { providerId: string | null; model: string | null };
  /** provider + model used for video/motion generation */
  video: { providerId: string | null; model: string | null };
}

export interface LlmCallDTO {
  id: string;
  runId: string | null;
  agentId: string | null;
  taskId: string | null;
  providerId: string;
  model: string;
  purpose: CallPurpose;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  latencyMs: number;
  retries: number;
  ok: boolean;
  error: string | null;
  createdAt: number;
}

/** Token breakdown of one prompt, per layer, shown in the context X-ray. */
export interface ContextXrayDTO {
  agentId: string;
  taskId: string | null;
  model: string;
  budget: number;
  layers: Array<{ layer: ContextLayer; tokens: number; cached: boolean }>;
  totalTokens: number;
  compactions: number;
  lastCachedTokens: number;
  createdAt: number;
}

export interface LessonDTO {
  id: string;
  scope: LessonScope;
  role: AgentRole | null;
  projectId: string | null;
  text: string;
  tags: string[];
  status: LessonStatus;
  uses: number;
  wins: number;
  losses: number;
  score: number;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface SkillDTO {
  id: string;
  name: string;
  description: string;
  role: AgentRole | null;
  steps: Array<{ tool: string; args: Record<string, unknown>; note?: string }>;
  uses: number;
  wins: number;
  createdAt: number;
}

export interface DecisionDTO {
  id: string;
  runId: string | null;
  /** catalog id, e.g. orch.route */
  decisionId: string;
  answers: Record<string, unknown>;
  /** the action the engine took because of the answer */
  action: string;
  confidence: number | null;
  verified: boolean;
  /** "UNVERIFIED BY JEV" when the fallback decided */
  stamp: string | null;
  latencyMs: number;
  createdAt: number;
}

export interface PermissionDTO {
  capability: Capability;
  mode: PermissionMode;
  /** fs: allowed folders; shell: allowed command prefixes; network: allowed hosts */
  scope: string[];
  expiresAt: number | null;
  updatedAt: number;
}

export interface ApprovalDTO {
  id: string;
  runId: string | null;
  agentId: string | null;
  capability: Capability;
  risk: Risk;
  /** one line: what will happen */
  title: string;
  /** exact detail: command, path, diff preview, target rect, url */
  detail: Record<string, unknown>;
  status: ApprovalStatus;
  scope: ApprovalScope;
  createdAt: number;
  decidedAt: number | null;
  expiresAt: number;
}

export interface AuditEntryDTO {
  seq: number;
  ts: number;
  actor: AuditActor;
  runId: string | null;
  agentId: string | null;
  capability: Capability | "system";
  action: string;
  target: string;
  risk: Risk;
  outcome: AuditOutcome;
  detail: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface AssetDTO {
  id: string;
  runId: string | null;
  kind: AssetKind;
  status: AssetStatus;
  providerId: string;
  model: string;
  prompt: string;
  /** served by GET /api/assets/:id/file */
  url: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  costUsd: number;
  error: string | null;
  createdAt: number;
}

export interface ScanDTO {
  id: string;
  projectId: string;
  kinds: ScanKind[];
  status: ScanStatus;
  counts: Record<Severity, number>;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface FindingDTO {
  id: string;
  scanId: string;
  kind: ScanKind;
  severity: Severity;
  rule: string;
  title: string;
  /** workspace-relative */
  file: string | null;
  line: number | null;
  /** secret values are always masked here */
  detail: string;
  fix: string | null;
  status: FindingStatus;
}

export interface FileNodeDTO {
  path: string;
  name: string;
  dir: boolean;
  size: number;
  mtime: number;
  children?: FileNodeDTO[];
}

export interface EvalRunDTO {
  id: string;
  suite: string;
  policy: "legacy" | "v2";
  metrics: {
    scenarios: number;
    passed: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    billableInputTokens: number;
    maxPromptTokens: number;
  };
  createdAt: number;
}

/** One crew meeting (kickoff, sync, review, wrap-up), rebuilt from meeting.started / meeting.ended. */
export interface MeetingDTO {
  id: string;
  kind: MeetingKind;
  title: string;
  agentIds: string[];
  agenda: string[];
  /** empty while the meeting is running */
  notes: string[];
  startedAt: number;
  /** null while the meeting is running */
  endedAt: number | null;
}

/** Stages of the run tracker, in order. A failed review loops back to working. */
export const RUN_STAGES = ["goal", "planned", "hired", "working", "review", "testing", "shipped"] as const;
export type RunStage = (typeof RUN_STAGES)[number];

/**
 * A role the crew defined from context on top of one of the base roles (its
 * archetype, which drives the cat pose and the default tools). Project
 * scoped: a later run of the project reuses it by key.
 */
export interface RoleDTO {
  id: string;
  projectId: string;
  /** the run that created it */
  runId: string | null;
  /** slug of the title, unique per project ("launch-tester") */
  key: string;
  title: string;
  archetype: AgentRole;
  /** the generated charter (fast tier, capped); the shared working rules follow it in the prompt */
  charter: string;
  charterVersion: number;
  /** tool names, a subset of the archetype's tools in the registry */
  tools: string[];
  reason: string;
  /** the agent that asked for it (the CEO or any crew cat) */
  createdBy: string | null;
  createdAt: number;
}

export const STRATEGY_STATUSES = ["active", "retired", "rejected"] as const;
export type StrategyStatus = (typeof STRATEGY_STATUSES)[number];

/** The runtime JEV prompt.adopt answer for a candidate strategy addendum. */
export const STRATEGY_CHOICES = ["adopt", "keep", "merge"] as const;
export type StrategyChoice = (typeof STRATEGY_CHOICES)[number];

/** The offline evaluation of a candidate addendum against the current one (evals replay). */
export interface StrategyEvidenceDTO {
  scores: { current: number; candidate: number };
  /** recent failure causes each text addresses, of `losses` */
  addressed: { current: number; candidate: number; losses: number };
  /** billable input of the role's replayed scenarios with each text, and the legacy baseline */
  billableInputTokens: { current: number; candidate: number; legacy: number };
  tokens: { current: number; candidate: number };
}

/**
 * One version of a learned strategy addendum (at most 120 tokens), for a role
 * (base or dynamic, by role key) or for one agent. active is injected into the
 * charter layer, retired is an older adopted version, rejected a candidate
 * JEV kept out.
 */
export interface StrategyVersionDTO {
  id: string;
  subject: "role" | "agent";
  /** role key (a base role or a dynamic role key) or the agent id */
  subjectKey: string;
  /** archetype of the subject */
  role: AgentRole;
  version: number;
  text: string;
  tokens: number;
  status: StrategyStatus;
  /** the JEV answer that produced this row; null when no usable candidate was written */
  choice: StrategyChoice | null;
  reason: string;
  decision: { id: string | null; confidence: number | null; verified: boolean; stamp: string | null } | null;
  evidence: StrategyEvidenceDTO | null;
  createdAt: number;
}

/** What is in one cat's head right now: GET /api/runs/:id/agents/:agentId/mind. Every text is redacted. */
export interface AgentMindDTO {
  runId: string;
  agentId: string;
  name: string;
  role: AgentRole;
  roleTitle: string;
  roleId: string | null;
  charter: { version: number; title: string; dynamic: boolean; text: string; tokens: number };
  /** the version string that keys its prompt cache: charter plus every injected addendum */
  layerVersion: string;
  /** strategy addenda in its charter layer: its role's, then its own */
  addenda: StrategyVersionDTO[];
  /** lessons injected into its latest prompt, with why each one was picked */
  lessons: Array<{ id: string; text: string; reason: string }>;
  /** saved procedures that match its current or last task */
  skills: Array<{ id: string; name: string; description: string; reason: string }>;
  /** runtime JEV decisions about this cat: its role, its hire, its strategies, letting it go */
  decisions: DecisionDTO[];
  /** strategy versions of its role and of the cat itself, newest first */
  history: StrategyVersionDTO[];
  updatedAt: number;
}

/** Full picture of one run, used for the first paint before the SSE stream. */
export interface RunSnapshotDTO {
  run: RunDTO;
  agents: AgentDTO[];
  tasks: TaskDTO[];
  handoffs: HandoffDTO[];
  decisions: DecisionDTO[];
  approvals: ApprovalDTO[];
  /** crew meetings, oldest first, so a reload restores the meeting room */
  meetings?: MeetingDTO[];
  /** agents that were let go, with leftReason; `agents` holds the crew still at work */
  departed?: AgentDTO[];
  /** dynamic roles used in this run */
  roles?: RoleDTO[];
  /** where the run is on the tracker */
  stage?: RunStage;
  /** events are replayed from this seq onward over SSE */
  lastSeq: number;
}
