// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The island's moments deriver, pure: facts in, moments out. The engine
// sends facts (its `moment` hints and the events it always sends), never an
// animation name; every visual decision is made here, from the catalog in
// docs/superpowers/specs/2026-10-01-island-moments-design.md section 4.1.
//
// The relevance rule: the actor is always the cat the fact is about (its
// agent id resolved in the run's own state, the lead when it is unknown),
// and the prop is always what the fact is about (an approval's capability,
// an order's card, a question's page, else the cat's own role object).
//
// Three sources feed the director (director.ts):
//   deriveMoments  one event of the stream, with the island before and after
//                  it: hire, let go, handoff, engine hints, stage done,
//                  shipped, failed, and the cat's reaction when the owner
//                  answers an ask. A replayed event (the run state did not
//                  change) or a stale one (older than FRESH_MS) yields none.
//   askMoments     the asks of the model, whatever brought them (an event, a
//                  snapshot, the order list): director.syncAsks takes the list
//   quirkMoment    a seeded crew cat fooling around, when director.quirkDue
//                  hands out a seed; tapMoment when the owner clicks a cat
// Ids are stable per fact (`hire:<agent>`, `review_pass:<seq>`,
// `ask_approval:<ask id>`), so a replay never plays twice. An engine hint
// and an inferred moment (a handoff, a stage done) both carry the task they
// are about; the director alone applies the hint rule to them (an engine
// hint beats an inferred moment about the same task within HINT_WINDOW_MS,
// whichever arrives first), so the deriver never drops one on its own.
import { ROLE_PROP, poseFor, type Pose, type PropId } from "@mengai/cats/src/poses";
import { seededRandom, type Quirk } from "@mengai/cats/src/motion";
import { COMPANY_STAGES, MOMENT_TEXT_MAX, type Activity, type AgentRole, type ApprovalDTO, type Capability, type MengaiEvent, type OrderDTO } from "@mengai/shared";
import { waitsOnYou } from "../app/parts/orderText";
import { clip, leadOf } from "../app/run/office";
import { companyOf } from "../app/run/stages";
import { crewOrder, type RunState } from "../store/runStore";
import { PRIORITY, type Cue } from "./director";
import { FRESH_MS, deriveModel, miniOf, type Ask, type IslandLive, type IslandModel, type MiniCat } from "./live";
import { SHIP_MS } from "./machine";
import type { MomentType, StageCat, StageMove } from "./moment-types";

/** How long each moment plays; null stays until resolved (an ask, a failure). */
export const MOMENT_MS: Record<MomentType, number | null> = {
  ask_approval: null,
  ask_order: null,
  ask_question: null,
  hire: 2200,
  let_go: 1800,
  handoff: 2400,
  review_pass: 2200,
  review_fail: 2200,
  ceo_approved: 1800,
  ceo_denied: 1800,
  rethink: 1800,
  stuck: 1800,
  budget_low: 2200,
  stage_done: 2400,
  shipped: SHIP_MS,
  failed: null,
  quirk: 3000,
  tap: 900,
};

/** The cat's reaction to the owner's answer: a celebrate or ears down, then back up. */
export const ANSWER_MS = 1200;
/** An unanswered ask nudges with one small hop this often (the stage plays it). */
export const ASK_NUDGE_MS = 20_000;
/** The shipped row hops in on this stagger, lead first; a handoff's receiver follows by the same. */
export const SHIP_STAGGER_MS = 80;
/** Cats in the shipped row. */
export const SHIP_ROW = 3;
/** Three taps this close call a crew cat out to wave. */
export const TAP_COMBO = 3;
export const TAP_COMBO_MS = 1500;

/** The quirks a cat plays when it fools around on the stage. */
export const STAGE_QUIRKS: readonly Quirk[] = ["yawn", "stretch", "groom", "knead", "bat"];

/** The work a cat catches into when a handoff lands. */
const ROLE_WORK: Record<AgentRole, Activity> = {
  lead: "plan",
  engineer: "code",
  designer: "design",
  reviewer: "review",
  qa: "run",
  security: "scan",
  researcher: "research",
  operator: "automate",
};

const ROLE_WORD: Record<AgentRole, string> = {
  lead: "lead",
  engineer: "engineer",
  designer: "designer",
  reviewer: "reviewer",
  qa: "tester",
  security: "security cat",
  researcher: "researcher",
  operator: "operator",
};

/** A stage as a noun in "Gembul finished the build, review is next." */
const STAGE_NOUN: Record<string, string> = {
  goal: "the goal",
  planned: "the plan",
  hired: "hiring",
  working: "the build",
  review: "review",
  testing: "testing",
  shipped: "shipping",
  thesis: "the thesis",
  research: "research",
  backtest: "the backtest",
  risk_review: "risk review",
  paper_trade: "paper trading",
  live_trade: "live trading",
  report: "the report",
};

const QUIRK_WORDS: Record<Quirk, string> = {
  yawn: "yawns",
  stretch: "stretches",
  groom: "grooms a paw",
  knead: "kneads the air",
  bat: "bats at a loose thread",
  blink: "blinks slowly",
  twitch: "twitches an ear",
};

// ------------------------------------------------------------------ words

/** The en and em dash, written as char codes so the source stays plain. */
const DASHES = new RegExp(`\\s*[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]\\s*`, "g");

/** The first sentence of a text. */
function firstSentence(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  const m = /^.*?[.!?](?=\s|$)/.exec(t);
  return m ? m[0] : t;
}

/** One plain sentence: no long dashes, one line, at most MOMENT_TEXT_MAX, closed with a stop. */
export function plainSentence(text: string): string {
  let t = firstSentence(text.replace(DASHES, ", ")).replace(/^,\s*/, "");
  t = clip(t, MOMENT_TEXT_MAX);
  if (t && !/[.!?…]$/.test(t)) t = `${t}.`;
  return t;
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function stageNoun(key: string): string {
  return STAGE_NOUN[key] ?? key.replace(/_/g, " ");
}

// ------------------------------------------------------------------ cats

function leadCat(s: RunState | undefined): MiniCat {
  return miniOf(s ? leadOf(s) : null);
}

/** The cat a fact is about, from the run's own state; the lead when it is unknown. */
function catOf(s: RunState | undefined, agentId: string | null | undefined): MiniCat {
  const a = s && agentId ? s.agents[agentId] : undefined;
  return a ? miniOf(a) : leadCat(s);
}

function onStage(cat: MiniCat, pose: Pose, move: StageMove, prop: PropId | null = null, quirk: Quirk | null = null, delayMs = 0): StageCat {
  return { cat, pose, prop, quirk, move, delayMs };
}

function runPath(runId: string | null): string {
  return runId ? `/app/runs/${runId}` : "/app";
}

interface Spec {
  id: string;
  type: MomentType;
  runId: string | null;
  cats: StageCat[];
  text: string;
  taskId?: string | null;
  hint?: boolean;
  path?: string;
  askId?: string;
  ms?: number | null;
}

function cue(spec: Spec, now: number): Cue {
  const out: Cue = {
    id: spec.id,
    type: spec.type,
    runId: spec.runId,
    cats: spec.cats,
    ms: spec.ms !== undefined ? spec.ms : MOMENT_MS[spec.type],
    priority: PRIORITY[spec.type],
    text: plainSentence(spec.text),
    path: spec.path ?? runPath(spec.runId),
    at: now,
  };
  if (spec.askId !== undefined) out.askId = spec.askId;
  if (spec.taskId !== undefined) out.taskId = spec.taskId;
  if (spec.hint) out.hint = true;
  return out;
}

// ------------------------------------------------------------------ asks

/** What an approval is about, as the object the cat holds out. */
export function capabilityProp(approval: Pick<ApprovalDTO, "capability" | "detail">, role: AgentRole): PropId {
  const detail = approval.detail ?? {};
  if (typeof detail.connector === "string" || typeof detail.connectorId === "string") return "spyglass";
  const cap: Capability = approval.capability;
  if (cap === "shell") return "terminal";
  if (cap === "fs") return "page";
  if (cap === "network") return "spyglass";
  if (cap === "browser" || cap === "input" || cap === "screen" || cap === "apps") return "runbook";
  return ROLE_PROP[role] ?? "clipboard";
}

/** The cat behind an ask; a nameless one falls back to the lead of its run. */
function askCat(ask: Ask, model: IslandModel): MiniCat {
  const lead = model.active && model.active.runId === ask.runId ? model.active.lead : miniOf(null);
  if (ask.kind === "order") return ask.cat ?? lead;
  return ask.who.id ? ask.who : lead;
}

function askMoment(ask: Ask, model: IslandModel, now: number): Cue {
  const cat = askCat(ask, model);
  if (ask.kind === "order") {
    const who = ask.cat ? cat.name : "The crew";
    return cue({ id: `ask_order:${ask.id}`, type: "ask_order", runId: ask.runId, cats: [onStage(cat, "ask", "emerge", "card")], text: `${who} asks to ${lowerFirst(ask.title)}`, path: ask.path, askId: ask.id }, now);
  }
  const question = plainSentence(ask.title);
  if (ask.approval || ask.yesNo) {
    const prop = ask.approval ? capabilityProp(ask.approval, cat.role) : (ROLE_PROP[cat.role] ?? "clipboard");
    return cue({ id: `ask_approval:${ask.id}`, type: "ask_approval", runId: ask.runId, cats: [onStage(cat, "ask", "emerge", prop)], text: `${cat.name} asks: ${question}`, path: ask.path, askId: ask.id }, now);
  }
  return cue({ id: `ask_question:${ask.id}`, type: "ask_question", runId: ask.runId, cats: [onStage(cat, "think", "emerge", "page")], text: `${cat.name} asks: ${question}`, path: ask.path, askId: ask.id }, now);
}

/** One moment per ask that waits on the owner, oldest first, for director.syncAsks. */
export function askMoments(model: IslandModel, now: number): Cue[] {
  return model.asks.map((a) => askMoment(a, model, now));
}

/** The asking cat's reaction to the owner's answer: celebrate for yes, ears down for no, then back up. */
export function answerMoment(ask: Cue, approved: boolean, now: number): Cue {
  const first = ask.cats[0]!;
  const cat: MiniCat = { ...first.cat, mood: approved ? "proud" : "frustrated" };
  return cue(
    {
      id: `answer:${ask.askId ?? ask.id}`,
      type: ask.type,
      runId: ask.runId,
      cats: [onStage(cat, approved ? "celebrate" : "stopped", "visit")],
      text: approved ? `${cat.name} got your yes.` : `${cat.name} got your no.`,
      path: ask.path,
      askId: ask.askId ?? ask.id,
      ms: ANSWER_MS,
    },
    now,
  );
}

/** The reaction when an event answers an ask the island showed before it. */
function answered(before: IslandLive, askId: string, approved: boolean | null, now: number): Cue[] {
  if (approved === null) return [];
  const ask = askMoments(deriveModel(before), now).find((m) => m.askId === askId);
  return ask ? [answerMoment(ask, approved, now)] : [];
}

function orderApproved(o: OrderDTO): boolean | null {
  if (o.status === "approved" || o.status === "filled") return true;
  if (o.status === "rejected" || o.status === "cancelled") return false;
  return null;
}

// ------------------------------------------------------------------ events

function hintMoment(e: MengaiEvent<"moment">, s: RunState, runId: string, now: number): Cue[] {
  const d = e.data;
  const taskId = d.taskId ?? e.taskId;
  const cat = catOf(s, d.agentId ?? e.agentId);
  const said = typeof d.text === "string" ? d.text : "";
  const base = { id: `${d.kind}:${e.seq}`, type: d.kind, runId, taskId, hint: true } as const;
  const make = (stage: StageCat, fallback: string) => [cue({ ...base, cats: [stage], text: said.trim() ? said : fallback }, now)];
  switch (d.kind) {
    case "review_pass":
      return make(onStage({ ...cat, mood: "proud" }, "review", "hop"), `${cat.name} passed the work in review.`);
    case "review_fail":
      return make(onStage({ ...cat, mood: "frustrated" }, "review", "visit", "bugcard"), `${cat.name} sent the work back from review.`);
    case "ceo_approved":
      return make(onStage(cat, "review", "visit"), `${cat.name} approved a crew request.`);
    case "ceo_denied":
      return make(onStage(cat, "stopped", "visit"), `${cat.name} turned down a crew request.`);
    case "rethink":
      return make(onStage(cat, "think", "visit"), `${cat.name} is rethinking the approach.`);
    case "stuck":
      return make(onStage({ ...cat, mood: "frustrated" }, "think", "visit", null, "twitch"), `${cat.name} is stuck and tries another way.`);
    case "budget_low":
      return make(onStage(cat, "plan", "visit", "clipboard"), "The run has spent most of its budget.");
    default:
      return [];
  }
}

function hireMoment(e: MengaiEvent<"agent.spawned">, prev: RunState, runId: string, now: number): Cue[] {
  const { agent, hiredBy } = e.data;
  if (prev.agents[agent.id]) return [];
  // The CEO opens the run; it is not hired.
  if (agent.role === "lead" && (!hiredBy || crewOrder(prev).length === 0)) return [];
  const cat = miniOf(agent);
  const word = ROLE_WORD[agent.role] ?? agent.role;
  return [cue({ id: `hire:${agent.id}`, type: "hire", runId, cats: [onStage(cat, "ask", "visit")], text: `${cat.name} joined the crew as ${article(word)} ${word}.`, taskId: e.taskId }, now)];
}

function letGoMoment(e: MengaiEvent<"agent.left">, prev: RunState, runId: string, now: number): Cue[] {
  const a = prev.agents[e.data.agentId];
  if (!a || prev.departed[a.id]) return [];
  const cat: MiniCat = { ...miniOf(a), status: "stopped" };
  return [cue({ id: `let_go:${a.id}`, type: "let_go", runId, cats: [onStage(cat, "stopped", "leave")], text: `${cat.name} left the crew.` }, now)];
}

function handoffMoment(e: MengaiEvent<"handoff">, s: RunState, runId: string, now: number): Cue[] {
  const h = e.data.handoff;
  const from = catOf(s, h.fromAgentId);
  const toAgent = h.toAgentId ? s.agents[h.toAgentId] : undefined;
  const cats = [onStage(from, "handoff", "visit", "card")];
  let text = `${from.name} handed off to the ${ROLE_WORD[h.toRole] ?? h.toRole}.`;
  if (toAgent) {
    const to = miniOf(toAgent);
    cats.push(onStage(to, ROLE_WORK[to.role] ?? "wait", "visit", null, null, SHIP_STAGGER_MS));
    text = `${from.name} handed off to ${to.name}.`;
  }
  return [cue({ id: `handoff:${h.id}`, type: "handoff", runId, cats, text, taskId: h.taskId }, now)];
}

/** The task finished last: its cat closed the stage. */
function lastDone(s: RunState): { taskId: string; agentId: string | null } | null {
  let best: { taskId: string; agentId: string | null; at: number } | null = null;
  for (const id of s.taskOrder) {
    const t = s.tasks[id];
    if (!t || t.status !== "done") continue;
    const at = t.endedAt ?? t.updatedAt;
    if (!best || at >= best.at) best = { taskId: t.id, agentId: t.assigneeId, at };
  }
  return best;
}

function stageDoneMoment(e: MengaiEvent<"run.stage">, prev: RunState, runId: string, now: number): Cue[] {
  const keys = COMPANY_STAGES[companyOf(prev.run)];
  const next = String(e.data.stage);
  const from = e.data.previous !== null ? String(e.data.previous) : prev.stage;
  if (!from) return [];
  const i = keys.indexOf(from);
  const j = keys.indexOf(next);
  // Only a step forward finishes a stage; the last stage is the ship, which has its own moment.
  if (i < 0 || j <= i || j >= keys.length - 1) return [];
  const last = lastDone(prev);
  const cat = catOf(prev, last?.agentId);
  return [
    cue({ id: `stage_done:${runId}:${e.seq}`, type: "stage_done", runId, cats: [onStage(cat, "celebrate", "visit")], text: `${cat.name} finished ${stageNoun(from)}, ${stageNoun(next)} is next.`, taskId: last?.taskId ?? null }, now),
  ];
}

/** The crew row at the ship: the two cats that finished most, either side of the lead. */
function shipRow(s: RunState, lead: MiniCat): MiniCat[] {
  const done = new Map<string, number>();
  for (const id of s.taskOrder) {
    const t = s.tasks[id];
    if (t && t.status === "done" && t.assigneeId) done.set(t.assigneeId, (done.get(t.assigneeId) ?? 0) + 1);
  }
  const crew = crewOrder(s).filter((a) => a.role !== "lead" && a.id !== lead.id);
  const ranked = crew.map((a, i) => ({ a, i, n: done.get(a.id) ?? 0 })).sort((x, y) => y.n - x.n || x.i - y.i);
  return ranked.slice(0, SHIP_ROW - 1).map(({ a }) => ({ ...miniOf(a), status: "done", activity: "celebrate", mood: "proud" }));
}

function finishMoments(before: IslandLive, after: IslandLive, runId: string, now: number): Cue[] {
  const f = after.finish!;
  const s = before.runs[runId];
  if (f.kind === "failed") {
    const reason = f.reason ? firstSentence(f.reason).replace(/[.!?]$/, "") : "";
    return [cue({ id: `failed:${runId}`, type: "failed", runId, cats: [onStage(f.lead, "stopped", "emerge")], text: reason ? `The run failed: ${lowerFirst(reason)}` : "The run failed." }, now)];
  }
  const crew = s ? shipRow(s, f.lead) : [];
  // Row order on the stage, lead in the middle; the lead hops in first, then outwards.
  const lead = onStage(f.lead, "celebrate", "hop");
  const side = (cat: MiniCat, n: number) => onStage(cat, "celebrate", "hop", null, null, SHIP_STAGGER_MS * n);
  const row: StageCat[] = crew.length >= 2 ? [side(crew[0]!, 1), lead, side(crew[1]!, 2)] : crew.length === 1 ? [lead, side(crew[0]!, 1)] : [lead];
  return [cue({ id: `shipped:${runId}`, type: "shipped", runId, cats: row, text: `${f.lead.name} and the crew shipped the run.` }, now)];
}

/**
 * The moments one event of the stream brings, from the island before and
 * after it. Asks come from askMoments; this gives the reaction when an
 * event answers one.
 */
export function deriveMoments(before: IslandLive, event: MengaiEvent, after: IslandLive, now: number): Cue[] {
  if (now - event.ts > FRESH_MS) return [];
  const runId = event.runId;
  if (runId && after.finish && after.finish !== before.finish && after.finish.runId === runId) return finishMoments(before, after, runId, now);
  if (event.type === "trade.order") {
    const { order } = (event as MengaiEvent<"trade.order">).data;
    const was = order && typeof order.id === "string" ? before.orders[order.id] : undefined;
    if (!was || !waitsOnYou(was) || order.status === was.status) return [];
    return answered(before, `order:${order.id}`, orderApproved(order), now);
  }
  if (!runId) return [];
  const prev = before.runs[runId];
  const next = after.runs[runId];
  // a run the island does not follow, or an event it already applied (a replay)
  if (!prev || !next || prev === next) return [];
  switch (event.type) {
    case "agent.spawned":
      return hireMoment(event as MengaiEvent<"agent.spawned">, prev, runId, now);
    case "agent.left":
      return letGoMoment(event as MengaiEvent<"agent.left">, prev, runId, now);
    case "handoff":
      return handoffMoment(event as MengaiEvent<"handoff">, next, runId, now);
    case "moment":
      return hintMoment(event as MengaiEvent<"moment">, next, runId, now);
    case "run.stage":
      return stageDoneMoment(event as MengaiEvent<"run.stage">, prev, runId, now);
    case "approval.resolved": {
      const d = (event as MengaiEvent<"approval.resolved">).data;
      if (prev.approvals[d.id]?.status !== "pending") return [];
      return answered(before, `approval:${d.id}`, d.status === "approved" ? true : d.status === "denied" ? false : null, now);
    }
    case "request.decided": {
      const d = (event as MengaiEvent<"request.decided">).data;
      const r = prev.requests[d.requestId];
      if (!d.byOwner || !r || r.decision) return [];
      return answered(before, `request:${d.requestId}`, d.approved, now);
    }
    default:
      return [];
  }
}

// ------------------------------------------------------------------ quirk and tap

function stripCrew(c: MiniCat): MiniCat {
  return { id: c.id, name: c.name, look: c.look, role: c.role, status: c.status, activity: c.activity, mood: c.mood };
}

/**
 * A crew cat at work fools around: the same seed always picks the same cat
 * and quirk. Null when no run is live. The cat sits in a rest pose, the one
 * the rig plays quirks in.
 */
export function quirkMoment(model: IslandModel, seed: number, now: number): Cue | null {
  const a = model.active;
  if (!a || a.crew.length === 0) return null;
  const atWork = a.crew.filter((c) => c.atWork);
  const pool = atWork.length ? atWork : a.crew;
  const rand = seededRandom(seed);
  const cat = stripCrew(pool[Math.floor(rand() * pool.length)]!);
  const quirk = STAGE_QUIRKS[Math.floor(rand() * STAGE_QUIRKS.length)]!;
  return cue({ id: `quirk:${seed}`, type: "quirk", runId: a.runId, cats: [onStage(cat, "rest", "visit", null, quirk)], text: `${cat.name} ${QUIRK_WORDS[quirk]} between tasks.` }, now);
}

/** True when the newest taps (island clock) make the three-tap combo. */
export function tapCombo(taps: readonly number[], now: number): boolean {
  return taps.filter((t) => t <= now && now - t <= TAP_COMBO_MS).length >= TAP_COMBO;
}

/**
 * The owner clicked a cat: it plays the rig's tap reaction in its own pose.
 * The three-tap combo calls a crew cat out instead (the first at work that
 * is not the tapped one, else the lead), and it waves.
 */
export function tapMoment(model: IslandModel, cat: MiniCat, now: number, combo = false): Cue {
  const a = model.active;
  const runId = a?.runId ?? null;
  if (combo) {
    const other = a?.crew.find((c) => c.atWork && c.id !== cat.id) ?? a?.crew.find((c) => c.id !== cat.id);
    const caller = other ? stripCrew(other) : (a?.lead ?? miniOf(null));
    return cue({ id: `tap:${caller.id ?? caller.name}:${now}`, type: "tap", runId, cats: [onStage(caller, "ask", "visit")], text: `${caller.name} pops out to wave.` }, now);
  }
  return cue({ id: `tap:${cat.id ?? cat.name}:${now}`, type: "tap", runId, cats: [onStage(cat, poseFor(cat.status, cat.activity), "visit")], text: `${cat.name} looks up at you.` }, now);
}
