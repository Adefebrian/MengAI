// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What the island knows, as a pure reducer: every live run (queued,
// running, paused, stopping) folded with the run store's own reduceRun, so
// the stage, the crew and the asks read exactly as on the run screen; the
// live orders; and the last run that shipped or failed while the island
// was watching. The hook (useIslandLive) feeds it the REST snapshots, the
// order list and every event of GET /api/events for all runs.
//
// The model it derives is what the island shows: the active run (the
// newest running one) with its stage from the run tracker (trackerModel,
// the same stage list and labels), the crew at work, and the queue of
// things that wait on the owner, oldest first: live orders the crew
// proposed (status proposed, mode live) and cats that wait on an answer
// (a pending approval card, a question raised to the owner, or a cat whose
// status says it waits on you when the island joined after the question).
import { ACTIVITY_LABEL, MOMENT_BUDGET_LOW_SHARE, type Activity, type AgentDTO, type AgentRole, type AgentStatus, type ApprovalDTO, type CatLook, type MengaiEvent, type Mood, type OrderDTO, type RunDTO, type RunSnapshotDTO, type RunStatus, type TaskStatus } from "@mengai/shared";
import { orderTitle, orderType, sentence, waitsOnYou } from "../app/parts/orderText";
import { clip, leadOf } from "../app/run/office";
import { trackerModel } from "../app/run/stages";
import { isFinished } from "../app/status";
import { crewOrder, emptyRunState, pendingApprovals, reduceRun, stateFromSnapshot, tokensUsed, type RunState } from "../store/runStore";

/** Runs the island follows. A finished run leaves; its finish is kept once. */
export const LIVE_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>(["queued", "running", "paused", "stopping"]);
/** A finish that happened longer ago than this (a replay after a reconnect) is not played. */
export const FRESH_MS = 60_000;
/** Runs the island loads a snapshot for, newest first. */
export const MAX_RUNS = 3;
/** Events kept per run: the reducer only looks back a few entries. */
export const LOG_KEEP = 32;

export interface MiniCat {
  id: string | null;
  name: string;
  look: CatLook;
  role: AgentRole;
  status: AgentStatus;
  activity: Activity;
  mood: Mood;
}

export interface Finish {
  kind: "shipped" | "failed";
  runId: string;
  goal: string;
  reason: string | null;
  /** island clock (ms) when it was seen */
  at: number;
  lead: MiniCat;
}

/**
 * What the island keeps of a run's engine hints past its trimmed log: the
 * newest `moment` seq and whether one said the budget runs low. Both only
 * ever grow (a running maximum), so a hint that leaves the kept log never
 * reads as news nor takes the warning tone back.
 */
export interface RunHints {
  lastMoment: number;
  saidLow: boolean;
}

export interface IslandLive {
  runs: Record<string, RunState>;
  /** per followed run, by run id, folded in before its log is trimmed */
  hints: Record<string, RunHints>;
  /** requestId to the task it was raised on, from request.raised */
  requestTask: Record<string, string | null>;
  orders: Record<string, OrderDTO>;
  finish: Finish | null;
  /** the highest event seq seen, for a reconnect with after= */
  lastSeq: number;
}

export interface CrewLine extends MiniCat {
  id: string;
  /** what it is doing, in a few words */
  doing: string;
  atWork: boolean;
}

export interface ActiveRun {
  runId: string;
  goal: string;
  status: RunStatus;
  stageLabel: string;
  /** 0-based */
  stageIndex: number;
  stageCount: number;
  /** 0..1, done tasks over all tasks */
  progress: number;
  lead: MiniCat;
  crew: CrewLine[];
  atWork: number;
  /** the task a cat is on right now, newest first */
  task: string | null;
  /** bumps when the run is done, so Oyen cheers once */
  celebrate: number;
  /** tasks on the board, cancelled ones left out (the ring's whole) */
  taskCount: number;
  doneCount: number;
  /** tasks a cat is on right now (the ring's in-flight share) */
  runningCount: number;
  /** tasks that ever started; it only grows, so a start is news */
  startedCount: number;
  /** 0..1 share of the budget spent (tokens or USD, whichever is further); null without a budget */
  budget: number | null;
  /** spent at least MOMENT_BUDGET_LOW_SHARE of the budget, or the engine said so (a budget_low moment) */
  budgetLow: boolean;
  /** seq of the newest engine `moment` hint of this run, 0 for none; it never goes down */
  lastMoment: number;
}

interface AskBase {
  id: string;
  runId: string | null;
  createdAt: number;
  /** where Open takes the owner in the main window */
  path: string;
  /** one line: what will happen */
  title: string;
}

export interface OrderAsk extends AskBase {
  kind: "order";
  order: OrderDTO;
  /** "Limit at $64,120.00, about $16,030.00" */
  detail: string;
  reason: string | null;
  who: string | null;
  /** the cat that proposed it, null when the island does not know it */
  cat: MiniCat | null;
}

export interface CatAsk extends AskBase {
  kind: "cat";
  who: MiniCat;
  /** the cat the answer goes to; null lets the engine pick the cat that waits */
  agentId: string | null;
  /** a yes or no question (Approve and Deny), or an open question (answered in the app) */
  yesNo: boolean;
  approval: ApprovalDTO | null;
}

export type Ask = OrderAsk | CatAsk;

export interface IslandModel {
  active: ActiveRun | null;
  asks: Ask[];
  finish: Finish | null;
  /** live runs followed right now */
  liveRuns: number;
}

export function emptyLive(): IslandLive {
  return { runs: {}, hints: {}, requestTask: {}, orders: {}, finish: null, lastSeq: 0 };
}

function trim(s: RunState): RunState {
  return s.log.length > LOG_KEEP * 2 ? { ...s, log: s.log.slice(-LOG_KEEP) } : s;
}

/** The hints of a run's log folded into what the island kept: a running maximum that ignores any decrease. */
export function foldHints(prev: RunHints | undefined, log: readonly MengaiEvent[]): RunHints {
  let lastMoment = prev?.lastMoment ?? 0;
  let saidLow = prev?.saidLow ?? false;
  for (const e of log) {
    if (e.type !== "moment") continue;
    lastMoment = Math.max(lastMoment, e.seq);
    if ((e as MengaiEvent<"moment">).data.kind === "budget_low") saidLow = true;
  }
  return prev && prev.lastMoment === lastMoment && prev.saidLow === saidLow ? prev : { lastMoment, saidLow };
}

/** A followed run's new state: its hints are folded in from the whole log first, then the log is trimmed. */
function store(live: IslandLive, runId: string, s: RunState): IslandLive {
  const before = live.hints[runId];
  const hints = foldHints(before, s.log);
  return { ...live, runs: { ...live.runs, [runId]: trim(s) }, hints: hints === before ? live.hints : { ...live.hints, [runId]: hints } };
}

/** Runs the island stops following leave with their hints. */
function without(live: IslandLive, ids: readonly string[]): IslandLive {
  const gone = ids.filter((id) => live.runs[id] || live.hints[id]);
  if (gone.length === 0) return live;
  const runs = { ...live.runs };
  const hints = { ...live.hints };
  for (const id of gone) {
    delete runs[id];
    delete hints[id];
  }
  return { ...live, runs, hints };
}

function isLive(run: Pick<RunDTO, "status"> | null | undefined): boolean {
  return !!run && LIVE_STATUSES.has(run.status);
}

/** A run's snapshot: first paint of that run; its events after snapshot.lastSeq follow on the stream. */
export function withSnapshot(live: IslandLive, snap: RunSnapshotDTO): IslandLive {
  if (!isLive(snap.run)) return without(live, [snap.run.id]);
  const prev = live.runs[snap.run.id];
  // the stream may already be ahead of this snapshot: keep the newer state
  if (prev && prev.lastSeq >= snap.lastSeq) return live;
  return store(live, snap.run.id, stateFromSnapshot(snap));
}

/**
 * The run list (GET /api/runs): runs that ended while the island was not
 * looking leave quietly; live runs it does not follow yet come back, newest
 * first, for their snapshots.
 */
export function withRunList(live: IslandLive, list: RunDTO[]): { live: IslandLive; missing: string[] } {
  const next = without(live, list.filter((r) => live.runs[r.id] && !isLive(r)).map((r) => r.id));
  const runs = next.runs;
  const followed = Object.keys(runs).length;
  const missing = list
    .filter((r) => isLive(r) && !runs[r.id])
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(0, MAX_RUNS - followed))
    .map((r) => r.id);
  return { live: next, missing };
}

/** The whole order list (GET /api/trading/orders) replaces what the island knew. */
export function withOrders(live: IslandLive, list: OrderDTO[]): IslandLive {
  const orders: Record<string, OrderDTO> = {};
  for (const o of list) if (o && typeof o.id === "string") orders[o.id] = o;
  return { ...live, orders };
}

/** One order as the engine answered a decision. */
export function withOrder(live: IslandLive, order: OrderDTO): IslandLive {
  return { ...live, orders: { ...live.orders, [order.id]: order } };
}

export function miniOf(a: AgentDTO | null | undefined, fallbackName = "Oyen"): MiniCat {
  if (!a) return { id: null, name: fallbackName, look: { coat: "ginger", seed: 7 }, role: "lead", status: "idle", activity: "rest", mood: "calm" };
  return { id: a.id, name: a.name, look: a.look, role: a.role, status: a.status, activity: a.activity, mood: a.mood };
}

function finishOf(s: RunState, now: number): Finish | null {
  const run = s.run;
  if (!run || (run.status !== "done" && run.status !== "failed")) return null;
  const lead = miniOf(leadOf(s));
  return {
    kind: run.status === "done" ? "shipped" : "failed",
    runId: run.id,
    goal: run.goal,
    reason: run.status === "failed" ? (run.statusReason ?? s.error ?? null) : null,
    at: now,
    lead: run.status === "done" ? { ...lead, status: "done", activity: "celebrate", mood: "proud" } : { ...lead, status: "error", activity: "rest", mood: "frustrated" },
  };
}

export interface Applied {
  live: IslandLive;
  /** a run the island does not follow went live: load its snapshot */
  fetch: string | null;
}

/** Apply one event of the all-runs stream. `now` is the island clock, for a fresh finish. */
export function applyEvent(live: IslandLive, e: MengaiEvent, now: number): Applied {
  let next: IslandLive = e.seq > live.lastSeq ? { ...live, lastSeq: e.seq } : live;
  if (e.type === "trade.order") {
    const { order } = (e as MengaiEvent<"trade.order">).data;
    if (order && typeof order.id === "string") next = { ...next, orders: { ...next.orders, [order.id]: order } };
  }
  if (e.type === "request.raised") {
    const d = (e as MengaiEvent<"request.raised">).data;
    next = { ...next, requestTask: { ...next.requestTask, [d.requestId]: e.taskId } };
  }
  const runId = e.runId;
  if (!runId) return { live: next, fetch: null };
  const cur = next.runs[runId];
  if (!cur) {
    if (e.type === "run.created") {
      const s = reduceRun(emptyRunState(runId), e);
      if (isLive(s.run)) return { live: store(next, runId, s), fetch: null };
    }
    if (e.type === "run.status") {
      const d = (e as MengaiEvent<"run.status">).data;
      if (LIVE_STATUSES.has(d.status)) return { live: next, fetch: runId };
    }
    return { live: next, fetch: null };
  }
  const before = cur.run?.status ?? null;
  const s = reduceRun(cur, e);
  if (s === cur) return { live: next, fetch: null };
  if (s.run && isFinished(s.run.status) && !isFinished(before)) {
    const fresh = now - e.ts <= FRESH_MS;
    const finish = fresh ? (finishOf(s, now) ?? next.finish) : next.finish;
    return { live: { ...without(next, [runId]), finish }, fetch: null };
  }
  return { live: store(next, runId, s), fetch: null };
}

/** The finish is done playing (the celebration ended, or the owner dismissed the alert). */
export function clearFinish(live: IslandLive): IslandLive {
  return live.finish ? { ...live, finish: null } : live;
}

// ------------------------------------------------------------------ model

const AT_WORK: ReadonlySet<AgentStatus> = new Set<AgentStatus>(["working", "thinking", "approval"]);

function doingOf(s: RunState, a: AgentDTO): string {
  const text = a.statusText?.trim();
  if (text) return clip(text, 64);
  const task = a.currentTaskId ? s.tasks[a.currentTaskId] : null;
  const word = ACTIVITY_LABEL[a.activity] ?? "Working";
  return task ? clip(`${word}: ${task.title}`, 64) : word;
}

function activeTask(s: RunState): string | null {
  let best: { title: string; at: number } | null = null;
  for (const id of s.taskOrder) {
    const t = s.tasks[id];
    if (!t || t.status !== "running") continue;
    if (!best || t.updatedAt >= best.at) best = { title: t.title, at: t.updatedAt };
  }
  return best ? clip(best.title, 72) : null;
}

const STARTED: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["running", "waiting", "review", "done", "failed"]);

/** Task counts for the ring and the news key: the board without cancelled cards. */
function taskCounts(s: RunState): Pick<ActiveRun, "taskCount" | "doneCount" | "runningCount" | "startedCount"> {
  let taskCount = 0;
  let doneCount = 0;
  let runningCount = 0;
  let startedCount = 0;
  for (const id of s.taskOrder) {
    const t = s.tasks[id];
    if (!t || t.status === "cancelled") continue;
    taskCount += 1;
    if (t.status === "done") doneCount += 1;
    if (t.status === "running") runningCount += 1;
    if (t.startedAt !== null || STARTED.has(t.status)) startedCount += 1;
  }
  return { taskCount, doneCount, runningCount, startedCount };
}

/** The share of the budget spent: the further of tokens and USD, each only when it has a budget. */
function budgetOf(s: RunState): number | null {
  const u = s.usage;
  if (!u) return null;
  const shares: number[] = [];
  if (u.budgetTokens > 0) shares.push(tokensUsed(u.totals) / u.budgetTokens);
  if (u.budgetUsd > 0) shares.push(u.totals.costUsd / u.budgetUsd);
  const finite = shares.filter((n) => Number.isFinite(n));
  return finite.length ? Math.max(0, Math.min(1, Math.max(...finite))) : null;
}

/** The run as the island shows it; `kept` are its hints from IslandLive.hints (without them, only the kept log's). */
export function activeOf(s: RunState, kept?: RunHints): ActiveRun | null {
  const run = s.run;
  if (!run) return null;
  const m = trackerModel(s);
  const stage = m.stages[m.index]!;
  const lead = leadOf(s);
  const crew = crewOrder(s).map((a): CrewLine => ({ ...miniOf(a), id: a.id, doing: doingOf(s, a), atWork: AT_WORK.has(a.status) }));
  const ordered = [...crew.filter((c) => c.atWork), ...crew.filter((c) => !c.atWork)];
  const budget = budgetOf(s);
  const hints = foldHints(kept, s.log);
  return {
    runId: run.id,
    goal: run.goal,
    status: run.status,
    stageLabel: stage.label,
    stageIndex: m.index,
    stageCount: m.stages.length,
    progress: Math.max(0, Math.min(1, Number.isFinite(run.progress) ? run.progress : 0)),
    lead: miniOf(lead),
    crew: ordered,
    atWork: crew.filter((c) => c.atWork).length,
    task: activeTask(s),
    celebrate: lead ? (s.celebrate[lead.id] ?? 0) : 0,
    ...taskCounts(s),
    budget,
    budgetLow: (budget !== null && budget >= MOMENT_BUDGET_LOW_SHARE) || hints.saidLow,
    lastMoment: hints.lastMoment,
  };
}

/** The live run the island shows: the newest running one, else the newest live one. */
export function pickActive(runs: RunState[]): RunState | null {
  const live = runs.filter((s) => isLive(s.run));
  if (live.length === 0) return null;
  const newest = (list: RunState[]) => list.reduce((a, b) => ((b.run!.createdAt > a.run!.createdAt) ? b : a));
  const running = live.filter((s) => s.run!.status === "running");
  return newest(running.length ? running : live);
}

const YES_NO = /(^|[:.?]\s+)may i\b/i;

function stripAsker(question: string, name: string): string {
  const prefix = `${name} asks: `;
  return question.startsWith(prefix) ? question.slice(prefix.length) : question;
}

function stripVoice(text: string): string {
  return text.replace(/^Meowing for you:\s*/i, "").trim();
}

function waitingAgent(s: RunState, fromId: string, taskId: string | null | undefined): AgentDTO | null {
  const waiting = crewOrder(s).filter((a) => a.status === "approval");
  const byTask = taskId ? waiting.find((a) => a.currentTaskId === taskId) : undefined;
  if (byTask) return byTask;
  const from = s.agents[fromId];
  if (from && from.status === "approval") return from;
  if (waiting.length === 1) return waiting[0]!;
  return from ?? null;
}

function catAsks(s: RunState, live: IslandLive): CatAsk[] {
  const run = s.run;
  if (!run) return [];
  const path = `/app/runs/${run.id}`;
  const out: CatAsk[] = [];
  const covered = new Set<string>();
  for (const a of pendingApprovals(s)) {
    const agent = a.agentId ? s.agents[a.agentId] : null;
    if (agent) covered.add(agent.id);
    out.push({
      kind: "cat",
      id: `approval:${a.id}`,
      runId: run.id,
      createdAt: a.createdAt,
      path,
      title: a.title,
      who: miniOf(agent, "A cat"),
      agentId: a.agentId,
      yesNo: true,
      approval: a,
    });
  }
  for (const id of s.requestOrder) {
    const r = s.requests[id];
    if (!r || !r.toOwner || r.decision) continue;
    const agent = waitingAgent(s, r.fromAgentId, live.requestTask[r.id]);
    if (agent) covered.add(agent.id);
    const who = miniOf(agent, "A cat");
    const question = stripAsker(r.question, who.name);
    out.push({
      kind: "cat",
      id: `request:${r.id}`,
      runId: run.id,
      createdAt: r.raisedAt,
      path,
      title: question,
      who,
      agentId: agent && agent.status === "approval" ? agent.id : null,
      yesNo: YES_NO.test(question),
      approval: null,
    });
  }
  // The island joined after the question: the cat's own status still says it waits on you.
  for (const a of crewOrder(s)) {
    if (a.status !== "approval" || covered.has(a.id)) continue;
    const question = stripVoice(a.statusText ?? "") || "waits on your answer";
    out.push({
      kind: "cat",
      id: `agent:${a.id}:${a.currentTaskId ?? "none"}`,
      runId: run.id,
      createdAt: a.updatedAt,
      path,
      title: question,
      who: miniOf(a),
      agentId: a.id,
      yesNo: YES_NO.test(question),
      approval: null,
    });
  }
  return out;
}

/** The cat that proposed an order: from its run, or from any run the island follows (ids are unique). */
function proposer(o: OrderDTO, live: IslandLive): AgentDTO | null {
  if (!o.agentId) return null;
  const own = o.runId ? live.runs[o.runId] : undefined;
  if (own) return own.agents[o.agentId] ?? null;
  for (const s of Object.values(live.runs)) {
    const a = s.agents[o.agentId];
    if (a) return a;
  }
  return null;
}

function orderAsk(o: OrderDTO, live: IslandLive): OrderAsk {
  const agent = proposer(o, live);
  const who = agent?.name ?? null;
  const price = o.type === "limit" && o.limitPrice !== null ? o.limitPrice : o.fillPrice;
  const total = price !== null && Number.isFinite(price) ? price * o.qty : null;
  const type = sentence(orderType(o));
  const detail = total !== null ? `${type}, about ${fmtMoney(total)}` : type;
  return {
    kind: "order",
    id: `order:${o.id}`,
    runId: o.runId,
    createdAt: o.createdAt,
    path: o.runId ? `/app/runs/${o.runId}` : "/app/trading",
    title: orderTitle(o),
    order: o,
    detail,
    reason: o.reason ? clip(sentence(o.reason), 140) : null,
    who,
    cat: agent ? miniOf(agent) : null,
  };
}

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function fmtMoney(n: number): string {
  return MONEY.format(n);
}

export function deriveModel(live: IslandLive): IslandModel {
  const runs = Object.values(live.runs);
  const active = pickActive(runs);
  const asks: Ask[] = [];
  for (const o of Object.values(live.orders)) if (waitsOnYou(o)) asks.push(orderAsk(o, live));
  for (const s of runs) if (isLive(s.run)) asks.push(...catAsks(s, live));
  asks.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return { active: active ? activeOf(active, live.hints[active.run!.id]) : null, asks, finish: live.finish, liveRuns: runs.filter((s) => isLive(s.run)).length };
}
