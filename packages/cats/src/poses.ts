// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Pose and beat model: what the rig shows for a role, a status and an
// activity. Pure data and pure helpers, no React, so the web app and the
// tests share one table.
//
// A pose is the activity (or "stopped"). A beat is what one role does in
// that pose: every role x activity combination resolves to its own beat.
// Role beats carry their own art and loop (the engineer's build bar, the
// qa bug hunt, the security scan sweep); a shared beat keeps the role's own
// object set aside in the free corner, so two roles never look alike.
//
// Coordinates are user units on the rig's 160 x 160 viewBox. The sitting
// rig rests with its front paws at (68, 144) and (92, 144); every offset
// below moves a part from that rest. Nothing may leave the viewBox, the
// hop (8 units up) included: ears top out near y 18, the lowest tube near
// y 157.
import { ACTIVITY_LABEL, COATS, type Activity, type AgentRole, type AgentStatus, type Coat, type Mood } from "@mengai/shared";

/** A rig pose: every activity, plus the status override for a stopped agent. */
export type Pose = Activity | "stopped";

/** The small flat objects a cat works with. No desks, no computers, no furniture. */
export type PropId =
  | "terminal"
  | "page"
  | "magnifier"
  | "canvas"
  | "spyglass"
  | "shield"
  | "clipboard"
  | "card"
  | "bugcard"
  | "runbook";

/** Beats shared by every role; the role's own object sits aside. */
export const SHARED_BEATS = [
  "rest",
  "think",
  "plan",
  "code",
  "run",
  "review",
  "research",
  "design",
  "scan",
  "automate",
  "handoff",
  "ask",
  "wait",
  "celebrate",
  "stopped",
] as const;

/** Reading: each role reads its own kind of page. */
export const READ_BEATS = [
  "read-lead",
  "read-engineer",
  "read-designer",
  "read-reviewer",
  "read-qa",
  "read-security",
  "read-researcher",
  "read-operator",
] as const;

/** Beats only one role plays: its signature work. */
export const ROLE_ONLY_BEATS = [
  "plan-board",
  "review-crew",
  "code-build",
  "run-stamp",
  "design-paint",
  "code-layout",
  "review-stamp",
  "code-tests",
  "run-tests",
  "review-hunt",
  "scan-sweep",
  "review-flag",
  "research-pages",
  "code-notes",
] as const;

export const BEATS = [...SHARED_BEATS, ...READ_BEATS, ...ROLE_ONLY_BEATS] as const;
export type Beat = (typeof BEATS)[number];
export type SitBeat = Exclude<Beat, "stopped">;

/** The signature beats per role. Every other activity uses the shared beat. */
export const ROLE_BEAT: Record<AgentRole, Partial<Record<Activity, Beat>>> = {
  lead: { plan: "plan-board", review: "review-crew" },
  engineer: { code: "code-build", run: "run-stamp" },
  designer: { design: "design-paint", code: "code-layout" },
  reviewer: { review: "review-stamp" },
  qa: { code: "code-tests", run: "run-tests", review: "review-hunt" },
  security: { scan: "scan-sweep", review: "review-flag" },
  researcher: { research: "research-pages", code: "code-notes" },
  operator: {},
};

/** Each role's own object, set aside while its paws are free or busy with a shared beat. */
export const ROLE_PROP: Record<AgentRole, PropId> = {
  lead: "clipboard",
  engineer: "terminal",
  designer: "canvas",
  reviewer: "magnifier",
  qa: "bugcard",
  security: "shield",
  researcher: "spyglass",
  operator: "runbook",
};

/** The object a beat works with, null when the paws are free. */
export const BEAT_PROP: Record<Beat, PropId | null> = {
  rest: null,
  think: null,
  plan: "clipboard",
  code: "terminal",
  run: "terminal",
  review: "magnifier",
  research: "spyglass",
  design: "canvas",
  scan: "shield",
  automate: "runbook",
  handoff: "card",
  ask: null,
  wait: null,
  celebrate: null,
  stopped: null,
  "read-lead": "page",
  "read-engineer": "page",
  "read-designer": "page",
  "read-reviewer": "page",
  "read-qa": "page",
  "read-security": "page",
  "read-researcher": "page",
  "read-operator": "page",
  "plan-board": "clipboard",
  "review-crew": null,
  "code-build": "terminal",
  "run-stamp": "terminal",
  "design-paint": "canvas",
  "code-layout": "terminal",
  "review-stamp": "magnifier",
  "code-tests": "terminal",
  "run-tests": "terminal",
  "review-hunt": "bugcard",
  "scan-sweep": "shield",
  "review-flag": "magnifier",
  "research-pages": "spyglass",
  "code-notes": "page",
};

/** Beats that leave the free corner open for the role's own object. */
const ASIDE_BEATS: ReadonlySet<Beat> = new Set<Beat>([...SHARED_BEATS, "review-crew"]);

/** Poses drawn with the lying rig. */
export const LYING_POSES: ReadonlySet<Pose> = new Set<Pose>(["stopped", "celebrate"]);

/** Poses that may play idle quirks (grooming, yawn, and the rest). */
export const QUIRK_POSES: ReadonlySet<Pose> = new Set<Pose>(["rest", "wait"]);

/** Poses a cat is busy in: leaving "wait" for one of these means the awaited task landed (the catch). */
export const WORK_POSES: ReadonlySet<Pose> = new Set<Pose>([
  "plan",
  "code",
  "run",
  "read",
  "review",
  "research",
  "design",
  "scan",
  "automate",
]);

export function poseFor(status: AgentStatus, activity: Activity): Pose {
  return status === "stopped" ? "stopped" : activity;
}

/** The beat one role plays in one pose. */
export function beatFor(role: AgentRole, pose: Pose): Beat {
  if (pose === "read") return `read-${role}`;
  if (pose === "stopped") return "stopped";
  return ROLE_BEAT[role][pose] ?? pose;
}

/** The role's own object when the beat leaves the corner free and does not already use it. */
export function asideFor(beat: Beat, role: AgentRole): PropId | null {
  if (!ASIDE_BEATS.has(beat)) return null;
  const own = ROLE_PROP[role];
  return BEAT_PROP[beat] === own ? null : own;
}

type Vec = readonly [number, number];

export interface SitSpec {
  /** Offset of the left and right front paw from rest. */
  pawL: Vec;
  pawR: Vec;
  /** Head offset and tilt (degrees, around the neck at 80, 86). */
  head: { x: number; y: number; r: number };
  /** Static gaze offset of the pupils. */
  pupils: Vec;
  /** A raised right arm: the tube from the shoulder to the paw. */
  arm?: "think" | "ask";
  tail: "up" | "wrap";
  /** The right paw is drawn with the head (it holds the spyglass). */
  pawInHead?: boolean;
}

const REST: SitSpec = { pawL: [0, 0], pawR: [0, 0], head: { x: 0, y: 0, r: 0 }, pupils: [0, 0], tail: "up" };
const TYPE: SitSpec = { pawL: [-8, -40], pawR: [8, -40], head: { x: 0, y: 1, r: 0 }, pupils: [0, 2.5], tail: "up" };
const WATCH: SitSpec = { pawL: [-12, -40], pawR: [12, -40], head: { x: 0, y: 0, r: 0 }, pupils: [0, 2.5], tail: "up" };
const READ: SitSpec = { pawL: [-10, -10], pawR: [10, -10], head: { x: 0, y: 3, r: 0 }, pupils: [0, 2.5], tail: "up" };
const LENS: SitSpec = { pawL: [0, 0], pawR: [4, 2], head: { x: 0, y: 2, r: 0 }, pupils: [-1, 3], tail: "up" };
const SPY: SitSpec = { pawL: [0, 0], pawR: [0, 0], head: { x: 0, y: 0, r: -3 }, pupils: [0, 0], tail: "up", pawInHead: true };
const PAINT: SitSpec = { pawL: [0, 0], pawR: [14, -26], head: { x: 2, y: 0, r: 5 }, pupils: [2.5, 1], tail: "wrap" };

/** Sitting specs per beat. celebrate starts here (the stretch) before it curls up. */
export const SIT: Record<SitBeat, SitSpec> = {
  rest: REST,
  think: { pawL: [0, 0], pawR: [-2, -54], head: { x: 0, y: 0, r: -7 }, pupils: [-1.5, -2.5], arm: "think", tail: "up" },
  plan: { pawL: [-14, -14], pawR: [6, -38], head: { x: 0, y: 2, r: 0 }, pupils: [0, 2], tail: "up" },
  code: TYPE,
  run: WATCH,
  review: LENS,
  research: SPY,
  design: PAINT,
  scan: { pawL: [-14, -24], pawR: [0, 0], head: { x: 0, y: 0, r: 0 }, pupils: [0, 0], tail: "up" },
  automate: { pawL: [-10, -6], pawR: [10, -6], head: { x: 0, y: 2, r: 0 }, pupils: [0, 2.5], tail: "up" },
  handoff: { pawL: [-8, -22], pawR: [8, -22], head: { x: 0, y: -1, r: 0 }, pupils: [0, 0], tail: "up" },
  ask: { pawL: [0, 0], pawR: [22, -74], head: { x: 0, y: 0, r: -4 }, pupils: [0, -1], arm: "ask", tail: "up" },
  wait: { pawL: [0, 0], pawR: [0, 0], head: { x: 0, y: 1, r: 0 }, pupils: [0, 0.5], tail: "wrap" },
  celebrate: REST,
  "read-lead": READ,
  "read-engineer": READ,
  "read-designer": READ,
  "read-reviewer": READ,
  "read-qa": READ,
  "read-security": READ,
  "read-researcher": READ,
  "read-operator": READ,
  "plan-board": { pawL: [-6, 2], pawR: [10, -14], head: { x: 0, y: 3, r: 0 }, pupils: [0, 3], tail: "up" },
  "review-crew": { pawL: [0, 0], pawR: [0, 0], head: { x: 0, y: 0, r: 0 }, pupils: [0, 0.5], tail: "up" },
  "code-build": TYPE,
  "run-stamp": WATCH,
  "design-paint": PAINT,
  "code-layout": TYPE,
  "review-stamp": LENS,
  "code-tests": TYPE,
  "run-tests": WATCH,
  "review-hunt": { pawL: [0, 2], pawR: [0, 2], head: { x: -2, y: 4, r: -6 }, pupils: [-2.5, 3], tail: "up" },
  "scan-sweep": { pawL: [-18, -18], pawR: [0, 0], head: { x: 1, y: 1, r: 3 }, pupils: [2, 2], tail: "up" },
  "review-flag": LENS,
  "research-pages": SPY,
  "code-notes": { pawL: [-12, -8], pawR: [6, -12], head: { x: 0, y: 3, r: 0 }, pupils: [0, 3], tail: "up" },
};

/** A known coat for any look (look.coat is a plain string on the wire). */
export function coatOf(coat: string, seed: number): Coat {
  return (COATS as readonly string[]).includes(coat) ? (coat as Coat) : COATS[Math.abs(seed) % COATS.length]!;
}

/** Loop tempo per mood: a multiplier on every loop duration. Mood never changes the pose. */
export const MOOD_TEMPO: Record<Mood, number> = {
  calm: 1,
  focused: 0.85,
  proud: 1,
  frustrated: 0.8,
  tired: 1.35,
};

/** Energy (share of the run budget used) at which the cat runs low: heavy lids, slower loops, nodding off. */
export const LOW_ENERGY = 0.85;

/** Seeded loop phase, so a crew never breathes in step. Negative: loops start mid-cycle. */
export function phaseMs(seed: number): number {
  return -(Math.abs(Math.trunc(seed)) % 4800);
}

export function clampEnergy(energy: number): number {
  if (!Number.isFinite(energy)) return 0;
  return Math.min(1, Math.max(0, energy));
}

export function energyPercent(energy: number): number {
  return Math.round(clampEnergy(energy) * 100);
}

export function isLowEnergy(energy: number | undefined): boolean {
  return energy !== undefined && clampEnergy(energy) >= LOW_ENERGY;
}

/**
 * The words for an activity next to or under a cat: the shared labels, except
 * automate. Local computer control is off in this build, so the operator's
 * beat is a runbook and never claims to operate the Mac.
 */
export function activityWords(activity: Activity): string {
  return activity === "automate" ? "Running a runbook" : ACTIVITY_LABEL[activity];
}

/** The words a still cat shows under itself. */
export function stillCaption(pose: Pose, status?: AgentStatus): string {
  if (status === "error") return "Hit an error";
  return pose === "stopped" ? "Stopped" : activityWords(pose);
}
