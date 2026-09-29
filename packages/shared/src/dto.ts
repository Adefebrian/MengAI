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
  /** events are replayed from this seq onward over SSE */
  lastSeq: number;
}
