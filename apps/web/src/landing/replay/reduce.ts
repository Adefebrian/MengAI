// The replay's view state: a pure fold of the run's events up to a moment.
// It reads the same wire events the app's store reads (MengaiEvent), so
// the stage shows exactly what the run said, nothing invented.
import {
  isEvent,
  type Activity,
  type AgentRole,
  type AgentStatus,
  type CatLook,
  type MengaiEvent,
  type Mood,
  type RunStatus,
  type TaskStatus,
} from "@mengai/shared";

export interface ReplayAgent {
  id: string;
  name: string;
  role: AgentRole;
  look: CatLook;
  status: AgentStatus;
  activity: Activity;
  mood: Mood;
  statusText: string | null;
  taskId: string | null;
  /** The tool target of the call in flight (a path, a command, or the tool name). */
  tool: string | null;
  /** A task handed to this cat that it has not picked up yet. */
  incomingTaskId: string | null;
  /** The last review verdict this cat gave. */
  verdict: "passed" | "changes" | null;
}

export interface ReplayTask {
  id: string;
  title: string;
  role: AgentRole;
  status: TaskStatus;
  assigneeId: string | null;
}

export interface TimelineEntry {
  seq: number;
  ts: number;
  agentId: string | null;
  action: string;
  /** Data shown after the action; mono when it is a path or a command. */
  target: string | null;
  mono: boolean;
}

export interface ReplayHandoff {
  seq: number;
  ts: number;
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
}

export interface ReplayState {
  goal: string;
  runStatus: RunStatus;
  startedAt: number;
  endedAt: number | null;
  agents: Record<string, ReplayAgent>;
  tasks: Record<string, ReplayTask>;
  timeline: TimelineEntry[];
  handoffs: ReplayHandoff[];
  tokens: number;
  budgetTokens: number;
}

const TARGET_TOOLS = new Set(["fs_list", "fs_read", "fs_search", "fs_write", "fs_edit", "fs_delete", "shell_run", "web_fetch", "web_search"]);

const VERB: Record<string, string> = {
  fs_list: "lists",
  fs_read: "reads",
  fs_search: "searches",
  fs_write: "writes",
  fs_edit: "edits",
  fs_delete: "deletes",
  shell_run: "runs",
  web_fetch: "fetches",
  web_search: "searches the web for",
  create_tasks: "plans",
  crew_status: "checks on the crew",
  list_tasks: "reviews the task list",
  update_task: "updates a task",
};

/** What the crew row shows as the tool target of a call. */
export function toolTarget(tool: string, argsPreview: string): string | null {
  if (tool === "finish") return null;
  return TARGET_TOOLS.has(tool) ? argsPreview : tool;
}

function emptyState(): ReplayState {
  return {
    goal: "",
    runStatus: "queued",
    startedAt: 0,
    endedAt: null,
    agents: {},
    tasks: {},
    timeline: [],
    handoffs: [],
    tokens: 0,
    budgetTokens: 0,
  };
}

function log(s: ReplayState, e: MengaiEvent, action: string, target: string | null = null, mono = false) {
  s.timeline.push({ seq: e.seq, ts: e.ts, agentId: e.agentId, action, target, mono });
}

function apply(s: ReplayState, e: MengaiEvent): void {
  const agent = e.agentId ? s.agents[e.agentId] : undefined;
  if (isEvent(e, "run.created")) {
    s.goal = e.data.run.goal;
    s.runStatus = e.data.run.status;
    s.startedAt = e.data.run.startedAt ?? e.ts;
    s.budgetTokens = e.data.run.budgetTokens;
  } else if (isEvent(e, "run.status")) {
    s.runStatus = e.data.status;
    if (e.data.status === "done" || e.data.status === "stopped" || e.data.status === "failed") {
      s.endedAt = e.ts;
      log(s, e, e.data.status === "done" ? "Run done" : "Run ended");
    }
  } else if (isEvent(e, "run.usage")) {
    s.tokens = e.data.usage.inputTokens + e.data.usage.outputTokens;
    s.budgetTokens = e.data.budgetTokens;
  } else if (isEvent(e, "agent.spawned")) {
    const a = e.data.agent;
    s.agents[a.id] = {
      id: a.id,
      name: a.name,
      role: a.role,
      look: a.look,
      status: a.status,
      activity: a.activity,
      mood: a.mood,
      statusText: a.statusText,
      taskId: a.currentTaskId,
      tool: null,
      incomingTaskId: null,
      verdict: null,
    };
  } else if (isEvent(e, "agent.status") && agent) {
    agent.status = e.data.status;
    agent.activity = e.data.activity;
    agent.mood = e.data.mood;
    agent.statusText = e.data.statusText;
    agent.taskId = e.data.taskId;
    agent.tool = null;
    if (agent.incomingTaskId && agent.incomingTaskId === e.data.taskId) agent.incomingTaskId = null;
  } else if (isEvent(e, "tool.call") && agent) {
    const { tool, activity, argsPreview } = e.data;
    agent.activity = activity;
    if (agent.status !== "working") agent.status = "working";
    agent.tool = toolTarget(tool, argsPreview);
    if (tool === "finish") log(s, e, argsPreview);
    else if (tool === "create_tasks") log(s, e, "plans", argsPreview);
    else if (TARGET_TOOLS.has(tool)) log(s, e, VERB[tool] ?? tool, argsPreview, true);
    else if (VERB[tool]) log(s, e, VERB[tool]);
  } else if (isEvent(e, "tool.result") && agent) {
    if (e.data.tool === "submit_review") {
      agent.verdict = /^pass/i.test(e.data.summary) ? "passed" : "changes";
      log(s, e, agent.verdict === "passed" ? "Review passed" : "Changes requested");
    } else if (e.data.tool === "shell_run") {
      log(s, e, e.data.summary);
    }
  } else if (isEvent(e, "task.created") || isEvent(e, "task.updated")) {
    const t = e.data.task;
    s.tasks[t.id] = { id: t.id, title: t.title, role: t.role, status: t.status, assigneeId: t.assigneeId };
    if (isEvent(e, "task.created") && t.parentId === null && t.createdBy !== null) {
      const by = s.agents[t.createdBy];
      s.timeline.push({ seq: e.seq, ts: e.ts, agentId: by ? by.id : null, action: "new task", target: t.title, mono: false });
    }
  } else if (isEvent(e, "handoff")) {
    const h = e.data.handoff;
    if (h.toAgentId) {
      s.handoffs.push({ seq: e.seq, ts: e.ts, taskId: h.taskId, fromAgentId: h.fromAgentId, toAgentId: h.toAgentId });
      const to = s.agents[h.toAgentId];
      if (to) to.incomingTaskId = h.taskId;
      const title = s.tasks[h.taskId]?.title ?? null;
      s.timeline.push({ seq: e.seq, ts: e.ts, agentId: h.fromAgentId, action: `hands off to ${to?.name ?? h.toRole}`, target: title, mono: false });
    }
  }
}

/** Index of the first event after ts (events are in ts order). */
export function eventCountAt(events: MengaiEvent[], ts: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.ts <= ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The view state after the first `count` events. */
export function foldEvents(events: MengaiEvent[], count: number = events.length): ReplayState {
  const s = emptyState();
  const n = Math.min(count, events.length);
  for (let i = 0; i < n; i++) apply(s, events[i]!);
  return s;
}

/** The final token total the run recorded. */
export function finalTokens(events: MengaiEvent[]): { tokens: number; budgetTokens: number } {
  const s = foldEvents(events);
  return { tokens: s.tokens, budgetTokens: s.budgetTokens };
}
