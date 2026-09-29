// The board replay (recipe frame.demo on the JAL frame core, JEV
// ui.component_recipe board_layer_1 0.80). It owns one frame clock
// (createFrameClock) and hands the frame to the stage through
// FrameProvider, so the rows, the timeline and the handoff card are a
// function of the frame; the cats play their own live beats meanwhile.
//
// Playback rules:
//   plays once when it first enters view, from the Build stage, only with
//   reduced motion off and no Save-Data; never loops, so it ends on its
//   final frame and stops, the cats resting live; pauses off screen and in
//   a hidden tab; Pause freezes the cats in their still poses; reduced
//   motion never autoplays and shows the Build stage still; the stage jumps
//   swap stills with an opacity crossfade of 150ms (--dur-150), no travel.
//
// Controls sit in the frame under the stage, behind one hairline: Pause or
// Play and Restart as 44px icon buttons with names, the four stage
// segments (a select below 640, where the segments would ellipsize); the
// caption sits under the frame (MediaFrame caption), on the grid.
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { createFrameClock, FrameProvider, MediaFrame, shouldClockRun, usePrefersReducedMotion, type FrameClock } from "@mengai/ui";
import { useMedia, prefersSaveData } from "../hooks";
import { PauseIcon, PlayIcon, RestartIcon } from "../icons";
import { SAMPLE_RUN, type ReplayFixture, type StageId } from "./fixture";
import { Stage } from "./Stage";
import { clock, durationFrames, FPS, frameToMs, stageAtMs, stageStartFrame, speedup, stillFrame } from "./timemap";

const POSTER_STAGE: StageId = "build";

export interface ReplayProps {
  fixture?: ReplayFixture;
  /** Where autoplay starts. The board starts at Build, so the first frame a
   *  visitor sees is the whole crew at work; Restart always goes to 0. */
  startStage?: StageId;
}

export function replayCaption(f: ReplayFixture): string {
  const runTime = clock(f.endedAt - f.startedAt);
  if (f.scripted) {
    return `Sample run, scripted for this page: ${f.goal}. ${runTime} of run time, played about ${speedup(f)} times faster.`;
  }
  return `Replay of a recorded run: ${f.goal}. Times and token counts as recorded, played about ${speedup(f)} times faster.`;
}

export function replayLabel(f: ReplayFixture): string {
  return f.scripted ? "Sample MengAI run, scripted for this page" : "Replay of a recorded MengAI run";
}

export function Replay({ fixture = SAMPLE_RUN, startStage = "plan" }: ReplayProps) {
  const reduced = usePrefersReducedMotion();
  const wide = useMedia("(min-width: 1024px)");
  const duration = durationFrames(fixture);
  const poster = stillFrame(fixture, POSTER_STAGE);

  const [autoAllowed] = useState(() => !reduced && !prefersSaveData());
  const [frame, setFrame] = useState(() => (autoAllowed ? stageStartFrame(fixture, startStage) : poster));
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
      fps: FPS,
      durationInFrames: duration,
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
  }, [duration]);

  const run = shouldClockRun({ playing, inView, pageVisible });
  useEffect(() => {
    const c = clockRef.current;
    if (!c) return;
    if (run) c.play();
    else c.pause();
  }, [run]);

  // Reduced motion switched on mid-session: stop and show the still.
  useEffect(() => {
    if (!reduced) return;
    setPlaying(false);
    setHeld(false);
    clockRef.current?.seek(poster);
  }, [reduced, poster]);

  // In view: play once on first entry; off screen: the clock stops.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      setInView(entry.isIntersecting);
      if (entry.isIntersecting && !started.current && !interacted.current && autoAllowed && !reduced) {
        started.current = true;
        setPlaying(true);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [autoAllowed, reduced]);

  useEffect(() => {
    const onVisibility = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const swap = useCallback(() => {
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
    if (frameRef.current >= duration - 1) clockRef.current?.seek(0);
    setHeld(false);
    setPlaying(true);
  }, [playing, duration]);

  const restart = useCallback(() => {
    interacted.current = true;
    clockRef.current?.seek(0);
    setHeld(false);
    setPlaying(true);
  }, []);

  const jump = useCallback(
    (id: StageId) => {
      interacted.current = true;
      clockRef.current?.seek(playing ? stageStartFrame(fixture, id) : stillFrame(fixture, id));
      swap();
    },
    [playing, fixture, swap],
  );

  const onSelect = useCallback((e: ChangeEvent<HTMLSelectElement>) => jump(e.target.value as StageId), [jump]);

  const current = stageAtMs(fixture.stages, frameToMs(frame)).id;
  const label = replayLabel(fixture);

  return (
    <div ref={rootRef} className="lp-replay" data-state={playing ? "playing" : "paused"}>
      <MediaFrame kind="view" ratio="3/2" tone="surface" caption={replayCaption(fixture)}>
        <div ref={stageRef} className="lp-stage-wrap">
          <FrameProvider frame={frame} config={{ fps: FPS, durationInFrames: duration, width: 720, height: 480 }}>
            <Stage fixture={fixture} catSize={wide ? 64 : 48} reduced={reduced} label={label} still={held && frame < duration - 1} />
          </FrameProvider>
        </div>
        <div className="lp-controls">
        <button type="button" className="jal-icon-btn" data-variant="outlined" aria-label={playing ? "Pause the board replay" : "Play the board replay"} onClick={toggle}>
          {playing ? <PauseIcon color="currentColor" /> : <PlayIcon color="currentColor" />}
        </button>
        <button type="button" className="jal-icon-btn" data-variant="outlined" aria-label="Restart the board replay" onClick={restart}>
          <RestartIcon color="currentColor" />
        </button>
        <div className="lp-stages" role="group" aria-label="Replay stage">
          {fixture.stages.map((s) => (
            <button key={s.id} type="button" className="btn btn-secondary" aria-pressed={current === s.id} onClick={() => jump(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <select className="lp-stage-select" aria-label="Replay stage" value={current} onChange={onSelect}>
          {fixture.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        </div>
      </MediaFrame>
    </div>
  );
}

/** One stage of the sample run as a still (the loop section's frames). */
export function ReplayStill({ fixture = SAMPLE_RUN, stage }: { fixture?: ReplayFixture; stage: StageId }) {
  const wide = useMedia("(min-width: 1024px)");
  const frame = stillFrame(fixture, stage);
  const mark = fixture.stages.find((s) => s.id === stage);
  return (
    <FrameProvider frame={frame} config={{ fps: FPS, durationInFrames: durationFrames(fixture), width: 720, height: 480 }}>
      <Stage fixture={fixture} catSize={wide ? 64 : 48} reduced still label={`Sample run at the ${mark?.label ?? stage} stage`} />
    </FrameProvider>
  );
}
