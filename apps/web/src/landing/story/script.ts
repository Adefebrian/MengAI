// The hero story: a scripted morning in the cat company, played by the
// Office scene (@mengai/cats, office-contract.ts) in its hero variant. It is
// a sample written for this page, never a recording, and the page says so.
//
// The concept (JEV imm.concept n1, "Opening move"): the company is already
// at work when the page opens. Within the first two seconds Mochi stands up
// and carries the CSV export to Tempe's desk; then Onde asks Kopi, the CEO
// cat, a question and Kopi approves it on the spot, the crew meets at the
// table, goes back to their desks, and the day ends with every card done.
//
// Pure data plus two pure functions, so the timeline is tested without a
// browser: sceneAt(i) folds the steps up to i into the scene props, and
// stepAt(ms) finds the step playing at a time into the loop.
import type { OfficeAgent, OfficeBeat, OfficeMeeting, OfficeProps } from "@mengai/cats";
import type { Activity, AgentRole, AgentStatus } from "@mengai/shared";

export type PlanCard = NonNullable<OfficeProps["plan"]>[number];
export type PlanStatus = PlanCard["status"];
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
/** A beat as the script writes it; the player gives it a unique id per loop. */
export type ScriptBeat = WithoutId<OfficeBeat>;

export const STORY_LABEL = "Sample story, scripted for this page";
export const STORY_GOAL = "Add a CSV export to the daily sales report, with tests";
/** One loop of the story, in ms. */
export const STORY_MS = 40_000;
/** The step shown under reduced motion: the handoff, the concept's poster. */
export const POSTER_STEP = 0;

interface CrewSpec {
  id: string;
  name: string;
  role: AgentRole;
  coat: string;
  seed: number;
}

// The same crew as the bundled demo run (apps/web/src/demo/fixture.ts), so
// the landing and the app introduce the same cats.
export const CREW: CrewSpec[] = [
  { id: "kopi", name: "Kopi", role: "lead", coat: "ginger", seed: 1204 },
  { id: "mochi", name: "Mochi", role: "engineer", coat: "tuxedo", seed: 88213 },
  { id: "klepon", name: "Klepon", role: "designer", coat: "calico", seed: 5530 },
  { id: "tempe", name: "Tempe", role: "reviewer", coat: "gray", seed: 71002 },
  { id: "onde", name: "Onde", role: "qa", coat: "black", seed: 3319 },
  { id: "cilok", name: "Cilok", role: "security", coat: "siamese", seed: 90417 },
];

export const PLAN: PlanCard[] = [
  { id: "p1", title: "Plan the export", status: "done", ownerId: "kopi" },
  { id: "p2", title: "Write the CSV export", status: "doing", ownerId: "mochi" },
  { id: "p3", title: "Design the export button", status: "doing", ownerId: "klepon" },
  { id: "p4", title: "Review the export", status: "todo", ownerId: "tempe" },
  { id: "p5", title: "Test the CSV output", status: "todo", ownerId: "onde" },
  { id: "p6", title: "Scan the new route", status: "todo", ownerId: "cilok" },
];

/** The kickoff that ran at 10:00, before the page opens on the story. */
export const KICKOFF: OfficeMeeting = {
  id: "kickoff-1",
  kind: "kickoff",
  title: "Kickoff",
  agentIds: ["kopi", "mochi", "klepon", "tempe", "onde", "cilok"],
  agenda: ["Read the goal", "Who takes which task", "What needs a review"],
  endedAt: 0,
  notes: ["Mochi writes the export first", "Tempe reviews before the tests run"],
};

type AgentPatch = Partial<Pick<OfficeAgent, "status" | "activity" | "mood" | "energy" | "taskTitle" | "statusText" | "file">>;

export interface StoryStep {
  at: number;
  /** Office clock, shown beside the caption. */
  clock: string;
  /** What just happened, in one sentence. */
  caption: string;
  agents?: Record<string, AgentPatch>;
  plan?: Record<string, PlanStatus>;
  beats?: ScriptBeat[];
  meetingStart?: Omit<OfficeMeeting, "endedAt" | "notes">;
  meetingEnd?: { id: string; notes: string[] };
}

const work = (activity: Activity, statusText: string, file: string | null, status: AgentStatus = "working"): AgentPatch => ({
  status,
  activity,
  statusText,
  file,
});

export const STEPS: StoryStep[] = [
  {
    at: 0,
    clock: "10:02",
    caption: "Mochi carries the CSV export to Tempe for review.",
    agents: {
      mochi: { ...work("handoff", "Export is ready, Tempe.", "src/report/export.ts"), taskTitle: "Write the CSV export" },
      tempe: { ...work("wait", "Waiting for the export.", null, "waiting"), taskTitle: "Review the export" },
    },
    plan: { p2: "review", p4: "doing" },
    beats: [{ kind: "handoff", fromId: "mochi", toId: "tempe", taskTitle: "Write the CSV export" }],
  },
  {
    at: 3_200,
    clock: "10:05",
    caption: "Tempe reads the change at the desk. Mochi takes a coffee.",
    agents: {
      tempe: work("review", "Reading export.ts", "src/report/export.ts"),
      mochi: { ...work("rest", "Coffee while Tempe reads.", null, "idle"), taskTitle: null },
    },
  },
  {
    at: 6_400,
    clock: "10:09",
    caption: "Onde walks over to ask Kopi a question.",
    agents: { onde: work("ask", "Can I add a CSV fixture?", "tests/report.test.ts", "waiting") },
    beats: [{ kind: "ask", fromId: "onde", toId: "kopi", question: "Can I add a CSV fixture under tests?" }],
  },
  {
    at: 9_600,
    clock: "10:11",
    caption: "Kopi approves it on the spot. Nobody had to wake you.",
    agents: {
      kopi: work("think", "Approved.", null),
      onde: work("code", "Adding the fixture.", "tests/fixtures/sales.csv"),
    },
    beats: [{ kind: "decided", byId: "kopi", toId: "onde", approved: true, answer: "Yes, keep it under tests/fixtures." }],
  },
  {
    at: 13_000,
    clock: "10:16",
    caption: "Tempe passes the export and its card moves to done.",
    agents: {
      tempe: work("review", "Looks good to me.", "src/report/export.ts"),
      kopi: work("plan", "Moving the card.", null),
    },
    plan: { p2: "done", p4: "done", p5: "doing" },
    beats: [{ kind: "review", reviewerId: "tempe", ownerId: "mochi", passed: true, taskTitle: "Write the CSV export" }],
  },
  {
    at: 16_400,
    clock: "10:20",
    caption: "Kopi calls a sync. The crew walks to the meeting table.",
    agents: {
      kopi: work("plan", "Where are we?", null),
      mochi: work("think", "Export passed.", null),
      klepon: work("think", "Button label?", null),
      onde: work("think", "Fixture is in.", null),
    },
    meetingStart: {
      id: "sync-1",
      kind: "sync",
      title: "Export sync",
      agentIds: ["kopi", "mochi", "klepon", "onde"],
      agenda: ["Export passed review", "Label for the button", "The new test fixture"],
    },
  },
  {
    at: 24_000,
    clock: "10:34",
    caption: "Back at their desks with two decisions from the sync.",
    agents: {
      mochi: { ...work("code", "Wiring the button.", "src/report/route.ts"), taskTitle: "Write the CSV export" },
      klepon: work("design", "Export CSV it is.", "src/ui/ExportButton.tsx"),
      onde: work("run", "Running the tests.", "tests/report.test.ts"),
      kopi: work("plan", "Watching the plan.", null),
    },
    meetingEnd: { id: "sync-1", notes: ["The button says Export CSV", "Onde runs the tests next"] },
  },
  {
    at: 27_600,
    clock: "10:38",
    caption: "Klepon delivers the export button.",
    agents: { klepon: work("handoff", "Button is done.", "src/ui/ExportButton.tsx") },
    plan: { p3: "done" },
    beats: [{ kind: "deliver", fromId: "klepon", taskTitle: "Design the export button" }],
  },
  {
    at: 30_800,
    clock: "10:45",
    caption: "Onde's tests pass. Cilok scans the new route.",
    agents: {
      onde: work("celebrate", "All tests pass.", "tests/report.test.ts"),
      cilok: work("scan", "No secrets in the diff.", "src/report/route.ts"),
      klepon: { ...work("rest", "Coffee break.", null, "idle"), taskTitle: null },
    },
    plan: { p5: "done", p6: "doing" },
  },
  {
    at: 34_000,
    clock: "10:52",
    caption: "Every card is done. Kopi writes your report.",
    agents: {
      cilok: work("rest", "Scan is clean.", null, "done"),
      kopi: work("plan", "Writing your report.", null),
    },
    plan: { p6: "done" },
    beats: [{ kind: "celebrate", agentIds: ["kopi", "mochi", "klepon", "tempe", "onde", "cilok"] }],
  },
];

/** The crew as the scene first sees it at 10:00. */
function initialAgents(): OfficeAgent[] {
  const desk: Record<string, AgentPatch> = {
    kopi: { ...work("plan", "Watching the plan.", null), taskTitle: "Plan the export" },
    mochi: { ...work("code", "Finishing the export.", "src/report/export.ts"), taskTitle: "Write the CSV export" },
    klepon: { ...work("design", "Drawing the button.", "src/ui/ExportButton.tsx"), taskTitle: "Design the export button" },
    tempe: { ...work("wait", "Waiting for work.", null, "waiting"), taskTitle: "Review the export" },
    onde: { ...work("read", "Reading the tests.", "tests/report.test.ts"), taskTitle: "Test the CSV output" },
    cilok: { ...work("read", "Reading the route.", "src/report/route.ts"), taskTitle: "Scan the new route" },
  };
  return CREW.map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role,
    look: { coat: c.coat, seed: c.seed },
    status: "working",
    activity: "rest",
    mood: "focused",
    energy: 0.3,
    parentId: c.role === "lead" ? null : "kopi",
    taskTitle: null,
    statusText: null,
    file: null,
    ...desk[c.id],
  }));
}

export interface SceneState {
  agents: OfficeAgent[];
  meetings: OfficeMeeting[];
  plan: PlanCard[];
  step: StoryStep;
}

/** The scene after steps 0..index have played. Pure. */
export function sceneAt(index: number): SceneState {
  const last = Math.max(0, Math.min(index, STEPS.length - 1));
  let agents = initialAgents();
  let plan = PLAN.map((p) => ({ ...p }));
  let meetings: OfficeMeeting[] = [KICKOFF];
  for (let i = 0; i <= last; i++) {
    const s = STEPS[i]!;
    if (s.agents) {
      const patch = s.agents;
      agents = agents.map((a) => (patch[a.id] ? { ...a, ...patch[a.id] } : a));
    }
    if (s.plan) {
      const next = s.plan;
      plan = plan.map((p) => (next[p.id] ? { ...p, status: next[p.id]! } : p));
    }
    if (s.meetingStart) meetings = [...meetings, { ...s.meetingStart, endedAt: null, notes: [] }];
    if (s.meetingEnd) {
      const end = s.meetingEnd;
      meetings = meetings.map((m) => (m.id === end.id ? { ...m, endedAt: s.at, notes: end.notes } : m));
    }
  }
  return { agents, meetings, plan, step: STEPS[last]! };
}

/** The index of the step playing at `ms` into the loop. */
export function stepAt(ms: number): number {
  const t = ((ms % STORY_MS) + STORY_MS) % STORY_MS;
  let index = 0;
  for (let i = 0; i < STEPS.length; i++) if (STEPS[i]!.at <= t) index = i;
  return index;
}

/** Beats with ids that stay unique across loops. */
export function beatsFor(index: number, loop: number): OfficeBeat[] {
  return (STEPS[index]?.beats ?? []).map((b, j) => ({ ...b, id: `l${loop}-s${index}-b${j}` }) as OfficeBeat);
}

/** Accessible summary of the scene at one step. */
export function sceneLabel(step: StoryStep): string {
  return `${STORY_LABEL}. ${step.clock}. ${step.caption}`;
}
