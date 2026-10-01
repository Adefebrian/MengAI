// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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
  RoleDTO,
  RunDTO,
  RunStage,
  TaskDTO,
  UsageTotals,
} from "./dto";
import type { Activity, AgentRole, AgentStatus, Capability, Mood, Risk, RunStatus, Severity } from "./enums";

export interface EventMap {
  "run.created": { run: RunDTO };
  "run.status": { status: RunStatus; reason: string | null };
  "run.usage": { usage: UsageTotals; budgetTokens: number; budgetUsd: number; progress: number };
  "agent.spawned": {
    agent: AgentDTO;
    /** why the cat was hired (the plan needs the role, work is waiting, a cat asked for help, a replacement), at most 160 chars */
    reason?: string;
    /** the cat that hired it: the CEO or the cat that asked for help; null for the CEO itself */
    hiredBy?: string | null;
  };
  /** a cat left the company: the CEO let it go (runtime JEV orch.let_go); its tasks went back on the board */
  "agent.left": { agentId: string; reason: string; byAgentId: string | null; requeued: string[] };
  /**
   * The self-critique before a finish is accepted, evidence first (files
   * changed, checks run and their exit codes). pass accepts the finish,
   * revise sends the cat into another round. by: a rule decided on
   * conclusive evidence, or the fast-tier critic read the evidence.
   */
  "agent.reflexion": {
    taskId: string;
    /** 1-based check number for this task */
    check: number;
    verdict: "pass" | "revise";
    critique: string;
    by: "rule" | "critic";
    evidence: { files: number; checks: number; failedChecks: number };
  };
  /** a role or one cat adopted a new strategy addendum (runtime JEV prompt.adopt); it reaches the next step */
  "strategy.updated": {
    subject: "role" | "agent";
    /** role key or agent id */
    subjectKey: string;
    role: AgentRole;
    roleTitle: string;
    version: number;
    previousVersion: number | null;
    text: string;
    choice: "adopt" | "merge";
    reason: string;
    scores: { current: number; candidate: number };
  };
  /** a cat defined a new role from context (runtime JEV orch.role picked the archetype) */
  "role.created": { role: RoleDTO; reason: string; byAgentId: string | null };
  /** the run moved on the tracker; a failed review loops back to working */
  "run.stage": { stage: RunStage; previous: RunStage | null; reason: string };
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
  /** the crew gathers: kickoff after the plan, sync after a failed review, wrap-up before the report */
  "meeting.started": { meetingId: string; kind: MeetingKind; title: string; agentIds: string[]; agenda: string[] };
  "meeting.ended": { meetingId: string; kind: MeetingKind; notes: string[]; decisions: string[] };
  /** a crew member asked something; the lead (the CEO cat) decides unless it must go to the owner */
  "request.raised": { requestId: string; fromAgentId: string; toAgentId: string | null; question: string; toOwner: boolean };
  "request.decided": { requestId: string; byAgentId: string | null; byOwner: boolean; answer: string; approved: boolean };
  error: { message: string; code: string | null };
  /** a trade was proposed, decided or filled (paper or live) */
  "trade.order": { order: import("./capabilities").OrderDTO };
  "trade.positions": { positions: import("./capabilities").PositionDTO[] };
  "connector.status": { connectorId: string; status: "connected" | "error" | "disabled"; error: string | null };
  /**
   * A fact the engine knows best, sent for the island's moments: a review
   * verdict, the CEO answering a crew request itself, a cat rethinking or
   * stuck, the budget running low. Facts only, never an animation name;
   * `text` is one plain sentence, clipped to MOMENT_TEXT_MAX.
   */
  moment: { kind: MomentKind; agentId: string | null; taskId: string | null; level: MomentLevel; text: string };
}

export type EventType = keyof EventMap;

export const MOMENT_KINDS = ["review_pass", "review_fail", "ceo_approved", "ceo_denied", "rethink", "budget_low", "stuck"] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];
export const MOMENT_LEVELS = ["info", "good", "bad"] as const;
export type MomentLevel = (typeof MOMENT_LEVELS)[number];
/** The longest a moment's sentence may be. */
export const MOMENT_TEXT_MAX = 80;
/**
 * The share of a run's token or USD budget that counts as running low: the
 * engine sends its budget_low moment there, and the island's ring turns to
 * the warning tone there.
 */
export const MOMENT_BUDGET_LOW_SHARE = 0.8;

export const MEETING_KINDS = ["kickoff", "sync", "review", "wrapup"] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];

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
  "agent.left",
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
  "meeting.started",
  "meeting.ended",
  "request.raised",
  "request.decided",
  "agent.reflexion",
  "strategy.updated",
  "role.created",
  "run.stage",
  "error",
  "trade.order",
  "trade.positions",
  "connector.status",
  "moment",
] as const satisfies readonly EventType[];

/** SSE event name used on the wire for every MengaiEvent (data is the JSON envelope). */
export const SSE_EVENT_NAME = "mengai";
/** Heartbeat comment interval for SSE, in ms. */
export const SSE_HEARTBEAT_MS = 15_000;
