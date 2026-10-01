// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The stage: a transparent region under the island where the cats of a
// moment come out (docs/superpowers/specs/2026-10-01-island-moments-design.md,
// sections 4.1, 5 and 8). A sibling of the shape, never its child: each
// resting cat box touches the stage's top edge (the shape's bottom edge),
// side by side, never overlapping. No text at all: the stage sits over any
// app, so every word stays inside the black shape; the moment's sentence
// is the region's accessible name.
//
// Moves, on top of what the cat's own rig beat and quirks do:
//   emerge  slides down out of the island (translateY -100% to 0, --dur-300) and stays
//   visit   emerges, holds, goes back up (--dur-300-exit) so it is gone when the moment ends
//   hop     emerges, then one hop: translateY up 8 px and back (--dur-300)
//   leave   emerges, holds, then slides to the side and fades (--dur-300-exit)
// An unanswered ask nudges with one hop every 20 s. Everything is a pure
// function of the time since the moment came on (planStage, phaseAt), driven
// by timeouts at each change, never a standing frame loop. Under reduced
// motion (or the owner's motion setting "off") the cats sit still at their
// resting frame for the whole moment and appear and go at once.
import { Cat } from "@mengai/cats/src/cat";
import { activityWords, type Pose } from "@mengai/cats/src/poses";
import { ROLE_LABEL, type Activity, type AgentStatus } from "@mengai/shared";
import { AnimatePresence, motion, useIsPresent, type TargetAndTransition } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isAsk } from "./director";
import type { Moment, StageCat } from "./moment-types";
import { EASE, INSTANT } from "./motion";

/** A cat on the stage; quirk moments use the mini size. */
export const CAT_SIZE = 48;
export const QUIRK_CAT_SIZE = 32;
/**
 * Every cat's slot and target (--space-48px): a 48 pt cat fills it, a 32 pt
 * quirk cat sits at its top centre and is still a full target, past 44 pt.
 */
export const SLOT = 48;
/** --space-8px between cats in a row. */
export const STAGE_GAP = 8;
/** --dur-300: the slide out of the island and the hop. */
export const ENTER_MS = 300;
export const HOP_MS = 300;
/** --dur-300-exit: back up, or away to the side. */
export const EXIT_MS = 210;
/** How far a hop lifts the cat, in points. */
export const HOP_PX = 8;
/** An unanswered ask nudges once every NUDGE_MS. */
export const NUDGE_MS = 20_000;

const ENTER_T = { duration: ENTER_MS / 1000, ease: EASE } as const;
const EXIT_T = { duration: EXIT_MS / 1000, ease: EASE } as const;
const HOP_T = { duration: HOP_MS / 1000, ease: EASE, times: [0, 0.5, 1] };

/** A box in stage-local points (the same shape as a native hit rect). */
export interface StageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CatPlan {
  index: number;
  size: 32 | 48;
  /** the cat's target (its slot), resting: y is always 0 */
  rect: StageRect;
  /** the slide out of the island starts and ends (ms since the moment came on) */
  enterAt: number;
  restAt: number;
  /** the exit starts, null while the moment lasts */
  exitAt: number | null;
  exit: "up" | "side";
  /** where a leave ends, in points along x; it never takes the cat past the stage's side */
  leaveX: number;
  /** one hop once out */
  hop: boolean;
  /** an unanswered ask: one hop every NUDGE_MS */
  nudge: boolean;
  /** reduced motion: still for the whole moment */
  still: boolean;
}

export type CatPhase = "waiting" | "entering" | "resting" | "hopping" | "exiting" | "gone";

const SHOWN: ReadonlySet<CatPhase> = new Set<CatPhase>(["entering", "resting", "hopping"]);

export function catSizeFor(m: Moment): 32 | 48 {
  return m.type === "quirk" ? QUIRK_CAT_SIZE : CAT_SIZE;
}

/** The narrowest stage that holds a row of cats without touching or overlapping. */
export function minStageWidth(count: number): number {
  const n = Math.max(1, count);
  return n * SLOT + (n - 1) * STAGE_GAP;
}

/**
 * The resting row: centred, every box on the top edge (y 0), STAGE_GAP
 * apart (less only if the stage is too narrow for the gap, never negative,
 * so two cats never overlap).
 */
export function stageLayout(width: number, count: number): StageRect[] {
  const hit = SLOT;
  const n = Math.max(0, count);
  if (n === 0) return [];
  const gap = n > 1 ? Math.max(0, Math.min(STAGE_GAP, (width - n * hit) / (n - 1))) : 0;
  const row = n * hit + (n - 1) * gap;
  const x0 = Math.max(0, (width - row) / 2);
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (hit + gap), y: 0, width: hit, height: hit }));
}

/**
 * True when `next` carries on the scene `prev` set: the owner's answer to an
 * ask (same askId) played by the same cats in the same places. Those cats
 * are already out, so they stay and only change pose; no second entrance.
 */
export function continues(prev: Moment | null, next: Moment | null): boolean {
  if (!prev || !next || prev.id === next.id) return false;
  if (prev.askId === undefined || prev.askId !== next.askId) return false;
  if (prev.cats.length !== next.cats.length || catSizeFor(prev) !== catSizeFor(next)) return false;
  return prev.cats.every((c, i) => c.cat.id !== null && c.cat.id === next.cats[i]!.cat.id);
}

/**
 * Every cat's timeline for one moment, in the moment's own order, left to
 * right (the deriver places them; the stage never reorders). `continued`:
 * the cats are already out from the moment this one carries on (continues).
 */
export function planStage(m: Moment, width: number, reduced: boolean, continued = false): CatPlan[] {
  const cats = m.cats.slice(0, 3);
  const size = catSizeFor(m);
  const rects = stageLayout(width, cats.length);
  const mid = (cats.length - 1) / 2;
  return cats.map((c, i) => {
    const rect = rects[i]!;
    const enterAt = reduced || continued ? 0 : Math.max(0, c.delayMs);
    const restAt = reduced || continued ? 0 : enterAt + ENTER_MS;
    const ends = c.move === "visit" || c.move === "leave";
    const exitAt = reduced || !ends || m.ms === null ? null : Math.max(restAt, m.ms - EXIT_MS);
    const side = i < mid ? -1 : 1;
    const room = side > 0 ? width - (rect.x + rect.width) : rect.x;
    return {
      index: i,
      size,
      rect,
      enterAt,
      restAt,
      exitAt,
      exit: c.move === "leave" ? "side" : "up",
      leaveX: side * Math.max(0, Math.min(rect.width / 2, room)) || 0,
      hop: !reduced && c.move === "hop",
      nudge: !reduced && isAsk(m),
      still: reduced,
    };
  });
}

/** Every hop start up to t: the hop move once out, then the ask's nudges. */
function hopStarts(p: CatPlan, t: number): number[] {
  const out: number[] = [];
  if (p.hop && t >= p.restAt) out.push(p.restAt);
  if (p.nudge) {
    const k = Math.floor(t / NUDGE_MS);
    if (k >= 1 && k * NUDGE_MS >= p.restAt) out.push(k * NUDGE_MS);
  }
  return out.filter((s) => p.exitAt === null || s < p.exitAt);
}

/** How many hops a cat has started by t (the nudge count is a pure function of elapsed time). */
export function hopsBy(p: CatPlan, t: number): number {
  let n = p.hop && t >= p.restAt && (p.exitAt === null || p.restAt < p.exitAt) ? 1 : 0;
  if (p.nudge) n += Math.floor(Math.max(0, t) / NUDGE_MS);
  return n;
}

export function phaseAt(p: CatPlan, t: number): CatPhase {
  if (p.still) return "resting";
  if (t < p.enterAt) return "waiting";
  if (p.exitAt !== null) {
    if (t >= p.exitAt + EXIT_MS) return "gone";
    if (t >= p.exitAt) return "exiting";
  }
  if (t < p.restAt) return "entering";
  const last = Math.max(-Infinity, ...hopStarts(p, t));
  return t < last + HOP_MS ? "hopping" : "resting";
}

/** The next time after t when any cat's phase changes, null when nothing will. */
export function nextChange(plans: readonly CatPlan[], t: number): number | null {
  let best = Infinity;
  const take = (v: number | null) => {
    if (v !== null && v > t && v < best) best = v;
  };
  for (const p of plans) {
    if (p.still) continue;
    take(p.enterAt);
    take(p.restAt);
    if (p.hop) take(p.restAt + HOP_MS);
    if (p.exitAt !== null) {
      take(p.exitAt);
      take(p.exitAt + EXIT_MS);
    }
    if (p.nudge) {
      const k = Math.floor(t / NUDGE_MS);
      if (k >= 1) take(k * NUDGE_MS + HOP_MS);
      take((k + 1) * NUDGE_MS);
    }
  }
  return best === Infinity ? null : best;
}

/** The boxes the shell makes clickable at t: every cat that is out and not on its way back. */
export function clickableRects(plans: readonly CatPlan[], t: number): StageRect[] {
  return plans.filter((p) => SHOWN.has(phaseAt(p, t))).map((p) => ({ ...p.rect }));
}

/** The rig's status and activity for a stage pose: "stopped" lies down, an ask looks up alert. */
export function poseState(pose: Pose): { status: AgentStatus; activity: Activity } {
  if (pose === "stopped") return { status: "stopped", activity: "rest" };
  const status: AgentStatus =
    pose === "ask" ? "approval" : pose === "wait" ? "waiting" : pose === "think" ? "thinking" : pose === "rest" || pose === "celebrate" ? "idle" : "working";
  return { status, activity: pose };
}

export function stageCatLabel(c: StageCat): string {
  const who = c.cat.role === "lead" ? "the CEO" : (ROLE_LABEL[c.cat.role] ?? "crew");
  const what = c.pose === "stopped" ? "stopped" : activityWords(c.pose).toLowerCase();
  return `${c.cat.name}, ${who}, ${what}`;
}

/**
 * Milliseconds since `id` came on (it restarts when id changes), advanced by
 * one timeout to each `due`; no frame loop.
 */
function useElapsed(id: string, next: (t: number) => number | null): number {
  const [clock, setClock] = useState({ id, t: 0 });
  const start = useRef<{ id: string; at: number } | null>(null);
  let t = clock.t;
  if (clock.id !== id) {
    t = 0;
    setClock({ id, t: 0 });
  }
  const due = next(t);
  useEffect(() => {
    if (!start.current || start.current.id !== id) start.current = { id, at: performance.now() };
    if (due === null) return;
    const s = start.current;
    const timer = setTimeout(
      () => setClock((c) => (c.id === s.id ? { id: c.id, t: Math.max(due, performance.now() - s.at) } : c)),
      Math.max(0, due - (performance.now() - s.at)),
    );
    return () => clearTimeout(timer);
  }, [id, due]);
  return t;
}

/** Up into the island by the cat's own height (translateY -100%), in points so no unit is converted. */
function above(p: CatPlan): number {
  return -p.rect.height;
}

function outTarget(p: CatPlan): TargetAndTransition {
  return p.exit === "side" ? { x: p.leaveX, opacity: 0, transition: EXIT_T } : { y: above(p), transition: EXIT_T };
}

function targetFor(p: CatPlan, phase: CatPhase): TargetAndTransition {
  if (p.still) return { x: 0, y: 0, opacity: 1, transition: INSTANT };
  if (phase === "exiting") return outTarget(p);
  if (phase === "hopping") return { x: 0, y: [0, -HOP_PX, 0], opacity: 1, transition: HOP_T };
  return { x: 0, y: 0, opacity: 1, transition: ENTER_T };
}

interface CatViewProps {
  moment: Moment;
  plan: CatPlan;
  phase: CatPhase;
  /** out and staying: a cat on its way back (or a moment on its way out) takes no click and no focus */
  clickable: boolean;
  onCatClick: (m: Moment, i: number) => void;
}

function StageCatView({ moment, plan, phase, clickable, onCatClick }: CatViewProps) {
  const c = moment.cats[plan.index]!;
  const { status, activity } = poseState(c.pose);
  const label = stageCatLabel(c);
  const out = phase === "resting" || phase === "hopping";
  return (
    <motion.div
      className="moment-mover"
      initial={plan.still ? false : { x: 0, y: above(plan), opacity: 1 }}
      animate={targetFor(plan, phase)}
      exit={plan.still ? undefined : outTarget(plan)}
    >
      <button type="button" className="moment-cat" aria-label={label} disabled={!clickable} onClick={() => onCatClick(moment, plan.index)}>
        <Cat
          look={c.cat.look}
          role={c.cat.role}
          status={status}
          activity={activity}
          mood={c.cat.mood}
          label={label}
          size={plan.size}
          interactive
          still={plan.still}
          holding={c.prop}
          playQuirk={c.quirk && out && !plan.still ? { quirk: c.quirk, key: 1 } : undefined}
        />
      </button>
    </motion.div>
  );
}

interface RowProps {
  moment: Moment;
  /** the cats are already out: this moment carries on the one that opened the scene */
  continued: boolean;
  reduced: boolean;
  width: number;
  onCatClick: (m: Moment, i: number) => void;
  report: (rects: StageRect[]) => void;
}

/**
 * One scene's cats: keyed by the moment that opened it, so the clock starts
 * when it comes on and restarts for a moment that carries it on.
 */
function MomentCats({ moment, continued, reduced, width, onCatClick, report }: RowProps) {
  const present = useIsPresent();
  const plans = useMemo(() => planStage(moment, width, reduced, continued), [moment, width, reduced, continued]);
  const t = useElapsed(moment.id, (now) => nextChange(plans, now));
  const rects = present ? clickableRects(plans, t) : [];
  const key = JSON.stringify(rects);
  useEffect(() => {
    report(JSON.parse(key) as StageRect[]);
  }, [key, report]);
  return (
    <motion.div className="moment-cats" data-type={moment.type}>
      {plans.map((p) => {
        const phase = phaseAt(p, t);
        // while its cat slides out, hops or goes back up, the slot clips at its top edge (the
        // shape's bottom edge), so the cat comes out of the island; a leave goes sideways, unclipped
        const vertical = phase === "entering" || phase === "hopping" || ((phase === "exiting" || !present) && p.exit === "up");
        const clip = !reduced && vertical;
        return (
          <div key={p.index} className="moment-slot" data-phase={phase} data-clip={clip ? "" : undefined} style={{ left: p.rect.x }}>
            {phase === "waiting" || phase === "gone" ? null : (
              <StageCatView moment={moment} plan={p} phase={phase} clickable={present && SHOWN.has(phase)} onCatClick={onCatClick} />
            )}
          </div>
        );
      })}
    </motion.div>
  );
}

export interface StageProps {
  moment: Moment | null;
  reduced: boolean;
  /** the stage's box in points, from the shell (shape plus stage = the window) */
  width: number;
  height: number;
  onCatClick: (m: Moment, i: number) => void;
  /** the clickable cats' boxes in stage-local points, whenever they change */
  onCatRects: (rects: StageRect[]) => void;
}

/** The scene a moment belongs to: its own id, or the scene of the moment it carries on. */
function useScene(moment: Moment | null): string | null {
  const [scene, setScene] = useState<{ moment: Moment | null; key: string | null }>({ moment, key: moment?.id ?? null });
  if (scene.moment === moment) return scene.key;
  const same = !!moment && !!scene.moment && (scene.moment.id === moment.id || continues(scene.moment, moment));
  const key = moment ? (same ? scene.key : moment.id) : null;
  setScene({ moment, key });
  return key;
}

export function Stage({ moment, reduced, width, height, onCatClick, onCatRects }: StageProps) {
  const scene = useScene(moment);
  const sink = useRef(onCatRects);
  // before any passive effect, so a row's report always reaches the latest callback
  useLayoutEffect(() => {
    sink.current = onCatRects;
  }, [onCatRects]);
  const last = useRef<string | null>(null);
  const report = useCallback((rects: StageRect[]) => {
    const key = JSON.stringify(rects);
    if (key === last.current) return;
    last.current = key;
    sink.current(rects);
  }, []);
  useEffect(() => {
    if (!moment) report([]);
  }, [moment, report]);
  return (
    <div
      className="moment-stage"
      role={moment ? "group" : undefined}
      aria-label={moment ? moment.text : undefined}
      aria-hidden={moment ? undefined : true}
      data-motion={reduced ? "still" : "live"}
      style={{ width, height }}
    >
      <AnimatePresence mode="wait" initial>
        {moment && scene ? (
          <MomentCats key={scene} moment={moment} continued={moment.id !== scene} reduced={reduced} width={width} onCatClick={onCatClick} report={report} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
