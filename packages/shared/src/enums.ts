// Closed vocabularies shared by the API, the web app, the desktop shell and
// the cat renderer. Every list is a const tuple so the union type and the
// runtime list can never drift apart.

export const MODES = ["local", "server"] as const;
export type Mode = (typeof MODES)[number];

/** The crew roles. Every role is a cat with its own props and tool set. */
export const AGENT_ROLES = [
  "lead",
  "engineer",
  "designer",
  "reviewer",
  "qa",
  "security",
  "researcher",
  "operator",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/**
 * Coarse lifecycle of an agent. `approval` means waiting on the human,
 * `waiting` means waiting on another agent (a handoff or a dependency).
 */
export const AGENT_STATUSES = [
  "idle",
  "thinking",
  "working",
  "waiting",
  "approval",
  "done",
  "error",
  "stopped",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * What the cat is visibly doing right now. Derived from the latest tool call
 * (see activity.ts) and drives the pose, prop and loop of the cat.
 */
export const ACTIVITIES = [
  "rest",
  "think",
  "plan",
  "code",
  "run",
  "read",
  "review",
  "research",
  "design",
  "scan",
  "automate",
  "handoff",
  "ask",
  "wait",
  "celebrate",
] as const;
export type Activity = (typeof ACTIVITIES)[number];

/** Deterministic mood from recent outcomes (no LLM involved). */
export const MOODS = ["calm", "focused", "proud", "frustrated", "tired"] as const;
export type Mood = (typeof MOODS)[number];

export const RUN_STATUSES = [
  "queued",
  "running",
  "paused",
  "stopping",
  "stopped",
  "done",
  "failed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TASK_STATUSES = [
  "queued",
  "ready",
  "running",
  "waiting",
  "review",
  "done",
  "failed",
  "blocked",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Model tiers the user maps to concrete provider models. */
export const TIERS = ["fast", "balanced", "deep"] as const;
export type Tier = (typeof TIERS)[number];

/** Local automation capabilities, each OFF by default. */
export const CAPABILITIES = ["fs", "shell", "browser", "input", "screen", "apps", "network"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const PERMISSION_MODES = ["off", "ask", "auto_read"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** destructive and sensitive always need an explicit human yes. */
export const RISKS = ["read", "write", "destructive", "sensitive"] as const;
export type Risk = (typeof RISKS)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "denied", "expired", "cancelled"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_SCOPES = ["once", "session"] as const;
export type ApprovalScope = (typeof APPROVAL_SCOPES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SCAN_KINDS = ["deps", "secrets", "config", "review"] as const;
export type ScanKind = (typeof SCAN_KINDS)[number];

export const SCAN_STATUSES = ["queued", "running", "done", "failed"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const FINDING_STATUSES = ["open", "fixed", "accepted", "false_positive"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

/** Wire protocol an adapter speaks. Most vendors are openai_chat compatible. */
export const PROVIDER_PROTOCOLS = [
  "openai_chat",
  "anthropic_messages",
  "openai_images",
  "gemini_media",
  "fal_queue",
  "replicate",
  "jev",
] as const;
export type ProviderProtocol = (typeof PROVIDER_PROTOCOLS)[number];

export const PROVIDER_CAPS = ["chat", "tools", "vision", "image", "video", "judge"] as const;
export type ProviderCap = (typeof PROVIDER_CAPS)[number];

export const LESSON_SCOPES = ["global", "role", "project"] as const;
export type LessonScope = (typeof LESSON_SCOPES)[number];

export const LESSON_STATUSES = ["candidate", "active", "retired"] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const ASSET_KINDS = ["image", "video"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_STATUSES = ["queued", "running", "done", "failed"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** Why an LLM call was made, for usage breakdowns and the context X-ray. */
export const CALL_PURPOSES = ["step", "plan", "summarize", "reflect", "judge", "review"] as const;
export type CallPurpose = (typeof CALL_PURPOSES)[number];

/** Layers of an agent prompt, stable first, for the context X-ray. */
export const CONTEXT_LAYERS = [
  "charter",
  "tools",
  "brief",
  "memory",
  "task",
  "summary",
  "recent",
] as const;
export type ContextLayer = (typeof CONTEXT_LAYERS)[number];

export const AUDIT_ACTORS = ["user", "agent", "system"] as const;
export type AuditActor = (typeof AUDIT_ACTORS)[number];

export const AUDIT_OUTCOMES = ["ok", "denied", "failed", "killed"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
