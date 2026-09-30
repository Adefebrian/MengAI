// The lifecycle story: one goal grows a whole company, played by the full
// Office floor (@mengai/cats, office-contract.ts) under the landing's
// progress tracker and the what-is-in-its-head card. Two companies, one
// shape: a software studio and a hedge fund (Office theme "fund"). Both
// are samples written for this page, never recordings, and the page says
// so. No model is called.
//
// JEV imm.concept c4 "The door is the company" (core 2.34, first screen
// 0.72, feasible 0.78): Oyen starts alone with the goal; the clock starts
// when the floor is half in view and the first hire steps into the doorway
// within about 3 s (critic fix round 2), the rest walking in with their
// boxes and settling before the kickoff seats them at the table;
// later a cat that failed three times walks out with its box through the
// same door as its replacement walks in, starting with everything the role
// has learned. The story plays once when the section is on screen and
// rests on the shipped frame (a Replay control starts it again), so the
// floor never shrinks back under a reader by itself.
//
// Every step names the tracker stage it belongs to (and, after a failed
// review, the stage that bounced), who is hired or leaves, what each cat
// is doing, and what changed in the focus cat's head. Pure data plus pure
// functions: lifeAt(company, i) folds the steps up to i into the props of
// the Office, the tracker cells and the head card.
import { crewLooks, rosterCat, type OfficeAgent, type OfficeBeat, type OfficeMeeting, type TrackerStage } from "@mengai/cats";
import type { Activity, AgentRole, AgentStatus, Coat, Mood } from "@mengai/shared";
import type { PlanCard, PlanStatus, ScriptBeat } from "./script";

export type CompanyKind = "studio" | "fund";

export const LIFE_LABEL = "Sample story, scripted for this page";

export interface LifeCat {
  id: string;
  name: string;
  role: AgentRole;
  /** the job title the page shows; a dynamic role when it is not the role's own name */
  title: string;
  coat: Coat;
  seed: number;
}

export interface TrackStage {
  id: string;
  label: string;
}

/** One row of the head card: what is injected, and the evidence behind it. */
export interface HeadRow {
  value: string;
  evidence: string;
}

export type HeadKey = "charter" | "strategy" | "skills" | "tools" | "memory" | "trust";
export const HEAD_KEYS: HeadKey[] = ["charter", "strategy", "skills", "tools", "memory", "trust"];
export const HEAD_LABEL: Record<HeadKey, string> = {
  charter: "Charter",
  strategy: "Strategy",
  skills: "Skills",
  tools: "Tools",
  memory: "Memory",
  trust: "Trust",
};

export interface HeadState {
  /** one line under the cat's name: when it joined, or that it has not yet */
  status: string;
  rows: Record<HeadKey, HeadRow>;
}

type AgentPatch = Partial<Pick<OfficeAgent, "status" | "activity" | "mood" | "taskTitle" | "statusText" | "file">>;

export interface LifeStep {
  id: string;
  /** short scene name for the scene list */
  scene: string;
  at: number;
  clock: string;
  /** the tracker's status line: what the company is doing, in the cat voice */
  caption: string;
  /** index of the tracker stage this step belongs to */
  stage: number;
  /** a stage that was sent back and waits to be passed again */
  back?: number;
  /** the whole goal is done: every stage reads done */
  complete?: boolean;
  hire?: string[];
  leave?: string[];
  agents?: Record<string, AgentPatch>;
  plan?: Record<string, PlanStatus>;
  beats?: ScriptBeat[];
  meetingStart?: Omit<OfficeMeeting, "endedAt" | "notes">;
  meetingEnd?: { id: string; notes: string[] };
  /** what changed in the focus cat's head; the card marks these rows new */
  head?: { status?: string } & Partial<Record<HeadKey, HeadRow>>;
}

export interface Company {
  kind: CompanyKind;
  /** the switch label */
  label: string;
  goal: string;
  /** Office theme */
  theme: "studio" | "fund";
  /** the cat whose head the card shows */
  focus: string;
  cats: LifeCat[];
  /** cats on the floor before the first step: the CEO alone */
  start: string[];
  stages: TrackStage[];
  plan: PlanCard[];
  head: HeadState;
  steps: LifeStep[];
  /** one play, in ms, from the first step to the end of the last */
  total: number;
  /** the still under reduced motion: the whole crew at work */
  poster: number;
}

const work = (activity: Activity, statusText: string, status: AgentStatus = "working", file: string | null = null): AgentPatch => ({
  status,
  activity,
  statusText,
  file,
});

const mood = (patch: AgentPatch, m: Mood) => ({ ...patch, mood: m });

/**
 * A story crew from the shared crew roster (@mengai/cats): each cat's role
 * is the roster's and its look comes from crewLooks, so Oyen is always the
 * ginger CEO, a name wears its roster coat wherever it can, and no coat
 * repeats inside one crew (tested).
 */
function cast(crew: ReadonlyArray<readonly [name: string, title: string]>): LifeCat[] {
  const looks = crewLooks(crew.map(([name]) => name));
  return crew.map(([name, title], i) => {
    const r = rosterCat(name);
    if (!r) throw new Error(`${name} is not on the crew roster`);
    const look = looks[i]!;
    return { id: r.id, name: r.name, role: r.role, title, coat: look.coat, seed: look.seed };
  });
}

/* ---------------------------------------------------------------------
 * The software studio
 * ------------------------------------------------------------------- */
const STUDIO_CATS: LifeCat[] = cast([
  ["Oyen", "CEO"],
  ["Cemong", "Engineer"],
  ["Bakwan", "Engineer"],
  ["Serabi", "Copywriter"],
  ["Tempe", "Reviewer"],
  ["Onde", "QA"],
  ["Risol", "Engineer"],
]);

const STUDIO_ALL = ["oyen", "cemong", "bakwan", "serabi", "tempe", "onde"];

export const STUDIO: Company = {
  kind: "studio",
  label: "Software studio",
  goal: "A launch page for Warung Kas, with a signup form and tests",
  theme: "studio",
  focus: "cemong",
  cats: STUDIO_CATS,
  start: ["oyen"],
  stages: [
    { id: "goal", label: "Goal received" },
    { id: "plan", label: "Oyen plans" },
    { id: "hired", label: "Team hired" },
    { id: "working", label: "Working" },
    { id: "review", label: "Review" },
    { id: "testing", label: "Testing" },
    { id: "shipped", label: "Shipped" },
  ],
  plan: [
    { id: "s1", title: "Plan the launch", status: "todo", ownerId: "oyen" },
    { id: "s2", title: "Write the launch copy", status: "todo", ownerId: "serabi" },
    { id: "s3", title: "Build the signup form", status: "todo", ownerId: "cemong" },
    { id: "s4", title: "Build the signup API", status: "todo", ownerId: "bakwan" },
    { id: "s5", title: "Review the signup", status: "todo", ownerId: "tempe" },
    { id: "s6", title: "Test the signup", status: "todo", ownerId: "onde" },
  ],
  head: {
    status: "Joins when Oyen hires an engineer",
    rows: {
      charter: { value: "Engineer charter v3", evidence: "Static and cached by your provider: the same text for every engineer." },
      strategy: { value: "v3: read the acceptance criteria before the first edit.", evidence: "Learned by the role, not the cat: every engineer gets it." },
      skills: { value: "Run the signup tests", evidence: "Promoted after 6 wins in 7 uses, checked by an offline eval." },
      tools: { value: "Search, read, edit and run in your project, hand off, save a skill.", evidence: "The engineer's own tool set: nothing outside the project folder." },
      memory: { value: "Nothing yet.", evidence: "First run with this crew." },
      trust: { value: "No reviews yet.", evidence: "Tempe has not reviewed Cemong's work before." },
    },
  },
  steps: [
    {
      id: "goal",
      scene: "A new goal",
      at: 0,
      clock: "09:00",
      stage: 0,
      caption: "A new goal lands on Oyen's desk: a Warung Kas launch page, with signup and tests.",
      agents: { oyen: work("read", "A new goal. On it.") },
    },
    {
      id: "plan",
      scene: "Oyen plans",
      at: 1_200,
      clock: "09:02",
      stage: 1,
      caption: "Oyen plans six cards and spots five roles the studio does not have yet.",
      agents: { oyen: { ...work("plan", "Six cards, five hires."), taskTitle: "Plan the launch" } },
      plan: { s1: "doing", s2: "todo", s3: "todo", s4: "todo", s5: "todo", s6: "todo" },
    },
    {
      id: "hire",
      scene: "Hiring",
      at: 2_600,
      clock: "09:03",
      stage: 2,
      caption: "Oyen hires. Five cats walk in with their boxes, and Serabi fills a new role: Copywriter.",
      hire: ["cemong", "bakwan", "serabi", "tempe", "onde"],
      agents: {
        oyen: work("think", "Welcome aboard."),
        cemong: work("read", "Where is my desk?", "thinking"),
        bakwan: work("read", "Nice chair.", "thinking"),
        serabi: work("read", "Copywriter, reporting in.", "thinking"),
        tempe: work("read", "I review things.", "thinking"),
        onde: work("read", "I break things. Nicely.", "thinking"),
      },
      plan: { s1: "done" },
      head: { status: "Hired at 09:03 for the signup form" },
    },
    {
      id: "kickoff",
      scene: "Kickoff",
      at: 19_000,
      clock: "09:05",
      stage: 2,
      caption: "Kickoff in the meeting room: who takes which card, and what has to pass review.",
      agents: {
        oyen: work("plan", "Here is the plan."),
        cemong: work("think", "Signup form, mine.", "thinking"),
        bakwan: work("think", "I take the API.", "thinking"),
        serabi: work("think", "Words first.", "thinking"),
        tempe: work("think", "Everything passes me.", "thinking"),
        onde: work("think", "Then my tests.", "thinking"),
      },
      meetingStart: {
        id: "kickoff",
        kind: "kickoff",
        title: "Kickoff",
        agentIds: STUDIO_ALL,
        agenda: ["Read the goal", "Who takes which card", "What needs a review"],
      },
    },
    {
      id: "desks",
      scene: "Desk work",
      at: 33_000,
      clock: "09:12",
      stage: 3,
      caption: "Each cat takes its card to its desk. Cemong builds the form, Serabi writes the copy.",
      meetingEnd: { id: "kickoff", notes: ["Serabi writes the copy first", "Tempe reviews the form before the tests"] },
      agents: {
        oyen: work("plan", "Watching the board."),
        cemong: { ...work("code", "Building the form.", "working", "src/signup/Form.tsx"), taskTitle: "Build the signup form" },
        bakwan: { ...work("code", "Wiring the API.", "working", "src/signup/api.ts"), taskTitle: "Build the signup API" },
        serabi: { ...work("read", "Drafting the headline.", "working", "copy/launch.md"), taskTitle: "Write the launch copy" },
        tempe: { ...work("wait", "Waiting for the form.", "waiting"), taskTitle: "Review the signup" },
        onde: { ...work("read", "Reading the old tests.", "working", "tests/signup.test.ts"), taskTitle: "Test the signup" },
      },
      plan: { s2: "doing", s3: "doing", s4: "doing" },
    },
    {
      id: "coffee",
      scene: "Coffee queue",
      at: 40_000,
      clock: "09:40",
      stage: 3,
      caption: "A queue at the coffee machine. Serabi lets Onde go first, Tempe waits with an empty mug.",
      agents: {
        serabi: mood(work("read", "After you, Onde.", "idle", "copy/launch.md"), "calm"),
        onde: mood(work("rest", "Oat milk, please.", "idle"), "calm"),
        tempe: mood(work("rest", "Still waiting.", "idle"), "calm"),
      },
      plan: { s2: "done" },
    },
    {
      id: "handoff",
      scene: "Review",
      at: 47_000,
      clock: "10:05",
      stage: 4,
      caption: "Cemong carries the signup form to Tempe for review.",
      agents: {
        cemong: work("handoff", "Form is ready, Tempe.", "working", "src/signup/Form.tsx"),
        tempe: work("wait", "Let me see.", "waiting"),
      },
      plan: { s3: "review", s5: "doing" },
      beats: [{ kind: "handoff", fromId: "cemong", toId: "tempe", taskTitle: "Build the signup form" }],
    },
    {
      id: "bounce",
      scene: "Sent back",
      at: 53_000,
      clock: "10:08",
      stage: 3,
      back: 4,
      caption: "Tempe sends it back: a bad email shows no error. The tracker steps back to Working.",
      agents: {
        tempe: work("review", "No error on a bad email.", "working", "src/signup/Form.tsx"),
        cemong: mood(work("wait", "Fair. Fixing it.", "waiting", "src/signup/Form.tsx"), "frustrated"),
      },
      plan: { s3: "doing" },
      beats: [{ kind: "review", reviewerId: "tempe", ownerId: "cemong", passed: false, taskTitle: "Build the signup form" }],
      head: {
        strategy: {
          value: "v4: show an error for every invalid field before a handoff.",
          evidence: "Adopted after an offline eval and a judge's check: it covers 3 of 3 recent failures, v3 covered 1.",
        },
        memory: { value: "Tempe wants an error on every field.", evidence: "Written after round 1 of the review." },
        trust: { value: "Tempe still checks Cemong's work closely.", evidence: "0 of 1 reviews passed so far." },
      },
    },
    {
      id: "strikes",
      scene: "Third strike",
      at: 60_000,
      clock: "10:20",
      stage: 3,
      back: 4,
      caption: "Bakwan's build fails for the third time in a row.",
      agents: {
        bakwan: mood(work("run", "Failed. Again.", "error", "src/signup/api.ts"), "frustrated"),
        oyen: work("think", "Three in a row, Bakwan."),
      },
    },
    {
      id: "letgo",
      scene: "Let go",
      at: 66_000,
      clock: "10:22",
      stage: 3,
      back: 4,
      caption: "Oyen lets Bakwan go. He walks out with his box as Risol walks in and takes his card.",
      leave: ["bakwan"],
      hire: ["risol"],
      agents: {
        oyen: work("plan", "Risol, the API is yours."),
        risol: { ...work("code", "Picking up the API.", "working", "src/signup/api.ts"), taskTitle: "Build the signup API" },
      },
      head: {
        strategy: {
          value: "v4: show an error for every invalid field before a handoff.",
          evidence: "Adopted after an offline eval and a judge's check. Risol, the new hire, starts on v4 too.",
        },
      },
    },
    {
      id: "overtime",
      scene: "Overtime",
      at: 74_000,
      clock: "18:40",
      stage: 3,
      back: 4,
      caption: "Overtime. Onde yawns, Serabi naps in the cat bed, Cemong adds the last error message.",
      agents: {
        onde: mood(work("wait", "Yawn. Tests are ready.", "waiting", "tests/signup.test.ts"), "tired"),
        serabi: mood(work("rest", "Five minutes.", "idle"), "tired"),
        cemong: mood(work("code", "Last error message.", "working", "src/signup/Form.tsx"), "focused"),
        risol: work("code", "API is green.", "working", "src/signup/api.ts"),
      },
      plan: { s4: "done" },
    },
    {
      id: "tests",
      scene: "Tests",
      at: 80_000,
      clock: "19:05",
      stage: 5,
      caption: "Tempe passes round two. Onde runs 24 tests on the server rack, and all 24 pass.",
      agents: {
        tempe: work("review", "Round two passes."),
        cemong: mood(work("rest", "Phew.", "done"), "proud"),
        onde: mood(work("run", "24 of 24 pass.", "working", "tests/signup.test.ts"), "focused"),
      },
      plan: { s3: "done", s5: "done", s6: "doing" },
      beats: [{ kind: "review", reviewerId: "tempe", ownerId: "cemong", passed: true, taskTitle: "Build the signup form" }],
      head: {
        memory: { value: "Tempe checks the empty email first.", evidence: "Written after round 2 passed." },
        trust: { value: "Tempe trusts Cemong more after round 2.", evidence: "1 of 2 reviews passed." },
      },
    },
    {
      id: "shipped",
      scene: "Shipped",
      at: 87_000,
      clock: "19:20",
      stage: 6,
      complete: true,
      caption: "Shipped. The crew celebrates and Oyen writes your report.",
      agents: {
        oyen: mood(work("plan", "Writing your report."), "proud"),
        cemong: mood(work("celebrate", "Shipped.", "done"), "proud"),
        serabi: mood(work("celebrate", "Shipped.", "done"), "proud"),
        tempe: mood(work("celebrate", "Shipped.", "done"), "proud"),
        onde: mood(work("celebrate", "Shipped.", "done"), "proud"),
        risol: mood(work("celebrate", "Day one. Shipped.", "done"), "proud"),
      },
      plan: { s6: "done" },
      beats: [{ kind: "celebrate", agentIds: ["cemong", "serabi", "tempe", "onde", "risol"] }],
    },
  ],
  total: 96_000,
  poster: 4,
};

/* ---------------------------------------------------------------------
 * The hedge fund
 * ------------------------------------------------------------------- */
const FUND_CATS: LifeCat[] = cast([
  ["Oyen", "CEO"],
  ["Salak", "Data researcher"],
  ["Jahe", "Quant"],
  ["Kencur", "Quant"],
  ["Duku", "Risk officer"],
  ["Pukis", "Trade checker"],
  ["Lontong", "Quant"],
]);

const FUND_ALL = ["oyen", "salak", "jahe", "kencur", "duku", "pukis"];

export const FUND: Company = {
  kind: "fund",
  label: "Hedge fund",
  goal: "A momentum thesis on Indonesian large caps, paper traded first",
  theme: "fund",
  focus: "jahe",
  cats: FUND_CATS,
  start: ["oyen"],
  stages: [
    { id: "thesis", label: "Thesis" },
    { id: "research", label: "Data research" },
    { id: "backtest", label: "Backtest" },
    { id: "risk", label: "Risk review" },
    { id: "paper", label: "Paper trade" },
    { id: "live", label: "Live trade" },
    { id: "report", label: "P&L report" },
  ],
  plan: [
    { id: "f1", title: "Frame the thesis", status: "todo", ownerId: "oyen" },
    { id: "f2", title: "Clean five years of prices", status: "todo", ownerId: "salak" },
    { id: "f3", title: "Backtest the signal", status: "todo", ownerId: "jahe" },
    { id: "f4", title: "Backtest the exits", status: "todo", ownerId: "kencur" },
    { id: "f5", title: "Review the risk", status: "todo", ownerId: "duku" },
    { id: "f6", title: "Check the paper fills", status: "todo", ownerId: "pukis" },
  ],
  head: {
    status: "Joins when Oyen hires a quant",
    rows: {
      charter: { value: "Quant charter v2", evidence: "Static and cached by your provider: the same text for every quant." },
      strategy: { value: "v1: hold out the last 12 months and never tune on them.", evidence: "Learned by the role, not the cat: every quant gets it." },
      skills: { value: "Walk-forward backtest", evidence: "Promoted after 5 wins in 6 uses, checked by an offline eval." },
      tools: { value: "Market data over your MCP server, backtest runs, hand off, save a skill.", evidence: "Every order is paper until you switch live trading on." },
      memory: { value: "Nothing yet.", evidence: "First run on this desk." },
      trust: { value: "No reviews yet.", evidence: "Duku has not reviewed Jahe's work before." },
    },
  },
  steps: [
    {
      id: "thesis",
      scene: "A new thesis",
      at: 0,
      clock: "08:00",
      stage: 0,
      caption: "A thesis lands on Oyen's desk: momentum in Indonesian large caps, paper traded first.",
      agents: { oyen: work("read", "A thesis. Let us test it.") },
    },
    {
      id: "plan",
      scene: "Oyen plans",
      at: 1_200,
      clock: "08:02",
      stage: 0,
      caption: "Oyen splits it into six cards and spots five seats the trading floor does not have yet.",
      agents: { oyen: { ...work("plan", "Six cards, five hires."), taskTitle: "Frame the thesis" } },
      plan: { f1: "doing", f2: "todo", f3: "todo", f4: "todo", f5: "todo", f6: "todo" },
    },
    {
      id: "hire",
      scene: "Hiring",
      at: 2_600,
      clock: "08:03",
      stage: 0,
      caption: "Oyen hires. Five cats walk in with their boxes, and Duku fills a new role: Risk officer.",
      hire: ["salak", "jahe", "kencur", "duku", "pukis"],
      agents: {
        oyen: work("think", "Welcome to the floor."),
        salak: work("read", "I bring the data.", "thinking"),
        jahe: work("read", "Quant, at your service.", "thinking"),
        kencur: work("read", "Also a quant.", "thinking"),
        duku: work("read", "I say no a lot.", "thinking"),
        pukis: work("read", "I check every fill.", "thinking"),
      },
      plan: { f1: "done" },
      head: { status: "Hired at 08:03 for the backtest" },
    },
    {
      id: "research",
      scene: "Data research",
      at: 19_000,
      clock: "08:20",
      stage: 1,
      caption: "Salak pulls five years of daily prices. Meanwhile the coffee queue is three cats long.",
      agents: {
        salak: { ...work("research", "Cleaning the gaps.", "working", "data/idx-daily.csv"), taskTitle: "Clean five years of prices" },
        jahe: mood(work("rest", "Coffee first.", "idle"), "calm"),
        kencur: mood(work("rest", "Same.", "idle"), "calm"),
        pukis: mood(work("rest", "Oat milk, please.", "idle"), "calm"),
        duku: { ...work("wait", "Waiting for a backtest.", "waiting"), taskTitle: "Review the risk" },
      },
      plan: { f2: "doing" },
    },
    {
      id: "backtest",
      scene: "Backtest",
      at: 26_000,
      clock: "09:10",
      stage: 2,
      caption: "The data is clean. Jahe and Kencur backtest the signal and the exits at their desks.",
      agents: {
        salak: work("research", "Data is clean.", "done"),
        jahe: { ...work("code", "Backtesting the signal.", "working", "research/momentum.py"), taskTitle: "Backtest the signal" },
        kencur: { ...work("code", "Tuning the exits.", "working", "research/exits.py"), taskTitle: "Backtest the exits" },
        pukis: { ...work("read", "Reading the order rules.", "working"), taskTitle: "Check the paper fills" },
      },
      plan: { f2: "done", f3: "doing", f4: "doing" },
    },
    {
      id: "risk",
      scene: "Risk review",
      at: 33_000,
      clock: "10:30",
      stage: 3,
      caption: "Jahe carries the backtest to Duku for the risk review.",
      agents: {
        jahe: work("handoff", "Backtest is ready, Duku.", "working", "research/momentum.py"),
        duku: work("wait", "Show me the drawdown.", "waiting"),
      },
      plan: { f3: "review", f5: "doing" },
      beats: [{ kind: "handoff", fromId: "jahe", toId: "duku", taskTitle: "Backtest the signal" }],
    },
    {
      id: "bounce",
      scene: "Sent back",
      at: 39_000,
      clock: "10:34",
      stage: 2,
      back: 3,
      caption: "Duku sends it back: a 31% drawdown against a 15% limit. The tracker steps back.",
      agents: {
        duku: work("review", "31% drawdown. No.", "working", "research/momentum.py"),
        jahe: mood(work("wait", "Fair. Adding a cap.", "waiting", "research/momentum.py"), "frustrated"),
      },
      plan: { f3: "doing" },
      beats: [{ kind: "review", reviewerId: "duku", ownerId: "jahe", passed: false, taskTitle: "Backtest the signal" }],
      head: {
        strategy: {
          value: "v2: cap the drawdown at 15% before a risk review.",
          evidence: "Adopted after an offline eval and a judge's check: it covers 2 of 2 risk bounces, v1 covered 0.",
        },
        memory: { value: "Duku caps drawdown at 15%.", evidence: "Written after round 1 of the risk review." },
        trust: { value: "Duku still checks Jahe's work closely.", evidence: "0 of 1 reviews passed so far." },
      },
    },
    {
      id: "committee",
      scene: "Risk committee",
      at: 45_000,
      clock: "10:40",
      stage: 2,
      back: 3,
      caption: "Oyen calls the risk committee: the limit stays at 15%, and the exits need a second look.",
      agents: {
        oyen: work("plan", "The limit stays."),
        duku: work("think", "15%, not a point more.", "thinking"),
        jahe: work("think", "A cap on every position.", "thinking"),
        kencur: work("think", "My exits are fine.", "thinking"),
      },
      meetingStart: {
        id: "committee",
        kind: "review",
        title: "Risk committee",
        agentIds: ["oyen", "duku", "jahe", "kencur"],
        agenda: ["The 31% drawdown", "The 15% limit", "Who fixes the exits"],
      },
    },
    {
      id: "strikes",
      scene: "Third strike",
      at: 54_000,
      clock: "11:30",
      stage: 2,
      back: 3,
      caption: "Kencur's third backtest in a row is overfit again.",
      meetingEnd: { id: "committee", notes: ["Drawdown limit stays at 15%", "Every position gets a cap"] },
      agents: {
        kencur: mood(work("run", "Overfit. Again.", "error", "research/exits.py"), "frustrated"),
        oyen: work("think", "Three in a row, Kencur."),
        jahe: mood(work("code", "Adding the cap.", "working", "research/momentum.py"), "focused"),
      },
    },
    {
      id: "letgo",
      scene: "Let go",
      at: 60_000,
      clock: "11:32",
      stage: 2,
      back: 3,
      caption: "Oyen lets Kencur go. He walks out with his box as Lontong walks in to take his card.",
      leave: ["kencur"],
      hire: ["lontong"],
      agents: {
        oyen: work("plan", "Lontong, the exits are yours."),
        lontong: { ...work("code", "Picking up the exits.", "working", "research/exits.py"), taskTitle: "Backtest the exits" },
      },
      head: {
        strategy: {
          value: "v2: cap the drawdown at 15% before a risk review.",
          evidence: "Adopted after an offline eval and a judge's check. Lontong, the new hire, starts on v2 too.",
        },
      },
    },
    {
      id: "paper",
      scene: "Paper trade",
      at: 68_000,
      clock: "14:00",
      stage: 4,
      caption: "Risk passes at a 12% drawdown. Paper trading starts, and Salak naps in the cat bed.",
      agents: {
        duku: work("review", "12%. Approved."),
        jahe: mood(work("run", "Paper orders out.", "working", "trades/paper.log"), "proud"),
        lontong: work("code", "Exits are in.", "done", "research/exits.py"),
        pukis: work("scan", "Fills match the backtest.", "working", "trades/paper.log"),
        salak: mood(work("rest", "Wake me for live.", "idle"), "tired"),
      },
      plan: { f3: "done", f4: "done", f5: "done", f6: "doing" },
      beats: [{ kind: "review", reviewerId: "duku", ownerId: "jahe", passed: true, taskTitle: "Backtest the signal" }],
      head: {
        memory: { value: "Round two passed at a 12% drawdown.", evidence: "Written after the risk review passed." },
        trust: { value: "Duku trusts Jahe more after round 2.", evidence: "1 of 2 reviews passed." },
      },
    },
    {
      id: "live",
      scene: "Live needs you",
      at: 75_000,
      clock: "16:00",
      stage: 5,
      caption: "Going live is your call: Oyen asks you first, and orders stay inside your hard limits.",
      agents: {
        oyen: work("ask", "Owner, may we go live?", "approval"),
        pukis: mood(work("wait", "Yawn. Paper looks clean.", "waiting"), "tired"),
      },
      plan: { f6: "done" },
      beats: [{ kind: "ask", fromId: "jahe", toId: "oyen", question: "Paper looks clean. Can we go live?" }],
    },
    {
      id: "report",
      scene: "P&L report",
      at: 82_000,
      clock: "17:00",
      stage: 6,
      complete: true,
      caption: "You said yes. Oyen writes the P&L report with a reason for every trade. The floor cheers.",
      agents: {
        oyen: mood(work("plan", "Writing the P&L report."), "proud"),
        salak: mood(work("celebrate", "Up and awake.", "done"), "proud"),
        jahe: mood(work("celebrate", "Live, inside the limits.", "done"), "proud"),
        duku: mood(work("celebrate", "Still 15%.", "done"), "proud"),
        pukis: mood(work("celebrate", "Every fill checked.", "done"), "proud"),
        lontong: mood(work("celebrate", "Day one. Live.", "done"), "proud"),
      },
      beats: [{ kind: "celebrate", agentIds: ["salak", "jahe", "duku", "pukis", "lontong"] }],
    },
  ],
  total: 91_000,
  poster: 4,
};

export const COMPANIES: Record<CompanyKind, Company> = { studio: STUDIO, fund: FUND };
export const COMPANY_KINDS: CompanyKind[] = ["studio", "fund"];

/* ---------------------------------------------------------------------
 * Folding the story
 * ------------------------------------------------------------------- */
export type CellState = "done" | "now" | "next" | "back";

export interface LifeScene {
  step: LifeStep;
  agents: OfficeAgent[];
  meetings: OfficeMeeting[];
  plan: PlanCard[];
  cells: CellState[];
  head: HeadState;
  /** head rows that changed in this step */
  fresh: HeadKey[];
  /** the focus cat is on the floor */
  focusHired: boolean;
}

export function catOf(company: Company, id: string): LifeCat {
  const c = company.cats.find((x) => x.id === id);
  if (!c) throw new Error(`unknown cat ${id} in the ${company.kind} story`);
  return c;
}

function agentOf(company: Company, id: string): OfficeAgent {
  const c = catOf(company, id);
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    look: { coat: c.coat, seed: c.seed },
    status: "working",
    activity: c.role === "lead" ? "plan" : "read",
    mood: "focused",
    energy: 0,
    parentId: c.role === "lead" ? null : "oyen",
    taskTitle: null,
    statusText: null,
    file: null,
  };
}

/** The tracker cells at one step: done before the stage, the stage now, a bounced stage back. */
export function cellsAt(step: LifeStep, count: number): CellState[] {
  return Array.from({ length: count }, (_, i) => {
    if (step.complete) return "done";
    if (i === step.back) return "back";
    if (i < step.stage) return "done";
    return i === step.stage ? "now" : "next";
  });
}

/** Share of the run budget used by a step: the day uses most of it. */
export function lifeEnergy(company: Company, at: number): number {
  return Math.round((0.05 + 0.75 * Math.min(1, Math.max(0, at / company.total))) * 100) / 100;
}

/** The scene after steps 0..index have played. Pure. */
export function lifeAt(company: Company, index: number): LifeScene {
  const last = Math.max(0, Math.min(index, company.steps.length - 1));
  let agents = company.start.map((id) => agentOf(company, id));
  const status = new Map<string, PlanStatus>();
  let meetings: OfficeMeeting[] = [];
  const head: HeadState = { status: company.head.status, rows: { ...company.head.rows } };
  for (let i = 0; i <= last; i++) {
    const s = company.steps[i]!;
    if (s.leave) agents = agents.filter((a) => !s.leave!.includes(a.id));
    if (s.hire) agents = [...agents, ...s.hire.filter((id) => !agents.some((a) => a.id === id)).map((id) => agentOf(company, id))];
    if (s.agents) {
      const patch = s.agents;
      agents = agents.map((a) => (patch[a.id] ? { ...a, ...patch[a.id] } : a));
    }
    for (const [id, next] of Object.entries(s.plan ?? {})) status.set(id, next);
    if (s.meetingStart) meetings = [...meetings, { ...s.meetingStart, endedAt: null, notes: [] }];
    if (s.meetingEnd) {
      const end = s.meetingEnd;
      meetings = meetings.map((m) => (m.id === end.id ? { ...m, endedAt: s.at, notes: end.notes } : m));
    }
    if (s.head) {
      if (s.head.status) head.status = s.head.status;
      for (const k of HEAD_KEYS) if (s.head[k]) head.rows[k] = s.head[k]!;
    }
  }
  const step = company.steps[last]!;
  const energy = lifeEnergy(company, step.at);
  agents = agents.map((a) => ({ ...a, energy }));
  const plan = company.plan.filter((p) => status.has(p.id)).map((p) => ({ ...p, status: status.get(p.id)! }));
  const fresh = HEAD_KEYS.filter((k) => step.head?.[k] !== undefined);
  return {
    step,
    agents,
    meetings,
    plan,
    cells: cellsAt(step, company.stages.length),
    head,
    fresh,
    focusHired: agents.some((a) => a.id === company.focus),
  };
}

/** Beats with ids unique across plays and across the two companies. */
export function lifeBeats(company: Company, index: number, play: number): OfficeBeat[] {
  return (company.steps[index]?.beats ?? []).map((b, j) => ({ ...b, id: `${company.kind}-p${play}-s${index}-b${j}` }) as OfficeBeat);
}

/** Accessible summary of the office at one step. */
export function lifeLabel(company: Company, step: LifeStep): string {
  return `${LIFE_LABEL}: ${company.label.toLowerCase()}. ${step.clock}. ${step.caption}`;
}

/** "Step 3 of 7: Team hired", the tracker's position in words. */
export function stageWords(company: Company, step: LifeStep): string {
  const n = company.stages.length;
  if (step.complete) return `${n} of ${n}: ${company.stages[n - 1]!.label}`;
  return `${step.stage + 1} of ${n}: ${company.stages[step.stage]!.label}`;
}

/**
 * The DeliveryTracker's stop id for a lifecycle stage: the tracker draws a
 * pictogram per known stage id (a door for Team hired, a shield for the
 * risk review), so the few stages this page names differently map to it.
 */
export const TRACKER_STOP_ID: Readonly<Record<string, string>> = {
  plan: "planned",
  risk: "risk_review",
  paper: "paper_trade",
  live: "live_trade",
};

export interface TrackerState {
  stages: TrackerStage[];
  current: number;
  looping: boolean;
  loops: number;
  done: boolean;
  status: string;
}

/**
 * The on-demand tracker at step `index`: the stop the story is at, whether
 * a review has sent it back (and how many times so far), and the status
 * line. A stop the story has reached carries the caption of its latest
 * scene as its detail, so a tap on it retells what happened there; a stop
 * not reached yet has none, so the tracker says it is still ahead.
 */
export function trackerAt(company: Company, index: number): TrackerState {
  const last = Math.max(0, Math.min(index, company.steps.length - 1));
  const step = company.steps[last]!;
  const detail: (string | null)[] = company.stages.map(() => null);
  let loops = 0;
  for (let i = 0; i <= last; i++) {
    const s = company.steps[i]!;
    detail[s.stage] = s.caption;
    if (s.back !== undefined && company.steps[i - 1]?.back === undefined) loops += 1;
  }
  return {
    stages: company.stages.map((st, i) => ({ id: TRACKER_STOP_ID[st.id] ?? st.id, label: st.label, detail: detail[i] })),
    current: step.complete ? company.stages.length - 1 : step.stage,
    looping: step.back !== undefined,
    loops,
    done: step.complete === true,
    status: step.caption,
  };
}

/* ---------------------------------------------------------------------
 * The narrow floor's camera and the meeting cut (critic round 2)
 * ------------------------------------------------------------------- */

/** The room a step plays in, for the phone floor's camera window. */
export type LifeRoom = { kind: "door" } | { kind: "meeting" } | { kind: "desks"; ids: string[] };

/**
 * Where a step plays: a hire or a leave at the door, a meeting in the
 * meeting room, the walk back from it at the crew's desks, a coffee queue
 * (two or more cats set idle) at the desks they get up from, a beat at the
 * desks of the cats in it, else the focus cat's desk (the CEO's while the
 * focus cat is not hired yet). Pure.
 */
export function roomOf(company: Company, index: number): LifeRoom {
  const step = company.steps[Math.max(0, Math.min(index, company.steps.length - 1))]!;
  if (step.hire?.length || step.leave?.length) return { kind: "door" };
  if (step.meetingStart) return { kind: "meeting" };
  // the meeting is over: the crew walks back to its desks, so the camera holds the desk rows they walk into
  if (step.meetingEnd) return { kind: "desks", ids: lifeAt(company, index).agents.filter((a) => a.role !== "lead").map((a) => a.id) };
  // a coffee queue: the desks the idle cats get up from (the Office sends them on their trip in its own time)
  const idle = Object.entries(step.agents ?? {}).filter(([, p]) => p.status === "idle").map(([id]) => id);
  if (idle.length >= 2) return { kind: "desks", ids: idle };
  const beat = step.beats?.[0];
  if (beat) {
    switch (beat.kind) {
      case "handoff":
        return { kind: "desks", ids: [beat.fromId, beat.toId] };
      case "ask":
        return { kind: "desks", ids: [beat.fromId, beat.toId] };
      case "decided":
        return { kind: "desks", ids: [beat.byId, beat.toId] };
      case "review":
        return { kind: "desks", ids: [beat.reviewerId, beat.ownerId] };
      case "deliver":
        return { kind: "desks", ids: [beat.fromId, "oyen"] };
      case "celebrate":
        return { kind: "desks", ids: beat.agentIds };
    }
  }
  const hired = lifeAt(company, index).agents.some((a) => a.id === company.focus);
  return { kind: "desks", ids: [hired ? company.focus : "oyen"] };
}

/** The step that opens the story's meeting, or -1. */
export function meetingStep(company: Company): number {
  return company.steps.findIndex((s) => s.meetingStart);
}
