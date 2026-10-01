// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The island itself: one black shape that merges with the notch. The band
// (the notch row) holds a mini Oyen in the left ear and the progress ring
// with the stage in the right ear; the body under it grows for a peek at
// the crew, an approval, the ship, or a failure. The machine (machine.ts)
// says which view shows and its exact size; this file morphs the shape
// there on a Motion spring (width, height, corners) and keeps the native
// window in step: the window grows first (island_set_state with the union
// of both sizes), the shape morphs into it, and a shrinking window follows
// once the morph has settled, so the window never clips what shows and
// never covers more than it shows.
//
// Containers (JEV ui.region_gate, verified jev-1.13.0): band plain spacing
// (0.61), peek crew as rows (0.55) with three rows (1.00), the ask panel
// plain spacing inside the island (0.43), the failure alert kept (0.81).
// Approvals always need a click: nothing here answers on its own.
// Content changes wait for the old content to fade out before the new one
// fades in (AnimatePresence mode "wait"): one thing moves at a time, and
// no style element is injected, which the engine's style-src 'self' CSP
// would refuse (the popLayout mode writes one).
//
// The moments (useIslandMoments) play on the stage under the shape, a
// sibling of it (Stage.tsx), and every word about them stays inside the
// black shape: the ear says what changed and who ("Kopi joined"), a
// finished stage pops the body with its sentence, an ask keeps its answer
// panel while the asking cat holds the object of the ask under it, and a
// visually hidden polite region reads each moment's sentence out. Around
// that the island lives on its own: the ring draws the done and the
// running share in the tone of the run, the ear rotates what is true now,
// a quiet run tucks into the notch, and the pointer passing near on its
// way to the menu bar folds the ears away (spec sections 5 to 8). While
// they are folded the window is the bare notch, so the page hands the
// shell the footprint they come back to (island_set_state band) and the
// shell keeps the pointer near over it: a menu bar item where an ear was
// stays clickable, the ears return only after far for FAR_RETURN_MS.
import { Cat } from "@mengai/cats/src/cat";
import { ACTIVITY_LABEL, ROLE_LABEL, type OrderDTO } from "@mengai/shared";
import { ProductIcon } from "@mengai/ui/src/product/icons";
import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { errorMessage, type ApiClient } from "../api/client";
import { askAnswer, requestAnswer } from "../app/run/answer";
import { ASK_TYPES, isAsk, type Cue } from "./director";
import type { Ask, CatAsk, IslandModel, MiniCat } from "./live";
import {
  PEEK_ROWS,
  SHIP_MS,
  bandOf,
  earTexts,
  estimateText,
  fitLine,
  frameOf,
  grows,
  headTextWidth,
  hitOf,
  momentEarTexts,
  pickView,
  rowTextWidth,
  shrinks,
  unionSize,
  windowOf,
  type EarInput,
  type Frame,
  type IslandView,
  type Measure,
  type StageBox,
} from "./machine";
import type { Moment } from "./moment-types";
import { askMoments } from "./moments";
import { EASE, FADE_IN, FADE_OUT, HOVER_IN_MS, HOVER_OUT_MS, INSTANT, MORPH, RESULT_MS, RING_T } from "./motion";
import type { HitRect, IslandBridge, IslandGeometry, NativeSize } from "./native";
import { EAR_CYCLE_MS, earCycle, earIndex, newsKey, ringOf, tuckState, type EarItem, type Ring as RingState } from "./progress";
import { EXIT_MS, Stage, minStageWidth, type StageRect } from "./Stage";
import type { IslandMoments } from "./useIslandMoments";

/** The ears fold into the notch on --dur-150-exit: out of the way at once. */
const FOLD = { duration: 0.11, ease: EASE } as const;
/**
 * The pointer far this long brings the folded ears back (spec section 6).
 * Far is measured beside the ears' footprint while they are folded (the
 * band the page sends), so a pointer resting where an ear was never reads
 * far and the ears never come back under it.
 */
export const FAR_RETURN_MS = 600;
/** The stage stays in the window this long after its moment ends, for the cats' way back up (--dur-300-exit plus a frame). */
const STAGE_HOLD_MS = EXIT_MS + 40;
/** A window drop that no morph end will call (only the stage left) waits out a morph still in flight. */
const SETTLE_MS = 320;

export interface Answered {
  ask: Ask;
  decision: "approve" | "deny";
  /** the engine's answer to an order decision */
  order: OrderDTO | null;
}

export interface IslandProps {
  model: IslandModel;
  geometry: IslandGeometry;
  bridge: IslandBridge;
  /** the engine; null in the preview with sample data, where answers land in the page */
  api: ApiClient | null;
  /** OS reduced motion or the owner's motion setting "off": instant changes, still cats */
  reduced: boolean;
  /** the preview shows the peek without a pointer */
  forceHover?: boolean;
  measure?: Measure;
  now?: () => number;
  /** an answer landed: the feed takes the order back from the engine */
  onAnswered?: (a: Answered) => void;
  /** the ship celebration ended, or the owner dismissed the failure */
  onFinishDone?: () => void;
  /** the moments on the stage (useIslandMoments); without it the stage stays empty */
  moments?: IslandMoments | null;
  /** bumps when the preview's clock jumps forward, so the tuck and the rotation look again */
  clockEpoch?: number;
}

interface Shape {
  width: number;
  height: number;
  top: number;
  bottom: number;
}

function shapeOf(f: Frame): Shape {
  return { width: f.width, height: f.height, top: f.radius.top, bottom: f.radius.bottom };
}

function sameShape(a: Shape, b: Shape): boolean {
  return a.width === b.width && a.height === b.height && a.top === b.top && a.bottom === b.bottom;
}

function nextFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => fn());
  else setTimeout(fn, 16);
}

function sameExtras(a: NativeSize, b: NativeSize): boolean {
  return JSON.stringify([a.hit ?? null, a.band ?? null]) === JSON.stringify([b.hit ?? null, b.band ?? null]);
}

/**
 * A window of `win` size around the frame, with the parts that take the
 * pointer, and while the ears are folded (`band`, the open band's width,
 * wider than the window) the footprint they come back to: centred like
 * the window, so it starts (win - band) / 2 in, left of the window's edge.
 */
function sized(t: Frame, win: { width: number; height: number }, cats: readonly HitRect[], band = 0): NativeSize {
  const out: NativeSize = { state: t.native, width: win.width, height: win.height };
  const hit = hitOf(t, win, cats);
  if (hit) out.hit = hit;
  if (band > win.width) out.band = { x: (win.width - band) / 2, width: band };
  return out;
}

export interface NativeFrame {
  /** the shape the morph heads for */
  shown: Shape;
  /** the stage, once the window holds it */
  stage: StageBox | null;
  onMorphDone: () => void;
  booted: boolean;
}

/**
 * The shape the page shows and the window it sits in, the window being the
 * union of the shape and the stage under it (windowOf). A new target first
 * grows the window to the union of where it is and where it goes, then
 * hands the target to the morph and the stage; when the morph settles the
 * window drops to the target exactly. A stage alone has no morph to wait
 * for: its cats are back up before it leaves the frame (the hold in
 * Island), so the window drops right after. Targets that land in one tick
 * (a measure right after a view change) coalesce into one window call. The
 * clickable cats (`cats`, stage-local) ride along as hit rects, and the
 * folded ears' footprint (`band`, its width, 0 for none) as the band; a
 * change of those alone resends the same window with the new ones. An
 * unmount ends the turn, so no pending drop reaches the shell after it.
 */
export function useNativeFrame(target: Frame, bridge: IslandBridge, reduced: boolean, cats: readonly HitRect[] = [], band = 0): NativeFrame {
  const [shown, setShown] = useState<Shape>(() => shapeOf(target));
  const [stage, setStage] = useState<StageBox | null>(null);
  // Until the first size lands, changes are instant: a load never plays a morph.
  const [booted, setBooted] = useState(false);
  const bootedRef = useRef(false);
  bootedRef.current = booted;
  const targetRef = useRef(target);
  targetRef.current = target;
  const catsRef = useRef(cats);
  catsRef.current = cats;
  const bandRef = useRef(band);
  bandRef.current = band;
  const windowRef = useRef<NativeSize | null>(null);
  const turn = useRef(0);
  // every pending step checks its turn: a new turn on unmount leaves them all with nothing to do
  useEffect(() => () => {
    turn.current++;
  }, []);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const send = useCallback(
    async (size: NativeSize) => {
      const prev = windowRef.current;
      if (prev && prev.state === size.state && prev.width === size.width && prev.height === size.height && sameExtras(prev, size)) return;
      windowRef.current = size;
      try {
        await bridge.setState(size);
      } catch {
        // the shell refused a size: the next change tries again
      }
    },
    [bridge],
  );

  const settle = useCallback(() => {
    const t = targetRef.current;
    void send(sized(t, windowOf(t), catsRef.current, bandRef.current));
  }, [send]);

  const box = target.stage;
  const key = `${target.native}:${target.width}x${target.height}:${target.radius.top}/${target.radius.bottom}:${box ? `${box.width}x${box.height}` : "-"}`;
  useEffect(() => {
    const mine = ++turn.current;
    queueMicrotask(() => {
      void (async () => {
        if (mine !== turn.current) return;
        const t = targetRef.current;
        const win = windowRef.current;
        const exact = windowOf(t);
        const moving = !win || win.state !== t.native || grows(win, exact);
        if (!win || reducedRef.current || !bootedRef.current) {
          // Nothing morphs (reduced motion, or the first sizes): grow the window, show, then drop it.
          if (moving) await send(sized(t, exact, catsRef.current, bandRef.current));
          if (mine !== turn.current) return;
          setShown(shapeOf(t));
          setStage(t.stage);
          if (!win) nextFrame(() => nextFrame(() => setBooted(true)));
          if (win && shrinks(win, exact)) setTimeout(() => mine === turn.current && settle(), 0);
          return;
        }
        if (moving) await send(sized(t, unionSize(win, exact), catsRef.current, bandRef.current));
        if (mine !== turn.current) return;
        const noMorph = sameShape(shownRef.current, shapeOf(t));
        setShown(shapeOf(t));
        setStage(t.stage);
        if (noMorph && shrinks(win, exact)) setTimeout(() => mine === turn.current && settle(), SETTLE_MS);
      })();
    });
  }, [key, send, settle]);

  // The clickable cats changed (one came out, one went back up), or the folded ears'
  // footprint did: same window, new hit rects and band.
  const extrasKey = `${JSON.stringify(cats)}:${band}`;
  useEffect(() => {
    const win = windowRef.current;
    if (!win) return;
    void send(sized(targetRef.current, { width: win.width, height: win.height }, catsRef.current, bandRef.current));
  }, [extrasKey, send]);

  const onMorphDone = useCallback(() => {
    if (turn.current === 0) return;
    if (!sameShape(shapeOf(targetRef.current), shownRef.current)) return;
    settle();
  }, [settle]);

  return { shown, stage, onMorphDone, booted };
}

/** The moment that ended stays this long for the frame, so the window holds the cats on their way back up. */
function useHeld<T>(value: T | null, holdMs: number): T | null {
  const [held, setHeld] = useState<T | null>(value);
  useEffect(() => {
    if (value !== null || holdMs <= 0) {
      setHeld(value);
      return;
    }
    const timer = setTimeout(() => setHeld(null), holdMs);
    return () => clearTimeout(timer);
  }, [value, holdMs]);
  return value ?? held;
}

/**
 * Tucked: a live run with no news for TUCK_MS (progress.tuckState). News
 * (a new key) brings it out; so does the pointer, and once out it stays at
 * least UNTUCK_MIN_MS. One timeout to the time the answer flips.
 */
function useTuck(key: string, live: boolean, hover: boolean, now: () => number, epoch: number): boolean {
  const lastNews = useRef<number | null>(null);
  const untucked = useRef(Number.NEGATIVE_INFINITY);
  const [tucked, setTucked] = useState(false);
  const [wake, setWake] = useState(0);
  const nowRef = useRef(now);
  nowRef.current = now;
  useEffect(() => {
    lastNews.current = nowRef.current();
  }, [key]);
  useEffect(() => {
    if (lastNews.current !== null) untucked.current = nowRef.current();
  }, [hover]);
  useEffect(() => {
    if (!live) {
      setTucked(false);
      return;
    }
    const t = nowRef.current();
    const s = tuckState(lastNews.current ?? t, t, untucked.current);
    setTucked(s.tucked);
    if (s.nextAt === null) return;
    const timer = setTimeout(() => setWake((w) => w + 1), Math.max(0, s.nextAt - t) + 1);
    return () => clearTimeout(timer);
  }, [key, live, hover, epoch, wake]);
  return live && tucked;
}

/** Which ear item is up: earIndex from when the rotation began, moved on by one timeout per step. */
function useRotation(active: boolean, count: number, now: () => number, epoch: number): number {
  const since = useRef(0);
  const [at, setAt] = useState<number | null>(null);
  const nowRef = useRef(now);
  nowRef.current = now;
  useEffect(() => {
    if (!active) {
      setAt(null);
      return;
    }
    const t = nowRef.current();
    if (at === null) {
      since.current = t;
      setAt(t);
      return;
    }
    const step = Math.floor(Math.max(0, at - since.current) / EAR_CYCLE_MS);
    const next = since.current + (step + 1) * EAR_CYCLE_MS;
    const timer = setTimeout(() => setAt(nowRef.current()), Math.max(0, next - t) + 1);
    return () => clearTimeout(timer);
  }, [active, at, epoch]);
  return active && at !== null ? earIndex(count, since.current, at) : 0;
}

interface PointerCalls {
  /** the shape's height now: a point above it is on the shape, below it on a stage cat */
  shapeHeight: () => number;
  onEnter: () => void;
  onLeave: () => void;
}

/**
 * The shell's pointer zone. Inside the shape is hover intent like
 * pointerenter (which can lag while the transparent stage lets the mouse
 * through); a cat on the stage is not. Near folds the ears at once; far for
 * FAR_RETURN_MS brings them back. The shell keeps a pointer over the folded
 * ears' footprint near (the band in useNativeFrame), so far means the
 * pointer truly left their place.
 */
function usePointerZone(bridge: IslandBridge, given: PointerCalls): boolean {
  const [near, setNear] = useState(false);
  const calls = useRef(given);
  calls.current = given;
  useEffect(() => {
    let far: ReturnType<typeof setTimeout> | null = null;
    let inside = false;
    const off = bridge.onPointer((p) => {
      if (far) {
        clearTimeout(far);
        far = null;
      }
      const onShape = p.zone === "inside" && p.y < calls.current.shapeHeight();
      if (onShape !== inside) {
        inside = onShape;
        if (onShape) calls.current.onEnter();
        else calls.current.onLeave();
      }
      if (p.zone === "near") setNear(true);
      else if (p.zone === "inside") setNear(false);
      else far = setTimeout(() => setNear(false), FAR_RETURN_MS);
    });
    return () => {
      off();
      if (far) clearTimeout(far);
    };
  }, [bridge]);
  return near;
}

function catLabel(c: MiniCat, lead: boolean): string {
  const what = ACTIVITY_LABEL[c.activity]?.toLowerCase() ?? "at work";
  return `${c.name}, ${lead ? "the CEO" : ROLE_LABEL[c.role] ?? "crew"}, ${what}`;
}

function unit(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

function ringLabel(r: RingState): string {
  if (r.tone === "shipped") return "Every task done";
  if (r.tone === "failed") return "The run failed";
  const done = `${Math.round(unit(r.done) * 100)} percent of the tasks done`;
  if (r.tone === "wait") return `${done}, waiting on you`;
  if (r.tone === "paused") return `${done}, paused`;
  if (r.tone === "low") return `${done}, the budget runs low`;
  return done;
}

/** The running share's dots: one every CELL of the circle, inked over INK of it. */
const RING_CELL = 1 / 64;
const RING_INK = 0.45;

/**
 * The ring's one stroke as a dash pattern along the circle (pathLength 1):
 * the done share solid from the top, then the running share right after it
 * drawn at 45% ink (fine dots that cover 45% of its length), then nothing,
 * where the track shows. Together never past the whole.
 */
export function ringDash(done: number, inFlight: number): string {
  const d = unit(done);
  const f = Math.min(1 - d, unit(inFlight));
  const cells = f > 0 ? Math.max(1, Math.round(f / RING_CELL)) : 0;
  const cell = cells ? f / cells : 0;
  const round = (n: number) => Number(n.toFixed(5));
  const parts = [round(d), 0];
  for (let i = 0; i < cells; i++) parts.push(round(cell * RING_INK), round(cell * (1 - RING_INK)));
  parts.push(0);
  // the last gap takes up the rounding, so the pattern spans the circle exactly once
  const drawn = parts.reduce((a, b) => a + b, 0);
  parts.push(Math.max(0, round(1 - drawn)));
  return parts.join(" ");
}

/**
 * The progress ring: the track is the ring's own fill cut to a round line
 * (a mask), and on it one stroke, so nothing stacks: the done share from
 * the top, solid, then the running share right after it at 45% ink. Both
 * shares tween on --dur-300 through Motion values (reduced motion jumps);
 * the tone (data-tone) colours the stroke and the track. A finished run
 * closes it (ringOf): green at a ship, --island-danger at a failure.
 */
function Ring({ ring, reduced }: { ring: RingState; reduced: boolean }) {
  const d = unit(ring.done);
  const f = Math.min(1 - d, unit(ring.inFlight));
  const done = useMotionValue(d);
  const flight = useMotionValue(f);
  const dash = useTransform([done, flight], ([x, y]) => ringDash(Number(x), Number(y)));
  const arc = useRef<SVGCircleElement | null>(null);
  useMotionValueEvent(dash, "change", (v) => arc.current?.style.setProperty("stroke-dasharray", v));
  useEffect(() => {
    const t = reduced ? INSTANT : RING_T;
    const a = animate(done, d, t);
    const b = animate(flight, f, t);
    return () => {
      a.stop();
      b.stop();
    };
  }, [d, f, reduced, done, flight]);
  return (
    <span className="island-ring" data-tone={ring.tone} role="img" aria-label={ringLabel(ring)}>
      <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" focusable="false">
        <circle ref={arc} className="island-ring-value" cx={8} cy={8} r={7} fill="none" strokeWidth={2} pathLength={1} transform="rotate(-90 8 8)" style={{ strokeDasharray: dash.get() }} />
      </svg>
    </span>
  );
}

function MiniCatFigure({ cat, lead, still, celebrate, size = 24 }: { cat: MiniCat; lead: boolean; still: boolean; celebrate?: number; size?: 24 | 32 }) {
  return (
    <Cat
      look={cat.look}
      role={cat.role}
      status={cat.status}
      activity={cat.activity}
      mood={cat.mood}
      label={catLabel(cat, lead)}
      size={size}
      still={still}
      celebrateKey={celebrate}
    />
  );
}

interface BandProps {
  frame: Frame;
  model: IslandModel;
  reduced: boolean;
  celebrate: number;
  ring: RingState;
  /** the mini cat: the finish's lead, the cat the ear names (the rotation), or the lead */
  cat: MiniCat | null;
}

/**
 * The collapsed band's width (notch plus both ears) for a model: where the
 * folded ears come back. Its ear is as wide as the widest item it rotates
 * through (machine.fitEar), so the item up now does not matter.
 */
function openBandOf(model: IslandModel, g: IslandGeometry, measure: Measure, cycle: readonly EarItem[]): number {
  const items = cycle.length > 0 ? cycle.map((c) => c.texts) : [earTexts("collapsed", model, model.asks.length)];
  return bandOf("collapsed", model, g, measure, model.asks.length, { items, index: 0 }).width;
}

/** The band's mini cat: the finish's lead at a ship or failure, else the cat the ear names, else the lead. */
function bandCatOf(view: IslandView, model: IslandModel, named: MiniCat | null): MiniCat | null {
  const finish = view === "shipped" || view === "failed" ? model.finish : null;
  return finish ? finish.lead : (named ?? model.active?.lead ?? null);
}

function Band({ frame, model, reduced, celebrate, ring, cat: lead }: BandProps) {
  const b = frame.band;
  const a = model.active;
  const running = !!a && a.status === "running";
  const cheering = frame.view === "shipped";
  const still = reduced || !(running || cheering);
  if (b.notch && b.ear === 0) {
    return <div className="island-band" data-notch="" data-empty="" style={{ height: b.height }} />;
  }
  // The mini cat crossfades when the ear names another cat. A click on it is the band's own
  // click (the band is the target, as tall as the notch), answered with the cat's tap reaction.
  const figure = lead ? (
    <AnimatePresence initial={false} mode="wait">
      <motion.span
        key={lead.id ?? lead.name}
        className="island-cat-figure"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: reduced ? INSTANT : FADE_IN }}
        exit={{ opacity: 0, transition: reduced ? INSTANT : FADE_OUT }}
      >
        <MiniCatFigure cat={lead} lead={lead.role === "lead"} still={still} celebrate={celebrate} />
      </motion.span>
    </AnimatePresence>
  ) : null;
  const cat = figure ? <span className="island-cat">{figure}</span> : null;
  const end = (
    <>
      {b.ring ? <Ring ring={ring} reduced={reduced} /> : null}
      {b.text ? (
        <AnimatePresence initial={false} mode="wait">
          <motion.span
            key={b.text}
            className="island-ear-text"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: reduced ? INSTANT : FADE_IN }}
            exit={{ opacity: 0, transition: reduced ? INSTANT : FADE_OUT }}
          >
            {b.text}
          </motion.span>
        </AnimatePresence>
      ) : null}
    </>
  );
  if (!b.notch) {
    return (
      <div className="island-band" data-pill="" style={{ height: b.height }}>
        <span className="island-ear" data-side="start">
          {cat}
        </span>
        {b.ring || b.text ? (
          <span className="island-ear" data-side="end">
            {end}
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="island-band" data-notch="" style={{ height: b.height, gridTemplateColumns: `${b.ear}px minmax(0, 1fr) ${b.ear}px` }}>
      <span className="island-ear" data-side="start">
        {cat}
      </span>
      <span className="island-notch" aria-hidden="true" />
      <span className="island-ear" data-side="end">
        {end}
      </span>
    </div>
  );
}

function crewLine(total: number, atWork: number): string {
  const cats = `${total} ${total === 1 ? "cat" : "cats"}`;
  return atWork > 0 ? `${cats}, ${atWork} at work` : `${cats}, nobody at work right now`;
}

function PeekBody({ model, reduced, width, measure, onOpen }: { model: IslandModel; reduced: boolean; width: number; measure: Measure; onOpen: (path: string) => void }) {
  const a = model.active;
  const head = headTextWidth(width, measure, "Open");
  const rowRoom = rowTextWidth(width);
  if (!a) {
    return (
      <div className="island-head">
        <div className="island-head-text">
          <p className="island-title">No run right now</p>
          <p className="island-meta">Oyen is napping until the next goal.</p>
        </div>
        <button type="button" className="island-btn" data-variant="secondary" onClick={() => onOpen("/app")}>
          <ProductIcon name="arrowRightCircle" size={20} color="currentColor" />
          <span>Open</span>
        </button>
      </div>
    );
  }
  const rows = a.crew.slice(0, PEEK_ROWS);
  const more = a.crew.length - rows.length;
  return (
    <>
      <div className="island-head">
        <div className="island-head-text">
          <p className="island-title" title={a.goal}>
            {fitLine(a.goal, head, measure)}
          </p>
          <p className="island-meta">{fitLine(crewLine(a.crew.length, a.atWork), head, measure)}</p>
        </div>
        <button type="button" className="island-btn" data-variant="secondary" onClick={() => onOpen(`/app/runs/${a.runId}`)}>
          <ProductIcon name="arrowRightCircle" size={20} color="currentColor" />
          <span>Open</span>
        </button>
      </div>
      {rows.length ? (
        <ul className="island-crew" aria-label="The crew right now">
          {rows.map((c) => (
            <li key={c.id} className="island-crew-row">
              <MiniCatFigure cat={c} lead={c.role === "lead"} still={reduced || !c.atWork} />
              <span className="island-crew-text" title={`${c.name}: ${c.doing}`}>
                <span className="island-crew-name">{c.name}</span> <span className="island-crew-doing">{fitLine(c.doing, rowRoom - measure(`${c.name} `), measure)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {more > 0 ? (
        <p className="island-meta island-more">
          and {more} more at their desks
        </p>
      ) : null}
    </>
  );
}

/** A long line cut at a word, with the ellipsis, for a one-line slot; the full text rides in title. */
function shortText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,.;:]$/, "")}…`;
}

type Busy = "approve" | "deny" | null;

interface Result {
  tone: "success" | "neutral";
  text: string;
}

function resultText(ask: Ask, decision: "approve" | "deny", order: OrderDTO | null): string {
  if (ask.kind === "order") {
    if (decision === "deny") return "Rejected. The crew will not place this order.";
    if (order?.status === "filled") return "Approved and filled.";
    if (order?.status === "failed") return "Approved, but the venue refused it. Open the run for the reason.";
    return "Approved. The order goes to the venue.";
  }
  return decision === "approve" ? `Approved. ${ask.who.name} goes ahead.` : `Denied. ${ask.who.name} will not do it.`;
}

function AskBody({
  ask,
  index,
  total,
  busy,
  error,
  result,
  reduced,
  titleId,
  onDecide,
  onOpen,
  onStep,
}: {
  ask: Ask;
  index: number;
  total: number;
  busy: Busy;
  error: string | null;
  result: Result | null;
  reduced: boolean;
  titleId: string;
  onDecide: (ask: Ask, d: "approve" | "deny") => void;
  onOpen: (path: string) => void;
  onStep: (delta: number) => void;
}) {
  const who = ask.kind === "order" ? (ask.who ? `Live order from ${ask.who}` : "Live order") : `${ask.who.name} asks you`;
  const yesNo = ask.kind === "order" || (ask as CatAsk).yesNo;
  return (
    <>
      <div className="island-ask-head" data-queue={total > 1 ? "" : undefined}>
        <span className="island-ask-lead">
          {ask.kind === "order" ? (
            <span className="island-ask-icon">
              <ProductIcon name="dollar" size={20} color="currentColor" />
            </span>
          ) : (
            <MiniCatFigure cat={ask.who} lead={ask.who.role === "lead"} still={reduced} />
          )}
          <span className="island-ask-who" id={titleId}>
            {who}
          </span>
        </span>
        {total > 1 ? (
          <span className="island-queue">
            <span className="island-queue-count">
              {index + 1} of {total}
            </span>
            <button type="button" className="island-btn" data-variant="icon" aria-label="Previous request" disabled={index === 0 || busy !== null || !!result} onClick={() => onStep(-1)}>
              <ProductIcon name="chevronLeft" size={20} color="currentColor" />
            </button>
            <button type="button" className="island-btn" data-variant="icon" aria-label="Next request" disabled={index >= total - 1 || busy !== null || !!result} onClick={() => onStep(1)}>
              <ProductIcon name="chevronRight" size={20} color="currentColor" />
            </button>
          </span>
        ) : null}
      </div>
      <p className="island-ask-title">{shortText(ask.title, 200)}</p>
      {ask.kind === "order" ? <p className="island-ask-detail">{ask.detail}</p> : null}
      {ask.kind === "order" && ask.reason ? <p className="island-ask-reason">{ask.reason}</p> : null}
      {result ? (
        <p className="island-result" data-tone={result.tone} role="status">
          <ProductIcon name={result.tone === "success" ? "checkCircle" : "minusCircle"} size={20} color="currentColor" />
          <span>{result.text}</span>
        </p>
      ) : (
        <>
          {error ? (
            <p className="island-error" role="alert">
              <ProductIcon name="alertCircle" size={16} color="currentColor" />
              <span>{error}</span>
            </p>
          ) : null}
          <div className="island-actions" data-count={yesNo ? 3 : 1}>
            {yesNo ? (
              <>
                <button type="button" className="island-btn" data-variant="primary" aria-busy={busy === "approve" || undefined} disabled={busy !== null} onClick={() => onDecide(ask, "approve")}>
                  <ProductIcon name="check" size={20} color="currentColor" />
                  <span>Approve</span>
                </button>
                <button type="button" className="island-btn" data-variant="secondary" aria-busy={busy === "deny" || undefined} disabled={busy !== null} onClick={() => onDecide(ask, "deny")}>
                  <ProductIcon name="close" size={20} color="currentColor" />
                  <span>Deny</span>
                </button>
                <button type="button" className="island-btn" data-variant="ghost" disabled={busy !== null} onClick={() => onOpen(ask.path)}>
                  <ProductIcon name="arrowRightCircle" size={20} color="currentColor" />
                  <span>Open</span>
                </button>
              </>
            ) : (
              <button type="button" className="island-btn" data-variant="primary" onClick={() => onOpen(ask.path)}>
                <ProductIcon name="message" size={20} color="currentColor" />
                <span>Answer in MengAI</span>
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

function ShippedBody({ model, width, measure }: { model: IslandModel; width: number; measure: Measure }) {
  const f = model.finish;
  if (!f) return null;
  const room = headTextWidth(width, measure, null);
  return (
    <div className="island-head">
      <div className="island-head-text">
        <p className="island-title" title={f.goal}>
          {fitLine(f.goal, room, measure)}
        </p>
        <p className="island-meta">{fitLine(`${f.lead.name} signed off. The crew is celebrating.`, room, measure)}</p>
      </div>
    </div>
  );
}

/** A stage finished: its sentence, and where the run is now. */
function PopBody({ moment, model, width, measure }: { moment: Moment; model: IslandModel; width: number; measure: Measure }) {
  const a = model.active;
  const room = headTextWidth(width, measure, null);
  const now = a ? `Now ${a.stageLabel.toLowerCase()}, stage ${a.stageIndex + 1} of ${a.stageCount}.` : "";
  return (
    <div className="island-head">
      <div className="island-head-text">
        <p className="island-title">{moment.text}</p>
        {now ? <p className="island-meta">{fitLine(now, room, measure)}</p> : null}
      </div>
    </div>
  );
}

function FailedBody({ model, titleId, onOpen, onDismiss }: { model: IslandModel; titleId: string; onOpen: (path: string) => void; onDismiss: () => void }) {
  const f = model.finish;
  if (!f) return null;
  return (
    <>
      <div className="island-ask-head">
        <span className="island-ask-lead">
          <span className="island-ask-icon" data-tone="danger">
            <ProductIcon name="alertTriangle" size={20} color="currentColor" />
          </span>
          <span className="island-ask-who" id={titleId}>
            The run failed
          </span>
        </span>
      </div>
      <p className="island-ask-detail" title={f.reason ?? undefined}>
        {f.reason ? shortText(f.reason, 110) : shortText(f.goal, 110)}
      </p>
      <div className="island-actions" data-count={2}>
        <button type="button" className="island-btn" data-variant="primary" onClick={() => onOpen(`/app/runs/${f.runId}`)}>
          <ProductIcon name="arrowRightCircle" size={20} color="currentColor" />
          <span>Open</span>
        </button>
        <button type="button" className="island-btn" data-variant="secondary" onClick={onDismiss}>
          <ProductIcon name="close" size={20} color="currentColor" />
          <span>Dismiss</span>
        </button>
      </div>
    </>
  );
}

const FOCUSABLE = "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

const VIEW_LABEL: Record<IslandView, string> = {
  idle: "MengAI island, no run right now",
  tucked: "MengAI island, tucked into the notch",
  collapsed: "MengAI island, the run right now",
  peek: "The crew right now",
  pop: "A stage of the run finished",
  ask: "Waiting on your answer",
  shipped: "The run shipped",
  failed: "The run failed",
};

/** The answer panel's primary button: Approve, or Answer in MengAI for an open question. */
const PRIMARY = ".island-actions .island-btn[data-variant='primary']";

export function Island({
  model,
  geometry,
  bridge,
  api,
  reduced,
  forceHover = false,
  measure = estimateText,
  now = Date.now,
  onAnswered,
  onFinishDone,
  moments = null,
  clockEpoch = 0,
}: IslandProps) {
  const [hover, setHover] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [snoozed, setSnoozed] = useState(false);
  const [askIndex, setAskIndex] = useState(0);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const [pinned, setPinned] = useState<{ ask: Ask; result: Result } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [measured, setMeasured] = useState<{ key: string; height: number } | null>(null);
  const [catRects, setCatRects] = useState<StageRect[]>([]);
  const [, setTick] = useState(0);
  const shapeRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // The queue without the asks this island already answered (the stream confirms them soon).
  const queue = useMemo(() => model.asks.filter((a) => !answered.has(a.id) && a.id !== pinned?.ask.id), [model.asks, answered, pinned]);
  const shownAsks = useMemo(() => (pinned ? [pinned.ask, ...queue] : queue), [pinned, queue]);
  const index = pinned ? 0 : Math.min(askIndex, Math.max(0, queue.length - 1));
  const effective: IslandModel = useMemo(() => ({ ...model, asks: shownAsks }), [model, shownAsks]);

  // A new ask brings the queue back even after Escape put it aside.
  const seen = useRef<Set<string>>(new Set(model.asks.map((a) => a.id)));
  useEffect(() => {
    let fresh = false;
    for (const a of model.asks) {
      if (!seen.current.has(a.id)) {
        seen.current.add(a.id);
        fresh = true;
      }
    }
    if (fresh) setSnoozed(false);
  }, [model.asks]);

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);
  const onEnter = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(true), HOVER_IN_MS);
  }, []);
  const onLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(false), HOVER_OUT_MS);
  }, []);

  // The shell's pointer: inside the shape is hover intent, near folds the ears.
  const frameRef = useRef<Frame | null>(null);
  const near = usePointerZone(bridge, {
    shapeHeight: () => frameRef.current?.height ?? 0,
    onEnter,
    onLeave,
  });

  // What the director plays. A held ask only decides the view through the asks themselves.
  const current = moments?.current ?? null;
  const hovering = hover || forceHover;
  const tucked = useTuck(newsKey(effective, current && current.type !== "quirk" ? current.id : null), !!model.active, hovering, now, clockEpoch);

  const t = now();
  const view = pickView({
    model: effective,
    hover: hovering,
    snoozed,
    pinned: !!pinned,
    now: t,
    tucked,
    near,
    moment: current && !isAsk(current) ? current.type : null,
    notch: geometry.hasNotch,
  });
  const ask = view === "ask" ? (shownAsks[index] ?? null) : null;

  // The stage: an ask's cat only while its answer panel shows (Escape sends it back in), and
  // the cat of the ask on screen when the owner steps through the queue; nothing while the
  // result of an answer holds (that cat already reacted and went back up).
  const askId = ask?.id ?? null;
  const askCue = useMemo<Cue | null>(() => (askId ? (askMoments(model, 0).find((m) => m.askId === askId) ?? null) : null), [model, askId]);
  let stageMoment: Cue | null = current;
  if (current && isAsk(current)) {
    if (view !== "ask" || pinned) stageMoment = null;
    else if (askCue && askCue.askId !== current.askId) stageMoment = askCue;
  }
  const held = useHeld(stageMoment, reduced ? 0 : STAGE_HOLD_MS);

  // The ear: a moment's label while one plays, else the rotation of what is true now (collapsed).
  // It is as wide as the widest of them all, so a label or the next item never shrinks the shape.
  const label = useMemo(() => (stageMoment && !ASK_TYPES.has(stageMoment.type) ? momentEarTexts(stageMoment) : []), [stageMoment]);
  const cycle = useMemo(() => earCycle(effective), [effective]);
  const rotating = view === "collapsed" && label.length === 0 && cycle.length > 1;
  const rotation = useRotation(rotating, cycle.length, now, clockEpoch);
  const base = view === "collapsed" && cycle.length > 0 ? cycle.map((c) => c.texts) : [earTexts(view, effective, effective.asks.length)];
  const ear: EarInput | null = label.length > 0 ? { items: [label, ...base], index: 0 } : view === "collapsed" && cycle.length > 0 ? { items: base, index: rotation } : null;
  const earCat = rotating ? (cycle[rotation]?.cat ?? null) : null;
  const ring = ringOf(view === "shipped" || view === "failed" ? effective : { ...effective, finish: null });

  const popKey = view === "pop" ? (stageMoment?.id ?? "") : "";
  const contentKey = `${view}:${ask?.id ?? popKey}:${pinned ? "result" : error ? "error" : "ask"}:${view === "peek" ? (model.active?.crew.length ?? 0) : ""}`;
  const frame = frameOf({
    view,
    model: effective,
    geometry,
    measure,
    askIndex: index,
    bodyHeight: measured && measured.key === contentKey ? measured.height : undefined,
    ear,
    stageRow: held ? minStageWidth(held.cats.length) : 0,
    popText: view === "pop" ? (stageMoment?.text ?? "") : "",
  });
  frameRef.current = frame;
  // Folded into the notch, the window is the bare notch: the shell measures near beside the
  // footprint the ears come back to instead (spec section 6: items under them stay clickable).
  const foldedBand = view === "tucked" && geometry.hasNotch && effective.active ? openBandOf(effective, geometry, measure, cycle) : 0;
  const { shown, stage, onMorphDone, booted } = useNativeFrame(frame, bridge, reduced, catRects, foldedBand);
  const still = reduced || !booted;
  // The stage left the window: its cats' boxes go with it, so the next stage never starts with them.
  useEffect(() => {
    if (!stage) setCatRects((r) => (r.length ? [] : r));
  }, [stage]);

  // A crew cat may fool around only on a quiet island: collapsed, or tucked under the notch.
  const quiet = view === "collapsed" || (view === "tucked" && !near && geometry.hasNotch);
  const setQuiet = moments?.setQuiet;
  useEffect(() => setQuiet?.(quiet), [setQuiet, quiet]);

  // The body's own height, measured at its final width before the window grows,
  // and again whenever it changes on its own (a face that loads late rewraps a line).
  const bodyKey = `${view}:${ask?.id ?? popKey}`;
  const contentRef = useRef(contentKey);
  contentRef.current = contentKey;
  const findBody = useCallback(
    () => [...(shapeRef.current?.querySelectorAll<HTMLElement>(".island-body") ?? [])].find((b) => b.dataset.key === bodyKey) ?? null,
    [bodyKey],
  );
  useLayoutEffect(() => {
    const el = findBody();
    if (!el) return;
    const h = el.offsetHeight;
    if (h > 0 && (!measured || measured.key !== contentKey || measured.height !== h)) setMeasured({ key: contentKey, height: h });
  });
  useEffect(() => {
    const el = findBody();
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (h > 0) setMeasured((m) => (m && m.key === contentRef.current && m.height === h ? m : { key: contentRef.current, height: h }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [findBody]);

  // The celebration plays SHIP_MS, then the island collapses on its own.
  const finish = model.finish;
  useEffect(() => {
    if (!finish || finish.kind !== "shipped") return;
    const left = finish.at + SHIP_MS - now();
    if (left <= 0) {
      onFinishDone?.();
      return;
    }
    const timer = setTimeout(() => {
      setTick((n) => n + 1);
      onFinishDone?.();
    }, left);
    return () => clearTimeout(timer);
  }, [finish, now, onFinishDone, clockEpoch]);

  const open = useCallback((path: string) => void bridge.openMain(path).catch(() => {}), [bridge]);

  const decide = useCallback(
    async (a: Ask, decision: "approve" | "deny") => {
      setBusy(decision);
      setError(null);
      try {
        let order: OrderDTO | null = null;
        if (a.kind === "order") {
          order = api
            ? await api.call("POST /api/trading/orders/:id/decision", { params: { id: a.order.id }, body: { decision: decision === "approve" ? "approve" : "reject" } })
            : { ...a.order, status: decision === "approve" ? "approved" : "rejected", decidedAt: Date.now() };
        } else if (api && a.runId) {
          const body = a.approval ? askAnswer(a.approval, decision, "once") : requestAnswer(decision, a.agentId);
          await api.call("POST /api/runs/:id/message", { params: { id: a.runId }, body });
        }
        setAnswered((s) => new Set(s).add(a.id));
        setPinned({ ask: a, result: { tone: decision === "approve" ? "success" : "neutral", text: resultText(a, decision, order) } });
        // the asking cat reacts now, in step with the result; the stream's confirmation plays nothing twice
        moments?.answer(a, decision === "approve");
        onAnswered?.({ ask: a, decision, order });
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(null);
      }
    },
    [api, onAnswered, moments],
  );

  // The result stays in place a moment, then the queue moves on (or the island collapses).
  useEffect(() => {
    if (!pinned) return;
    const timer = setTimeout(() => {
      setPinned(null);
      setAskIndex(0);
    }, RESULT_MS);
    return () => clearTimeout(timer);
  }, [pinned]);

  // A different ask clears the last error.
  useEffect(() => setError(null), [askId]);

  const step = (delta: number) => setAskIndex((i) => Math.max(0, Math.min(queue.length - 1, i + delta)));
  const dismiss = useCallback(() => {
    moments?.dismiss();
    onFinishDone?.();
  }, [moments, onFinishDone]);
  const bandCat = bandCatOf(view, effective, earCat);

  // A cat on the stage: an asking cat points the owner to the answer, any other one says hi.
  const onCatClick = useCallback(
    (m: Moment, i: number) => {
      if (ASK_TYPES.has(m.type)) {
        shapeRef.current?.querySelector<HTMLButtonElement>(PRIMARY)?.focus();
        return;
      }
      const c = m.cats[i];
      if (c) moments?.tap(c.cat);
    },
    [moments],
  );

  const expanded = view === "ask" || view === "failed";
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      if (view === "ask" && !pinned) {
        setSnoozed(true);
        setHover(false);
      } else if (view === "failed") dismiss();
      return;
    }
    if (e.key !== "Tab" || !expanded) return;
    // Focus stays inside the expanded island.
    const root = shapeRef.current;
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !root.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !root.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  // A click on the band, the peek or the pop opens the run; buttons keep their own job, and a
  // click on the band's mini cat calls it out under the island instead.
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    if (moments && bandCat && target.closest(".island-cat")) {
      moments.tap(bandCat);
      return;
    }
    if (view === "collapsed" || view === "tucked" || view === "peek" || view === "pop") open(model.active ? `/app/runs/${model.active.runId}` : "/app");
    else if (view === "idle") open("/app");
    else if (view === "shipped" && model.finish) open(`/app/runs/${model.finish.runId}`);
  };

  const celebrate = view === "shipped" && model.finish ? model.finish.at : (model.active?.celebrate ?? 0);
  const body = frame.body;
  const bodyContent =
    view === "peek" ? (
      <PeekBody model={effective} reduced={reduced} width={body?.width ?? 0} measure={measure} onOpen={open} />
    ) : view === "ask" && ask ? (
      <AskBody
        ask={ask}
        index={index}
        total={shownAsks.length}
        busy={busy}
        error={error}
        result={pinned?.result ?? null}
        reduced={reduced}
        titleId={titleId}
        onDecide={(a, d) => void decide(a, d)}
        onOpen={open}
        onStep={step}
      />
    ) : view === "pop" && stageMoment ? (
      <PopBody moment={stageMoment} model={effective} width={body?.width ?? 0} measure={measure} />
    ) : view === "shipped" ? (
      <ShippedBody model={effective} width={body?.width ?? 0} measure={measure} />
    ) : view === "failed" ? (
      <FailedBody model={effective} titleId={titleId} onOpen={open} onDismiss={dismiss} />
    ) : null;

  // Read out what changed and who did it; a cat fooling around is not news.
  const announce = stageMoment && stageMoment.type !== "quirk" ? stageMoment.text : "";
  const labelled = expanded ? { "aria-labelledby": titleId } : { "aria-label": VIEW_LABEL[view] };
  return (
    <div className="island-stage" data-notch={geometry.hasNotch ? "" : undefined}>
      <motion.section
        ref={shapeRef}
        className="island"
        data-view={view}
        data-native={frame.native}
        data-notch={geometry.hasNotch ? "" : undefined}
        data-motion={reduced ? "still" : "live"}
        {...labelled}
        initial={false}
        animate={{
          width: shown.width,
          height: shown.height,
          borderTopLeftRadius: shown.top,
          borderTopRightRadius: shown.top,
          borderBottomLeftRadius: shown.bottom,
          borderBottomRightRadius: shown.bottom,
        }}
        transition={still ? INSTANT : view === "tucked" ? FOLD : MORPH}
        onAnimationComplete={onMorphDone}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onKeyDown={onKeyDown}
        onClick={onClick}
      >
        <Band frame={frame} model={effective} reduced={reduced} celebrate={celebrate} ring={ring} cat={bandCat} />
        <AnimatePresence initial={false} mode="wait">
          {body && bodyContent ? (
            <motion.div
              key={bodyKey}
              data-key={bodyKey}
              className="island-body"
              data-view={view}
              style={{ width: body.width }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: reduced ? INSTANT : FADE_IN }}
              exit={{ opacity: 0, transition: reduced ? INSTANT : FADE_OUT }}
            >
              {bodyContent}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.section>
      {stage ? <Stage moment={frame.stage ? stageMoment : null} reduced={reduced} width={stage.width} height={stage.height} onCatClick={onCatClick} onCatRects={setCatRects} /> : null}
      <p className="island-live" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
