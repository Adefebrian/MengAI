// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The island's motion tokens as Motion transitions (tokens.css: --dur-*,
// --dur-*-exit, --ease-standard). The shape morphs on a spring for its
// width, height and corners (Brian's call for the island), critically
// damped: bounce 0, so it settles without an overshoot, over the visual
// length of --dur-300. Content crossfades on opacity only. Under reduced
// motion, or the owner's motion setting "off", every change is instant.
import { useSyncExternalStore } from "react";

/** --ease-standard */
export const EASE = [0.24, 1, 0.4, 1] as const;

/** The shape: width, height and corner radius, a spring that never overshoots. */
export const MORPH = { type: "spring", visualDuration: 0.3, bounce: 0 } as const;
/** --dur-200: content arriving */
export const FADE_IN = { duration: 0.2, ease: EASE } as const;
/** --dur-200-exit: content leaving */
export const FADE_OUT = { duration: 0.14, ease: EASE } as const;
/** --dur-300: the ring's stroke */
export const RING_T = { duration: 0.3, ease: EASE } as const;
export const INSTANT = { duration: 0 } as const;

/** Hover intent: --dur-150 before the peek opens, --dur-300 before it closes. */
export const HOVER_IN_MS = 150;
export const HOVER_OUT_MS = 300;
/** How long the result of an answer stays in place before the queue moves on. */
export const RESULT_MS = 1600;

const QUERY = "(prefers-reduced-motion: reduce)";

function list(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(QUERY);
}

function subscribe(onChange: () => void): () => void {
  const l = list();
  if (!l) return () => {};
  if (typeof l.addEventListener === "function") {
    l.addEventListener("change", onChange);
    return () => l.removeEventListener("change", onChange);
  }
  l.addListener(onChange);
  return () => l.removeListener(onChange);
}

/** True while the OS asks for reduced motion; follows the setting live. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => list()?.matches ?? false, () => false);
}
