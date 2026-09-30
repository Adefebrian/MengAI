// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The flat art a cat works with: one drawing per beat, in rig coordinates
// (160 x 160 viewBox), plus each role's own object drawn small for the free
// corner. Flat fills and the one rig line only (cats.css p-* classes). No
// desks, no computers, no furniture: a slate terminal, pages, cards, a
// shield, a magnifier, a spyglass, a brush, a small bug.
//
// Every beat splits into layers the rig stacks around the cat:
//   ground  under the whole cat, never moves with it (the bug on the cushion)
//   under   in front of the body, under the paws (the slate, the page)
//   over    over the paws (stamps, flags, the scan bar)
//   paw     inside the right paw, moves with it (brush, pencil, flag)
//   head    inside the head (the spyglass and the paw holding it)
import type { ReactNode } from "react";
import type { Beat, PropId } from "./poses";

export interface BeatLayers {
  ground?: ReactNode;
  under?: ReactNode;
  over?: ReactNode;
  paw?: ReactNode;
  head?: ReactNode;
}

/* ---------------------------------------------------------------------
 * Small shared pieces
 * ------------------------------------------------------------------- */

function Bar({ x, y, w, cls = "p-soft", h = 2.6 }: { x: number; y: number; w: number; cls?: string; h?: number }) {
  return <rect className={cls} x={x} y={y} width={w} height={h} rx={h / 2} />;
}

function Check({ x, y, cls = "p-check" }: { x: number; y: number; cls?: string }) {
  return <path className={cls} d={`M${x} ${y + 2.5} L${x + 2} ${y + 4.5} L${x + 5.5} ${y}`} />;
}

function Cross({ x, y, cls = "p-cross" }: { x: number; y: number; cls?: string }) {
  return <path className={cls} d={`M${x} ${y} L${x + 4.5} ${y + 4.5} M${x + 4.5} ${y} L${x} ${y + 4.5}`} />;
}

/** The result stamp: pass (a check) or fail (a cross); cats.css shows fail for a frustrated cat. */
function Stamp({ cx, cy, r, alt = "fail" }: { cx: number; cy: number; r: number; alt?: "fail" | "return" }) {
  const k = r / 9;
  return (
    <g className="cat-stamp">
      <g className="cat-stamp-pass">
        <circle className="p-pass" cx={cx} cy={cy} r={r} />
        <path className="p-glyph" d={`M${cx - 4.5 * k} ${cy + 0.5 * k} L${cx - 1.2 * k} ${cy + 3.8 * k} L${cx + 4.8 * k} ${cy - 3.6 * k}`} />
      </g>
      <g className="cat-stamp-alt">
        <circle className={alt === "fail" ? "p-fail" : "p-return"} cx={cx} cy={cy} r={r} />
        {alt === "fail" ? (
          <path className="p-glyph" d={`M${cx - 3.6 * k} ${cy - 3.6 * k} L${cx + 3.6 * k} ${cy + 3.6 * k} M${cx + 3.6 * k} ${cy - 3.6 * k} L${cx - 3.6 * k} ${cy + 3.6 * k}`} />
        ) : (
          <path className="p-glyph" d={`M${cx + 3.8 * k} ${cy + 3.6 * k} C ${cx + 4.4 * k} ${cy - 2.8 * k} ${cx - 1 * k} ${cy - 4.4 * k} ${cx - 3.8 * k} ${cy - 1 * k} M${cx - 4.2 * k} ${cy - 4.8 * k} L${cx - 3.8 * k} ${cy - 1 * k} L${cx - 0.2 * k} ${cy - 1.6 * k}`} />
        )}
      </g>
    </g>
  );
}

/** A small flag on a pole, standing at (x, y) with its cloth to the right. */
function Flag({ x, y, h = 20 }: { x: number; y: number; h?: number }) {
  return (
    <g className="cat-flag">
      <path className="p-pole" d={`M${x} ${y} L${x} ${y - h}`} />
      <path className="p-flag" d={`M${x} ${y - h} L${x + 13} ${y - h + 4.5} L${x} ${y - h + 9} Z`} />
    </g>
  );
}

/** A small flat bug, top view, centred on (0, 0), head to the left. */
function Bug() {
  return (
    <g className="cat-bug-body">
      <path className="p-bug-leg" d="M-3 -3.5 L-5 -7 M1 -4 L1 -7.5 M4.5 -3 L7 -6 M-3 3.5 L-5 7 M1 4 L1 7.5 M4.5 3 L7 6" />
      <ellipse className="p-bug" cx={1} cy={0} rx={6} ry={4.6} />
      <circle className="p-bug-head" cx={-5.4} cy={0} r={2.8} />
      <path className="p-bug-seam" d="M-2 0 L7 0" />
    </g>
  );
}

/* ---------------------------------------------------------------------
 * The slate: a flat terminal lying on the cushion, x 46..114, y 104..146
 * ------------------------------------------------------------------- */

function Slate({ clipId, children }: { clipId: string; children: ReactNode }) {
  return (
    <>
      <rect className="p-screen" x={46} y={104} width={68} height={42} rx={5} />
      <clipPath id={clipId}>
        <rect x={50} y={108} width={60} height={34} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>{children}</g>
    </>
  );
}

const CODE_ROWS: ReadonlyArray<readonly [number, number, number]> = [
  // indent, token width, rest width
  [0, 8, 22],
  [6, 6, 26],
  [6, 10, 14],
  [0, 8, 30],
];

/** Code lines that appear one by one (code beats). */
function CodeLines({ tokens = true, boxes = false }: { tokens?: boolean; boxes?: boolean }) {
  return (
    <>
      {CODE_ROWS.map(([indent, tw, rw], i) => {
        const y = 112 + i * 7;
        const x = 53 + (boxes ? 7 : indent);
        return (
          <g key={i} className={`cat-ln cat-ln-${i + 1}`}>
            {boxes ? <rect className="p-term-box" x={53} y={y - 0.8} width={4.6} height={4.6} rx={1} /> : null}
            <Bar x={x} y={y} w={tw} h={3.2} cls={tokens ? "p-term-accent" : "p-term"} />
            <Bar x={x + tw + 3} y={y} w={rw} h={3.2} cls="p-term" />
          </g>
        );
      })}
    </>
  );
}

const STREAM = [40, 26, 34, 18];

/** Output lines that scroll up one line per step (run beats). */
function StreamLines() {
  const rows: ReactNode[] = [];
  for (let block = 0; block < 2; block++) {
    STREAM.forEach((w, i) => {
      const y = 112 + (block * 4 + i) * 8;
      rows.push(<Bar key={`${block}-${i}`} x={53} y={y} w={w} h={3.2} cls={i === 0 ? "p-term-accent" : "p-term"} />);
    });
  }
  return <g className="cat-stream">{rows}</g>;
}

function CodeSlate({ clipId, variant }: { clipId: string; variant: "code" | "build" | "tests" | "layout" }) {
  if (variant === "layout") {
    return (
      <Slate clipId={clipId}>
        <rect className="p-paint-1 p-block cat-ln cat-ln-1" x={53} y={111} width={54} height={5} rx={1.5} />
        <rect className="p-paint-2 p-block cat-ln cat-ln-2" x={53} y={119} width={25} height={12} rx={1.5} />
        <rect className="p-paint-3 p-block cat-ln cat-ln-3" x={82} y={119} width={25} height={12} rx={1.5} />
        <rect className="p-term-accent cat-ln cat-ln-4" x={53} y={134} width={18} height={5} rx={2.5} />
      </Slate>
    );
  }
  return (
    <Slate clipId={clipId}>
      <CodeLines tokens={variant !== "code"} boxes={variant === "tests"} />
      {variant === "build" ? (
        <>
          <Bar x={53} y={139.4} w={54} h={2.8} cls="p-term-dim" />
          <rect className="p-term-accent cat-build" x={53} y={139.4} width={54} height={2.8} rx={1.4} />
        </>
      ) : null}
    </Slate>
  );
}

function RunSlate({ clipId }: { clipId: string }) {
  return (
    <Slate clipId={clipId}>
      <StreamLines />
    </Slate>
  );
}

const TEST_ROWS = [30, 24, 34, 20];

/** qa runs the suite: each test row ticks in turn; the last one fails for a frustrated cat. */
function TestSlate({ clipId }: { clipId: string }) {
  return (
    <Slate clipId={clipId}>
      {TEST_ROWS.map((w, i) => {
        const y = 112 + i * 7.5;
        return (
          <g key={i}>
            <rect className="p-term-box" x={53} y={y - 0.8} width={4.6} height={4.6} rx={1} />
            <Bar x={61} y={y} w={w} h={3.2} cls="p-term" />
            <g className={`cat-tick cat-tick-${i + 1}`}>
              {i === 3 ? (
                <>
                  <g className="cat-stamp-pass">
                    <Check x={52.6} y={y - 0.6} cls="p-check-term" />
                  </g>
                  <g className="cat-stamp-alt">
                    <Cross x={53} y={y - 0.6} cls="p-cross-term" />
                  </g>
                </>
              ) : (
                <Check x={52.6} y={y - 0.6} cls="p-check-term" />
              )}
            </g>
          </g>
        );
      })}
    </Slate>
  );
}

/* ---------------------------------------------------------------------
 * Pages, cards and boards (paper on the cushion)
 * ------------------------------------------------------------------- */

/** The page held up to read, x 54..106, y 92..140, with the role's own content. */
function ReadPage({ beat }: { beat: Beat }) {
  let body: ReactNode;
  switch (beat) {
    case "read-lead":
      body = [0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect className="p-box" x={60} y={99 + i * 8} width={5} height={5} rx={1} />
          <Bar x={68} y={100.2 + i * 8} w={[24, 28, 18, 26][i]!} />
          {i < 2 ? <Check x={60} y={99.6 + i * 8} /> : null}
        </g>
      ));
      break;
    case "read-engineer":
      body = (
        <>
          {[
            [60, 8, "p-code-1", 20],
            [66, 6, "p-code-2", 18],
            [66, 12, "p-code-1", 12],
            [72, 8, "p-code-2", 16],
            [60, 8, "p-code-1", 24],
          ].map(([x, w, cls, rw], i) => (
            <g key={i}>
              <Bar x={x as number} y={100 + i * 7} w={w as number} cls={cls as string} />
              <Bar x={(x as number) + (w as number) + 3} y={100 + i * 7} w={rw as number} />
            </g>
          ))}
        </>
      );
      break;
    case "read-designer":
      body = (
        <>
          <Bar x={60} y={99} w={40} h={5} cls="p-soft" />
          <rect className="p-lens p-frame" x={60} y={108} width={18} height={16} rx={1.5} />
          <Bar x={82} y={110} w={18} />
          <Bar x={82} y={116} w={14} />
          <Bar x={82} y={122} w={16} />
          <rect className="p-paint-1" x={60} y={129} width={16} height={4.4} rx={2.2} />
        </>
      );
      break;
    case "read-reviewer":
      body = ["+", "+", "-", "+", "-"].map((sign, i) => (
        <g key={i}>
          <rect className={sign === "+" ? "p-plus" : "p-minus"} x={60} y={99.4 + i * 7} width={3.6} height={3.6} rx={0.8} />
          <Bar x={67} y={100 + i * 7} w={[26, 18, 30, 22, 14][i]!} />
        </g>
      ));
      break;
    case "read-qa":
      body = [0, 1, 2, 3].map((i) => (
        <g key={i}>
          {i === 2 ? <Cross x={60.4} y={99.6 + i * 8} /> : <Check x={60} y={99.6 + i * 8} />}
          <Bar x={69} y={100.4 + i * 8} w={[24, 20, 28, 16][i]!} />
        </g>
      ));
      break;
    case "read-security":
      body = (
        <>
          <Bar x={60} y={99} w={26} h={4} cls="p-mid" />
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <Bar x={60} y={107 + i * 7} w={18} />
              <Bar x={82} y={107 + i * 7} w={[12, 16, 10, 14][i]!} cls="p-mid-soft" />
            </g>
          ))}
        </>
      );
      break;
    case "read-researcher":
      body = (
        <>
          <Bar x={60} y={99} w={34} h={4} cls="p-mid" />
          <rect className="p-lens p-frame" x={60} y={107} width={40} height={12} rx={1.5} />
          <Bar x={60} y={124} w={40} />
          <Bar x={60} y={130} w={28} />
        </>
      );
      break;
    default:
      // read-operator: a runbook, numbered steps under a play mark
      body = (
        <>
          <path className="p-mid" d="M60 99 L65.5 102 L60 105 Z" />
          <Bar x={69} y={100.6} w={24} h={3} cls="p-mid-soft" />
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect className="p-mid-soft" x={60} y={110 + i * 6.6} width={4} height={4} rx={1} />
              <Bar x={68} y={110.7 + i * 6.6} w={[26, 20, 30, 18][i]!} />
            </g>
          ))}
        </>
      );
  }
  return (
    <>
      <rect className="p-paper" x={54} y={92} width={52} height={48} rx={3} />
      {body}
    </>
  );
}

/** A file card lying on the cushion in front of the cat (review beats), x 40..120, y 124..148. */
function FileCard() {
  return (
    <>
      <rect className="p-paper" x={40} y={124} width={80} height={24} rx={3} />
      <path className="p-soft-line" d="M48 131 L96 131 M48 137.5 L104 137.5" />
    </>
  );
}

function Magnifier() {
  return (
    <g className="cat-mag">
      <path className="p-tube-line" d="M83 141 L93 149" strokeWidth={7} />
      <path className="p-tube-wood" d="M83 141 L93 149" strokeWidth={3} />
      <circle className="p-lens" cx={76} cy={134} r={10} />
    </g>
  );
}

function Clipboard() {
  return (
    <>
      <rect className="p-wood" x={52} y={92} width={50} height={54} rx={4} />
      <rect className="p-paper-flat" x={57} y={100} width={40} height={41} rx={2} />
      <rect className="p-steel" x={67} y={88} width={20} height={8} rx={2} />
      {[20, 16, 18].map((w, i) => {
        const y = 106 + i * 11;
        return (
          <g key={i}>
            <rect className="p-box" x={61} y={y} width={6} height={6} rx={1} />
            <Bar x={71} y={y + 1.7} w={w} />
            <path className={`p-check cat-check cat-check-${i + 1}`} d={`M62 ${y + 3} L64 ${y + 5} L67.5 ${y + 0.5}`} />
          </g>
        );
      })}
    </>
  );
}

/** The lead's board: two columns; three task cards move from to-do to done in turn. */
function Board() {
  return (
    <>
      <rect className="p-paper" x={34} y={108} width={92} height={40} rx={3} />
      <rect className="p-col" x={38} y={112} width={40} height={32} rx={2} />
      <rect className="p-col" x={82} y={112} width={40} height={32} rx={2} />
      {[0, 1, 2].map((i) => (
        <g key={i} className={`cat-move cat-move-${i + 1}`}>
          <rect className="p-paper p-paper-thin" x={41} y={114.5 + i * 9.5} width={34} height={7} rx={1.6} />
          <Bar x={44} y={117 + i * 9.5} w={[18, 22, 14][i]!} h={2} cls="p-mid-soft" />
        </g>
      ))}
    </>
  );
}

function TaskCardArt() {
  return (
    <>
      <rect className="p-paper" x={58} y={96} width={44} height={30} rx={4} />
      <rect className="p-mid" x={63} y={102} width={18} height={4} rx={2} />
      <Bar x={63} y={110} w={32} h={3} />
      <Bar x={63} y={117} w={24} h={3} />
    </>
  );
}

/** The operator's runbook: steps run in turn, the header ticks when all are done. */
function Runbook() {
  return (
    <>
      <rect className="p-paper" x={50} y={106} width={60} height={40} rx={3} />
      <path className="p-mid" d="M56 112 L62 115.5 L56 119 Z" />
      <Bar x={66} y={114.2} w={24} h={3} cls="p-mid-soft" />
      <g className="cat-tick cat-tick-4">
        <Check x={96} y={113} />
      </g>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <Bar x={56} y={124 + i * 6.5} w={48} h={3} />
          <rect className={`p-mid cat-step cat-step-${i + 1}`} x={56} y={124 + i * 6.5} width={48} height={3} rx={1.5} />
        </g>
      ))}
    </>
  );
}

/** A small file card on the right with a scan bar sweeping it (security), x 80..124, y 116..148. */
function ScanCard() {
  return (
    <>
      <rect className="p-paper" x={80} y={116} width={44} height={32} rx={3} />
      <Bar x={86} y={123} w={30} />
      <Bar x={86} y={130} w={22} />
      <Bar x={86} y={137} w={32} />
    </>
  );
}

function BigShield() {
  return (
    <>
      <path className="p-shield" d="M74 98 L96 105 C 96 124 88 138 74 146 C 60 138 52 124 52 105 Z" />
      <path className="p-check-light" d="M65 120 L72 127 L84 112" />
    </>
  );
}

function SmallShield() {
  return (
    <g className="cat-shield">
      <path className="p-shield" d="M48 98 L63 103 C 63 116 57 125 48 131 C 39 125 33 116 33 103 Z" />
      <path className="p-check-light" d="M42 113 L46.5 117.5 L54 108" />
    </g>
  );
}

function Canvas({ mono }: { mono: boolean }) {
  const paint = (n: 1 | 2 | 3) => (mono ? "p-paint-mono" : `p-paint-${n}`);
  return (
    <>
      <rect className="p-paper" x={110} y={98} width={36} height={46} rx={2} />
      <path className={`p-paint ${paint(1)} cat-stroke cat-stroke-1`} d="M116 108 Q124 103 132 108 Q136 110 140 107" />
      <path className={`p-paint ${paint(2)} cat-stroke cat-stroke-2`} d="M116 119 Q127 125 140 117" />
      <path className={`p-paint ${paint(3)} cat-stroke cat-stroke-3`} d="M117 131 L136 131" />
    </>
  );
}

/** The brush in the right paw while the cat paints, in the paw's own rest coordinates. */
function Brush({ mono }: { mono: boolean }) {
  return (
    <g className="cat-brush">
      <path className="p-tube-line" d="M92 142 L102 131" strokeWidth={6} />
      <path className="p-tube-wood" d="M92 142 L102 131" strokeWidth={2.5} />
      <path className={`p-paint ${mono ? "p-paint-mono" : "p-paint-1"}`} d="M102.5 130.5 L105.5 127.5" />
    </g>
  );
}

function Pencil() {
  return (
    <g className="cat-pencil">
      <path className="p-tube-line" d="M92 142 L101 132" strokeWidth={6} />
      <path className="p-tube-brass" d="M92 142 L101 132" strokeWidth={2.5} />
      <path className="p-ink-line" d="M101.5 131.5 L103.5 129.3" />
    </g>
  );
}

/** The flag an asking cat raises, in the right paw's rest coordinates. */
function AskFlag() {
  return <Flag x={94} y={140} h={28} />;
}

function Spyglass() {
  return (
    <g className="cat-spyglass">
      <path className="p-tube-line" d="M96 61 L111 57" strokeWidth={9} />
      <path className="p-tube-brass" d="M96 61 L111 57" strokeWidth={4} />
      <path className="p-tube-line" d="M110 57 L135 50" strokeWidth={13} />
      <path className="p-tube-brass" d="M110 57 L135 50" strokeWidth={8} />
      <path className="p-tube-line" d="M134 50.3 L139 48.9" strokeWidth={16} />
      <path className="p-tube-steel" d="M134 50.3 L139 48.9" strokeWidth={11} />
      <ellipse className="c-paw" cx={118} cy={62} rx={8} ry={6} />
    </g>
  );
}

/** Two pages open on the cushion at the left; one flips over in turn (researcher). */
function Booklet() {
  const lines = (x: number) => (
    <path className="p-soft-line p-soft-thin" d={`M${x + 4} 135 L${x + 17} 135 M${x + 4} 140 L${x + 15} 140`} />
  );
  return (
    <>
      <rect className="p-paper" x={12} y={130} width={22} height={18} rx={1.5} />
      {lines(12)}
      <rect className="p-paper" x={34} y={130} width={22} height={18} rx={1.5} />
      {lines(34)}
      <g className="cat-flip">
        <rect className="p-paper" x={34} y={130} width={22} height={18} rx={1.5} />
        {lines(34)}
      </g>
    </>
  );
}

function NotesPage() {
  return (
    <>
      <rect className="p-paper" x={48} y={116} width={64} height={30} rx={3} />
      <g className="cat-ln cat-ln-1">
        <Bar x={55} y={122} w={40} />
      </g>
      <g className="cat-ln cat-ln-2">
        <Bar x={55} y={129} w={34} />
      </g>
      <g className="cat-ln cat-ln-3">
        <Bar x={55} y={136} w={24} />
      </g>
    </>
  );
}

/* ---------------------------------------------------------------------
 * Beat art
 * ------------------------------------------------------------------- */

/** The layers one beat adds to the sitting cat. clipId must be unique per cat and beat. */
export function beatLayers(beat: Beat, clipId: string): BeatLayers {
  switch (beat) {
    case "code":
      return { under: <CodeSlate clipId={clipId} variant="code" /> };
    case "code-build":
      return { under: <CodeSlate clipId={clipId} variant="build" /> };
    case "code-tests":
      return { under: <CodeSlate clipId={clipId} variant="tests" /> };
    case "code-layout":
      return { under: <CodeSlate clipId={clipId} variant="layout" /> };
    case "code-notes":
      return { under: <NotesPage />, paw: <Pencil /> };
    case "run":
      return { under: <RunSlate clipId={clipId} /> };
    case "run-stamp":
      return { under: <RunSlate clipId={clipId} />, over: <Stamp cx={98} cy={117} r={9} /> };
    case "run-tests":
      return { under: <TestSlate clipId={clipId} /> };
    case "plan":
      return { under: <Clipboard /> };
    case "plan-board":
      return { under: <Board /> };
    case "review":
      return { under: <FileCard />, over: <Magnifier /> };
    case "review-stamp":
      return { under: <FileCard />, over: <><Magnifier /><Stamp cx={108} cy={131} r={7} alt="return" /></> };
    case "review-flag":
      return { under: <FileCard />, over: <><Magnifier /><Flag x={110} y={142} h={22} /></> };
    case "review-hunt":
      return {
        ground: (
          <g transform="translate(20 146)">
            <g className="cat-bug">
              <Bug />
            </g>
          </g>
        ),
      };
    case "research":
      return { head: <Spyglass /> };
    case "research-pages":
      return { head: <Spyglass />, ground: <Booklet /> };
    case "design":
      return { under: <Canvas mono />, paw: <Brush mono /> };
    case "design-paint":
      return { under: <Canvas mono={false} />, paw: <Brush mono={false} /> };
    case "scan":
      return { under: <BigShield /> };
    case "scan-sweep":
      return {
        under: (
          <>
            <ScanCard />
            <SmallShield />
          </>
        ),
        over: (
          <>
            <rect className="p-scan cat-sweep-bar" x={83} y={118} width={3.5} height={28} rx={1.75} />
            <Flag x={116} y={144} h={20} />
          </>
        ),
      };
    case "automate":
      return { under: <Runbook /> };
    case "handoff":
      return {
        under: (
          <g className="cat-toss">
            <TaskCardArt />
          </g>
        ),
      };
    case "ask":
      return { paw: <AskFlag /> };
    default:
      if (beat.startsWith("read-")) return { under: <ReadPage beat={beat} /> };
      return {};
  }
}

/* ---------------------------------------------------------------------
 * The role's own object, drawn small for the free corner (x 8..44, y 114..148)
 * ------------------------------------------------------------------- */

export function AsideArt({ id }: { id: PropId }) {
  switch (id) {
    case "clipboard":
      return (
        <>
          <rect className="p-wood" x={12} y={120} width={26} height={28} rx={3} />
          <rect className="p-paper-flat" x={15.5} y={125} width={19} height={19} rx={1.5} />
          <rect className="p-steel p-thin" x={19.5} y={117} width={11} height={6} rx={1.5} />
          <Check x={18} y={129} />
          <Bar x={25} y={130.4} w={7} h={2.4} />
          <Check x={18} y={137} />
          <Bar x={25} y={138.4} w={6} h={2.4} />
        </>
      );
    case "terminal":
      return (
        <>
          <rect className="p-screen" x={8} y={124} width={36} height={24} rx={4} />
          <path className="p-prompt" d="M14 131.5 L18 134.5 L14 137.5" />
          <Bar x={21} y={133.4} w={14} h={2.6} cls="p-term" />
          <Bar x={14} y={141} w={10} h={2.4} cls="p-term-accent" />
        </>
      );
    case "canvas":
      return (
        <>
          <rect className="p-paper" x={12} y={120} width={24} height={28} rx={2} />
          <path className="p-paint p-paint-1 p-paint-thin" d="M17 129 Q23 125 31 129" />
          <path className="p-paint p-paint-2 p-paint-thin" d="M17 137 L29 137" />
          <path className="p-tube-line" d="M31 147 L42 133" strokeWidth={5.5} />
          <path className="p-tube-wood" d="M31 147 L42 133" strokeWidth={2} />
        </>
      );
    case "magnifier":
      return (
        <>
          <path className="p-tube-line" d="M29 140 L38 148" strokeWidth={7} />
          <path className="p-tube-wood" d="M29 140 L38 148" strokeWidth={3} />
          <circle className="p-lens" cx={22} cy={133} r={9} />
        </>
      );
    case "bugcard":
      return (
        <>
          <rect className="p-paper" x={8} y={124} width={36} height={24} rx={3} />
          <g transform="translate(26 136) scale(0.8)">
            <Bug />
          </g>
        </>
      );
    case "shield":
      return (
        <>
          <path className="p-shield" d="M26 118 L39 122.5 C 39 134 34 142 26 147 C 18 142 13 134 13 122.5 Z" />
          <path className="p-check-light p-check-thin" d="M20.5 132 L24.5 136 L31.5 127.5" />
        </>
      );
    case "spyglass":
      return (
        <>
          <path className="p-tube-line" d="M10 144 L20 141" strokeWidth={8} />
          <path className="p-tube-brass" d="M10 144 L20 141" strokeWidth={3.5} />
          <path className="p-tube-line" d="M19 141 L36 136" strokeWidth={11} />
          <path className="p-tube-brass" d="M19 141 L36 136" strokeWidth={6.5} />
          <path className="p-tube-line" d="M35.5 136.2 L40 135" strokeWidth={13} />
          <path className="p-tube-steel" d="M35.5 136.2 L40 135" strokeWidth={8.5} />
        </>
      );
    case "runbook":
      return (
        <>
          <rect className="p-paper" x={10} y={120} width={32} height={28} rx={3} />
          <path className="p-mid" d="M15 125.5 L20 128.5 L15 131.5 Z" />
          <Bar x={23} y={127.3} w={13} h={2.4} cls="p-mid-soft" />
          <Bar x={15} y={136} w={22} h={2.4} />
          <Bar x={15} y={141} w={16} h={2.4} />
        </>
      );
    case "page":
      return (
        <>
          <rect className="p-paper" x={12} y={120} width={24} height={28} rx={2} />
          <Bar x={16} y={127} w={16} h={2.4} />
          <Bar x={16} y={133} w={12} h={2.4} />
        </>
      );
    case "card":
      return (
        <>
          <rect className="p-paper" x={8} y={126} width={36} height={22} rx={3} />
          <Bar x={13} y={132} w={16} h={3} cls="p-mid" />
          <Bar x={13} y={139} w={24} h={2.4} />
        </>
      );
  }
}

/** The task card an idle cat bats at (the bat quirk). Hidden until the quirk plays. */
export function BatCard() {
  return (
    <g className="cat-q-card">
      <rect className="p-paper" x={106} y={137} width={22} height={13} rx={2} />
      <Bar x={110} y={141} w={12} h={2.4} />
    </g>
  );
}

/** The task card that flies in when a waiting cat gets the work it waited for. */
export function CatchCard() {
  return (
    <g className="cat-catch-card">
      <TaskCardArt />
    </g>
  );
}

/** The warning shape an agent in error shows in the top corner. */
export function Warning() {
  return (
    <g className="cat-warning">
      <path className="p-warn" d="M21 9 L34 31 L8 31 Z" />
      <rect className="p-warn-mark" x={19.8} y={15} width={2.4} height={9} rx={1.2} />
      <circle className="p-warn-mark" cx={21} cy={27.4} r={1.6} />
    </g>
  );
}
