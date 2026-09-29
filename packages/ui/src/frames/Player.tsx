// Player: plays a frame-driven composition live in the page. Play, pause,
// a 44px scrub range, optional loop. Reduced motion shows the poster frame
// and never autoplays (the viewer may still press play or scrub). The
// clock stops when the Player leaves the viewport or the tab is hidden.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ChangeEvent, ComponentType, ReactNode } from "react";
import { createFrameClock } from "./clock";
import type { FrameClock } from "./clock";
import { Composition } from "./Composition";
import type { VideoConfig } from "./context";
import { formatTime, mustShowControls, posterFrameFor, resolveInitialPlayback, shouldClockRun } from "./player-state";

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(REDUCED_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function readReduced(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_QUERY).matches;
}

/**
 * Live prefers-reduced-motion. The server snapshot is `true`, so server
 * output is always the still poster and motion starts only after hydration.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, readReduced, () => true);
}

export interface PlayerProps<P extends object = Record<string, never>> extends VideoConfig {
  /** Accessible name for the player group, e.g. "Invoice approval demo". */
  label: string;
  component?: ComponentType<P>;
  inputProps?: P;
  children?: ReactNode;
  /** Default false. Never honored under reduced motion. */
  autoPlay?: boolean;
  /** Default false. */
  loop?: boolean;
  /**
   * Default true. Setting false is ignored when autoPlay runs past 5s,
   * because anything that long must offer a pause control.
   */
  controls?: boolean;
  /** Reduced-motion still. Default the last frame (the final, complete state). */
  posterFrame?: number;
  /** Starting frame when motion is allowed. Default 0. */
  initialFrame?: number;
  /** Icons from the koboyo or reicon source; text labels are used when omitted. */
  icons?: { play: ReactNode; pause: ReactNode };
  onEnded?: () => void;
  className?: string;
}

export function Player<P extends object = Record<string, never>>({
  label,
  fps,
  durationInFrames,
  width,
  height,
  component,
  inputProps,
  children,
  autoPlay = false,
  loop = false,
  controls = true,
  posterFrame,
  initialFrame,
  icons,
  onEnded,
  className,
}: PlayerProps<P>) {
  const reducedMotion = usePrefersReducedMotion();

  const [initial] = useState(() =>
    resolveInitialPlayback({ reducedMotion, autoPlay, durationInFrames, posterFrame, initialFrame }),
  );
  const [frame, setFrame] = useState(initial.frame);
  const [playing, setPlaying] = useState(initial.playing);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<FrameClock | null>(null);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const interacted = useRef(false);
  const resumeAfterScrub = useRef(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  // One clock per timeline shape. It starts on whatever frame is showing.
  useEffect(() => {
    const clock = createFrameClock({
      fps,
      durationInFrames,
      loop,
      initialFrame: frameRef.current,
      onFrame: setFrame,
      onEnded: () => {
        setPlaying(false);
        onEndedRef.current?.();
      },
    });
    clockRef.current = clock;
    return () => {
      clock.destroy();
      clockRef.current = null;
    };
    // loop is applied live below; recreating the clock for it would reset time.
  }, [fps, durationInFrames]);

  useEffect(() => {
    clockRef.current?.setLoop(loop);
  }, [loop]);

  const run = shouldClockRun({ playing, inView, pageVisible });
  useEffect(() => {
    const clock = clockRef.current;
    if (!clock) return;
    if (run) clock.play();
    else clock.pause();
  }, [run, fps, durationInFrames]);

  // Reduced motion switched on mid-session (or hydration resolved it off).
  const lastReduced = useRef(reducedMotion);
  useEffect(() => {
    if (lastReduced.current === reducedMotion) return;
    lastReduced.current = reducedMotion;
    if (reducedMotion) {
      setPlaying(false);
      clockRef.current?.seek(posterFrameFor(durationInFrames, posterFrame));
      return;
    }
    if (interacted.current) return;
    const next = resolveInitialPlayback({ reducedMotion: false, autoPlay, durationInFrames, posterFrame, initialFrame });
    clockRef.current?.seek(next.frame);
    setPlaying(next.playing);
  }, [reducedMotion, autoPlay, durationInFrames, posterFrame, initialFrame]);

  // Offscreen: stop the clock, keep the viewer's intent.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setInView(entry.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Hidden tab: stop the clock.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const toggle = useCallback(() => {
    interacted.current = true;
    if (playing) {
      setPlaying(false);
      return;
    }
    if (!loop && frameRef.current >= durationInFrames - 1) clockRef.current?.seek(0);
    setPlaying(true);
  }, [playing, loop, durationInFrames]);

  const onScrub = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    interacted.current = true;
    clockRef.current?.seek(Number(event.target.value));
  }, []);

  const onScrubStart = useCallback(() => {
    interacted.current = true;
    resumeAfterScrub.current = playing;
    if (playing) setPlaying(false);
  }, [playing]);

  const onScrubEnd = useCallback(() => {
    if (resumeAfterScrub.current) setPlaying(true);
    resumeAfterScrub.current = false;
  }, []);

  const showControls = mustShowControls({ controls, autoPlay, fps, durationInFrames });
  const current = formatTime(frame, fps);
  const total = formatTime(durationInFrames, fps);
  const playLabel = playing ? "Pause" : "Play";

  return (
    <div
      ref={rootRef}
      className={["frames-player", className].filter(Boolean).join(" ")}
      role="group"
      aria-label={label}
      data-state={playing ? "playing" : "paused"}
      data-reduced-motion={reducedMotion ? "true" : "false"}
    >
      <Composition<P>
        fps={fps}
        durationInFrames={durationInFrames}
        width={width}
        height={height}
        frame={frame}
        component={component}
        inputProps={inputProps}
      >
        {children}
      </Composition>
      {showControls ? (
        <div className="frames-controls">
          <button
            type="button"
            className="btn-secondary frames-toggle"
            data-icon={icons ? "true" : "false"}
            aria-label={icons ? playLabel : undefined}
            onClick={toggle}
          >
            {icons ? (playing ? icons.pause : icons.play) : playLabel}
          </button>
          <input
            type="range"
            className="frames-scrub"
            min={0}
            max={durationInFrames - 1}
            step={1}
            value={frame}
            aria-label="Seek"
            aria-valuetext={`${current} of ${total}`}
            onChange={onScrub}
            onPointerDown={onScrubStart}
            onPointerUp={onScrubEnd}
            onPointerCancel={onScrubEnd}
          />
          <span className="frames-time" aria-hidden="true">
            {current} / {total}
          </span>
        </div>
      ) : null}
    </div>
  );
}
