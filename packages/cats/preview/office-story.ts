// The /office preview's scripted story: a pure function of the time into
// the loop, so every run of the page plays the same company day. Kopi (the
// CEO cat) hands the settings form to Mochi, Tempe asks Kopi for a dev
// dependency and gets a yes, Onde returns the form, Serabi takes a coffee,
// the crew holds a sync, Onde passes the fix, Mochi pins it to the board,
// Klepon hands over the empty state art, Bakpao asks about a leaked test key
// and hears "the owner decides", everyone meets for the wrap-up, then the
// crew celebrates. Sample content for the preview only.
import type { Activity, AgentRole, AgentStatus, Coat, MeetingKind, Mood } from "@mengai/shared";
import type { OfficeAgent, OfficeBeat, OfficeMeeting, OfficeProps } from "../src/office-contract";

export const LOOP_S = 118;

interface Member {
  id: string;
  name: string;
  role: AgentRole;
  coat: Coat;
  seed: number;
}

export const OFFICE_CREW: Member[] = [
  { id: "kopi", name: "Kopi", role: "lead", coat: "black", seed: 1187 },
  { id: "mochi", name: "Mochi", role: "engineer", coat: "cream", seed: 2291 },
  { id: "onde", name: "Onde", role: "reviewer", coat: "gray", seed: 5519 },
  { id: "tempe", name: "Tempe", role: "qa", coat: "tabby", seed: 3373 },
  { id: "klepon", name: "Klepon", role: "designer", coat: "calico", seed: 4447 },
  { id: "cilok", name: "Cilok", role: "researcher", coat: "ginger", seed: 6607 },
  { id: "bakpao", name: "Bakpao", role: "security", coat: "siamese", seed: 7703 },
  { id: "serabi", name: "Serabi", role: "operator", coat: "tuxedo", seed: 8849 },
  { id: "lumpia", name: "Lumpia", role: "engineer", coat: "ginger", seed: 9161 },
  { id: "wingko", name: "Wingko", role: "qa", coat: "cream", seed: 1033 },
  { id: "dodol", name: "Dodol", role: "designer", coat: "tabby", seed: 2477 },
  { id: "gethuk", name: "Gethuk", role: "researcher", coat: "gray", seed: 3719 },
];

export const CREW_SIZES = [4, 8, 12] as const;
export type CrewSize = (typeof CREW_SIZES)[number];

type Seg = [t: number, status: AgentStatus, activity: Activity, text: string | null, task: string | null, file: string | null, mood?: Mood];

const FORM = "Build the settings form";
const ART = "Empty state art";

const SCRIPT: Record<string, Seg[]> = {
  kopi: [
    [0, "working", "plan", "Splitting the goal into tasks", "Ship the settings page", "plan.md", "focused"],
    [2, "working", "handoff", "Handing the form to Mochi", "Ship the settings page", "plan.md"],
    [9, "working", "review", "Checking on the crew", "Ship the settings page", "plan.md"],
    [11, "thinking", "think", "Tempe wants a dev dependency", "Ship the settings page", "plan.md"],
    [16, "working", "plan", "Updating the plan", "Ship the settings page", "plan.md", "focused"],
    [54, "working", "plan", "Planning the fix", "Ship the settings page", "plan.md"],
    [76, "thinking", "think", "A key rotation is the owner's call", "Ship the settings page", "plan.md"],
    [84, "working", "review", "Getting ready to wrap up", "Ship the settings page", "report.md"],
    [103, "done", "celebrate", "Goal done", "Ship the settings page", "report.md", "proud"],
  ],
  mochi: [
    [0, "waiting", "wait", "Waiting on Kopi", null, null],
    [8, "working", "code", "Editing settings.tsx", FORM, "apps/web/src/settings.tsx", "focused"],
    [15, "working", "run", "Running bun test", FORM, "settings.test.ts", "focused"],
    [24, "waiting", "wait", "Waiting for review", FORM, "settings.tsx"],
    [54, "working", "code", "Adding the missing test", FORM, "settings.test.ts", "focused"],
    [63, "working", "handoff", "Pinning it to the board", FORM, "settings.tsx", "proud"],
    [71, "working", "code", "Wiring the empty state", ART, "empty-state.tsx"],
    [103, "done", "celebrate", "Shipped it", ART, "empty-state.tsx", "proud"],
  ],
  onde: [
    [0, "idle", "rest", null, null, null],
    [13, "working", "review", "Reading the settings diff", "Review the settings form", "settings.tsx"],
    [26, "working", "read", "Writing review notes", "Review the settings form", "review.md"],
    [54, "working", "review", "Checking the fix", "Review the settings form", "settings.test.ts", "focused"],
    [62, "idle", "rest", "Review done", null, null, "proud"],
    [103, "done", "celebrate", null, null, null, "proud"],
  ],
  tempe: [
    [0, "working", "code", "Writing router tests", "Test the router", "router.test.ts"],
    [4, "waiting", "ask", "Asking Kopi about a dev dependency", "Test the router", "package.json"],
    [15, "working", "run", "Running the suite", "Test the router", "router.test.ts", "focused"],
    [24, "working", "review", "Hunting a flaky test", "Test the router", "router.test.ts", "focused"],
    [54, "working", "run", "Running the suite again", "Test the router", "router.test.ts"],
    [66, "idle", "rest", "Suite is green", null, null, "proud"],
    [103, "done", "celebrate", null, null, null, "proud"],
  ],
  klepon: [
    [0, "working", "design", "Drawing the empty state", ART, "empty-state.svg", "focused"],
    [36, "working", "code", "Laying out the form", ART, "settings.css"],
    [68, "working", "handoff", "Handing the art to Mochi", ART, "empty-state.svg"],
    [74, "idle", "rest", null, null, null],
    [103, "done", "celebrate", null, null, null, "proud"],
  ],
  cilok: [
    [0, "working", "research", "Reading form patterns", "Research form patterns", "notes.md"],
    [20, "working", "code", "Writing notes", "Research form patterns", "notes.md"],
    [42, "working", "read", "Reading the spec", "Research form patterns", "spec.md"],
    [78, "idle", "rest", "Notes are in", null, null],
    [103, "done", "celebrate", null, null, null],
  ],
  bakpao: [
    [0, "working", "scan", "Scanning dependencies", "Audit dependencies", "package.json", "focused"],
    [20, "working", "review", "Found a test key in a fixture", "Audit dependencies", "fixtures/keys.ts"],
    [74, "waiting", "ask", "Asking Kopi to rotate the key", "Audit dependencies", "fixtures/keys.ts"],
    [83, "working", "scan", "Rescanning", "Audit dependencies", "package.json"],
    [94, "idle", "rest", "Audit done", null, null],
    [103, "done", "celebrate", null, null, null],
  ],
  serabi: [
    [0, "idle", "rest", "Nothing queued yet", null, null],
    [40, "working", "automate", "Running the release runbook", "Prepare the release", "release.md"],
    [80, "idle", "rest", "Release is staged", null, null],
    [103, "done", "celebrate", null, null, null],
  ],
  lumpia: [
    [0, "working", "code", "Editing api/settings.ts", "Settings API", "apps/api/src/settings.ts", "focused"],
    [58, "working", "run", "Running bun test", "Settings API", "settings.test.ts"],
    [78, "idle", "rest", null, null, null],
    [103, "done", "celebrate", null, null, null],
  ],
  wingko: [
    [0, "working", "run", "Running smoke tests", "Smoke tests", "smoke.test.ts"],
    [36, "idle", "rest", "Smoke tests pass", null, null],
    [103, "done", "celebrate", null, null, null],
  ],
  dodol: [
    [0, "working", "design", "Drawing the settings icons", "Settings icons", "icons.svg"],
    [66, "idle", "rest", null, null, null],
    [103, "done", "celebrate", null, null, null],
  ],
  gethuk: [
    [0, "idle", "rest", null, null, null],
    [12, "working", "research", "Comparing date pickers", "Compare date pickers", "notes.md"],
    [72, "idle", "rest", "Wrote it up", null, null],
    [103, "done", "celebrate", null, null, null],
  ],
};

/** A beat without its id, per kind (Omit does not distribute over the union by itself). */
export type BeatSpec = OfficeBeat extends infer B ? (B extends OfficeBeat ? Omit<B, "id"> : never) : never;

export interface StoryEvent {
  t: number;
  key: string;
  beat?: BeatSpec;
  meetingStart?: { id: string; kind: MeetingKind; title: string; agentIds: string[]; agenda: string[] };
  meetingEnd?: { id: string; notes: string[] };
  coffee?: string;
}

const ALL = OFFICE_CREW.map((m) => m.id);

export const EVENTS: StoryEvent[] = [
  { t: 0.3, key: "h1", beat: { kind: "handoff", fromId: "kopi", toId: "mochi", taskTitle: FORM } },
  { t: 4, key: "a1", beat: { kind: "ask", fromId: "tempe", toId: "kopi", question: "Can I add a dev dependency?" } },
  { t: 12, key: "d1", beat: { kind: "decided", byId: "kopi", toId: "tempe", approved: true, answer: "Yes, as a dev dependency" } },
  { t: 16, key: "r1", beat: { kind: "review", reviewerId: "onde", ownerId: "mochi", passed: false, taskTitle: FORM } },
  { t: 21, key: "c1", coffee: "serabi" },
  {
    t: 30,
    key: "m2s",
    meetingStart: {
      id: "sync",
      kind: "sync",
      title: "Why the review failed",
      agentIds: ["kopi", "mochi", "onde", "tempe", "lumpia"],
      agenda: ["What the review found", "The fix and who owns it", "When to review again"],
    },
  },
  { t: 52, key: "m2e", meetingEnd: { id: "sync", notes: ["Mochi adds the missing test", "Onde reviews again today"] } },
  { t: 57, key: "r2", beat: { kind: "review", reviewerId: "onde", ownerId: "mochi", passed: true, taskTitle: FORM } },
  { t: 64, key: "v1", beat: { kind: "deliver", fromId: "mochi", taskTitle: FORM } },
  { t: 69, key: "h2", beat: { kind: "handoff", fromId: "klepon", toId: "mochi", taskTitle: ART } },
  { t: 74, key: "a2", beat: { kind: "ask", fromId: "bakpao", toId: "kopi", question: "Rotate the leaked test key?" } },
  { t: 80, key: "d2", beat: { kind: "decided", byId: "kopi", toId: "bakpao", approved: false, answer: "The owner decides, I asked them" } },
  { t: 82, key: "c2", coffee: "gethuk" },
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
  { t: 100, key: "m3e", meetingEnd: { id: "wrapup", notes: ["The settings page shipped", "The key rotation waits on the owner"] } },
  { t: 104, key: "cel", beat: { kind: "celebrate", agentIds: ALL } },
];

type Card = NonNullable<OfficeProps["plan"]>[number];

const CARDS: Array<{ id: string; title: string; ownerId: string; steps: Array<[number, Card["status"]]> }> = [
  { id: "c1", title: FORM, ownerId: "mochi", steps: [[0, "todo"], [5, "doing"], [22, "review"], [52, "doing"], [60, "review"], [65, "done"]] },
  { id: "c2", title: "Test the router", ownerId: "tempe", steps: [[0, "doing"], [66, "review"], [78, "done"]] },
  { id: "c3", title: ART, ownerId: "klepon", steps: [[0, "doing"], [70, "review"], [90, "done"]] },
  { id: "c4", title: "Research form patterns", ownerId: "cilok", steps: [[0, "doing"], [78, "done"]] },
  { id: "c5", title: "Audit dependencies", ownerId: "bakpao", steps: [[0, "doing"], [94, "done"]] },
  { id: "c6", title: "Review the settings form", ownerId: "onde", steps: [[0, "todo"], [13, "doing"], [62, "done"]] },
  { id: "c7", title: "Prepare the release", ownerId: "serabi", steps: [[0, "todo"], [40, "doing"], [98, "done"]] },
];

function segAt(segs: Seg[], t: number): Seg {
  let cur = segs[0]!;
  for (const s of segs) if (s[0] <= t) cur = s;
  return cur;
}

export function crewOf(size: CrewSize): Member[] {
  return OFFICE_CREW.slice(0, size);
}

/** The crew at a time into the loop. */
export function agentsAt(t: number, size: CrewSize): OfficeAgent[] {
  return crewOf(size).map((m, i) => {
    const s = segAt(SCRIPT[m.id]!, t);
    return {
      id: m.id,
      name: m.name,
      role: m.role,
      look: { coat: m.coat, seed: m.seed },
      status: s[1],
      activity: s[2],
      mood: s[6] ?? "calm",
      energy: Math.min(0.9, 0.12 + i * 0.05 + (t / LOOP_S) * 0.4),
      parentId: m.role === "lead" ? null : "kopi",
      taskTitle: s[4],
      statusText: s[3],
      file: s[5],
    };
  });
}

export function planAt(t: number): Card[] {
  return CARDS.map((c) => {
    let status: Card["status"] = c.steps[0]![1];
    for (const [at, st] of c.steps) if (at <= t) status = st;
    return { id: c.id, title: c.title, status, ownerId: c.ownerId };
  });
}

/** Events with a time in (from, to]. */
export function eventsBetween(from: number, to: number): StoryEvent[] {
  return EVENTS.filter((e) => e.t > from && e.t <= to);
}

export function meetingFrom(start: NonNullable<StoryEvent["meetingStart"]>, loop: number): OfficeMeeting {
  return { id: `${loop}-${start.id}`, kind: start.kind, title: start.title, agentIds: start.agentIds, agenda: start.agenda, endedAt: null, notes: [] };
}
