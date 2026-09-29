// The preview's scripted timeline: a pure function of the tick, so the board
// is reproducible. Eight steps per cycle; every cat plays its own role's
// scenarios: Kopi plans and hands the settings task to Mochi, Mochi builds
// and tests it and hands the diff to Onde, who returns it once and then
// approves it; Tempe hunts a bug and hits an error, Klepon paints, Cilok
// researches, Bakpao scans and flags, Serabi reads the runbook and is
// stopped. Tempe's budget runs low near the end of each cycle. A waiting cat
// that starts working plays the catch. Sample content for the preview only.
import { ACTIVITY_LABEL, ROLE_LABEL, type Activity, type AgentRole, type AgentStatus, type Coat, type Mood } from "@mengai/shared";
import type { CatCardProps } from "../src/contract";

export interface CrewMember {
  id: string;
  name: string;
  role: AgentRole;
  coat: Coat;
  seed: number;
}

export const CREW: CrewMember[] = [
  { id: "a1", name: "Kopi", role: "lead", coat: "black", seed: 1187 },
  { id: "a2", name: "Mochi", role: "engineer", coat: "cream", seed: 2291 },
  { id: "a3", name: "Onde", role: "reviewer", coat: "gray", seed: 5519 },
  { id: "a4", name: "Tempe", role: "qa", coat: "tabby", seed: 3373 },
  { id: "a5", name: "Klepon", role: "designer", coat: "calico", seed: 4447 },
  { id: "a6", name: "Cilok", role: "researcher", coat: "ginger", seed: 6607 },
  { id: "a7", name: "Bakpao", role: "security", coat: "siamese", seed: 7703 },
  { id: "a8", name: "Serabi", role: "operator", coat: "tuxedo", seed: 8849 },
];

/** One step holds long enough for a full beat (2.5 loops of --loop-pulse) plus the dwell. */
export const TICK_MS = 4400;
export const STEPS = 8;

interface Step {
  activity: Activity;
  status?: AgentStatus;
  mood?: Mood;
  detail: string | null;
  task: string | null;
}

const SETTINGS = "Ship the settings page";

const SCRIPTS: Record<string, Step[]> = {
  a1: [
    { activity: "plan", mood: "focused", detail: "Splitting the goal into tasks", task: SETTINGS },
    { activity: "handoff", detail: "Handing the settings task to Mochi", task: SETTINGS },
    { activity: "review", detail: "Checking on the crew", task: SETTINGS },
    { activity: "wait", detail: "Waiting on Mochi", task: SETTINGS },
    { activity: "ask", status: "approval", detail: "Wants to merge the settings branch", task: SETTINGS },
    { activity: "think", detail: "Planning the next goal", task: null },
    { activity: "celebrate", status: "done", mood: "proud", detail: "Goal done", task: SETTINGS },
    { activity: "rest", detail: null, task: null },
  ],
  a2: [
    { activity: "rest", detail: null, task: null },
    { activity: "wait", detail: "Waiting on Kopi", task: null },
    { activity: "read", detail: "Picked up from Kopi", task: SETTINGS },
    { activity: "code", mood: "focused", detail: "Editing settings.tsx", task: SETTINGS },
    { activity: "run", mood: "focused", detail: "Running bun test", task: SETTINGS },
    { activity: "handoff", detail: "Handing the diff to Onde", task: SETTINGS },
    { activity: "celebrate", status: "done", mood: "proud", detail: "Finished the settings page", task: SETTINGS },
    { activity: "think", detail: "Saving a skill", task: null },
  ],
  a3: [
    { activity: "rest", detail: null, task: null },
    { activity: "read", detail: "Reading the settings diff", task: "Review the settings diff" },
    { activity: "run", detail: "Running the checks", task: "Review the settings diff" },
    { activity: "review", mood: "frustrated", detail: "Returning it: a test is missing", task: "Review the settings diff" },
    { activity: "wait", detail: "Waiting on Mochi", task: "Review the settings diff" },
    { activity: "wait", detail: "Waiting on Mochi", task: "Review the settings diff" },
    { activity: "review", mood: "proud", detail: "Approving the settings diff", task: "Review the settings diff" },
    { activity: "celebrate", status: "done", mood: "proud", detail: "Review done", task: "Review the settings diff" },
  ],
  a4: [
    { activity: "read", detail: "Reading the test plan", task: "Test the router" },
    { activity: "code", detail: "Writing router tests", task: "Test the router" },
    { activity: "run", mood: "focused", detail: "Running the suite", task: "Test the router" },
    { activity: "review", mood: "focused", detail: "Hunting a flaky bug", task: "Test the router" },
    { activity: "run", status: "error", mood: "frustrated", detail: "The suite crashed", task: "Test the router" },
    { activity: "handoff", detail: "Reporting the bug to Mochi", task: "Test the router" },
    { activity: "rest", detail: "Budget almost used up", task: null },
    { activity: "celebrate", status: "done", detail: "Tests pass", task: "Test the router" },
  ],
  a5: [
    { activity: "think", detail: "Sketching the empty state", task: "Draw the empty state" },
    { activity: "design", mood: "focused", detail: "Drawing the empty state", task: "Draw the empty state" },
    { activity: "code", detail: "Laying out the settings form", task: "Lay out the settings form" },
    { activity: "read", detail: "Reading the brand notes", task: "Draw the empty state" },
    { activity: "ask", status: "approval", detail: "Wants your pick of two drafts", task: "Draw the empty state" },
    { activity: "design", detail: "Refining the drawing", task: "Draw the empty state" },
    { activity: "handoff", detail: "Handing the art to Mochi", task: "Draw the empty state" },
    { activity: "celebrate", status: "done", mood: "proud", detail: "Art delivered", task: "Draw the empty state" },
  ],
  a6: [
    { activity: "research", mood: "focused", detail: "Comparing backup options", task: "Research SQLite backups" },
    { activity: "read", detail: "Reading the SQLite docs", task: "Research SQLite backups" },
    { activity: "code", detail: "Writing up the findings", task: "Research SQLite backups" },
    { activity: "think", detail: "Weighing two options", task: "Research SQLite backups" },
    { activity: "research", detail: "Checking one more source", task: "Research SQLite backups" },
    { activity: "wait", detail: "Waiting on Kopi", task: null },
    { activity: "read", detail: "Picked up the next question", task: "Research log rotation" },
    { activity: "celebrate", status: "done", detail: "Findings saved", task: "Research log rotation" },
  ],
  a7: [
    { activity: "scan", mood: "focused", detail: "Scanning the lockfile", task: "Audit the dependencies" },
    { activity: "read", detail: "Reading the lockfile", task: "Audit the dependencies" },
    { activity: "review", detail: "Flagging a risky package", task: "Audit the dependencies" },
    { activity: "ask", status: "approval", detail: "Wants to pin a version", task: "Audit the dependencies" },
    { activity: "scan", detail: "Scanning for secrets", task: "Audit the dependencies" },
    { activity: "scan", status: "error", mood: "frustrated", detail: "The scanner timed out", task: "Audit the dependencies" },
    { activity: "rest", detail: null, task: null },
    { activity: "celebrate", status: "done", detail: "Audit done", task: "Audit the dependencies" },
  ],
  a8: [
    { activity: "rest", detail: null, task: null },
    { activity: "think", detail: "Planning the steps", task: "Draft the release notes" },
    { activity: "read", detail: "Reading the runbook", task: "Draft the release notes" },
    { activity: "wait", detail: "Waiting on Bakpao", task: "Draft the release notes" },
    { activity: "read", detail: "Picked up from Bakpao", task: "Draft the release notes" },
    { activity: "rest", status: "stopped", detail: "Stopped by you", task: "Draft the release notes" },
    { activity: "rest", status: "stopped", detail: "Stopped by you", task: "Draft the release notes" },
    { activity: "rest", detail: null, task: null },
  ],
};

export function statusFor(activity: Activity): AgentStatus {
  switch (activity) {
    case "rest":
      return "idle";
    case "think":
      return "thinking";
    case "wait":
      return "waiting";
    case "ask":
      return "approval";
    case "celebrate":
      return "done";
    default:
      return "working";
  }
}

type Frame = Omit<CatCardProps, "onSelect" | "selected" | "interactive">;

export function catLabel(m: Pick<CrewMember, "name" | "role">, status: AgentStatus, activity: Activity): string {
  const what = status === "stopped" ? "stopped" : status === "error" ? "hit an error" : ACTIVITY_LABEL[activity].toLowerCase();
  return `${m.name}, ${ROLE_LABEL[m.role]}, ${what}`;
}

/** Budget used: each cat climbs through the cycle; Tempe runs low from step 6. */
function energyAt(i: number, step: number): number {
  if (i === 3) return 0.5 + step * 0.065;
  return 0.08 + ((i * 11) % 40) / 100 + step * 0.045;
}

export function frame(tick: number): Frame[] {
  const t = Math.max(0, Math.trunc(tick));
  const step = t % STEPS;
  return CREW.map((m, i) => {
    const s = SCRIPTS[m.id]![step]!;
    const status = s.status ?? statusFor(s.activity);
    return {
      look: { coat: m.coat, seed: m.seed },
      role: m.role,
      name: m.name,
      status,
      activity: s.activity,
      mood: s.mood ?? "calm",
      label: catLabel(m, status, s.activity),
      statusText: s.detail,
      taskTitle: s.task,
      energy: Math.min(0.97, energyAt(i, step)),
      celebrateKey: 0,
    };
  });
}

/** Every scenario, for the index and the stills. */
export interface Scenario {
  key: string;
  name: string;
  note: string;
  role: AgentRole;
  activity: Activity;
  status?: AgentStatus;
  mood?: Mood;
  energy?: number;
  /** Alternates with this activity to show a transition (the catch, done). */
  from?: Activity;
}

export const SCENARIOS: Scenario[] = [
  { key: "eng-code", name: "Engineer writes code", note: "Types, lines appear, the build bar fills", role: "engineer", activity: "code", mood: "focused" },
  { key: "eng-run", name: "Engineer runs tests", note: "Output streams, a pass stamp lands", role: "engineer", activity: "run" },
  { key: "eng-fail", name: "Tests fail", note: "A frustrated run stamps a cross", role: "engineer", activity: "run", mood: "frustrated" },
  { key: "rev-ok", name: "Reviewer approves", note: "Two sweeps, then the approve stamp", role: "reviewer", activity: "review", mood: "proud" },
  { key: "rev-back", name: "Reviewer returns", note: "A return stamp sends it back", role: "reviewer", activity: "review", mood: "frustrated" },
  { key: "qa-hunt", name: "QA hunts a bug", note: "Sniffs, crouches, pounces, holds it", role: "qa", activity: "review", mood: "focused" },
  { key: "qa-run", name: "QA runs the suite", note: "Each test ticks in turn", role: "qa", activity: "run" },
  { key: "qa-code", name: "QA writes tests", note: "Test cases appear one by one", role: "qa", activity: "code" },
  { key: "sec-scan", name: "Security scans", note: "Shield up, a sweep, a flag on the finding", role: "security", activity: "scan", mood: "focused" },
  { key: "sec-flag", name: "Security flags a risk", note: "Two sweeps, then the flag", role: "security", activity: "review" },
  { key: "res-research", name: "Researcher researches", note: "The spyglass pans, a page flips", role: "researcher", activity: "research" },
  { key: "res-notes", name: "Researcher writes notes", note: "The pencil writes each line", role: "researcher", activity: "code" },
  { key: "des-paint", name: "Designer paints", note: "Strokes in its own coat colours", role: "designer", activity: "design" },
  { key: "des-layout", name: "Designer lays out", note: "Blocks fall into place", role: "designer", activity: "code" },
  { key: "lead-plan", name: "Lead plans", note: "Task cards move to done", role: "lead", activity: "plan", mood: "focused" },
  { key: "lead-crew", name: "Lead checks the crew", note: "Looks across, nods at each", role: "lead", activity: "review" },
  { key: "handoff", name: "Hands off", note: "Winds up, tosses the task on", role: "engineer", activity: "handoff" },
  { key: "catch", name: "Catches the task", note: "Done waiting: the card lands in its paws", role: "designer", activity: "read", from: "wait" },
  { key: "wait", name: "Waits on a teammate", note: "Tail wrapped, a glance at the blocker", role: "reviewer", activity: "wait" },
  { key: "ask", name: "Needs your approval", note: "Paw up, the flag waves", role: "lead", activity: "ask", status: "approval" },
  { key: "error", name: "Hits an error", note: "Ears back, one shake, a warning", role: "qa", activity: "run", status: "error", mood: "frustrated" },
  { key: "done", name: "Done", note: "Stretch, tail up, paw prints, curls up", role: "researcher", activity: "celebrate", status: "done", from: "rest" },
  { key: "low", name: "Budget running low", note: "Heavy lids, slower, nodding off", role: "security", activity: "code", energy: 0.93 },
  { key: "rest", name: "Rests", note: "Breath, tail sway, idle quirks", role: "operator", activity: "rest", status: "idle" },
  { key: "think", name: "Thinks", note: "Paw to chin, a slow tilt", role: "researcher", activity: "think", status: "thinking" },
  { key: "read", name: "Reads", note: "Each role reads its own kind of page", role: "lead", activity: "read" },
  { key: "stopped", name: "Stopped", note: "Lies down, dimmed", role: "operator", activity: "rest", status: "stopped" },
  { key: "runbook", name: "Runbook", note: "Steps run in turn; local control is off in this build", role: "operator", activity: "automate" },
];
