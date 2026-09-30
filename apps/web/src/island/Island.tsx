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
import { Cat } from "@mengai/cats/src/cat";
import { ACTIVITY_LABEL, ROLE_LABEL, type OrderDTO } from "@mengai/shared";
import { ProductIcon } from "@mengai/ui/src/product/icons";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { errorMessage, type ApiClient } from "../api/client";
import { askAnswer, requestAnswer } from "../app/run/answer";
import type { Ask, CatAsk, IslandModel, MiniCat } from "./live";
import { PEEK_ROWS, SHIP_MS, estimateText, fitLine, frameOf, grows, headTextWidth, pickView, rowTextWidth, shrinks, unionSize, type Frame, type IslandView, type Measure } from "./machine";
import { FADE_IN, FADE_OUT, HOVER_IN_MS, HOVER_OUT_MS, INSTANT, MORPH, RESULT_MS, RING_T } from "./motion";
import type { IslandBridge, IslandGeometry, NativeSize } from "./native";

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

/**
 * The shape the page shows and the window it sits in. A new target first
 * grows the window to the union of where the shape is and where it goes,
 * then hands the target to the morph; when the morph settles the window
 * drops to the target exactly. Targets that land in one tick (a measure
 * right after a view change) coalesce into one window call.
 */
export function useNativeFrame(target: Frame, bridge: IslandBridge, reduced: boolean): { shown: Shape; onMorphDone: () => void; booted: boolean } {
  const [shown, setShown] = useState<Shape>(() => shapeOf(target));
  // Until the first size lands, changes are instant: a load never plays a morph.
  const [booted, setBooted] = useState(false);
  const bootedRef = useRef(false);
  bootedRef.current = booted;
  const targetRef = useRef(target);
  targetRef.current = target;
  const windowRef = useRef<NativeSize | null>(null);
  const turn = useRef(0);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const send = useCallback(
    async (size: NativeSize) => {
      const prev = windowRef.current;
      if (prev && prev.state === size.state && prev.width === size.width && prev.height === size.height) return;
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
    void send({ state: t.native, width: t.width, height: t.height });
  }, [send]);

  const key = `${target.native}:${target.width}x${target.height}:${target.radius.top}/${target.radius.bottom}`;
  useEffect(() => {
    const mine = ++turn.current;
    queueMicrotask(() => {
      void (async () => {
        if (mine !== turn.current) return;
        const t = targetRef.current;
        const win = windowRef.current;
        const exact: NativeSize = { state: t.native, width: t.width, height: t.height };
        const moving = grows(win ?? t, t) || !win || win.state !== t.native;
        if (!win || reducedRef.current || !bootedRef.current) {
          // Nothing morphs (reduced motion, or the first sizes): grow the window, show, then drop it.
          if (moving) await send(exact);
          if (mine !== turn.current) return;
          setShown(shapeOf(t));
          if (!win) nextFrame(() => nextFrame(() => setBooted(true)));
          if (win && shrinks(win, t)) setTimeout(() => mine === turn.current && settle(), 0);
          return;
        }
        if (moving) await send({ state: t.native, ...unionSize(win, t) });
        if (mine !== turn.current) return;
        setShown(shapeOf(t));
      })();
    });
  }, [key, send, settle]);

  const shownRef = useRef(shown);
  shownRef.current = shown;
  const onMorphDone = useCallback(() => {
    if (turn.current === 0) return;
    if (!sameShape(shapeOf(targetRef.current), shownRef.current)) return;
    settle();
  }, [settle]);

  return { shown, onMorphDone, booted };
}

function catLabel(c: MiniCat, lead: boolean): string {
  const what = ACTIVITY_LABEL[c.activity]?.toLowerCase() ?? "at work";
  return `${c.name}, ${lead ? "the CEO" : ROLE_LABEL[c.role] ?? "crew"}, ${what}`;
}

/**
 * The progress ring: the track is the span's own round line (an inset
 * outline that follows its radius) and the value one arc drawn on it, so
 * no two shapes stack. The arc's stroke animates to the share of tasks done.
 */
function Ring({ value, reduced, label }: { value: number; reduced: boolean; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="island-ring" role="img" aria-label={label}>
      <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" focusable="false">
        <motion.circle
          className="island-ring-value"
          cx={8}
          cy={8}
          r={7}
          fill="none"
          strokeWidth={2}
          transform="rotate(-90 8 8)"
          initial={false}
          animate={{ pathLength: v, opacity: v > 0 ? 1 : 0 }}
          transition={reduced ? INSTANT : RING_T}
        />
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

function Band({ frame, model, reduced, celebrate }: { frame: Frame; model: IslandModel; reduced: boolean; celebrate: number }) {
  const b = frame.band;
  const a = model.active;
  const finish = frame.view === "shipped" || frame.view === "failed" ? model.finish : null;
  const lead = finish ? finish.lead : (a?.lead ?? null);
  const running = !!a && a.status === "running";
  const cheering = frame.view === "shipped";
  const still = reduced || !(running || cheering);
  const ringValue = frame.view === "shipped" ? 1 : (a?.progress ?? 0);
  const ringLabel = frame.view === "shipped" ? "Every task done" : `${Math.round(ringValue * 100)} percent of the tasks done`;
  if (b.notch && b.ear === 0) {
    return <div className="island-band" data-notch="" data-empty="" style={{ height: b.height }} />;
  }
  const cat = lead ? <MiniCatFigure cat={lead} lead still={still} celebrate={celebrate} /> : null;
  const end = (
    <>
      {b.ring ? <Ring value={ringValue} reduced={reduced} label={ringLabel} /> : null}
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
  collapsed: "MengAI island, the run right now",
  peek: "The crew right now",
  ask: "Waiting on your answer",
  shipped: "The run shipped",
  failed: "The run failed",
};

export function Island({ model, geometry, bridge, api, reduced, forceHover = false, measure = estimateText, now = Date.now, onAnswered, onFinishDone }: IslandProps) {
  const [hover, setHover] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [snoozed, setSnoozed] = useState(false);
  const [askIndex, setAskIndex] = useState(0);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const [pinned, setPinned] = useState<{ ask: Ask; result: Result } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [measured, setMeasured] = useState<{ key: string; height: number } | null>(null);
  const [, setTick] = useState(0);
  const shapeRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // The queue without the asks this island already answered (the stream confirms them soon).
  const queue = useMemo(() => model.asks.filter((a) => !answered.has(a.id) && a.id !== pinned?.ask.id), [model.asks, answered, pinned]);
  const shownAsks = pinned ? [pinned.ask, ...queue] : queue;
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

  const t = now();
  const view = pickView({ model: effective, hover: hover || forceHover, snoozed, pinned: !!pinned, now: t });
  const ask = view === "ask" ? (shownAsks[index] ?? null) : null;
  const contentKey = `${view}:${ask?.id ?? ""}:${pinned ? "result" : error ? "error" : "ask"}:${view === "peek" ? (model.active?.crew.length ?? 0) : ""}`;
  const frame = frameOf({
    view,
    model: effective,
    geometry,
    measure,
    askIndex: index,
    bodyHeight: measured && measured.key === contentKey ? measured.height : undefined,
  });
  const { shown, onMorphDone, booted } = useNativeFrame(frame, bridge, reduced);
  const still = reduced || !booted;

  // The body's own height, measured at its final width before the window grows,
  // and again whenever it changes on its own (a face that loads late rewraps a line).
  const bodyKey = `${view}:${ask?.id ?? ""}`;
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
  }, [finish, now, onFinishDone]);

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  const onEnter = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(true), HOVER_IN_MS);
  };
  const onLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(false), HOVER_OUT_MS);
  };

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
        onAnswered?.({ ask: a, decision, order });
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(null);
      }
    },
    [api, onAnswered],
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
  const askId = ask?.id ?? null;
  useEffect(() => setError(null), [askId]);

  const step = (delta: number) => setAskIndex((i) => Math.max(0, Math.min(queue.length - 1, i + delta)));
  const dismiss = useCallback(() => onFinishDone?.(), [onFinishDone]);

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

  // A click on the band or the peek opens the run; buttons keep their own job.
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    if (view === "collapsed" || view === "peek") open(model.active ? `/app/runs/${model.active.runId}` : "/app");
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
    ) : view === "shipped" ? (
      <ShippedBody model={effective} width={body?.width ?? 0} measure={measure} />
    ) : view === "failed" ? (
      <FailedBody model={effective} titleId={titleId} onOpen={open} onDismiss={dismiss} />
    ) : null;

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
        transition={still ? INSTANT : MORPH}
        onAnimationComplete={onMorphDone}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onKeyDown={onKeyDown}
        onClick={onClick}
      >
        <Band frame={frame} model={effective} reduced={reduced} celebrate={celebrate} />
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
    </div>
  );
}
