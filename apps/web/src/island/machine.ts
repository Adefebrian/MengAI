// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The island's state machine, pure: which view shows, and the exact size
// and corners of the black shape for it. The component morphs the shape to
// this frame and hands the size to the shell (island_set_state), so the
// native window is always exactly what shows.
//
// Views, in order of who wins:
//   ask        something waits on the owner (a live order, a cat's approval),
//              expanded with Approve, Deny and Open; a queue when several wait
//   failed     a run failed: one line why, Open and Dismiss; it stays until
//              the owner acts (JEV ui.region_gate fail_autoclose: stay 0.60)
//   shipped    a run shipped: Oyen cheers, the ring completes, then after
//              SHIP_MS the island collapses on its own
//   peek       the pointer rests on the island: the crew at work
//   collapsed  a run is live: mini Oyen, the ring, the stage ("Review 5 of 7")
//   idle       nothing runs: exactly the notch, nothing shows (JEV
//              idle_notch: notch_only 0.60); without a notch a small pill
//              with Oyen napping
// Sizes are logical points. The collapsed island is the notch plus two
// ears of one width (the window stays centred on the notch); without a
// notch it is a pill that hugs its content. Every grown view keeps the
// band on top (the notch row) and adds its body under it; the body height
// is measured in the page and estimated here when it cannot be (tests).
import type { IslandGeometry, NativeState } from "./native";
import type { IslandModel } from "./live";

export type IslandView = "idle" | "collapsed" | "peek" | "ask" | "shipped" | "failed";

/** How long the ship celebration plays before the island collapses. */
export const SHIP_MS = 4000;

/* Metrics, in points, from the JAL Core spacing and radius scales. */
export const MINI_CAT = 24; // --space-24px
export const RING = 16; // --space-16px
export const RING_GAP = 6; // --space-6px
export const EAR_OUTER = 12; // --space-12px
export const EAR_INNER = 8; // --space-8px
export const PILL_H = 32; // --space-32px
export const PAD_X = 16; // --space-16px
export const PAD_TOP = 8; // --space-8px
export const PAD_BOTTOM = 16; // --space-16px
export const GAP = 8; // --space-8px
export const ROW_H = 32; // --space-32px, a crew row: a 24 pt cat and 4 pt either side
export const LINE_S = 20; // --line-n1
export const LINE_M = 24; // --line-0
export const CONTROL_H = 44; // --control-h
/** the answer row: 44 pt buttons under a 4 pt lift (--space-4px) */
export const ACTIONS_H = CONTROL_H + 4;
export const R_BAND = 12; // --radius-12
export const R_GROWN = 28; // --radius-28
/** crew rows the peek shows before "and N more" (JEV ui.region_gate peek_crew_rows: three, 1.00) */
export const PEEK_ROWS = 3;
/** the widest an ear may grow; a longer stage text drops to a shorter form */
export const EAR_MAX = 144;
export const EAR_MIN = EAR_OUTER + MINI_CAT + EAR_INNER;
/** body widths per grown view */
export const BODY_W: Record<"peek" | "ask" | "shipped" | "failed", number> = { peek: 360, ask: 400, shipped: 340, failed: 360 };

/** Width of a string in the ear font (500 13px, the island's --text-n1). */
export type Measure = (text: string) => number;

/** A measure for when the page has no canvas (tests, a server render): a generous per-character estimate. */
export const estimateText: Measure = (text) => Math.ceil(text.length * 13 * 0.6);

export interface ViewInput {
  model: IslandModel;
  hover: boolean;
  /** the owner put the queue aside with Escape; it comes back on hover or with a new ask */
  snoozed: boolean;
  /** an ask is showing the result of the owner's answer */
  pinned: boolean;
  now: number;
}

export function pickView({ model, hover, snoozed, pinned, now }: ViewInput): IslandView {
  if (pinned) return "ask";
  if (model.asks.length > 0 && (!snoozed || hover)) return "ask";
  const f = model.finish;
  if (f?.kind === "failed") return "failed";
  if (f?.kind === "shipped" && now - f.at < SHIP_MS) return "shipped";
  if (hover) return "peek";
  return model.active ? "collapsed" : "idle";
}

export function nativeStateOf(view: IslandView, hasNotch = true): NativeState {
  // without a notch an idle pill would sit over the frontmost title bar: leave the screen
  if (view === "idle" && !hasNotch) return "hidden";
  if (view === "idle" || view === "collapsed") return "collapsed";
  if (view === "peek") return "peek";
  return "expanded";
}

/** The ear text candidates for a view, longest first. */
export function earTexts(view: IslandView, model: IslandModel, queue: number): string[] {
  const a = model.active;
  if (view === "ask") return [queue > 1 ? `${queue} waiting` : "Needs you"];
  if (view === "shipped") return ["Shipped"];
  if (view === "failed") return ["Failed"];
  if (view === "idle") return [];
  if (!a) return ["No run"];
  if (queue > 0) return [queue > 1 ? `${queue} waiting` : "Needs you"];
  if (a.status === "paused") return ["Paused"];
  if (a.status === "queued") return ["Starting"];
  if (a.status === "stopping") return ["Stopping"];
  const count = `${a.stageIndex + 1} of ${a.stageCount}`;
  return [`${a.stageLabel} ${count}`, a.stageLabel, count];
}

/** The ring shows with a live stage and at the ship; never over an ask or an alert. */
export function showsRing(view: IslandView, model: IslandModel, queue: number): boolean {
  if (view === "shipped") return true;
  return (view === "collapsed" || view === "peek") && !!model.active && queue === 0;
}

export interface Band {
  /** the notch row, or the pill's own row */
  height: number;
  /** width of each ear on a notched Mac; 0 when the notch shows alone */
  ear: number;
  text: string;
  textWidth: number;
  ring: boolean;
  notch: boolean;
  /** the band's own width: notch plus ears, or the pill's content */
  width: number;
}

export interface Frame {
  view: IslandView;
  native: NativeState;
  width: number;
  height: number;
  /** corner radii: the notched island keeps square top corners flush with the screen edge */
  radius: { top: number; bottom: number };
  band: Band;
  /** the body under the band, null for idle and collapsed */
  body: { width: number; height: number } | null;
}

function fitText(candidates: string[], measure: Measure, room: number): { text: string; width: number } {
  for (const text of candidates) {
    const width = Math.ceil(measure(text));
    if (width <= room) return { text, width };
  }
  const last = candidates.at(-1) ?? "";
  return { text: last, width: Math.min(room, Math.ceil(measure(last))) };
}

export function bandOf(view: IslandView, model: IslandModel, g: IslandGeometry, measure: Measure, queue: number): Band {
  const ring = showsRing(view, model, queue);
  const ringPart = ring ? RING + RING_GAP : 0;
  const texts = earTexts(view, model, queue);
  if (g.hasNotch) {
    const height = g.notchHeight;
    if (view === "idle") return { height, ear: 0, text: "", textWidth: 0, ring: false, notch: true, width: g.notchWidth };
    const room = EAR_MAX - EAR_INNER - EAR_OUTER - ringPart;
    const { text, width: textWidth } = fitText(texts, measure, room);
    const ear = Math.max(EAR_MIN, EAR_INNER + ringPart + textWidth + EAR_OUTER);
    return { height, ear, text, textWidth, ring, notch: true, width: g.notchWidth + ear * 2 };
  }
  const room = EAR_MAX * 2 - EAR_OUTER * 2 - MINI_CAT - GAP - ringPart;
  const { text, width: textWidth } = fitText(texts, measure, room);
  const content = text ? GAP + ringPart + textWidth : ring ? GAP + RING : 0;
  return { height: PILL_H, ear: 0, text, textWidth, ring, notch: false, width: EAR_OUTER + MINI_CAT + content + EAR_OUTER };
}

/**
 * A line that fits a width in the island's 13 px face: whole when it fits,
 * else cut at a word with an ellipsis (the full text rides in a title).
 * One-line slots stay one line, so the estimate and the page agree.
 */
export function fitLine(text: string, width: number, measure: Measure): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (width <= 0 || measure(t) <= width) return t;
  const words = t.split(" ");
  while (words.length > 1) {
    words.pop();
    const cut = `${words.join(" ").replace(/[,.;:]$/, "")}\u2026`;
    if (measure(cut) <= width) return cut;
  }
  let chars = t;
  while (chars.length > 1 && measure(`${chars}\u2026`) > width) chars = chars.slice(0, -1);
  return `${chars}\u2026`;
}

/** Room for the text column of a head row: the body minus its padding, the gap and the Open button (icon, gap, word, padding, border). */
export function headTextWidth(bodyWidth: number, measure: Measure, button: string | null): number {
  const buttonWidth = button ? 20 + 8 + measure(button) + 24 + 2 : 0;
  return bodyWidth - PAD_X * 2 - (button ? 12 : 0) - buttonWidth;
}

/** Room for a crew row's words: the body minus its padding, the 24 pt cat and the gap. */
export function rowTextWidth(bodyWidth: number): number {
  return bodyWidth - PAD_X * 2 - MINI_CAT - GAP;
}

/** Lines a text takes at a width, from a per-character estimate. */
export function linesFor(text: string, width: number, fontPx: number, max: number): number {
  const perLine = Math.max(8, Math.floor(width / (fontPx * 0.55)));
  return Math.max(1, Math.min(max, Math.ceil(text.length / perLine)));
}

/** Children heights stacked with the body's flex gap, inside its padding. */
function stack(children: number[]): number {
  const list = children.filter((h) => h > 0);
  return PAD_TOP + list.reduce((a, b) => a + b, 0) + GAP * Math.max(0, list.length - 1) + PAD_BOTTOM;
}

/** The body height the page would measure, estimated from the content. */
export function estimateBody(view: IslandView, model: IslandModel, askIndex: number, width: number): number {
  const inner = width - PAD_X * 2;
  if (view === "peek") {
    const a = model.active;
    if (!a) return stack([CONTROL_H]);
    const rows = Math.min(PEEK_ROWS, a.crew.length);
    const more = a.crew.length > PEEK_ROWS ? LINE_S : 0;
    return stack([CONTROL_H, rows * ROW_H, more]);
  }
  if (view === "ask") {
    const ask = model.asks[Math.min(Math.max(0, askIndex), Math.max(0, model.asks.length - 1))];
    if (!ask) return stack([CONTROL_H]);
    const head = model.asks.length > 1 ? CONTROL_H : LINE_M;
    const title = linesFor(ask.title, inner, 16, 3) * LINE_M;
    const detail = ask.kind === "order" ? LINE_S : 0;
    const reason = ask.kind === "order" && ask.reason ? linesFor(ask.reason, inner, 13, 3) * LINE_S : 0;
    return stack([head, title, detail, reason, ACTIONS_H]);
  }
  if (view === "shipped") return stack([CONTROL_H]);
  if (view === "failed") {
    const f = model.finish;
    const line = f ? (f.reason ?? f.goal) : "";
    return stack([LINE_M, line ? linesFor(line, inner, 13, 2) * LINE_S : 0, ACTIONS_H]);
  }
  return 0;
}

export interface FrameInput {
  view: IslandView;
  model: IslandModel;
  geometry: IslandGeometry;
  measure?: Measure;
  /** which ask of the queue shows */
  askIndex?: number;
  /** the body height the page measured; the estimate stands in when it is 0 or missing */
  bodyHeight?: number;
}

export function frameOf({ view, model, geometry: g, measure = estimateText, askIndex = 0, bodyHeight }: FrameInput): Frame {
  const queue = model.asks.length;
  const band = bandOf(view, model, g, measure, queue);
  const native = nativeStateOf(view, g.hasNotch);
  if (view === "idle" || view === "collapsed") {
    // A notched band keeps its corners within a third of its height; the pill is a pill.
    const radius = g.hasNotch ? { top: 0, bottom: Math.min(R_BAND, Math.floor(band.height / 3)) } : { top: band.height / 2, bottom: band.height / 2 };
    return { view, native, width: band.width, height: band.height, radius, band, body: null };
  }
  const width = Math.max(BODY_W[view], band.width);
  const measured = bodyHeight && bodyHeight > 0 ? Math.ceil(bodyHeight) : 0;
  const height = band.height + (measured || estimateBody(view, model, askIndex, width));
  const r = Math.min(R_GROWN, Math.floor(height / 3));
  const radius = g.hasNotch ? { top: 0, bottom: r } : { top: r, bottom: r };
  return { view, native, width, height, radius, band, body: { width, height: height - band.height } };
}

/**
 * The size the window must hold before a morph starts: the union of where
 * the shape is and where it goes, so growing never clips. After the morph
 * the window drops to the target exactly.
 */
export function unionSize(a: { width: number; height: number }, b: { width: number; height: number }): { width: number; height: number } {
  return { width: Math.max(a.width, b.width), height: Math.max(a.height, b.height) };
}

export function grows(from: { width: number; height: number }, to: { width: number; height: number }): boolean {
  return to.width > from.width || to.height > from.height;
}

export function shrinks(from: { width: number; height: number }, to: { width: number; height: number }): boolean {
  return to.width < from.width || to.height < from.height;
}
