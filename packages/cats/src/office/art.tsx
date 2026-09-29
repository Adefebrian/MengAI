// The office furniture, drawn as a three-quarter cutaway: every block has
// a top face seen from above and a front face seen face on. Flat fills,
// tonal steps and hairlines only (no gradient, no shadow, no glow). Every
// colour is a class in office.css on JAL Core tokens or the scene's small
// flat palette. Coordinates are world pixels from the plan (geometry.ts).
import type { CSSProperties, ReactNode } from "react";
import type { AgentStatus } from "@mengai/shared";
import type { OfficeAgent } from "../office-contract";
import type { Desk, OfficePlan, Rect } from "./geometry";
import { GLYPHS, type GlyphId } from "./glyphs";
import { fit, measure as measureWidth, type TextStyle } from "./text";

export function textStyle(plan: OfficePlan, weight: 400 | 500 = 400, mono = false): TextStyle {
  return { size: plan.m.text === "n1" ? 13 : 11, weight, mono };
}

export const MICRO: TextStyle = { size: 11 };

export function Glyph({ name, x, y, size, className }: { name: GlyphId; x: number; y: number; size: number; className: string }) {
  return (
    <svg className={className} x={x} y={y} width={size} height={size} viewBox="0 0 24 24">
      <path d={GLYPHS[name]} fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}

/** The status a name plate names beside the cat, when it is one to notice. */
export function statusMark(status: AgentStatus): { word: string; glyph: GlyphId; tone: string } | null {
  switch (status) {
    case "approval":
      return { word: "Needs you", glyph: "alert", tone: "warning" };
    case "error":
      return { word: "Error", glyph: "cross", tone: "danger" };
    case "stopped":
      return { word: "Stopped", glyph: "stop", tone: "muted" };
    case "done":
      return { word: "Done", glyph: "check", tone: "success" };
    case "waiting":
      return { word: "Waiting", glyph: "hourglass", tone: "muted" };
    default:
      return null;
  }
}

export function rnd(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

/* ---------------------------------------------------------------------
 * Blocks: a top face and a front face
 * ------------------------------------------------------------------- */

/** A furniture block: the top face from `top` to `face`, the front face from `face` to `bottom`. */
export function Block({ x, w, top, face, bottom, tone = "desk", r = 3 }: { x: number; w: number; top: number; face: number; bottom: number; tone?: string; r?: number }) {
  return (
    <g>
      <rect className={`of-${tone}-front`} x={x} y={face - 1} width={w} height={bottom - face + 1} rx={Math.min(r, 2)} />
      <rect className={`of-${tone}-top`} x={x} y={top} width={w} height={face - top} rx={r} />
    </g>
  );
}

export function Chair({ r }: { r: Rect }) {
  const w = r.w;
  return (
    <g>
      <rect className="of-chair" x={r.x} y={r.y} width={w} height={r.h + 6} rx={Math.min(12, w / 3)} />
      <rect className="of-chair-seam" x={r.x + w * 0.2} y={r.y + 7} width={w * 0.6} height={2} rx={1} />
    </g>
  );
}

export function Plant({ x, y, seed }: { x: number; y: number; seed: number }) {
  const kind = seed % 3;
  return (
    <g transform={`translate(${x} ${y})`}>
      {kind === 0 ? (
        <>
          <path className="of-leaf" d="M0 -14 C -8 -22 -6 -32 0 -36 C 6 -32 8 -22 0 -14 Z" />
          <path className="of-leaf-2" d="M0 -12 C 8 -16 14 -24 10 -30 C 4 -26 0 -20 0 -12 Z" />
        </>
      ) : kind === 1 ? (
        <>
          <path className="of-leaf" d="M0 -12 C -10 -16 -12 -24 -6 -28 C -2 -22 0 -18 0 -12 Z" />
          <path className="of-leaf-2" d="M0 -12 C 10 -16 12 -24 6 -28 C 2 -22 0 -18 0 -12 Z" />
          <path className="of-leaf" d="M0 -12 C -2 -20 0 -28 3 -32 C 4 -24 2 -18 0 -12 Z" />
        </>
      ) : (
        <>
          <rect className="of-cactus" x={-4} y={-30} width={8} height={20} rx={4} />
          <rect className="of-cactus" x={-10} y={-24} width={6} height={10} rx={3} />
          <rect className="of-cactus" x={4} y={-22} width={5} height={8} rx={2.5} />
        </>
      )}
      <path className="of-pot" d="M-8 -12 L8 -12 L6 0 L-6 0 Z" />
    </g>
  );
}

/** A tall floor plant in a corner, clear of every walk. */
export function FloorPlant({ x, y, big = false }: { x: number; y: number; big?: boolean }) {
  const k = big ? 1.25 : 1;
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`}>
      <path className="of-leaf" d="M0 -26 C -14 -34 -16 -52 -6 -62 C 0 -50 2 -40 0 -26 Z" />
      <path className="of-leaf-2" d="M0 -24 C 12 -30 18 -46 10 -58 C 2 -48 -2 -38 0 -24 Z" />
      <path className="of-leaf" d="M0 -22 C -4 -40 2 -60 8 -70 C 10 -54 6 -38 0 -22 Z" />
      <path className="of-pot" d="M-11 -24 L11 -24 L8 0 L-8 0 Z" />
    </g>
  );
}

export function DeskMug({ x, y, fresh, tone = 0 }: { x: number; y: number; fresh: boolean; tone?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {fresh ? (
        <>
          <path className="of-steam of-steam-a" d="M-3 -14 C -6 -18 0 -21 -3 -25" />
          <path className="of-steam of-steam-b" d="M3 -14 C 0 -18 6 -21 3 -25" />
        </>
      ) : null}
      <path className="of-mug-handle of-thin" d="M6 -9 C 10 -9 10 -3 6 -3" />
      <rect className={`of-mug of-thin of-mug-${tone % 3}`} x={-6} y={-12} width={12} height={12} rx={2} />
      <rect className="of-coffee" x={-4.5} y={-10.5} width={9} height={2.2} rx={1.1} />
    </g>
  );
}

/** A sticky note on a monitor bezel, a tone per cat. */
export function StickyNote({ x, y, seed }: { x: number; y: number; seed: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${(seed % 5) - 2})`}>
      <rect className={`of-sticky of-sticky-${seed % 3}`} x={0} y={0} width={13} height={13} rx={1} />
      <rect className="of-sticky-line" x={2.5} y={4} width={8} height={1.4} rx={0.7} />
      <rect className="of-sticky-line" x={2.5} y={7.5} width={5.5} height={1.4} rx={0.7} />
    </g>
  );
}

/** A cardboard box: the flaps open on a new hire's desk, closed with a plant peeking out when a cat leaves. */
export function BoxArt({ x, y, w, open }: { x: number; y: number; w: number; open: boolean }) {
  const h = Math.round(w * 0.72);
  return (
    <g transform={`translate(${x} ${y})`}>
      {open ? (
        <>
          <path className="of-box-flap" d={`M${-w / 2} ${-h} L${-w / 2 - w * 0.22} ${-h - w * 0.2} L${-w * 0.08} ${-h - w * 0.2} L0 ${-h} Z`} />
          <path className="of-box-flap" d={`M${w / 2} ${-h} L${w / 2 + w * 0.22} ${-h - w * 0.2} L${w * 0.08} ${-h - w * 0.2} L0 ${-h} Z`} />
          <rect className="of-mug of-thin of-mug-1" x={-w * 0.3} y={-h - 6} width={w * 0.22} height={w * 0.22} rx={1.5} />
          <path className="of-leaf" d={`M${w * 0.14} ${-h + 2} C ${w * 0.06} ${-h - 8} ${w * 0.12} ${-h - 14} ${w * 0.2} ${-h - 16} C ${w * 0.24} ${-h - 8} ${w * 0.2} ${-h - 2} ${w * 0.14} ${-h + 2} Z`} />
        </>
      ) : null}
      <rect className="of-box" x={-w / 2} y={-h} width={w} height={h} rx={1.5} />
      <rect className="of-box-tape" x={-w * 0.12} y={-h} width={w * 0.24} height={h * 0.45} />
      <rect className="of-box-label" x={w * 0.1} y={-h * 0.4} width={w * 0.28} height={h * 0.22} rx={1} />
    </g>
  );
}

/* ---------------------------------------------------------------------
 * Speech bubbles
 * ------------------------------------------------------------------- */

/** Speech bubble path: a rounded box with a tail on its bottom edge at tailX. */
function bubblePath(x: number, y: number, w: number, h: number, tailX: number): string {
  const r = 8;
  const t = Math.max(x + r + 6, Math.min(x + w - r - 6, tailX));
  const b = y + h;
  return [
    `M${x + r} ${y}`,
    `L${x + w - r} ${y}`,
    `Q${x + w} ${y} ${x + w} ${y + r}`,
    `L${x + w} ${b - r}`,
    `Q${x + w} ${b} ${x + w - r} ${b}`,
    `L${t + 5} ${b}`,
    `L${t} ${b + 6}`,
    `L${t - 5} ${b}`,
    `L${x + r} ${b}`,
    `Q${x} ${b} ${x} ${b - r}`,
    `L${x} ${y + r}`,
    `Q${x} ${y} ${x + r} ${y}`,
    "Z",
  ].join(" ");
}

export function Bubble({ text, lane, anchor, plan, on }: { text: string; lane: Rect; anchor: number; plan: OfficePlan; on: boolean }) {
  const style = textStyle(plan);
  const shown = fit(text, lane.w - 20, style);
  if (!shown) return null;
  const w = Math.min(lane.w, Math.ceil(measureWidth(shown, style)) + 20);
  const x = Math.max(lane.x, Math.min(lane.x + lane.w - w, anchor - w / 2));
  const h = lane.h - 6;
  return (
    <g className="of-bubble" data-on={on ? "" : undefined} aria-hidden="true">
      <path className="of-bubble-box" d={bubblePath(x, lane.y, w, h, anchor)} />
      <text className={`of-t of-t-${plan.m.text} of-ink`} x={x + 10} y={lane.y + h / 2 + (plan.m.text === "n1" ? 4.5 : 4)}>
        {shown}
      </text>
    </g>
  );
}

/* ---------------------------------------------------------------------
 * Monitors: the screen for the activity, the fund's market screens
 * ------------------------------------------------------------------- */

export type ScreenMode = "code" | "run" | "doc" | "review" | "web" | "design" | "scan" | "board" | "idle" | "chart" | "book" | "risk";

const SCREEN_LABEL: Record<ScreenMode, string> = {
  code: "editor",
  run: "terminal",
  doc: "reader",
  review: "diff",
  web: "browser",
  design: "canvas",
  scan: "scanner",
  board: "plan",
  idle: "",
  chart: "price",
  book: "order book",
  risk: "risk",
};

export function screenLabel(mode: ScreenMode): string {
  return SCREEN_LABEL[mode];
}

export function screenFor(activity: string, role: string): ScreenMode {
  switch (activity) {
    case "code":
      return role === "designer" ? "design" : "code";
    case "run":
    case "automate":
      return "run";
    case "read":
      return "doc";
    case "review":
      return "review";
    case "research":
      return "web";
    case "design":
      return "design";
    case "scan":
      return "scan";
    case "plan":
      return "board";
    default:
      return "idle";
  }
}

/** The fund's second screen: the order book while a trader executes, a backtest's output on a run, risk while it reviews or scans. */
export function fundScreenFor(activity: string): ScreenMode {
  switch (activity) {
    case "automate":
      return "book";
    case "run":
      return "run";
    case "review":
    case "scan":
      return "risk";
    case "code":
      return "code";
    case "read":
    case "research":
      return "doc";
    case "plan":
      return "board";
    default:
      return "idle";
  }
}

const TOKENS = ["of-code-a", "of-code-b", "of-code-c", "of-code-d"];

function codeLines(seed: number, count: number, width: number): Array<{ indent: number; parts: Array<{ w: number; cls: string }> }> {
  const r = rnd(seed);
  const out: Array<{ indent: number; parts: Array<{ w: number; cls: string }> }> = [];
  let indent = 0;
  for (let i = 0; i < count; i++) {
    const parts: Array<{ w: number; cls: string }> = [];
    let left = width - indent * 6 - 6;
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n && left > 8; k++) {
      const w = Math.max(5, Math.min(left, Math.round(6 + r() * width * 0.3)));
      parts.push({ w, cls: k === 0 ? TOKENS[Math.floor(r() * 3)]! : "of-code-d" });
      left -= w + 3;
    }
    out.push({ indent, parts });
    const step = r();
    indent = Math.max(0, Math.min(3, indent + (step > 0.66 ? 1 : step < 0.3 ? -1 : 0)));
  }
  return out;
}

function Lines({ x, y, w, rows, pitch, seed }: { x: number; y: number; w: number; rows: number; pitch: number; seed: number }) {
  const lines = codeLines(seed, rows, w);
  return (
    <>
      {lines.map((l, i) => {
        let cx = x + l.indent * 6;
        return (
          <g key={i}>
            {l.parts.map((p, k) => {
              const el = <rect key={k} className={p.cls} x={cx} y={y + i * pitch} width={p.w} height={3} rx={1.5} />;
              cx += p.w + 3;
              return el;
            })}
          </g>
        );
      })}
    </>
  );
}

/** A price line over a few candles; the strip is twice as wide and scrolls left in a loop. */
function Chart({ x, y, w, h, seed }: { x: number; y: number; w: number; h: number; seed: number }) {
  const r = rnd(seed);
  const n = 16;
  const step = w / n;
  const pts: number[] = [];
  let v = 0.5;
  for (let i = 0; i < n; i++) {
    v = Math.max(0.12, Math.min(0.88, v + (r() - 0.46) * 0.28));
    pts.push(v);
  }
  // the loop: the second half repeats the first so the scroll has no seam
  const all = [...pts, ...pts, pts[0]!];
  const line = all.map((p, i) => `${i === 0 ? "M" : "L"}${(x + i * step).toFixed(1)} ${(y + h - p * h).toFixed(1)}`).join(" ");
  return (
    <g className="of-scroll-x" style={{ ["--of-scroll-x" as string]: `${-w}px` } as CSSProperties}>
      {all.slice(0, -1).map((p, i) => {
        const q = all[i + 1]!;
        const up = q >= p;
        const top = y + h - Math.max(p, q) * h;
        const bh = Math.max(2, Math.abs(q - p) * h);
        return <rect key={i} className={up ? "of-bull" : "of-bear"} x={x + i * step + step * 0.3} y={top} width={Math.max(1.5, step * 0.4)} height={bh} rx={0.6} />;
      })}
      <path className="of-price" d={line} />
    </g>
  );
}

/** Bids and asks: two stacks of bars, each bar breathing on its own beat. */
function OrderBook({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const rows = Math.max(2, Math.floor((h - 4) / 6));
  const half = Math.floor(rows / 2);
  const mid = w / 2;
  return (
    <>
      {Array.from({ length: rows }, (_, i) => {
        const ask = i < half;
        const depth = ask ? half - i : i - half + 1;
        const bw = Math.max(4, (mid - 3) * (0.28 + ((depth * 37) % 60) / 100));
        const yy = y + 2 + i * 6 + (ask ? 0 : 2);
        return (
          <g key={i}>
            <rect className="of-code-d" x={x + 2} y={yy} width={mid * 0.5} height={3} rx={1.5} />
            <rect className={`${ask ? "of-bear" : "of-bull"} of-depth of-depth-${i % 3}`} x={x + w - 2 - bw} y={yy} width={bw} height={3} rx={1.5} />
          </g>
        );
      })}
      <rect className="of-spread" x={x + 2} y={y + 2 + half * 6 - 1} width={w - 4} height={1} />
    </>
  );
}

/** Exposure against its limit, a bar per book, one of them creeping. */
function Risk({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const rows = Math.max(2, Math.min(5, Math.floor((h - 4) / 8)));
  return (
    <>
      {Array.from({ length: rows }, (_, i) => {
        const f = 0.3 + ((i * 29) % 55) / 100;
        const yy = y + 2 + i * 8;
        return (
          <g key={i}>
            <rect className="of-mini-card" x={x} y={yy} width={w} height={4} rx={2} />
            <rect className={`${f > 0.7 ? "of-bear" : "of-code-a"}${i === 1 ? " of-creep" : ""}`} x={x} y={yy} width={w * f} height={4} rx={2} />
          </g>
        );
      })}
      <rect className="of-limit" x={x + w * 0.86} y={y} width={1.5} height={rows * 8} />
    </>
  );
}

export interface MonitorProps {
  r: Rect;
  mode: ScreenMode;
  label: string;
  animate: boolean;
  dim: boolean;
  clip: string;
  seed: number;
  /** a sticky note on the bezel */
  note?: boolean;
  /** the stand under the screen (a monitor arm pair shares one) */
  stand?: boolean;
}

export function Monitor({ r, mode, label, animate, dim, clip, seed, note = false, stand = true }: MonitorProps) {
  const bezel = 3;
  const bar = r.h >= 44 ? 15 : 11;
  const sx = r.x + bezel;
  const sy = r.y + bezel;
  const sw = r.w - 2 * bezel;
  const sh = r.h - 2 * bezel;
  const body = { x: sx, y: sy + bar, w: sw, h: sh - bar };
  const pitch = 7;
  const rows = Math.max(2, Math.floor((body.h - 6) / pitch));
  // a tab too narrow for a few letters of its name stays plain rather than showing a stub
  const fitted = fit(label, sw - 10, { size: 11, mono: true });
  const tab = fitted === label || fitted.length >= Math.min(label.length, 5) ? fitted : "";
  const cx = r.x + r.w / 2;
  let content: ReactNode;
  const inner = { x: body.x + 5, y: body.y + 5, w: body.w - 10 };
  switch (mode) {
    case "code":
      content = (
        <>
          <g className="of-scroll" style={{ ["--of-scroll" as string]: `${-pitch * 8}px` } as CSSProperties}>
            <Lines x={inner.x} y={inner.y} w={inner.w} rows={rows - 1 + 16} pitch={pitch} seed={seed} />
          </g>
          <rect className="of-screen" x={body.x} y={inner.y + (rows - 1) * pitch - 2} width={body.w} height={body.h} />
          <rect className="of-code-a of-typing" x={inner.x} y={inner.y + (rows - 1) * pitch} width={Math.max(10, inner.w * 0.55)} height={3} rx={1.5} />
          <rect className="of-caret" x={inner.x + Math.max(10, inner.w * 0.55) + 2} y={inner.y + (rows - 1) * pitch - 2} width={1.6} height={7} />
        </>
      );
      break;
    case "run":
      content = (
        <g className="of-scroll of-scroll-fast" style={{ ["--of-scroll" as string]: `${-pitch * 8}px` } as CSSProperties}>
          {Array.from({ length: rows + 8 }, (_, i) => (
            <g key={i}>
              {i % 3 === 2 ? <path className="of-run-check" d={`M${inner.x} ${inner.y + i * pitch + 1.5} l2 2 l3.5 -3.5`} /> : null}
              <rect className={i % 3 === 0 ? "of-code-c" : "of-code-d"} x={inner.x + (i % 3 === 2 ? 8 : 0)} y={inner.y + i * pitch} width={Math.max(8, inner.w * (0.35 + ((i * 37) % 50) / 100))} height={3} rx={1.5} />
            </g>
          ))}
        </g>
      );
      break;
    case "doc":
    case "review":
      content = (
        <>
          {mode === "review" ? <rect className="of-highlight of-sweep" x={body.x + 2} y={inner.y - 2} width={body.w - 4} height={7} rx={1.5} style={{ ["--of-sweep" as string]: `${(rows - 2) * pitch}px` } as CSSProperties} /> : null}
          {Array.from({ length: rows }, (_, i) => (
            <rect key={i} className={mode === "review" && i % 4 === 1 ? "of-code-c" : mode === "review" && i % 5 === 3 ? "of-code-b" : "of-code-d"} x={inner.x} y={inner.y + i * pitch} width={inner.w * (i % 4 === 3 ? 0.6 : 0.92)} height={3} rx={1.5} />
          ))}
        </>
      );
      break;
    case "web":
      content = (
        <>
          <rect className="of-field" x={inner.x} y={inner.y - 1} width={inner.w} height={8} rx={4} />
          <rect className="of-caret" x={inner.x + 6} y={inner.y} width={1.4} height={6} />
          {Array.from({ length: Math.max(1, rows - 2) }, (_, i) => (
            <g key={i} className={`of-result of-result-${(i % 3) + 1}`}>
              <rect className="of-code-a" x={inner.x} y={inner.y + 12 + i * pitch} width={inner.w * 0.4} height={3} rx={1.5} />
              <rect className="of-code-d" x={inner.x + inner.w * 0.44} y={inner.y + 12 + i * pitch} width={inner.w * 0.5} height={3} rx={1.5} />
            </g>
          ))}
        </>
      );
      break;
    case "design":
      content = (
        <>
          <rect className="of-block of-block-1" x={inner.x} y={inner.y} width={inner.w} height={5} rx={1.5} />
          <rect className="of-block of-block-2" x={inner.x} y={inner.y + 8} width={inner.w * 0.48} height={Math.max(8, body.h - 26)} rx={2} />
          <rect className="of-block of-block-3" x={inner.x + inner.w * 0.52} y={inner.y + 8} width={inner.w * 0.48} height={Math.max(8, body.h - 26)} rx={2} />
          <rect className="of-block of-block-4" x={inner.x} y={body.y + body.h - 9} width={inner.w * 0.32} height={5} rx={2.5} />
        </>
      );
      break;
    case "scan":
      content = (
        <>
          {Array.from({ length: rows }, (_, i) => (
            <rect key={i} className="of-code-d" x={inner.x} y={inner.y + i * pitch} width={inner.w * (0.5 + ((i * 29) % 40) / 100)} height={3} rx={1.5} />
          ))}
          <rect className="of-scanbar of-sweep" x={body.x + 2} y={inner.y - 2} width={body.w - 4} height={3} rx={1.5} style={{ ["--of-sweep" as string]: `${(rows - 1) * pitch}px` } as CSSProperties} />
        </>
      );
      break;
    case "board": {
      const cw = (inner.w - 6) / 3;
      content = (
        <>
          {[0, 1, 2].map((c) => (
            <g key={c}>
              <rect className="of-code-d" x={inner.x + c * (cw + 3)} y={inner.y} width={cw * 0.6} height={3} rx={1.5} />
              {Array.from({ length: Math.max(1, Math.min(3, rows - 2 - c)) }, (_, i) => (
                <rect key={i} className="of-mini-card" x={inner.x + c * (cw + 3)} y={inner.y + 6 + i * 9} width={cw} height={7} rx={1.5} />
              ))}
            </g>
          ))}
          <rect className="of-mini-card of-mini-move" x={inner.x} y={inner.y + 6 + 9 * Math.max(0, Math.min(2, rows - 3))} width={cw} height={7} rx={1.5} style={{ ["--of-move" as string]: `${cw + 3}px` } as CSSProperties} />
        </>
      );
      break;
    }
    case "chart":
      content = <Chart x={body.x + 3} y={body.y + 4} w={body.w - 6} h={body.h - 8} seed={seed} />;
      break;
    case "book":
      content = <OrderBook x={body.x + 2} y={body.y + 2} w={body.w - 4} h={body.h - 4} />;
      break;
    case "risk":
      content = <Risk x={inner.x} y={inner.y - 2} w={inner.w} h={body.h - 6} />;
      break;
    default: {
      // idle: a paw print resting on the lock screen
      const px = body.x + body.w / 2;
      const py = body.y + body.h / 2 + 2;
      const k = Math.min(1, body.h / 34);
      content = (
        <g className="of-idle-paw" transform={`translate(${px} ${py}) scale(${k})`}>
          <ellipse cx={0} cy={3} rx={6} ry={5} />
          <circle cx={-6} cy={-4} r={2.4} />
          <circle cx={-2} cy={-8} r={2.4} />
          <circle cx={2} cy={-8} r={2.4} />
          <circle cx={6} cy={-4} r={2.4} />
        </g>
      );
    }
  }
  return (
    <g className="of-monitor" data-mode={mode} data-anim={animate ? "" : undefined} data-dim={dim ? "" : undefined}>
      {stand ? (
        <>
          <rect className="of-stand" x={cx - 3.5} y={r.y + r.h} width={7} height={9} />
          <rect className="of-stand-base" x={cx - 15} y={r.y + r.h + 7} width={30} height={4} rx={2} />
        </>
      ) : null}
      <rect className="of-bezel" x={r.x} y={r.y} width={r.w} height={r.h} rx={4} />
      <rect className="of-screen" x={sx} y={sy} width={sw} height={sh} rx={2} />
      <rect className="of-tabbar" x={sx} y={sy} width={sw} height={bar} />
      {tab && bar >= 15 ? (
        <text className="of-t of-t-n2 of-mono of-muted" x={sx + 5} y={sy + 11}>
          {tab}
        </text>
      ) : null}
      <clipPath id={clip}>
        <rect x={body.x} y={body.y} width={body.w} height={body.h} />
      </clipPath>
      <g className="of-screen-body" clipPath={`url(#${clip})`}>
        {content}
      </g>
      {note ? <StickyNote x={r.x + r.w - 15} y={r.y - 5} seed={seed} /> : null}
    </g>
  );
}

/* ---------------------------------------------------------------------
 * The desk: the block, its keyboard, what stands on it, the name plate
 * ------------------------------------------------------------------- */

/** Two paws on the keyboard, tapping while the cat types. */
export function KeyboardPaws({ desk, agent, typing }: { desk: Desk; agent: OfficeAgent; typing: boolean }) {
  const k = desk.keyboard;
  const s = desk.cat / 160;
  const rx = 9 * s;
  const ry = 5.4 * s;
  return (
    <g className="cat of-paws" data-coat={agent.look.coat} data-typing={typing ? "" : undefined} style={{ "--cat-sw": "1.2" } as CSSProperties}>
      <ellipse className="c-paw of-tap-a" cx={k.x + k.w * 0.28} cy={k.y + 0.5} rx={rx} ry={ry} />
      <ellipse className="c-paw of-tap-b" cx={k.x + k.w * 0.72} cy={k.y + 0.5} rx={rx} ry={ry} />
    </g>
  );
}

export function DeskBody({ desk }: { desk: Desk }) {
  const { rect, top, face } = desk;
  const bottom = rect.y + rect.h;
  const k = desk.keyboard;
  return (
    <g>
      <Block x={rect.x} w={rect.w} top={top} face={face} bottom={bottom} />
      <rect className="of-keyboard" x={k.x} y={k.y} width={k.w} height={k.h} rx={1.5} />
      <rect className="of-keys" x={k.x + 2} y={k.y + 1} width={k.w - 4} height={Math.max(1, k.h - 2.5)} rx={1} />
      {desk.drawer ? (
        <g>
          <rect className="of-drawer" x={desk.drawer.x} y={desk.drawer.y} width={desk.drawer.w} height={desk.drawer.h} rx={3} />
          <rect className="of-handle" x={desk.drawer.x + desk.drawer.w / 2 - 9} y={desk.drawer.y + 7} width={18} height={3} rx={1.5} />
          <rect className="of-drawer-seam" x={desk.drawer.x} y={desk.drawer.y + desk.drawer.h / 2} width={desk.drawer.w} height={1} />
          <rect className="of-handle" x={desk.drawer.x + desk.drawer.w / 2 - 9} y={desk.drawer.y + desk.drawer.h / 2 + 6} width={18} height={3} rx={1.5} />
        </g>
      ) : null}
    </g>
  );
}

/** A desk lamp or a stack of books on a wide desk. */
export function DeskExtra({ x, y, seed }: { x: number; y: number; seed: number }) {
  if (seed % 2 === 0) {
    return (
      <g transform={`translate(${x} ${y})`}>
        <rect className="of-book of-book-0" x={-11} y={-6} width={22} height={6} rx={1} />
        <rect className="of-book of-book-1" x={-9} y={-11} width={19} height={5} rx={1} />
        <rect className="of-book of-book-2" x={-10} y={-15} width={17} height={4} rx={1} />
      </g>
    );
  }
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect className="of-lamp" x={-8} y={-3} width={16} height={3} rx={1.5} />
      <path className="of-lamp-arm" d="M0 -3 L-5 -20 L6 -30" />
      <path className="of-lamp" d="M2 -34 L14 -28 L8 -22 Z" />
    </g>
  );
}

/** The desk bell: a trader's target hit. */
export function DeskBell({ x, y, ring }: { x: number; y: number; ring: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g key={ring} className={ring ? "of-bell of-bell-ring" : "of-bell"}>
        <path className="of-brass" d="M-9 -3 C -9 -12 -5 -16 0 -16 C 5 -16 9 -12 9 -3 Z" />
        <rect className="of-brass-dark" x={-1.5} y={-19.5} width={3} height={4} rx={1.5} />
        {ring ? (
          <g className="of-ring-marks">
            <path className="of-ring" d="M-13 -14 Q -16 -9 -13 -4" />
            <path className="of-ring" d="M13 -14 Q 16 -9 13 -4" />
          </g>
        ) : null}
      </g>
      <rect className="of-brass-dark" x={-12} y={-3} width={24} height={3} rx={1.5} />
    </g>
  );
}

/** The lead's approval stamp coming down on a sheet, then the green mark. */
export function ApproveStamp({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g key={n} transform={`translate(${x} ${y})`}>
      <rect className="of-sheet" x={-13} y={-8} width={26} height={10} rx={1} />
      <g className="of-stamp-mark">
        <circle className="of-stamp-pass" cx={0} cy={-3} r={4.5} />
        <path className="of-stamp-glyph of-glyph-sm" d="M-2.2 -2.9 L-0.6 -1.3 L2.4 -4.6" />
      </g>
      <g className="of-stamp-press">
        <rect className="of-stamp-handle" x={-3} y={-30} width={6} height={12} rx={3} />
        <rect className="of-stamp-base" x={-8} y={-19} width={16} height={6} rx={1.5} />
      </g>
    </g>
  );
}

/** The name plate on the desk front: name and role (or a status to notice), then the task. */
export function DeskCard({ desk, plan, name, role, status, task, stamp }: { desk: Desk; plan: OfficePlan; name: string; role: string; status: AgentStatus; task: string | null; stamp: "pass" | "return" | null }) {
  const r = desk.card;
  const n1 = plan.m.text === "n1";
  const lh = n1 ? 15 : 13;
  const pad = 8;
  const nameStyle = textStyle(plan, 500);
  const bodyStyle = textStyle(plan);
  const mark = statusMark(status);
  const stampRoom = stamp ? 22 : 0;
  const avail = r.w - pad * 2 - stampRoom;
  const nameText = fit(name, avail * 0.6, nameStyle);
  const nameW = measureWidth(nameText, nameStyle);
  const icon = n1 ? 12 : 11;
  const sideRoom = avail - nameW - 6 - (mark ? icon + 3 : 0);
  const side = fit(mark ? mark.word : role, sideRoom, bodyStyle);
  const taskText = fit(task ?? "No task yet", avail, bodyStyle);
  const y1 = r.y + Math.round((r.h - lh * 2) / 2) + lh - 3;
  const y2 = y1 + lh;
  const sideX = r.x + pad + nameW + 6;
  return (
    <g className="of-desk-card">
      <rect className="of-card-paper" x={r.x} y={r.y} width={r.w} height={r.h} rx={4} />
      <text className={`of-t of-t-${plan.m.text} of-ink of-medium`} x={r.x + pad} y={y1}>
        {nameText}
      </text>
      {side ? (
        <>
          {mark ? <Glyph name={mark.glyph} x={sideX} y={y1 - icon + 1} size={icon} className={`of-glyph of-tone-${mark.tone}`} /> : null}
          <text className={`of-t of-t-${plan.m.text} ${mark ? `of-tone-${mark.tone}` : "of-muted"}`} x={sideX + (mark ? icon + 3 : 0)} y={y1}>
            {side}
          </text>
        </>
      ) : null}
      <text className={`of-t of-t-${plan.m.text} ${task ? "of-muted" : "of-subtle"}`} x={r.x + pad} y={y2}>
        {taskText}
      </text>
      {stamp ? (
        <g transform={`translate(${r.x + r.w - 15} ${r.y + r.h / 2})`}>
          <g className="of-desk-stamp">
            <circle className={stamp === "pass" ? "of-stamp-pass" : "of-stamp-return"} cx={0} cy={0} r={9} />
            {stamp === "pass" ? <path className="of-stamp-glyph" d="M-4.4 0.4 L-1.4 3.4 L4.4 -3.4" /> : <path className="of-stamp-glyph" d="M3.6 3.6 C 4.2 -2.8 -1 -4.2 -3.6 -1 M-4 -4.6 L-3.6 -1 L-0.2 -1.6" />}
          </g>
        </g>
      ) : null}
    </g>
  );
}

/** A free desk after a cat left: the chair pushed in, a dark screen, a plate that says so. */
export function VacantDesk({ desk, plan }: { desk: Desk; plan: OfficePlan }) {
  const r = desk.card;
  return (
    <g className="of-desk" data-vacant="">
      <Chair r={desk.chair} />
      <rect className="of-bezel" x={desk.monitor.x} y={desk.monitor.y} width={desk.monitor.w} height={desk.monitor.h} rx={4} />
      <rect className="of-screen-off" x={desk.monitor.x + 3} y={desk.monitor.y + 3} width={desk.monitor.w - 6} height={desk.monitor.h - 6} rx={2} />
      <rect className="of-stand" x={desk.monitor.x + desk.monitor.w / 2 - 3.5} y={desk.monitor.y + desk.monitor.h} width={7} height={9} />
      <rect className="of-stand-base" x={desk.monitor.x + desk.monitor.w / 2 - 15} y={desk.monitor.y + desk.monitor.h + 7} width={30} height={4} rx={2} />
      <DeskBody desk={desk} />
      <rect className="of-card-paper" x={r.x} y={r.y} width={r.w} height={r.h} rx={4} />
      <text className={`of-t of-t-${plan.m.text} of-subtle`} x={r.x + 8} y={r.y + r.h / 2 + (plan.m.text === "n1" ? 4.5 : 4)}>
        {fit("Free desk", r.w - 16, textStyle(plan))}
      </text>
    </g>
  );
}
