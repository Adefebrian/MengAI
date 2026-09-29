// The hero story: a scripted morning in the cat company, played by the
// Office scene (@mengai/cats, office-contract.ts) in its hero variant. It is
// a sample written for this page, never a recording, and the page says so.
//
// One loop plays every scenario the company runs, in the order of a real
// day (JEV motion.story_order: kickoff_first 0.48, loop s84 0.59, poster
// coding 0.99): the kickoff at the easel, the plan dealt onto the
// whiteboard, the crew coding at their own desks, a question walked to
// Oyen and approved on the spot, a handoff carry, a review bounce and the
// sync about it, the fix passing review, the tests, a coffee break, the
// wrap-up and the celebration. The first beat (the crew walking to the
// kickoff) lands in the first second, so the page still opens on the
// company at work (JEV imm.concept n1, "Opening move").
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

export const STORY_LABEL = "Sample story, scripted for this page";
export const STORY_GOAL = "Add a CSV export to the daily sales report, with tests";
/** One loop of the story, in ms (JEV motion.story_order loop s84). */
export const STORY_MS = 84_000;

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

/** Every card Oyen can deal; a card is on the whiteboard once a step deals it. */
export const PLAN: PlanCard[] = [
  { id: "p1", title: "Plan the export", status: "todo", ownerId: "oyen" },
  { id: "p2", title: "Write the CSV export", status: "todo", ownerId: "cemong" },
  { id: "p3", title: "Design the export button", status: "todo", ownerId: "klepon" },
  { id: "p4", title: "Review the export", status: "todo", ownerId: "tempe" },
  { id: "p5", title: "Test the CSV output", status: "todo", ownerId: "onde" },
  { id: "p6", title: "Scan the new route", status: "todo", ownerId: "cilok" },
];

type AgentPatch = Partial<Pick<OfficeAgent, "status" | "activity" | "mood" | "taskTitle" | "statusText" | "file">>;

export interface StoryStep {
  /** Stable id of the scene, used by the chapter list. */
  id: string;
  /** Short name of the scene, one or two words, shown as a chapter. */
  scene: string;
  at: number;
  /** Office clock, shown beside the caption. */
  clock: string;
  /** What just happened, in one sentence. */
  caption: string;
  agents?: Record<string, AgentPatch>;
  /** Deals a card onto the whiteboard, or moves one already there. */
  plan?: Record<string, PlanStatus>;
  beats?: ScriptBeat[];
  meetingStart?: Omit<OfficeMeeting, "endedAt" | "notes">;
  meetingEnd?: { id: string; notes: string[] };
}

const work = (activity: Activity, statusText: string, file: string | null = null, status: AgentStatus = "working"): AgentPatch => ({
  status,
  activity,
  statusText,
  file,
});

export const STEPS: StoryStep[] = [
  {
    id: "kickoff",
    scene: "Kickoff",
    at: 0,
    clock: "10:00",
    caption: "Kickoff. Oyen reads your goal to the crew at the whiteboard.",
    agents: {
      oyen: work("plan", "Here is the goal."),
      cemong: work("think", "Listening.", null, "thinking"),
      klepon: work("think", "Listening.", null, "thinking"),
      tempe: work("think", "Listening.", null, "thinking"),
      onde: work("think", "Listening.", null, "thinking"),
      cilok: work("think", "Listening.", null, "thinking"),
    },
    meetingStart: {
      id: "kickoff",
      kind: "kickoff",
      title: "Kickoff",
      agentIds: ALL,
      agenda: ["Read the goal", "Who takes which card", "What needs a review"],
    },
  },
  {
    id: "plan",
    scene: "Plan",
    at: 8_000,
    clock: "10:05",
    caption: "Oyen deals the plan onto the whiteboard: six cards, one owner each.",
    meetingEnd: { id: "kickoff", notes: ["Cemong writes the export first", "Tempe reviews before the tests run"] },
    agents: { oyen: { ...work("plan", "Six cards on the board."), taskTitle: "Plan the export" } },
    plan: { p1: "done", p2: "todo", p3: "todo", p4: "todo", p5: "todo", p6: "todo" },
    beats: [{ kind: "deliver", fromId: "oyen", taskTitle: "Plan the export" }],
  },
  {
    id: "coding",
    scene: "Coding",
    at: 14_000,
    clock: "10:08",
    caption: "Every cat takes its card and gets to work at its own desk.",
    agents: {
      oyen: work("plan", "Watching the plan."),
      cemong: { ...work("code", "Writing export.ts", "src/report/export.ts"), taskTitle: "Write the CSV export" },
      klepon: { ...work("design", "Drawing the button.", "src/ui/ExportButton.tsx"), taskTitle: "Design the export button" },
      tempe: { ...work("wait", "Waiting for the export.", null, "waiting"), taskTitle: "Review the export" },
      onde: { ...work("read", "Reading the old tests.", "tests/report.test.ts"), taskTitle: "Test the CSV output" },
      cilok: { ...work("read", "Reading the route.", "src/report/route.ts"), taskTitle: "Scan the new route" },
    },
    plan: { p2: "doing", p3: "doing" },
  },
  {
    id: "question",
    scene: "Question",
    at: 20_000,
    clock: "10:14",
    caption: "Onde walks over to ask Oyen a question.",
    agents: { onde: work("ask", "Can I add a CSV fixture?", "tests/report.test.ts", "waiting") },
    beats: [{ kind: "ask", fromId: "onde", toId: "oyen", question: "Can I add a CSV fixture under tests?" }],
  },
  {
    id: "approval",
    scene: "Approval",
    at: 25_000,
    clock: "10:15",
    caption: "Oyen approves it on the spot. Nobody had to wake you.",
    agents: {
      oyen: work("think", "Approved."),
      onde: work("code", "Adding the fixture.", "tests/fixtures/sales.csv"),
    },
    plan: { p5: "doing" },
    beats: [{ kind: "decided", byId: "oyen", toId: "onde", approved: true, answer: "Yes, keep it under tests/fixtures." }],
  },
  {
    id: "handoff",
    scene: "Handoff",
    at: 30_000,
    clock: "10:22",
    caption: "Cemong carries the CSV export to Tempe for review.",
    agents: {
      cemong: work("handoff", "Export is ready, Tempe.", "src/report/export.ts"),
      tempe: work("wait", "Here it comes.", null, "waiting"),
    },
    plan: { p2: "review", p4: "doing" },
    beats: [{ kind: "handoff", fromId: "cemong", toId: "tempe", taskTitle: "Write the CSV export" }],
  },
  {
    id: "review",
    scene: "Review",
    at: 37_000,
    clock: "10:25",
    caption: "Tempe sends it back: the header row is missing.",
    agents: {
      tempe: work("review", "No header row.", "src/report/export.ts"),
      cemong: { ...work("wait", "Fair. Fixing it.", "src/report/export.ts", "waiting"), mood: "frustrated" },
    },
    plan: { p2: "doing" },
    beats: [{ kind: "review", reviewerId: "tempe", ownerId: "cemong", passed: false, taskTitle: "Write the CSV export" }],
  },
  {
    id: "sync",
    scene: "Sync",
    at: 43_000,
    clock: "10:27",
    caption: "Oyen calls a sync about the header row.",
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
  },
  {
    id: "fix",
    scene: "Fix",
    at: 52_000,
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
  },
  {
    id: "tests",
    scene: "Tests",
    at: 58_000,
    clock: "10:40",
    caption: "Onde runs the tests. Klepon pins the finished button to the board.",
    agents: {
      onde: work("run", "Running 14 tests.", "tests/report.test.ts"),
      klepon: work("handoff", "Button is done.", "src/ui/ExportButton.tsx"),
      cilok: work("scan", "Scanning the route.", "src/report/route.ts"),
    },
    plan: { p3: "done", p6: "doing" },
    beats: [{ kind: "deliver", fromId: "klepon", taskTitle: "Design the export button" }],
  },
  {
    id: "coffee",
    scene: "Coffee",
    at: 64_000,
    clock: "10:44",
    caption: "All 14 tests pass. Cemong and Klepon take a coffee.",
    agents: {
      onde: { ...work("celebrate", "14 of 14 pass.", "tests/report.test.ts"), mood: "proud" },
      cemong: { ...work("rest", "Coffee break.", null, "idle"), taskTitle: null, mood: "calm" },
      klepon: { ...work("rest", "Coffee break.", null, "idle"), taskTitle: null, mood: "calm" },
    },
    plan: { p5: "done" },
  },
  {
    id: "wrapup",
    scene: "Wrap-up",
    at: 70_000,
    clock: "10:50",
    caption: "Wrap-up. Cilok's scan is clean and every card is done.",
    agents: {
      oyen: work("plan", "What shipped today?"),
      cilok: work("think", "Scan is clean.", null, "thinking"),
      onde: work("think", "Tests are green.", null, "thinking"),
      tempe: work("think", "Reviewed twice.", null, "thinking"),
      cemong: work("think", "Export is in.", null, "thinking"),
      klepon: work("think", "Button is in.", null, "thinking"),
    },
    plan: { p6: "done" },
    meetingStart: {
      id: "wrapup",
      kind: "wrapup",
      title: "Wrap-up",
      agentIds: ALL,
      agenda: ["What shipped", "What Oyen reports to you"],
    },
  },
  {
    id: "celebrate",
    scene: "Celebrate",
    at: 78_000,
    clock: "10:52",
    caption: "The crew celebrates. Oyen writes your report.",
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
  },
];

/** The step the story opens on: the kickoff (JEV motion.story_order kickoff_first). */
export const START_STEP = 0;
/** The step shown as a still under reduced motion (JEV motion.story_order poster coding 0.99). */
export const POSTER_STEP = STEPS.findIndex((s) => s.id === "coding");

/** The crew as the scene first sees it at 10:00, at their desks before the kickoff. */
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
}

/** Share of the run budget used at a time into the loop: the day uses most of it. */
export function energyAt(ms: number): number {
  return Math.round((0.08 + 0.72 * Math.min(1, Math.max(0, ms / STORY_MS))) * 100) / 100;
}

/** The scene after steps 0..index have played. Pure. */
export function sceneAt(index: number): SceneState {
  const last = Math.max(0, Math.min(index, STEPS.length - 1));
  let agents = initialAgents();
  const status = new Map<string, PlanStatus>();
  let meetings: OfficeMeeting[] = [];
  for (let i = 0; i <= last; i++) {
    const s = STEPS[i]!;
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
  }
  const step = STEPS[last]!;
  const energy = energyAt(step.at);
  agents = agents.map((a) => ({ ...a, energy }));
  const plan = PLAN.filter((p) => status.has(p.id)).map((p) => ({ ...p, status: status.get(p.id)! }));
  return { agents, meetings, plan, step };
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

/** Accessible summary of the scene at one step. */
export function sceneLabel(step: StoryStep): string {
  return `${STORY_LABEL}. ${step.clock}. ${step.caption}`;
}
