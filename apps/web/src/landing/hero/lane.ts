// The hero relay (JEV imm.concept c1 "Relay lane with a bounce", core_tie
// 2.16): one task card passed paw to paw along four cats, Kopi to Klepon
// to Tempe, sent back once to Klepon, forward to Tempe again, passed, and
// on to Mochi; then Done and Kopi celebrates. A pure function of replay
// time, so the frame clock drives it and a still is one fixed moment.
// Scripted for this page and labelled so; the crew, their coats and the
// run length are the sample run's (replay/fixture.ts).
//
// Every behaviour is held at least ACTIVITY_MIN_DWELL_MS, and a cat that
// is about to receive the card waits first, so the cats package plays its
// catch beat (a card flying into the paws) as the card lands.
import { ACTIVITY_MIN_DWELL_MS, type Activity, type AgentRole, type AgentStatus, type CatLook, type Mood } from "@mengai/shared";
import { SAMPLE_CREW_TOKENS, SAMPLE_RUN } from "../replay/fixture";
import { foldEvents } from "../replay/reduce";

export type RelayStatus = "planned" | "building" | "review" | "changes" | "again" | "passed" | "handedoff" | "done";

export const RELAY_STATUS_LABEL: Record<RelayStatus, string> = {
  planned: "Planned",
  building: "Building",
  review: "In review",
  changes: "Changes requested",
  again: "Review, round 2",
  passed: "Passed",
  handedoff: "Handed off",
  done: "Done",
};

export interface RelayCat {
  id: string;
  name: string;
  role: AgentRole;
  look: CatLook;
}

/** What one cat is doing at one moment, in the words the crew board uses. */
export interface CatBeat {
  status: AgentStatus;
  activity: Activity;
  mood: Mood;
  /** The short note under the status on its CatCard. */
  note: string | null;
  /** The task on its CatCard, null for none yet. */
  task: string | null;
}

export interface RelayMoment {
  /** Card position in stations, 0 to 3; fractional while it travels. */
  pos: number;
  /** 0 to 1 while the card travels between two stations, else 1. */
  travel: number;
  from: number;
  to: number;
  status: RelayStatus;
  /** The station holding the card (the sender while it travels). */
  holder: number;
  cats: CatBeat[];
  /** 0 to 1 share of the run budget each cat has used. */
  energy: number[];
  /** Run tokens so far and the run clock (ms of recorded run time). */
  tokens: number;
  runMs: number;
  done: boolean;
  /** Changes once, at Done: Kopi's one-shot celebration. */
  celebrateKey: number;
}

export const RELAY_FPS = 30;
export const RELAY_GOAL = SAMPLE_RUN.goal;
/** The one card in the lane. */
export const RELAY_CARD = "Invoices CSV export";
export const TRAVEL_MS = 600; // --dur-600
/** The card reaches Done here; the replay then holds for two seconds. */
export const DONE_AT = 18_800;
export const RELAY_MS = 21_000;
export const RELAY_FRAMES = Math.round((RELAY_MS / 1000) * RELAY_FPS);
/** The poster (reduced motion, Save-Data): the card back at Klepon after the bounce. */
export const RELAY_POSTER_MS = 11_800;

/** Lane order: Kopi, Klepon, Tempe, Mochi. */
const LANE_ORDER = [0, 1, 3, 2];

/** The four cats, in lane order, with the sample run's names and coats. */
export function relayCrew(): RelayCat[] {
  const state = foldEvents(SAMPLE_RUN.events);
  return LANE_ORDER.map((i) => {
    const a = state.agents[SAMPLE_RUN.crew[i]!];
    if (!a) throw new Error(`relay: no agent at crew ${i}`);
    return { id: a.id, name: a.name, role: a.role, look: a.look };
  });
}

interface Leg {
  from: number;
  to: number;
  /** Travel starts here (ms). */
  at: number;
}

// Kopi hands the card to Klepon, Klepon sends it to Tempe, Tempe sends it
// back, Klepon sends it again, Tempe passes it on to Mochi.
export const LEGS: Leg[] = [
  { from: 0, to: 1, at: 2_400 },
  { from: 1, to: 2, at: 6_600 },
  { from: 2, to: 1, at: 10_400 },
  { from: 1, to: 2, at: 12_800 },
  { from: 2, to: 3, at: 16_000 },
];

const STATUS_AT: Array<[number, RelayStatus]> = [
  [0, "planned"],
  [2_400, "building"],
  [6_600, "review"],
  [9_200, "changes"],
  [12_800, "again"],
  [14_600, "passed"],
  [16_000, "handedoff"],
  [DONE_AT, "done"],
];

/** One stretch of one cat's behaviour, from `at` until the next one. */
interface Span extends CatBeat {
  at: number;
}

const TASK_KLEPON = "Build the CSV export endpoint";
const TASK_TEMPE = "Review the CSV export";
const TASK_MOCHI = "Add the Export button";
const TASK_MOCHI_WIRE = "Wire the Export button";

const span = (at: number, status: AgentStatus, activity: Activity, mood: Mood, note: string | null, task: string | null): Span => ({
  at,
  status,
  activity,
  mood,
  note,
  task,
});

// Per cat, in lane order. Each cat's spans are in time order.
export const SCRIPT: Span[][] = [
  // Kopi, the lead: reads the goal, plans, watches, checks on the crew, celebrates.
  [
    span(0, "thinking", "think", "focused", "Reading your goal", RELAY_GOAL),
    span(1_200, "working", "plan", "focused", "Planning 3 tasks", RELAY_GOAL),
    span(2_400, "waiting", "wait", "calm", "Watching the crew", RELAY_GOAL),
    span(6_000, "working", "review", "focused", "Checking on the crew", RELAY_GOAL),
    span(8_400, "waiting", "wait", "calm", "Watching the crew", RELAY_GOAL),
    span(DONE_AT, "done", "celebrate", "proud", "Report ready", RELAY_GOAL),
    span(DONE_AT + 1_200, "done", "rest", "proud", "Report ready", RELAY_GOAL),
  ],
  // Klepon, the engineer: catches the card, codes, tests, sends it on, fixes it.
  [
    span(0, "idle", "rest", "calm", null, null),
    span(1_200, "waiting", "wait", "calm", "Card on its way", null),
    span(3_000, "working", "code", "focused", "Writing the encoder", TASK_KLEPON),
    span(5_200, "working", "run", "focused", "Running the tests", TASK_KLEPON),
    span(6_600, "working", "handoff", "focused", "Sending it to review", TASK_KLEPON),
    span(7_800, "waiting", "wait", "calm", "Waiting on Tempe", TASK_KLEPON),
    span(11_000, "working", "code", "focused", "Quoting the commas", TASK_KLEPON),
    span(12_800, "working", "handoff", "focused", "Back to review", TASK_KLEPON),
    span(14_000, "waiting", "wait", "calm", "Waiting on Tempe", TASK_KLEPON),
    span(15_800, "done", "rest", "proud", "Done", TASK_KLEPON),
  ],
  // Tempe, the reviewer: reviews, sends it back once, reviews again, passes it.
  [
    span(0, "idle", "rest", "calm", null, null),
    span(6_000, "waiting", "wait", "calm", "Card on its way", null),
    span(7_200, "working", "review", "focused", "Reading the change", TASK_TEMPE),
    span(9_200, "working", "review", "frustrated", "Commas break the rows", TASK_TEMPE),
    span(10_400, "waiting", "wait", "calm", "Waiting on the fix", TASK_TEMPE),
    span(13_400, "working", "review", "focused", "Round 2 of 3", TASK_TEMPE),
    span(14_600, "working", "review", "proud", "Passed", TASK_TEMPE),
    span(16_000, "done", "rest", "proud", "Done", TASK_TEMPE),
  ],
  // Mochi, the designer: draws the button meanwhile, then wires it up.
  [
    span(0, "idle", "rest", "calm", null, null),
    span(3_600, "working", "design", "focused", "Drawing the button", TASK_MOCHI),
    span(7_200, "waiting", "wait", "calm", "Waiting on the endpoint", TASK_MOCHI),
    span(16_600, "working", "code", "focused", "Wiring the button", TASK_MOCHI_WIRE),
    span(DONE_AT, "done", "rest", "proud", "Done", TASK_MOCHI_WIRE),
  ],
];

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

function spanAt(spans: Span[], ms: number): Span {
  let current = spans[0]!;
  for (const s of spans) {
    if (s.at > ms) break;
    current = s;
  }
  return current;
}

/** Each cat's final share of the 400,000 token budget, in lane order. */
const RELAY_CREW = relayCrew();
const FINAL = foldEvents(SAMPLE_RUN.events);
const FINAL_ENERGY = RELAY_CREW.map((c) => (SAMPLE_CREW_TOKENS[c.id] ?? 0) / FINAL.budgetTokens);
/** The recorded run length up to Done (the relay's clock runs against it). */
const RUN_DONE_MS = (FINAL.endedAt ?? SAMPLE_RUN.endedAt) - FINAL.startedAt;

/** Where the relay is at replay time ms. */
export function relayAt(ms: number): RelayMoment {
  let pos = 0;
  let travel = 1;
  let from = 0;
  let to = 0;
  for (const leg of LEGS) {
    if (ms < leg.at) break;
    const t = clamp01((ms - leg.at) / TRAVEL_MS);
    from = leg.from;
    to = leg.to;
    travel = t;
    pos = leg.from + (leg.to - leg.from) * t;
  }
  let status: RelayStatus = "planned";
  for (const [at, s] of STATUS_AT) if (ms >= at) status = s;
  const holder = travel < 1 ? from : to;
  const progress = clamp01(ms / DONE_AT);
  const done = ms >= DONE_AT;
  return {
    pos,
    travel,
    from,
    to,
    status,
    holder,
    cats: SCRIPT.map((spans) => {
      const { at: _at, ...beat } = spanAt(spans, ms);
      return beat;
    }),
    energy: FINAL_ENERGY.map((e) => e * progress),
    tokens: Math.round(FINAL.tokens * progress),
    runMs: RUN_DONE_MS * progress,
    done,
    celebrateKey: done ? 1 : 0,
  };
}

/** Stage marks for the four segment buttons: where each starts, and its still. */
export const RELAY_STAGES = [
  { id: "plan", label: "Plan", startMs: 0, stillMs: 1_800 },
  { id: "build", label: "Build", startMs: 2_400, stillMs: 4_400 },
  { id: "review", label: "Review", startMs: 6_600, stillMs: RELAY_POSTER_MS },
  { id: "handoff", label: "Hand off", startMs: 16_000, stillMs: 17_600 },
] as const;

export type RelayStageId = (typeof RELAY_STAGES)[number]["id"];

export function relayStageAt(ms: number): RelayStageId {
  let id: RelayStageId = "plan";
  for (const s of RELAY_STAGES) if (ms >= s.startMs) id = s.id;
  return id;
}

/** The shortest time any cat holds one behaviour in the script. */
export function shortestSpanMs(): number {
  let min = Infinity;
  for (const spans of SCRIPT) {
    for (let i = 0; i < spans.length - 1; i++) min = Math.min(min, spans[i + 1]!.at - spans[i]!.at);
  }
  return min;
}

export const MIN_DWELL_MS = ACTIVITY_MIN_DWELL_MS;

/** The accessible summary of the whole relay, in order. */
export const RELAY_SUMMARY =
  "Kopi, the lead, plans the task. Klepon, the engineer, builds it and sends it to Tempe, the reviewer. Tempe sends it back with a note, Klepon fixes it, and Tempe passes it in round 2. Mochi, the designer, wires up the button. Done.";
