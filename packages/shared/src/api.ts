// REST contract: request bodies and response shapes per route. The API
// validates every body with zod against these shapes; the web client is a
// thin typed fetch wrapper over the same types. Errors are always
// `{ error: { code, message } }` with a matching HTTP status.
import type {
  AgentDTO,
  AgentMindDTO,
  ApprovalDTO,
  AssetDTO,
  AuditEntryDTO,
  ContextXrayDTO,
  DecisionDTO,
  EvalRunDTO,
  FileNodeDTO,
  FindingDTO,
  HealthDTO,
  LessonDTO,
  LlmCallDTO,
  ModelRouting,
  PermissionDTO,
  ProjectDTO,
  ProviderDTO,
  ProviderModel,
  RunDTO,
  RunSnapshotDTO,
  ScanDTO,
  SessionDTO,
  SkillDTO,
  TaskDTO,
  UsageTotals,
} from "./dto";
import type {
  AgentRole,
  ApprovalScope,
  AssetKind,
  Capability,
  FindingStatus,
  LessonScope,
  LessonStatus,
  PermissionMode,
  ScanKind,
  TaskStatus,
} from "./enums";
import type { ModelPrice } from "./pricing";
import type { ProviderPreset } from "./providers";

export interface ApiError {
  error: { code: string; message: string };
}

// auth
export interface SetupBody { email: string; password: string; setupCode: string }
export interface LoginBody { email: string; password: string }
export interface LaunchBody { token: string }

// providers
export interface CreateProviderBody {
  preset: string;
  label?: string;
  baseUrl?: string;
  /** sent once, stored in the vault, never returned */
  apiKey?: string;
  models?: ProviderModel[];
}
export interface UpdateProviderBody {
  label?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: ProviderModel[];
}
export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  error: string | null;
  models: ProviderModel[];
}

// projects and runs
export interface CreateProjectBody { name: string; workspacePath?: string }
/** budgetTokens and budgetUsd: 0 means unlimited */
export interface CreateRunBody { projectId: string; goal: string; budgetTokens?: number; budgetUsd?: number; company?: import("./capabilities").CompanyKind }
export interface EstimateRunBody { projectId: string; goal: string }
export interface RunEstimate { tasks: number; tokens: number; costUsd: number; basis: "history" | "heuristic" }
export interface HumanMessageBody { text: string; agentId?: string }
/** 0 means unlimited */
export interface BudgetBody { budgetTokens?: number; budgetUsd?: number }
export interface TaskPatchBody { status?: Extract<TaskStatus, "queued" | "cancelled">; assigneeId?: string | null; priority?: number }
export interface FileContent { path: string; content: string; truncated: boolean; size: number; binary: boolean }
export interface ToolCallDetail { id: string; tool: string; args: unknown; output: string; ok: boolean; durationMs: number; createdAt: number }

// usage
export interface UsageReport {
  totals: UsageTotals;
  cacheHitRate: number;
  byModel: Array<{ model: string } & UsageTotals>;
  byRole: Array<{ role: AgentRole } & UsageTotals>;
}

// memory
export interface LessonPatchBody { status?: LessonStatus; text?: string }
/** GET /api/memory/lessons query (all optional); newest first, 422 invalid_query on a bad value */
export interface LessonListQuery {
  status?: LessonStatus;
  scope?: LessonScope;
  projectId?: string;
  role?: AgentRole;
  /** keyset cursor "<createdAt>,<id>" taken from the last row of the previous page */
  before?: string;
  /** 1 to 500, default 200 */
  limit?: number;
}

// decisions and evals
/** GET /api/decisions query (all optional); the latest `limit` rows, oldest first */
export interface DecisionListQuery {
  runId?: string;
  /** 1 to 500, default 200 */
  limit?: number;
}
/** GET /api/evals query (all optional); newest first */
export interface EvalListQuery {
  /** suite id, for example "core" */
  suite?: string;
  /** 1 to 200, default 50 */
  limit?: number;
}

// assets
export interface CreateAssetBody {
  kind: AssetKind;
  prompt: string;
  providerId?: string;
  model?: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536";
  durationSec?: number;
  runId?: string;
}

// security
export interface CreateScanBody { projectId: string; kinds: ScanKind[] }
export interface FindingPatchBody { status: FindingStatus }

// automation
export interface GrantBody { mode: PermissionMode; scope?: string[]; expiresAt?: number | null }
export interface ApprovalDecisionBody { decision: "approve" | "deny"; scope?: ApprovalScope }
export interface AutomationStatus {
  available: boolean;
  reason: string | null;
  permissions: { accessibility: boolean; screen: boolean };
  active: boolean;
}
export interface AuditVerify { ok: boolean; count: number; brokenAt: number | null }
export interface KillSwitchBody { by?: "user" | "shortcut" | "tray" }
export interface KillSwitchResult { stoppedRuns: number; killedProcesses: number }

// settings
export interface OwnerSettings {
  /** 0 means unlimited */
  defaultBudgetTokens: number;
  /** 0 means unlimited */
  defaultBudgetUsd: number;
  /** the scheduler's concurrency queue: at most this many cats work at once */
  maxConcurrentAgents: number;
  /** the CEO cat's name (default "Oyen"); always present in GET /api/settings */
  ceoName?: string;
  /** cats in one run at most, the CEO included; 0 means unlimited (default); always present in GET /api/settings */
  maxAgents?: number;
  /** levels of the org below the CEO; 0 means unlimited (default); always present in GET /api/settings */
  maxDepth?: number;
  /** network consent for dependency audits (OSV) and web research */
  allowNetworkTools: boolean;
  /** celebration and quirk animations can be turned down here as well as by the OS */
  motion: "full" | "calm" | "off";
  prices: Record<string, ModelPrice>;
}

/**
 * Route table: METHOD path -> [request body, response]. `never` body means
 * no JSON body. Path params use :name.
 */
export interface Routes {
  "GET /api/health": [never, HealthDTO];
  "GET /api/session": [never, SessionDTO];
  "POST /api/auth/setup": [SetupBody, SessionDTO];
  "POST /api/auth/login": [LoginBody, SessionDTO];
  "POST /api/auth/logout": [never, { ok: true }];
  "POST /api/auth/launch": [LaunchBody, SessionDTO];

  "GET /api/providers": [never, ProviderDTO[]];
  "GET /api/providers/presets": [never, ProviderPreset[]];
  "POST /api/providers": [CreateProviderBody, ProviderDTO];
  "PATCH /api/providers/:id": [UpdateProviderBody, ProviderDTO];
  "DELETE /api/providers/:id": [never, { ok: true }];
  "POST /api/providers/:id/test": [never, ProviderTestResult];
  "GET /api/routing": [never, ModelRouting];
  "PUT /api/routing": [ModelRouting, ModelRouting];

  "GET /api/projects": [never, ProjectDTO[]];
  "POST /api/projects": [CreateProjectBody, ProjectDTO];
  "GET /api/projects/:id": [never, ProjectDTO];
  "DELETE /api/projects/:id": [never, { ok: true }];
  "GET /api/projects/:id/files": [never, FileNodeDTO[]];
  "GET /api/projects/:id/file": [never, FileContent];

  "GET /api/runs": [never, RunDTO[]];
  "POST /api/runs": [CreateRunBody, RunDTO];
  "POST /api/runs/estimate": [EstimateRunBody, RunEstimate];
  "GET /api/runs/:id": [never, RunSnapshotDTO];
  "POST /api/runs/:id/pause": [never, RunDTO];
  "POST /api/runs/:id/resume": [never, RunDTO];
  "POST /api/runs/:id/stop": [never, RunDTO];
  "POST /api/runs/:id/message": [HumanMessageBody, { ok: true }];
  "PATCH /api/runs/:id/budget": [BudgetBody, RunDTO];
  "PATCH /api/runs/:id/tasks/:taskId": [TaskPatchBody, TaskDTO];
  "POST /api/runs/:id/agents/:agentId/stop": [never, AgentDTO];
  "GET /api/runs/:id/calls": [never, LlmCallDTO[]];
  "GET /api/runs/:id/tools/:callId": [never, ToolCallDetail];
  "GET /api/runs/:id/xray/:agentId": [never, ContextXrayDTO];
  /** what is in one cat's head: charter version, strategy addenda, lessons, skills, JEV decisions, history */
  "GET /api/runs/:id/agents/:agentId/mind": [never, AgentMindDTO];
  /** SSE stream: query runId (optional) and after (seq); honors Last-Event-ID */
  "GET /api/events": [never, never];

  "GET /api/usage": [never, UsageReport];
  "GET /api/decisions": [never, DecisionDTO[]];

  "GET /api/memory/lessons": [never, LessonDTO[]];
  "PATCH /api/memory/lessons/:id": [LessonPatchBody, LessonDTO];
  "DELETE /api/memory/lessons/:id": [never, { ok: true }];
  "GET /api/memory/skills": [never, SkillDTO[]];
  "DELETE /api/memory/skills/:id": [never, { ok: true }];

  "GET /api/evals": [never, EvalRunDTO[]];
  "POST /api/evals/run": [{ suite?: string }, { legacy: EvalRunDTO; v2: EvalRunDTO; savingsPct: number }];

  "GET /api/assets": [never, AssetDTO[]];
  "POST /api/assets": [CreateAssetBody, AssetDTO];
  "GET /api/assets/:id/file": [never, never];
  "DELETE /api/assets/:id": [never, { ok: true }];

  "POST /api/security/scans": [CreateScanBody, ScanDTO];
  "GET /api/security/scans": [never, ScanDTO[]];
  "GET /api/security/scans/:id/findings": [never, FindingDTO[]];
  "PATCH /api/security/findings/:id": [FindingPatchBody, FindingDTO];

  "GET /api/automation/status": [never, AutomationStatus];
  "POST /api/automation/permissions/request": [{ kind: "accessibility" | "screen" }, AutomationStatus];
  "GET /api/automation/grants": [never, PermissionDTO[]];
  "PUT /api/automation/grants/:capability": [GrantBody, PermissionDTO];
  "GET /api/automation/approvals": [never, ApprovalDTO[]];
  "POST /api/automation/approvals/:id": [ApprovalDecisionBody, ApprovalDTO];
  "GET /api/automation/audit": [never, AuditEntryDTO[]];
  "GET /api/automation/audit/verify": [never, AuditVerify];
  "GET /api/automation/frames/:id": [never, never];

  "GET /api/connectors": [never, import("./capabilities").ConnectorDTO[]];
  "POST /api/connectors": [import("./capabilities").CreateConnectorBody, import("./capabilities").ConnectorDTO];
  "PATCH /api/connectors/:id": [import("./capabilities").UpdateConnectorBody, import("./capabilities").ConnectorDTO];
  "DELETE /api/connectors/:id": [never, { ok: true }];
  "POST /api/connectors/:id/test": [never, import("./capabilities").ConnectorDTO];

  "GET /api/trading/venues": [never, import("./capabilities").TradingVenueDTO[]];
  "POST /api/trading/venues": [import("./capabilities").CreateTradingVenueBody, import("./capabilities").TradingVenueDTO];
  "PATCH /api/trading/venues/:id": [Partial<import("./capabilities").CreateTradingVenueBody> & { enabled?: boolean }, import("./capabilities").TradingVenueDTO];
  "DELETE /api/trading/venues/:id": [never, { ok: true }];
  "POST /api/trading/venues/:id/learn": [never, import("./capabilities").TradingVenueDTO];
  /** local runtime pairing from a hosted website: exchanges a pairing token for a bearer session and registers the calling origin */
  "POST /api/auth/pair": [{ token: string }, { sessionToken: string; origin: string }];
  "GET /api/trading/settings": [never, import("./capabilities").TradingSettings];
  "PUT /api/trading/settings": [import("./capabilities").TradingSettings, import("./capabilities").TradingSettings];
  "GET /api/trading/orders": [never, import("./capabilities").OrderDTO[]];
  "GET /api/trading/positions": [never, import("./capabilities").PositionDTO[]];
  "POST /api/trading/orders/:id/decision": [{ decision: "approve" | "reject" }, import("./capabilities").OrderDTO];

  /** always mounted in both modes; stops every run, and in local mode all automation */
  "POST /api/killswitch": [KillSwitchBody, KillSwitchResult];

  "GET /api/settings": [never, OwnerSettings];
  "PATCH /api/settings": [Partial<OwnerSettings>, OwnerSettings];
  /** local mode only: native folder picker */
  "POST /api/local/pick-folder": [never, { path: string | null }];
}

export type RouteKey = keyof Routes;
export type RouteBody<K extends RouteKey> = Routes[K][0];
export type RouteResponse<K extends RouteKey> = Routes[K][1];

/**
 * Optional query strings per route key, a companion to Routes (whose
 * [body, response] tuples stay as they are). Every field is optional.
 */
export interface RouteQueries {
  "GET /api/memory/lessons": LessonListQuery;
  "GET /api/decisions": DecisionListQuery;
  "GET /api/evals": EvalListQuery;
}
export type RouteQuery<K extends RouteKey> = K extends keyof RouteQueries ? RouteQueries[K] : never;

/** Header the Tauri shell uses for tray and global-shortcut calls (kill switch). */
export const CONTROL_TOKEN_HEADER = "x-mengai-control";
/** Header every mutating browser request must carry (CSRF defense with Origin check). */
export const CSRF_HEADER = "x-mengai-csrf";
export const SESSION_COOKIE = "mengai_session";
