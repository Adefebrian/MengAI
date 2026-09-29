// The hero relay (JEV imm.concept c1, recipe frame.relay on the JAL frame
// clock, ui.component_recipe hero_layer_1 0.70): four living cats pass one
// task card along a lane, the review sends it back once, and it goes
// forward again to Done. The crew is the real @mengai/cats: CatCard from
// 768px (status, note, task and energy), the Cat alone in a compact station
// below that, so the lane stays inside the first screen on a phone. Every
// value is a function of the frame; each cat plays its own beat for its
// role, activity and mood, and Kopi's celebration fires from celebrateKey.
//
// Playback rules:
//   plays once, shortly after it first enters view (after the headline
//   sequence, JEV motion.choreography stagger_sequence), only with reduced
//   motion off and no Save-Data; never loops, it ends on Done and holds,
//   and the cats rest live (JEV hero_result_hold live_rest); pauses off
//   screen and in a hidden tab; Pause freezes the cats too (still poses);
//   reduced motion never autoplays and shows the poster (the card back at
//   Klepon after the bounce), and every jump swaps with a 150ms opacity
//   crossfade and no travel.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Cat, CatCard } from "@mengai/cats";
import { ACTIVITY_LABEL, ROLE_LABEL } from "@mengai/shared";
import { createFrameClock, Easing, MediaFrame, shouldClockRun, usePrefersReducedMotion, type FrameClock } from "@mengai/ui";
import { prefersSaveData, useMedia } from "../hooks";
import { ActivityIcon, CheckCircleIcon, CheckIcon, PauseIcon, PlayIcon, RestartIcon, UndoIcon } from "../icons";
import { clock } from "../replay/timemap";
import {
  RELAY_CARD,
  RELAY_FPS,
  RELAY_FRAMES,
  RELAY_GOAL,
  RELAY_POSTER_MS,
  RELAY_STAGES,
  RELAY_STATUS_LABEL,
  RELAY_SUMMARY,
  TRAVEL_MS,
  relayAt,
  relayCrew,
  relayStageAt,
  type RelayStageId,
  type RelayStatus,
} from "./lane";

const POSTER_FRAME = Math.round((RELAY_POSTER_MS / 1000) * RELAY_FPS);
/** The headline sequence runs first; the relay starts when it settles. */
const START_DELAY_MS = 900;
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const toFrame = (ms: number) => Math.round((ms / 1000) * RELAY_FPS);

function StatusIcon({ status }: { status: RelayStatus }) {
  if (status === "done") return <CheckCircleIcon size={16} color="currentColor" />;
  if (status === "passed") return <CheckIcon size={16} color="currentColor" />;
  if (status === "changes") return <UndoIcon size={16} color="currentColor" />;
  return <ActivityIcon size={16} color="currentColor" />;
}

export function relayCaption(): string {
  return "Sample run, scripted for this page: one task, four cats, one review sent back. The same crew and run as the board below.";
}

export function Relay() {
  const reduced = usePrefersReducedMotion();
  const cards = useMedia("(min-width: 768px)");
  const roomy = useMedia("(min-width: 640px)");
  const crew = useMemo(() => relayCrew(), []);

  const [autoAllowed] = useState(() => !reduced && !prefersSaveData());
  const [frame, setFrame] = useState(() => (autoAllowed ? 0 : POSTER_FRAME));
  const [playing, setPlaying] = useState(false);
  const [held, setHeld] = useState(false);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  const [pageVisible, setPageVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<FrameClock | null>(null);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const started = useRef(false);
  const interacted = useRef(false);

  useEffect(() => {
    const c = createFrameClock({
      fps: RELAY_FPS,
      durationInFrames: RELAY_FRAMES,
      loop: false,
      initialFrame: frameRef.current,
      onFrame: setFrame,
      onEnded: () => setPlaying(false),
    });
    clockRef.current = c;
    return () => {
      c.destroy();
      clockRef.current = null;
    };
  }, []);

  const run = shouldClockRun({ playing, inView, pageVisible });
  useEffect(() => {
    const c = clockRef.current;
    if (!c) return;
    if (run) c.play();
    else c.pause();
  }, [run]);

  // Reduced motion switched on mid-session: stop on the poster.
  useEffect(() => {
    if (!reduced) return;
    setPlaying(false);
    setHeld(false);
    clockRef.current?.seek(POSTER_FRAME);
  }, [reduced]);

  // First entry into view starts the run once, after the headline settles.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      setInView(entry.isIntersecting);
      if (entry.isIntersecting && !started.current && !interacted.current && autoAllowed && !reduced) {
        started.current = true;
        timer = setTimeout(() => {
          if (!interacted.current) setPlaying(true);
        }, START_DELAY_MS);
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [autoAllowed, reduced]);

  useEffect(() => {
    const onVisibility = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const crossfade = useCallback(() => {
    const el = stageRef.current;
    if (el && typeof el.animate === "function") el.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 150, easing: "linear" });
  }, []);

  const toggle = useCallback(() => {
    interacted.current = true;
    if (playing) {
      setPlaying(false);
      setHeld(true);
      return;
    }
    if (frameRef.current >= RELAY_FRAMES - 1) clockRef.current?.seek(0);
    setHeld(false);
    setPlaying(true);
  }, [playing]);

  const restart = useCallback(() => {
    interacted.current = true;
    clockRef.current?.seek(0);
    setHeld(false);
    setPlaying(true);
  }, []);

  const jump = useCallback(
    (id: RelayStageId) => {
      interacted.current = true;
      const mark = RELAY_STAGES.find((s) => s.id === id)!;
      clockRef.current?.seek(toFrame(playing ? mark.startMs : mark.stillMs));
      crossfade();
    },
    [playing, crossfade],
  );

  const ms = (frame / RELAY_FPS) * 1000;
  const m = relayAt(ms);
  const ended = frame >= RELAY_FRAMES - 1;
  // Paused by the visitor mid-run: the cats hold their still poses.
  const frozen = held && !ended;
  const travelling = m.travel < 1;
  // Motion: the card slides one station on the standard curve. Reduced
  // motion: it snaps to the receiver and fades in over 150ms.
  const pos = reduced ? (travelling ? m.to : m.pos) : m.from + (m.to - m.from) * Easing.jal(m.travel);
  const cardOpacity = reduced && travelling ? clamp01((m.travel * TRAVEL_MS) / 150) : 1;
  const slotStyle = { "--lp-relay-pos": pos.toFixed(4), opacity: cardOpacity } as CSSProperties;
  const current = relayStageAt(ms);
  const label = `Sample MengAI run, scripted for this page. ${RELAY_SUMMARY} Now: ${RELAY_STATUS_LABEL[m.status]}.`;

  return (
    <div ref={rootRef} className="lp-relay" data-state={playing ? "playing" : "paused"}>
      <MediaFrame kind="view" ratio="16/9" tone="surface" caption={relayCaption()}>
        <div ref={stageRef} className="lp-relay-stage" role="group" aria-label={label}>
          <ol className="lp-relay-crew" data-kind={cards ? "cards" : "stations"} aria-label="The crew">
            {crew.map((c, i) => {
              const beat = m.cats[i]!;
              const doing = beat.note ?? ACTIVITY_LABEL[beat.activity];
              const catLabel = `${c.name}, ${ROLE_LABEL[c.role]}, ${doing.toLowerCase()}`;
              const holding = m.holder === i && !m.done;
              if (cards) {
                return (
                  <li key={c.id} className="lp-relay-slot-card" data-holder={holding ? "" : undefined}>
                    <CatCard
                      look={c.look}
                      role={c.role}
                      status={beat.status}
                      activity={beat.activity}
                      mood={beat.mood}
                      label={catLabel}
                      size={64}
                      still={frozen}
                      celebrateKey={i === 0 ? m.celebrateKey : undefined}
                      name={c.name}
                      statusText={beat.note}
                      taskTitle={beat.task}
                      energy={m.energy[i]!}
                    />
                  </li>
                );
              }
              return (
                <li key={c.id} className="lp-station" data-holder={holding ? "" : undefined}>
                  <span className="lp-station-cat">
                    <Cat
                      look={c.look}
                      role={c.role}
                      status={beat.status}
                      activity={beat.activity}
                      mood={beat.mood}
                      label={catLabel}
                      size={roomy ? 64 : 48}
                      still={frozen}
                      celebrateKey={i === 0 ? m.celebrateKey : undefined}
                    />
                  </span>
                  <span className="lp-station-name">{c.name}</span>
                  <span className="lp-station-act">{ACTIVITY_LABEL[beat.activity]}</span>
                </li>
              );
            })}
          </ol>
          <div className="lp-relay-lane" aria-hidden="true">
            <span className="lp-relay-slot" style={slotStyle}>
              <span className="lp-relay-card" data-status={m.status}>
                <span className="lp-relay-card-state">
                  {roomy ? <StatusIcon status={m.status} /> : null}
                  <span>{RELAY_STATUS_LABEL[m.status]}</span>
                </span>
                <span className="lp-relay-card-title">{RELAY_CARD}</span>
              </span>
            </span>
          </div>
          <div className="lp-relay-run">
            <p className="lp-goal" title={RELAY_GOAL}>
              {RELAY_GOAL}
            </p>
            <p className="lp-runstatus">
              {m.done ? <CheckCircleIcon size={16} color="currentColor" /> : <ActivityIcon size={16} color="currentColor" />}
              <span>{m.done ? "Done" : "Running"}</span>
            </p>
            <p className="lp-clock kit-num" aria-label={`Run time ${clock(m.runMs)}`}>
              {clock(m.runMs)}
            </p>
            <p className="lp-relay-tokens">
              <span className="kit-num">{m.tokens.toLocaleString("en-US")}</span> tokens
            </p>
          </div>
        </div>
        <div className="lp-controls">
          <button type="button" className="jal-icon-btn" data-variant="outlined" aria-label={playing ? "Pause the replay" : "Play the replay"} onClick={toggle}>
            {playing ? <PauseIcon color="currentColor" /> : <PlayIcon color="currentColor" />}
          </button>
          <button type="button" className="jal-icon-btn" data-variant="outlined" aria-label="Replay from the start" onClick={restart}>
            <RestartIcon color="currentColor" />
          </button>
          <div className="lp-stages" role="group" aria-label="Jump to a step">
            {RELAY_STAGES.map((s) => (
              <button key={s.id} type="button" className="btn btn-secondary" aria-pressed={current === s.id} onClick={() => jump(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </MediaFrame>
    </div>
  );
}
