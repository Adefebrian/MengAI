// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Motion logic for the cat: the reduced motion query, the activity dwell,
// the seeded quirk schedule, the offscreen and hidden-tab pause, the calm
// limit, the catch, and pointer follow. Every loop itself is a CSS keyframe
// on transform or opacity (cats.css); this file only decides which classes
// and attributes are on, with timeouts, never a standing animation frame loop.
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { WORK_POSES, type Pose } from "./poses";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function reduceList(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(REDUCE_QUERY);
}

function subscribeReduced(onChange: () => void): () => void {
  const list = reduceList();
  if (!list) return () => {};
  if (typeof list.addEventListener === "function") {
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }
  list.addListener(onChange);
  return () => list.removeListener(onChange);
}

export function prefersReducedMotion(): boolean {
  return reduceList()?.matches ?? false;
}

/** True when the OS asks for reduced motion. Follows the setting live. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, prefersReducedMotion, () => false);
}

/** Monotonic milliseconds. */
export function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * How long a requested value must still wait before it may replace the
 * shown one: a shown value holds at least minMs from the moment it appeared.
 */
export function dwellWait(shownSince: number, now: number, minMs: number): number {
  return Math.max(0, minMs - (now - shownSince));
}

/**
 * Holds each value on screen at least minMs, so a burst of fast tool calls
 * never jitters the cat. The latest requested value wins when the hold ends.
 */
export function useDwell<T>(value: T, minMs: number): T {
  const [shown, setShown] = useState(value);
  const since = useRef(nowMs());
  useEffect(() => {
    if (Object.is(value, shown)) return;
    const timer = setTimeout(() => {
      since.current = nowMs();
      setShown(value);
    }, dwellWait(since.current, nowMs(), minMs));
    return () => clearTimeout(timer);
  }, [value, shown, minMs]);
  return shown;
}

export const QUIRKS = ["groom", "yawn", "stretch", "knead", "bat", "blink", "twitch"] as const;
export type Quirk = (typeof QUIRKS)[number];

/** How long a quirk plays: --cat-quirk in cats.css (1800ms), the same for every quirk. */
export const QUIRK_MS = 1800;

export const QUIRK_MIN_GAP_MS = 8000;
export const QUIRK_MAX_GAP_MS = 20000;

/** mulberry32: a tiny seeded PRNG, stable across runtimes. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface QuirkStep {
  /** Wait before the quirk plays, 8 to 20 s. */
  delay: number;
  quirk: Quirk;
}

/** A per-cat quirk schedule: the same seed always yields the same steps, never one quirk twice in a row. */
export function quirkSchedule(seed: number): () => QuirkStep {
  const rand = seededRandom(seed ^ 0x9e3779b9);
  let last: Quirk | null = null;
  return () => {
    const delay = QUIRK_MIN_GAP_MS + Math.floor(rand() * (QUIRK_MAX_GAP_MS - QUIRK_MIN_GAP_MS + 1));
    const pool = QUIRKS.filter((q) => q !== last);
    const quirk = pool[Math.floor(rand() * pool.length)]!;
    last = quirk;
    return { delay, quirk };
  };
}

function tabHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * Plays seeded quirks while enabled. A quirk due while the cat is offscreen
 * or the tab is hidden is skipped, and the next one is planned.
 */
export function useQuirks(enabled: boolean, seed: number, offscreen: RefObject<boolean>): Quirk | null {
  const [quirk, setQuirk] = useState<Quirk | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const next = quirkSchedule(seed);
    let timer: ReturnType<typeof setTimeout>;
    const plan = () => {
      const step = next();
      timer = setTimeout(() => {
        if (offscreen.current || tabHidden()) {
          plan();
          return;
        }
        setQuirk(step.quirk);
        timer = setTimeout(() => {
          setQuirk(null);
          plan();
        }, QUIRK_MS);
      }, step.delay);
    };
    plan();
    return () => {
      clearTimeout(timer);
      setQuirk(null);
    };
  }, [enabled, seed, offscreen]);
  return quirk;
}

/** A quirk asked for by the host (CatProps.playQuirk). */
export interface QuirkPlay {
  quirk: Quirk;
  key: number;
}

/**
 * Plays one quirk on demand: whenever play.key changes (never on mount),
 * the quirk plays once for QUIRK_MS, in any pose, outside the idle schedule.
 * Nothing plays while motion is off (reduced motion or still).
 */
export function usePlayQuirk(play: QuirkPlay | undefined, live: boolean): Quirk | null {
  const [playing, setPlaying] = useState<{ quirk: Quirk; n: number } | null>(null);
  const prev = useRef(play?.key);
  const key = play?.key;
  const quirk = play?.quirk;
  useEffect(() => {
    if (Object.is(prev.current, key)) return;
    prev.current = key;
    if (live && key !== undefined && quirk) setPlaying((p) => ({ quirk, n: (p?.n ?? 0) + 1 }));
  }, [key, quirk, live]);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setPlaying(null), QUIRK_MS);
    return () => clearTimeout(timer);
  }, [playing]);
  return live && playing ? playing.quirk : null;
}

export interface Offscreen {
  /** Read by the quirk scheduler without a render. */
  ref: RefObject<boolean>;
  /** The same fact as state, for the calm limit. */
  onscreen: boolean;
}

/**
 * Pauses every loop of a cat that is off screen or in a hidden tab:
 * data-offscreen on the root makes cats.css set animation-play-state:
 * paused. A cat counts as on screen until the observer says otherwise.
 */
export function useOffscreen(target: RefObject<Element | null>, enabled: boolean): Offscreen {
  const ref = useRef(false);
  const [onscreen, setOnscreen] = useState(true);
  useEffect(() => {
    const el = target.current;
    if (!el || !enabled) return;
    let intersecting = true;
    const apply = () => {
      const off = !intersecting || tabHidden();
      ref.current = off;
      if (off) el.setAttribute("data-offscreen", "");
      else el.removeAttribute("data-offscreen");
      setOnscreen(!off);
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            for (const entry of entries) intersecting = entry.isIntersecting;
            apply();
          });
    observer?.observe(el);
    document.addEventListener("visibilitychange", apply);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", apply);
      ref.current = false;
      el.removeAttribute("data-offscreen");
      setOnscreen(true);
    };
  }, [target, enabled]);
  return { ref, onscreen };
}

/**
 * The calm limit (JEV motion.intensity live_cap: cap_8). At most LIVE_CAP
 * cats on screen play their full beat; the rest drop to the calm layer
 * (breath and blink, the pose held, no quirks). Cats inside a CatCard come
 * first, then document order.
 */
export const LIVE_CAP = 8;

interface Slot {
  el: Element;
  rank: number;
}

const slots = new Set<Slot>();
const slotListeners = new Set<() => void>();
let ranked: Slot[] = [];

function byPlace(a: Slot, b: Slot): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.el === b.el) return 0;
  // DOCUMENT_POSITION_FOLLOWING: b comes after a
  return a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1;
}

function rerank(): void {
  ranked = [...slots].sort(byPlace);
  for (const listener of [...slotListeners]) listener();
}

/** Cats on screen that asked for a live slot, and how many hold one. */
export function liveSlots(): { onscreen: number; live: number } {
  return { onscreen: ranked.length, live: Math.min(LIVE_CAP, ranked.length) };
}

/** True while this cat is past the calm limit: it holds its pose and only breathes and blinks. */
export function useCalm(target: RefObject<Element | null>, active: boolean): boolean {
  const [calm, setCalm] = useState(false);
  useEffect(() => {
    const el = target.current;
    if (!el || !active) return;
    const slot: Slot = { el, rank: el.closest(".cat-card") ? 0 : 1 };
    const update = () => setCalm(ranked.indexOf(slot) >= LIVE_CAP);
    slotListeners.add(update);
    slots.add(slot);
    rerank();
    return () => {
      slots.delete(slot);
      slotListeners.delete(update);
      setCalm(false);
      rerank();
    };
  }, [target, active]);
  return active && calm;
}

/** The catch: the card flies in over --dur-600 and settles inside this window. */
export const CATCH_MS = 700;

/**
 * The catch: a waiting cat that starts working has got what it waited for,
 * so a task card flies into its paws once. Counts up on each catch, back to
 * 0 after CATCH_MS.
 */
export function useCatch(pose: Pose, live: boolean): number {
  const [catching, setCatching] = useState(0);
  const prev = useRef(pose);
  useEffect(() => {
    const from = prev.current;
    prev.current = pose;
    if (live && from === "wait" && WORK_POSES.has(pose)) setCatching((c) => c + 1);
  }, [pose, live]);
  useEffect(() => {
    if (!catching) return;
    const timer = setTimeout(() => setCatching(0), CATCH_MS);
    return () => clearTimeout(timer);
  }, [catching]);
  return live ? catching : 0;
}

function clampUnit(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

/** Where the pointer sits relative to the cat, each axis in -1..1. */
export function lookAt(rect: { left: number; top: number; width: number; height: number }, x: number, y: number): [number, number] {
  const span = Math.max(rect.width * 3, 240);
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height * 0.4;
  return [clampUnit((x - cx) / span), clampUnit((y - cy) / span)];
}

/**
 * Head and eyes follow the pointer: writes --cat-look-x and --cat-look-y on
 * the root, at most once per frame and only while the pointer moves (no
 * standing loop). cats.css turns them into a small transform.
 */
export function usePointerFollow(target: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = target.current;
    if (!el || !enabled || typeof window === "undefined") return;
    let frame = 0;
    let last: { x: number; y: number } | null = null;
    const write = (x: number, y: number) => {
      el.style.setProperty("--cat-look-x", x.toFixed(3));
      el.style.setProperty("--cat-look-y", y.toFixed(3));
    };
    const apply = () => {
      frame = 0;
      if (!last || el.hasAttribute("data-offscreen")) return;
      const [x, y] = lookAt(el.getBoundingClientRect(), last.x, last.y);
      write(x, y);
    };
    const onMove = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      last = null;
      write(0, 0);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      el.style.removeProperty("--cat-look-x");
      el.style.removeProperty("--cat-look-y");
    };
  }, [target, enabled]);
}

/** The celebration ends inside this window: hop, tail and prints run --dur-600, prints stagger 3 x --stagger-item. */
export const CELEBRATE_MS = 900;
/** Tap reaction: --dur-300. */
export const TAP_MS = 300;
/** Activity change: parts tween and art crossfades over --dur-300, the old art out over --dur-300-exit. */
export const CROSSFADE_MS = 300;
