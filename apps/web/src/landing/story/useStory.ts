// Plays a scripted story on one timer: the current step, the play count,
// and the queue of one-shot beats the Office scene drains through
// onBeatDone. One player serves both stories on the page: the hero's day
// (script.ts, loops) and the lifecycle (lifecycle.ts, plays once and rests
// on its last step until the visitor asks for a replay).
//
// The clock runs only while the story's element is on screen (the page
// says how much of it: the lifecycle waits until its floor is half in view,
// then keeps running while any real part of it shows), the tab is visible,
// and the visitor has not paused it. Under reduced motion a story
// rests on its poster step until the visitor presses play or picks a
// scene, and the scene then moves instantly (still). A paused story is
// still too, so pause stops every walk and loop in the office (WCAG
// 2.2.2), not only the clock.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { OfficeBeat } from "@mengai/cats";
import { usePrefersReducedMotion } from "@mengai/ui";
import { POSTER_STEP, START_STEP, STEPS, STORY_MS, beatsFor } from "./script";

/** A beat the scene never reports done leaves the queue after this long. */
export const BEAT_MAX_MS = 9_000;

export type StoryChoice = "auto" | "play" | "pause";

/** What a player needs from a script: the step times, the loop, the beats. */
export interface StoryScript {
  steps: readonly { at: number }[];
  /** one loop (or the one play), in ms */
  total: number;
  start: number;
  /** the still under reduced motion */
  poster: number;
  /** true: wrap to the first step; false: rest on the last step */
  loop: boolean;
  beats: (index: number, play: number) => OfficeBeat[];
}

export const HERO_SCRIPT: StoryScript = {
  steps: STEPS,
  total: STORY_MS,
  start: START_STEP,
  poster: POSTER_STEP,
  loop: true,
  beats: beatsFor,
};

export interface StoryPlayer {
  index: number;
  /** Counts every loop and every jump; beat ids and the caption key use it. */
  play: number;
  beats: OfficeBeat[];
  /** The clock is moving right now. */
  running: boolean;
  /** The visitor sees a pause control (true) or a play control (false). */
  playing: boolean;
  /** A one-play story reached its last step. */
  ended: boolean;
  /** Scene moves are instant: reduced motion, or the visitor paused. */
  still: boolean;
  /** Pause or play; after the end of a one-play story, play it again. */
  toggle: () => void;
  /** Plays the story from one step, whatever it was doing. */
  jump: (index: number) => void;
  done: (beatId: string) => void;
}

/** The step a story opens on: its start, or the poster under reduced motion. */
export function openingStep(reduced: boolean, script: StoryScript = HERO_SCRIPT): number {
  return reduced ? script.poster : script.start;
}

/** Delay from `elapsed` ms into the story until the step after `index` starts. */
export function nextDelay(index: number, elapsed: number, script: StoryScript = HERO_SCRIPT): number {
  const nextAt = index + 1 < script.steps.length ? script.steps[index + 1]!.at : script.total;
  return Math.max(0, nextAt - elapsed);
}

/** How much of the story's element must be in view: to start the clock, then to keep it running. */
export interface StoryVisibility {
  /** share of the element (or of the viewport, for an element taller than it) that starts the clock */
  start: number;
  /** share that keeps it running once started */
  stay: number;
}

export const DEFAULT_VISIBILITY: StoryVisibility = { start: 0.15, stay: 0.15 };

/** The share of the element in view, or of the viewport when the element is taller than the viewport. */
export function visibleShare(ratio: number, seen: number, rootHeight: number): number {
  return Math.max(ratio, rootHeight > 0 ? seen / rootHeight : 0);
}

function useOnScreen(ref: RefObject<HTMLElement | null>, vis: StoryVisibility): boolean {
  const [on, setOn] = useState(true);
  const started = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const root = e.rootBounds?.height ?? window.innerHeight;
          const share = visibleShare(e.intersectionRatio, e.intersectionRect.height, root);
          const need = started.current ? vis.stay : vis.start;
          const now = e.isIntersecting && share >= need - 0.001;
          if (now) started.current = true;
          setOn(now);
        }
      },
      { threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, vis.start, vis.stay]);
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

export function useStory(ref: RefObject<HTMLElement | null>, script: StoryScript = HERO_SCRIPT, visibility: StoryVisibility = DEFAULT_VISIBILITY): StoryPlayer {
  const reduced = usePrefersReducedMotion();
  const onScreen = useOnScreen(ref, visibility);
  const pageVisible = usePageVisible();
  const [choice, setChoice] = useState<StoryChoice>("auto");
  const [position, setPosition] = useState(() => ({ index: openingStep(reduced, script), play: 0, ended: false }));
  const [queue, setQueue] = useState<{ beat: OfficeBeat; born: number }[]>([]);
  const elapsed = useRef(script.steps[position.index]!.at);
  const emitted = useRef<string | null>(null);

  const { index, play, ended } = position;
  const wantsPlay = choice === "play" || (choice === "auto" && !reduced);
  const running = wantsPlay && onScreen && pageVisible && !ended;

  // Enter a step: queue its beats once per play. A new play (a loop or a
  // jump) starts a fresh queue.
  const lastPlay = useRef(play);
  useEffect(() => {
    if (!running) return;
    const key = `${play}:${index}`;
    if (emitted.current === key) return;
    emitted.current = key;
    const born = Date.now();
    const next = script.beats(index, play).map((beat) => ({ beat, born }));
    const fresh = lastPlay.current !== play;
    lastPlay.current = play;
    setQueue((q) => (fresh ? next : [...q, ...next]));
  }, [running, index, play, script]);

  // The one timer: advance to the next step, wrap to a new loop, or rest
  // on the last step of a one-play story.
  useEffect(() => {
    if (!running) return;
    const since = Date.now();
    const start = elapsed.current;
    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
      const nextIndex = index + 1;
      if (nextIndex < script.steps.length) {
        elapsed.current = script.steps[nextIndex]!.at;
        setPosition({ index: nextIndex, play, ended: false });
      } else if (script.loop) {
        elapsed.current = 0;
        setPosition({ index: 0, play: play + 1, ended: false });
      } else {
        elapsed.current = script.total;
        setPosition({ index, play, ended: true });
      }
    }, nextDelay(index, start, script));
    return () => {
      clearTimeout(timer);
      // Paused or scrolled away mid-step: keep the time already played.
      if (!fired) elapsed.current = Math.min(start + (Date.now() - since), script.total - 1);
    };
  }, [running, index, play, script]);

  // Beats the scene never reports done still leave the queue.
  useEffect(() => {
    if (queue.length === 0) return;
    const oldest = Math.min(...queue.map((q) => q.born));
    const timer = setTimeout(
      () => {
        const now = Date.now();
        setQueue((q) => q.filter((x) => now - x.born < BEAT_MAX_MS));
      },
      Math.max(0, oldest + BEAT_MAX_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [queue]);

  const done = useCallback((beatId: string) => {
    setQueue((q) => q.filter((x) => x.beat.id !== beatId));
  }, []);

  const jump = useCallback(
    (to: number) => {
      const target = Math.max(0, Math.min(to, script.steps.length - 1));
      elapsed.current = script.steps[target]!.at;
      setChoice("play");
      setPosition((p) => ({ index: target, play: p.play + 1, ended: false }));
    },
    [script],
  );

  const toggle = useCallback(() => {
    if (ended) {
      jump(script.start);
      return;
    }
    setChoice(() => (wantsPlay ? "pause" : "play"));
  }, [ended, jump, script.start, wantsPlay]);

  return {
    index,
    play,
    beats: queue.map((q) => q.beat),
    running,
    playing: wantsPlay && !ended,
    ended,
    still: reduced || !wantsPlay,
    toggle,
    jump,
    done,
  };
}
