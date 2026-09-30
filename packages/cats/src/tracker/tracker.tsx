// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// DeliveryTracker: the on-demand tracker of a run, like following an order
// in a delivery app (contract in ../tracker-contract.ts).
//
// Two parts, one root (a size container, so it adapts to its box, not the
// window):
//   driver   the courier's card: the cat (the Cat rig, 64 px, from 640 px
//            of room), the stop it is at with "6 of 7", a Round 2 tag while
//            a check has sent the work back, the estimate, and the cat-voice
//            status line (a polite live region; it also carries status-now,
//            the class hosts use to find the line that says what is
//            happening). Tapping a stop shows that stop's own line here
//            instead, with Back to live beside it.
//   route    a flat road with one stop per stage: a white pin with the
//            stage pictogram, a pass stamp once done, a return stamp on the
//            stop that sent the work back; the road behind the courier is
//            ink. The courier cat rides a small flat scooter on the stop the
//            run is at, bobbing while the run is live over a quiet ring on
//            the road; a stage change drives it there, a move back turns it
//            round first (a U-turn), and the arrival at the last stop parks
//            the scooter, sets the parcel down and pops paw prints, once.
// Below 640 px of room (or `compact`) the route is a full-width strip over
// the driver's two lines and the stop names hide (the stop the courier is
// at names itself in the driver line); from 640 the driver is a card over
// the route with the names under the pins; from 1152 they sit side by side.
//
// Selection: a stop is a button; the selected stop gets a tonal fill that
// slides from stop to stop. `selected` makes it controlled; without it the
// tracker keeps its own. Selecting the stop the courier is at (or Back to
// live, or Escape) is live again, so a controlled parent only stores an
// index.
//
// Motion (JEV, verified jev-1.13.0): motion.intensity tier 1 (1.59, cap 1),
// idle loop yes (0.52), drive dur_400 (dur_600_per_leg 0.43 at confidence
// 0.14, the calmer runner-up), arrival yes (0.76); ui.component_recipe
// cats.courier_ride (0.98) with mu.R39 live pulse (0.68), mu.R36 road fill
// (0.74) and mu.R13 sliding selection (0.64); stamps core.badge_static
// (0.82, no pop); status core.status_text (fade-through 0.43 at low
// confidence, the JAL Core runner-up); arrival cats.celebrate_prints (0.87).
// Every move is a transform or opacity in tracker.css. Reduced motion and
// `still` render the courier at its stop with instant moves and no loop.
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { DeliveryTrackerProps } from "../tracker-contract";
import { CatFigure } from "../cat";
import { useOffscreen, useReducedMotion } from "../motion";
import { CourierArt, StopPin, pictogramFor } from "./art";
import { ARRIVE_MS, DRIVE_MS, STATE_WORD, TURN_MS, clampIndex, roadShare, roundTag, stopLine, stopStates } from "./model";
import "./tracker.css";

type Dir = "fwd" | "back";

interface Drive {
  dir: Dir;
  /** the stop the courier is leaving */
  from: number;
  /** counts up per move, so a timer only clears its own move */
  n: number;
}

/**
 * The courier's heading and the move in progress, from the stops it has
 * been shown at. Derived during render (not in an effect), so the new stop,
 * the heading and the stop being left land in one commit and every CSS
 * transition starts with its own delay.
 */
function useDrive(cur: number, live: boolean): Drive | null {
  const [seen, setSeen] = useState<{ cur: number; drive: Drive | null; n: number }>({ cur, drive: null, n: 0 });
  let state = seen;
  if (seen.cur !== cur) {
    const n = seen.n + 1;
    state = { cur, n, drive: live ? { dir: cur < seen.cur ? "back" : "fwd", from: seen.cur, n } : null };
    setSeen(state);
  }
  const drive = state.drive;
  useEffect(() => {
    if (!drive) return;
    // a move back turns first, drives, then turns round again to face forward
    const timer = setTimeout(() => setSeen((s) => (s.drive && s.drive.n === drive.n ? { ...s, drive: null } : s)), drive.dir === "back" ? TURN_MS + DRIVE_MS : DRIVE_MS);
    return () => clearTimeout(timer);
  }, [drive]);
  return live ? drive : null;
}

/** The stop the run turned back at, while the loop is open; a guess of the next stop when it mounted mid-loop. */
function useReturnedFrom(cur: number, looping: boolean): number | null {
  const high = useRef(cur);
  const from = useRef<number | null>(null);
  if (cur < high.current) from.current = high.current;
  if (cur >= high.current) high.current = cur;
  if (from.current !== null && cur >= from.current) from.current = null;
  if (!looping) return null;
  return from.current ?? cur + 1;
}

/** Counts up for ARRIVE_MS after `done` turns true while mounted and live; never on mount. Derived in render, like useDrive. */
function useArrival(done: boolean, live: boolean): boolean {
  const [seen, setSeen] = useState({ done, n: 0, playing: false });
  let state = seen;
  if (seen.done !== done) {
    state = { done, n: seen.n + 1, playing: done && live };
    setSeen(state);
  }
  const { playing, n } = state;
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setSeen((s) => (s.n === n ? { ...s, playing: false } : s)), ARRIVE_MS);
    return () => clearTimeout(timer);
  }, [playing, n]);
  return live && playing;
}

export function DeliveryTracker(props: DeliveryTrackerProps) {
  const { stages, courier, status, eta = null, done, looping = false, loops = 0, compact = false, still = false } = props;
  const n = stages.length;
  const cur = clampIndex(props.current, n);
  const reduced = useReducedMotion();
  const live = !still && !reduced;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const offscreen = useOffscreen(rootRef, live);
  const drive = useDrive(cur, live);
  const arriving = useArrival(done, live);
  const returnedFrom = useReturnedFrom(cur, looping && !done);
  const states = stopStates(n, cur, done, returnedFrom);
  const clipBase = "tk" + useId().replace(/[^A-Za-z0-9_-]/g, "");

  const [own, setOwn] = useState<number | null>(null);
  const controlled = props.selected !== undefined;
  const raw = controlled ? props.selected : own;
  const picked = raw === null || raw === undefined ? null : clampIndex(raw, n);
  const focus = picked !== null && picked !== cur ? picked : null;

  const select = (i: number) => {
    const next = i === focus ? cur : i;
    if (!controlled) setOwn(next === cur ? null : next);
    props.onStageSelect?.(next);
  };
  const toLive = () => {
    if (!controlled) setOwn(null);
    props.onStageSelect?.(cur);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && focus !== null) {
      e.stopPropagation();
      toLive();
    }
  };

  if (n === 0) return null;
  const shown = focus ?? cur;
  const stage = stages[shown]!;
  const tag = focus === null ? roundTag(loops, done) : null;
  const line = focus === null ? status : stopLine(stage, states[shown]!, courier.name);
  const idle = live && !done && offscreen.onscreen;

  const routeStyle = {
    "--tk-n": String(n),
    "--tk-at": String(cur),
    "--tk-fill": String(roadShare(cur, n)),
    "--tk-sel": String(focus ?? cur),
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className="tracker"
      data-compact={compact ? "" : undefined}
      data-motion={live ? "live" : "still"}
      data-idle={idle ? "" : undefined}
      data-dir={drive?.dir === "back" ? "back" : undefined}
      data-drive={drive ? "" : undefined}
      data-done={done ? "" : undefined}
      data-arrive={arriving ? "" : undefined}
      data-selecting={focus !== null ? "" : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="tracker-body">
        <div className="tracker-driver">
          <span className="tracker-avatar">
            <CatFigure
              look={courier.look}
              role="lead"
              status={done ? "done" : "idle"}
              activity={done ? "celebrate" : "rest"}
              mood={done ? "proud" : "calm"}
              label={`${courier.name}, the courier`}
              size={64}
              still={still}
              caption={false}
            />
          </span>
          <div className="tracker-words">
            <p className="tracker-stage">
              <span className="tracker-stage-label" title={stage.label}>
                {stage.label}
              </span>
              <span className="tracker-step">
                <span className="tk-num">{shown + 1}</span> of <span className="tk-num">{n}</span>
              </span>
              {focus !== null ? <span className="tracker-state" data-state={states[shown]}>{STATE_WORD[states[shown]!]}</span> : null}
              {tag ? (
                <span className="tracker-round">
                  <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true" focusable="false">
                    <path d="M9 7.5 L5 11.5 L9 15.5 M5.5 11.5 H14 A5 5 0 0 1 14 21.5 H11" vectorEffect="non-scaling-stroke" />
                  </svg>
                  {tag}
                </span>
              ) : null}
              {focus === null && eta ? <span className="tracker-eta">{eta}</span> : null}
            </p>
            <p className="tracker-now status-now" aria-live="polite" title={line}>
              {line}
            </p>
          </div>
          {focus !== null ? (
            <button type="button" className="btn btn-secondary tracker-live" onClick={toLive}>
              Back to live
            </button>
          ) : null}
        </div>

        <div className="tracker-route" style={routeStyle}>
          <span className="tracker-pick" aria-hidden="true" />
          <span className="tracker-road" aria-hidden="true">
            <span className="tracker-road-fill" />
          </span>
          <ol className="tracker-stops" aria-label={`${n} stops, at stop ${cur + 1}`}>
            {stages.map((s, i) => {
              const state = states[i]!;
              return (
                <li
                  key={s.id}
                  className="tracker-item"
                  data-state={state}
                  data-leaving={drive?.from === i ? "" : undefined}
                  aria-current={i === cur ? "step" : undefined}
                >
                  <button
                    type="button"
                    className="tracker-stop"
                    aria-pressed={i === cur ? undefined : focus === i}
                    aria-label={`${s.label}, stop ${i + 1} of ${n}, ${STATE_WORD[state]}`}
                    onClick={() => select(i)}
                  >
                    <span className="tracker-pin">
                      <StopPin glyph={pictogramFor(s.id)} state={state} />
                    </span>
                    <span className="tracker-label" title={s.label}>
                      {s.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <span className="tracker-courier-track" aria-hidden="true">
            <span className="tracker-courier">
              <CourierArt coat={courier.look.coat} seed={courier.look.seed} clipBase={clipBase} happy={done} live={live} />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
