// Motion logic for the cat: the reduced motion query, the activity dwell,
// the seeded quirk schedule, the offscreen pause, and pointer follow. Every
// loop itself is a CSS keyframe on transform or opacity (cats.css); this
// file only decides which classes and attributes are on, with timeouts,
// never an animation frame loop.
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

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

export const QUIRKS = ["groom", "yawn", "stretch", "knead", "bat", "blink"] as const;
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
        const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
        if (offscreen.current || hidden) {
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

/**
 * Pauses every loop of an offscreen cat: data-offscreen on the root makes
 * cats.css set animation-play-state: paused. Returns a ref the quirk
 * scheduler reads.
 */
export function useOffscreen(target: RefObject<Element | null>, enabled: boolean): RefObject<boolean> {
  const offscreen = useRef(false);
  useEffect(() => {
    const el = target.current;
    if (!el || !enabled || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        offscreen.current = !entry.isIntersecting;
        if (offscreen.current) el.setAttribute("data-offscreen", "");
        else el.removeAttribute("data-offscreen");
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      offscreen.current = false;
      el.removeAttribute("data-offscreen");
    };
  }, [target, enabled]);
  return offscreen;
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
/** Activity crossfade: the new pose fades in over --dur-300, the old one out over --dur-300-exit. */
export const CROSSFADE_MS = 300;
