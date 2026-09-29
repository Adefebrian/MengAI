// Frame context: the only source of time inside a composition. Components
// read the current frame with useCurrentFrame() and derive every visual
// value from it. Nothing inside a composition may keep its own clock.
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

export interface VideoConfig {
  fps: number;
  durationInFrames: number;
  /** Authoring width in composition pixels. */
  width: number;
  /** Authoring height in composition pixels. */
  height: number;
}

export interface FrameState {
  /** Frame relative to the nearest Sequence (or the composition root). */
  frame: number;
  config: VideoConfig;
}

export const FrameContext = createContext<FrameState | null>(null);

export function validateVideoConfig(config: VideoConfig): void {
  const { fps, durationInFrames, width, height } = config;
  if (!(fps > 0) || !Number.isFinite(fps)) throw new RangeError("frames: fps must be a finite number > 0");
  if (!Number.isInteger(durationInFrames) || durationInFrames < 1) {
    throw new RangeError("frames: durationInFrames must be an integer >= 1");
  }
  if (!(width > 0) || !(height > 0)) throw new RangeError("frames: width and height must be > 0");
}

export interface FrameProviderProps {
  frame: number;
  config: VideoConfig;
  children?: ReactNode;
}

/** Low-level provider. Most code uses Composition or Player instead. */
export function FrameProvider({ frame, config, children }: FrameProviderProps) {
  validateVideoConfig(config);
  const { fps, durationInFrames, width, height } = config;
  const value = useMemo<FrameState>(
    () => ({ frame, config: { fps, durationInFrames, width, height } }),
    [frame, fps, durationInFrames, width, height],
  );
  return <FrameContext.Provider value={value}>{children}</FrameContext.Provider>;
}

export function useFrameState(caller: string): FrameState {
  const state = useContext(FrameContext);
  if (!state) {
    throw new Error(`${caller} must be used inside a FrameProvider, Composition, or Player`);
  }
  return state;
}

/** The current frame, local to the nearest Sequence. */
export function useCurrentFrame(): number {
  return useFrameState("useCurrentFrame").frame;
}

/** The composition's fps, durationInFrames, width, and height. */
export function useVideoConfig(): VideoConfig {
  return useFrameState("useVideoConfig").config;
}
