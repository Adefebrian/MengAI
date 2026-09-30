// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// One timeline line per event worth reading. Tool calls are folded into
// their results (the result carries the call's target), usage ticks and
// routine status changes are left out, so the timeline stays a record of
// what happened, not a log dump.
import { ACTIVITY_LABEL, ROLE_LABEL, type MengaiEvent } from "@mengai/shared";
import type { GlyphName, StatusTone } from "@mengai/ui/src/product";
import type { RunState } from "../../store/runStore";
import { APPROVAL_STATUS, RUN_STATUS, SEVERITY, TASK_STATUS } from "../status";
import { previewTarget } from "./office";

export interface TimelineLine {
  seq: number;
  ts: number;
  who: string | null;
  text: string;
  detail: string | null;
  icon: GlyphName;
  tone: StatusTone;
}

function nameOf(s: RunState, id: string | null | undefined): string | null {
  if (!id) return null;
  return s.agents[id]?.name ?? null;
}

function taskTitle(s: RunState, id: string | null | undefined): string {
  if (!id) return "a task";
  return s.tasks[id]?.title ?? "a task";
}

/** The tools a log reader meets most, as a verb; any other tool keeps its name. */
const TOOL_VERB: Record<string, string> = {
  fs_read: "Read",
  fs_list: "Listed",
  fs_search: "Searched for",
  fs_write: "Wrote",
  fs_edit: "Edited",
  fs_delete: "Deleted",
  shell_run: "Ran",
  web_search: "Searched the web for",
  web_fetch: "Fetched",
  create_tasks: "Planned tasks",
  update_task: "Updated a task",
  list_tasks: "Checked the task list",
  crew_status: "Checked on the crew",
  handoff: "Handed off",
  finish: "Finished",
  submit_review: "Submitted the review",
  report_issue: "Reported an issue",
  scan_deps: "Scanned dependencies",
  scan_secrets: "Scanned for secrets",
  scan_config: "Scanned the config",
  generate_image: "Drew an image",
  record_lesson: "Recorded a lesson",
  recall: "Recalled lessons",
  note: "Took a note",
  ask_human: "Asked you",
};

/** Map one event to a line, or null when it is not worth a line. */
export function describeEvent(e: MengaiEvent, s: RunState, calls: Map<string, string>): TimelineLine | null {
  const who = nameOf(s, e.agentId);
  const base = { seq: e.seq, ts: e.ts, who };
  switch (e.type) {
    case "run.created": {
      const d = (e as MengaiEvent<"run.created">).data;
      return { ...base, text: "Run created", detail: d.run.goal, icon: "runs", tone: "neutral" };
    }
    case "run.status": {
      const d = (e as MengaiEvent<"run.status">).data;
      const look = RUN_STATUS[d.status];
      return { ...base, text: `Run ${look.word.toLowerCase()}`, detail: d.reason, icon: look.icon, tone: look.tone };
    }
    case "agent.spawned": {
      const d = (e as MengaiEvent<"agent.spawned">).data;
      return { ...base, who: d.agent.name, text: `Joined as ${ROLE_LABEL[d.agent.role].toLowerCase()}`, detail: null, icon: "user", tone: "neutral" };
    }
    case "agent.status": {
      const d = (e as MengaiEvent<"agent.status">).data;
      if (d.status === "error") return { ...base, text: "Hit an error", detail: d.statusText, icon: "xCircle", tone: "danger" };
      if (d.status === "stopped") return { ...base, text: "Stopped", detail: d.statusText, icon: "stopAll", tone: "neutral" };
      return null;
    }
    case "agent.say": {
      const d = (e as MengaiEvent<"agent.say">).data;
      const to = nameOf(s, d.to);
      return { ...base, text: to ? `Said to ${to}` : "Said", detail: d.text, icon: "message", tone: "neutral" };
    }
    case "tool.result": {
      const d = (e as MengaiEvent<"tool.result">).data;
      const preview = calls.get(d.callId);
      const target = preview ? previewTarget(preview) : null;
      const verb = TOOL_VERB[d.tool] ?? d.tool;
      const text = `${verb}${target ? ` ${target}` : ""}`;
      return { ...base, text, detail: d.summary, icon: d.ok ? "code" : "xCircle", tone: d.ok ? "neutral" : "danger" };
    }
    case "task.created": {
      const d = (e as MengaiEvent<"task.created">).data;
      return { ...base, text: "Planned a task", detail: d.task.title, icon: "task", tone: "neutral" };
    }
    case "task.updated": {
      const d = (e as MengaiEvent<"task.updated">).data;
      const look = TASK_STATUS[d.task.status];
      const owner = nameOf(s, d.task.assigneeId);
      return { ...base, who: owner ?? who, text: `${look.word}: ${d.task.title}`, detail: d.task.status === "done" ? d.task.resultSummary : null, icon: look.icon, tone: look.tone };
    }
    case "handoff": {
      const d = (e as MengaiEvent<"handoff">).data;
      const to = nameOf(s, d.handoff.toAgentId) ?? ROLE_LABEL[d.handoff.toRole];
      return { ...base, who: nameOf(s, d.handoff.fromAgentId), text: `Handed ${taskTitle(s, d.handoff.taskId)} to ${to}`, detail: d.handoff.summary, icon: "arrowRightCircle", tone: "neutral" };
    }
    case "decision": {
      const d = (e as MengaiEvent<"decision">).data;
      return { ...base, text: `Decision ${d.decision.decisionId}`, detail: d.decision.action, icon: "layers", tone: d.decision.verified ? "neutral" : "warning" };
    }
    case "approval.requested": {
      const d = (e as MengaiEvent<"approval.requested">).data;
      return { ...base, text: "Asked for approval", detail: d.approval.title, icon: "approvals", tone: "warning" };
    }
    case "approval.resolved": {
      const d = (e as MengaiEvent<"approval.resolved">).data;
      const look = APPROVAL_STATUS[d.status];
      const a = s.approvals[d.id];
      return { ...base, who: "You", text: look.word, detail: a?.title ?? null, icon: look.icon, tone: look.tone };
    }
    case "automation.action": {
      const d = (e as MengaiEvent<"automation.action">).data;
      return { ...base, text: d.outcome === "ok" ? `Ran ${d.target}` : `Could not run ${d.target}`, detail: `${d.capability}, ${d.outcome === "ok" ? "approved by you" : d.outcome}`, icon: "code", tone: d.outcome === "ok" ? "neutral" : "danger" };
    }
    case "file.changed": {
      const d = (e as MengaiEvent<"file.changed">).data;
      const verb = d.op === "create" ? "Created" : d.op === "delete" ? "Deleted" : "Changed";
      return { ...base, text: `${verb} ${d.path}`, detail: null, icon: "file", tone: "neutral" };
    }
    case "finding": {
      const d = (e as MengaiEvent<"finding">).data;
      const look = SEVERITY[d.severity];
      return { ...base, text: `Finding, ${look.word.toLowerCase()}`, detail: d.finding.title, icon: look.icon, tone: look.tone };
    }
    case "lesson.recorded": {
      const d = (e as MengaiEvent<"lesson.recorded">).data;
      return { ...base, text: "Recorded a lesson", detail: d.lesson.text, icon: "memory", tone: "neutral" };
    }
    case "memory.compacted": {
      const d = (e as MengaiEvent<"memory.compacted">).data;
      return { ...base, who: nameOf(s, d.agentId), text: "Compacted its context", detail: `${d.tokensBefore} to ${d.tokensAfter} tokens`, icon: "layers", tone: "neutral" };
    }
    case "killswitch": {
      const d = (e as MengaiEvent<"killswitch">).data;
      return { ...base, who: "You", text: "Stop all", detail: `${d.stoppedRuns} runs and ${d.killedProcesses} processes stopped`, icon: "stopAll", tone: "danger" };
    }
    case "meeting.started": {
      const d = (e as MengaiEvent<"meeting.started">).data;
      const who2 = d.agentIds.map((id) => nameOf(s, id)).filter(Boolean).join(", ");
      return { ...base, text: `Called a meeting: ${d.title}`, detail: who2 ? `At the table: ${who2}` : null, icon: "users", tone: "neutral" };
    }
    case "meeting.ended": {
      const d = (e as MengaiEvent<"meeting.ended">).data;
      const title = s.meetings[d.meetingId]?.title ?? "The meeting";
      return { ...base, text: `${title} ended`, detail: d.decisions.length ? `Agreed: ${d.decisions.join("; ")}` : (d.notes[0] ?? null), icon: "users", tone: "neutral" };
    }
    case "request.raised": {
      const d = (e as MengaiEvent<"request.raised">).data;
      const to = d.toAgentId ? nameOf(s, d.toAgentId) : d.toOwner ? "you" : "the CEO";
      return { ...base, who: nameOf(s, d.fromAgentId) ?? who, text: `Asked ${to ?? "the CEO"}`, detail: d.question, icon: "message", tone: "neutral" };
    }
    case "request.decided": {
      const d = (e as MengaiEvent<"request.decided">).data;
      const by = d.byOwner ? "You" : (nameOf(s, d.byAgentId) ?? who);
      const asker = nameOf(s, s.requests[d.requestId]?.fromAgentId);
      return { ...base, who: by, text: `${d.approved ? "Approved" : "Declined"}${asker ? ` ${asker}'s request` : " a request"}`, detail: d.answer, icon: d.approved ? "chatCheck" : "xCircle", tone: d.approved ? "success" : "neutral" };
    }
    case "error": {
      const d = (e as MengaiEvent<"error">).data;
      return { ...base, text: "Error", detail: d.message, icon: "alertCircle", tone: "danger" };
    }
    default:
      return null;
  }
}

/** Ids mean nothing to a reader: a tool summary loses them before it becomes a line. */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b\s*(\|\s*)?/gi;

function readable(line: TimelineLine): TimelineLine {
  if (!line.detail || !UUID.test(line.detail)) return line;
  UUID.lastIndex = 0;
  return { ...line, detail: line.detail.replace(UUID, "").replace(/\s+\|\s+/g, ", ").trim() || null };
}

/** Timeline lines, newest first. */
export function timelineLines(s: RunState, limit = 200): TimelineLine[] {
  const calls = new Map<string, string>();
  const out: TimelineLine[] = [];
  for (const e of s.log) {
    if (e.type === "tool.call") {
      const d = (e as MengaiEvent<"tool.call">).data;
      calls.set(d.callId, d.argsPreview);
      continue;
    }
    const line = describeEvent(e, s, calls);
    if (line) out.push(readable(line));
  }
  out.reverse();
  return out.slice(0, limit);
}

export function behaviourWord(activity: keyof typeof ACTIVITY_LABEL): string {
  return ACTIVITY_LABEL[activity];
}
