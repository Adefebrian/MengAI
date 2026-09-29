// The live picture of one run: a pure reducer over MengaiEvent plus a
// tiny external store for useSyncExternalStore. First paint comes from the
// GET /api/runs/:id snapshot; the SSE stream (EventSource on /api/events)
// then replays everything after snapshot.lastSeq and stays live. The
// browser resumes a dropped stream with Last-Event-ID on its own; when it
// gives up, the store reconnects with after=<lastSeq>, so an event is never
// applied twice (seq is monotonic and the reducer skips seq <= lastSeq).
import {
  SSE_EVENT_NAME,
  type Activity,
  type AgentDTO,
  type ApprovalDTO,
  type DecisionDTO,
  type HandoffDTO,
  type MengaiEvent,
  type RunDTO,
  type RunSnapshotDTO,
  type TaskDTO,
  type UsageTotals,
} from "@mengai/shared";
import { useSyncExternalStore } from "react";

export type Connection = "idle" | "connecting" | "live" | "reconnecting" | "closed" | "demo";

export interface ToolInFlight {
  callId: string;
  tool: string;
  activity: Activity;
  argsPreview: string;
  ts: number;
}

export interface RunState {
  runId: string | null;
  run: RunDTO | null;
  agents: Record<string, AgentDTO>;
  agentOrder: string[];
  tasks: Record<string, TaskDTO>;
  taskOrder: string[];
  handoffs: HandoffDTO[];
  decisions: DecisionDTO[];
  approvals: Record<string, ApprovalDTO>;
  approvalOrder: string[];
  usage: { totals: UsageTotals; budgetTokens: number; budgetUsd: number; progress: number } | null;
  /** latest caption per agent */
  says: Record<string, { text: string; to: string | null; ts: number }>;
  /** tool call in flight per agent */
  tools: Record<string, ToolInFlight | null>;
  /** when each agent's current activity started, for "time in behaviour" */
  activitySince: Record<string, number>;
  /** bumps when a task the agent owns completes: the cat plays its celebration once */
  celebrate: Record<string, number>;
  files: Record<string, { op: "create" | "update" | "delete"; bytes: number; ts: number; by: string | null }>;
  /**
   * Which cat holds each task card right now: the receiver of the latest
   * handoff, or the cat that last started working on it. The crew board
   * draws the card in that cat's row, so a handoff moves it in one commit.
   */
  holders: Record<string, string>;
  /**
   * Review round per task: 1 on its first review, plus one each time a
   * review sends it back to its maker (a fix task is created under it).
   */
  rounds: Record<string, number>;
  /** place of a task in the batch it was planned in (0 = first), for the deal-in stagger */
  deal: Record<string, number>;
  /** every applied event in seq order, the source for the timeline and the replay */
  log: MengaiEvent[];
  lastSeq: number;
  connection: Connection;
  error: string | null;
}

export const LOG_CAP = 20_000;

export function emptyRunState(runId: string | null = null): RunState {
  return {
    runId,
    run: null,
    agents: {},
    agentOrder: [],
    tasks: {},
    taskOrder: [],
    handoffs: [],
    decisions: [],
    approvals: {},
    approvalOrder: [],
    usage: null,
    says: {},
    tools: {},
    activitySince: {},
    celebrate: {},
    files: {},
    holders: {},
    rounds: {},
    deal: {},
    log: [],
    lastSeq: 0,
    connection: "idle",
    error: null,
  };
}

/** State from the REST snapshot; events after snapshot.lastSeq follow. */
export function stateFromSnapshot(s: RunSnapshotDTO, prev?: RunState): RunState {
  const base = emptyRunState(s.run.id);
  const agents: Record<string, AgentDTO> = {};
  const activitySince: Record<string, number> = {};
  for (const a of s.agents) {
    agents[a.id] = a;
    activitySince[a.id] = a.updatedAt;
  }
  const tasks: Record<string, TaskDTO> = {};
  for (const t of s.tasks) tasks[t.id] = t;
  const approvals: Record<string, ApprovalDTO> = {};
  for (const a of s.approvals) approvals[a.id] = a;
  const holders: Record<string, string> = {};
  for (const t of s.tasks) if (t.assigneeId) holders[t.id] = t.assigneeId;
  for (const h of s.handoffs) if (h.toAgentId) holders[h.taskId] = h.toAgentId;
  for (const a of s.agents) if (a.currentTaskId && (a.status === "working" || a.status === "thinking" || a.status === "approval")) holders[a.currentTaskId] = a.id;
  for (const t of s.tasks) {
    const settled = t.status === "running" || t.status === "done" || t.status === "failed" || t.status === "cancelled";
    if (t.assigneeId && settled) holders[t.id] = t.assigneeId;
    if (!holders[t.id] && t.createdBy) holders[t.id] = t.createdBy;
  }
  return {
    ...base,
    run: s.run,
    agents,
    agentOrder: s.agents.map((a) => a.id),
    tasks,
    taskOrder: s.tasks.map((t) => t.id),
    handoffs: [...s.handoffs],
    decisions: [...s.decisions],
    approvals,
    approvalOrder: s.approvals.map((a) => a.id),
    usage: { totals: s.run.usage, budgetTokens: s.run.budgetTokens, budgetUsd: s.run.budgetUsd, progress: s.run.progress },
    activitySince,
    holders,
    rounds: Object.fromEntries(s.tasks.filter((t) => t.review || t.attempts > 1).map((t) => [t.id, Math.max(1, t.attempts)])),
    lastSeq: s.lastSeq,
    connection: prev?.connection ?? "idle",
  };
}

function withAgent(state: RunState, id: string, patch: (a: AgentDTO) => AgentDTO): Record<string, AgentDTO> {
  const a = state.agents[id];
  if (!a) return state.agents;
  return { ...state.agents, [id]: patch(a) };
}

function upsertTask(state: RunState, task: TaskDTO, created: boolean, ts: number): Pick<RunState, "tasks" | "taskOrder" | "celebrate" | "holders" | "rounds" | "deal"> {
  const prev = state.tasks[task.id];
  const tasks = { ...state.tasks, [task.id]: task };
  const taskOrder = prev ? state.taskOrder : [...state.taskOrder, task.id];
  let celebrate = state.celebrate;
  const owner = task.assigneeId ?? prev?.assigneeId ?? null;
  if (task.status === "done" && prev?.status !== "done" && owner) {
    celebrate = { ...celebrate, [owner]: (celebrate[owner] ?? 0) + 1 };
  }

  // The lane a card sits in. A new card starts with its assignee, else with
  // the cat that planned it (the lead deals its plan into its own lane).
  // Starting work or finishing puts it with the cat that does the work.
  let holders = state.holders;
  const put = (taskId: string, agentId: string | null | undefined) => {
    if (!agentId || holders[taskId] === agentId) return;
    holders = { ...holders, [taskId]: agentId };
  };
  if (created) put(task.id, task.assigneeId ?? holders[task.id] ?? task.createdBy);
  if (task.status === "running" || task.status === "done" || task.status === "failed" || task.status === "cancelled") put(task.id, task.assigneeId);

  let rounds = state.rounds;
  if (task.status === "review" && prev?.status !== "review" && !rounds[task.id]) rounds = { ...rounds, [task.id]: 1 };

  // A review that asks for changes spawns a fix under the reviewed task: the
  // reviewed card bounces back to its maker for the next round.
  if (created && task.parentId && task.assigneeId) {
    const parent = state.tasks[task.parentId];
    if (parent && parent.status === "review" && holders[parent.id] !== task.assigneeId) {
      put(parent.id, task.assigneeId);
      rounds = { ...rounds, [parent.id]: (rounds[parent.id] ?? 1) + 1 };
    }
  }

  // Cards planned by one cat at one moment are one batch: dealt in order.
  let deal = state.deal;
  if (created) {
    let n = 0;
    for (let i = state.log.length - 2; i >= 0 && n < 12; i--) {
      const e = state.log[i]!;
      if (e.type !== "task.created" || e.ts !== ts) break;
      if ((e as MengaiEvent<"task.created">).data.task.createdBy !== task.createdBy) break;
      n += 1;
    }
    deal = { ...deal, [task.id]: n };
  }
  return { tasks, taskOrder, celebrate, holders, rounds, deal };
}

/**
 * Apply one event. Pure: the same state and event always give the same
 * result. Events at or below lastSeq and events of another run are skipped.
 */
export function reduceRun(state: RunState, e: MengaiEvent): RunState {
  if (e.seq <= state.lastSeq) return state;
  if (state.runId && e.runId && e.runId !== state.runId) return { ...state, lastSeq: e.seq };
  const log = state.log.length >= LOG_CAP ? [...state.log.slice(state.log.length - LOG_CAP + 1), e] : [...state.log, e];
  const next: RunState = { ...state, lastSeq: e.seq, log };
  const agentId = e.agentId;

  switch (e.type) {
    case "run.created": {
      const { run } = (e as MengaiEvent<"run.created">).data;
      return {
        ...next,
        runId: next.runId ?? run.id,
        run,
        usage: { totals: run.usage, budgetTokens: run.budgetTokens, budgetUsd: run.budgetUsd, progress: run.progress },
      };
    }
    case "run.status": {
      const d = (e as MengaiEvent<"run.status">).data;
      if (!next.run) return next;
      const ended = d.status === "done" || d.status === "failed" || d.status === "stopped";
      const started = d.status === "running" && next.run.startedAt === null;
      // The run is done: every cat on the board celebrates once, together.
      let celebrate = next.celebrate;
      if (d.status === "done" && next.run.status !== "done") {
        celebrate = { ...celebrate };
        for (const id of next.agentOrder) celebrate[id] = (celebrate[id] ?? 0) + 1;
      }
      return {
        ...next,
        celebrate,
        run: {
          ...next.run,
          status: d.status,
          statusReason: d.reason,
          startedAt: started ? e.ts : next.run.startedAt,
          endedAt: ended ? e.ts : next.run.endedAt,
        },
      };
    }
    case "run.usage": {
      const d = (e as MengaiEvent<"run.usage">).data;
      return {
        ...next,
        run: next.run ? { ...next.run, usage: d.usage, budgetTokens: d.budgetTokens, budgetUsd: d.budgetUsd, progress: d.progress } : next.run,
        usage: { totals: d.usage, budgetTokens: d.budgetTokens, budgetUsd: d.budgetUsd, progress: d.progress },
      };
    }
    case "agent.spawned": {
      const { agent } = (e as MengaiEvent<"agent.spawned">).data;
      const known = !!next.agents[agent.id];
      return {
        ...next,
        agents: { ...next.agents, [agent.id]: agent },
        agentOrder: known ? next.agentOrder : [...next.agentOrder, agent.id],
        activitySince: { ...next.activitySince, [agent.id]: e.ts },
      };
    }
    case "agent.status": {
      if (!agentId || !next.agents[agentId]) return next;
      const d = (e as MengaiEvent<"agent.status">).data;
      const prev = next.agents[agentId]!;
      const changed = prev.activity !== d.activity;
      const idleNow = d.status === "idle" || d.status === "done" || d.status === "stopped" || d.status === "error";
      return {
        ...next,
        agents: withAgent(next, agentId, (a) => ({
          ...a,
          status: d.status,
          activity: d.activity,
          mood: d.mood,
          statusText: d.statusText,
          currentTaskId: d.taskId,
          updatedAt: e.ts,
        })),
        activitySince: changed ? { ...next.activitySince, [agentId]: e.ts } : next.activitySince,
        tools: idleNow ? { ...next.tools, [agentId]: null } : next.tools,
        // A cat that picks up a card nobody holds takes it into its lane.
        holders: d.taskId && (d.status === "working" || d.status === "thinking") && !next.holders[d.taskId] ? { ...next.holders, [d.taskId]: agentId } : next.holders,
      };
    }
    case "agent.say": {
      if (!agentId) return next;
      const d = (e as MengaiEvent<"agent.say">).data;
      return { ...next, says: { ...next.says, [agentId]: { text: d.text, to: d.to, ts: e.ts } } };
    }
    case "tool.call": {
      if (!agentId) return next;
      const d = (e as MengaiEvent<"tool.call">).data;
      const prev = next.agents[agentId];
      const changed = prev ? prev.activity !== d.activity : false;
      return {
        ...next,
        tools: { ...next.tools, [agentId]: { callId: d.callId, tool: d.tool, activity: d.activity, argsPreview: d.argsPreview, ts: e.ts } },
        agents: withAgent(next, agentId, (a) => ({ ...a, activity: d.activity, steps: a.steps + 1, updatedAt: e.ts })),
        activitySince: changed ? { ...next.activitySince, [agentId]: e.ts } : next.activitySince,
      };
    }
    case "tool.result": {
      if (!agentId) return next;
      const d = (e as MengaiEvent<"tool.result">).data;
      const current = next.tools[agentId];
      if (!current || current.callId !== d.callId) return next;
      return { ...next, tools: { ...next.tools, [agentId]: null } };
    }
    case "task.created":
    case "task.updated": {
      const { task } = (e as MengaiEvent<"task.created">).data;
      return { ...next, ...upsertTask(next, task, e.type === "task.created", e.ts) };
    }
    case "handoff": {
      const { handoff } = (e as MengaiEvent<"handoff">).data;
      if (next.handoffs.some((h) => h.id === handoff.id)) return next;
      const holders = handoff.toAgentId ? { ...next.holders, [handoff.taskId]: handoff.toAgentId } : next.holders;
      return { ...next, handoffs: [...next.handoffs, handoff], holders };
    }
    case "decision": {
      const { decision } = (e as MengaiEvent<"decision">).data;
      if (next.decisions.some((d) => d.id === decision.id)) return next;
      return { ...next, decisions: [...next.decisions, decision] };
    }
    case "approval.requested": {
      const { approval } = (e as MengaiEvent<"approval.requested">).data;
      const known = !!next.approvals[approval.id];
      return {
        ...next,
        approvals: { ...next.approvals, [approval.id]: approval },
        approvalOrder: known ? next.approvalOrder : [...next.approvalOrder, approval.id],
      };
    }
    case "approval.resolved": {
      const d = (e as MengaiEvent<"approval.resolved">).data;
      const a = next.approvals[d.id];
      if (!a) return next;
      return { ...next, approvals: { ...next.approvals, [d.id]: { ...a, status: d.status, decidedAt: e.ts } } };
    }
    case "file.changed": {
      const d = (e as MengaiEvent<"file.changed">).data;
      return { ...next, files: { ...next.files, [d.path]: { op: d.op, bytes: d.bytes, ts: e.ts, by: e.agentId } } };
    }
    case "error": {
      const d = (e as MengaiEvent<"error">).data;
      return { ...next, error: d.message };
    }
    default:
      return next;
  }
}

/** Fold a list of events from an initial state. */
export function replay(events: readonly MengaiEvent[], from: RunState = emptyRunState()): RunState {
  let s = from;
  for (const e of events) s = reduceRun(s, e);
  return s;
}

/** Agents in board order: the lead first, then by spawn time. */
export function crewOrder(state: RunState): AgentDTO[] {
  const list = state.agentOrder.map((id) => state.agents[id]).filter((a): a is AgentDTO => !!a);
  return list.sort((a, b) => {
    if (a.role === "lead" && b.role !== "lead") return -1;
    if (b.role === "lead" && a.role !== "lead") return 1;
    return a.createdAt - b.createdAt;
  });
}

export function pendingApprovals(state: RunState): ApprovalDTO[] {
  return state.approvalOrder.map((id) => state.approvals[id]).filter((a): a is ApprovalDTO => !!a && a.status === "pending");
}

export function cacheHitRate(u: UsageTotals | null | undefined): number {
  if (!u || u.inputTokens <= 0) return 0;
  return Math.max(0, Math.min(1, u.cachedTokens / u.inputTokens));
}

export function tokensUsed(u: UsageTotals | null | undefined): number {
  return u ? u.inputTokens + u.outputTokens : 0;
}

// ---------------------------------------------------------------- the store

export interface EventSourceLike {
  addEventListener(type: string, listener: (e: MessageEvent) => void): void;
  close(): void;
  readonly readyState: number;
  onopen: ((this: EventSource, ev: Event) => unknown) | null;
  onerror: ((this: EventSource, ev: Event) => unknown) | null;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface RunStore {
  getState(): RunState;
  subscribe(listener: () => void): () => void;
  setState(next: RunState): void;
  load(snapshot: RunSnapshotDTO): void;
  apply(events: MengaiEvent | readonly MengaiEvent[]): void;
  reset(runId: string | null): void;
  /** open the SSE stream for the current run; returns a disconnect function */
  connect(opts: { url: (after: number) => string; factory?: EventSourceFactory; retryMs?: number }): () => void;
}

const CLOSED = 2;

export function createRunStore(initial: RunState = emptyRunState()): RunStore {
  let state = initial;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  const set = (next: RunState) => {
    if (next === state) return;
    state = next;
    emit();
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setState: set,
    load(snapshot) {
      set(stateFromSnapshot(snapshot, state));
    },
    apply(events) {
      const list = Array.isArray(events) ? (events as readonly MengaiEvent[]) : [events as MengaiEvent];
      let s = state;
      for (const e of list) s = reduceRun(s, e);
      set(s);
    },
    reset(runId) {
      set(emptyRunState(runId));
    },
    connect({ url, factory, retryMs = 2000 }) {
      const make: EventSourceFactory = factory ?? ((u) => new EventSource(u, { withCredentials: true }) as unknown as EventSourceLike);
      let source: EventSourceLike | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;
      let attempts = 0;

      const open = () => {
        if (stopped) return;
        set({ ...state, connection: attempts === 0 ? "connecting" : "reconnecting" });
        const es = make(url(state.lastSeq));
        source = es;
        es.onopen = () => {
          attempts = 0;
          set({ ...state, connection: "live", error: null });
        };
        es.addEventListener(SSE_EVENT_NAME, (msg: MessageEvent) => {
          try {
            const e = JSON.parse(String(msg.data)) as MengaiEvent;
            if (typeof e.seq !== "number" || typeof e.type !== "string") return;
            const nextState = reduceRun(state, e);
            if (nextState.connection !== "live") set({ ...nextState, connection: "live" });
            else set(nextState);
          } catch {
            // a malformed frame is dropped; the next one still applies
          }
        });
        es.onerror = () => {
          if (stopped) return;
          if (es.readyState === CLOSED) {
            // The browser gave up (a 4xx or a network drop it will not retry):
            // reopen with after=lastSeq, backing off up to 30 s.
            es.close();
            attempts += 1;
            set({ ...state, connection: "reconnecting" });
            timer = setTimeout(open, Math.min(30_000, retryMs * 2 ** Math.min(attempts - 1, 4)));
          } else {
            // Native retry in progress; it resumes with Last-Event-ID.
            set({ ...state, connection: "reconnecting" });
          }
        };
      };
      open();
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        source?.close();
        set({ ...state, connection: "closed" });
      };
    },
  };
}

export function useRunState(store: RunStore): RunState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
