// Pose model: what the rig shows for a status and an activity. Pure data and
// pure helpers, no React, so the web app and the tests share one table.
//
// Coordinates are user units on the rig's 160 x 160 viewBox. The sitting
// rig rests with its front paws at (68, 144) and (92, 144); every offset
// below moves a part from that rest. Nothing may leave the viewBox, the
// hop (8 units up) included: ears top out near y 18, the lowest tube near
// y 157.
import { ACTIVITY_LABEL, COATS, type Activity, type AgentRole, type AgentStatus, type Coat, type Mood } from "@mengai/shared";

/** A rig pose: every activity, plus the status override for a stopped agent. */
export type Pose = Activity | "stopped";

export type PropId =
  | "laptop"
  | "terminal"
  | "page"
  | "magnifier"
  | "canvas"
  | "spyglass"
  | "shield"
  | "mouse"
  | "clipboard"
  | "card";

/** The prop an activity uses in the paws. Activities without one show the role prop set aside. */
export const ACTIVITY_PROP: Partial<Record<Activity, PropId>> = {
  plan: "clipboard",
  code: "laptop",
  run: "terminal",
  read: "page",
  review: "magnifier",
  design: "canvas",
  research: "spyglass",
  scan: "shield",
  automate: "mouse",
  handoff: "card",
};

/** Each role's own prop, shown set aside while the cat rests, thinks, waits, or asks. */
export const ROLE_PROP: Record<AgentRole, PropId> = {
  lead: "clipboard",
  engineer: "laptop",
  designer: "canvas",
  reviewer: "magnifier",
  qa: "terminal",
  security: "shield",
  researcher: "spyglass",
  operator: "mouse",
};

/** Poses drawn with the lying rig. */
export const LYING_POSES: ReadonlySet<Pose> = new Set<Pose>(["stopped", "celebrate"]);

/** Poses that may play idle quirks (grooming, yawn, and the rest). */
export const QUIRK_POSES: ReadonlySet<Pose> = new Set<Pose>(["rest", "wait"]);

export function poseFor(status: AgentStatus, activity: Activity): Pose {
  return status === "stopped" ? "stopped" : activity;
}

export interface PropPlacement {
  id: PropId;
  mode: "use" | "aside";
}

export function propFor(pose: Pose, role: AgentRole): PropPlacement | null {
  if (LYING_POSES.has(pose)) return null;
  const inUse = ACTIVITY_PROP[pose as Activity];
  if (inUse) return { id: inUse, mode: "use" };
  return { id: ROLE_PROP[role], mode: "aside" };
}

type Vec = readonly [number, number];

export interface SitSpec {
  /** Offset of the left and right front paw from rest. */
  pawL: Vec;
  pawR: Vec;
  /** The prop is drawn over the paws (the laptop lid hides the typing paws' lower half). */
  propOverPaws?: boolean;
  /** Head offset and tilt (degrees, around the neck at 80, 86). */
  head: { x: number; y: number; r: number };
  /** Static gaze offset of the pupils. */
  pupils: Vec;
  /** Right arm tube from the shoulder to the raised paw, when the paw is far from the body. */
  arm?: string;
  tail: "up" | "wrap";
  /** The right paw is drawn with the head (it holds the spyglass). */
  pawInHead?: boolean;
}

const REST: SitSpec = { pawL: [0, 0], pawR: [0, 0], head: { x: 0, y: 0, r: 0 }, pupils: [0, 0], tail: "up" };

/** Sitting poses. celebrate starts here (the stretch) before it curls up. */
export const SIT: Record<Exclude<Pose, "stopped">, SitSpec> = {
  rest: REST,
  think: {
    pawL: [0, 0],
    pawR: [-2, -54],
    head: { x: 0, y: 0, r: -7 },
    pupils: [-1.5, -2.5],
    arm: "M104 124 C 105 110 99 99 92 94",
    tail: "up",
  },
  plan: { pawL: [-14, -14], pawR: [6, -38], head: { x: 0, y: 2, r: 0 }, pupils: [0, 2], tail: "up" },
  code: { pawL: [-2, -40], pawR: [2, -40], propOverPaws: true, head: { x: 0, y: 1, r: 0 }, pupils: [0, 2], tail: "up" },
  run: { pawL: [-8, -45], pawR: [8, -45], head: { x: 0, y: 0, r: 0 }, pupils: [0, 2.5], tail: "up" },
  read: { pawL: [-10, -10], pawR: [10, -10], head: { x: 0, y: 3, r: 0 }, pupils: [0, 2.5], tail: "up" },
  review: { pawL: [0, 0], pawR: [4, 2], head: { x: 0, y: 2, r: 0 }, pupils: [-1, 3], tail: "up" },
  design: { pawL: [0, 0], pawR: [14, -26], head: { x: 2, y: 0, r: 5 }, pupils: [2.5, 1], tail: "up" },
  research: { pawL: [0, 0], pawR: [0, 0], head: { x: 0, y: 0, r: -3 }, pupils: [0, 0], tail: "up", pawInHead: true },
  scan: { pawL: [-14, -24], pawR: [0, 0], head: { x: 0, y: 0, r: 0 }, pupils: [0, 0], tail: "up" },
  automate: { pawL: [0, 0], pawR: [12, -14], head: { x: 0, y: 1, r: 0 }, pupils: [1.5, 2], tail: "up" },
  handoff: { pawL: [-8, -22], pawR: [8, -22], head: { x: 0, y: -1, r: 0 }, pupils: [0, 0], tail: "up" },
  ask: {
    pawL: [0, 0],
    pawR: [22, -74],
    head: { x: 0, y: 0, r: -4 },
    pupils: [0, -1],
    arm: "M104 112 C 110 100 114 88 114 78",
    tail: "up",
  },
  wait: { pawL: [0, 0], pawR: [0, 0], head: { x: 0, y: 1, r: 0 }, pupils: [0, 0.5], tail: "wrap" },
  celebrate: REST,
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

/** The words the still pose shows under the cat. */
export function stillCaption(pose: Pose): string {
  return pose === "stopped" ? "Stopped" : ACTIVITY_LABEL[pose];
}
