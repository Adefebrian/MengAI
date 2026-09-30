// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The cats of the office, drawn inside the one scene SVG. The seated cat is
// the real rig (rig.tsx) with every role x activity beat, so a cat at its
// desk works exactly like the Cat component. Three more views share the
// rig's coat classes and its one ink-muted contour:
//   Walker   side view walk cycle: legs swing in pairs, the body bobs, the
//            tail sways, the rig's own head looks ahead; plus a back view
//            (walking away, up the floor) and a front view (walking toward
//            us, down the floor), picked by data-face on the floor actor
//   BackCat  sitting with its back to us, facing a desk, the CEO, the
//            whiteboard or the meeting table, the right paw raised when it
//            hands something over
// All motion is CSS keyframes on transform and opacity, switched on by
// data-pose on the floor actor; nothing moves under reduced motion. Every
// floor cat stands on a flat contact ellipse, one tonal step darker than
// the floor under it (no blur: a tonal step, not a shadow).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ACTIVITY_MIN_DWELL_MS } from "@mengai/shared";
import type { OfficeAgent } from "../office-contract";
import { useCrossfade } from "../cat";
import { useDwell, useQuirks } from "../motion";
import { QUIRK_POSES, beatFor, coatOf, isLowEnergy, phaseMs, poseFor, type Pose } from "../poses";
import { CatchCard, Warning } from "../props";
import { Head, PawPrints, Rig, rigKind } from "../rig";
import type { ActorView, Carry, Reaction } from "./director";
import { sceneClip, useSceneUid } from "./uid";

/** How long each one-shot reaction class stays on (ms), matching office.css. */
export const REACTION_MS: Record<Reaction, number> = {
  catch: 900,
  nod: 1200,
  shake: 1200,
  celebrate: 2200,
  "stamp-pass": 900,
  "stamp-return": 900,
  look: 3000,
  approve: 1400,
};

/** The latest one-shot while it plays, null otherwise. */
export function useOneShot(react: ActorView["react"], live: boolean): Reaction | null {
  const [active, setActive] = useState<{ kind: Reaction; n: number } | null>(null);
  const n = react?.n ?? 0;
  useEffect(() => {
    if (!react || !live) return;
    setActive(react);
    const timer = setTimeout(() => setActive((a) => (a && a.n === react.n ? null : a)), REACTION_MS[react.kind]);
    return () => clearTimeout(timer);
    // the reaction counter is the trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, live]);
  return live && active ? active.kind : null;
}

/** Coat, role and mood attributes every office cat carries, so cats.css colours it. */
export function catAttrs(agent: OfficeAgent, extra: Record<string, string | undefined> = {}) {
  return {
    "data-coat": coatOf(agent.look.coat, agent.look.seed),
    "data-role": agent.role,
    "data-mood": agent.mood,
    "data-status": agent.status,
    "data-cat-status": agent.status,
    "data-energy": isLowEnergy(agent.energy) ? "low" : undefined,
    ...extra,
  };
}

function Tube({ d, width, tail = false }: { d: string; width: number; tail?: boolean }) {
  const style = { "--cat-tube": String(width) } as CSSProperties;
  return (
    <>
      <path className="c-tube-line" d={d} style={style} />
      <path className={tail ? "c-tube-tail" : "c-tube-fur"} d={d} style={style} />
    </>
  );
}

/* ---------------------------------------------------------------------
 * Seated: the real rig at a desk, a meeting seat, or on the floor
 * ------------------------------------------------------------------- */

export interface SeatedCatProps {
  agent: OfficeAgent;
  /** top-left of the rig box and its size */
  x: number;
  y: number;
  size: number;
  live: boolean;
  /** plays its beat loop (inside the live cap, on screen) */
  busy: boolean;
  clip: string;
  react?: Reaction | null;
  /** an override pose, for a cat resting on the floor or at the meeting table */
  pose?: Pose;
  talking?: boolean;
  /** a mug held between the paws (coffee break) */
  mug?: boolean;
  /** curled up asleep in the cat bed: the stopped pose, not dimmed, no desk object */
  nap?: boolean;
  /** the fund's trader standing up at its desk to execute */
  lift?: boolean;
  offscreen: RefObject<boolean>;
}

export function SeatedCat(p: SeatedCatProps) {
  const { agent } = p;
  const wanted = p.pose ?? poseFor(agent.status, agent.activity);
  const pose = useDwell(wanted, ACTIVITY_MIN_DWELL_MS);
  const beat = beatFor(agent.role, pose);
  const leaving = useCrossfade(pose, p.live);
  const quirk = useQuirks(p.live && p.busy && (agent.status === "idle" || agent.status === "waiting") && QUIRK_POSES.has(pose), agent.look.seed, p.offscreen);
  const sameKind = leaving !== null && rigKind(leaving) === rigKind(pose);
  const leavingBeat = leaving ? beatFor(agent.role, leaving) : null;
  const react = p.react ?? null;
  const className = [
    "cat",
    "of-cat",
    p.live ? "cat--live" : null,
    p.live && p.busy ? "cat--busy" : null,
    quirk && !react ? `cat-quirk-${quirk}` : null,
    react === "catch" ? "cat-catch" : null,
    react === "celebrate" ? "cat-celebrate" : null,
    react === "nod" || react === "approve" ? "of-nod" : null,
    react === "shake" || react === "stamp-return" ? "of-shake" : null,
    react === "stamp-pass" ? "cat-react-tap" : null,
    react === "look" ? "of-look" : null,
    p.talking ? "of-talking" : null,
    p.nap ? "of-nap" : null,
    p.lift ? "of-lifted" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const s = p.size / 160;
  const style = { "--cat-phase": `${phaseMs(agent.look.seed)}ms`, "--cat-sw": String(1.5 / s), "--of-lift": `${-Math.round(p.size * 0.16)}px` } as CSSProperties;
  return (
    <g className={className} {...catAttrs(agent, { "data-activity": agent.activity, "data-pose": pose, "data-beat": beat, "data-motion": p.live ? "live" : "still" })} style={style}>
      <g className="of-lift">
      <g className="of-lean">
      <svg className="of-rig" x={p.x} y={p.y} width={p.size} height={p.size} viewBox="0 0 160 160" overflow="hidden">
        {leaving && !sameKind ? <Rig key={`o-${rigKind(leaving)}`} pose={leaving} beat={leavingBeat!} role={agent.role} clipBase={`${p.clip}-o`} live={p.live} fade="out" /> : null}
        <Rig
          key={rigKind(pose)}
          pose={pose}
          beat={beat}
          leaving={sameKind ? leavingBeat : null}
          role={agent.role}
          clipBase={p.clip}
          live={p.live}
          fade={leaving && !sameKind ? "in" : undefined}
        />
        {agent.status === "error" ? <Warning /> : null}
        {react === "catch" ? <CatchCard /> : null}
        {react === "celebrate" ? <PawPrints /> : null}
        {p.mug ? <HeldMug /> : null}
      </svg>
      </g>
      </g>
    </g>
  );
}

/** A mug between the front paws, in rig units, with two wisps of steam. */
function HeldMug() {
  return (
    <g className="of-held-mug">
      <path className="of-steam of-steam-a" d="M74 110 C 70 104 78 100 74 94" />
      <path className="of-steam of-steam-b" d="M84 110 C 80 104 88 100 84 94" />
      <path className="of-mug-handle" d="M92 120 C 100 120 100 132 92 132" />
      <rect className="of-mug" x={66} y={114} width={27} height={24} rx={4} />
      <rect className="of-coffee" x={69} y={117} width={21} height={4} rx={2} />
    </g>
  );
}

/* ---------------------------------------------------------------------
 * Carried things, in walker units (the mouth sits near 98, 48)
 * ------------------------------------------------------------------- */

/** The moving box, carried on the back: a new hire's things, or a leaver's desk with its plant peeking out. */
function BackBox({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path className="of-leaf" d="M6 -22 C 2 -30 6 -36 12 -38 C 14 -30 12 -26 6 -22 Z" />
      <path className="of-leaf-2" d="M8 -22 C 12 -28 18 -30 22 -28 C 20 -22 14 -21 8 -22 Z" />
      <rect className="of-box of-thick" x={-17} y={-22} width={34} height={24} rx={2} />
      <rect className="of-box-tape" x={-4} y={-22} width={8} height={11} />
      <rect className="of-box-label" x={6} y={-9} width={8} height={5} rx={1} />
    </g>
  );
}

function CarryArt({ carry, x, y }: { carry: Carry; x: number; y: number }) {
  if (carry === "box") return null;
  if (carry === "mug") {
    return (
      <g transform={`translate(${x} ${y})`}>
        <path className="of-mug-handle of-thin" d="M7 -2 C 12 -2 12 6 7 6" />
        <rect className="of-mug of-thin" x={-7} y={-6} width={14} height={14} rx={2.5} />
        <rect className="of-coffee" x={-5} y={-4} width={10} height={2.5} rx={1.2} />
      </g>
    );
  }
  if (carry === "stamp-pass" || carry === "stamp-return") {
    const pass = carry === "stamp-pass";
    return (
      <g transform={`translate(${x} ${y})`}>
        <circle className={pass ? "of-stamp-pass" : "of-stamp-return"} cx={0} cy={0} r={8} />
        {pass ? <path className="of-stamp-glyph" d="M-4 0.5 L-1.2 3.4 L4.2 -3.2" /> : <path className="of-stamp-glyph" d="M3.4 3.4 C 4 -2.6 -1 -4 -3.4 -1 M-3.8 -4.4 L-3.4 -1 L-0.2 -1.4" />}
      </g>
    );
  }
  const mark = carry === "card-pass" ? "pass" : carry === "card-deny" ? "deny" : null;
  return (
    <g transform={`translate(${x} ${y}) rotate(-6)`}>
      <rect className="of-card-art" x={-11} y={-8} width={22} height={16} rx={2.5} />
      <rect className="of-card-line of-card-line-strong" x={-7} y={-4} width={9} height={2.4} rx={1.2} />
      <rect className="of-card-line" x={-7} y={0} width={14} height={2.2} rx={1.1} />
      {mark ? (
        <g transform="translate(8 5)">
          <circle className={mark === "pass" ? "of-stamp-pass" : "of-stamp-return"} cx={0} cy={0} r={5.5} />
          {mark === "pass" ? <path className="of-stamp-glyph of-glyph-sm" d="M-2.6 0.3 L-0.8 2.2 L2.8 -2" /> : <path className="of-stamp-glyph of-glyph-sm" d="M-2.2 -2.2 L2.2 2.2 M2.2 -2.2 L-2.2 2.2" />}
        </g>
      ) : null}
    </g>
  );
}

/* ---------------------------------------------------------------------
 * The walker: 120 x 90 units, feet on y 86, facing right
 * ------------------------------------------------------------------- */

const W_BODY = "M28 50 C 28 38 40 34 58 34 C 76 34 90 38 92 50 C 94 62 82 66 60 66 C 40 66 28 62 28 50 Z";
const W_TAIL = "M31 48 C 20 44 14 32 18 19 C 20 13 25 11 27 14";

function Leg({ x, cls }: { x: number; cls: string }) {
  return (
    <g className={`of-leg ${cls}`}>
      <Tube d={`M${x} 54 L${x} 81`} width={9} />
      <ellipse className="c-paw" cx={x} cy={83} rx={6} ry={3.8} />
    </g>
  );
}

function SideWalker({ clip, carry }: { clip: string; carry: Carry | null }) {
  return (
    <g className="of-side">
      <g className="of-flip">
        <g className="of-tail-sway">
          <Tube d={W_TAIL} width={7} tail />
        </g>
        <Leg x={40} cls="of-leg-bf" />
        <Leg x={78} cls="of-leg-ff" />
        <g className="of-bob">
          <path className="c-fur" d={W_BODY} />
          {carry === "box" ? <BackBox x={54} y={36} /> : null}
          <ellipse className="c-light cat-chest" cx={62} cy={60} rx={20} ry={4.5} />
          <path className="c-stripe cat-stripes" d="M48 36.5 Q50 42 48 46 M58 35 Q60 41 58 45 M68 36 Q70 42 68 46" />
          <path className="c-mark cat-patches" d="M40 38 C 48 34 58 36 60 44 C 56 52 44 52 38 46 Z" />
          <path className="c-mark2 cat-patches" d="M66 52 C 72 48 82 50 84 58 C 78 64 68 62 66 52 Z" />
        </g>
        <Leg x={47} cls="of-leg-bn" />
        <Leg x={85} cls="of-leg-fn" />
        <g className="of-bob">
          <g transform="translate(49 2) scale(0.6)" style={{ "--cat-sw": "calc(var(--of-sw) * 1.667)" } as CSSProperties}>
            <Head pupils={[2.5, 0.5]} eyes="open" clipBase={`${clip}-h`} />
          </g>
          {carry ? <CarryArt carry={carry} x={101} y={50} /> : null}
        </g>
      </g>
    </g>
  );
}

const BACK_BODY = "M60 38 C 46 38 40 52 40 64 C 40 78 48 84 60 84 C 72 84 80 78 80 64 C 80 52 74 38 60 38 Z";
const BACK_HEAD = "M60 10 C 72 10 78 18 78 27 C 78 38 70 43 60 43 C 50 43 42 38 42 27 C 42 18 48 10 60 10 Z";

/** Back of the head with ears, no face, in any 120-wide box centred on x 60. */
function HeadBack({ dx = 0, dy = 0 }: { dx?: number; dy?: number }) {
  return (
    <g transform={`translate(${dx} ${dy})`}>
      <g className="cat-ear-l">
        <path className="c-ear" d="M44 24 L45 4 L57 14 Z" />
      </g>
      <g className="cat-ear-r">
        <path className="c-ear" d="M76 24 L75 4 L63 14 Z" />
      </g>
      <path className="c-fur" d={BACK_HEAD} />
      <path className="c-stripe cat-stripes" d="M55 14 L56 22 M60 12 L60 21 M65 14 L64 22" />
      <path className="c-mark cat-patches" d="M62 11 C 72 12 78 20 78 27 C 70 27 64 20 62 11 Z" />
      <path className="c-point cat-mask" d="M49 34 C 54 40 66 40 71 34 C 69 41 51 41 49 34 Z" />
    </g>
  );
}

function UpWalker({ carry }: { carry: Carry | null }) {
  return (
    <g className="of-up">
      <g className="of-tail-sway-up">
        <Tube d="M60 76 C 60 62 70 50 66 36" width={7} tail />
      </g>
      <g className="of-step-a">
        <ellipse className="c-paw" cx={52} cy={84} rx={6} ry={3.8} />
      </g>
      <g className="of-step-b">
        <ellipse className="c-paw" cx={68} cy={84} rx={6} ry={3.8} />
      </g>
      <g className="of-bob">
        <path className="c-fur" d={BACK_BODY} />
        <path className="c-stripe cat-stripes" d="M50 52 Q54 54 55 58 M70 52 Q66 54 65 58 M48 64 Q52 66 53 70 M72 64 Q68 66 67 70" />
        <path className="c-mark cat-patches" d="M62 42 C 72 44 78 52 78 60 C 70 60 64 52 62 42 Z" />
        <HeadBack dx={0} dy={0} />
        {carry === "box" ? <BackBox x={60} y={70} /> : null}
        {carry ? <CarryArt carry={carry} x={84} y={58} /> : null}
      </g>
    </g>
  );
}

function DownWalker({ clip, carry }: { clip: string; carry: Carry | null }) {
  return (
    <g className="of-down">
      <g className="of-tail-sway-up">
        <Tube d="M72 70 C 84 64 90 52 86 40" width={7} tail />
      </g>
      <g className="of-bob">
        {carry === "box" ? <BackBox x={60} y={30} /> : null}
        <path className="c-fur" d={BACK_BODY} />
        <ellipse className="c-light cat-chest" cx={60} cy={66} rx={10} ry={13} />
        <path className="c-mark2 cat-patches" d="M44 66 C 48 60 56 62 56 70 C 56 76 48 78 44 74 Z" />
      </g>
      <g className="of-step-a">
        <ellipse className="c-paw" cx={52} cy={84} rx={6} ry={3.8} />
      </g>
      <g className="of-step-b">
        <ellipse className="c-paw" cx={68} cy={84} rx={6} ry={3.8} />
      </g>
      <g className="of-bob">
        <g transform="translate(12 -3) scale(0.6)" style={{ "--cat-sw": "calc(var(--of-sw) * 1.667)" } as CSSProperties}>
          <Head pupils={[0, 2]} eyes="open" clipBase={`${clip}-d`} />
        </g>
        {carry ? <CarryArt carry={carry} x={80} y={60} /> : null}
      </g>
    </g>
  );
}

/* ---------------------------------------------------------------------
 * Sitting with its back to us: 100 x 100 units, base on y 96
 * ------------------------------------------------------------------- */

export function BackCatArt({ paw, carry }: { paw: boolean; carry: Carry | null }) {
  return (
    <g className="of-back">
      <Tube d="M64 92 C 80 95 90 88 86 76" width={7} tail />
      <path className="c-fur" d="M50 42 C 32 42 24 64 24 78 C 24 92 36 96 50 96 C 64 96 76 92 76 78 C 76 64 68 42 50 42 Z" />
      <path className="c-stripe cat-stripes" d="M36 60 Q40 62 41 66 M64 60 Q60 62 59 66 M33 74 Q38 75 39 79 M67 74 Q62 75 61 79" />
      <path className="c-mark cat-patches" d="M52 44 C 64 46 72 56 72 66 C 62 66 54 56 52 44 Z" />
      <path className="c-mark2 cat-patches" d="M28 80 C 32 72 42 74 42 84 C 40 92 30 92 28 86 Z" />
      <HeadBack dx={-10} dy={2} />
      <g className="of-paw-up" data-on={paw ? "" : undefined}>
        <Tube d="M66 56 C 72 46 76 34 76 22" width={8} />
        <ellipse className="c-paw" cx={76} cy={20} rx={5.5} ry={5} />
        {carry ? <CarryArt carry={carry} x={80} y={10} /> : null}
      </g>
    </g>
  );
}

/* ---------------------------------------------------------------------
 * The floor actor: one element per cat, always mounted, moved by the
 * director (style transform and data-face), drawn by pose
 * ------------------------------------------------------------------- */

export interface FloorActorProps {
  agent: OfficeAgent;
  view: ActorView;
  live: boolean;
  scale: number;
  floorCat: number;
  register: (el: SVGGElement | null) => void;
  offscreen: RefObject<boolean>;
}

export function FloorActor({ agent, view, live, scale, floorCat, register, offscreen }: FloorActorProps) {
  const ref = useRef<SVGGElement | null>(null);
  const react = useOneShot(view.react, live);
  const clip = sceneClip(useSceneUid(), agent.id);
  const setRef = (el: SVGGElement | null) => {
    ref.current = el;
    register(el);
  };
  // walker box 120 x 90 units drawn 72 x 54 px at scale 1: 0.6 px per unit
  const wu = 0.6 * scale;
  const walkerStyle = { "--of-sw": String(1.5 / wu), "--cat-sw": String(1.5 / wu), "--cat-phase": `${phaseMs(agent.look.seed)}ms` } as CSSProperties;
  const bu = 0.56 * scale;
  let body: ReactNode = null;
  if (view.pose === "front") {
    body = (
      <SeatedCat
        agent={{ ...agent, status: "idle", activity: "rest" }}
        x={-floorCat / 2}
        y={-floorCat * (150 / 160)}
        size={floorCat}
        live={live}
        busy={live}
        clip={`${clip}-f`}
        pose={view.beat}
        mug={view.carry === "mug"}
        offscreen={offscreen}
      />
    );
  } else if (view.pose === "back") {
    body = (
      <g className={`cat of-cat${live ? " cat--live" : ""}`} {...catAttrs(agent)} style={{ "--cat-sw": String(1.5 / bu) } as CSSProperties}>
        <svg x={-50 * bu} y={-96 * bu} width={100 * bu} height={100 * bu} viewBox="0 0 100 100" overflow="visible">
          {/* docked beside a desk on its left, the cat turns so its raised paw reaches the desk */}
          <g className="of-back-lean">
            <BackCatArt paw={view.paw} carry={view.carry} />
          </g>
        </svg>
      </g>
    );
  } else {
    body = (
      <g className={`cat of-cat${live ? " cat--live" : ""}`} {...catAttrs(agent)} style={walkerStyle}>
        <svg x={-60 * wu} y={-88 * wu} width={120 * wu} height={90 * wu} viewBox="0 0 120 90" overflow="visible">
          <g className="of-hop">
            <SideWalker clip={clip} carry={view.carry} />
            <UpWalker carry={view.carry} />
            <DownWalker clip={clip} carry={view.carry} />
          </g>
          {react === "celebrate" ? (
            <g transform="translate(-20 -60)">
              <PawPrints />
            </g>
          ) : null}
        </svg>
      </g>
    );
  }
  return (
    <g
      ref={setRef}
      className={`of-actor${react === "celebrate" ? " cat-celebrate of-celebrate" : ""}`}
      data-agent={agent.id}
      data-where={view.where}
      data-pose={view.pose}
      data-face="right"
    >
      <g key={view.moves} className="of-arrive">
        {/* ground contact: a flat ellipse one tonal step darker than the floor, solid, no blur */}
        <ellipse className="of-contact" data-pose={view.pose} cx={0} cy={-1} rx={(view.pose === "front" ? floorCat * 0.22 : view.pose === "back" ? 21 : 25) * (view.pose === "front" ? 1 : scale)} ry={4.5 * scale} />
        {body}
      </g>
    </g>
  );
}
