// Plays the scripted story (script.ts) on one timer: the current step, the
// loop count, and the queue of one-shot beats the Office scene drains
// through onBeatDone. The clock runs only while the hero is on screen, the
// tab is visible, and the visitor has not paused it. Under reduced motion
// the story rests on its poster step until the visitor presses play, and
// the scene then moves instantly (still).
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { OfficeBeat } from "@mengai/cats";
import { usePrefersReducedMotion } from "@mengai/ui";
import { POSTER_STEP, STEPS, STORY_MS, beatsFor } from "./script";

/** A beat the scene never reports done leaves the queue after this long. */
export const BEAT_MAX_MS = 7_000;

export type StoryChoice = "auto" | "play" | "pause";

export interface StoryPlayer {
  index: number;
  loop: number;
  beats: OfficeBeat[];
  /** The clock is moving right now. */
  running: boolean;
  /** The visitor sees a pause control (true) or a play control (false). */
  playing: boolean;
  /** Scene moves are instant: reduced motion. */
  still: boolean;
  toggle: () => void;
  done: (beatId: string) => void;
}

/** Delay from `elapsed` ms into the loop until the step after `index` starts. */
export function nextDelay(index: number, elapsed: number): number {
  const nextAt = index + 1 < STEPS.length ? STEPS[index + 1]!.at : STORY_MS;
  return Math.max(0, nextAt - elapsed);
}

function useOnScreen(ref: RefObject<HTMLElement | null>): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setOn(e.isIntersecting);
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

export function useStory(ref: RefObject<HTMLElement | null>): StoryPlayer {
  const reduced = usePrefersReducedMotion();
  const onScreen = useOnScreen(ref);
  const pageVisible = usePageVisible();
  const [choice, setChoice] = useState<StoryChoice>("auto");
  const [position, setPosition] = useState({ index: POSTER_STEP, loop: 0 });
  const [queue, setQueue] = useState<{ beat: OfficeBeat; born: number }[]>([]);
  const elapsed = useRef(STEPS[POSTER_STEP]!.at);
  const emitted = useRef<string | null>(null);

  const wantsPlay = choice === "play" || (choice === "auto" && !reduced);
  const running = wantsPlay && onScreen && pageVisible;

  // Enter a step: queue its beats once per loop.
  const { index, loop } = position;
  useEffect(() => {
    if (!running) return;
    const key = `${loop}:${index}`;
    if (emitted.current === key) return;
    emitted.current = key;
    const born = Date.now();
    const next = beatsFor(index, loop).map((beat) => ({ beat, born }));
    setQueue((q) => (index === 0 ? next : [...q, ...next]));
  }, [running, index, loop]);

  // The one timer: advance to the next step, or wrap to a new loop.
  useEffect(() => {
    if (!running) return;
    const since = Date.now();
    const start = elapsed.current;
    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
      const nextIndex = index + 1;
      if (nextIndex < STEPS.length) {
        elapsed.current = STEPS[nextIndex]!.at;
        setPosition({ index: nextIndex, loop });
      } else {
        elapsed.current = 0;
        setPosition({ index: 0, loop: loop + 1 });
      }
    }, nextDelay(index, start));
    return () => {
      clearTimeout(timer);
      // Paused or scrolled away mid-step: keep the time already played.
      if (!fired) elapsed.current = Math.min(start + (Date.now() - since), STORY_MS - 1);
    };
  }, [running, index, loop]);

  // Beats the scene never reports done still leave the queue.
  useEffect(() => {
    if (queue.length === 0) return;
    const oldest = Math.min(...queue.map((q) => q.born));
    const timer = setTimeout(() => {
      const now = Date.now();
      setQueue((q) => q.filter((x) => now - x.born < BEAT_MAX_MS));
    }, Math.max(0, oldest + BEAT_MAX_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [queue]);

  const done = useCallback((beatId: string) => {
    setQueue((q) => q.filter((x) => x.beat.id !== beatId));
  }, []);

  const toggle = useCallback(() => {
    setChoice(() => (wantsPlay ? "pause" : "play"));
  }, [wantsPlay]);

  return {
    index,
    loop,
    beats: queue.map((q) => q.beat),
    running,
    playing: wantsPlay,
    still: reduced,
    toggle,
    done,
  };
}
