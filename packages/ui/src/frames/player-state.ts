// Pure Player decisions, kept out of the component so they are testable
// without a DOM and so the rules read in one place.
import { clampFrame } from "./clock";

export interface InitialPlaybackInput {
  reducedMotion: boolean;
  autoPlay: boolean;
  durationInFrames: number;
  /** Frame shown under reduced motion. Default: the last frame (final state). */
  posterFrame?: number;
  initialFrame?: number;
}

export interface PlaybackState {
  frame: number;
  playing: boolean;
}

/**
 * Reduced motion shows the poster frame and never autoplays. Otherwise the
 * Player starts on `initialFrame` and plays only if `autoPlay` is set.
 */
export function resolveInitialPlayback(input: InitialPlaybackInput): PlaybackState {
  const { reducedMotion, autoPlay, durationInFrames } = input;
  if (reducedMotion) {
    return { frame: posterFrameFor(durationInFrames, input.posterFrame), playing: false };
  }
  return { frame: clampFrame(input.initialFrame ?? 0, durationInFrames), playing: autoPlay };
}

export function posterFrameFor(durationInFrames: number, posterFrame?: number): number {
  return clampFrame(posterFrame ?? durationInFrames - 1, durationInFrames);
}

export interface RunInput {
  /** The viewer's intent: pressed play, or autoplay allowed. */
  playing: boolean;
  /** The Player intersects the viewport. */
  inView: boolean;
  /** document.visibilityState is not "hidden". */
  pageVisible: boolean;
}

/** The clock ticks only when wanted, on screen, and in a visible tab. */
export function shouldClockRun({ playing, inView, pageVisible }: RunInput): boolean {
  return playing && inView && pageVisible;
}

export interface ControlsInput {
  controls: boolean;
  autoPlay: boolean;
  fps: number;
  durationInFrames: number;
}

/**
 * jal-motion: anything that runs longer than 5 seconds unattended ships a
 * visible pause control, so an autoplaying piece over 5s cannot hide them.
 */
export function mustShowControls({ controls, autoPlay, fps, durationInFrames }: ControlsInput): boolean {
  if (controls) return true;
  return autoPlay && durationInFrames / fps > 5;
}

/** m:ss for a frame position. */
export function formatTime(frame: number, fps: number): string {
  const total = Math.max(0, Math.floor(frame / fps));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
