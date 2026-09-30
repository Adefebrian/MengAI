// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The motion tokens as Framer Motion transitions, one source for every beat
// on the app (tokens.css: --dur-*, --dur-*-exit, --ease-standard,
// --stagger-item). Transform and opacity only. Under OS reduced motion or
// the "off" setting AppRoot sets MotionConfig reducedMotion="always" and the
// screens pass T.none, so every beat lands on its final state at once.
import { useApp } from "./context";

/** --ease-standard */
export const EASE = [0.24, 1, 0.4, 1] as const;

export const T = {
  /** --dur-150 */
  fast: { duration: 0.15, ease: EASE },
  /** --dur-200 */
  base: { duration: 0.2, ease: EASE },
  /** --dur-200-exit */
  baseExit: { duration: 0.14, ease: EASE },
  /** --dur-300 */
  slow: { duration: 0.3, ease: EASE },
  /** --dur-300-exit */
  slowExit: { duration: 0.21, ease: EASE },
  /** --dur-reduced, opacity only */
  reduced: { duration: 0.15, ease: "linear" as const },
  none: { duration: 0 },
} as const;

/** --stagger-item, in seconds */
export const STAGGER_ITEM = 0.06;
/** the stagger stops growing after the sixth item */
export const STAGGER_CAP = 6;

export type MotionLevel = "full" | "calm" | "off";

/**
 * full: every beat, with the deal-in stagger. calm: the moves that carry
 * meaning, no stagger. off: final states only (OS reduced motion or the
 * setting), nothing travels.
 */
export function useMotionLevel(): MotionLevel {
  return useApp().motion;
}

/** Delay for the nth card of a dealt batch. */
export function dealDelay(n: number, level: MotionLevel): number {
  return level === "full" ? Math.min(Math.max(0, n), STAGGER_CAP) * STAGGER_ITEM : 0;
}
