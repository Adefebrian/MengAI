// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// DeliveryTracker model: pure helpers, so the component, the preview and the
// tests read the same facts. A stop is done before the current one, the
// current one is active, the rest are to do; a stop the run went back from
// (while it heads back, or until it passes that stop again) is returned.
import type { TrackerStage } from "../tracker-contract";
import type { StopState } from "./art";

/** How long the courier takes from one stop to the next (--dur-400, JEV motion.intensity drive_duration). */
export const DRIVE_MS = 400;
/** The U-turn before a drive back and the turn after it (--dur-150). */
export const TURN_MS = 150;
/** The arrival one-shot at the last stop, after the drive (under 1600 ms in all, tracker.css). */
export const ARRIVE_MS = 1600;

export function clampIndex(i: number, n: number): number {
  if (!Number.isFinite(i) || n <= 0) return 0;
  return Math.max(0, Math.min(n - 1, Math.round(i)));
}

/**
 * The state of every stop. `returnedFrom` is the stop the run turned back
 * at (the highest stop reached since the last move back), or null.
 */
export function stopStates(n: number, current: number, done: boolean, returnedFrom: number | null): StopState[] {
  const cur = clampIndex(current, n);
  return Array.from({ length: n }, (_, i) => {
    if (done) return "done";
    if (i < cur) return "done";
    if (i === cur) return "active";
    if (returnedFrom !== null && i === returnedFrom) return "returned";
    return "todo";
  });
}

export const STATE_WORD: Record<StopState, string> = {
  done: "done",
  active: "in progress",
  todo: "coming up",
  returned: "sent the work back",
};

/** The line a selected stop shows under its name: its own detail, else what its state means. */
export function stopLine(stage: TrackerStage, state: StopState, courier: string): string {
  if (stage.detail) return stage.detail;
  switch (state) {
    case "done":
      return `${courier} ticked this stop off.`;
    case "returned":
      return "This stop sent the work back for another round.";
    case "active":
      return `${courier} is here now.`;
    default:
      return `${courier} has not reached this stop yet.`;
  }
}

/** "Round 2" while or after a check sent the run back; nothing on the first round or once done. */
export function roundTag(loops: number | undefined, done: boolean): string | null {
  const n = Math.max(0, Math.floor(loops ?? 0));
  return n > 0 && !done ? `Round ${n + 1}` : null;
}

/** The share of the road behind the courier, 0 at the first stop and 1 at the last. */
export function roadShare(current: number, n: number): number {
  if (n <= 1) return 1;
  return clampIndex(current, n) / (n - 1);
}
