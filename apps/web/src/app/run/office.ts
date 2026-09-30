// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The live store as the Office scene's props (packages/cats office-contract).
// Pure functions only, so the run page, the replay and the tests read the
// same shapes: the crew at its desks (energy, the file on each monitor, the
// task on each desk), the meetings, the plan on the CEO whiteboard, and the
// one-shot beats the scene choreographs, one per matching event:
//   handoff           a cat walks the task card to a colleague
//   request.raised    a cat walks to the CEO to ask
//   request.decided   the CEO answers, yes or no
//   review task done  the reviewer brings the verdict to the maker
//   task done         the maker delivers the work
//   run done          the whole company celebrates
import type { OfficeAgent, OfficeBeat, OfficeMeeting, OfficeProps } from "@mengai/cats";
import { ACTIVITY_LABEL, ROLE_LABEL, type AgentDTO, type AgentRole, type MeetingKind, type MengaiEvent, type TaskDTO } from "@mengai/shared";
import type { RunState } from "../../store/runStore";
import { crewOrder, tokensUsed } from "../../store/runStore";
import { energyOf, runApprovals, taskCounts, type AgentSpend } from "./derive";

/** The lead is the CEO of the cat company. */
export function roleWord(role: AgentRole): string {
  return role === "lead" ? "CEO" : ROLE_LABEL[role];
}

/** The title a cat carries on its desk plate and in every list: CEO for the lead, else its role title (a dynamic title like "Launch tester", or the base role). */
export function roleTitleOf(a: Pick<AgentDTO, "role" | "roleTitle">): string {
  if (a.role === "lead") return "CEO";
  const t = a.roleTitle?.trim();
  return t ? t : ROLE_LABEL[a.role];
}

export function leadOf(s: RunState): AgentDTO | null {
  return crewOrder(s).find((a) => a.role === "lead") ?? null;
}

/** The newest event time: the clock of a live run and of a replay alike. */
export function clockOf(s: RunState): number {
  return s.log.at(-1)?.ts ?? s.run?.startedAt ?? s.run?.createdAt ?? 0;
}

function baseName(path: string): string {
  const cut = path.replace(/\/+$/, "").lastIndexOf("/");
  return cut < 0 ? path : path.slice(cut + 1);
}

/**
 * The file or target a tool call works on, from its preview: the demo
 * writes "src/app.ts (40 lines)", the engine a clipped JSON of the
 * arguments with a "path" field.
 */
export function toolTarget(preview: string): string | null {
  const m = /"(?:path|file|filePath|target)"\s*:\s*"([^"]+)"/.exec(preview);
  if (m) return m[1]!;
  const first = preview.trim().split(/\s/)[0] ?? "";
  if (!first || first.startsWith("{") || first.startsWith("[") || first.includes("*")) return null;
  return first;
}

/**
 * The short target of a tool call for a log line: the path, the command,
 * the search, the role handed to; a demo preview is already short. JSON is
 * never shown raw.
 */
export function previewTarget(preview: string): string | null {
  const t = preview.trim();
  if (!t.startsWith("{")) return t ? clip(t, 72) : null;
  const field = (k: string) => new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(t)?.[1]?.replace(/\\n/g, " ");
  const path = field("path") ?? field("file");
  if (path) return path;
  const cmd = field("command") ?? field("cmd");
  if (cmd) return clip(cmd, 72);
  const pattern = field("pattern") ?? field("query");
  if (pattern) return `"${clip(pattern, 48)}"`;
  const url = field("url");
  if (url) return clip(url, 72);
  const role = field("toRole");
  if (role) return `to the ${role}`;
  const title = field("title");
  return title ? clip(title, 60) : null;
}

/** Cut a line at a word boundary so it fits a speech bubble or a status line. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,.;:]$/, "")}…`;
}

/** The latest file each cat touched, keyed by agent id. */
export function latestFiles(s: RunState): Record<string, { path: string; ts: number }> {
  const out: Record<string, { path: string; ts: number }> = {};
  for (const [path, f] of Object.entries(s.files)) {
    if (!f.by || f.op === "delete") continue;
    const cur = out[f.by];
    if (!cur || f.ts >= cur.ts) out[f.by] = { path, ts: f.ts };
  }
  return out;
}

/** How long a line the cat said stays in its bubble, in event time. */
const SAY_FRESH_MS = 9000;

/** How long a finished task stays on the desk plate while its cat walks the verdict or the delivery over, in event time. */
const DESK_LINGER_MS = 9000;

const OPEN_TASK = new Set<TaskDTO["status"]>(["running", "waiting", "review", "blocked"]);

/**
 * The task on a cat's desk, from the same task state the strip reads: the
 * task it is on, else the open task it still holds (a maker waiting on its
 * review), else the task it just finished while the verdict or the delivery
 * walks over. No task means the plate reads No task yet and the monitor
 * keeps the paw.
 */
export function deskTask(a: AgentDTO, s: RunState): TaskDTO | undefined {
  if (a.status === "stopped" || s.departed[a.id]) return undefined;
  const cur = a.currentTaskId ? s.tasks[a.currentTaskId] : undefined;
  if (cur && cur.status !== "cancelled") return cur;
  const now = clockOf(s);
  let recent: TaskDTO | undefined;
  for (let i = s.taskOrder.length - 1; i >= 0; i--) {
    const t = s.tasks[s.taskOrder[i]!];
    if (!t || t.assigneeId !== a.id) continue;
    if (OPEN_TASK.has(t.status)) return t;
    if (!recent && t.status === "done" && now - t.updatedAt <= DESK_LINGER_MS) recent = t;
  }
  return recent;
}

/** The desk plate line for a task: "Review: X" reads Reviewing X, "Fix: X" reads Fixing X. */
export function plateTitle(title: string): string {
  const review = /^review:\s*/i.exec(title);
  if (review) return `Reviewing ${title.slice(review[0].length)}`;
  const fix = /^fix:\s*/i.exec(title);
  if (fix) return `Fixing ${title.slice(fix[0].length)}`;
  return title;
}

/**
 * The activity the desk shows, which picks the monitor glyph: a cat on a
 * review keeps the diff up between reads, the CEO on the plan keeps the
 * board, and a cat that holds a task never rests on the paw screen.
 */
export function deskActivity(a: AgentDTO, task: TaskDTO | undefined, s: RunState): AgentDTO["activity"] {
  if (!task || a.status === "stopped") return a.activity;
  const reviewing = /^review:/i.test(task.title) || isReviewTask(task, s);
  if (reviewing && (a.activity === "think" || a.activity === "rest" || a.activity === "read")) return "review";
  if (a.role === "lead" && /^plan\b/i.test(task.title) && (a.activity === "think" || a.activity === "rest")) return "plan";
  if (a.activity === "rest") return a.status === "waiting" ? "wait" : "think";
  return a.activity;
}

/**
 * The office props per cat. `roleTitle` rides along for the desk plate: the
 * scene contract (packages/cats) does not read it yet, so the plate shows
 * the base role until the scene picks the field up.
 */
export function officeAgents(s: RunState, spend: Record<string, AgentSpend>): Array<OfficeAgent & { roleTitle: string }> {
  const files = latestFiles(s);
  const now = clockOf(s);
  const budget = s.run?.budgetTokens ?? 0;
  return crewOrder(s).map((a) => {
    const said = s.says[a.id];
    const fresh = said && now - said.ts <= SAY_FRESH_MS && said.ts >= (s.activitySince[a.id] ?? 0) - 1;
    const fromCalls = energyOf(spend[a.id], budget);
    const fromAgent = budget > 0 ? Math.min(1, tokensUsed(a.usage) / budget) : 0;
    const task = deskTask(a, s);
    return {
      id: a.id,
      name: a.name,
      role: a.role,
      roleTitle: roleTitleOf(a),
      look: a.look,
      status: a.status,
      activity: deskActivity(a, task, s),
      mood: a.mood,
      energy: Math.max(fromCalls, fromAgent),
      parentId: a.parentId,
      taskTitle: task ? plateTitle(task.title) : null,
      statusText: fresh ? clip(said.text, 96) : a.statusText,
      file: files[a.id]?.path ?? null,
    };
  });
}

export function officeMeetings(s: RunState): OfficeMeeting[] {
  return s.meetingOrder
    .map((id) => s.meetings[id])
    .filter((m): m is NonNullable<typeof m> => !!m)
    // the seats come from the live crew: each cat once, only cats still in the office, the CEO at the head
    .map((m) => ({ id: m.id, kind: m.kind, title: m.title, agentIds: meetingSeats(m.agentIds, s), agenda: m.agenda, endedAt: m.endedAt, notes: m.notes }));
}

function meetingSeats(ids: readonly string[], s: RunState): string[] {
  const seen = new Set<string>();
  const out = ids.filter((id) => {
    const a = s.agents[id];
    if (!a || s.departed[id] || a.status === "stopped" || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return out.sort((x, y) => (s.agents[x]!.role === "lead" ? -1 : s.agents[y]!.role === "lead" ? 1 : 0));
}

type PlanStatus = "todo" | "doing" | "review" | "done";

function planStatus(t: TaskDTO): PlanStatus | null {
  switch (t.status) {
    case "running":
      return "doing";
    case "review":
      return "review";
    case "done":
    case "failed":
      return "done";
    case "cancelled":
      return null;
    default:
      return "todo";
  }
}

/** Review tasks live under the task they review; the whiteboard shows the work, not the checks. */
export function isReviewTask(t: TaskDTO, s: RunState): boolean {
  return t.role === "reviewer" && !!t.parentId && !!s.tasks[t.parentId];
}

export function officePlan(s: RunState): NonNullable<OfficeProps["plan"]> {
  const out: NonNullable<OfficeProps["plan"]> = [];
  for (const id of s.taskOrder) {
    const t = s.tasks[id];
    if (!t || isReviewTask(t, s)) continue;
    const status = planStatus(t);
    if (!status) continue;
    out.push({ id: t.id, title: t.title, status, ownerId: t.assigneeId ?? s.holders[t.id] ?? null });
  }
  return out;
}

function agentOfRole(s: RunState, role: AgentRole): string | null {
  return crewOrder(s).find((a) => a.role === role)?.id ?? null;
}

/**
 * The beats one event starts. `before` is the state just before the event,
 * `after` the state just after it; both are needed to see a transition
 * (a task that just became done) and to look up who raised a request.
 */
export function beatsForEvent(e: MengaiEvent, before: RunState, after: RunState): OfficeBeat[] {
  const id = (kind: string) => `beat-${e.seq}-${kind}`;
  switch (e.type) {
    case "handoff": {
      const h = (e as MengaiEvent<"handoff">).data.handoff;
      const toId = h.toAgentId ?? agentOfRole(after, h.toRole);
      if (!toId || toId === h.fromAgentId || !after.agents[h.fromAgentId] || !after.agents[toId]) return [];
      return [{ id: id("handoff"), kind: "handoff", fromId: h.fromAgentId, toId, taskTitle: after.tasks[h.taskId]?.title ?? "a task" }];
    }
    case "request.raised": {
      const d = (e as MengaiEvent<"request.raised">).data;
      const toId = d.toAgentId ?? leadOf(after)?.id ?? null;
      if (!toId || toId === d.fromAgentId || !after.agents[d.fromAgentId]) return [];
      return [{ id: id("ask"), kind: "ask", fromId: d.fromAgentId, toId, question: d.question }];
    }
    case "request.decided": {
      const d = (e as MengaiEvent<"request.decided">).data;
      const req = after.requests[d.requestId];
      const byId = d.byAgentId ?? leadOf(after)?.id ?? null;
      if (!req || !byId || !after.agents[req.fromAgentId]) return [];
      return [{ id: id("decided"), kind: "decided", byId, toId: req.fromAgentId, approved: d.approved, answer: d.answer }];
    }
    case "task.updated": {
      const t = (e as MengaiEvent<"task.updated">).data.task;
      const prev = before.tasks[t.id];
      if (t.status !== "done" || prev?.status === "done") return [];
      if (isReviewTask(t, after)) {
        const parent = after.tasks[t.parentId!]!;
        const reviewerId = t.assigneeId ?? e.agentId;
        const ownerId = parent.assigneeId ?? after.holders[parent.id] ?? null;
        if (!reviewerId || !ownerId || !after.agents[reviewerId] || !after.agents[ownerId]) return [];
        const passed = /^\s*pass/i.test(t.resultSummary ?? "");
        return [{ id: id("review"), kind: "review", reviewerId, ownerId, passed, taskTitle: parent.title }];
      }
      const fromId = t.assigneeId ?? prev?.assigneeId ?? null;
      if (!fromId || !after.agents[fromId]) return [];
      return [{ id: id("deliver"), kind: "deliver", fromId, taskTitle: t.title }];
    }
    case "run.status": {
      const d = (e as MengaiEvent<"run.status">).data;
      if (d.status !== "done" || before.run?.status === "done") return [];
      const agentIds = crewOrder(after).map((a) => a.id);
      return agentIds.length > 0 ? [{ id: id("celebrate"), kind: "celebrate", agentIds }] : [];
    }
    default:
      return [];
  }
}

/** Beats keep their order; a long jump keeps the one playing and the newest few. */
export const BEAT_QUEUE_CAP = 8;

export function trimBeats(queue: OfficeBeat[]): OfficeBeat[] {
  if (queue.length <= BEAT_QUEUE_CAP) return queue;
  return [queue[0]!, ...queue.slice(queue.length - (BEAT_QUEUE_CAP - 1))];
}

// ---------------------------------------------------------- cat voice

function names(ids: string[], s: RunState): string {
  const list = ids.map((id) => s.agents[id]?.name).filter((n): n is string => !!n);
  if (list.length <= 1) return list[0] ?? "The crew";
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

const MEETING_NOUN: Record<MeetingKind, string> = { kickoff: "kickoff", sync: "sync", review: "review meeting", wrapup: "wrap-up" };

/** What one cat is doing, as the rest of a sentence that starts with its name. */
export function doingPhrase(a: AgentDTO, s: RunState): string {
  const tool = s.tools[a.id];
  const target = (tool ? toolTarget(tool.argsPreview) : null) ?? "";
  const file = latestFiles(s)[a.id]?.path;
  const task = a.currentTaskId ? s.tasks[a.currentTaskId] : undefined;
  const pathish = (v: string) => /[./]/.test(v) && !/\s/.test(v);
  switch (a.activity) {
    case "code":
      return pathish(target) ? `writing ${baseName(target)}` : file ? `writing ${baseName(file)}` : "writing code";
    case "read":
      return pathish(target) ? `reading ${baseName(target)}` : "reading the code";
    case "run": {
      const cmd = tool ? (/"(?:cmd|command)"\s*:\s*"([^"]+)"/.exec(tool.argsPreview)?.[1] ?? (tool.argsPreview.startsWith("{") ? null : tool.argsPreview)) : null;
      return cmd ? `running ${clip(cmd, 32)}` : "running the checks";
    }
    case "review":
      return task ? `reviewing ${clip(task.title.replace(/^Review:\s*/i, ""), 40)}` : "reviewing";
    case "plan":
      return a.role === "lead" ? "planning the work" : "planning";
    case "design":
      return task ? `designing ${clip(task.title.replace(/^Design\s+/i, ""), 36)}` : "designing";
    case "scan":
      return "scanning the change";
    case "research":
      return "researching";
    case "handoff":
      return "handing work over";
    case "ask":
      return "asking a question";
    case "wait":
      return a.role === "lead" ? "watching the crew" : "waiting on a colleague";
    case "celebrate":
      return "celebrating";
    case "think": {
      if (!task) return "thinking";
      const review = /^review:\s*/i.exec(task.title);
      if (review) return `reviewing ${clip(task.title.slice(review[0].length), 36)}`;
      const fix = /^fix:\s*/i.exec(task.title);
      if (fix) return `fixing ${clip(task.title.slice(fix[0].length), 36)}`;
      return `on ${clip(task.title, 36)}`;
    }
    case "automate":
      return "working the Mac";
    default:
      return ACTIVITY_LABEL[a.activity].toLowerCase();
  }
}

/** One cat-voice sentence: what the company is doing right now. */
export function companyNow(s: RunState): string {
  const run = s.run;
  const lead = leadOf(s);
  const ceo = lead?.name ?? "The CEO";
  if (!run) return "The crew is getting ready.";
  switch (run.status) {
    case "queued":
      return `${ceo} is reading the goal before the crew starts.`;
    case "paused":
      return "Paused. The crew is napping at their desks until you resume.";
    case "stopping":
      return "Stopping. Every cat is putting its paws down.";
    case "stopped":
      return "Stopped. The desks are quiet.";
    case "failed":
      return run.statusReason ? `The run failed: ${clip(run.statusReason, 90)}` : "The run failed.";
    case "done":
      return `Done. ${ceo} signed off the report and the crew is celebrating.`;
    default:
      break;
  }
  const approval = runApprovals(s)[0];
  if (approval) {
    const who = approval.agentId ? s.agents[approval.agentId]?.name : null;
    return `${who ?? "A cat"} is waiting on you: ${clip(approval.title.charAt(0).toLowerCase() + approval.title.slice(1), 70)}.`;
  }
  const meeting = [...s.meetingOrder].reverse().map((id) => s.meetings[id]).find((m) => m && m.endedAt === null);
  if (meeting) {
    const who = `${names(meeting.agentIds, s)} ${meeting.agentIds.length === 1 ? "is" : "are"} at the table`;
    // "Kickoff: CSV export" names itself; a bare "Kickoff" reads better after the crew.
    return meeting.title.includes(":") ? `${clip(meeting.title, 48)}. ${who}.` : `${who} for the ${MEETING_NOUN[meeting.kind]}.`;
  }
  const open = [...s.requestOrder].reverse().map((id) => s.requests[id]).find((r) => r && !r.decision);
  if (open) {
    const from = s.agents[open.fromAgentId]?.name ?? "A cat";
    const to = open.toAgentId ? (s.agents[open.toAgentId]?.name ?? ceo) : ceo;
    return `${from} is asking ${to}: ${clip(open.question, 72)}`;
  }
  const crew = crewOrder(s);
  const busy = crew.filter((a) => a.status === "working" || a.status === "thinking" || a.status === "waiting");
  const doing = busy.filter((a) => a.status !== "waiting" && a.role !== "lead");
  const shown = (doing.length > 0 ? doing : busy).slice(0, 2);
  if (shown.length === 0) return `${ceo} is watching the crew.`;
  const parts = shown.map((a) => `${a.name} is ${doingPhrase(a, s)}`);
  const rest = busy.length - shown.length;
  const tail = rest > 0 ? `, and ${rest} more ${rest === 1 ? "is" : "are"} at work` : "";
  return `${parts.join(shown.length === 2 && rest === 0 ? " and " : ", ")}${tail}.`;
}

/** The accessible summary of the office for assistive tech. */
export function officeLabel(s: RunState): string {
  const crew = crewOrder(s);
  const c = taskCounts(s);
  const count = `${crew.length} ${crew.length === 1 ? "cat" : "cats"} in the office, ${c.done} of ${c.total} tasks done`;
  return `${companyNow(s)} ${count}.`;
}
