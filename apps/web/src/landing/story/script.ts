// The hero story: a scripted morning in the cat company, played by the
// Office scene (@mengai/cats, office-contract.ts) in its hero variant inside
// the hero's product frame. It is a sample written for this page, never a
// recording, and the page says so.
//
// The loop opens on desk work (critic fix round 2: the company is already
// at work in the first frame, never five empty desks): every cat seated at
// its own desk, the plan on the whiteboard, code on the monitors and one
// handoff already walking. The day then plays every scenario the company
// runs: a question walked to Oyen and approved on the spot, a handoff, a
// review bounce and the sync about it, the fix, the tests, a coffee break,
// the wrap-up, the celebration, and last the kickoff of the next goal with
// its plan dealt onto the board, which hands back to desk work.
//
// Each step also names the camera shot the frame holds while it plays (JEV
// ui.component_recipe hero_frame bang.shot_size 0.68: wide on the desk row,
// close on the desk where the beat happens, each shot held at least 1.5 s)
// and the notices the frame's company feed receives (JEV hero_chips
// an.R21_flip_feed 0.67).
//
// Pure data plus pure functions, so the timeline is tested without a
// browser: sceneAt(i) folds the steps up to i into the scene props, and
// stepAt(ms) finds the step playing at a time into the loop.
import type { OfficeAgent, OfficeBeat, OfficeMeeting, OfficeProps } from "@mengai/cats";
import type { Activity, AgentRole, AgentStatus } from "@mengai/shared";

export type PlanCard = NonNullable<OfficeProps["plan"]>[number];
export type PlanStatus = PlanCard["status"];
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
/** A beat as the script writes it; the player gives it a unique id per play. */
export type ScriptBeat = WithoutId<OfficeBeat>;

export const STORY_LABEL = "Sample run, scripted for this page";
export const STORY_GOAL = "Add a CSV export to the daily sales report";
/** One loop of the story, in ms (JEV motion.story_order loop s84). */
export const STORY_MS = 84_000;
/** The run budget the frame's meter counts against (the app's default). */
export const STORY_BUDGET = 400_000;

export interface CrewSpec {
  id: string;
  name: string;
  role: AgentRole;
  coat: string;
  seed: number;
}

// The studio crew: Oyen the CEO and five cats with Indonesian snack names,
// the same looks as the bundled demo run (apps/web/src/demo/fixture.ts).
export const CREW: CrewSpec[] = [
  { id: "oyen", name: "Oyen", role: "lead", coat: "ginger", seed: 1204 },
  { id: "cemong", name: "Cemong", role: "engineer", coat: "tuxedo", seed: 88213 },
  { id: "klepon", name: "Klepon", role: "designer", coat: "calico", seed: 5530 },
  { id: "tempe", name: "Tempe", role: "reviewer", coat: "gray", seed: 71002 },
  { id: "onde", name: "Onde", role: "qa", coat: "black", seed: 3319 },
  { id: "cilok", name: "Cilok", role: "security", coat: "siamese", seed: 90417 },
];

const ALL = CREW.map((c) => c.id);

/** Every card on the whiteboard, in the order Oyen deals them. */
export const PLAN: PlanCard[] = [
  { id: "p1", title: "Plan the export", status: "todo", ownerId: "oyen" },
  { id: "p2", title: "Write the CSV export", status: "todo", ownerId: "cemong" },
  { id: "p3", title: "Design the export button", status: "todo", ownerId: "klepon" },
  { id: "p4", title: "Review the export", status: "todo", ownerId: "tempe" },
  { id: "p5", title: "Test the CSV output", status: "todo", ownerId: "onde" },
  { id: "p6", title: "Scan the new route", status: "todo", ownerId: "cilok" },
];

/** The board when the loop opens: the plan is dealt and three cards are moving. */
export const OPENING_PLAN: Record<string, PlanStatus> = { p1: "done", p2: "doing", p3: "review", p4: "todo", p5: "doing", p6: "doing" };

type AgentPatch = Partial<Pick<OfficeAgent, "status" | "activity" | "mood" | "taskTitle" | "statusText" | "file">>;

/** Where the frame's camera looks: the whole desk row, the whiteboard, or the desks of some cats. */
export type ShotFocus = "wide" | "board" | readonly string[];

export interface StoryShot {
  focus: ShotFocus;
  /** ms after the step starts before the camera moves (a walk arriving first) */
  after?: number;
}

export type NoteTone = "success" | "info" | "warning";
export type NoteKind = "approve" | "ask" | "meeting" | "cache" | "handoff" | "review" | "tests" | "ship";

/** One notice in the frame's company feed, as the app shows it. */
export interface FeedNote {
  id: string;
  tone: NoteTone;
  kind: NoteKind;
  title: string;
  text: string;
  clock: string;
}

export interface StoryStep {
  /** Stable id of the scene. */
  id: string;
  /** Short name of the scene, one or two words. */
  scene: string;
  at: number;
  /** Office clock, shown in the frame. */
  clock: string;
  /** What just happened, in one sentence. */
  caption: string;
  agents?: Record<string, AgentPatch>;
  /** Clears the whiteboard before this step deals its cards (a new goal). */
  planReset?: boolean;
  /** Deals a card onto the whiteboard, or moves one already there. */
  plan?: Record<string, PlanStatus>;
  beats?: ScriptBeat[];
  meetingStart?: Omit<OfficeMeeting, "endedAt" | "notes">;
  meetingEnd?: { id: string; notes: string[] };
  shot: StoryShot;
  /** Notices the company feed receives when this step plays. */
  notes?: FeedNote[];
}

const work = (activity: Activity, statusText: string, file: string | null = null, status: AgentStatus = "working"): AgentPatch => ({
  status,
  activity,
  statusText,
  file,
});

export const STEPS: StoryStep[] = [
  {
    id: "desk",
    scene: "Desk work",
    at: 0,
    clock: "10:08",
    caption: "Every cat is at its own desk. Klepon carries the button sketch over to Cemong.",
    agents: {
      oyen: { ...work("plan", "Watching the board."), taskTitle: "Plan the export" },
      cemong: { ...work("code", "Writing export.ts", "src/report/export.ts"), taskTitle: "Write the CSV export" },
      klepon: { ...work("handoff", "Here is the button.", "src/ui/ExportButton.tsx"), taskTitle: "Design the export button" },
      tempe: { ...work("read", "Reading the old report.", "src/report/daily.ts"), taskTitle: "Review the export" },
      onde: { ...work("code", "Writing the CSV test.", "tests/report.test.ts"), taskTitle: "Test the CSV output" },
      cilok: { ...work("scan", "Scanning the route.", "src/report/route.ts"), taskTitle: "Scan the new route" },
    },
    plan: OPENING_PLAN,
    beats: [{ kind: "handoff", fromId: "klepon", toId: "cemong", taskTitle: "Design the export button" }],
    shot: { focus: "wide" },
  },
  {
    id: "question",
    scene: "Question",
    at: 7_000,
    clock: "10:14",
    caption: "Tempe walks over to ask Oyen a question.",
    agents: {
      klepon: work("design", "Polishing the icon.", "src/ui/ExportButton.tsx"),
      tempe: work("ask", "Review before the tests?", "src/report/daily.ts", "waiting"),
    },
    beats: [{ kind: "ask", fromId: "tempe", toId: "oyen", question: "Can I review the export before the tests run?" }],
    shot: { focus: ["oyen"], after: 2_600 },
    notes: [{ id: "ask", tone: "info", kind: "ask", title: "Tempe asks Oyen", text: "Can I review the export before the tests run?", clock: "10:14" }],
  },
  {
    id: "approval",
    scene: "Approval",
    at: 12_000,
    clock: "10:15",
    caption: "Oyen says yes on the spot. Nobody had to wake you.",
    agents: {
      oyen: work("think", "Yes, review first."),
      tempe: work("wait", "Review first, then.", null, "waiting"),
    },
    beats: [{ kind: "decided", byId: "oyen", toId: "tempe", approved: true, answer: "Yes, review it before the tests." }],
    shot: { focus: ["oyen"] },
    notes: [{ id: "approve", tone: "success", kind: "approve", title: "Oyen approved a request", text: "Tempe reviews the export before the tests run.", clock: "10:15" }],
  },
  {
    id: "handoff",
    scene: "Handoff",
    at: 17_000,
    clock: "10:22",
    caption: "Cemong carries the CSV export to Tempe for review.",
    agents: {
      cemong: work("handoff", "Export is ready, Tempe.", "src/report/export.ts"),
      tempe: work("wait", "Here it comes.", null, "waiting"),
    },
    plan: { p2: "review", p3: "done", p4: "doing" },
    beats: [{ kind: "handoff", fromId: "cemong", toId: "tempe", taskTitle: "Write the CSV export" }],
    shot: { focus: ["cemong", "tempe"], after: 1_200 },
    notes: [{ id: "handoff", tone: "info", kind: "handoff", title: "Cemong handed off a card", text: "Write the CSV export, to Tempe for review.", clock: "10:22" }],
  },
  {
    id: "review",
    scene: "Review",
    at: 24_000,
    clock: "10:25",
    caption: "Tempe sends it back: the header row is missing.",
    agents: {
      tempe: work("review", "No header row.", "src/report/export.ts"),
      cemong: { ...work("wait", "Fair. Fixing it.", "src/report/export.ts", "waiting"), mood: "frustrated" },
    },
    plan: { p2: "doing" },
    beats: [{ kind: "review", reviewerId: "tempe", ownerId: "cemong", passed: false, taskTitle: "Write the CSV export" }],
    shot: { focus: ["tempe"] },
    notes: [{ id: "review", tone: "warning", kind: "review", title: "Sent back by Tempe", text: "The CSV export has no header row.", clock: "10:25" }],
  },
  {
    id: "sync",
    scene: "Sync",
    at: 30_000,
    clock: "10:27",
    caption: "Oyen calls a quick sync at the whiteboard about the header row.",
    agents: {
      oyen: work("plan", "Quick sync."),
      cemong: work("think", "Which columns?", null, "thinking"),
      tempe: work("think", "Date first.", null, "thinking"),
      klepon: work("think", "Button label?", null, "thinking"),
    },
    meetingStart: {
      id: "sync",
      kind: "sync",
      title: "Header row sync",
      agentIds: ["oyen", "cemong", "tempe", "klepon"],
      agenda: ["The missing header row", "Column names", "Label for the button"],
    },
    shot: { focus: "board", after: 2_400 },
    notes: [{ id: "sync", tone: "info", kind: "meeting", title: "Meeting starting", text: "Header row sync at the whiteboard, 4 cats.", clock: "10:27" }],
  },
  {
    id: "fix",
    scene: "Fix",
    at: 39_000,
    clock: "10:34",
    caption: "Cemong adds the header row. Tempe passes it this time.",
    meetingEnd: { id: "sync", notes: ["Header row: date, item, qty, total", "The button says Export CSV"] },
    agents: {
      cemong: { ...work("code", "Header row added.", "src/report/export.ts"), mood: "focused" },
      tempe: work("review", "Looks good now.", "src/report/export.ts"),
      klepon: work("design", "Export CSV it is.", "src/ui/ExportButton.tsx"),
      oyen: work("plan", "Moving the card."),
    },
    plan: { p2: "done", p4: "done" },
    beats: [{ kind: "review", reviewerId: "tempe", ownerId: "cemong", passed: true, taskTitle: "Write the CSV export" }],
    shot: { focus: "wide" },
    notes: [{ id: "pass", tone: "success", kind: "review", title: "Review passed", text: "Tempe passed the CSV export on round two.", clock: "10:34" }],
  },
  {
    id: "tests",
    scene: "Tests",
    at: 45_000,
    clock: "10:40",
    caption: "Onde runs the tests on the new export.",
    agents: {
      onde: work("run", "Running 14 tests.", "tests/report.test.ts"),
      cilok: work("scan", "Scan is clean.", "src/report/route.ts"),
    },
    plan: { p6: "done" },
    shot: { focus: ["onde"], after: 600 },
  },
  {
    id: "coffee",
    scene: "Coffee",
    at: 51_000,
    clock: "10:44",
    caption: "All 14 tests pass. Cemong and Klepon take a coffee.",
    agents: {
      onde: { ...work("celebrate", "14 of 14 pass.", "tests/report.test.ts"), mood: "proud" },
      cemong: { ...work("rest", "Coffee break.", null, "idle"), taskTitle: null, mood: "calm" },
      klepon: { ...work("rest", "Coffee break.", null, "idle"), taskTitle: null, mood: "calm" },
    },
    plan: { p5: "done" },
    shot: { focus: "wide" },
    notes: [
      { id: "tests", tone: "success", kind: "tests", title: "14 of 14 tests pass", text: "Onde ran tests/report.test.ts.", clock: "10:44" },
      { id: "cache", tone: "success", kind: "cache", title: "Tokens saved", text: "10,299 of 12,102 prompt tokens came from your provider's cache.", clock: "10:44" },
    ],
  },
  {
    id: "wrapup",
    scene: "Wrap-up",
    at: 57_000,
    clock: "10:50",
    caption: "Wrap-up at the board. Cilok's scan is clean and every card is done.",
    agents: {
      oyen: work("plan", "What shipped today?"),
      cilok: work("think", "Scan is clean.", null, "thinking"),
      onde: work("think", "Tests are green.", null, "thinking"),
      tempe: work("think", "Reviewed twice.", null, "thinking"),
      cemong: work("think", "Export is in.", null, "thinking"),
      klepon: work("think", "Button is in.", null, "thinking"),
    },
    plan: { p1: "done" },
    meetingStart: {
      id: "wrapup",
      kind: "wrapup",
      title: "Wrap-up",
      agentIds: ALL,
      agenda: ["What shipped", "What Oyen reports to you"],
    },
    shot: { focus: "board", after: 2_400 },
  },
  {
    id: "celebrate",
    scene: "Celebrate",
    at: 65_000,
    clock: "10:52",
    caption: "Shipped. The crew celebrates and Oyen writes your report.",
    meetingEnd: { id: "wrapup", notes: ["CSV export shipped with tests", "Report goes to you"] },
    agents: {
      oyen: { ...work("plan", "Writing your report."), mood: "proud" },
      cemong: { ...work("celebrate", "Shipped.", null, "done"), mood: "proud" },
      klepon: { ...work("celebrate", "Shipped.", null, "done"), mood: "proud" },
      tempe: { ...work("celebrate", "Shipped.", null, "done"), mood: "proud" },
      onde: { ...work("celebrate", "Shipped.", null, "done"), mood: "proud" },
      cilok: { ...work("celebrate", "Shipped.", null, "done"), mood: "proud" },
    },
    beats: [{ kind: "celebrate", agentIds: ALL }],
    shot: { focus: "wide" },
    notes: [{ id: "ship", tone: "success", kind: "ship", title: "Goal shipped", text: "The CSV export is live, with tests. Oyen's report is on its way.", clock: "10:52" }],
  },
  {
    id: "kickoff",
    scene: "Kickoff",
    at: 71_000,
    clock: "11:00",
    caption: "The next goal. Oyen reads it to the crew at the whiteboard.",
    agents: {
      oyen: { ...work("plan", "Here is the next goal."), taskTitle: null, mood: "focused" },
      cemong: { ...work("think", "Listening.", null, "thinking"), taskTitle: null, mood: "focused" },
      klepon: { ...work("think", "Listening.", null, "thinking"), taskTitle: null, mood: "focused" },
      tempe: { ...work("think", "Listening.", null, "thinking"), taskTitle: null, mood: "focused" },
      onde: { ...work("think", "Listening.", null, "thinking"), taskTitle: null, mood: "focused" },
      cilok: { ...work("think", "Listening.", null, "thinking"), taskTitle: null, mood: "focused" },
    },
    planReset: true,
    meetingStart: {
      id: "kickoff",
      kind: "kickoff",
      title: "Kickoff",
      agentIds: ALL,
      agenda: ["Read the goal", "Who takes which card", "What needs a review"],
    },
    shot: { focus: "board", after: 2_400 },
    notes: [{ id: "kickoff", tone: "info", kind: "meeting", title: "Meeting starting", text: "Kickoff for the next goal, all 6 cats.", clock: "11:00" }],
  },
  {
    id: "plan",
    scene: "Plan",
    at: 79_000,
    clock: "11:05",
    caption: "Oyen deals the plan onto the whiteboard: six cards, one owner each.",
    meetingEnd: { id: "kickoff", notes: ["Cemong writes the code first", "Tempe reviews before the tests run"] },
    agents: { oyen: { ...work("plan", "Six cards on the board."), taskTitle: "Plan the export" } },
    plan: { p1: "doing", p2: "todo", p3: "todo", p4: "todo", p5: "todo", p6: "todo" },
    beats: [{ kind: "deliver", fromId: "oyen", taskTitle: "Plan the export" }],
    shot: { focus: "board" },
  },
];

/** The step the story opens on: desk work, the company already at work (critic fix, round 2). */
export const START_STEP = 0;
/** The step shown as a still under reduced motion: the same desk work. */
export const POSTER_STEP = 0;

/**
 * What the feed already holds when the frame opens: the three latest
 * notices of the morning (a CEO approval, a meeting, tokens saved), dealt
 * in on a stagger when the frame settles.
 */
export const OPENING_NOTES: FeedNote[] = [
  { id: "open-cache", tone: "success", kind: "cache", title: "Tokens saved", text: "9,850 of 11,420 prompt tokens came from your provider's cache.", clock: "10:07" },
  { id: "open-meeting", tone: "info", kind: "meeting", title: "Kickoff ended", text: "6 cats agreed who takes which card. Minutes saved.", clock: "10:05" },
  { id: "open-approve", tone: "success", kind: "approve", title: "Oyen approved a request", text: "Onde may add a CSV fixture under tests.", clock: "10:04" },
];

/** The newest notices the feed shows at once. */
export const FEED_SIZE = 3;

/** The feed after steps 0..index have played: newest first, at most FEED_SIZE. */
export function feedAt(index: number): FeedNote[] {
  const last = Math.max(0, Math.min(index, STEPS.length - 1));
  let feed = [...OPENING_NOTES];
  for (let i = 0; i <= last; i++) {
    for (const n of STEPS[i]!.notes ?? []) feed = [n, ...feed.filter((x) => x.id !== n.id)];
  }
  return feed.slice(0, FEED_SIZE);
}

/** The crew as the scene first sees it: seated at their desks, before the first step's patch. */
function initialAgents(): OfficeAgent[] {
  return CREW.map((c) => ({
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
  }));
}

export interface SceneState {
  agents: OfficeAgent[];
  meetings: OfficeMeeting[];
  plan: PlanCard[];
  step: StoryStep;
  /** cards done, of all on the board */
  done: number;
  total: number;
  /** cats working or thinking, of the crew */
  atWork: number;
  /** tokens of the run budget used so far */
  tokens: number;
}

/** Share of the run budget used at a time into the loop: the day uses most of it. */
export function energyAt(ms: number): number {
  return Math.round((0.08 + 0.72 * Math.min(1, Math.max(0, ms / STORY_MS))) * 100) / 100;
}

/** Tokens used at a time into the loop, on the frame's budget meter (to the nearest hundred). */
export function tokensAt(ms: number): number {
  return Math.round((energyAt(ms) * STORY_BUDGET) / 100) * 100;
}

/** The scene after steps 0..index have played. Pure. */
export function sceneAt(index: number): SceneState {
  const last = Math.max(0, Math.min(index, STEPS.length - 1));
  let agents = initialAgents();
  let status = new Map<string, PlanStatus>();
  let meetings: OfficeMeeting[] = [];
  for (let i = 0; i <= last; i++) {
    const s = STEPS[i]!;
    if (s.agents) {
      const patch = s.agents;
      agents = agents.map((a) => (patch[a.id] ? { ...a, ...patch[a.id] } : a));
    }
    if (s.planReset) status = new Map();
    for (const [id, next] of Object.entries(s.plan ?? {})) status.set(id, next);
    if (s.meetingStart) meetings = [...meetings.filter((m) => m.id !== s.meetingStart!.id), { ...s.meetingStart, endedAt: null, notes: [] }];
    if (s.meetingEnd) {
      const end = s.meetingEnd;
      meetings = meetings.map((m) => (m.id === end.id ? { ...m, endedAt: s.at, notes: end.notes } : m));
    }
  }
  const step = STEPS[last]!;
  const energy = energyAt(step.at);
  agents = agents.map((a) => ({ ...a, energy }));
  const plan = PLAN.filter((p) => status.has(p.id)).map((p) => ({ ...p, status: status.get(p.id)! }));
  const atWork = agents.filter((a) => a.status === "working" || a.status === "thinking").length;
  return { agents, meetings, plan, step, done: plan.filter((p) => p.status === "done").length, total: plan.length, atWork, tokens: tokensAt(step.at) };
}

/** The index of the step playing at `ms` into the loop. */
export function stepAt(ms: number): number {
  const t = ((ms % STORY_MS) + STORY_MS) % STORY_MS;
  let index = 0;
  for (let i = 0; i < STEPS.length; i++) if (STEPS[i]!.at <= t) index = i;
  return index;
}

/** Beats with ids that stay unique across plays (every loop and every jump is a new play). */
export function beatsFor(index: number, play: number): OfficeBeat[] {
  return (STEPS[index]?.beats ?? []).map((b, j) => ({ ...b, id: `p${play}-s${index}-b${j}` }) as OfficeBeat);
}

/** The hour an office clock reads ("10:08" is 10.13), so the windows show the story's own daylight. */
export function hourOf(clock: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!m) return 12;
  return Math.min(24, Math.max(0, Number(m[1]) + Number(m[2]) / 60));
}

/** Accessible summary of the scene at one step. */
export function sceneLabel(step: StoryStep): string {
  return `${STORY_LABEL}. ${step.clock}. ${step.caption}`;
}
