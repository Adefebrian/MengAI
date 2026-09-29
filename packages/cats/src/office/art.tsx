// The office furniture: flat fills, tonal steps and hairlines only (no
// gradient, no shadow, no glow). Every colour is a class in office.css on
// JAL Core tokens or the scene's small flat palette. Coordinates are world
// pixels from the plan (geometry.ts).
import type { ReactNode } from "react";
import type { AgentStatus } from "@mengai/shared";
import type { OfficeMeeting, OfficeProps } from "../office-contract";
import type { Desk, OfficePlan, Rect } from "./geometry";
import { GLYPHS, type GlyphId } from "./glyphs";
import { fit, measure as measureWidth, type TextStyle } from "./text";

type PlanCard = NonNullable<OfficeProps["plan"]>[number];

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

/** The status a desk card names beside the cat, when it is one to notice. */
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

/* ---------------------------------------------------------------------
 * Structure: the slab, rooms, walls, doors
 * ------------------------------------------------------------------- */

export function Structure({ plan }: { plan: OfficePlan }) {
  const { ceo, meeting } = plan;
  const wideRooms = meeting !== null && meeting.rect.y === ceo.rect.y;
  return (
    <g className="of-structure">
      <rect className="of-slab" x={0.5} y={0.5} width={plan.width - 1} height={plan.height - 1} rx={16} />
      {ceo.kind === "room" ? (
        <>
          <Room rect={ceo.rect} floorTop={ceo.floorTop} doorX={ceo.door} />
          <FloorPlant x={ceo.rect.x + 22} y={ceo.rect.y + ceo.rect.h - 10} />
          {ceo.lounge ? <Lounge r={ceo.lounge} /> : null}
        </>
      ) : (
        <CeoCorner plan={plan} />
      )}
      {meeting ? <Room rect={meeting.rect} floorTop={meeting.floorTop} doorX={meeting.door.inWall ? null : meeting.door.x} /> : null}
      {meeting && meeting.window ? <Window r={meeting.window} /> : null}
      {plan.zones.map((z, i) => (
        <rect key={`z${i}`} className="of-zone" x={z.x} y={z.y} width={z.w} height={z.h} rx={12} />
      ))}
      {meeting && wideRooms ? <rect className="of-partition" x={meeting.rect.x - 3} y={meeting.rect.y} width={6} height={meeting.rect.h} /> : null}
      {meeting && meeting.door.inWall ? <Doorway x={meeting.door.x} y={meeting.floorTop} /> : null}
      {plan.nooks.map((r, i) => (
        <Nook key={i} r={r} top={r.y + plan.m.deskTop} seed={i} />
      ))}
    </g>
  );
}

/** The hero's open CEO corner: a rug under the lead's desk and the easel, and the easel's legs. */
function CeoCorner({ plan }: { plan: OfficePlan }) {
  const { rect, whiteboard: wb } = plan.ceo;
  const floor = rect.y + rect.h;
  const rugTop = rect.y + plan.m.deskTop + 18;
  const legY = wb.y + wb.h;
  return (
    <g>
      <rect className="of-rug" x={rect.x - 4} y={rugTop} width={rect.w + 8} height={floor + plan.m.aisle - 10 - rugTop} rx={10} />
      <path className="of-easel-leg" d={`M${wb.x + 14} ${legY} L${wb.x + 6} ${floor} M${wb.x + wb.w - 14} ${legY} L${wb.x + wb.w - 6} ${floor} M${wb.x + wb.w / 2} ${legY} L${wb.x + wb.w / 2} ${floor - 6}`} />
    </g>
  );
}

/** The visitor sofa of a stacked CEO office, with a side table and a floor plant. */
function Lounge({ r }: { r: Rect }) {
  const bottom = r.y + r.h;
  const w = Math.min(120, r.w - 44);
  const x = r.x;
  const seatTop = bottom - 26;
  return (
    <g>
      <rect className="of-sofa-back" x={x} y={seatTop - 22} width={w} height={34} rx={10} />
      <rect className="of-sofa-seat" x={x + 6} y={seatTop} width={w - 12} height={22} rx={7} />
      <rect className="of-sofa-arm" x={x - 4} y={seatTop - 8} width={15} height={30} rx={7} />
      <rect className="of-sofa-arm" x={x + w - 11} y={seatTop - 8} width={15} height={30} rx={7} />
      <rect className="of-desk-front" x={x + w + 12} y={bottom - 20} width={26} height={20} rx={3} />
      <rect className="of-desk-top" x={x + w + 9} y={bottom - 24} width={32} height={5} rx={2} />
      <DeskMug x={x + w + 25} y={bottom - 24} fresh={false} />
    </g>
  );
}

/** A spare hero cell: a low shelf of binders and a floor plant. */
function Nook({ r, top, seed }: { r: Rect; top: number; seed: number }) {
  const bottom = r.y + r.h;
  const w = Math.min(120, r.w * 0.56);
  const x = r.x + 12;
  const shelfTop = top - 26;
  const books = [10, 7, 12, 8, 11, 9, 7];
  let bx = x + 6;
  return (
    <g>
      <rect className="of-shelf-body" x={x} y={shelfTop} width={w} height={bottom - shelfTop} rx={4} />
      <rect className="of-shelf-board" x={x} y={top + 14} width={w} height={3} />
      {books.map((bw, i) => {
        if (bx + bw > x + w - 6) return null;
        const h = 18 + ((i * 7 + seed * 3) % 8);
        const el = <rect key={i} className={`of-book of-book-${(i + seed) % 3}`} x={bx} y={top + 14 - h} width={bw} height={h} rx={1.5} />;
        bx += bw + 2;
        return el;
      })}
      <FloorPlant x={x + w + Math.min(40, (r.w - w - 12) / 2)} y={bottom - 2} />
    </g>
  );
}

/** A window in a back wall: a flat pale sky in a frame with one mullion. */
function Window({ r }: { r: Rect }) {
  return (
    <g>
      <rect className="of-window-frame" x={r.x} y={r.y} width={r.w} height={r.h} rx={4} />
      <rect className="of-sky" x={r.x + 4} y={r.y + 4} width={r.w - 8} height={r.h - 8} rx={2} />
      <ellipse className="of-cloud" cx={r.x + r.w * 0.3} cy={r.y + r.h * 0.42} rx={r.w * 0.12} ry={4} />
      <ellipse className="of-cloud" cx={r.x + r.w * 0.36} cy={r.y + r.h * 0.36} rx={r.w * 0.08} ry={4.5} />
      <ellipse className="of-cloud" cx={r.x + r.w * 0.74} cy={r.y + r.h * 0.66} rx={r.w * 0.1} ry={3.5} />
      <rect className="of-window-frame" x={r.x + r.w / 2 - 1.5} y={r.y} width={3} height={r.h} />
    </g>
  );
}

/** A tall floor plant in a room corner, clear of every walk. */
function FloorPlant({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path className="of-leaf" d="M0 -26 C -14 -34 -16 -52 -6 -62 C 0 -50 2 -40 0 -26 Z" />
      <path className="of-leaf-2" d="M0 -24 C 12 -30 18 -46 10 -58 C 2 -48 -2 -38 0 -24 Z" />
      <path className="of-leaf" d="M0 -22 C -4 -40 2 -60 8 -70 C 10 -54 6 -38 0 -22 Z" />
      <path className="of-pot" d="M-11 -24 L11 -24 L8 0 L-8 0 Z" />
    </g>
  );
}

function Room({ rect, floorTop, doorX }: { rect: Rect; floorTop: number; doorX: number | null }) {
  const bottom = rect.y + rect.h;
  const gap = 46;
  return (
    <g>
      <rect className="of-room-floor" x={rect.x} y={floorTop} width={rect.w} height={bottom - floorTop} />
      <rect className="of-wall" x={rect.x} y={rect.y} width={rect.w} height={floorTop - rect.y} />
      <rect className="of-skirting" x={rect.x} y={floorTop - 4} width={rect.w} height={4} />
      {doorX !== null ? (
        <path className="of-glass" d={`M${rect.x} ${bottom} L${doorX - gap / 2} ${bottom} M${doorX + gap / 2} ${bottom} L${rect.x + rect.w} ${bottom}`} />
      ) : (
        <path className="of-glass" d={`M${rect.x} ${bottom} L${rect.x + rect.w} ${bottom}`} />
      )}
    </g>
  );
}

function Doorway({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect className="of-door-frame" x={x - 25} y={y - 70} width={50} height={70} rx={3} />
      <rect className="of-doorway" x={x - 21} y={y - 66} width={42} height={66} rx={2} />
    </g>
  );
}

/* ---------------------------------------------------------------------
 * Desk pieces
 * ------------------------------------------------------------------- */

export function Chair({ r }: { r: Rect }) {
  return <rect className="of-chair" x={r.x} y={r.y} width={r.w} height={r.h + 6} rx={Math.min(10, r.w / 3)} />;
}

export function DeskBody({ desk }: { desk: Desk }) {
  const { rect, top } = desk;
  const band = 8;
  return (
    <g>
      <rect className="of-desk-front" x={rect.x + 6} y={top + band - 1} width={rect.w - 12} height={rect.y + rect.h - top - band + 1} rx={3} />
      <rect className="of-desk-top" x={rect.x + 2} y={top} width={rect.w - 4} height={band} rx={2} />
    </g>
  );
}

export function Plant({ x, y, seed }: { x: number; y: number; seed: number }) {
  const tall = seed % 2 === 0;
  return (
    <g transform={`translate(${x} ${y})`}>
      <path className="of-leaf" d={tall ? "M0 -14 C -8 -22 -6 -32 0 -36 C 6 -32 8 -22 0 -14 Z" : "M0 -12 C -10 -16 -12 -24 -6 -28 C -2 -22 0 -18 0 -12 Z"} />
      <path className="of-leaf-2" d={tall ? "M0 -12 C 8 -16 14 -24 10 -30 C 4 -26 0 -20 0 -12 Z" : "M0 -12 C 10 -16 12 -24 6 -28 C 2 -22 0 -18 0 -12 Z"} />
      <path className="of-pot" d="M-8 -12 L8 -12 L6 0 L-6 0 Z" />
    </g>
  );
}

export function DeskMug({ x, y, fresh }: { x: number; y: number; fresh: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {fresh ? (
        <>
          <path className="of-steam of-steam-a" d="M-3 -14 C -6 -18 0 -21 -3 -25" />
          <path className="of-steam of-steam-b" d="M3 -14 C 0 -18 6 -21 3 -25" />
        </>
      ) : null}
      <path className="of-mug-handle of-thin" d="M6 -9 C 10 -9 10 -3 6 -3" />
      <rect className="of-mug of-thin" x={-6} y={-12} width={12} height={12} rx={2} />
      <rect className="of-coffee" x={-4.5} y={-10.5} width={9} height={2.2} rx={1.1} />
    </g>
  );
}

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
 * The monitor: the file tab and the screen for the activity
 * ------------------------------------------------------------------- */

export type ScreenMode = "code" | "run" | "doc" | "review" | "web" | "design" | "scan" | "board" | "idle";

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
};

export function screenLabel(mode: ScreenMode): string {
  return SCREEN_LABEL[mode];
}

function rnd(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
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

function Lines({ x, y, w, rows, pitch, seed, from = 0 }: { x: number; y: number; w: number; rows: number; pitch: number; seed: number; from?: number }) {
  const lines = codeLines(seed, rows + from, w).slice(from);
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

export interface MonitorProps {
  r: Rect;
  mode: ScreenMode;
  label: string;
  animate: boolean;
  dim: boolean;
  clip: string;
  seed: number;
}

export function Monitor({ r, mode, label, animate, dim, clip, seed }: MonitorProps) {
  const bezel = 3;
  const bar = 15;
  const sx = r.x + bezel;
  const sy = r.y + bezel;
  const sw = r.w - 2 * bezel;
  const sh = r.h - 2 * bezel;
  const body = { x: sx, y: sy + bar, w: sw, h: sh - bar };
  const pitch = 7;
  const rows = Math.max(2, Math.floor((body.h - 6) / pitch));
  const tab = fit(label, sw - 10, { size: 11, mono: true });
  const cx = r.x + r.w / 2;
  let content: ReactNode;
  const inner = { x: body.x + 5, y: body.y + 5, w: body.w - 10 };
  switch (mode) {
    case "code":
      content = (
        <>
          <g className="of-scroll" style={{ ["--of-scroll" as string]: `${-pitch * 8}px` }}>
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
        <g className="of-scroll of-scroll-fast" style={{ ["--of-scroll" as string]: `${-pitch * 8}px` }}>
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
          {mode === "review" ? <rect className="of-highlight of-sweep" x={body.x + 2} y={inner.y - 2} width={body.w - 4} height={7} rx={1.5} style={{ ["--of-sweep" as string]: `${(rows - 2) * pitch}px` }} /> : null}
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
          <rect className="of-scanbar of-sweep" x={body.x + 2} y={inner.y - 2} width={body.w - 4} height={3} rx={1.5} style={{ ["--of-sweep" as string]: `${(rows - 1) * pitch}px` }} />
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
          <rect className="of-mini-card of-mini-move" x={inner.x} y={inner.y + 6 + 9 * Math.min(2, rows - 3)} width={cw} height={7} rx={1.5} style={{ ["--of-move" as string]: `${cw + 3}px` }} />
        </>
      );
      break;
    }
    default:
      content = Array.from({ length: Math.min(rows, 3) }, (_, i) => <rect key={i} className="of-code-d" x={inner.x} y={inner.y + i * pitch} width={inner.w * (0.7 - i * 0.15)} height={3} rx={1.5} />);
  }
  return (
    <g className="of-monitor" data-mode={mode} data-anim={animate ? "" : undefined} data-dim={dim ? "" : undefined}>
      <rect className="of-stand" x={cx - 3.5} y={r.y + r.h} width={7} height={9} />
      <rect className="of-stand-base" x={cx - 15} y={r.y + r.h + 8} width={30} height={4} rx={2} />
      <rect className="of-bezel" x={r.x} y={r.y} width={r.w} height={r.h} rx={4} />
      <rect className="of-screen" x={sx} y={sy} width={sw} height={sh} rx={2} />
      <rect className="of-tabbar" x={sx} y={sy} width={sw} height={bar} />
      {tab ? (
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
    </g>
  );
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

/* ---------------------------------------------------------------------
 * The desk card: name and role (or a status to notice), then the task
 * ------------------------------------------------------------------- */

export function DeskCard({ desk, plan, name, role, status, task, stamp }: { desk: Desk; plan: OfficePlan; name: string; role: string; status: AgentStatus; task: string | null; stamp: "pass" | "return" | null }) {
  const r = desk.card;
  const n1 = plan.m.text === "n1";
  const lh = n1 ? 16 : 14;
  const pad = 8;
  const nameStyle = textStyle(plan, 500);
  const bodyStyle = textStyle(plan);
  const mark = statusMark(status);
  const stampRoom = stamp ? 22 : 0;
  const avail = r.w - pad * 2 - stampRoom;
  const nameText = fit(name, avail * 0.55, nameStyle);
  const nameW = measureWidth(nameText, nameStyle);
  const icon = n1 ? 12 : 11;
  const sideRoom = avail - nameW - 6 - (mark ? icon + 3 : 0);
  const side = fit(mark ? mark.word : role, sideRoom, bodyStyle);
  const taskText = fit(task ?? "No task yet", avail, bodyStyle);
  const y1 = r.y + Math.round((r.h - lh * 2) / 2) + lh - 4;
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

/* ---------------------------------------------------------------------
 * CEO office: the plan whiteboard
 * ------------------------------------------------------------------- */

const COLUMNS: Array<{ key: PlanCard["status"]; word: string }> = [
  { key: "todo", word: "To do" },
  { key: "doing", word: "Doing" },
  { key: "review", word: "Review" },
  { key: "done", word: "Done" },
];

/** Two lines of a title at most, each fitted to the width. */
function twoLines(text: string, width: number, style: TextStyle): [string, string] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  let first = "";
  let i = 0;
  for (; i < words.length; i++) {
    const next = first ? `${first} ${words[i]}` : words[i]!;
    if (measureWidth(next, style) > width) break;
    first = next;
  }
  if (!first) return [fit(text, width, style), ""];
  return [first, fit(words.slice(i).join(" "), width, style)];
}

/**
 * A small board (the hero's easel, a phone's CEO office): each column as a
 * row with its count, in two columns when there is room, then the latest move.
 */
function BoardList({ r, cards }: { r: Rect; cards: PlanCard[] }) {
  const pad = 9;
  const micro: TextStyle = { size: 11 };
  const done = cards.filter((c) => c.status === "done").length;
  const rowH = 14;
  const two = r.w >= 240;
  const top = r.y + pad + 11;
  const listTop = top + (two ? 18 : 14);
  const perCol = two ? 2 : 4;
  const colW = two ? (r.w - pad * 3) / 2 : r.w - pad * 2;
  const rowsFit = Math.max(1, Math.floor((r.y + r.h - pad - listTop + 11) / rowH));
  const latest = [...cards].reverse().find((c) => c.status !== "todo") ?? null;
  const latestWord = latest ? COLUMNS.find((c) => c.key === latest.status)?.word ?? "" : "";
  return (
    <g className="of-whiteboard">
      <rect className="of-board" x={r.x} y={r.y} width={r.w} height={r.h} rx={6} />
      <text className="of-t of-t-n1 of-ink of-medium" x={r.x + pad} y={top}>
        Plan
      </text>
      <text className="of-t of-t-n2 of-muted of-num" x={r.x + r.w - pad} y={top} textAnchor="end">
        {fit(`${done} of ${cards.length} done`, r.w / 2 - pad, micro)}
      </text>
      {COLUMNS.map((col, i) => {
        const c = two ? Math.floor(i / perCol) : 0;
        const row = two ? i % perCol : i;
        if (row >= rowsFit) return null;
        const x = r.x + pad + c * (colW + pad);
        const y = listTop + row * rowH;
        return (
          <g key={col.key}>
            <text className="of-t of-t-n2 of-muted" x={x} y={y}>
              {col.word}
            </text>
            <text className="of-t of-t-n2 of-ink of-num" x={x + colW} y={y} textAnchor="end">
              {cards.filter((k) => k.status === col.key).length}
            </text>
          </g>
        );
      })}
      {latest && rowsFit > perCol ? (
        <text className="of-t of-t-n2 of-subtle" x={r.x + pad} y={listTop + perCol * rowH + 2}>
          {fit(`${latestWord}: ${latest.title}`, r.w - pad * 2, micro)}
        </text>
      ) : null}
    </g>
  );
}

export function Whiteboard({ r, cards, flash }: { r: Rect; cards: PlanCard[]; flash: number }) {
  if (r.w < 400) return <BoardList r={r} cards={cards} />;
  const pad = 10;
  const gap = 8;
  const colW = (r.w - pad * 2 - gap * 3) / 4;
  const titled = colW >= 88;
  const micro: TextStyle = { size: 11 };
  const microMed: TextStyle = { size: 11, weight: 500 };
  const headY = r.y + pad + 12;
  const colTop = headY + 20;
  const done = cards.filter((c) => c.status === "done").length;
  const summary = fit(`${done} of ${cards.length} done`, r.w / 2 - pad, micro);
  // titled cards: two lines while a column has room, one line when it fills
  // up; narrow boards: small notes and a caption line naming the latest move
  const perRow = titled ? 1 : Math.max(1, Math.floor((colW + 4) / 18));
  const captionH = titled ? 0 : 16;
  const room = r.y + r.h - pad - captionH - (colTop + 8);
  const layoutFor = (count: number) => {
    const tall = { h: 30, gap: 5 };
    const short = { h: 20, gap: 4 };
    const note = { h: 9, gap: 4 };
    const pick = !titled ? note : Math.floor((room + tall.gap) / (tall.h + tall.gap)) >= count ? tall : short;
    const rows = Math.max(1, Math.floor((room + pick.gap) / (pick.h + pick.gap)));
    return { ...pick, rows, cap: rows * perRow, lines: pick === tall ? 2 : 1 };
  };
  const latest = [...cards].reverse().find((c) => c.status !== "todo") ?? cards[0] ?? null;
  return (
    <g className="of-whiteboard">
      <rect className="of-board" x={r.x} y={r.y} width={r.w} height={r.h} rx={6} />
      <rect className="of-tray" x={r.x + r.w * 0.3} y={r.y + r.h - 1} width={r.w * 0.4} height={5} rx={2} />
      <text className="of-t of-t-n1 of-ink of-medium" x={r.x + pad} y={headY}>
        Plan
      </text>
      <text className="of-t of-t-n2 of-muted of-num" x={r.x + r.w - pad} y={headY} textAnchor="end">
        {summary}
      </text>
      {COLUMNS.map((col, ci) => {
        const x = r.x + pad + ci * (colW + gap);
        const list = cards.filter((c) => c.status === col.key);
        const L = layoutFor(list.length);
        const cardH = L.h;
        const cardGap = L.gap;
        const overflow = list.length > L.cap;
        const shown = overflow ? list.slice(0, Math.max(1, L.cap - 1)) : list;
        const head = fit(col.word, colW - 16, microMed);
        const isDone = col.key === "done";
        return (
          <g key={col.key}>
            <text className="of-t of-t-n2 of-muted of-medium" x={x} y={colTop}>
              {head}
            </text>
            <text className="of-t of-t-n2 of-subtle of-num" x={x + colW} y={colTop} textAnchor="end">
              {list.length}
            </text>
            {shown.map((c, i) => {
              const row = Math.floor(i / perRow);
              const cx = x + (i % perRow) * 18;
              const y = colTop + 8 + row * (cardH + cardGap);
              const pinned = isDone && flash > 0 && i === shown.length - 1;
              if (!titled) {
                return (
                  <g key={`${c.id}:${c.status}`} className={`of-plan-card${pinned ? " of-pinned" : ""}`}>
                    <rect className={isDone ? "of-note of-note-done" : "of-note"} x={cx} y={y} width={14} height={cardH} rx={2} />
                  </g>
                );
              }
              const [l1, l2] = L.lines === 2 ? twoLines(c.title, colW - 12 - (isDone ? 14 : 0), micro) : [fit(c.title, colW - 12 - (isDone ? 14 : 0), micro), ""];
              return (
                <g key={`${c.id}:${c.status}`} className={`of-plan-card${pinned ? " of-pinned" : ""}`}>
                  <rect className={isDone ? "of-note of-note-done" : "of-note"} x={x} y={y} width={colW} height={cardH} rx={3} />
                  {isDone ? <Glyph name="check" x={x + 4} y={y + (L.lines === 2 ? 4 : 4.5)} size={11} className="of-glyph of-tone-success" /> : null}
                  <text className="of-t of-t-n2 of-ink" x={x + 6 + (isDone ? 14 : 0)} y={y + (L.lines === 2 ? 12 : 14)}>
                    {l1}
                  </text>
                  {l2 ? (
                    <text className="of-t of-t-n2 of-ink" x={x + 6 + (isDone ? 14 : 0)} y={y + 25}>
                      {l2}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {overflow ? (
              <text className="of-t of-t-n2 of-subtle of-num" x={titled ? x + 2 : x + (shown.length % perRow) * 18} y={colTop + 8 + Math.floor(shown.length / perRow) * (cardH + cardGap) + (titled ? 12 : 8)}>
                +{list.length - shown.length}
              </text>
            ) : null}
            {ci === 0 && cards.length === 0 ? (
              <text className="of-t of-t-n2 of-subtle" x={x} y={colTop + 20}>
                {fit("No plan yet", colW * 2, micro)}
              </text>
            ) : null}
          </g>
        );
      })}
      {!titled && latest ? (
        <text className="of-t of-t-n2 of-muted" x={r.x + pad} y={r.y + r.h - pad - 2}>
          {fit(`${COLUMNS.find((c) => c.key === latest.status)?.word ?? ""}: ${latest.title}`, r.w - pad * 2, micro)}
        </text>
      ) : null}
    </g>
  );
}

/* ---------------------------------------------------------------------
 * Meeting room: agenda board, table, chairs
 * ------------------------------------------------------------------- */

export function AgendaBoard({ r, meeting, running, title, agenda, notes }: { r: Rect; meeting: OfficeMeeting | null; running: boolean; title: string; agenda: string[]; notes: string[] }) {
  const pad = 10;
  const titleStyle: TextStyle = { size: 13, weight: 500 };
  const micro: TextStyle = { size: 11 };
  const status = running ? "In session" : meeting ? "Wrapped up" : "Free";
  const statusW = measureWidth(status, micro) + 4;
  // a small board puts the status under the heading instead of beside it
  const stacked = r.w < 240;
  const heading = fit(running || meeting ? title : "Meeting room", r.w - pad * 2 - (stacked ? 0 : statusW + 8), titleStyle);
  const first = r.y + pad + 12 + (stacked ? 16 : 0);
  const lines = (running ? agenda : notes).slice(0, Math.max(0, Math.floor((r.y + r.h - pad - (first + 20) + 15) / 15)));
  return (
    <g className="of-agenda">
      <rect className="of-board" x={r.x} y={r.y} width={r.w} height={r.h} rx={6} />
      <text className="of-t of-t-n1 of-ink of-medium" x={r.x + pad} y={r.y + pad + 12}>
        {heading}
      </text>
      <text className={`of-t of-t-n2 ${running ? "of-tone-success" : "of-muted"}`} x={stacked ? r.x + pad : r.x + r.w - pad} y={stacked ? r.y + pad + 28 : r.y + pad + 12} textAnchor={stacked ? "start" : "end"}>
        {status}
      </text>
      {lines.map((line, i) => (
        <text key={i} className="of-t of-t-n2 of-muted" x={r.x + pad} y={first + 20 + i * 15}>
          {fit(line, r.w - pad * 2, micro)}
        </text>
      ))}
    </g>
  );
}

export function MeetingTable({ r }: { r: Rect }) {
  return (
    <g>
      <rect className="of-desk-front" x={r.x + 10} y={r.y + 8} width={r.w - 20} height={r.h - 8} rx={4} />
      <rect className="of-desk-top" x={r.x} y={r.y} width={r.w} height={12} rx={6} />
    </g>
  );
}

export function Stool({ x, y, w }: { x: number; y: number; w: number }) {
  return <rect className="of-stool" x={x - w / 2} y={y - 6} width={w} height={8} rx={4} />;
}

/* ---------------------------------------------------------------------
 * Pantry: counter and coffee machine, then a fridge and a sofa
 * ------------------------------------------------------------------- */

export function PantryArt({ plan, brewing }: { plan: OfficePlan; brewing: number }) {
  if (!plan.pantry) return null;
  const { slots, top } = plan.pantry;
  const first = slots[0]!;
  const band = 8;
  const bottom = first.y + first.h;
  const n1 = plan.m.text === "n1";
  const counter = { x: first.x + 2, w: first.w - 4 };
  const mx = counter.x + 18;
  const cardR = { x: counter.x + 6, y: top + band + 5, w: counter.w - 12, h: plan.m.front - 10 };
  const label = fit("Pantry", cardR.w - 16, { size: n1 ? 13 : 11, weight: 500 });
  const sub = fit("Coffee and water", cardR.w - 16, { size: n1 ? 13 : 11 });
  return (
    <g className="of-pantry">
      {[0, 1].map((i) => (
        <DeskMug key={i} x={mx + 58 + i * 18} y={top} fresh={false} />
      ))}
      {/* coffee machine */}
      <rect className="of-machine" x={mx} y={top - 52} width={40} height={52} rx={5} />
      <rect className="of-machine-panel" x={mx + 6} y={top - 46} width={28} height={10} rx={2} />
      <rect className="of-machine-spout" x={mx + 16} y={top - 32} width={8} height={6} rx={1.5} />
      <g key={brewing} className="of-brew" data-on={brewing ? "" : undefined}>
        <rect className="of-mug of-thin" x={mx + 13} y={top - 13} width={14} height={13} rx={2} />
        <path className="of-steam of-steam-a" d={`M${mx + 17} ${top - 16} C ${mx + 14} ${top - 20} ${mx + 20} ${top - 23} ${mx + 17} ${top - 27}`} />
      </g>
      <Plant x={counter.x + counter.w - 20} y={top} seed={3} />
      <rect className="of-desk-front" x={counter.x + 4} y={top + band - 1} width={counter.w - 8} height={bottom - top - band + 1} rx={3} />
      <rect className="of-desk-top" x={counter.x} y={top} width={counter.w} height={band} rx={2} />
      <rect className="of-card-paper" x={cardR.x} y={cardR.y} width={cardR.w} height={cardR.h} rx={4} />
      <text className={`of-t of-t-${plan.m.text} of-ink of-medium`} x={cardR.x + 8} y={cardR.y + (n1 ? 17 : 15)}>
        {label}
      </text>
      <text className={`of-t of-t-${plan.m.text} of-muted`} x={cardR.x + 8} y={cardR.y + (n1 ? 33 : 29)}>
        {sub}
      </text>
      {slots.slice(1).map((slot: Rect, i: number) => (i % 2 === 0 ? <Fridge key={i} r={slot} top={top} /> : <Sofa key={i} r={slot} top={top} />))}
    </g>
  );
}

function Fridge({ r, top }: { r: Rect; top: number }) {
  const bottom = r.y + r.h;
  const w = Math.min(64, r.w * 0.34);
  const x = r.x + 16;
  return (
    <g>
      <rect className="of-fridge" x={x} y={top - 72} width={w} height={bottom - top + 72} rx={6} />
      <rect className="of-fridge-seam" x={x} y={top - 20} width={w} height={2} />
      <rect className="of-handle" x={x + w - 9} y={top - 60} width={3} height={22} rx={1.5} />
      <rect className="of-handle" x={x + w - 9} y={top - 10} width={3} height={22} rx={1.5} />
      <Plant x={x + w + 30} y={bottom - 2} seed={2} />
      <rect className="of-jug" x={x + w + 60} y={bottom - 40} width={22} height={38} rx={5} />
      <rect className="of-jug-water" x={x + w + 63} y={bottom - 26} width={16} height={21} rx={3} />
    </g>
  );
}

function Sofa({ r, top }: { r: Rect; top: number }) {
  const bottom = r.y + r.h;
  const w = Math.min(r.w - 32, 150);
  const x = r.x + (r.w - w) / 2;
  return (
    <g>
      <rect className="of-sofa-back" x={x} y={top - 20} width={w} height={40} rx={10} />
      <rect className="of-sofa-seat" x={x + 6} y={top + 12} width={w - 12} height={bottom - top - 28} rx={8} />
      <rect className="of-sofa-arm" x={x - 4} y={top + 4} width={16} height={bottom - top - 16} rx={7} />
      <rect className="of-sofa-arm" x={x + w - 12} y={top + 4} width={16} height={bottom - top - 16} rx={7} />
    </g>
  );
}
