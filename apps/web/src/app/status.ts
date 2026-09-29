// Every status the app shows, as a tone, an icon and a word. Meaning never
// rides on color alone.
import type { GlyphName, StatusTone } from "@mengai/ui/src/product";
import type {
  AgentStatus,
  ApprovalStatus,
  AssetStatus,
  FindingStatus,
  LessonStatus,
  Risk,
  RunStatus,
  ScanStatus,
  Severity,
  TaskStatus,
} from "@mengai/shared";

export interface StatusLook {
  tone: StatusTone;
  icon: GlyphName;
  word: string;
}

export const RUN_STATUS: Record<RunStatus, StatusLook> = {
  queued: { tone: "neutral", icon: "clock", word: "Queued" },
  running: { tone: "info", icon: "runs", word: "Running" },
  paused: { tone: "warning", icon: "pauseCircle", word: "Paused" },
  stopping: { tone: "warning", icon: "hourglass", word: "Stopping" },
  stopped: { tone: "neutral", icon: "stopAll", word: "Stopped" },
  done: { tone: "success", icon: "checkCircle", word: "Done" },
  failed: { tone: "danger", icon: "xCircle", word: "Failed" },
};

export const AGENT_STATUS: Record<AgentStatus, StatusLook> = {
  idle: { tone: "neutral", icon: "clock", word: "Idle" },
  thinking: { tone: "info", icon: "layers", word: "Thinking" },
  working: { tone: "info", icon: "runs", word: "Working" },
  waiting: { tone: "neutral", icon: "hourglass", word: "Waiting" },
  approval: { tone: "warning", icon: "alertTriangle", word: "Needs you" },
  done: { tone: "success", icon: "checkCircle", word: "Done" },
  error: { tone: "danger", icon: "xCircle", word: "Error" },
  stopped: { tone: "neutral", icon: "stopAll", word: "Stopped" },
};

export const MOOD_WORD = {
  calm: "calm",
  focused: "focused",
  proud: "proud",
  frustrated: "frustrated",
  tired: "tired",
} as const;

export const TASK_STATUS: Record<TaskStatus, StatusLook> = {
  queued: { tone: "neutral", icon: "clock", word: "Queued" },
  ready: { tone: "neutral", icon: "arrowRightCircle", word: "Ready" },
  running: { tone: "info", icon: "runs", word: "Running" },
  waiting: { tone: "neutral", icon: "hourglass", word: "Waiting" },
  review: { tone: "info", icon: "eye", word: "In review" },
  done: { tone: "success", icon: "checkCircle", word: "Done" },
  failed: { tone: "danger", icon: "xCircle", word: "Failed" },
  blocked: { tone: "warning", icon: "ban", word: "Blocked" },
  cancelled: { tone: "neutral", icon: "minusCircle", word: "Cancelled" },
};

export const RISK: Record<Risk, StatusLook> = {
  read: { tone: "neutral", icon: "eye", word: "Read only" },
  write: { tone: "warning", icon: "alertTriangle", word: "Writes" },
  destructive: { tone: "danger", icon: "alertTriangle", word: "Destructive" },
  sensitive: { tone: "danger", icon: "alertCircle", word: "Sensitive" },
};

export const APPROVAL_STATUS: Record<ApprovalStatus, StatusLook> = {
  pending: { tone: "warning", icon: "hourglass", word: "Waiting on you" },
  approved: { tone: "success", icon: "checkCircle", word: "Approved" },
  denied: { tone: "danger", icon: "xCircle", word: "Denied" },
  expired: { tone: "neutral", icon: "clock", word: "Expired" },
  cancelled: { tone: "neutral", icon: "minusCircle", word: "Cancelled" },
};

export const SEVERITY: Record<Severity, StatusLook> = {
  critical: { tone: "danger", icon: "alertCircle", word: "Critical" },
  high: { tone: "danger", icon: "alertTriangle", word: "High" },
  medium: { tone: "warning", icon: "alertTriangle", word: "Medium" },
  low: { tone: "info", icon: "infoCircle", word: "Low" },
  info: { tone: "neutral", icon: "infoCircle", word: "Info" },
};

export const FINDING_STATUS: Record<FindingStatus, string> = {
  open: "Open",
  fixed: "Fixed",
  accepted: "Accepted risk",
  false_positive: "False positive",
};

export const LESSON_STATUS: Record<LessonStatus, StatusLook> = {
  candidate: { tone: "neutral", icon: "clock", word: "Candidate" },
  active: { tone: "success", icon: "checkCircle", word: "Active" },
  retired: { tone: "neutral", icon: "minusCircle", word: "Retired" },
};

export const JOB_STATUS: Record<ScanStatus | AssetStatus, StatusLook> = {
  queued: { tone: "neutral", icon: "clock", word: "Queued" },
  running: { tone: "info", icon: "runs", word: "Running" },
  done: { tone: "success", icon: "checkCircle", word: "Done" },
  failed: { tone: "danger", icon: "xCircle", word: "Failed" },
};

export function isFinished(status: RunStatus | undefined | null): boolean {
  return status === "done" || status === "failed" || status === "stopped";
}
