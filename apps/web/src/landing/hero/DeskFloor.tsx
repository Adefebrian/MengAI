// DeskFloor: the landing's own rendition of the office, used until the
// Office scene from @mengai/cats ships (another workstream builds it
// against office-contract.ts). It takes the same OfficeProps, so the hero
// swaps to the real scene with no other change.
//
// A flat plan of the floor on the 12px frame: the CEO office with Kopi and
// the plan on the whiteboard, the meeting room, five crew desks and the
// pantry. Every cat sits at its own desk with its live Cat beat; a cat in a
// meeting or on a break moves to that room, and the work it carries (a
// handoff, a question, an answer) travels desk to desk as a card. Moves are
// shared-layout transforms (motion layoutId), instant under reduced motion
// or `still`; nothing rests on top of anything else.
import { useEffect, useMemo, useState } from "react";
import { LayoutGroup, MotionConfig, motion } from "motion/react";
import { Cat, type OfficeAgent, type OfficeBeat, type OfficeProps } from "@mengai/cats";
import { ROLE_LABEL } from "@mengai/shared";
import { ChairIcon, CheckIcon, CoffeeIcon, UsersIcon } from "../icons";

const MOVE = { duration: 0.9, ease: [0.24, 1, 0.4, 1] as const };
/** A beat card waits this long at its origin before it travels. */
const PICKUP_MS = 500;
/** Total time a beat holds the floor, travel included. */
const BEAT_MS: Record<OfficeBeat["kind"], number> = {
  handoff: 2_000,
  ask: 2_000,
  decided: 2_000,
  deliver: 2_000,
  review: 1_600,
  celebrate: 1_200,
};

const STATUS_WORD = { todo: "To do", doing: "Doing", review: "In review", done: "Done" } as const;

type Place = { kind: "desk"; id: string } | { kind: "ceo" } | { kind: "meet" } | { kind: "pantry" };

interface Travel {
  beat: OfficeBeat;
  from: Place;
  to: Place;
  text: string;
  tone: "task" | "note" | "approved" | "passed";
}

function travelOf(beat: OfficeBeat, leadId: string | undefined): Travel | null {
  const at = (id: string): Place => (id === leadId ? { kind: "ceo" } : { kind: "desk", id });
  switch (beat.kind) {
    case "handoff":
      return { beat, from: at(beat.fromId), to: at(beat.toId), text: beat.taskTitle, tone: "task" };
    case "ask":
      return { beat, from: at(beat.fromId), to: at(beat.toId), text: beat.question, tone: "note" };
    case "decided":
      return { beat, from: at(beat.byId), to: at(beat.toId), text: beat.approved ? "Approved" : "Not now", tone: "approved" };
    case "deliver":
      return { beat, from: at(beat.fromId), to: { kind: "ceo" }, text: beat.taskTitle, tone: "task" };
    case "review":
      return { beat, from: at(beat.reviewerId), to: at(beat.reviewerId), text: beat.passed ? "Passed" : "Sent back", tone: "passed" };
    default:
      return null;
  }
}

const samePlace = (a: Place, b: Place) => a.kind === b.kind && (a.kind !== "desk" || (b.kind === "desk" && a.id === b.id));

/** Plays the first beat in the queue: pick up, travel, report done. */
function useBeat(beats: OfficeBeat[], still: boolean, onBeatDone?: (id: string) => void) {
  const current = beats[0] ?? null;
  const [phase, setPhase] = useState<{ id: string | null; moved: boolean }>({ id: null, moved: false });
  const id = current?.id ?? null;
  const moved = phase.id === id ? phase.moved : still;
  useEffect(() => {
    if (!id || !current) return;
    setPhase({ id, moved: still });
    const kind = current.kind;
    const pick = still ? null : setTimeout(() => setPhase({ id, moved: true }), PICKUP_MS);
    const end = setTimeout(() => onBeatDone?.(id), still ? 600 : BEAT_MS[kind]);
    return () => {
      if (pick) clearTimeout(pick);
      clearTimeout(end);
    };
    // current is keyed by id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, still, onBeatDone]);
  return { current, moved };
}

/** A card or a cat in flight is a true overlay layer above the floor
 *  (data-overlay) until it lands in its room. */
function useFlight() {
  const [flying, setFlying] = useState(false);
  return {
    "data-overlay": flying ? "" : undefined,
    onLayoutAnimationStart: () => setFlying(true),
    onLayoutAnimationComplete: () => setFlying(false),
  };
}

function Chip({ travel }: { travel: Travel }) {
  const flight = useFlight();
  return (
    <motion.span {...flight} layoutId={`beat-${travel.beat.id}`} transition={MOVE} className="lp-floor-chip" data-tone={travel.tone} title={travel.text}>
      {travel.tone === "approved" || travel.tone === "passed" ? <CheckIcon size={16} color="currentColor" /> : null}
      <span className="lp-floor-chip-text">{travel.text}</span>
    </motion.span>
  );
}

function Seat({ agent, still, celebrate, size = 48 }: { agent: OfficeAgent; still: boolean; celebrate: number; size?: 48 | 64 }) {
  const flight = useFlight();
  return (
    <motion.span {...flight} layoutId={`cat-${agent.id}`} transition={MOVE} className="lp-floor-seat">
      <Cat
        look={agent.look}
        role={agent.role}
        status={agent.status}
        activity={agent.activity}
        mood={agent.mood}
        label={`${agent.name}, ${ROLE_LABEL[agent.role]}, ${agent.statusText ?? agent.activity}`}
        size={size}
        still={still}
        celebrateKey={celebrate}
      />
    </motion.span>
  );
}

function EmptyChair() {
  return (
    <span className="lp-floor-chair" aria-hidden="true">
      <ChairIcon size={24} color="currentColor" />
    </span>
  );
}

export function DeskFloor({ agents, meetings, beats, onBeatDone, plan = [], still = false, label }: OfficeProps) {
  const lead = agents.find((a) => a.role === "lead");
  const crew = agents.filter((a) => a !== lead).slice(0, 5);
  const meeting = meetings.find((m) => m.endedAt === null) ?? null;
  const lastMeeting = meetings.filter((m) => m.endedAt !== null).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0] ?? null;
  const inMeeting = new Set(meeting?.agentIds ?? []);
  const onBreak = new Set(crew.filter((a) => !inMeeting.has(a.id) && a.status === "idle").map((a) => a.id));
  const { current, moved } = useBeat(beats, still, onBeatDone);
  const travel = useMemo(() => (current ? travelOf(current, lead?.id) : null), [current, lead?.id]);
  const [cheer, setCheer] = useState(0);
  useEffect(() => {
    if (current?.kind === "celebrate") setCheer((n) => n + 1);
  }, [current]);

  const chipAt = (place: Place) => {
    if (!travel) return null;
    const where = moved ? travel.to : travel.from;
    return samePlace(where, place) ? <Chip key={travel.beat.id} travel={travel} /> : null;
  };

  const desk = (a: OfficeAgent, i: number) => {
    const away = inMeeting.has(a.id) ? "At the sync" : onBreak.has(a.id) ? "On a coffee break" : null;
    const chip = chipAt({ kind: "desk", id: a.id });
    return (
      <li key={a.id} className="lp-floor-room lp-floor-desk" style={{ gridArea: `d${i + 1}` }} data-away={away ? "" : undefined}>
        <div className="lp-floor-who">
          {away ? <EmptyChair /> : <Seat agent={a} still={still} celebrate={cheer} />}
          <span className="lp-floor-name">
            <span className="lp-floor-strong">{a.name}</span>
            <span className="lp-floor-muted">{ROLE_LABEL[a.role]}</span>
          </span>
        </div>
        <p className="lp-floor-line" title={away ?? a.statusText ?? undefined}>
          {away ?? a.statusText ?? "At the desk"}
        </p>
        <p className="lp-floor-file" title={a.file ?? undefined}>
          {away ? "Desk is free" : (a.file ?? "No file open")}
        </p>
        <div className="lp-floor-slot">{chip ?? (a.taskTitle && !away ? <span className="lp-floor-task" title={a.taskTitle}>{a.taskTitle}</span> : null)}</div>
      </li>
    );
  };

  return (
    <MotionConfig reducedMotion={still ? "always" : "user"}>
      <LayoutGroup id="lp-floor">
        <div className="lp-floor" role="group" aria-label={label}>
          <ul className="lp-floor-plan" aria-hidden="true">
            <li className="lp-floor-room lp-floor-ceo" style={{ gridArea: "ceo" }}>
              <div className="lp-floor-who">
                {lead && !inMeeting.has(lead.id) ? <Seat agent={lead} still={still} celebrate={cheer} /> : <EmptyChair />}
                <span className="lp-floor-name">
                  <span className="lp-floor-strong">{lead?.name ?? "Kopi"}</span>
                  <span className="lp-floor-muted">CEO</span>
                </span>
              </div>
              <ol className="lp-floor-board" aria-label="Plan">
                {plan.map((p) => (
                  <li key={p.id} data-status={p.status}>
                    <span className="lp-floor-clip" title={p.title}>
                      {p.title}
                    </span>
                    <span className="lp-floor-status">{STATUS_WORD[p.status]}</span>
                  </li>
                ))}
              </ol>
              <div className="lp-floor-slot">{chipAt({ kind: "ceo" }) ?? <span className="lp-floor-muted lp-floor-clip">{lead?.statusText ?? "Watching the plan."}</span>}</div>
            </li>
            <li className="lp-floor-room lp-floor-meet" style={{ gridArea: "meet" }} data-live={meeting ? "" : undefined}>
              <p className="lp-floor-roomname">
                <UsersIcon size={16} color="currentColor" />
                <span className="lp-floor-clip">{meeting ? meeting.title : "Meeting room"}</span>
              </p>
              {meeting ? (
                <div className="lp-floor-table">
                  {agents.filter((a) => inMeeting.has(a.id)).map((a) => (
                    <Seat key={a.id} agent={a} still={still} celebrate={cheer} />
                  ))}
                </div>
              ) : (
                <ul className="lp-floor-notes">
                  {(lastMeeting?.notes ?? []).slice(0, 2).map((n) => (
                    <li key={n} className="lp-floor-clip" title={n}>
                      {n}
                    </li>
                  ))}
                </ul>
              )}
              <p className="lp-floor-muted lp-floor-clip lp-floor-foot">
                {meeting ? `${meeting.agentIds.length} at the table` : lastMeeting ? `${lastMeeting.title} notes` : "Free"}
              </p>
            </li>
            {crew.map(desk)}
            <li className="lp-floor-room lp-floor-pantry" style={{ gridArea: "pantry" }}>
              <p className="lp-floor-roomname">
                <CoffeeIcon size={16} color="currentColor" />
                <span>Pantry</span>
              </p>
              <div className="lp-floor-table">
                {onBreak.size ? (
                  crew.filter((a) => onBreak.has(a.id)).map((a) => <Seat key={a.id} agent={a} still={still} celebrate={cheer} />)
                ) : (
                  <span className="lp-floor-chair" aria-hidden="true">
                    <CoffeeIcon size={24} color="currentColor" />
                  </span>
                )}
              </div>
              <p className="lp-floor-muted lp-floor-clip lp-floor-foot">{onBreak.size ? "Coffee break" : "Coffee is on"}</p>
            </li>
          </ul>
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}
