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
//   pop        a stage finished: the body pops the moment's sentence for
//              its length (stage_done), then the island collapses again
//   tucked     a live run with no news for TUCK_MS (progress.tuckState), or
//              the pointer passing near on its way to the menu bar: exactly
//              the notch, or off the screen without one. Never while
//              something waits on the owner, nor while a moment plays on the
//              stage (a quirk may play under the tucked notch, that is all)
//   collapsed  a run is live: mini Oyen, the ring, the stage ("Review 5 of 7")
//   idle       nothing runs: exactly the notch, nothing shows (JEV
//              idle_notch: notch_only 0.60); without a notch a small pill
//              with Oyen napping
// Sizes are logical points. The collapsed island is the notch plus two
// ears of one width (the window stays centred on the notch); without a
// notch it is a pill that hugs its content. Every grown view keeps the
// band on top (the notch row) and adds its body under it; the body height
// is measured in the page and estimated here when it cannot be (tests).
//
// The stage (Stage.tsx) is a transparent region under the shape where a
// moment's cats come out: a sibling of the shape, centred under it, its top
// edge on the shape's bottom edge, never overlapping it. The native window
// is the union of the two (windowOf), and only the shape and the clickable
// cats take the pointer (hitOf), so the transparent rest never steals a
// click from the app below.
import type { IslandModel } from "./live";
import type { Moment, MomentType } from "./moment-types";
import { MAX_HIT, type HitRect, type IslandGeometry, type NativeState } from "./native";

export type IslandView = "idle" | "tucked" | "collapsed" | "peek" | "pop" | "ask" | "shipped" | "failed";

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
export const BODY_W: Record<"peek" | "pop" | "ask" | "shipped" | "failed", number> = { peek: 360, pop: 340, ask: 400, shipped: 340, failed: 360 };
/** The stage under the shape (spec section 5): a 48 pt cat plus room for its hop, and its narrowest width. */
export const STAGE_H = 72;
export const STAGE_W = 160;

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
  /** no news for TUCK_MS: the island tucks into the notch */
  tucked?: boolean;
  /** the pointer passes near the island on its way to the menu bar: the ears fold away */
  near?: boolean;
  /** the type of the moment on the stage, null or missing for none */
  moment?: MomentType | null;
  /** the display has a notch (a quirk may play under the tucked notch); true when missing */
  notch?: boolean;
}

/**
 * Whether a live, quiet island folds to the notch. The pointer near folds
 * it at once (only on a notch: the pill sits under the menu bar, and off the
 * screen it would hear no pointer to come back) and a long quiet tucks it;
 * never while something waits on the owner and never over a moment on the
 * stage: every moment brings the ears out, except a quirk under a tucked
 * notch, which plays right there.
 */
function folds({ model, tucked = false, near = false, moment = null, notch = true }: ViewInput): boolean {
  if (model.asks.length > 0) return false;
  if (!moment) return (near && notch) || tucked;
  return moment === "quirk" && tucked && notch;
}

export function pickView(input: ViewInput): IslandView {
  const { model, hover, snoozed, pinned, now, moment = null } = input;
  if (pinned) return "ask";
  if (model.asks.length > 0 && (!snoozed || hover)) return "ask";
  const f = model.finish;
  if (f?.kind === "failed") return "failed";
  if (f?.kind === "shipped" && now - f.at < SHIP_MS) return "shipped";
  if (hover) return "peek";
  if (!model.active) return "idle";
  if (moment === "stage_done") return "pop";
  return folds(input) ? "tucked" : "collapsed";
}

export function nativeStateOf(view: IslandView, hasNotch = true): NativeState {
  // without a notch an idle (or tucked) pill would sit over the frontmost title bar: leave the screen
  if ((view === "idle" || view === "tucked") && !hasNotch) return "hidden";
  if (view === "idle" || view === "tucked" || view === "collapsed") return "collapsed";
  if (view === "peek") return "peek";
  return "expanded";
}

/** The ear text candidates for a view, longest first. */
export function earTexts(view: IslandView, model: IslandModel, queue: number): string[] {
  const a = model.active;
  if (view === "ask") return [queue > 1 ? `${queue} waiting` : "Needs you"];
  if (view === "shipped") return ["Shipped"];
  if (view === "failed") return ["Failed"];
  if (view === "idle" || view === "tucked") return [];
  if (!a) return ["No run"];
  if (queue > 0) return [queue > 1 ? `${queue} waiting` : "Needs you"];
  if (a.status === "paused") return ["Paused"];
  if (a.status === "queued") return ["Starting"];
  if (a.status === "stopping") return ["Stopping"];
  const count = `${a.stageIndex + 1} of ${a.stageCount}`;
  return [`${a.stageLabel} ${count}`, a.stageLabel, count];
}

/**
 * The ring shows with a live stage (in the warning tone while asks wait put
 * aside), at the ship and at a failure, each in its tone; never over an
 * open ask, where the answer is the one thing to look at.
 */
export function showsRing(view: IslandView, model: IslandModel): boolean {
  if (view === "shipped" || view === "failed") return true;
  return (view === "collapsed" || view === "peek" || view === "pop") && !!model.active;
}

/** Name first, then the shorter form, for fitText. */
function named(name: string, words: string, short: string): string[] {
  return name ? [`${name} ${words}`, short] : [short];
}

const QUIRK_EAR: Record<string, string> = { yawn: "yawns", stretch: "stretches", groom: "grooms", knead: "kneads", bat: "plays", blink: "blinks", twitch: "twitches" };

/**
 * A few words in the ear for a moment on the stage, longest first: what
 * changed and who. Empty for an ask and the reaction to its answer (the ear
 * says it waits) and for a ship or failure (their own view says it).
 */
export function momentEarTexts(m: Pick<Moment, "type" | "cats">): string[] {
  const first = m.cats[0];
  const name = first?.cat.name ?? "";
  switch (m.type) {
    case "hire":
      return named(name, "joined", "Joined");
    case "let_go":
      return named(name, "left", "Left");
    case "handoff":
      return ["Handoff"];
    case "review_pass":
      return ["Review passed", "Passed"];
    case "review_fail":
      return ["Needs a look", "Sent back"];
    case "ceo_approved":
      return named(name, "approved", "Approved");
    case "ceo_denied":
      return named(name, "said no", "Said no");
    case "rethink":
      return named(name, "rethinks", "Rethinking");
    case "stuck":
      return named(name, "is stuck", "Stuck");
    case "budget_low":
      return ["Budget low"];
    case "stage_done":
      return ["Stage done"];
    case "quirk":
      return named(name, QUIRK_EAR[first?.quirk ?? ""] ?? "plays", name || "Break");
    case "tap":
      return named(name, "says hi", "Hi");
    default:
      return [];
  }
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

/** The stage under the shape, in the window that holds both (windowOf). */
export interface StageBox {
  width: number;
  height: number;
  /** its left edge in that window: both are centred, so (window - stage) / 2 */
  x: number;
}

export interface Frame {
  view: IslandView;
  native: NativeState;
  /** the black shape */
  width: number;
  height: number;
  /** corner radii: the notched island keeps square top corners flush with the screen edge */
  radius: { top: number; bottom: number };
  band: Band;
  /** the body under the band, null for idle, tucked and collapsed */
  body: { width: number; height: number } | null;
  /** the stage under the shape while a moment's cats are out, else null */
  stage: StageBox | null;
}

/** What the ear says: one or more items of text candidates (longest first) and the one up now. */
export interface EarInput {
  items: string[][];
  index: number;
}

function fitText(candidates: string[], measure: Measure, room: number): { text: string; width: number } {
  for (const text of candidates) {
    const width = Math.ceil(measure(text));
    if (width <= room) return { text, width };
  }
  const last = candidates.at(-1) ?? "";
  return { text: last, width: Math.min(room, Math.ceil(measure(last))) };
}

/** Views whose ear takes a rotation or a moment's label; the rest say their own fixed words. */
const EAR_VIEWS: ReadonlySet<IslandView> = new Set<IslandView>(["collapsed", "peek", "pop"]);

/**
 * Every item fitted to the room, the one up now picked: the ear is as wide
 * as its widest item, so a rotation crossfades its words in place and never
 * resizes the shape (or the window) every few seconds.
 */
function fitEar(items: string[][], index: number, measure: Measure, room: number): { text: string; width: number } {
  const fits = items.map((t) => fitText(t, measure, room));
  const up = fits[Math.min(Math.max(0, index), fits.length - 1)] ?? { text: "", width: 0 };
  return { text: up.text, width: Math.max(0, ...fits.map((f) => (f.text ? f.width : 0))) };
}

export function bandOf(view: IslandView, model: IslandModel, g: IslandGeometry, measure: Measure, queue: number, ear: EarInput | null = null): Band {
  const ring = showsRing(view, model);
  const ringPart = ring ? RING + RING_GAP : 0;
  const custom = ear && ear.items.length > 0 && EAR_VIEWS.has(view);
  const items = custom ? ear.items : [earTexts(view, model, queue)];
  const index = custom ? ear.index : 0;
  if (g.hasNotch) {
    const height = g.notchHeight;
    if (view === "idle" || view === "tucked") return { height, ear: 0, text: "", textWidth: 0, ring: false, notch: true, width: g.notchWidth };
    const room = EAR_MAX - EAR_INNER - EAR_OUTER - ringPart;
    const { text, width: textWidth } = fitEar(items, index, measure, room);
    const earW = Math.max(EAR_MIN, EAR_INNER + ringPart + textWidth + EAR_OUTER);
    return { height, ear: earW, text, textWidth, ring, notch: true, width: g.notchWidth + earW * 2 };
  }
  const room = EAR_MAX * 2 - EAR_OUTER * 2 - MINI_CAT - GAP - ringPart;
  const { text, width: textWidth } = fitEar(items, index, measure, room);
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
export function estimateBody(view: IslandView, model: IslandModel, askIndex: number, width: number, popText = ""): number {
  const inner = width - PAD_X * 2;
  if (view === "pop") return stack([Math.max(CONTROL_H, (linesFor(popText, inner, 13, 2) + 1) * LINE_S)]);
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
  /** what the ear says instead of its fixed words: the rotation, or a moment's label */
  ear?: EarInput | null;
  /** the width of the row of cats on the stage (Stage.minStageWidth); 0 or missing: no stage */
  stageRow?: number;
  /** the pop's sentence, for its estimate */
  popText?: string;
}

/** The stage under a shape of this width, both centred in the window that holds them. */
export function stageOf(shapeWidth: number, row: number): StageBox {
  const width = Math.max(STAGE_W, Math.ceil(row));
  return { width, height: STAGE_H, x: (Math.max(shapeWidth, width) - width) / 2 };
}

export function frameOf({ view, model, geometry: g, measure = estimateText, askIndex = 0, bodyHeight, ear = null, stageRow = 0, popText = "" }: FrameInput): Frame {
  const queue = model.asks.length;
  const band = bandOf(view, model, g, measure, queue, ear);
  const native = nativeStateOf(view, g.hasNotch);
  // an island off the screen has no stage either
  const stageFor = (w: number) => (stageRow > 0 && native !== "hidden" ? stageOf(w, stageRow) : null);
  if (view === "idle" || view === "tucked" || view === "collapsed") {
    // A notched band keeps its corners within a third of its height; the pill is a pill.
    const radius = g.hasNotch ? { top: 0, bottom: Math.min(R_BAND, Math.floor(band.height / 3)) } : { top: band.height / 2, bottom: band.height / 2 };
    return { view, native, width: band.width, height: band.height, radius, band, body: null, stage: stageFor(band.width) };
  }
  const width = Math.max(BODY_W[view], band.width);
  const measured = bodyHeight && bodyHeight > 0 ? Math.ceil(bodyHeight) : 0;
  const height = band.height + (measured || estimateBody(view, model, askIndex, width, popText));
  const r = Math.min(R_GROWN, Math.floor(height / 3));
  const radius = g.hasNotch ? { top: 0, bottom: r } : { top: r, bottom: r };
  return { view, native, width, height, radius, band, body: { width, height: height - band.height }, stage: stageFor(width) };
}

/** The native window for a frame: the union of the shape and the stage under it. */
export function windowOf(f: Pick<Frame, "width" | "height" | "stage">): { width: number; height: number } {
  if (!f.stage) return { width: f.width, height: f.height };
  return { width: Math.max(f.width, f.stage.width), height: f.height + f.stage.height };
}

/**
 * The parts of a window of size `win` that take the pointer, in
 * window-local points: the shape first (centred, on the top edge), then
 * each clickable cat (stage-local rects from Stage, under the shape, the
 * stage centred too), at most MAX_HIT (the shape and up to three cats).
 * Undefined when the shape is the whole window: the shell then takes the
 * whole window, the same thing.
 */
export function hitOf(f: Pick<Frame, "width" | "height" | "stage">, win: { width: number; height: number }, cats: readonly HitRect[] = []): HitRect[] | undefined {
  const shape: HitRect = { x: (win.width - f.width) / 2, y: 0, width: f.width, height: f.height };
  const stageX = (win.width - (f.stage?.width ?? 0)) / 2;
  const rows = f.stage ? cats.map((c) => ({ x: stageX + c.x, y: f.height + c.y, width: c.width, height: c.height })) : [];
  const rects = [shape, ...rows].slice(0, MAX_HIT);
  if (rects.length === 1 && shape.x === 0 && shape.width === win.width && shape.height === win.height) return undefined;
  return rects;
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
