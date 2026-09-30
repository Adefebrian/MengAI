// The /office preview's scripted story: a pure function of the time into
// the loop, so every run of the page plays the same company day, in two
// companies. Studio: Oyen (the CEO cat) hands the settings form to Belang,
// Tompel asks Oyen for a dev dependency and gets a yes, Tempe sends the
// form back, Belo is hired and walks in with a box, Cimol takes a coffee,
// the crew holds a sync, Moci's contract ends and he walks out with his
// box, Tempe passes the fix, Belang pins it to the board, Gembul hands
// over the empty state art and naps, Garong asks about a leaked test key
// and hears "the owner decides", everyone meets for the wrap-up, then the
// crew celebrates. Fund: the same day on a trading floor, with a backtest,
// a risk committee, an execution and the bell. Sample content only.
import type { Activity, AgentStatus, MeetingKind, Mood } from "@mengai/shared";
import type { OfficeAgent, OfficeBeat, OfficeMeeting, OfficeProps } from "../src/office-contract";
import { rosterCrew, type RosterCat } from "../src/roster";

export const LOOP_S = 118;
export type Theme = "studio" | "fund";

type Member = RosterCat;

/** The crew in desk order, read from the shared roster so every scene gives a cat the same coat; Oyen is the CEO cat. */
export const OFFICE_CREW: Member[] = rosterCrew(["Oyen", "Belang", "Tempe", "Tompel", "Gembul", "Cimol", "Garong", "Moci", "Cemong", "Unyil", "Ciko", "Mpus"]);

/** The hire who walks in with a box partway through the day. */
export const HIRE: Member = rosterCrew(["Belo"])[0]!;
export const HIRE_AT = 26;
/** Moci's contract ends: he packs a box and walks out. */
export const LEAVER = "moci";
export const LEAVE_AT = 47;

/** The story clock: the loop is one working day, 09:00 to 19:00, so the windows show day until 18:00 and dusk at the close. */
export function hourAt(t: number): number {
  return 9 + (Math.max(0, Math.min(LOOP_S, t)) / LOOP_S) * 10;
}

export const CREW_SIZES = [4, 8, 12] as const;
export type CrewSize = (typeof CREW_SIZES)[number];

type Seg = [t: number, status: AgentStatus, activity: Activity, text: string | null, task: string | null, file: string | null, mood?: Mood];

interface Day {
  script: Record<string, Seg[]>;
  events: StoryEvent[];
  cards: Array<{ id: string; title: string; ownerId: string; steps: Array<[number, Card["status"]]> }>;
}

/** A beat without its id, per kind (Omit does not distribute over the union by itself). */
export type BeatSpec = OfficeBeat extends infer B ? (B extends OfficeBeat ? Omit<B, "id"> : never) : never;

export interface StoryEvent {
  t: number;
  key: string;
  beat?: BeatSpec;
  meetingStart?: { id: string; kind: MeetingKind; title: string; agentIds: string[]; agenda: string[] };
  meetingEnd?: { id: string; notes: string[] };
  coffee?: string;
  nap?: string;
}

type Card = NonNullable<OfficeProps["plan"]>[number];

const ALL = [...OFFICE_CREW.map((m) => m.id), HIRE.id];

/* ---------------------------------------------------------------------
 * The studio: a software company ships a settings page
 * ------------------------------------------------------------------- */

const FORM = "Build the settings form";
const ART = "Empty state art";

const STUDIO: Day = {
  script: {
    oyen: [
      [0, "working", "plan", "Splitting the goal into tasks", "Ship the settings page", "plan.md", "focused"],
      [2, "working", "handoff", "Handing the form to Belang", "Ship the settings page", "plan.md"],
      [9, "working", "review", "Checking on the crew", "Ship the settings page", "plan.md"],
      [11, "thinking", "think", "Tompel wants a dev dependency", "Ship the settings page", "plan.md"],
      [16, "working", "plan", "Updating the plan", "Ship the settings page", "plan.md", "focused"],
      [26, "working", "review", "Welcoming Belo", "Ship the settings page", "team.md"],
      [34, "working", "plan", "Running the sync", "Ship the settings page", "plan.md"],
      [54, "working", "plan", "Planning the fix", "Ship the settings page", "plan.md"],
      [76, "thinking", "think", "A key rotation is the owner's call", "Ship the settings page", "plan.md"],
      [84, "working", "review", "Getting ready to wrap up", "Ship the settings page", "report.md"],
      [103, "done", "celebrate", "Goal done", "Ship the settings page", "report.md", "proud"],
    ],
    belang: [
      [0, "waiting", "wait", "Waiting on Oyen", null, null],
      [8, "working", "code", "Editing settings.tsx", FORM, "apps/web/src/settings.tsx", "focused"],
      [15, "working", "run", "Running bun test", FORM, "settings.test.ts", "focused"],
      [24, "waiting", "wait", "Waiting for review", FORM, "settings.tsx"],
      [54, "working", "code", "Adding the missing test", FORM, "settings.test.ts", "focused"],
      [60, "working", "run", "Running bun test again", FORM, "settings.test.ts", "focused"],
      [63, "working", "handoff", "Pinning it to the board", FORM, "settings.tsx", "proud"],
      [71, "working", "code", "Wiring the empty state", ART, "empty-state.tsx"],
      [103, "done", "celebrate", "Shipped it", ART, "empty-state.tsx", "proud"],
    ],
    tempe: [
      [0, "idle", "rest", null, null, null],
      [13, "working", "review", "Reading the settings diff", "Review the settings form", "settings.tsx"],
      [26, "working", "read", "Writing review notes", "Review the settings form", "review.md"],
      [54, "working", "review", "Checking the fix", "Review the settings form", "settings.test.ts", "focused"],
      [62, "idle", "rest", "Review done", null, null, "proud"],
      [103, "done", "celebrate", null, null, null, "proud"],
    ],
    tompel: [
      [0, "working", "code", "Writing router tests", "Test the router", "router.test.ts"],
      [4, "waiting", "ask", "Asking Oyen about a dev dependency", "Test the router", "package.json"],
      [15, "working", "run", "Running the suite", "Test the router", "router.test.ts", "focused"],
      [22, "working", "review", "Hunting a flaky test", "Test the router", "router.test.ts", "focused"],
      [54, "working", "run", "Running the suite again", "Test the router", "router.test.ts"],
      [66, "idle", "rest", "Suite is green", null, null, "proud"],
      [103, "done", "celebrate", null, null, null, "proud"],
    ],
    gembul: [
      [0, "working", "design", "Drawing the empty state", ART, "empty-state.svg", "focused"],
      [36, "working", "code", "Laying out the form", ART, "settings.css"],
      [68, "working", "handoff", "Handing the art to Belang", ART, "empty-state.svg"],
      [74, "idle", "rest", "Time for a nap", null, null, "tired"],
      [103, "done", "celebrate", null, null, null, "proud"],
    ],
    cimol: [
      [0, "working", "research", "Reading form patterns", "Research form patterns", "notes.md"],
      [18, "idle", "rest", "Coffee first", "Research form patterns", "notes.md"],
      [30, "working", "code", "Writing notes", "Research form patterns", "notes.md"],
      [42, "working", "read", "Reading the spec", "Research form patterns", "spec.md"],
      [78, "idle", "rest", "Notes are in", null, null],
      [103, "done", "celebrate", null, null, null],
    ],
    garong: [
      [0, "working", "scan", "Scanning dependencies", "Audit dependencies", "package.json", "focused"],
      [20, "working", "review", "Found a test key in a fixture", "Audit dependencies", "fixtures/keys.ts"],
      [74, "waiting", "ask", "Asking Oyen to rotate the key", "Audit dependencies", "fixtures/keys.ts"],
      [83, "working", "scan", "Rescanning", "Audit dependencies", "package.json"],
      [94, "idle", "rest", "Audit done", null, null],
      [103, "done", "celebrate", null, null, null],
    ],
    moci: [
      [0, "idle", "rest", "Coffee before the rotation", null, null],
      [12, "working", "automate", "Rotating the staging certs", "Staging certs", "certs.md"],
      [30, "idle", "rest", "Handing over the runbook", null, null],
      [42, "done", "rest", "Contract done, packing up", null, null, "proud"],
    ],
    belo: [
      [0, "idle", "rest", "First day", null, null],
      [34, "working", "read", "Reading the codebase", "Settings API", "apps/api/src/settings.ts"],
      [58, "working", "code", "Editing api/settings.ts", "Settings API", "apps/api/src/settings.ts", "focused"],
      [80, "working", "run", "Running bun test", "Settings API", "settings.test.ts"],
      [92, "idle", "rest", "All green", null, null, "proud"],
      [103, "done", "celebrate", null, null, null, "proud"],
    ],
    cemong: [
      [0, "working", "code", "Editing the release script", "Release script", "scripts/release.ts", "focused"],
      [40, "working", "automate", "Running the release runbook", "Prepare the release", "release.md"],
      [80, "idle", "rest", "Release is staged", null, null],
      [103, "done", "celebrate", null, null, null],
    ],
    unyil: [
      [0, "working", "run", "Running smoke tests", "Smoke tests", "smoke.test.ts"],
      [36, "idle", "rest", "Smoke tests pass", null, null],
      [103, "done", "celebrate", null, null, null],
    ],
    ciko: [
      [0, "working", "design", "Drawing the settings icons", "Settings icons", "icons.svg"],
      [66, "idle", "rest", null, null, null],
      [103, "done", "celebrate", null, null, null],
    ],
    mpus: [
      [0, "idle", "rest", null, null, null],
      [12, "working", "research", "Comparing date pickers", "Compare date pickers", "notes.md"],
      [72, "idle", "rest", "Wrote it up", null, null],
      [103, "done", "celebrate", null, null, null],
    ],
  },
  events: [
    {
      t: 0,
      key: "m1s",
      meetingStart: {
        id: "standup",
        kind: "sync",
        title: "Standup: the settings page",
        agentIds: ["tempe", "gembul", "garong"],
        agenda: ["What each of us ships today", "Who reviews the form", "Blockers"],
      },
    },
    { t: 12.5, key: "m1e", meetingEnd: { id: "standup", notes: ["Belang builds the form", "Tempe reviews it", "Garong audits the dependencies"] } },
    { t: 0.3, key: "h1", beat: { kind: "handoff", fromId: "oyen", toId: "belang", taskTitle: FORM } },
    { t: 4, key: "a1", beat: { kind: "ask", fromId: "tompel", toId: "oyen", question: "Can I add a dev dependency?" } },
    { t: 12, key: "d1", beat: { kind: "decided", byId: "oyen", toId: "tompel", approved: true, answer: "Yes, as a dev dependency" } },
    { t: 16, key: "r1", beat: { kind: "review", reviewerId: "tempe", ownerId: "belang", passed: false, taskTitle: FORM } },
    { t: 19, key: "c1", coffee: "cimol" },
    {
      t: 32,
      key: "m2s",
      meetingStart: {
        id: "sync",
        kind: "sync",
        title: "Why the review failed",
        agentIds: ["oyen", "belang", "tempe", "tompel", "cemong"],
        agenda: ["What the review found", "The fix and who owns it", "When to review again"],
      },
    },
    { t: 52, key: "m2e", meetingEnd: { id: "sync", notes: ["Belang adds the missing test", "Tempe reviews again today", "Belo pairs on the API"] } },
    { t: 57, key: "r2", beat: { kind: "review", reviewerId: "tempe", ownerId: "belang", passed: true, taskTitle: FORM } },
    { t: 64, key: "v1", beat: { kind: "deliver", fromId: "belang", taskTitle: FORM } },
    { t: 69, key: "h2", beat: { kind: "handoff", fromId: "gembul", toId: "belang", taskTitle: ART } },
    { t: 75, key: "n1", nap: "gembul" },
    { t: 74, key: "a2", beat: { kind: "ask", fromId: "garong", toId: "oyen", question: "Rotate the leaked test key?" } },
    { t: 80, key: "d2", beat: { kind: "decided", byId: "oyen", toId: "garong", approved: false, answer: "The owner decides, I asked them" } },
    { t: 82, key: "c2", coffee: "mpus" },
    {
      t: 88,
      key: "m3s",
      meetingStart: {
        id: "wrapup",
        kind: "wrapup",
        title: "Wrap-up: the settings page",
        agentIds: ALL,
        agenda: ["What shipped", "What is left", "What we learned"],
      },
    },
    { t: 100, key: "m3e", meetingEnd: { id: "wrapup", notes: ["The settings page shipped", "The key rotation waits on the owner", "Belo owns the API next"] } },
    { t: 104, key: "cel", beat: { kind: "celebrate", agentIds: ALL } },
  ],
  cards: [
    { id: "c1", title: FORM, ownerId: "belang", steps: [[0, "todo"], [5, "doing"], [22, "review"], [52, "doing"], [60, "review"], [65, "done"]] },
    { id: "c2", title: "Test the router", ownerId: "tompel", steps: [[0, "doing"], [66, "review"], [78, "done"]] },
    { id: "c3", title: ART, ownerId: "gembul", steps: [[0, "doing"], [70, "review"], [90, "done"]] },
    { id: "c4", title: "Research form patterns", ownerId: "cimol", steps: [[0, "doing"], [78, "done"]] },
    { id: "c5", title: "Audit dependencies", ownerId: "garong", steps: [[0, "doing"], [94, "done"]] },
    { id: "c6", title: "Review the settings form", ownerId: "tempe", steps: [[0, "todo"], [13, "doing"], [62, "done"]] },
    { id: "c7", title: "Settings API", ownerId: "belo", steps: [[0, "todo"], [34, "doing"], [92, "review"], [98, "done"]] },
  ],
};

/* ---------------------------------------------------------------------
 * The fund: a trading floor rebalances its book
 * ------------------------------------------------------------------- */

const SIGNAL = "Backtest the momentum signal";
const HEDGE = "Hedge the rate risk";

const FUND: Day = {
  script: {
    oyen: [
      [0, "working", "plan", "Setting today's targets", "Rebalance the book", "book.md", "focused"],
      [2, "working", "handoff", "Handing the backtest to Belang", "Rebalance the book", "book.md"],
      [9, "working", "review", "Watching the tape", "Rebalance the book", "book.md"],
      [11, "thinking", "think", "Tompel wants a higher limit", "Rebalance the book", "limits.md"],
      [16, "working", "plan", "Resizing positions", "Rebalance the book", "book.md", "focused"],
      [26, "working", "review", "Welcoming Belo to the desk", "Rebalance the book", "team.md"],
      [34, "working", "plan", "Chairing the risk committee", "Rebalance the book", "risk.md"],
      [54, "working", "plan", "Sizing the hedge", "Rebalance the book", "book.md"],
      [76, "thinking", "think", "Pausing a trade is the owner's call", "Rebalance the book", "limits.md"],
      [84, "working", "review", "Marking the book", "Rebalance the book", "pnl.md"],
      [103, "done", "celebrate", "Targets hit", "Rebalance the book", "pnl.md", "proud"],
    ],
    belang: [
      [0, "waiting", "wait", "Waiting on Oyen", null, null],
      [8, "working", "code", "Editing momentum.py", SIGNAL, "signals/momentum.py", "focused"],
      [15, "working", "run", "Backtesting ten years", SIGNAL, "backtest.py", "focused"],
      [24, "waiting", "wait", "Waiting for review", SIGNAL, "momentum.py"],
      [54, "working", "code", "Fixing the lookahead", SIGNAL, "momentum.py", "focused"],
      [60, "working", "run", "Backtesting again", SIGNAL, "backtest.py", "focused"],
      [63, "working", "handoff", "Posting the result", SIGNAL, "momentum.py", "proud"],
      [71, "working", "code", "Wiring the hedge", HEDGE, "hedge.py"],
      [103, "done", "celebrate", "Signal is live", HEDGE, "hedge.py", "proud"],
    ],
    tempe: [
      [0, "idle", "rest", null, null, null],
      [13, "working", "review", "Reading the backtest", "Review the signal", "backtest.py"],
      [26, "working", "read", "Found a lookahead bias", "Review the signal", "review.md"],
      [54, "working", "review", "Checking the fix", "Review the signal", "momentum.py", "focused"],
      [62, "idle", "rest", "Review done", null, null, "proud"],
      [103, "done", "celebrate", null, null, null, "proud"],
    ],
    tompel: [
      [0, "working", "scan", "Validating the model", "Model validation", "validate.py"],
      [4, "waiting", "ask", "Asking Oyen for a higher limit", "Model validation", "limits.md"],
      [15, "working", "run", "Stress testing", "Model validation", "stress.py", "focused"],
      [24, "working", "review", "Checking fills", "Model validation", "fills.csv", "focused"],
      [66, "idle", "rest", "Model holds up", null, null, "proud"],
      [103, "done", "celebrate", null, null, null, "proud"],
    ],
    gembul: [
      [0, "working", "design", "Drawing the risk dashboard", "Risk dashboard", "dashboard.svg", "focused"],
      [36, "working", "code", "Laying out the charts", "Risk dashboard", "dashboard.css"],
      [68, "working", "handoff", "Handing the dashboard to Belang", "Risk dashboard", "dashboard.svg"],
      [74, "idle", "rest", "Time for a nap", null, null, "tired"],
      [103, "done", "celebrate", null, null, null, "proud"],
    ],
    cimol: [
      [0, "working", "research", "Reading the rate curves", "Rate curve notes", "rates.md"],
      [18, "idle", "rest", "Coffee first", "Rate curve notes", "rates.md"],
      [30, "working", "read", "Reading the central bank minutes", "Rate curve notes", "minutes.pdf"],
      [78, "idle", "rest", "Notes are in", null, null],
      [103, "done", "celebrate", null, null, null],
    ],
    garong: [
      [0, "working", "scan", "Checking trade limits", "Limit check", "limits.md", "focused"],
      [20, "working", "review", "The rate trade is near its limit", "Limit check", "exposure.csv"],
      [74, "waiting", "ask", "Asking Oyen to pause the rate trade", "Limit check", "exposure.csv"],
      [83, "working", "scan", "Rechecking limits", "Limit check", "limits.md"],
      [94, "idle", "rest", "Limits hold", null, null],
      [103, "done", "celebrate", null, null, null],
    ],
    moci: [
      [0, "idle", "rest", "Coffee before the open", null, null],
      [12, "working", "automate", "Working the open", "Morning orders", "orders.csv"],
      [30, "idle", "rest", "Handing over the order book", null, null],
      [42, "done", "rest", "Contract done, packing up", null, null, "proud"],
    ],
    belo: [
      [0, "idle", "rest", "First day on the desk", null, null],
      [34, "working", "read", "Reading the playbook", "Execute the rebalance", "playbook.md"],
      [56, "working", "automate", "Executing the rebalance", "Execute the rebalance", "orders.csv", "focused"],
      [70, "working", "run", "Working the hedge", "Execute the rebalance", "hedge.csv", "focused"],
      [92, "idle", "rest", "All filled", null, null, "proud"],
      [103, "done", "celebrate", null, null, null, "proud"],
    ],
    cemong: [
      [0, "working", "code", "Editing the pricer", "Options pricer", "pricer.py", "focused"],
      [40, "working", "run", "Pricing the book", "Options pricer", "pricer.py"],
      [80, "idle", "rest", "Book is priced", null, null],
      [103, "done", "celebrate", null, null, null],
    ],
    unyil: [
      [0, "working", "automate", "Rolling the futures", "Futures roll", "roll.csv"],
      [36, "idle", "rest", "Roll is done", null, null],
      [103, "done", "celebrate", null, null, null],
    ],
    ciko: [
      [0, "working", "design", "Drawing the P&L chart", "P&L chart", "pnl.svg"],
      [66, "idle", "rest", null, null, null],
      [103, "done", "celebrate", null, null, null],
    ],
    mpus: [
      [0, "idle", "rest", null, null, null],
      [12, "working", "research", "Comparing brokers", "Broker costs", "brokers.md"],
      [72, "idle", "rest", "Wrote it up", null, null],
      [103, "done", "celebrate", null, null, null],
    ],
  },
  events: [
    {
      t: 0,
      key: "m1s",
      meetingStart: {
        id: "morning",
        kind: "sync",
        title: "Morning meeting: today's book",
        agentIds: ["tempe", "gembul", "garong"],
        agenda: ["Overnight moves", "Today's targets", "Risk limits"],
      },
    },
    { t: 12.5, key: "m1e", meetingEnd: { id: "morning", notes: ["Belang backtests the signal", "Tempe reviews it", "Garong watches the limits"] } },
    { t: 0.3, key: "h1", beat: { kind: "handoff", fromId: "oyen", toId: "belang", taskTitle: SIGNAL } },
    { t: 4, key: "a1", beat: { kind: "ask", fromId: "tompel", toId: "oyen", question: "Can I raise the position limit?" } },
    { t: 12, key: "d1", beat: { kind: "decided", byId: "oyen", toId: "tompel", approved: true, answer: "Yes, by ten percent" } },
    { t: 16, key: "r1", beat: { kind: "review", reviewerId: "tempe", ownerId: "belang", passed: false, taskTitle: SIGNAL } },
    { t: 19, key: "c1", coffee: "cimol" },
    {
      t: 32,
      key: "m2s",
      meetingStart: {
        id: "risk",
        kind: "review",
        title: "Risk committee: the new signal",
        agentIds: ["oyen", "belang", "tempe", "tompel", "garong"],
        agenda: ["The lookahead bias", "Position limits", "When it goes live"],
      },
    },
    { t: 52, key: "m2e", meetingEnd: { id: "risk", notes: ["Belang fixes the lookahead", "Limits stay at ten percent", "Live after a clean backtest"] } },
    { t: 57, key: "r2", beat: { kind: "review", reviewerId: "tempe", ownerId: "belang", passed: true, taskTitle: SIGNAL } },
    { t: 64, key: "v1", beat: { kind: "deliver", fromId: "belang", taskTitle: SIGNAL } },
    { t: 69, key: "h2", beat: { kind: "handoff", fromId: "gembul", toId: "belang", taskTitle: "Risk dashboard" } },
    { t: 75, key: "n1", nap: "gembul" },
    { t: 74, key: "a2", beat: { kind: "ask", fromId: "garong", toId: "oyen", question: "Pause the rate trade?" } },
    { t: 80, key: "d2", beat: { kind: "decided", byId: "oyen", toId: "garong", approved: false, answer: "The owner decides, I asked them" } },
    { t: 82, key: "c2", coffee: "mpus" },
    {
      t: 88,
      key: "m3s",
      meetingStart: {
        id: "close",
        kind: "wrapup",
        title: "The close: today's book",
        agentIds: ALL,
        agenda: ["What filled", "What is hedged", "Tomorrow's targets"],
      },
    },
    { t: 100, key: "m3e", meetingEnd: { id: "close", notes: ["The rebalance filled", "The rate trade waits on the owner", "Belo runs the open tomorrow"] } },
    { t: 104, key: "cel", beat: { kind: "celebrate", agentIds: ALL } },
  ],
  cards: [
    { id: "f1", title: SIGNAL, ownerId: "belang", steps: [[0, "todo"], [5, "doing"], [22, "review"], [52, "doing"], [60, "review"], [65, "done"]] },
    { id: "f2", title: "Model validation", ownerId: "tompel", steps: [[0, "doing"], [66, "done"]] },
    { id: "f3", title: "Risk dashboard", ownerId: "gembul", steps: [[0, "doing"], [70, "review"], [90, "done"]] },
    { id: "f4", title: "Rate curve notes", ownerId: "cimol", steps: [[0, "doing"], [78, "done"]] },
    { id: "f5", title: "Limit check", ownerId: "garong", steps: [[0, "doing"], [94, "done"]] },
    { id: "f6", title: HEDGE, ownerId: "belang", steps: [[0, "todo"], [71, "doing"], [98, "done"]] },
    { id: "f7", title: "Execute the rebalance", ownerId: "belo", steps: [[0, "todo"], [56, "doing"], [92, "done"]] },
  ],
};

const DAYS: Record<Theme, Day> = { studio: STUDIO, fund: FUND };

function segAt(segs: Seg[], t: number): Seg {
  let cur = segs[0]!;
  for (const s of segs) if (s[0] <= t) cur = s;
  return cur;
}

export function crewOf(size: CrewSize): Member[] {
  return OFFICE_CREW.slice(0, size);
}

/** The crew at a time into the loop: the hire has joined after HIRE_AT, the leaver is gone after LEAVE_AT. */
export function agentsAt(t: number, size: CrewSize, theme: Theme = "studio"): OfficeAgent[] {
  const day = DAYS[theme];
  const members = crewOf(size).filter((m) => m.id !== LEAVER || t < LEAVE_AT);
  if (t >= HIRE_AT) members.push(HIRE);
  return members.map((m, i) => {
    const s = segAt(day.script[m.id]!, m.id === HIRE.id ? t - HIRE_AT : t);
    return {
      id: m.id,
      name: m.name,
      role: m.role,
      look: { coat: m.coat, seed: m.seed },
      status: s[1],
      activity: s[2],
      mood: s[6] ?? "calm",
      energy: Math.min(0.9, 0.12 + i * 0.05 + (t / LOOP_S) * 0.4),
      parentId: m.role === "lead" ? null : "oyen",
      taskTitle: s[4],
      statusText: s[3],
      file: s[5],
    };
  });
}

export function planAt(t: number, theme: Theme = "studio"): Card[] {
  return DAYS[theme].cards.map((c) => {
    let status: Card["status"] = c.steps[0]![1];
    for (const [at, st] of c.steps) if (at <= t) status = st;
    return { id: c.id, title: c.title, status, ownerId: c.ownerId };
  });
}

/** Events with a time in (from, to]. */
export function eventsBetween(from: number, to: number, theme: Theme = "studio"): StoryEvent[] {
  return DAYS[theme].events.filter((e) => e.t > from && e.t <= to);
}

export function meetingFrom(start: NonNullable<StoryEvent["meetingStart"]>, loop: number): OfficeMeeting {
  return { id: `${loop}-${start.id}`, kind: start.kind, title: start.title, agentIds: start.agentIds, agenda: start.agenda, endedAt: null, notes: [] };
}
