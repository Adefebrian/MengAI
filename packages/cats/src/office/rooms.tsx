// The building: the slab, the floors, the back walls with their doors and
// windows, the cutaway low walls, and the furniture that is not a desk (the
// CEO's lounge, the meeting table, the pantry, the rack, the bookshelf, the
// cat bed). Three-quarter cutaway: a back wall is seen face on above its
// floor line, a floor from above, a block by its top and front faces. Flat
// fills, tonal steps and hairlines only.
import type { CSSProperties } from "react";
import type { Cell, OfficePlan, Rect, Room } from "./geometry";
import type { Daypart, RackMode } from "./director";
import { Block, DeskMug, FloorPlant, Glyph, Plant } from "./art";
import type { GlyphId } from "./glyphs";
import { fit, measure } from "./text";
import { useSceneUid } from "./uid";

/* ---------------------------------------------------------------------
 * Floors: the slab, the open floor, the room floors, rugs, window light
 * ------------------------------------------------------------------- */

function wallBase(plan: OfficePlan, x: number, y: number): number {
  const room = plan.rooms.find((r) => x >= r.rect.x && x <= r.rect.x + r.rect.w && y >= r.rect.y && y <= r.floorTop);
  return room ? room.floorTop : plan.ceo.floorTop;
}

export function Floors({ plan, day }: { plan: OfficePlan; day: Daypart }) {
  const { m } = plan;
  const bottom = plan.height - m.slab;
  const open = { x: m.pad, y: 0, w: plan.width - 2 * m.pad, h: bottom };
  return (
    <g className="of-floors">
      <rect className="of-floor" x={open.x} y={open.y} width={open.w} height={open.h} />
      {plan.corridor ? <rect className="of-corridor" x={plan.corridor.x} y={plan.corridor.y} width={plan.corridor.w} height={plan.corridor.h} /> : null}
      {plan.corridor && plan.corridor.w > 300 ? (
        <g>
          <rect className="of-runner" x={plan.corridor.x + 24} y={plan.corridor.y + 12} width={plan.corridor.w - 48} height={plan.corridor.h - 20} rx={8} />
          <rect className="of-rug-line" x={plan.corridor.x + 30} y={plan.corridor.y + 18} width={plan.corridor.w - 60} height={plan.corridor.h - 32} rx={5} />
        </g>
      ) : null}
      {plan.rooms.map((r, i) => (
        <rect key={i} className={`of-room-floor of-room-floor-${r.kind}`} x={r.rect.x} y={r.floorTop} width={r.rect.w} height={r.rect.y + r.rect.h - r.floorTop} />
      ))}
      {plan.zones.map((z, i) => (
        <rect key={`z${i}`} className="of-zone" x={z.x} y={z.y} width={z.w} height={z.h} rx={12} />
      ))}
      {plan.ceo.kind === "corner" ? <rect className="of-rug" x={plan.ceo.rect.x - 4} y={plan.ceo.rect.y + plan.m.bubble} width={plan.ceo.rect.w + 8} height={plan.ceo.rect.h - plan.m.bubble + Math.round(40 * m.walker)} rx={12} /> : null}
      {plan.ceo.lounge ? <rect className="of-rug" x={plan.ceo.lounge.x - 12} y={plan.ceo.lounge.y + 10} width={plan.ceo.lounge.w + 24} height={plan.ceo.lounge.h + 6} rx={10} /> : null}
      {plan.ceo.kind === "room" && plan.ceo.desk ? <CeoCarpet plan={plan} /> : null}
      {day === "night"
        ? null
        : plan.windows.map((w, i) => {
            const base = wallBase(plan, w.x + 1, w.y + 1);
            const d = 46;
            return <path key={`l${i}`} className={`of-light of-light-${day}`} d={`M${w.x + 4} ${base} L${w.x + w.w - 4} ${base} L${w.x + w.w + 14} ${base + d} L${w.x + 22} ${base + d} Z`} />;
          })}
      <rect className="of-side-wall" x={0} y={0} width={m.pad} height={bottom} />
      <rect className="of-side-wall" x={plan.width - m.pad} y={0} width={m.pad} height={bottom} />
      <rect className="of-slab-face" x={0} y={bottom} width={plan.width} height={m.slab} />
    </g>
  );
}

/** The CEO's carpet: under the desk and the visitors' spots, up to the low wall. */
function CeoCarpet({ plan }: { plan: OfficePlan }) {
  const d = plan.ceo.desk!;
  const room = plan.rooms.find((r) => r.kind === "ceo");
  if (!room || room.front === null) return null;
  const x = d.rect.x - 10;
  const y = d.top - 6;
  const w = room.rect.x + room.rect.w - 8 - x;
  const h = room.front - plan.m.low - plan.m.cap - 8 - y;
  return h > 20 ? <rect className="of-carpet" x={x} y={y} width={w} height={h} rx={10} /> : null;
}

/* ---------------------------------------------------------------------
 * Back walls: cap, face, skirting; doors, windows, the ticker
 * ------------------------------------------------------------------- */

function WallFace({ x, y, w, floorTop, cap }: { x: number; y: number; w: number; floorTop: number; cap: number }) {
  return (
    <g>
      <rect className="of-wall" x={x} y={y + cap} width={w} height={floorTop - y - cap} />
      <rect className="of-cap" x={x} y={y} width={w} height={cap} />
      <rect className="of-skirting" x={x} y={floorTop - 5} width={w} height={5} />
    </g>
  );
}

export function BackWalls({ plan, day, doorOpen, hour }: { plan: OfficePlan; day: Daypart; doorOpen: boolean; hour: number }) {
  const { m } = plan;
  const band = plan.rooms.filter((r) => r.doorway === null);
  const bottomRooms = plan.rooms.filter((r) => r.doorway !== null);
  return (
    <g className="of-walls">
      {plan.variant === "hero" ? <WallFace x={m.pad} y={0} w={plan.width - 2 * m.pad} floorTop={plan.ceo.floorTop} cap={m.cap} /> : null}
      {band.map((r, i) => (
        <WallFace key={i} x={r.rect.x} y={r.rect.y} w={r.rect.w} floorTop={r.floorTop} cap={m.cap} />
      ))}
      {bottomRooms.map((r, i) => (
        <g key={`b${i}`}>
          <WallFace x={r.rect.x} y={r.rect.y} w={r.rect.w} floorTop={r.floorTop} cap={m.cap} />
          <Doorway r={r.doorway!} />
        </g>
      ))}
      {plan.windows.map((w, i) =>
        plan.theme === "fund" && plan.meeting?.window === w ? <RiskScreen key={i} r={w} /> : <Window key={i} r={w} day={day} seed={i} />,
      )}
      {plan.door ? <Door r={plan.door.rect} open={doorOpen} day={day} /> : null}
      {plan.ticker ? <Ticker r={plan.ticker} /> : null}
      {plan.meeting && plan.meeting.rect.y === 0 ? <WallClock plan={plan} hour={hour} /> : null}
    </g>
  );
}

/** A window: the sky for the local hour in a flat tone, the sun, the moon or a few clouds, a sill. */
export function Window({ r, day, seed }: { r: Rect; day: Daypart; seed: number }) {
  const inner = { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 8 };
  const clip = `${useSceneUid()}-win-${Math.round(r.x)}-${Math.round(r.y)}`;
  const sun = Math.min(inner.w, inner.h) * 0.16;
  let sky;
  switch (day) {
    case "day":
      sky = (
        <>
          <circle className="of-sun" cx={inner.x + inner.w * 0.78} cy={inner.y + inner.h * 0.3} r={sun} />
          <g className="of-cloud-drift" style={{ ["--of-i" as string]: String(seed % 3) } as CSSProperties}>
            <ellipse className="of-cloud" cx={inner.x + inner.w * 0.3} cy={inner.y + inner.h * 0.5} rx={inner.w * 0.14} ry={4} />
            <ellipse className="of-cloud" cx={inner.x + inner.w * 0.38} cy={inner.y + inner.h * 0.43} rx={inner.w * 0.09} ry={4.5} />
          </g>
        </>
      );
      break;
    case "dawn":
      sky = (
        <>
          <circle className="of-sun of-sun-low" cx={inner.x + inner.w * 0.25} cy={inner.y + inner.h * 0.92} r={sun * 1.3} />
          <rect className="of-sky-band" x={inner.x} y={inner.y + inner.h * 0.62} width={inner.w} height={inner.h * 0.38} />
        </>
      );
      break;
    case "dusk":
      sky = (
        <>
          <rect className="of-sky-band" x={inner.x} y={inner.y + inner.h * 0.55} width={inner.w} height={inner.h * 0.45} />
          <circle className="of-sun of-sun-low" cx={inner.x + inner.w * 0.72} cy={inner.y + inner.h * 0.9} r={sun * 1.3} />
        </>
      );
      break;
    default:
      sky = (
        <>
          <circle className="of-moon" cx={inner.x + inner.w * 0.72} cy={inner.y + inner.h * 0.32} r={sun} />
          <circle className="of-sky" cx={inner.x + inner.w * 0.72 + sun * 0.45} cy={inner.y + inner.h * 0.32 - sun * 0.3} r={sun * 0.85} />
          {[0.18, 0.4, 0.3, 0.55].map((f, i) => (
            <circle key={i} className="of-star" cx={inner.x + inner.w * f} cy={inner.y + inner.h * (0.2 + ((i * 37) % 50) / 100)} r={1.1} />
          ))}
        </>
      );
  }
  return (
    <g className="of-window" data-day={day}>
      <rect className="of-window-frame" x={r.x} y={r.y} width={r.w} height={r.h} rx={4} />
      <clipPath id={clip}>
        <rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} rx={2} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect className={`of-sky of-sky-${day}`} x={inner.x} y={inner.y} width={inner.w} height={inner.h} />
        {sky}
      </g>
      <rect className="of-window-frame" x={r.x + r.w / 2 - 1.5} y={r.y} width={3} height={r.h} />
      <rect className="of-sill" x={r.x - 4} y={r.y + r.h - 2} width={r.w + 8} height={5} rx={2} />
    </g>
  );
}

/** The entrance: a door in its frame and a mat; it swings open while a cat comes in or leaves. */
export function Door({ r, open, day }: { r: Rect; open: boolean; day: Daypart }) {
  const inset = 4;
  const panel = { x: r.x + inset, y: r.y + inset, w: r.w - inset * 2, h: r.h - inset };
  return (
    <g className="of-door" data-open={open ? "" : undefined}>
      <rect className="of-door-frame" x={r.x} y={r.y} width={r.w} height={r.h} rx={3} />
      <rect className="of-doorway" x={panel.x} y={panel.y} width={panel.w} height={panel.h} />
      <rect className={`of-sky-${day}`} x={panel.x + 3} y={panel.y + 3} width={panel.w - 6} height={panel.h * 0.5} rx={1} />
      <g className="of-door-panel" style={{ transformOrigin: `${panel.x}px ${panel.y}px` } as CSSProperties}>
        <rect className="of-door-leaf" x={panel.x} y={panel.y} width={panel.w} height={panel.h} rx={1.5} />
        <rect className={`of-door-glass of-sky-${day}`} x={panel.x + panel.w * 0.2} y={panel.y + 8} width={panel.w * 0.6} height={Math.min(22, panel.h * 0.24)} rx={2} />
        <circle className="of-knob" cx={panel.x + panel.w - 7} cy={panel.y + panel.h * 0.56} r={2.6} />
      </g>
      <rect className="of-mat" x={r.x + 2} y={r.y + r.h + 3} width={r.w - 4} height={8} rx={3} />
    </g>
  );
}

/** An open doorway in a back wall: the frame, the hall beyond, the door leaf swung back against the wall. */
function Doorway({ r }: { r: Rect }) {
  const leaf = Math.min(12, r.w * 0.22);
  return (
    <g>
      <rect className="of-door-frame" x={r.x} y={r.y} width={r.w} height={r.h} rx={3} />
      <rect className="of-doorway" x={r.x + 4} y={r.y + 4} width={r.w - 8} height={r.h - 4} rx={2} />
      <rect className="of-hall" x={r.x + 4} y={r.y + r.h * 0.62} width={r.w - 8} height={r.h * 0.38} />
      <path className="of-door-leaf" d={`M${r.x + 4} ${r.y + 4} L${r.x + 4 + leaf} ${r.y + 10} L${r.x + 4 + leaf} ${r.y + r.h - 4} L${r.x + 4} ${r.y + r.h} Z`} />
    </g>
  );
}

/** The risk committee's wall screen: exposure against the limit and the day's drawdown. */
function RiskScreen({ r }: { r: Rect }) {
  const inner = { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 8 };
  const bars = [0.52, 0.78, 0.36];
  const line = [0.3, 0.42, 0.38, 0.6, 0.55, 0.7, 0.64];
  const step = inner.w / (line.length - 1);
  const top = inner.y + 4;
  const chartH = inner.h * 0.45;
  return (
    <g className="of-risk-screen">
      <rect className="of-bezel" x={r.x} y={r.y} width={r.w} height={r.h} rx={4} />
      <rect className="of-screen" x={inner.x} y={inner.y} width={inner.w} height={inner.h} rx={2} />
      <path className="of-price of-down-line" d={line.map((v, i) => `${i ? "L" : "M"}${inner.x + i * step} ${top + v * chartH}`).join(" ")} />
      {bars.map((f, i) => {
        const y = inner.y + inner.h * 0.58 + i * 7;
        return (
          <g key={i}>
            <rect className="of-mini-card" x={inner.x + 4} y={y} width={inner.w - 8} height={4} rx={2} />
            <rect className={`${f > 0.7 ? "of-bear" : "of-code-a"}${i === 1 ? " of-creep" : ""}`} x={inner.x + 4} y={y} width={(inner.w - 8) * f} height={4} rx={2} />
          </g>
        );
      })}
      <rect className="of-limit" x={inner.x + 4 + (inner.w - 8) * 0.86} y={inner.y + inner.h * 0.55} width={1.5} height={24} />
    </g>
  );
}

/** A wall clock between the meeting room's boards, hands on the local hour. */
function WallClock({ plan, hour }: { plan: OfficePlan; hour: number }) {
  const room = plan.meeting!;
  const right = room.window ? room.window.x : room.rect.x + room.rect.w - 12;
  const gapL = room.agenda.x + room.agenda.w;
  const space = right - gapL;
  if (space < 34) return null;
  const cx = gapL + space / 2;
  const cy = room.agenda.y + 16;
  const hAng = ((hour % 12) / 12) * 360;
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <circle className="of-clock" r={11} />
      <path className="of-clock-hand" d="M0 0 L0 -6" transform={`rotate(${hAng})`} />
      <path className="of-clock-hand of-clock-min" d="M0 0 L0 -8.5" />
    </g>
  );
}

/** Symbols on the fund's ticker: a name, a price and the day's move. */
const TICKS: Array<[string, string, number]> = [
  ["PAWS", "128.40", 1.2],
  ["MEOW", "42.15", -0.8],
  ["TUNA", "311.02", 2.4],
  ["YARN", "18.77", 0.3],
  ["KOPI", "64.90", -1.6],
  ["NAPS", "205.33", 0.9],
  ["PURR", "77.08", -0.4],
  ["BOX", "12.60", 3.1],
];

export function Ticker({ r }: { r: Rect }) {
  const style = { size: 11, weight: 500 as const };
  const num = { size: 11 };
  const gap = 22;
  const items: Array<{ x: number; sym: string; px: string; ch: string; up: boolean; w: number }> = [];
  let x = 0;
  for (const [sym, px, ch] of TICKS) {
    const chText = `${ch > 0 ? "+" : ""}${ch.toFixed(1)}%`;
    const w1 = measure(sym, style);
    const w2 = measure(px, num);
    const w3 = measure(chText, num);
    const w = w1 + 6 + w2 + 6 + 8 + w3;
    items.push({ x, sym, px, ch: chText, up: ch >= 0, w });
    x += w + gap;
  }
  const total = Math.ceil(x);
  const clip = `${useSceneUid()}-ticker-${Math.round(r.y)}`;
  const ty = r.y + r.h / 2 + 4;
  const run = (off: number) =>
    items.map((it, i) => {
      const x0 = r.x + 10 + off + it.x;
      const w1 = measure(it.sym, style);
      const w2 = measure(it.px, num);
      const ax = x0 + w1 + 6 + w2 + 6;
      return (
        <g key={`${off}-${i}`}>
          <text className="of-t of-t-n2 of-ticker-sym of-medium" x={x0} y={ty}>
            {it.sym}
          </text>
          <text className="of-t of-t-n2 of-ticker-px of-num" x={x0 + w1 + 6} y={ty}>
            {it.px}
          </text>
          <path className={it.up ? "of-ticker-up" : "of-ticker-down"} d={it.up ? `M${ax} ${ty - 1} l3.5 -6 l3.5 6 Z` : `M${ax} ${ty - 7} l3.5 6 l3.5 -6 Z`} />
          <text className={`of-t of-t-n2 of-num ${it.up ? "of-ticker-up" : "of-ticker-down"}`} x={ax + 9} y={ty}>
            {it.ch}
          </text>
        </g>
      );
    });
  const copies = Math.max(2, Math.ceil(r.w / total) + 1);
  return (
    <g className="of-ticker">
      <rect className="of-ticker-board" x={r.x} y={r.y} width={r.w} height={r.h} rx={3} />
      <clipPath id={clip}>
        <rect x={r.x + 2} y={r.y} width={r.w - 4} height={r.h} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <g className="of-ticker-run" style={{ ["--of-ticker" as string]: `${-total}px`, ["--of-ticker-n" as string]: String(Math.max(12, Math.round(total / 32))) } as CSSProperties}>
          {Array.from({ length: copies }, (_, k) => run(k * total))}
        </g>
      </g>
    </g>
  );
}

/* ---------------------------------------------------------------------
 * Front walls: the cutaway low walls and the partitions between rooms
 * ------------------------------------------------------------------- */

export function FrontWalls({ plan }: { plan: OfficePlan }) {
  const { m } = plan;
  const band = plan.rooms.filter((r) => r.front !== null).sort((a, b) => a.rect.x - b.rect.x);
  return (
    <g className="of-front-walls">
      {band.slice(1).map((r, i) => {
        // the fund's ticker runs in front of the partitions, one board across the floor
        const y0 = plan.ticker ? plan.ticker.y + plan.ticker.h + 2 : r.rect.y;
        return <rect key={`p${i}`} className="of-cap" x={r.rect.x - m.cap / 2} y={y0} width={m.cap} height={r.front! - m.low - y0} />;
      })}
      {band.map((r, i) => (
        <LowWall key={i} room={r} plan={plan} />
      ))}
    </g>
  );
}

function LowWall({ room, plan }: { room: Room; plan: OfficePlan }) {
  const { m } = plan;
  const r = room.rect;
  const front = room.front!;
  const g = room.gap;
  const segs: Array<[number, number]> = g ? [[r.x, g.x - g.w / 2], [g.x + g.w / 2, r.x + r.w]] : [[r.x, r.x + r.w]];
  return (
    <g>
      {segs.map(([a, b], i) =>
        b - a > 0.5 ? (
          <g key={i}>
            <rect className="of-low-face" x={a} y={front - m.low} width={b - a} height={m.low} />
            <rect className="of-cap" x={a} y={front - m.low - m.cap} width={b - a} height={m.cap} />
          </g>
        ) : null,
      )}
    </g>
  );
}

/* ---------------------------------------------------------------------
 * The CEO office: the lounge
 * ------------------------------------------------------------------- */

export function CeoFurniture({ plan }: { plan: OfficePlan }) {
  const l = plan.ceo.lounge;
  const cred = plan.ceo.credenza;
  if (!l) return cred ? <Credenza r={cred} /> : null;
  if (plan.ceo.kind === "corner") {
    // the hero's corner: an armchair and a plant in the free cell under the board
    const chair = { x: l.x, y: l.y, w: 56, h: l.h };
    return (
      <g>
        <Lounge r={chair} />
        <Block x={l.x + 64} w={28} top={l.y + l.h - 24} face={l.y + l.h - 18} bottom={l.y + l.h} />
        <DeskMug x={l.x + 78} y={l.y + l.h - 20} fresh={false} tone={1} />
        {l.w >= 130 ? <FloorPlant x={l.x + l.w - 16} y={l.y + l.h} /> : null}
      </g>
    );
  }
  return (
    <g>
      <Lounge r={l} />
      {cred ? <Credenza r={cred} /> : null}
    </g>
  );
}

/** A low credenza on the CEO's floor: books, a trophy, a framed photo, and a tall plant at its end. */
function Credenza({ r }: { r: Rect }) {
  const bottom = r.y + r.h;
  const w = Math.min(220, r.w - 60);
  const top = bottom - 44;
  const x = r.x;
  const books = [9, 7, 11, 8, 10, 7];
  let bx = x + 10;
  return (
    <g>
      <Block x={x} w={w} top={top} face={top + 10} bottom={bottom} tone="cabinet" />
      <rect className="of-drawer" x={x + 8} y={top + 16} width={w / 2 - 12} height={bottom - top - 22} rx={3} />
      <rect className="of-drawer" x={x + w / 2 + 4} y={top + 16} width={w / 2 - 12} height={bottom - top - 22} rx={3} />
      {books.map((bw, i) => {
        const h = 14 + ((i * 5) % 7);
        const el = <rect key={i} className={`of-book of-book-${i % 3}`} x={bx} y={top + 4 - h} width={bw} height={h} rx={1.5} />;
        bx += bw + 2;
        return el;
      })}
      <g transform={`translate(${x + w * 0.62} ${top + 4})`}>
        <rect className="of-brass-dark" x={-8} y={-3} width={16} height={3} rx={1} />
        <rect className="of-brass" x={-2} y={-9} width={4} height={6} />
        <path className="of-brass" d="M-7 -20 L7 -20 C 7 -12 3 -9 0 -9 C -3 -9 -7 -12 -7 -20 Z" />
      </g>
      <g transform={`translate(${x + w - 26} ${top + 4})`}>
        <rect className="of-window-frame" x={-10} y={-20} width={20} height={20} rx={2} />
        <rect className="of-sky-day" x={-7} y={-17} width={14} height={14} rx={1} />
        <circle className="of-leaf" cx={0} cy={-8} r={3} />
      </g>
      {/* the plant keeps below the visitors' row: only on a tall enough floor */}
      {r.h >= 76 ? <FloorPlant x={x + w + 30} y={bottom} /> : null}
    </g>
  );
}

/** The visitor sofa with a side table and a mug; a single armchair when the floor is narrow. */
function Lounge({ r }: { r: Rect }) {
  const bottom = r.y + r.h;
  const seatTop = bottom - 30;
  if (r.w < 84) {
    const w = Math.min(56, r.w);
    const x = r.x + (r.w - w) / 2;
    return (
      <g>
        <rect className="of-sofa-back" x={x + 4} y={seatTop - 22} width={w - 8} height={30} rx={9} />
        <rect className="of-sofa-seat" x={x + 5} y={seatTop} width={w - 10} height={14} rx={5} />
        <rect className="of-sofa-front" x={x + 5} y={seatTop + 12} width={w - 10} height={bottom - seatTop - 12} rx={4} />
        <rect className="of-sofa-arm" x={x - 2} y={seatTop - 8} width={13} height={bottom - seatTop + 8} rx={6} />
        <rect className="of-sofa-arm" x={x + w - 11} y={seatTop - 8} width={13} height={bottom - seatTop + 8} rx={6} />
        <rect className="of-cushion" x={x + w / 2 - 9} y={seatTop - 14} width={18} height={14} rx={5} />
      </g>
    );
  }
  const tableW = 30;
  const w = Math.min(130, r.w - tableW - 10);
  const x = r.x;
  return (
    <g>
      <rect className="of-sofa-back" x={x} y={seatTop - 24} width={w} height={32} rx={10} />
      <rect className="of-sofa-seat" x={x + 5} y={seatTop} width={w - 10} height={14} rx={5} />
      <rect className="of-sofa-front" x={x + 5} y={seatTop + 12} width={w - 10} height={bottom - seatTop - 12} rx={4} />
      <rect className="of-sofa-arm" x={x - 3} y={seatTop - 10} width={15} height={bottom - seatTop + 10} rx={6} />
      <rect className="of-sofa-arm" x={x + w - 12} y={seatTop - 10} width={15} height={bottom - seatTop + 10} rx={6} />
      <rect className="of-cushion" x={x + 16} y={seatTop - 16} width={22} height={16} rx={5} />
      <Block x={x + w + 8} w={tableW} top={bottom - 26} face={bottom - 20} bottom={bottom} />
      <DeskMug x={x + w + 8 + tableW / 2} y={bottom - 22} fresh={false} tone={2} />
    </g>
  );
}

/* ---------------------------------------------------------------------
 * The meeting room: table and chairs
 * ------------------------------------------------------------------- */

export function MeetingTable({ r }: { r: Rect }) {
  const topD = Math.round(r.h * 0.5);
  return (
    <g>
      <rect className="of-table-leg" x={r.x + 10} y={r.y + topD} width={8} height={r.h - topD} />
      <rect className="of-table-leg" x={r.x + r.w - 18} y={r.y + topD} width={8} height={r.h - topD} />
      <rect className="of-desk-front" x={r.x + 4} y={r.y + topD - 1} width={r.w - 8} height={12} rx={2} />
      <rect className="of-desk-top" x={r.x} y={r.y} width={r.w} height={topD} rx={8} />
      <rect className="of-sheet" x={r.x + r.w * 0.44} y={r.y + 8} width={22} height={14} rx={1.5} />
      <rect className="of-sheet" x={r.x + r.w * 0.2} y={r.y + 10} width={18} height={12} rx={1.5} />
    </g>
  );
}

/** A meeting stool: a round seat seen from above and a short stem to its foot. */
export function Stool({ x, y, w }: { x: number; y: number; w: number }) {
  return (
    <g>
      <rect className="of-table-leg" x={x - 2.5} y={y - 8} width={5} height={10} />
      <rect className="of-desk-front" x={x - w * 0.28} y={y - 1} width={w * 0.56} height={4} rx={2} />
      <ellipse className="of-chair" cx={x} cy={y - 10} rx={w / 2} ry={6.5} />
      <ellipse className="of-chair-seam" cx={x} cy={y - 11} rx={w / 2 - 6} ry={2.5} />
    </g>
  );
}

/* ---------------------------------------------------------------------
 * The pantry: a room of its own, or a counter in the desk grid
 * ------------------------------------------------------------------- */

function CoffeeMachine({ x, y, brewing }: { x: number; y: number; brewing: number }) {
  // x, y: bottom-left on the counter top
  return (
    <g>
      <rect className="of-machine" x={x} y={y - 50} width={40} height={50} rx={5} />
      <rect className="of-machine-top" x={x + 3} y={y - 50} width={34} height={6} rx={2} />
      <rect className="of-machine-panel" x={x + 6} y={y - 40} width={28} height={9} rx={2} />
      <circle className={`of-machine-led${brewing ? " of-led-on" : ""}`} cx={x + 30} cy={y - 35.5} r={2} />
      <rect className="of-machine-spout" x={x + 16} y={y - 28} width={8} height={5} rx={1.5} />
      <rect className="of-machine-tray" x={x + 6} y={y - 5} width={28} height={5} rx={1.5} />
      <g key={brewing} className="of-brew" data-on={brewing ? "" : undefined}>
        <rect className="of-pour" x={x + 19} y={y - 23} width={2} height={10} />
        <rect className="of-mug of-thin" x={x + 13} y={y - 18} width={14} height={13} rx={2} />
        <path className="of-steam of-steam-a" d={`M${x + 17} ${y - 21} C ${x + 14} ${y - 25} ${x + 20} ${y - 28} ${x + 17} ${y - 32}`} />
      </g>
    </g>
  );
}

/** A bowl of fruit on the pantry counter. */
function FruitBowl({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle className="of-fruit-a" cx={-6} cy={-9} r={5} />
      <circle className="of-fruit-b" cx={3} cy={-11} r={5} />
      <circle className="of-fruit-c" cx={9} cy={-8} r={4} />
      <path className="of-bowl" d="M-14 -7 L14 -7 C 12 -1 8 0 0 0 C -8 0 -12 -1 -14 -7 Z" />
    </g>
  );
}

function Kettle({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path className="of-kettle" d="M-9 0 L-8 -14 C -8 -18 8 -18 8 -14 L9 0 Z" />
      <path className="of-mug-handle of-thin" d="M-5 -17 C -5 -24 5 -24 5 -17" />
      <path className="of-kettle" d="M8 -10 L14 -15 L13 -12 L9 -6 Z" />
    </g>
  );
}

export function PantryArt({ plan, brewing }: { plan: OfficePlan; brewing: number }) {
  const p = plan.pantry;
  if (!p) return null;
  const n1 = plan.m.text === "n1";
  if (p.kind === "room") {
    const c = p.counter;
    const top = c.y;
    const face = c.y + 14;
    const bottom = c.y + c.h;
    const wallTop = top - 80;
    const signW = Math.min(64, measure("Pantry", { size: 11, weight: 500 }) + 18);
    return (
      <g className="of-pantry">
        <g>
          <rect className="of-sign" x={c.x + 28 - signW / 2} y={Math.max(p.rect.y + plan.m.cap + plan.m.ticker + 8, wallTop)} width={signW} height={18} rx={3} />
          <text className="of-t of-t-n2 of-medium of-sign-word" x={c.x + 28} y={Math.max(p.rect.y + plan.m.cap + plan.m.ticker + 8, wallTop) + 13} textAnchor="middle">
            Pantry
          </text>
        </g>
        <CoffeeMachine x={c.x + 8} y={top + 7} brewing={brewing} />
        <Kettle x={c.x + 70} y={top + 7} />
        <DeskMug x={c.x + 94} y={top + 7} fresh={false} tone={0} />
        <DeskMug x={c.x + 110} y={top + 7} fresh={false} tone={1} />
        {c.w > 160 ? <FruitBowl x={c.x + 136} y={top + 7} /> : null}
        {c.w > 140 ? <Plant x={c.x + c.w - 14} y={top + 7} seed={1} /> : null}
        <Block x={c.x} w={c.w} top={top} face={face} bottom={bottom} tone="counter" />
        <rect className="of-drawer" x={c.x + 8} y={face + 6} width={c.w / 2 - 12} height={bottom - face - 12} rx={3} />
        <rect className="of-drawer" x={c.x + c.w / 2 + 4} y={face + 6} width={c.w / 2 - 12} height={bottom - face - 12} rx={3} />
        <rect className="of-handle" x={c.x + c.w / 4 - 8} y={face + 10} width={16} height={3} rx={1.5} />
        <rect className="of-handle" x={c.x + (c.w * 3) / 4 - 8} y={face + 10} width={16} height={3} rx={1.5} />
        {p.fridge ? <Fridge r={p.fridge} /> : null}
        {p.fridge && p.table && p.table.y - (p.fridge.y + p.fridge.h) > 96 ? <WaterCooler x={p.fridge.x + p.fridge.w / 2} y={p.table.y - 18} /> : null}
        {p.table ? <CafeCorner plan={plan} table={p.table} /> : null}
      </g>
    );
  }
  // a counter in the desk grid, on the furniture line
  const cell = plan.cells.find((k) => k.kind === "pantry");
  const r = p.rect;
  const top = p.top;
  const face = cell ? cell.face : top + plan.m.topDepth;
  const bottom = r.y + r.h;
  const x = r.x + 4;
  const w = r.w - 8;
  // the label keeps to the left half: coffee drinkers stand at the right
  const card = { x: x + 6, y: face + 5, w: Math.max(64, Math.round(w * 0.46)), h: plan.m.front - 10 };
  const label = fit("Pantry", card.w - 16, { size: n1 ? 13 : 11, weight: 500 });
  const subText = "Coffee and water";
  const sub = measure(subText, { size: n1 ? 13 : 11 }) <= card.w - 16 ? subText : fit("Coffee", card.w - 16, { size: n1 ? 13 : 11 });
  const lh = n1 ? 15 : 13;
  const y1 = card.y + Math.round((card.h - lh * 2) / 2) + lh - 3;
  return (
    <g className="of-pantry">
      <CoffeeMachine x={x + 10} y={top + 6} brewing={brewing} />
      {w > 120 ? <Kettle x={x + 68} y={top + 6} /> : null}
      <DeskMug x={x + (w > 120 ? 92 : 64)} y={top + 6} fresh={false} tone={1} />
      {w > 190 ? <DeskMug x={x + 108} y={top + 6} fresh={false} tone={2} /> : null}
      {w > 190 ? <FruitBowl x={x + 140} y={top + 6} /> : null}
      {w > 140 ? <Plant x={x + w - 14} y={top + 6} seed={2} /> : null}
      <Block x={x} w={w} top={top} face={face} bottom={bottom} tone="counter" />
      <rect className="of-card-paper" x={card.x} y={card.y} width={card.w} height={card.h} rx={4} />
      <text className={`of-t of-t-${plan.m.text} of-ink of-medium`} x={card.x + 8} y={y1}>
        {label}
      </text>
      <text className={`of-t of-t-${plan.m.text} of-muted`} x={card.x + 8} y={y1 + lh}>
        {sub}
      </text>
    </g>
  );
}

/** A water cooler: the bottle on its stand, a cup beside the tap. */
function WaterCooler({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect className="of-fridge" x={-13} y={-50} width={26} height={50} rx={3} />
      <rect className="of-fridge-top" x={-13} y={-54} width={26} height={6} rx={2} />
      <rect className="of-machine-panel" x={-4} y={-40} width={8} height={4} rx={1} />
      <rect className="of-bottle" x={-10} y={-82} width={20} height={30} rx={7} />
      <rect className="of-bottle-water" x={-8} y={-72} width={16} height={18} rx={5} />
    </g>
  );
}

function Fridge({ r }: { r: Rect }) {
  const topD = 10;
  return (
    <g>
      <rect className="of-fridge" x={r.x} y={r.y + topD - 1} width={r.w} height={r.h - topD + 1} rx={4} />
      <rect className="of-fridge-top" x={r.x} y={r.y} width={r.w} height={topD} rx={4} />
      <rect className="of-fridge-seam" x={r.x} y={r.y + topD + (r.h - topD) * 0.36} width={r.w} height={1.5} />
      <rect className="of-handle" x={r.x + r.w - 9} y={r.y + topD + 10} width={3} height={18} rx={1.5} />
      <rect className="of-handle" x={r.x + r.w - 9} y={r.y + topD + (r.h - topD) * 0.36 + 10} width={3} height={22} rx={1.5} />
      <rect className="of-magnet" x={r.x + 8} y={r.y + topD + 14} width={12} height={9} rx={1} />
    </g>
  );
}

/** The pantry's sitting corner: a rug, a bean bag clear of the walkway, the cafe table with two stools. */
function CafeCorner({ plan, table }: { plan: OfficePlan; table: Rect }) {
  const room = plan.rooms.find((r) => r.kind === "pantry");
  const pan = plan.pantry!;
  const m = plan.m;
  const gx = pan.rect.x + Math.round(40 * m.walker);
  const bagX = gx + 9 + 12 * m.walker + 10;
  const bagW = Math.min(64, table.x - 22 - bagX);
  const bottom = (room?.front ?? table.y + table.h + 20) - m.low - m.cap - 6;
  const rugX = bagW >= 40 ? bagX - 8 : table.x - 20;
  return (
    <g>
      <rect className="of-rug" x={rugX} y={table.y - 6} width={table.x + table.w + 20 - rugX} height={bottom - table.y + 4} rx={10} />
      {bagW >= 40 ? (
        <g>
          <ellipse className="of-beanbag" cx={bagX + bagW / 2} cy={bottom - 16} rx={bagW / 2} ry={15} />
          <ellipse className="of-beanbag-top" cx={bagX + bagW / 2 - 4} cy={bottom - 22} rx={bagW / 2 - 10} ry={7} />
        </g>
      ) : null}
      <CafeTable r={table} />
    </g>
  );
}

function CafeTable({ r }: { r: Rect }) {
  const cx = r.x + r.w / 2;
  const topH = 14;
  return (
    <g>
      <rect className="of-chair" x={r.x - 14} y={r.y + r.h - 22} width={16} height={22} rx={5} />
      <rect className="of-chair" x={r.x + r.w - 2} y={r.y + r.h - 22} width={16} height={22} rx={5} />
      <rect className="of-table-leg" x={cx - 3} y={r.y + topH} width={6} height={r.h - topH - 4} />
      <rect className="of-desk-front" x={cx - 14} y={r.y + r.h - 5} width={28} height={5} rx={2} />
      <ellipse className="of-desk-top" cx={cx} cy={r.y + topH / 2} rx={r.w / 2} ry={topH / 2} />
      <DeskMug x={cx + 8} y={r.y + topH / 2 + 2} fresh={false} tone={2} />
    </g>
  );
}

/* ---------------------------------------------------------------------
 * Cells in the desk grid: the rack, the bookshelf, the cat bed
 * ------------------------------------------------------------------- */

const RACK_WORDS: Record<"studio" | "fund", Record<RackMode, string>> = {
  studio: { idle: "Test rack", testing: "Tests running", pass: "Tests pass", fail: "Tests fail" },
  fund: { idle: "Order router", testing: "Executing", pass: "Filled", fail: "Rejected" },
};
const RACK_GLYPH: Record<RackMode, GlyphId | null> = { idle: null, testing: "hourglass", pass: "check", fail: "cross" };
const RACK_TONE: Record<RackMode, string> = { idle: "muted", testing: "muted", pass: "success", fail: "danger" };

function Cabinet({ x, w, top, bottom, seed }: { x: number; w: number; top: number; bottom: number; seed: number }) {
  const topD = 8;
  const units = Math.max(3, Math.floor((bottom - top - topD - 14) / 13));
  return (
    <g>
      <rect className="of-rack" x={x} y={top + topD - 1} width={w} height={bottom - top - topD + 1} rx={3} />
      <rect className="of-rack-top" x={x} y={top} width={w} height={topD} rx={3} />
      {Array.from({ length: units }, (_, i) => {
        const y = top + topD + 6 + i * 13;
        return (
          <g key={i}>
            <rect className="of-rack-unit" x={x + 5} y={y} width={w - 10} height={10} rx={1.5} />
            <rect className="of-rack-vent" x={x + 9} y={y + 4} width={Math.max(4, w - 36)} height={2} rx={1} />
            {[0, 1, 2].map((k) => (
              <circle key={k} className={`of-led of-led-${(i + k + seed) % 4}`} cx={x + w - 10 - k * 5} cy={y + 5} r={1.7} />
            ))}
          </g>
        );
      })}
    </g>
  );
}

export function RackCell({ cell, plan, mode }: { cell: Cell; plan: OfficePlan; mode: RackMode }) {
  const { rect, top } = cell;
  const bottom = rect.y + rect.h;
  const two = rect.w >= 250;
  const cabW = Math.min(54, Math.max(40, rect.w * 0.22));
  const cabTop = Math.max(rect.y + 8, top - 70);
  const x0 = rect.x + 10;
  const px = x0 + (two ? cabW * 2 + 6 : cabW) + 10;
  const pw = rect.x + rect.w - 10 - px;
  const words = RACK_WORDS[plan.theme][mode];
  const style = { size: 11, weight: 500 as const };
  const scr = { x: px + 2, y: top - 44, w: pw - 4, h: 38 };
  // a narrow screen keeps the whole word and drops the glyph: the word carries the state
  const glyph = measure(words, style) + 14 + 15 <= scr.w ? RACK_GLYPH[mode] : null;
  const text = fit(words, scr.w - 14 - (glyph ? 14 : 0), style);
  return (
    <g className="of-rack-cell" data-rack={mode}>
      <Cabinet x={x0} w={cabW} top={cabTop} bottom={bottom} seed={0} />
      {two ? <Cabinet x={x0 + cabW + 6} w={cabW} top={cabTop} bottom={bottom} seed={2} /> : null}
      {pw >= 56 ? (
        <g>
          <rect className="of-bezel" x={scr.x} y={scr.y} width={scr.w} height={scr.h} rx={4} />
          <rect className="of-screen" x={scr.x + 3} y={scr.y + 3} width={scr.w - 6} height={scr.h - 6} rx={2} />
          {glyph ? <Glyph name={glyph} x={scr.x + 8} y={scr.y + scr.h / 2 - 6} size={12} className={`of-glyph of-tone-${RACK_TONE[mode]}`} /> : null}
          <text className={`of-t of-t-n2 of-medium ${mode === "pass" || mode === "fail" ? `of-tone-${RACK_TONE[mode]}` : "of-ink"}`} x={scr.x + 8 + (glyph ? 15 : 0)} y={scr.y + scr.h / 2 + 4}>
            {text}
          </text>
          {mode === "testing" ? <rect className="of-progress of-progress-run" x={scr.x + 8} y={scr.y + scr.h - 9} width={scr.w - 16} height={3} rx={1.5} /> : null}
          <rect className="of-stand" x={scr.x + scr.w / 2 - 3} y={scr.y + scr.h} width={6} height={top - scr.y - scr.h} />
          <Block x={px} w={pw} top={top} face={cell.face} bottom={bottom} tone="cabinet" />
          <rect className="of-drawer" x={px + 6} y={cell.face + 6} width={pw - 12} height={bottom - cell.face - 12} rx={3} />
          <rect className="of-cable" x={px + 10} y={cell.face + 14} width={pw - 20} height={2} rx={1} />
        </g>
      ) : null}
    </g>
  );
}

export function ShelfCell({ cell, seed }: { cell: Cell; seed: number }) {
  const { rect, top } = cell;
  const bottom = rect.y + rect.h;
  const w = Math.min(130, rect.w * 0.56);
  const x = rect.x + 12;
  const shelfTop = Math.max(rect.y + 10, top - 50);
  const boards = [shelfTop + (top - shelfTop) * 0.5 + 8, top + 22, bottom - 8];
  const books = [10, 7, 12, 8, 11, 9, 7, 10, 8];
  return (
    <g>
      <rect className="of-shelf-body" x={x} y={shelfTop} width={w} height={bottom - shelfTop} rx={4} />
      <rect className="of-shelf-back" x={x + 5} y={shelfTop + 5} width={w - 10} height={bottom - shelfTop - 10} rx={2} />
      {boards.map((by, bi) => {
        let bx = x + 7;
        return (
          <g key={bi}>
            {books.map((bw, i) => {
              if (bx + bw > x + w - 7) return null;
              const h = 16 + ((i * 7 + seed * 3 + bi * 5) % 9);
              const lean = (i + bi + seed) % 5 === 4;
              const el = <rect key={i} className={`of-book of-book-${(i + seed + bi) % 3}`} x={bx} y={by - h} width={bw} height={h} rx={1.5} transform={lean ? `rotate(-10 ${bx + bw} ${by})` : undefined} />;
              bx += bw + 2;
              return el;
            })}
            <rect className="of-shelf-board" x={x + 3} y={by} width={w - 6} height={3} />
          </g>
        );
      })}
      <FloorPlant x={x + w + Math.min(44, (rect.w - w - 12) / 2)} y={bottom - 2} big={rect.w > 220} />
    </g>
  );
}

/** A printer on a low cabinet, a paper tray and a recycling bin. */
export function PrinterCell({ cell }: { cell: Cell }) {
  const { rect, top, face } = cell;
  const bottom = rect.y + rect.h;
  const w = Math.min(120, rect.w * 0.52);
  const x = rect.x + 12;
  return (
    <g>
      <rect className="of-printer" x={x + 10} y={top - 34} width={w - 20} height={34} rx={4} />
      <rect className="of-printer-top" x={x + 14} y={top - 34} width={w - 28} height={8} rx={2} />
      <rect className="of-machine-panel" x={x + w - 34} y={top - 22} width={14} height={6} rx={1.5} />
      <circle className="of-machine-led of-led-on" cx={x + w - 16} cy={top - 19} r={1.8} />
      <rect className="of-sheet" x={x + w / 2 - 14} y={top - 8} width={28} height={9} rx={1} />
      <Block x={x} w={w} top={top} face={face} bottom={bottom} tone="cabinet" />
      <rect className="of-drawer" x={x + 6} y={face + 6} width={w - 12} height={(bottom - face - 16) / 2} rx={3} />
      <rect className="of-drawer" x={x + 6} y={face + 10 + (bottom - face - 16) / 2} width={w - 12} height={(bottom - face - 16) / 2} rx={3} />
      {rect.w - w > 70 ? (
        <g>
          <path className="of-bin" d={`M${x + w + 22} ${bottom - 34} L${x + w + 50} ${bottom - 34} L${x + w + 47} ${bottom} L${x + w + 25} ${bottom} Z`} />
          <rect className="of-sheet" x={x + w + 27} y={bottom - 40} width={16} height={8} rx={1} transform={`rotate(-12 ${x + w + 35} ${bottom - 36})`} />
        </g>
      ) : null}
      {rect.w - w > 110 ? <FloorPlant x={rect.x + rect.w - 30} y={bottom - 2} /> : null}
    </g>
  );
}

/** A row of lockers with name tabs, and a coat stand. */
export function LockerCell({ cell }: { cell: Cell }) {
  const { rect, top } = cell;
  const bottom = rect.y + rect.h;
  const lockerTop = Math.max(rect.y + 10, top - 56);
  const n = rect.w >= 230 ? 4 : 2;
  const lw = 30;
  const x0 = rect.x + 12;
  return (
    <g>
      <rect className="of-locker-top" x={x0} y={lockerTop} width={n * lw} height={8} rx={2} />
      {Array.from({ length: n }, (_, i) => (
        <g key={i}>
          <rect className="of-locker" x={x0 + i * lw} y={lockerTop + 7} width={lw} height={bottom - lockerTop - 7} rx={2} />
          <rect className="of-locker-vent" x={x0 + i * lw + 8} y={lockerTop + 16} width={lw - 16} height={2} rx={1} />
          <rect className="of-locker-vent" x={x0 + i * lw + 8} y={lockerTop + 21} width={lw - 16} height={2} rx={1} />
          <rect className="of-box-label" x={x0 + i * lw + 9} y={lockerTop + 32} width={lw - 18} height={7} rx={1} />
          <rect className="of-handle" x={x0 + i * lw + lw - 8} y={lockerTop + 50} width={3} height={12} rx={1.5} />
        </g>
      ))}
      {rect.w - n * lw > 70 ? (
        <g>
          <rect className="of-post" x={x0 + n * lw + 36} y={bottom - 96} width={4} height={92} rx={2} />
          <rect className="of-post-base" x={x0 + n * lw + 24} y={bottom - 6} width={28} height={6} rx={3} />
          <path className="of-scarf" d={`M${x0 + n * lw + 38} ${bottom - 92} C ${x0 + n * lw + 26} ${bottom - 88} ${x0 + n * lw + 26} ${bottom - 60} ${x0 + n * lw + 30} ${bottom - 50} L${x0 + n * lw + 36} ${bottom - 52} C ${x0 + n * lw + 34} ${bottom - 64} ${x0 + n * lw + 34} ${bottom - 84} ${x0 + n * lw + 38} ${bottom - 88} Z`} />
          <circle className="of-hat" cx={x0 + n * lw + 44} cy={bottom - 92} r={7} />
        </g>
      ) : null}
    </g>
  );
}

/** A round cat bed on the floor, a scratching post and a ball of yarn. */
export function BedCell({ cell, bed }: { cell: Cell; bed: Rect | null }) {
  const { rect } = cell;
  const bottom = rect.y + rect.h;
  const b = bed ?? { x: rect.x + rect.w * 0.2, y: bottom - 36, w: Math.min(96, rect.w * 0.56), h: 30 };
  const postX = rect.x + 14;
  const postTop = Math.max(rect.y + 20, cell.top - 30);
  return (
    <g>
      <rect className="of-post-base" x={postX - 4} y={bottom - 10} width={30} height={10} rx={3} />
      <rect className="of-post" x={postX + 5} y={postTop} width={12} height={bottom - 10 - postTop} rx={2} />
      <rect className="of-post-top" x={postX - 3} y={postTop - 8} width={28} height={9} rx={4} />
      <circle className="of-yarn" cx={rect.x + rect.w - 22} cy={bottom - 9} r={8} />
      <path className="of-yarn-line" d={`M${rect.x + rect.w - 28} ${bottom - 13} Q ${rect.x + rect.w - 22} ${bottom - 3} ${rect.x + rect.w - 15} ${bottom - 12}`} />
      <ellipse className="of-bed-rim" cx={b.x + b.w / 2} cy={b.y + b.h * 0.55} rx={b.w / 2} ry={b.h / 2} />
      <ellipse className="of-bed-inner" cx={b.x + b.w / 2} cy={b.y + b.h * 0.5} rx={b.w / 2 - 7} ry={b.h / 2 - 6} />
    </g>
  );
}

/** The bed's front rim, drawn over a napping cat. */
export function BedRim({ bed }: { bed: Rect }) {
  return <path className="of-bed-rim" d={`M${bed.x} ${bed.y + bed.h * 0.55} A ${bed.w / 2} ${bed.h / 2} 0 0 0 ${bed.x + bed.w} ${bed.y + bed.h * 0.55} L${bed.x + bed.w - 6} ${bed.y + bed.h * 0.55} A ${bed.w / 2 - 6} ${bed.h / 2 - 8} 0 0 1 ${bed.x + 6} ${bed.y + bed.h * 0.55} Z`} />;
}

