// DeliveryTracker art: the stop pins with their stage pictograms and the
// courier, all flat fills and the one ink-muted contour of the cat family.
//
//   Pictogram  a 24-unit line glyph per stage, drawn in currentColor with a
//              non-scaling 1.5px stroke (clipboard for the plan, a door for
//              the hire, a keyboard for the work, and so on)
//   StopPin    a white disc with the stage pictogram; a finished stop wears
//              a pass stamp, the stop that sent the work back a return stamp
//   Courier    the courier cat (the Cat rig's own head) riding a small flat
//              scooter to the right, a parcel in the front basket, on a
//              120 x 100 box with the ground at y 100. Every moving part is
//              its own group so tracker.css can move it: the U-turn flip,
//              the idle bob, the wheels, the tail and ears in the wind, the
//              exhaust puff, and the arrival (the scooter parks back, the
//              rider hops, the parcel drops to the ground, paw prints pop)
// Everything here is aria-hidden art; the words live in the HTML.
import type { CSSProperties } from "react";
import { coatOf } from "../poses";
import { Head } from "../rig";

export type Pictogram =
  | "envelope"
  | "clipboard"
  | "door"
  | "keyboard"
  | "magnifier"
  | "flask"
  | "parcel"
  | "chart"
  | "database"
  | "curve"
  | "shield"
  | "ticket"
  | "bolt"
  | "report"
  | "flag";

/** The pictogram of each known stage id, studio then fund; anything else gets a flag. */
export const STAGE_PICTOGRAM: Readonly<Record<string, Pictogram>> = {
  goal: "envelope",
  planned: "clipboard",
  hired: "door",
  working: "keyboard",
  review: "magnifier",
  testing: "flask",
  shipped: "parcel",
  thesis: "chart",
  research: "database",
  backtest: "curve",
  risk_review: "shield",
  paper_trade: "ticket",
  live_trade: "bolt",
  report: "report",
};

export function pictogramFor(stageId: string): Pictogram {
  return STAGE_PICTOGRAM[stageId] ?? "flag";
}

/** Line glyphs on a 24 grid. Strokes only, except the few dots drawn as filled circles. */
const GLYPH: Record<Pictogram, { d: string; dots?: ReadonlyArray<readonly [number, number]> }> = {
  envelope: { d: "M5 6.5 H19 A1.5 1.5 0 0 1 20.5 8 V16.5 A1.5 1.5 0 0 1 19 18 H5 A1.5 1.5 0 0 1 3.5 16.5 V8 A1.5 1.5 0 0 1 5 6.5 Z M4.5 8 L12 13 L19.5 8" },
  clipboard: { d: "M8.5 5 H7 A1.5 1.5 0 0 0 5.5 6.5 V19.5 A1.5 1.5 0 0 0 7 21 H17 A1.5 1.5 0 0 0 18.5 19.5 V6.5 A1.5 1.5 0 0 0 17 5 H15.5 M9.5 3.5 H14.5 V6.5 H9.5 Z M9 11 H15 M9 14.5 H13" },
  door: { d: "M7 20.5 V5 A1.5 1.5 0 0 1 8.5 3.5 H15.5 A1.5 1.5 0 0 1 17 5 V20.5 M4.5 20.5 H19.5", dots: [[14, 12.5]] },
  keyboard: { d: "M4 7 H20 A1.5 1.5 0 0 1 21.5 8.5 V16 A1.5 1.5 0 0 1 20 17.5 H4 A1.5 1.5 0 0 1 2.5 16 V8.5 A1.5 1.5 0 0 1 4 7 Z M8 14.25 H16", dots: [[6.5, 10.5], [9.5, 10.5], [12.5, 10.5], [15.5, 10.5], [18, 10.5]] },
  magnifier: { d: "M10.5 4.5 A6 6 0 1 1 10.5 16.5 A6 6 0 1 1 10.5 4.5 Z M15 15 L20 20" },
  flask: { d: "M9 3.5 H15 M10.5 3.5 V9.5 L5.4 18.4 A1.4 1.4 0 0 0 6.6 20.5 H17.4 A1.4 1.4 0 0 0 18.6 18.4 L13.5 9.5 V3.5 M7.6 15 H16.4" },
  parcel: { d: "M12 3.5 L20 7.5 V16.5 L12 20.5 L4 16.5 V7.5 Z M4 7.5 L12 11.5 L20 7.5 M12 11.5 V20.5 M8 5.5 L16 9.5" },
  chart: { d: "M4 4 V20 H20 M7 15.5 L10.5 11.5 L13.5 13.5 L18.5 7.5 M15 7.5 H18.5 V11" },
  database: { d: "M5 6.5 C5 5.1 8.1 4 12 4 C15.9 4 19 5.1 19 6.5 C19 7.9 15.9 9 12 9 C8.1 9 5 7.9 5 6.5 Z M5 6.5 V17.5 C5 18.9 8.1 20 12 20 C15.9 20 19 18.9 19 17.5 V6.5 M5 12 C5 13.4 8.1 14.5 12 14.5 C15.9 14.5 19 13.4 19 12" },
  curve: { d: "M4 4 V20 H20 M7 16 C9 16 9.5 9 12.5 9 C15.5 9 15.5 13 19 12 M7 7.5 L9.5 5 M7 7.5 L9.5 10 M7 7.5 H12" },
  shield: { d: "M12 3 L19 5.8 V11 C19 15.4 16 18.9 12 20.9 C8 18.9 5 15.4 5 11 V5.8 Z M9 12 L11.2 14.2 L15.2 9.8" },
  ticket: { d: "M5 6.5 H19 A1 1 0 0 1 20 7.5 V10 A2 2 0 0 0 20 14 V16.5 A1 1 0 0 1 19 17.5 H5 A1 1 0 0 1 4 16.5 V14 A2 2 0 0 0 4 10 V7.5 A1 1 0 0 1 5 6.5 Z M14.5 8.5 V9.5 M14.5 11.5 V12.5 M14.5 14.5 V15.5" },
  bolt: { d: "M13.5 3 L6 13.5 H11.5 L10.5 21 L18 10.5 H12.5 Z" },
  report: { d: "M6.5 3.5 H14 L18.5 8 V19 A1.5 1.5 0 0 1 17 20.5 H7 A1.5 1.5 0 0 1 5.5 19 V4.5 A1 1 0 0 1 6.5 3.5 Z M14 3.5 V8 H18.5 M9 17 V14.5 M12 17 V12 M15 17 V13.5" },
  flag: { d: "M6 21 V4 M6 4.5 H17 L14.5 8.5 L17 12.5 H6" },
};

export function Glyph({ name }: { name: Pictogram }) {
  const g = GLYPH[name];
  return (
    <g className="tk-glyph">
      <path d={g.d} vectorEffect="non-scaling-stroke" />
      {g.dots?.map(([x, y], i) => <circle key={i} className="tk-glyph-dot" cx={x} cy={y} r={1.4} />)}
    </g>
  );
}

export type StopState = "done" | "active" | "todo" | "returned";

/** A 28 px stop pin: a white disc with the pictogram, and a stamp on a finished or returned stop. */
export function StopPin({ glyph, state }: { glyph: Pictogram; state: StopState }) {
  return (
    <svg className="tk-pin-art" viewBox="0 0 28 28" width={28} height={28} aria-hidden="true" focusable="false">
      <circle className="tk-pin-disc" cx={14} cy={14} r={12.25} />
      <g className="tk-pin-glyph" transform="translate(7 7) scale(0.5833)">
        <Glyph name={glyph} />
      </g>
      {state === "done" ? (
        <g className="tk-stamp tk-stamp-pass">
          <circle cx={22} cy={22} r={5.5} />
          <path d="M19.6 22.1 L21.3 23.8 L24.5 20.4" />
        </g>
      ) : state === "returned" ? (
        <g className="tk-stamp tk-stamp-return">
          <circle cx={22} cy={22} r={5.5} />
          <path d="M24.3 24 C 24.8 20.6 21.6 19.3 19.9 21.2 M19.6 19.1 L19.9 21.2 L22 20.9" />
        </g>
      ) : null}
    </svg>
  );
}

function Tube({ d, width, cls = "c-tube-fur" }: { d: string; width: number; cls?: string }) {
  const style = { "--cat-tube": String(width) } as CSSProperties;
  return (
    <>
      <path className="c-tube-line" d={d} style={style} />
      <path className={cls} d={d} style={style} />
    </>
  );
}

function Wheel({ cx }: { cx: number }) {
  return (
    <g className="tk-wheel">
      <circle className="tk-tire" cx={cx} cy={89} r={11} />
      <g className="tk-spin">
        <circle className="tk-hub" cx={cx} cy={89} r={4.5} />
        <path className="tk-spoke" d={`M${cx} 85 V93 M${cx - 4} 89 H${cx + 4}`} />
      </g>
    </g>
  );
}

function ParcelArt({ x, y, w = 15, h = 13 }: { x: number; y: number; w?: number; h?: number }) {
  const tape = Math.round(w / 5);
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect className="tk-parcel" x={0} y={0} width={w} height={h} rx={1.5} />
      <rect className="tk-parcel-tape" x={(w - tape) / 2} y={0} width={tape} height={h} />
    </g>
  );
}

const PRINTS: ReadonlyArray<readonly [number, number, number]> = [
  [84, 22, -18],
  [100, 12, 8],
  [113, 30, 22],
];

export interface CourierArtProps {
  coat: string;
  seed: number;
  clipBase: string;
  /** happy closed eyes: the arrival and the rest after it */
  happy: boolean;
  /** the rig's blink and the ear tween (cats.css .cat--live) */
  live: boolean;
}

/**
 * The courier on its scooter, facing right, in a 120 x 100 box. The box
 * never moves on its own: tracker.css turns and moves the groups inside it.
 */
export function CourierArt({ coat, seed, clipBase, happy, live }: CourierArtProps) {
  return (
    <svg className="tk-courier-svg" viewBox="0 0 120 100" aria-hidden="true" focusable="false">
      <g className={live ? "cat cat--live tk-courier" : "cat tk-courier"} data-coat={coatOf(coat, seed)}>
        <ellipse className="tk-ring" cx={60} cy={97} rx={52} ry={3} />
        <g className="tk-flip">
          <g className="tk-park">
            <g className="tk-bob">
              <g className="tk-puff">
                <circle cx={9} cy={88} r={4.5} />
                <circle cx={3} cy={82} r={3} />
              </g>
              <Wheel cx={30} />
              <Wheel cx={92} />
              <g className="tk-rider">
                <g className="tk-tail">
                  <Tube d="M34 60 C 24 61 16 56 12 46" width={7} cls="c-tube-tail" />
                </g>
              </g>
              <path className="tk-shell" d="M12 86 C 12 72 22 64 38 64 L 58 64 C 63 64 66 68 66 73 L 66 86 Z" />
              <rect className="tk-board" x={58} y={81} width={28} height={6} rx={2} />
              <path className="tk-seat" d="M22 64 C 22 60 26 58 32 58 L 56 58 C 60 58 62 60 62 64 Z" />
              <g className="tk-rider">
                <Tube d="M52 60 C 58 66 62 73 66 79" width={8} />
                <ellipse className="c-paw" cx={68} cy={80} rx={5} ry={3.2} />
                <path className="c-fur" d="M46 34 C 56 34 62 42 62 52 C 62 60 56 63 46 63 C 38 63 32 60 32 52 C 32 42 36 34 46 34 Z" />
                <ellipse className="c-light cat-chest" cx={55} cy={50} rx={5} ry={8} />
                <path className="c-stripe cat-stripes" d="M38 42 Q41 45 40 49 M36 51 Q39 53 38 57" />
                <path className="c-mark cat-patches" d="M34 48 C 38 40 46 40 48 48 C 46 56 38 58 34 54 Z" />
              </g>
              <path className="tk-fender" d="M80 84 C 82 76 88 73 94 73 C 100 73 104 78 105 84 Z" />
              <path className="tk-column" d="M79 87 L 86 87 L 95 48 L 88.5 46.5 Z" />
              <g className="tk-basket-parcel">
                <ParcelArt x={100} y={38} />
              </g>
              <rect className="tk-basket" x={98} y={49} width={19} height={12} rx={2} />
              <path className="tk-bar" d="M86 44.5 L 100 42.5" />
              <g className="tk-rider">
                <Tube d="M52 45 C 62 46 74 46 85 44.5" width={7} />
                <ellipse className="c-paw" cx={87} cy={44} rx={4.6} ry={4} />
                <g className="tk-head" transform="translate(4 -10) scale(0.55)">
                  <Head pupils={[2.5, 0.5]} eyes={happy ? "happy" : "open"} clipBase={clipBase} />
                </g>
              </g>
            </g>
          </g>
        </g>
        <g className="tk-drop">
          <ParcelArt x={93} y={79} w={24} h={19} />
          <g className="tk-drop-stamp">
            <circle cx={111} cy={79} r={6.5} />
            <path d="M108 79.2 L110.2 81.4 L114 77.4" />
          </g>
        </g>
        <g className="tk-prints">
          {PRINTS.map(([x, y, r], i) => (
            <g key={i} transform={`translate(${x} ${y}) rotate(${r})`}>
              <g className="tk-print" style={{ "--tk-i": String(i) } as CSSProperties}>
                <ellipse cx={0} cy={1.6} rx={3.2} ry={2.7} />
                <circle cx={-2.9} cy={-2.1} r={1.35} />
                <circle cx={0} cy={-3.2} r={1.35} />
                <circle cx={2.9} cy={-2.1} r={1.35} />
              </g>
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
}
