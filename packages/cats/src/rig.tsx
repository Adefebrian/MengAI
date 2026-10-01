// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The cat rig: one flat vector family on a 160 x 160 viewBox, silhouette
// first. Every named part is its own group so cats.css can move it:
//   placement  the beat's paw and head offsets, as CSS transforms, so a
//              change of activity tweens the paws and head (--dur-300)
//   q-*        one-shot quirk and reaction layers (CSS animation)
//   *-loop     the beat's loop (CSS keyframes, transform and opacity only)
//   look       pointer follow (CSS transform from --cat-look-x and --cat-look-y)
// The sitting rig stays mounted across sitting beats: the parts tween, the
// beat's art layers crossfade. Lying poses (stopped, done) crossfade as a
// whole rig. Coat fills come from cats.css custom properties (data-coat on
// the root), so the markup is the same for every coat.
import type { CSSProperties, ReactNode } from "react";
import type { AgentRole } from "@mengai/shared";
import { AsideArt, BatCard, beatLayers, type BeatLayers } from "./props";
import { ROLE_PROP, SIT, heldFor, type Beat, type Held, type Pose, type PropId, type SitBeat } from "./poses";

type EyeMode = "open" | "closed" | "happy";

const TAIL_UP = "M100 140 C 124 144 140 132 138 110 C 137 98 130 92 124 96";
const TAIL_WRAP = "M106 140 C 118 148 98 152 76 150 C 66 149 60 147 58 145";
const TAIL_WRAP_TIP = "M58 145 C 52 144 48 140 50 134";
const ARM: Record<"think" | "ask", string> = {
  think: "M104 124 C 105 110 99 99 92 94",
  ask: "M104 112 C 110 100 114 88 114 78",
};
const BODY = "M80 80 C 60 80 48 102 47 122 C 46 138 58 147 80 147 C 102 147 114 138 113 122 C 112 102 100 80 80 80 Z";
const HEAD = "M80 32 C 104 32 117 46 117 63 C 117 80 101 90 80 90 C 59 90 43 80 43 63 C 43 46 56 32 80 32 Z";
const LOAF = "M40 128 C 40 108 62 100 88 100 C 114 100 132 110 132 128 C 132 142 120 148 86 148 C 54 148 40 142 40 128 Z";
const LIE_TAIL = "M128 132 C 142 138 138 150 116 150 C 104 150 96 149 90 148";
const LIE_TAIL_TIP = "M90 148 C 84 148 80 146 78 142";
/** The paws at rest: a beat whose object gives way to a held one has nothing to work on. */
const REST_PAW = [0, 0] as const;
const CUSHION =
  "M22 138 C 22 132 28 130 40 130 L 120 130 C 132 130 138 132 138 138 L 138 148 C 138 154 132 156 120 156 L 40 156 C 28 156 22 154 22 148 Z";

/** A tube (tail, arm): the fill stroke over a contour stroke; widths come from cats.css (--cat-sw per size). */
function Tube({ d, className, width }: { d: string; className: string; width: number }) {
  const style = { "--cat-tube": String(width) } as CSSProperties;
  return (
    <>
      <path className="c-tube-line" d={d} style={style} />
      <path className={className} d={d} style={style} />
    </>
  );
}

function Ear({ side }: { side: "l" | "r" }) {
  const l = side === "l";
  return (
    <g className={`cat-ear cat-ear-${side}`}>
      <g className="cat-ear-state">
        <g className="cat-ear-loop">
          <path className="c-ear" d={l ? "M48 56 L52 20 L78 38 Z" : "M112 56 L108 20 L82 38 Z"} />
          <path className="c-inner" d={l ? "M55 45 L56.5 29 L69 38.5 Z" : "M105 45 L103.5 29 L91 38.5 Z"} />
        </g>
      </g>
    </g>
  );
}

function Eye({ side, pupils, clipId }: { side: "l" | "r"; pupils: readonly [number, number]; clipId: string }) {
  const cx = side === "l" ? 66 : 94;
  return (
    <g className={`cat-eye cat-eye-${side}`}>
      <clipPath id={clipId}>
        <ellipse cx={cx} cy={62} rx={6.5} ry={7.5} />
      </clipPath>
      <ellipse className="c-iris" cx={cx} cy={62} rx={6.5} ry={7.5} />
      <g clipPath={`url(#${clipId})`}>
        <g className="cat-pupil-pose" style={move(pupils[0], pupils[1])}>
          <g className="cat-pupil-look">
            <g className="cat-pupil-loop">
              <ellipse className="c-pupil" cx={cx} cy={62.5} rx={2.4} ry={5.2} />
              <circle className="c-glint" cx={cx - 2} cy={59} r={1.5} />
            </g>
          </g>
        </g>
      </g>
      <ellipse className="c-eye-line" cx={cx} cy={62} rx={6.5} ry={7.5} />
      <g className="cat-lid-tilt">
        <ellipse className="c-lid cat-lid" cx={cx} cy={62} rx={7.5} ry={8.5} />
      </g>
      <ellipse className="c-lid cat-lid-q" cx={cx} cy={62} rx={7.5} ry={8.5} />
    </g>
  );
}

function ClosedEyes({ mode }: { mode: "closed" | "happy" }) {
  const d = mode === "happy" ? "M59 64 Q66 57 73 64 M87 64 Q94 57 101 64" : "M59 62 Q66 67 73 62 M87 62 Q94 67 101 62";
  return <path className="c-eye-closed" d={d} />;
}

interface HeadProps {
  pupils: readonly [number, number];
  eyes: EyeMode;
  clipBase: string;
  children?: ReactNode;
}

/** Ears, head, markings, eyes, nose and mouth, in head coordinates (neck at 80, 86). */
export function Head({ pupils, eyes, clipBase, children }: HeadProps) {
  return (
    <g className="cat-q-head">
      <g className="cat-react-head">
        <g className="cat-droop">
          <g className="cat-head-loop">
            <g className="cat-look">
              <Ear side="l" />
              <Ear side="r" />
              <path className="c-fur" d={HEAD} />
              <path className="c-stripe cat-stripes" d="M73 36.5 L75 45 M80 34.5 L80 44 M87 36.5 L85 45" />
              <path className="c-mark2 cat-patches" d="M48 56 C 48 46 55 40 64 39 C 64 45 60 50 54 55 C 51 57 48 58 48 56 Z" />
              <path className="c-mark cat-patches" d="M96 38 C 106 39 113 47 114 56 C 108 56 100 50 96 38 Z" />
              <ellipse className="c-point cat-mask" cx={80} cy={70} rx={23} ry={17} />
              <path className="c-light cat-muzzle" d="M80 66 C 90 66 97 71 97 77.5 C 97 84 89 88 80 88 C 71 88 63 84 63 77.5 C 63 71 70 66 80 66 Z" />
              {eyes === "open" ? (
                <g className="cat-eyes">
                  <Eye side="l" pupils={pupils} clipId={`${clipBase}-el`} />
                  <Eye side="r" pupils={pupils} clipId={`${clipBase}-er`} />
                </g>
              ) : (
                <ClosedEyes mode={eyes} />
              )}
              <path className="c-nose" d="M76 71 L84 71 L80 75.5 Z" />
              <path className="c-mouth cat-mouth-n" d="M80 75.5 Q80 79.5 76 80.5 M80 75.5 Q80 79.5 84 80.5" />
              <path className="c-mouth cat-mouth-s" d="M80 75.5 Q79 81 73.5 80 M80 75.5 Q81 81 86.5 80" />
              <path className="c-mouth cat-mouth-f" d="M75 80 L85 80" />
              <ellipse className="c-mouth-open cat-mouth-open" cx={80} cy={81} rx={4.5} ry={5.5} />
              {children}
            </g>
          </g>
        </g>
      </g>
    </g>
  );
}

function move(x: number, y: number, r = 0): CSSProperties {
  return { transform: r ? `translate(${x}px, ${y}px) rotate(${r}deg)` : `translate(${x}px, ${y}px)` };
}

function Paw({ side, offset, hidden, children }: { side: "l" | "r"; offset: readonly [number, number]; hidden?: boolean; children?: ReactNode }) {
  const cx = side === "l" ? 68 : 92;
  return (
    <g className={`cat-paw cat-paw-${side}`} style={move(offset[0], offset[1])} data-off={hidden ? "" : undefined}>
      <g className={`cat-q-paw-${side}`}>
        <g className={`cat-paw-${side}-loop`}>
          {children}
          <ellipse className="c-paw" cx={cx} cy={144} rx={9} ry={6} />
        </g>
      </g>
    </g>
  );
}

/**
 * One art layer of a beat. While a sitting beat changes, the previous beat's
 * layer stays for one crossfade (data-fade out) under the new one (data-fade in).
 * A beat whose object is replaced by a held one (heldFor) draws no art.
 */
function Layer({ pick, beat, leaving, clipBase, bare = false, leavingBare = false }: { pick: keyof BeatLayers; beat: Beat; leaving: Beat | null; clipBase: string; bare?: boolean; leavingBare?: boolean }) {
  const now = bare ? null : beatLayers(beat, `${clipBase}-${beat}`)[pick];
  const old = leaving && !leavingBare ? beatLayers(leaving, `${clipBase}-${leaving}-x`)[pick] : null;
  return (
    <>
      {old ? (
        <g key={`o-${leaving}`} className={`cat-layer cat-layer-${pick}`} data-fade="out">
          {old}
        </g>
      ) : null}
      {now ? (
        <g key={`n-${beat}`} className={`cat-layer cat-layer-${pick}`} data-fade={leaving ? "in" : undefined}>
          {now}
        </g>
      ) : null}
    </>
  );
}

/**
 * The free corner: the role's own object, or the one the cat is told to
 * hold (heldFor). It fades when a beat takes the corner.
 */
function Aside({ role, held, holding }: { role: AgentRole; held: Held; holding: PropId | null }) {
  return (
    <g className="cat-aside" data-on={held.aside ? "" : undefined} data-held={holding && held.aside ? held.aside : undefined}>
      <AsideArt id={held.aside ?? ROLE_PROP[role]} />
    </g>
  );
}

interface SitRigProps {
  beat: SitBeat;
  leaving: SitBeat | null;
  role: AgentRole;
  clipBase: string;
  /** Show the role's own object aside (off inside the celebrate stretch). */
  aside?: boolean;
  /** The object the cat is told to hold (CatProps.holding). */
  holding?: PropId | null;
}

/** The sitting rig: every sitting beat, and the stretch that opens celebrate. */
function SitRig({ beat, leaving, role, clipBase, aside = true, holding = null }: SitRigProps) {
  const spec = SIT[beat];
  const head = spec.head;
  const held = heldFor(beat, role, holding);
  const bare = !held.beatArt;
  const leavingBare = leaving ? !heldFor(leaving, role, holding).beatArt : false;
  const art = { beat, leaving, clipBase, bare, leavingBare };
  return (
    <g className="cat-sit" data-arm={spec.arm ? "" : undefined}>
      <Layer pick="ground" {...art} />
      <g className="cat-walk">
        <g className="cat-tail" data-on={spec.tail === "up" ? "" : undefined}>
          <g className="cat-tail-cel">
            <g className="cat-tail-loop">
              <Tube d={TAIL_UP} className="c-tube-tail" width={8} />
            </g>
          </g>
        </g>
        <g className="cat-arm" data-on={spec.arm === "think" ? "" : undefined}>
          <Tube d={ARM.think} className="c-tube-fur" width={8} />
        </g>
        <g className="cat-arm" data-on={spec.arm === "ask" ? "" : undefined}>
          <Tube d={ARM.ask} className="c-tube-fur" width={8} />
        </g>
        <g className="cat-q-body">
          <g className="cat-body-loop">
            <path className="c-fur" d={BODY} />
            <ellipse className="c-light cat-chest" cx={80} cy={117} rx={17} ry={22} />
            <path className="c-stripe cat-stripes" d="M52 108 Q60 110 62 116 M50 122 Q58 123 60 128 M108 108 Q100 110 98 116 M110 122 Q102 123 100 128" />
            <path className="c-mark cat-patches" d="M92 88 C 100 88 106 96 108 106 C 108 114 102 118 96 114 C 92 108 90 96 92 88 Z" />
            <path className="c-mark2 cat-patches" d="M52 128 C 56 120 66 122 68 132 C 68 140 58 144 52 140 Z" />
          </g>
        </g>
        <g className="cat-head" style={move(head.x, head.y, head.r)}>
          <Head pupils={spec.pupils} eyes="open" clipBase={clipBase}>
            <Layer pick="head" {...art} />
          </Head>
        </g>
        <Layer pick="under" {...art} />
        <Paw side="l" offset={bare ? REST_PAW : spec.pawL} />
        <Paw side="r" offset={bare ? REST_PAW : spec.pawR} hidden={spec.pawInHead && !bare}>
          <Layer pick="paw" {...art} />
        </Paw>
        <Layer pick="over" {...art} />
        <g className="cat-tail-wrap" data-on={spec.tail === "wrap" ? "" : undefined}>
          <Tube d={TAIL_WRAP} className="c-tube-tail" width={7} />
          <g className="cat-tail-tip">
            <Tube d={TAIL_WRAP_TIP} className="c-tube-tail" width={7} />
          </g>
        </g>
        {aside ? <Aside role={role} held={held} holding={holding} /> : null}
        <BatCard />
      </g>
    </g>
  );
}

/**
 * The lying rig: a loaf on its side, head on its paws, shifted left so the
 * role's own object can sit at the right. Stopped (eyes closed, dimmed) and
 * done (curled, content).
 */
function LieRig({ eyes, clipBase, role, beat, holding = null }: { eyes: "closed" | "happy"; clipBase: string; role: AgentRole; beat: Beat; holding?: PropId | null }) {
  return (
    <g className="cat-lie">
      <g transform="translate(-12 0)">
        <g className="cat-lie-body">
          <path className="c-fur" d={LOAF} />
          <path className="c-stripe cat-stripes" d="M86 102 L88 110 M98 103 L99 111 M110 106 L109 113" />
          <path className="c-mark cat-patches" d="M96 104 C 108 104 120 110 122 120 C 112 122 100 116 96 104 Z" />
          <path className="c-mark2 cat-patches" d="M104 132 C 110 128 122 130 124 138 C 118 144 108 144 104 132 Z" />
        </g>
        <g className="cat-lie-tail">
          <Tube d={LIE_TAIL} className="c-tube-tail" width={7} />
          <g className="cat-tail-tip">
            <Tube d={LIE_TAIL_TIP} className="c-tube-tail" width={7} />
          </g>
        </g>
        <g transform="translate(-14 44) scale(0.9)">
          <g transform={eyes === "closed" ? "rotate(8 80 86)" : "rotate(-3 80 86)"}>
            <g className="cat-head">
              <Head pupils={[0, 0]} eyes={eyes} clipBase={`${clipBase}-lie`} />
            </g>
          </g>
        </g>
        <ellipse className="c-paw" cx={50} cy={141} rx={9} ry={5.5} />
        <ellipse className="c-paw" cx={70} cy={144} rx={9} ry={5.5} />
      </g>
      <g className="cat-aside-lie" transform="translate(112 0)">
        <Aside role={role} held={heldFor(beat, role, holding)} holding={holding} />
      </g>
    </g>
  );
}

export function Cushion() {
  return <path className="c-cushion" d={CUSHION} />;
}

const PRINTS: ReadonlyArray<readonly [number, number, number]> = [
  [20, 142, -20],
  [34, 124, -10],
  [128, 140, 15],
  [142, 122, 25],
];

/** Paw prints that pop and fade: the celebrateKey one-shot and the opening of done. */
export function PawPrints({ className = "cat-prints" }: { className?: string }) {
  return (
    <g className={className}>
      {PRINTS.map(([x, y, r], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${r})`}>
          <g className="cat-print" style={{ ["--cat-i" as string]: String(i) }}>
            <ellipse cx={0} cy={2} rx={4} ry={3.4} />
            <circle cx={-3.6} cy={-2.6} r={1.7} />
            <circle cx={0} cy={-4} r={1.7} />
            <circle cx={3.6} cy={-2.6} r={1.7} />
          </g>
        </g>
      ))}
    </g>
  );
}

export type RigKind = "sit" | "lie-stopped" | "lie-celebrate";

export function rigKind(pose: Pose): RigKind {
  return pose === "stopped" ? "lie-stopped" : pose === "celebrate" ? "lie-celebrate" : "sit";
}

export interface RigProps {
  pose: Pose;
  beat: Beat;
  /** The sitting beat crossfading out while this sitting rig tweens to the new one. */
  leaving?: Beat | null;
  role: AgentRole;
  clipBase: string;
  /** Motion allowed: done plays its stretch and paw prints before it curls up. */
  live: boolean;
  fade?: "in" | "out";
  /** The object the cat is told to hold (CatProps.holding); null keeps the rig's own choice. */
  holding?: PropId | null;
}

/** One full pose. Two rigs sit on top of each other only while sitting and lying crossfade. */
export function Rig({ pose, beat, leaving = null, role, clipBase, live, fade, holding = null }: RigProps) {
  const kind = rigKind(pose);
  const base = `${clipBase}-${kind}`;
  let body: ReactNode;
  if (kind === "lie-stopped") body = <LieRig eyes="closed" clipBase={base} role={role} beat={beat} holding={holding} />;
  else if (kind === "lie-celebrate")
    body = live ? (
      <>
        <SitRig beat="celebrate" leaving={null} role={role} clipBase={`${base}-s`} aside={false} />
        <PawPrints className="cat-done-prints" />
        <LieRig eyes="happy" clipBase={base} role={role} beat={beat} holding={holding} />
      </>
    ) : (
      <LieRig eyes="happy" clipBase={base} role={role} beat={beat} holding={holding} />
    );
  else {
    const sitLeaving = leaving && leaving !== "stopped" ? (leaving as SitBeat) : null;
    body = <SitRig beat={beat as SitBeat} leaving={sitLeaving} role={role} clipBase={base} holding={holding} />;
  }
  return (
    <g
      className="cat-rig"
      data-pose={pose}
      data-beat={beat}
      data-fade={fade}
      data-lying={kind === "sit" ? undefined : ""}
    >
      <g className="cat-hop">
        <g className="cat-shake">{body}</g>
      </g>
    </g>
  );
}
