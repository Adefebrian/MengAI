// The preview's scripted timeline: a pure function of the tick, so the
// board is reproducible. Kopi (lead) and Mochi (engineer) run a handoff
// script; the other six cycle through every activity and mood, with one
// error and one stop along the way. Sample content for the preview only.
import { ACTIVITIES, MOODS, type Activity, type AgentRole, type AgentStatus, type Coat } from "@mengai/shared";
import { ACTIVITY_LABEL, ROLE_LABEL } from "@mengai/shared";
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
  { id: "a3", name: "Tempe", role: "qa", coat: "tabby", seed: 3373 },
  { id: "a4", name: "Klepon", role: "designer", coat: "calico", seed: 4447 },
  { id: "a5", name: "Onde", role: "reviewer", coat: "gray", seed: 5519 },
  { id: "a6", name: "Cilok", role: "researcher", coat: "ginger", seed: 6607 },
  { id: "a7", name: "Bakpao", role: "security", coat: "siamese", seed: 7703 },
  { id: "a8", name: "Serabi", role: "operator", coat: "tuxedo", seed: 8849 },
];

export const TICK_MS = 2400;

const DETAIL: Record<Activity, string | null> = {
  rest: null,
  think: "Weighing two approaches",
  plan: "Splitting the goal into tasks",
  code: "Editing settings.tsx",
  run: "Running bun test",
  read: "Reading the brief",
  review: "Reviewing the settings diff",
  design: "Drawing the empty state",
  research: "Comparing backup options",
  scan: "Checking the lockfile",
  automate: "Opening System Settings",
  handoff: "Passing the task on",
  ask: "Wants to run a shell command",
  wait: "Waiting on a teammate",
  celebrate: "Finished the task",
};

const TASKS = [
  "Build the settings page",
  "Write tests for the router",
  "Draw the onboarding cats",
  "Review the auth changes",
  "Research SQLite backups",
  "Audit the dependency lockfile",
  "Automate the release notes",
];

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

function label(m: CrewMember, status: AgentStatus, activity: Activity): string {
  const what = status === "stopped" ? "stopped" : status === "error" ? "hit an error" : ACTIVITY_LABEL[activity].toLowerCase();
  return `${m.name}, ${ROLE_LABEL[m.role]}, ${what}`;
}

const HANDOFF_TASK = "Build the settings page";

interface Step {
  activity: Activity;
  status?: AgentStatus;
  detail: string | null;
  task: string | null;
}

/** Kopi hands the settings task to Mochi, who picks it up and finishes it. */
const KOPI: Step[] = [
  { activity: "plan", detail: "Splitting the goal into tasks", task: HANDOFF_TASK },
  { activity: "handoff", detail: "Handing the task to Mochi", task: HANDOFF_TASK },
  { activity: "rest", detail: "Handed to Mochi", task: null },
  { activity: "think", detail: "Planning the next task", task: null },
  { activity: "wait", detail: "Waiting on Mochi", task: null },
  { activity: "rest", detail: null, task: null },
];
const MOCHI: Step[] = [
  { activity: "rest", detail: null, task: null },
  { activity: "wait", detail: "Waiting on Kopi", task: null },
  { activity: "read", detail: "Picked up from Kopi", task: HANDOFF_TASK },
  { activity: "code", detail: "Editing settings.tsx", task: HANDOFF_TASK },
  { activity: "run", detail: "Running bun test", task: HANDOFF_TASK },
  { activity: "celebrate", detail: "Finished the task", task: HANDOFF_TASK },
];

export function frame(tick: number): Frame[] {
  const t = Math.max(0, Math.trunc(tick));
  return CREW.map((m, i) => {
    const mood = MOODS[(Math.floor(t / 2) + i) % MOODS.length]!;
    const energy = Math.min(0.96, ((t * 7 + i * 13) % 97) / 100);
    const look = { coat: m.coat, seed: m.seed };
    if (i < 2) {
      const script = i === 0 ? KOPI : MOCHI;
      const step = script[t % script.length]!;
      const status = step.status ?? statusFor(step.activity);
      return {
        look,
        role: m.role,
        name: m.name,
        status,
        activity: step.activity,
        mood,
        label: label(m, status, step.activity),
        statusText: step.detail,
        taskTitle: step.task,
        energy,
        celebrateKey: i === 1 ? Math.floor((t + 1) / MOCHI.length) : 0,
      };
    }
    const k = t + i * 3;
    const activity = ACTIVITIES[k % ACTIVITIES.length]!;
    let status = statusFor(activity);
    let detail = DETAIL[activity];
    if (i === 4 && activity === "review" && Math.floor(k / ACTIVITIES.length) % 2 === 1) {
      status = "error";
      detail = "The diff failed to apply";
    }
    if (i === 7 && k % ACTIVITIES.length === 9) {
      status = "stopped";
      detail = "Stopped by you";
    }
    return {
      look,
      role: m.role,
      name: m.name,
      status,
      activity,
      mood,
      label: label(m, status, activity),
      statusText: detail,
      taskTitle: activity === "rest" ? null : TASKS[(i + Math.floor(k / ACTIVITIES.length)) % TASKS.length]!,
      energy,
      celebrateKey: Math.floor((k + 1) / ACTIVITIES.length),
    };
  });
}
