// The flat props, one per role and activity. Each is drawn once at the spot
// it is used in (rig coordinates, 160 x 160 viewBox); set aside, the same
// drawing is scaled into the free corner at the cat's left. Flat fills and
// the one rig line only (cats.css p-* classes).
import type { ReactNode } from "react";
import type { PropId } from "./poses";

/** Bounds of each drawing in use, [x, y, w, h], stroke included. */
export const PROP_BOUNDS: Record<PropId, readonly [number, number, number, number]> = {
  laptop: [33, 104, 94, 44],
  terminal: [42, 98, 76, 51],
  page: [54, 92, 52, 50],
  magnifier: [63, 122, 35, 31],
  canvas: [112, 86, 38, 64],
  spyglass: [91, 41, 54, 26],
  shield: [50, 96, 48, 52],
  mouse: [94, 122, 22, 28],
  clipboard: [50, 86, 54, 62],
  card: [56, 94, 48, 34],
};

/** Where a set-aside prop sits: centred on x 26, standing on y 148, at most 36 x 30. */
export function asideTransform(id: PropId): string {
  const [x, y, w, h] = PROP_BOUNDS[id];
  const s = Math.min(36 / w, 30 / h, 0.6);
  const tx = 26 - (x + w / 2) * s;
  const ty = 148 - (y + h) * s;
  return `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(3)})`;
}

function Laptop() {
  return (
    <>
      <rect className="p-steel" x={46} y={106} width={68} height={34} rx={4} />
      <circle className="p-paper-flat" cx={80} cy={122} r={4} />
      <path className="p-steel-dark" d="M38 140 L122 140 L125 146 L35 146 Z" />
    </>
  );
}

const TERM_LINES = [40, 26, 34, 18];

function Terminal({ clipId }: { clipId: string }) {
  const rows: ReactNode[] = [];
  for (let block = 0; block < 2; block++) {
    TERM_LINES.forEach((w, i) => {
      const y = 107 + (block * 4 + i) * 8;
      rows.push(<rect key={`${block}-${i}`} className={i === 0 ? "p-term-accent" : "p-term"} x={54} y={y} width={w} height={3.2} rx={1.6} />);
    });
  }
  return (
    <>
      <rect className="p-steel" x={70} y={140} width={20} height={7} rx={2} />
      <rect className="p-screen" x={44} y={100} width={72} height={42} rx={5} />
      <clipPath id={clipId}>
        <rect x={50} y={105} width={60} height={32} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <g className="cat-term-lines">{rows}</g>
      </g>
    </>
  );
}

const PAGE_LINES = [36, 30, 34, 24, 32];

function Page() {
  return (
    <>
      <rect className="p-paper" x={56} y={94} width={48} height={46} rx={3} />
      {PAGE_LINES.map((w, i) => (
        <rect key={i} className="p-soft" x={62} y={103 + i * 7} width={w} height={2.6} rx={1.3} />
      ))}
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

function Canvas() {
  return (
    <>
      <path className="p-leg" d="M121 124 L116 147 M141 124 L146 147" />
      <rect className="p-paper" x={114} y={88} width={34} height={36} rx={2} />
      <path className="p-paint p-paint-1 cat-stroke cat-stroke-1" d="M119 98 Q127 93 136 98" />
      <path className="p-paint p-paint-2 cat-stroke cat-stroke-2" d="M119 107 Q129 112 142 105" />
      <path className="p-paint p-paint-3 cat-stroke cat-stroke-3" d="M121 116 L134 116" />
    </>
  );
}

/**
 * The brush in the right paw while the cat paints (design pose only). Drawn
 * in the paw's own rest coordinates: the paw group carries the pose offset.
 */
export function Brush() {
  return (
    <g className="cat-brush">
      <path className="p-tube-line" d="M92 142 L102 131" strokeWidth={6} />
      <path className="p-tube-wood" d="M92 142 L102 131" strokeWidth={2.5} />
      <path className="p-paint p-paint-1" d="M102.5 130.5 L105.5 127.5" />
    </g>
  );
}

function Spyglass() {
  return (
    <>
      <path className="p-tube-line" d="M96 61 L111 57" strokeWidth={9} />
      <path className="p-tube-brass" d="M96 61 L111 57" strokeWidth={4} />
      <path className="p-tube-line" d="M110 57 L135 50" strokeWidth={13} />
      <path className="p-tube-brass" d="M110 57 L135 50" strokeWidth={8} />
      <path className="p-tube-line" d="M134 50.3 L139 48.9" strokeWidth={16} />
      <path className="p-tube-steel" d="M134 50.3 L139 48.9" strokeWidth={11} />
    </>
  );
}

function Shield() {
  return (
    <>
      <path className="p-shield" d="M74 98 L96 105 C 96 124 88 138 74 146 C 60 138 52 124 52 105 Z" />
      <path className="p-check-light" d="M65 120 L72 127 L84 112" />
    </>
  );
}

function Mouse() {
  return (
    <g className="cat-mouse">
      <rect className="p-paper" x={96} y={124} width={18} height={24} rx={9} />
      <path className="p-ink-line" d="M105 124 L105 133" />
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
            <rect className="p-soft" x={71} y={y + 1.7} width={w} height={2.6} rx={1.3} />
            <path className={`p-check cat-check cat-check-${i + 1}`} d={`M62 ${y + 3} L64 ${y + 5} L67.5 ${y + 0.5}`} />
          </g>
        );
      })}
    </>
  );
}

function TaskCard() {
  return (
    <>
      <rect className="p-paper" x={58} y={96} width={44} height={30} rx={4} />
      <rect className="p-mid" x={63} y={102} width={18} height={4} rx={2} />
      <rect className="p-soft" x={63} y={110} width={32} height={3} rx={1.5} />
      <rect className="p-soft" x={63} y={117} width={24} height={3} rx={1.5} />
    </>
  );
}

export function PropArt({ id, clipId }: { id: PropId; clipId: string }) {
  switch (id) {
    case "laptop":
      return <Laptop />;
    case "terminal":
      return <Terminal clipId={clipId} />;
    case "page":
      return <Page />;
    case "magnifier":
      return <Magnifier />;
    case "canvas":
      return <Canvas />;
    case "spyglass":
      return <Spyglass />;
    case "shield":
      return <Shield />;
    case "mouse":
      return <Mouse />;
    case "clipboard":
      return <Clipboard />;
    case "card":
      return <TaskCard />;
  }
}

/** A prop in the paws, or set aside in the free corner. */
export function Prop({ id, mode, clipId }: { id: PropId; mode: "use" | "aside"; clipId: string }) {
  return (
    <g className={`cat-prop cat-prop-${id}`} data-mode={mode} transform={mode === "aside" ? asideTransform(id) : undefined}>
      <PropArt id={id} clipId={clipId} />
    </g>
  );
}

/** The paper a reviewer reads through the magnifier, lying in front of the cat. */
export function GroundPage() {
  return (
    <g className="cat-ground-page">
      <path className="p-paper" d="M38 128 L122 128 L128 148 L32 148 Z" />
      <path className="p-soft-line" d="M48 136 L100 136 M46 142 L112 142" />
    </g>
  );
}

/** The card an idle cat bats at (the bat quirk). Hidden until the quirk plays. */
export function BatCard() {
  return (
    <g className="cat-q-card">
      <rect className="p-paper" x={106} y={137} width={22} height={13} rx={2} />
      <rect className="p-soft" x={110} y={141} width={12} height={2.4} rx={1.2} />
    </g>
  );
}
