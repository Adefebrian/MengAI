// The live event stream. Every event is appended to the events table with a
// global monotonic seq, then pushed over SSE (id: seq). Clients resume with
// Last-Event-ID, so a reconnect never loses or duplicates an event.
//
// Payloads are small on purpose: tool outputs never ride the stream (only a
// short summary), and every text field is already redacted and truncated by
// the server.
import type {
  AgentDTO,
  ApprovalDTO,
  AssetDTO,
  DecisionDTO,
  FindingDTO,
  HandoffDTO,
  LessonDTO,
  RunDTO,
  TaskDTO,
  UsageTotals,
} from "./dto";
import type { Activity, AgentStatus, Capability, Mood, Risk, RunStatus, Severity } from "./enums";

export interface EventMap {
  "run.created": { run: RunDTO };
  "run.status": { status: RunStatus; reason: string | null };
  "run.usage": { usage: UsageTotals; budgetTokens: number; budgetUsd: number; progress: number };
  "agent.spawned": { agent: AgentDTO };
  "agent.status": {
    status: AgentStatus;
    activity: Activity;
    mood: Mood;
    statusText: string | null;
    taskId: string | null;
  };
  /** short streamed caption of what the agent is saying or thinking, max 280 chars */
  "agent.say": { text: string; to: string | null };
  "tool.call": { callId: string; tool: string; activity: Activity; argsPreview: string };
  "tool.result": { callId: string; tool: string; ok: boolean; summary: string; durationMs: number };
  "task.created": { task: TaskDTO };
  "task.updated": { task: TaskDTO };
  handoff: { handoff: HandoffDTO };
  decision: { decision: DecisionDTO };
  "approval.requested": { approval: ApprovalDTO };
  "approval.resolved": { id: string; status: ApprovalDTO["status"] };
  "automation.action": {
    capability: Capability;
    action: string;
    target: string;
    risk: Risk;
    outcome: "ok" | "denied" | "failed" | "killed";
  };
  /** latest downscaled screenshot for the live operator view (served by URL, not inline) */
  "automation.frame": { url: string; width: number; height: number; focus: { x: number; y: number; w: number; h: number } | null };
  "file.changed": { path: string; op: "create" | "update" | "delete"; bytes: number };
  "asset.updated": { asset: AssetDTO };
  finding: { finding: FindingDTO; severity: Severity };
  "lesson.recorded": { lesson: LessonDTO };
  "memory.compacted": { agentId: string; tokensBefore: number; tokensAfter: number };
  killswitch: { by: "user" | "shortcut" | "tray" | "system"; stoppedRuns: number; killedProcesses: number };
  error: { message: string; code: string | null };
}

export type EventType = keyof EventMap;

export interface MengaiEvent<T extends EventType = EventType> {
  /** global monotonic sequence, also the SSE id */
  seq: number;
  ts: number;
  type: T;
  runId: string | null;
  agentId: string | null;
  taskId: string | null;
  data: EventMap[T];
}

/** Narrowing helper for reducers: `if (isEvent(e, "agent.status")) e.data.activity` */
export function isEvent<T extends EventType>(e: MengaiEvent, type: T): e is MengaiEvent<T> {
  return e.type === type;
}

export const EVENT_TYPES = [
  "run.created",
  "run.status",
  "run.usage",
  "agent.spawned",
  "agent.status",
  "agent.say",
  "tool.call",
  "tool.result",
  "task.created",
  "task.updated",
  "handoff",
  "decision",
  "approval.requested",
  "approval.resolved",
  "automation.action",
  "automation.frame",
  "file.changed",
  "asset.updated",
  "finding",
  "lesson.recorded",
  "memory.compacted",
  "killswitch",
  "error",
] as const satisfies readonly EventType[];

/** SSE event name used on the wire for every MengaiEvent (data is the JSON envelope). */
export const SSE_EVENT_NAME = "mengai";
/** Heartbeat comment interval for SSE, in ms. */
export const SSE_HEARTBEAT_MS = 15_000;
