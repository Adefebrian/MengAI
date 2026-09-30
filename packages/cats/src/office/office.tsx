// Office: the living cat company (contract in ../office-contract.ts).
//
// One aria-hidden SVG draws the whole floor as a three-quarter cutaway
// (geometry.ts plans it for the container width): the CEO office with the
// entrance door and the plan whiteboard, the meeting room, the pantry, the
// team pods with one desk per cat, the test rack, the bookshelf and the cat
// bed. Every cat sits at its own desk and plays its real role x activity
// beat; the director (director.ts) stands cats up and walks them along the
// lanes for each story beat and meeting, walks hires in and leavers out,
// sends idle cats for coffee or a nap, blinks the rack and rings the bell:
// one light scheduler for the whole scene. The theme dresses the floor: a
// software studio, or a hedge fund trading floor (two market screens per
// desk, a ticker along the back wall, a risk committee room, traders who
// stand to execute, a bell for a target hit). Accessible parts live
// outside the art: one button per desk when the scene is selectable (the
// scene's own label describes the crew), and a polite list of beat notes,
// visible under reduced motion.
//
// JEV decisions (verified, jev-1.13.0):
//   imm.concept c4 "plan first" (core 2.67, first screen 0.68, feasible
//     0.65): the CEO's plan board is the signature, each card carries its
//     owner's coat and slides column to column as the task moves
//   ui.region_gate hero: door dropped (0.46), lounge dropped (relevance
//     0.84, the CEO desk fills the corner instead so no cell is empty),
//     ticker kept (0.57, 1.71), rack kept (0.63, 1.67)
//   motion.intensity: hire, depart, nap, bell, trader tier 2; rack,
//     ticker, plan slide tier 1 (quiet)
//   motion.choreography: hire, depart, nap, trader, bell stagger_sequence
//   ui.component_recipe: core.transition_slide whiteboard (0.96),
//     core.css_marquee ticker (0.93), core.transition_glide talk (0.76)
//   wave b (critic fixes, jev-1.13.0): ui.region_gate corridor kept as a
//     halved walk lane (0.74, relevance 2.43), narrow camera over a merged
//     row (0.99), ambient idle life built (0.73, relevance 2.13);
//     motion.intensity camera tier 1 (1.28), ambient tier 1 (1.13),
//     meeting tier 2 (1.76); motion.choreography meeting stagger_sequence
//     (0.99)
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import { ROLE_LABEL } from "@mengai/shared";
import type { OfficeAgent, OfficeProps } from "../office-contract";
import { useReducedMotion } from "../motion";
import { LYING_POSES, activityWords, coatOf, poseFor } from "../poses";
import { BackCatArt, FloorActor, SeatedCat, catAttrs, useOneShot } from "./actors";
import { ApproveStamp, BoxArt, Bubble, Chair, DeskBell, DeskBody, DeskCard, DeskExtra, DeskMug, KeyboardPaws, Monitor, Plant, VacantDesk, fundScreenFor, screenOf } from "./art";
import { AgendaBoard, Whiteboard, type Owners } from "./boards";
import { Director, type ActorView } from "./director";
import { allDesks, planOffice, type Desk, type OfficePlan } from "./geometry";
import { BackWalls, BedCell, BedRim, CeoFurniture, Floors, FrontWalls, LockerCell, MeetingTable, PantryArt, PrinterCell, RackCell, ShelfCell, Stool } from "./rooms";
import { advanceTrack, dropLeaver, isVacant, startTrack, type Track } from "./seating";
import { SceneUid, sceneClip, useSceneUid } from "./uid";

/** At most this many desk cats play their full beat loop at once (JEV motion.intensity live_cap). */
export const OFFICE_LIVE_CAP = 8;
/** A status line shows in its bubble this long after it changes. */
export const BUBBLE_MS = 4200;

function useWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth((old) => (Math.abs(old - w) >= 1 ? w : old));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function useActorView(director: Director, id: string): ActorView {
  return useSyncExternalStore(
    (cb) => director.subscribe(`actor:${id}`, cb),
    () => director.actor(id),
    () => director.actor(id),
  );
}

function useKey<T>(director: Director, key: string, get: () => T): T {
  return useSyncExternalStore((cb) => director.subscribe(key, cb), get, get);
}

/**
 * The status line for a few seconds after it changes (and on first paint, so
 * the scene opens mid-story); the last line stays mounted while it fades out.
 */
function useBubble(text: string | null): { text: string | null; on: boolean } {
  const [state, setState] = useState<{ text: string | null; on: boolean }>({ text, on: Boolean(text) });
  useEffect(() => {
    if (!text) {
      setState((s) => ({ ...s, on: false }));
      return;
    }
    setState({ text, on: true });
    const timer = setTimeout(() => setState((s) => (s.text === text ? { ...s, on: false } : s)), BUBBLE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return state;
}

/** Cats that may play their full loop: the lead, then working cats, then the rest, up to the cap. */
function loopSet(plan: OfficePlan, agents: Map<string, OfficeAgent>): Set<string> {
  const order = allDesks(plan)
    .map((d) => d.agentId)
    .filter((id) => agents.has(id));
  const rank = (id: string) => {
    const a = agents.get(id);
    return a && (a.status === "working" || a.status === "thinking") ? 0 : 1;
  };
  const sorted = [...order].sort((a, b) => (a === order[0] ? -1 : b === order[0] ? 1 : rank(a) - rank(b)));
  return new Set(sorted.slice(0, OFFICE_LIVE_CAP));
}

/** True for one exit after the cat gets up, so the seated cat fades out as the walker appears. */
function useLeaving(atDesk: boolean, live: boolean): boolean {
  const [leaving, setLeaving] = useState(false);
  const prev = useRef(atDesk);
  useEffect(() => {
    const was = prev.current;
    prev.current = atDesk;
    if (!was || atDesk || !live) {
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const timer = setTimeout(() => setLeaving(false), 210);
    return () => clearTimeout(timer);
  }, [atDesk, live]);
  return leaving && !atDesk;
}

/** The symbol each trader watches on its price screen. */
const SYMBOLS = ["PAWS", "TUNA", "MEOW", "KOPI", "YARN", "NAPS", "PURR"];

/** Buy or sell, per trader. */
function OrderTicket({ x, y, buy }: { x: number; y: number; buy: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="of-ticket">
        <rect className={buy ? "of-ticket-buy" : "of-ticket-sell"} x={-17} y={-15} width={34} height={15} rx={3} />
        <text className="of-t of-t-n2 of-medium of-ticket-word" x={0} y={-4} textAnchor="middle">
          {buy ? "Buy" : "Sell"}
        </text>
      </g>
    </g>
  );
}

interface DeskViewProps {
  desk: Desk;
  agent: OfficeAgent;
  plan: OfficePlan;
  director: Director;
  live: boolean;
  loop: boolean;
  offscreen: RefObject<boolean>;
}

function DeskView({ desk, agent, plan, director, live, loop, offscreen }: DeskViewProps) {
  const view = useActorView(director, agent.id);
  const react = useOneShot(view.react, live);
  const [stamp, setStamp] = useState<"pass" | "return" | null>(null);
  const reactN = view.react?.n ?? 0;
  useEffect(() => {
    const k = view.react?.kind;
    if (k !== "stamp-pass" && k !== "stamp-return") return;
    setStamp(k === "stamp-pass" ? "pass" : "return");
    const timer = setTimeout(() => setStamp(null), 2600);
    return () => clearTimeout(timer);
    // the reaction counter is the trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactN]);
  const bell = useKey(director, "bell", () => director.bell());
  const atDesk = view.where === "desk";
  const leaving = useLeaving(atDesk, live);
  const bubble = useBubble(agent.statusText);
  const fund = plan.theme === "fund";
  // the paw stays only for a resting cat or an empty seat: a cat with work keeps its role's screen between tool calls
  const hasWork = Boolean(agent.taskTitle || agent.file) && agent.status !== "stopped";
  const screen = screenOf(agent.activity, agent.role, hasWork, agent.file);
  const mode = screen.mode;
  const working = agent.status === "working" || agent.status === "thinking";
  const clip = sceneClip(useSceneUid(), agent.id);
  const label = screen.title;
  const animate = live && loop && atDesk && working;
  const dim = !atDesk || agent.status === "stopped";
  // the fund's trader stands to execute an order (automate); a run is a backtest at the desk
  const executing = fund && atDesk && working && agent.activity === "automate";
  const typing = atDesk && working && (agent.activity === "code" || agent.activity === "run" || agent.activity === "automate" || agent.activity === "design");
  const packed = view.packed || view.where === "out";
  const m = desk.monitor;
  const half = (m.w - 4) / 2;
  const seed = agent.look.seed;
  const approving = react === "approve";
  const dozing = view.dozing && atDesk;
  const lying = dozing || LYING_POSES.has(poseFor(agent.status, agent.activity));
  return (
    <g className="of-desk" data-agent={agent.id} data-away={atDesk ? undefined : ""}>
      <Chair r={desk.chair} />
      {fund ? (
        <g>
          <rect className="of-stand" x={m.x + m.w / 2 - 3} y={m.y + m.h * 0.5} width={6} height={m.h * 0.5 + 9} />
          <rect className="of-stand-base" x={m.x + m.w / 2 - 15} y={m.y + m.h + 7} width={30} height={4} rx={2} />
          {/* the market screen never sleeps; the work screen stays on (dimmed, still) while the trader steps away */}
          <Monitor r={{ x: m.x, y: m.y, w: half, h: m.h }} mode={packed ? "idle" : "chart"} label={SYMBOLS[seed % SYMBOLS.length]!} animate={animate || (live && loop && atDesk)} dim={dim} clip={`${clip}-m1`} seed={seed} stand={false} />
          <Monitor r={{ x: m.x + half + 4, y: m.y, w: half, h: m.h }} mode={atDesk || (hasWork && !packed) ? fundScreenFor(agent.activity, agent.role, hasWork) : "idle"} label={screenOf(agent.activity, agent.role, hasWork, agent.file, true).title} animate={animate} dim={dim} clip={`${clip}-m2`} seed={seed + 7} note={!packed} stand={false} />
        </g>
      ) : (
        // a cat that steps away leaves its work on screen (dimmed, still); the paw is for a resting cat or a packed desk
        <Monitor r={m} mode={atDesk || (hasWork && !packed) ? mode : "idle"} label={label} animate={animate && mode !== "idle"} dim={dim} clip={`${clip}-m`} seed={seed} note={!packed} />
      )}
      {(atDesk || leaving) && !lying ? (
        <g key={atDesk ? view.moves : "leaving"} className={atDesk ? "of-sit-in" : "of-sit-out"}>
          <SeatedCat agent={agent} x={desk.rig.x} y={desk.rig.y} size={desk.cat} live={live} busy={loop && atDesk} clip={clip} react={react} lift={executing} offscreen={offscreen} />
        </g>
      ) : null}
      <DeskBody desk={desk} />
      {atDesk && !lying ? <KeyboardPaws desk={desk} agent={agent} typing={typing && live && loop} /> : null}
      {(atDesk || leaving) && lying ? (
        // done or stopped: curled up on the desk top, as cats do
        <g key={atDesk ? `lie-${view.moves}-${dozing ? "z" : ""}` : "leaving"} className={atDesk ? "of-sit-in" : "of-sit-out"}>
          <SeatedCat agent={dozing ? { ...agent, status: "stopped", activity: "rest" } : agent} nap={dozing} x={desk.rig.x + desk.cat * 0.04} y={desk.top + (desk.face - desk.top) * 0.55 - desk.cat * (148 / 160)} size={desk.cat} live={live} busy={loop && atDesk} clip={clip} react={react} offscreen={offscreen} />
          {dozing ? <Zs x={desk.rig.x + desk.cat * 0.62} y={desk.top - desk.cat * 0.3} /> : null}
        </g>
      ) : null}
      {packed ? null : (
        <>
          {view.mug || !desk.plant ? <DeskMug x={desk.mug.x} y={desk.mug.y} fresh={live && view.mug} tone={seed} /> : null}
          {desk.plant && view.unpack ? <BoxArt x={desk.plant.x - 6} y={desk.plant.y + 2} w={24} open /> : null}
          {desk.plant && !view.unpack ? fund && desk.lead ? <DeskBell x={desk.plant.x - 2} y={desk.plant.y} ring={bell} /> : <Plant x={desk.plant.x} y={desk.plant.y} seed={seed} /> : null}
          {desk.extra ? <DeskExtra x={desk.extra.x} y={desk.extra.y} seed={seed} /> : null}
        </>
      )}
      {executing ? <OrderTicket x={m.x + half + 4 + half / 2} y={m.y + m.h - 5} buy={seed % 2 === 0} /> : null}
      {approving ? <ApproveStamp x={desk.keyboard.x + desk.keyboard.w + 18} y={desk.face - 2} n={view.react?.n ?? 0} /> : null}
      <DeskCard desk={desk} plan={plan} name={agent.name} role={ROLE_LABEL[agent.role]} status={agent.status} task={agent.taskTitle} stamp={stamp} />
      {bubble.text ? <Bubble key={bubble.text} text={bubble.text} lane={desk.bubble} anchor={desk.rig.x + desk.cat / 2} plan={plan} on={bubble.on && atDesk} /> : null}
    </g>
  );
}

function FloorActorView({ agent, director, live, plan, offscreen }: { agent: OfficeAgent; director: Director; live: boolean; plan: OfficePlan; offscreen: RefObject<boolean> }) {
  const view = useActorView(director, agent.id);
  const register = useMemo(() => (el: SVGGElement | null) => director.register(agent.id, el), [director, agent.id]);
  // the depth slot: the director orders the slots by the cats' feet and sets each one's depth clip
  return (
    <g className="of-slot" data-slot="">
      <FloorActor agent={agent} view={view} live={live} scale={plan.m.walker} floorCat={plan.m.floorCat} register={register} offscreen={offscreen} />
    </g>
  );
}

/**
 * The depth clips: band b (a cat in front of the first b furniture rows)
 * cuts the blocks of every row further forward out of the cat, so a cat
 * whose feet are above a desk's front edge goes behind the desk.
 */
function DepthClips({ plan, uid }: { plan: OfficePlan; uid: string }) {
  const o = plan.occluders;
  const outer = `M-400 -400 H${plan.width + 400} V${plan.height + 400} H-400 Z`;
  return (
    <defs>
      {o.map((_, b) => {
        const holes = o
          .slice(b)
          .flatMap((row) => row.rects)
          .map((r) => `M${r.x} ${r.y} h${r.w} v${r.h} h${-r.w} Z`)
          .join(" ");
        return (
          <clipPath key={b} id={`${uid}-depth-${b}`} clipPathUnits="userSpaceOnUse">
            <path d={`${outer} ${holes}`} clipRule="evenodd" />
          </clipPath>
        );
      })}
    </defs>
  );
}

/** How long the narrow camera holds a room before it moves again, and before it rests back on the plan board. */
export const CAMERA_HOLD_MS = 2400;
export const CAMERA_REST_MS = 4000;
/** The camera's pan, matching office.css (--dur-600). */
export const CAMERA_PAN_MS = 600;

/**
 * The narrow floor's camera: the window's top edge in world pixels. It rests
 * on the CEO office and the plan board (the signature), moves to the room
 * where the current beat plays when that room is outside the middle of the
 * window, holds a room a little before it moves again, and rests back on
 * the board a while after the story goes quiet. JEV motion.intensity
 * camera tier 1: one short eased translate per move, none under reduced
 * motion (the move is instant).
 */
function useCamera(director: Director, plan: OfficePlan): { y: number; moving: boolean } {
  const cam = plan.camera;
  const focus = useKey(director, "camera", () => director.cameraFocus());
  const [state, setState] = useState<{ y: number; moving: boolean }>({ y: 0, moving: false });
  const lastMove = useRef(0);
  const current = useRef(0);
  useEffect(() => {
    if (!cam) {
      current.current = 0;
      setState({ y: 0, moving: false });
      return;
    }
    const h = cam.h;
    const maxY = Math.max(0, plan.height - h);
    const y0 = Math.min(current.current, maxY);
    let target = y0;
    if (focus === null) target = 0;
    else if (focus < y0 + h * 0.15 || focus > y0 + h * 0.85) {
      target = Math.max(0, Math.min(maxY, Math.round(focus - h * 0.45)));
      // close to the top: the resting frame shows it with the plan board
      if (target < h * 0.2 && focus < h * 0.8) target = 0;
    }
    if (Math.abs(target - y0) < 1) {
      if (y0 !== current.current) {
        current.current = y0;
        setState({ y: y0, moving: false });
      }
      return;
    }
    const since = Date.now() - lastMove.current;
    const wait = focus === null ? CAMERA_REST_MS : Math.max(0, CAMERA_HOLD_MS - since);
    let settle: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      lastMove.current = Date.now();
      current.current = target;
      setState({ y: target, moving: true });
      settle = setTimeout(() => setState((s) => ({ ...s, moving: false })), director.isLive() ? CAMERA_PAN_MS + 80 : 0);
    }, director.isLive() ? wait : 0);
    return () => {
      clearTimeout(timer);
      if (settle) clearTimeout(settle);
    };
  }, [focus, cam, plan.height, director]);
  return cam ? state : { y: 0, moving: false };
}

/** Three z's rising over a sleeping cat. */
function Zs({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {[0, 1, 2].map((i) => (
        <path key={i} className="of-z" style={{ ["--of-i" as string]: String(i) } as CSSProperties} d={`M${i * 5} ${-i * 7} h5 l-5 6 h5`} />
      ))}
    </g>
  );
}

/** A cat curled up asleep in the cat bed, a few z's rising. */
function NapSlot({ agent, director, plan, live, offscreen }: { agent: OfficeAgent; director: Director; plan: OfficePlan; live: boolean; offscreen: RefObject<boolean> }) {
  const view = useActorView(director, agent.id);
  const uid = useSceneUid();
  const nap = plan.nap;
  if (view.where !== "nap" || !nap) return null;
  const size = Math.round(Math.min(nap.bed.w * 1.15, plan.m.floorCat));
  const b = nap.bed;
  return (
    <g key={view.moves} className="of-sit-in">
      <SeatedCat agent={{ ...agent, status: "stopped", activity: "rest" }} x={b.x + b.w / 2 - size * 0.5} y={b.y + b.h * 0.72 - size * (146 / 160)} size={size} live={live} busy={live} clip={`${sceneClip(uid, agent.id)}-nap`} nap offscreen={offscreen} />
      <BedRim bed={b} />
      <Zs x={b.x + b.w * 0.72} y={b.y - 6} />
    </g>
  );
}

function SeatedAttendee({ id, agent, director, plan, live, speaker, offscreen }: { id: string; agent: OfficeAgent; director: Director; plan: OfficePlan; live: boolean; speaker: boolean; offscreen: RefObject<boolean> }) {
  const view = useActorView(director, id);
  const uid = useSceneUid();
  const room = plan.meeting;
  if (view.where !== "seat" || !room) return null;
  const seat = room.seats[view.seat];
  const size = plan.m.floorCat;
  if (seat && seat.side === "far") {
    return (
      <g key={view.moves} className="of-sit-in">
        <SeatedCat
          agent={{ ...agent, status: "idle", activity: "rest" }}
          x={seat.p.x - size / 2}
          y={room.table.y + 8 - size * (126 / 160)}
          size={size}
          live={live}
          busy={live}
          clip={`${sceneClip(uid, id)}-mt`}
          pose={view.seat % 4 === 2 && !speaker ? "think" : "rest"}
          talking={speaker && live}
          offscreen={offscreen}
        />
      </g>
    );
  }
  const p = seat ? seat.p : room.stands[view.seat - room.seats.length]?.p;
  if (!p) return null;
  const bu = 0.56 * plan.m.walker;
  return (
    <g key={view.moves} className={`cat of-cat of-sit-in${live ? " cat--live" : ""}`} {...catAttrs(agent)} style={{ "--cat-sw": String(1.5 / bu) } as CSSProperties}>
      <Stool x={p.x} y={p.y} w={(seat ? 44 : 40) * plan.m.walker} />
      <svg x={p.x - 50 * bu} y={p.y - 96 * bu} width={100 * bu} height={100 * bu} viewBox="0 0 100 100" overflow="visible">
        <BackCatArt paw={false} carry={null} />
      </svg>
    </g>
  );
}

function TalkMark() {
  return (
    <g className="of-talk">
      <path className="of-bubble-box" d="M-15 -18 L15 -18 Q20 -18 20 -13 L20 -5 Q20 0 15 0 L4 0 L0 5 L-4 0 L-15 0 Q-20 0 -20 -5 L-20 -13 Q-20 -18 -15 -18 Z" />
      <rect className="of-talk-line of-talk-1" x={-12} y={-11} width={6} height={4} rx={2} />
      <rect className="of-talk-line of-talk-2" x={-3} y={-11} width={6} height={4} rx={2} />
      <rect className="of-talk-line of-talk-3" x={6} y={-11} width={6} height={4} rx={2} />
    </g>
  );
}

/** The talk mark glides from one speaker to the next. */
function Talk({ at }: { at: { x: number; y: number } | null }) {
  if (!at) return null;
  return (
    <g className="of-talk-glide" style={{ transform: `translate(${at.x}px, ${at.y}px)` } as CSSProperties}>
      <TalkMark />
    </g>
  );
}

function MeetingView({ plan, director, agents, meetings, live, offscreen, freeTitle }: { plan: OfficePlan; director: Director; agents: Map<string, OfficeAgent>; meetings: OfficeProps["meetings"]; live: boolean; offscreen: RefObject<boolean>; freeTitle: string }) {
  const view = useKey(director, "meeting", () => director.meetingView());
  const room = plan.meeting;
  // the hero huddles in front of the board, whose agenda carries the meeting: no talk mark there, it would sit over the lead's plate
  if (!room) return null;
  const source = meetings.find((m) => m.id === view.id) ?? null;
  const occupied = new Map<number, string>();
  for (const id of view.seated) {
    const v = director.actor(id);
    if (v.where === "seat") occupied.set(v.seat, id);
  }
  const speakerSeat = view.speaker ? director.actor(view.speaker).seat : -1;
  const farSeats = room.seats.map((s, i) => ({ s, i })).filter(({ s }) => s.side === "far");
  const size = plan.m.floorCat;
  const chairW = Math.round(size * 0.62);
  let talk: { x: number; y: number } | null = null;
  if (view.speaker && speakerSeat >= 0) {
    const seat = room.seats[speakerSeat];
    if (seat?.side === "far") talk = { x: seat.p.x + size * 0.36, y: room.table.y + 8 - size * (126 / 160) + size * 0.1 };
    else if (seat) talk = { x: seat.p.x + 26 * plan.m.walker, y: seat.p.y - 58 * plan.m.walker };
    else {
      const p = room.stands[speakerSeat - room.seats.length]?.p;
      if (p) talk = { x: p.x + 26 * plan.m.walker, y: p.y - 58 * plan.m.walker };
    }
  }
  return (
    <g className="of-meeting" data-running={view.running ? "" : undefined}>
      <AgendaBoard r={room.agenda} meeting={source} running={view.running} title={view.title} agenda={view.agenda} notes={view.notes} discussed={view.discussed} freeTitle={freeTitle} />
      {farSeats.map(({ s }, k) => (
        <Chair key={k} r={{ x: s.p.x - chairW / 2, y: room.table.y - size * 0.46, w: chairW, h: size * 0.46 }} />
      ))}
      {farSeats.map(({ i }) => {
        const id = occupied.get(i);
        const a = id ? agents.get(id) : undefined;
        return id && a ? <SeatedAttendee key={id} id={id} agent={a} director={director} plan={plan} live={live} speaker={view.speaker === id} offscreen={offscreen} /> : null;
      })}
      <MeetingTable r={room.table} />
      {/* empty stools stay tucked in at the table, off the row the crew walks along; a cat pulls its stool out to sit */}
      {room.seats.map((s, i) => (s.side === "near" && !occupied.has(i) ? <Stool key={`st${i}`} x={s.p.x} y={room.table.y + room.table.h + 9} w={40 * plan.m.walker} /> : null))}
      {view.seated.map((id) => {
        const v = director.actor(id);
        const seat = room.seats[v.seat];
        if (seat && seat.side === "far") return null;
        const a = agents.get(id);
        return a ? <SeatedAttendee key={id} id={id} agent={a} director={director} plan={plan} live={live} speaker={view.speaker === id} offscreen={offscreen} /> : null;
      })}
      <Talk at={talk} />
    </g>
  );
}

function CeoBoard({ plan, director, cards, meetings, owners }: { plan: OfficePlan; director: Director; cards: NonNullable<OfficeProps["plan"]>; meetings: OfficeProps["meetings"]; owners: Owners }) {
  const flash = useKey(director, "board", () => director.boardFlash());
  const meeting = useKey(director, "meeting", () => director.meetingView());
  const fund = plan.theme === "fund";
  // no meeting room (the hero): the board shows the agenda while the crew huddles
  if (!plan.meeting && meeting.running) {
    const source = meetings.find((m) => m.id === meeting.id) ?? null;
    return <AgendaBoard r={plan.ceo.whiteboard} meeting={source} running title={meeting.title} agenda={meeting.agenda} notes={meeting.notes} discussed={meeting.discussed} freeTitle={fund ? "Risk committee" : "Meeting"} />;
  }
  return <Whiteboard r={plan.ceo.whiteboard} cards={cards} flash={flash} owners={owners} title={fund ? "Book plan" : "Plan"} />;
}

function Walls({ plan, director }: { plan: OfficePlan; director: Director }) {
  const day = useKey(director, "day", () => director.daypart());
  const open = useKey(director, "door", () => director.doorOpen());
  const hour = useKey(director, "clock", () => Math.floor(director.hourNow()));
  return <BackWalls plan={plan} day={day} doorOpen={open} hour={hour} />;
}

function FloorsView({ plan, director }: { plan: OfficePlan; director: Director }) {
  const day = useKey(director, "day", () => director.daypart());
  return <Floors plan={plan} day={day} />;
}

function Pantry({ plan, director }: { plan: OfficePlan; director: Director }) {
  const brewing = useKey(director, "brew", () => director.brewing());
  return <PantryArt plan={plan} brewing={brewing} />;
}

function Cells({ plan, director }: { plan: OfficePlan; director: Director }) {
  const rack = useKey(director, "rack", () => director.rackView());
  return (
    <g className="of-cells">
      {plan.cells.map((c, i) => {
        if (c.kind === "rack") return <RackCell key={i} cell={c} plan={plan} mode={rack.mode} />;
        if (c.kind === "shelf") return <ShelfCell key={i} cell={c} seed={i} />;
        if (c.kind === "printer") return <PrinterCell key={i} cell={c} />;
        if (c.kind === "lockers") return <LockerCell key={i} cell={c} />;
        if (c.kind === "bed") return <BedCell key={i} cell={c} bed={plan.nap && plan.nap.bed.x >= c.rect.x && plan.nap.bed.x < c.rect.x + c.rect.w && plan.nap.bed.y >= c.rect.y ? plan.nap.bed : null} />;
        return null;
      })}
    </g>
  );
}

/** The newest beat, spoken politely; a sentence in a 1px box inside the stage's own layer. */
function LiveNote({ director }: { director: Director }) {
  const notes = useKey(director, "notes", () => director.noteList());
  return (
    <p className="office-live" aria-live="polite">
      {notes[0]?.text ?? ""}
    </p>
  );
}

/** Under reduced motion or still: the latest beats written out under the scene. */
function Notes({ director, variant }: { director: Director; variant: "full" | "hero" }) {
  const notes = useKey(director, "notes", () => director.noteList());
  const shown = notes.slice(0, variant === "hero" ? 2 : 4);
  if (!shown.length) return null;
  return (
    <ol className="office-notes" aria-label="What just happened">
      {shown.map((n) => (
        <li key={n.id} className="office-note">
          {n.text}
        </li>
      ))}
    </ol>
  );
}

function deskLabel(agent: OfficeAgent): string {
  const parts = [agent.name, ROLE_LABEL[agent.role], activityWords(agent.activity).toLowerCase()];
  if (agent.taskTitle) parts.push(agent.taskTitle);
  return parts.join(", ");
}

/**
 * What the scene takes beyond the frozen contract: the story clock. A page
 * that plays a scripted day passes its hour (0 to 24), so the windows show a
 * flat day sky with the sun until 18:00, dusk, then night only in overtime;
 * without it the windows follow the local hour.
 */
export interface OfficeClock {
  hour?: number | null;
}

export function Office(props: OfficeProps & OfficeClock) {
  return <OfficeScene {...props} />;
}

/** The Office with one internal hook: the preview story reaches the director through onDirector. */
export function OfficeScene(props: OfficeProps & OfficeClock & { onDirector?: (director: Director) => void }) {
  const { agents, meetings, beats, onBeatDone, plan: cards = [], selectedId, onSelect, variant = "full", theme = "studio", still = false, label, onDirector, hour = null } = props;
  const reduced = useReducedMotion();
  const live = !still && !reduced;
  const host = useRef<HTMLDivElement | null>(null);
  const uid = `of${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const width = useWidth(host, variant === "hero" ? 560 : 1280);

  // who sits where: desks kept as the crew changes, hires walk in, leavers walk out
  const [track, setTrack] = useState<Track>(() => startTrack(agents));
  let seating = track;
  if (seating.agents !== agents) {
    seating = advanceTrack(seating, agents);
    setTrack(seating);
  }
  const layoutKey = seating.planAgents.map((a) => `${a.id}:${a.role}:${a.parentId ?? ""}`).join("|");
  // the plan depends only on who sits where, not on what the crew is doing
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planOffice(seating.planAgents, width, variant, { theme, keepOrder: true }), [layoutKey, width, variant, theme]);
  // the hero keeps at most three rows; crew past them is left out of the scene
  const shown = useMemo(() => (plan.hidden.length ? seating.present.filter((a) => !plan.hidden.includes(a.id)) : seating.present), [seating.present, plan]);
  const [director] = useState(() => new Director());
  director.onBeatDone = onBeatDone;
  director.clipBase = uid;
  director.onGone = (id) => setTrack((t) => dropLeaver(t, id));
  const byId = useMemo(() => new Map(shown.map((a) => [a.id, a])), [shown]);
  const owners = useMemo<Owners>(() => new Map(seating.present.map((a) => [a.id, { coat: coatOf(a.look.coat, a.look.seed) }])), [seating.present]);
  const offscreen = useRef(false);

  useEffect(() => {
    director.attach();
    onDirector?.(director);
    return () => director.detach();
    // onDirector is read once per director
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [director]);
  useEffect(() => director.setLive(live), [director, live]);
  const leaving = useMemo(() => [...seating.leavers.keys()].filter((id) => byId.has(id)), [seating.leavers, byId]);
  const arriving = useMemo(() => seating.arriving.filter((id) => byId.has(id)), [seating.arriving, byId]);
  useEffect(() => director.setScene(shown, plan, { arriving, leaving }), [director, shown, plan, arriving, leaving]);
  useEffect(() => director.setMeetings(meetings), [director, meetings]);
  useEffect(() => director.setHour(hour), [director, hour]);
  useEffect(() => director.setBeats(beats), [director, beats]);

  // off screen or in a hidden tab: the clock, the walks and every CSS loop hold still
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let intersecting = true;
    const apply = () => {
      const off = !intersecting || document.visibilityState === "hidden";
      offscreen.current = off;
      if (off) {
        el.setAttribute("data-offscreen", "");
        director.pause();
      } else {
        el.removeAttribute("data-offscreen");
        director.resume();
      }
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            for (const e of entries) intersecting = e.isIntersecting;
            apply();
          });
    observer?.observe(el);
    document.addEventListener("visibilitychange", apply);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", apply);
    };
  }, [director]);

  const loops = loopSet(plan, byId);
  const desks = allDesks(plan);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const freeTitle = theme === "fund" ? "Risk committee" : "Meeting room";
  // the narrow floor is seen through the camera window: the world moves, the stage keeps its box
  const camera = useCamera(director, plan);
  const viewH = plan.camera ? plan.camera.h : plan.height;
  const inView = (y: number, h: number) => y >= camera.y - 0.5 && y + h <= camera.y + viewH + 0.5;

  return (
    <div className="office" ref={host} data-variant={variant} data-theme-office={theme} data-motion={live ? "live" : "still"} data-camera={plan.camera ? "" : undefined}>
      <div className="office-stage" style={{ aspectRatio: `${plan.width} / ${viewH}` }} role="group" aria-label={label}>
        <SceneUid.Provider value={uid}>
        <svg className="office-art" viewBox={`0 0 ${plan.width} ${viewH}`} aria-hidden="true" focusable="false">
          <g className="of-camera" style={plan.camera ? ({ transform: `translateY(${-camera.y}px)` } as CSSProperties) : undefined}>
          <DepthClips plan={plan} uid={uid} />
          <FloorsView plan={plan} director={director} />
          <Walls plan={plan} director={director} />
          <CeoBoard plan={plan} director={director} cards={cards} meetings={meetings} owners={owners} />
          <CeoFurniture plan={plan} />
          <Pantry plan={plan} director={director} />
          <Cells plan={plan} director={director} />
          <g className="of-naps">
            {shown.map((a) => (
              <NapSlot key={a.id} agent={a} director={director} plan={plan} live={live} offscreen={offscreen} />
            ))}
          </g>
          <MeetingView plan={plan} director={director} agents={byId} meetings={meetings} live={live} offscreen={offscreen} freeTitle={freeTitle} />
          {desks.map((d) => {
            if (isVacant(d.agentId)) return <VacantDesk key={d.agentId} desk={d} plan={plan} />;
            const a = byId.get(d.agentId);
            return a ? <DeskView key={d.agentId} desk={d} agent={a} plan={plan} director={director} live={live} loop={loops.has(d.agentId)} offscreen={offscreen} /> : null;
          })}
          <FrontWalls plan={plan} />
          <g className="of-floor-actors">
            {shown.map((a) => (
              <FloorActorView key={a.id} agent={a} director={director} live={live} plan={plan} offscreen={offscreen} />
            ))}
          </g>
          </g>
        </svg>
        </SceneUid.Provider>
        <div className="office-hits" data-moving={camera.moving ? "" : undefined}>
          <LiveNote director={director} />
          {onSelect
            ? desks.map((d) => {
                const a = byId.get(d.agentId);
                const r = d.rect;
                // through the camera, only the desks inside the window are buttons, so nothing sits outside the stage
                if (!a || !inView(r.y, r.h)) return null;
                return (
                  <button
                    key={d.agentId}
                    type="button"
                    className="office-hit"
                    data-selected={selectedId === d.agentId ? "" : undefined}
                    aria-pressed={selectedId === undefined ? undefined : selectedId === d.agentId}
                    aria-label={deskLabel(a)}
                    style={{ left: pct(r.x, plan.width), top: pct(r.y - camera.y, viewH), width: pct(r.w, plan.width), height: pct(r.h, viewH) }}
                    onClick={() => onSelect(d.agentId)}
                  />
                );
              })
            : null}
        </div>
      </div>
      {live ? null : <Notes director={director} variant={variant} />}
    </div>
  );
}
