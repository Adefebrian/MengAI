// Office: the living cat company (contract in ../office-contract.ts).
//
// One aria-hidden SVG draws the whole floor (geometry.ts plans it for the
// container width): the CEO office with the plan whiteboard, the team pods
// with one desk per cat, the meeting room, the pantry nook. Every cat sits
// at its own desk and plays its real role x activity beat; the director
// (director.ts) stands cats up and walks them along the lanes for each story
// beat and meeting, one light scheduler for the whole scene. Accessible
// parts live outside the art: one button per desk when the scene is
// selectable (the scene's own label describes the crew), and a polite list
// of beat notes, visible under reduced motion.
//
// JEV decisions (verified): imm.concept d1 always-on working floor (core
// 2.1, first screen 0.66, feasible 0.81); ui.density default (0.57, low
// confidence, top pick kept); motion.intensity desk work, bubble and
// whiteboard tier 1, every walking beat tier 2, celebrate clamped to 2;
// live_cap cap_12 at 0.22 (low confidence: the calmer cap_8 taken);
// ui.component_recipe core.walk_waapi, mu.R10 monitors, core.bubble_crossfade,
// core.crossfade_columns whiteboard, core.bubble_hop talk, core.list notes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import { ROLE_LABEL } from "@mengai/shared";
import type { OfficeAgent, OfficeProps } from "../office-contract";
import { useReducedMotion } from "../motion";
import { activityWords } from "../poses";
import { BackCatArt, FloorActor, SeatedCat, catAttrs, useOneShot } from "./actors";
import { AgendaBoard, Bubble, Chair, DeskBody, DeskCard, DeskMug, MeetingTable, Monitor, PantryArt, Plant, Stool, Structure, Whiteboard, screenFor, screenLabel } from "./art";
import { Director, type ActorView } from "./director";
import { allDesks, planOffice, type Desk, type OfficePlan } from "./geometry";
import { baseName } from "./text";

/** At most this many desk cats play their full beat loop at once (JEV motion.intensity live_cap, see header). */
export const OFFICE_LIVE_CAP = 8;
/** A status line shows in its bubble this long after it changes. */
export const BUBBLE_MS = 4200;

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "");
}

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
  const order = allDesks(plan).map((d) => d.agentId);
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
  const atDesk = view.where === "desk";
  const leaving = useLeaving(atDesk, live);
  const bubble = useBubble(agent.statusText);
  const mode = screenFor(agent.activity, agent.role);
  const working = agent.status === "working" || agent.status === "thinking";
  const clip = `of-${safeId(agent.id)}`;
  const label = baseName(agent.file) ?? screenLabel(mode);
  return (
    <g className="of-desk" data-agent={agent.id} data-away={atDesk ? undefined : ""}>
      <Chair r={desk.chair} />
      <Monitor r={desk.monitor} mode={atDesk ? mode : "idle"} label={label} animate={live && loop && atDesk && working && mode !== "idle"} dim={!atDesk || agent.status === "stopped"} clip={`${clip}-m`} seed={agent.look.seed} />
      {atDesk || leaving ? (
        <g key={atDesk ? view.moves : "leaving"} className={atDesk ? "of-sit-in" : "of-sit-out"}>
          <SeatedCat agent={agent} x={desk.rig.x} y={desk.rig.y} size={desk.cat} live={live} busy={loop && atDesk} clip={clip} react={react} offscreen={offscreen} />
        </g>
      ) : null}
      <DeskBody desk={desk} />
      {desk.item ? view.mug ? <DeskMug x={desk.item.x} y={desk.item.y} fresh={live} /> : <Plant x={desk.item.x} y={desk.item.y} seed={agent.look.seed} /> : null}
      <DeskCard desk={desk} plan={plan} name={agent.name} role={ROLE_LABEL[agent.role]} status={agent.status} task={agent.taskTitle} stamp={stamp} />
      {bubble.text ? <Bubble key={bubble.text} text={bubble.text} lane={desk.bubble} anchor={desk.rig.x + desk.cat / 2} plan={plan} on={bubble.on && atDesk} /> : null}
    </g>
  );
}

function FloorActorView({ agent, director, live, plan, offscreen }: { agent: OfficeAgent; director: Director; live: boolean; plan: OfficePlan; offscreen: RefObject<boolean> }) {
  const view = useActorView(director, agent.id);
  const register = useMemo(() => (el: SVGGElement | null) => director.register(agent.id, el), [director, agent.id]);
  return <FloorActor agent={agent} view={view} live={live} scale={plan.m.walker} floorCat={plan.m.floorCat} register={register} offscreen={offscreen} />;
}

function SeatedAttendee({ id, agent, director, plan, live, speaker, offscreen }: { id: string; agent: OfficeAgent; director: Director; plan: OfficePlan; live: boolean; speaker: boolean; offscreen: RefObject<boolean> }) {
  const view = useActorView(director, id);
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
          y={room.table.y + 10 - size * (150 / 160)}
          size={size}
          live={live}
          busy={live}
          clip={`of-${safeId(id)}-mt`}
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
      {seat ? <Stool x={p.x} y={p.y} w={40 * plan.m.walker} /> : null}
      <svg x={p.x - 50 * bu} y={p.y - 96 * bu} width={100 * bu} height={100 * bu} viewBox="0 0 100 100" overflow="visible">
        <BackCatArt paw={false} carry={null} />
      </svg>
    </g>
  );
}

function TalkMark({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="of-talk">
      <path className="of-bubble-box" d="M-15 -18 L15 -18 Q20 -18 20 -13 L20 -5 Q20 0 15 0 L4 0 L0 5 L-4 0 L-15 0 Q-20 0 -20 -5 L-20 -13 Q-20 -18 -15 -18 Z" />
      <rect className="of-talk-line of-talk-1" x={-12} y={-12} width={7} height={3} rx={1.5} />
      <rect className="of-talk-line of-talk-2" x={-3.5} y={-12} width={7} height={3} rx={1.5} />
      <rect className="of-talk-line of-talk-3" x={5} y={-12} width={7} height={3} rx={1.5} />
      </g>
    </g>
  );
}

function MeetingView({ plan, director, agents, meetings, live, offscreen }: { plan: OfficePlan; director: Director; agents: Map<string, OfficeAgent>; meetings: OfficeProps["meetings"]; live: boolean; offscreen: RefObject<boolean> }) {
  const view = useKey(director, "meeting", () => director.meetingView());
  const room = plan.meeting;
  if (!room) {
    // the hero huddles in front of the easel: only the talk mark is drawn here
    const p = view.speaker ? director.position(view.speaker) : null;
    const bu = 0.56 * plan.m.walker;
    return p ? <TalkMark key={view.speaker} x={p.x + 16 * plan.m.walker} y={p.y - 96 * bu - 2} /> : null;
  }
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
    if (seat?.side === "far") talk = { x: seat.p.x + size * 0.42, y: room.table.y - size * 0.62 };
    else if (seat) talk = { x: seat.p.x + 30 * plan.m.walker, y: seat.p.y - 52 * plan.m.walker };
  }
  return (
    <g className="of-meeting" data-running={view.running ? "" : undefined}>
      <AgendaBoard r={room.agenda} meeting={source} running={view.running} title={view.title} agenda={view.agenda} notes={view.notes} />
      {farSeats.map(({ s }, k) => (
        <Chair key={k} r={{ x: s.p.x - chairW / 2, y: room.table.y - size * 0.52, w: chairW, h: size * 0.52 }} />
      ))}
      {farSeats.map(({ i }) => {
        const id = occupied.get(i);
        const a = id ? agents.get(id) : undefined;
        return id && a ? <SeatedAttendee key={id} id={id} agent={a} director={director} plan={plan} live={live} speaker={view.speaker === id} offscreen={offscreen} /> : null;
      })}
      <MeetingTable r={room.table} />
      {view.seated.map((id) => {
        const v = director.actor(id);
        const seat = room.seats[v.seat];
        if (seat && seat.side === "far") return null;
        const a = agents.get(id);
        return a ? <SeatedAttendee key={id} id={id} agent={a} director={director} plan={plan} live={live} speaker={view.speaker === id} offscreen={offscreen} /> : null;
      })}
      {talk ? <TalkMark key={view.speaker} x={talk.x} y={talk.y} /> : null}
    </g>
  );
}

function CeoBoard({ plan, director, cards, meetings }: { plan: OfficePlan; director: Director; cards: NonNullable<OfficeProps["plan"]>; meetings: OfficeProps["meetings"] }) {
  const flash = useKey(director, "board", () => director.boardFlash());
  const meeting = useKey(director, "meeting", () => director.meetingView());
  // no meeting room (the hero): the easel shows the agenda while the crew huddles
  if (!plan.meeting && meeting.running) {
    const source = meetings.find((m) => m.id === meeting.id) ?? null;
    return <AgendaBoard r={plan.ceo.whiteboard} meeting={source} running title={meeting.title} agenda={meeting.agenda} notes={meeting.notes} />;
  }
  return <Whiteboard r={plan.ceo.whiteboard} cards={cards} flash={flash} />;
}

function Pantry({ plan, director }: { plan: OfficePlan; director: Director }) {
  const brewing = useKey(director, "brew", () => director.brewing());
  return <PantryArt plan={plan} brewing={brewing} />;
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

export function Office(props: OfficeProps) {
  return <OfficeScene {...props} />;
}

/** The Office with one internal hook: the preview story reaches the director through onDirector. */
export function OfficeScene(props: OfficeProps & { onDirector?: (director: Director) => void }) {
  const { agents, meetings, beats, onBeatDone, plan: cards = [], selectedId, onSelect, variant = "full", still = false, label, onDirector } = props;
  const reduced = useReducedMotion();
  const live = !still && !reduced;
  const host = useRef<HTMLDivElement | null>(null);
  const width = useWidth(host, variant === "hero" ? 560 : 1280);
  const layoutKey = agents.map((a) => `${a.id}:${a.role}:${a.parentId ?? ""}`).join("|");
  // the plan depends only on who sits where, not on what the crew is doing
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planOffice(agents, width, variant), [layoutKey, width, variant]);
  // the hero keeps at most three rows; crew past them is left out of the scene
  const shown = useMemo(() => (plan.hidden.length ? agents.filter((a) => !plan.hidden.includes(a.id)) : agents), [agents, plan]);
  const [director] = useState(() => new Director());
  director.onBeatDone = onBeatDone;
  const byId = useMemo(() => new Map(shown.map((a) => [a.id, a])), [shown]);
  const offscreen = useRef(false);

  useEffect(() => {
    director.attach();
    onDirector?.(director);
    return () => director.detach();
    // onDirector is read once per director
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [director]);
  useEffect(() => director.setLive(live), [director, live]);
  useEffect(() => director.setAgents(shown), [director, shown]);
  useEffect(() => director.setPlan(plan), [director, plan]);
  useEffect(() => director.setMeetings(meetings), [director, meetings]);
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

  return (
    <div className="office" ref={host} data-variant={variant} data-motion={live ? "live" : "still"}>
      <div className="office-stage" style={{ aspectRatio: `${plan.width} / ${plan.height}` }} role="group" aria-label={label}>
        <svg className="office-art" viewBox={`0 0 ${plan.width} ${plan.height}`} aria-hidden="true" focusable="false">
          <Structure plan={plan} />
          <CeoBoard plan={plan} director={director} cards={cards} meetings={meetings} />
          <Pantry plan={plan} director={director} />
          <MeetingView plan={plan} director={director} agents={byId} meetings={meetings} live={live} offscreen={offscreen} />
          {desks.map((d) => {
            const a = byId.get(d.agentId);
            return a ? <DeskView key={d.agentId} desk={d} agent={a} plan={plan} director={director} live={live} loop={loops.has(d.agentId)} offscreen={offscreen} /> : null;
          })}
          <g className="of-floor-actors">
            {shown.map((a) => (
              <FloorActorView key={a.id} agent={a} director={director} live={live} plan={plan} offscreen={offscreen} />
            ))}
          </g>
        </svg>
        <div className="office-hits">
          <LiveNote director={director} />
          {onSelect
            ? desks.map((d) => {
              const a = byId.get(d.agentId);
              if (!a) return null;
              const r = d.rect;
              return (
                <button
                  key={d.agentId}
                  type="button"
                  className="office-hit"
                  data-selected={selectedId === d.agentId ? "" : undefined}
                  aria-pressed={selectedId === undefined ? undefined : selectedId === d.agentId}
                  aria-label={deskLabel(a)}
                  style={{ left: pct(r.x, plan.width), top: pct(r.y, plan.height), width: pct(r.w, plan.width), height: pct(r.h, plan.height) }}
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
