// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// JAL frame core: frame-driven compositions played live in the browser.
// Remotion's model (a picture is a pure function of the frame), rebuilt
// natively with zero dependencies. Never install Remotion.
// Reference: skills/jal-immersive/references/frames.md
export { FrameProvider, useCurrentFrame, useVideoConfig, validateVideoConfig } from "./context";
export type { FrameProviderProps, VideoConfig } from "./context";
export { Composition, fitScale } from "./Composition";
export type { CompositionProps } from "./Composition";
export { Sequence, Series, sequenceFrame, seriesOffsets } from "./Sequence";
export type { SequenceProps, SeriesItem, SeriesProps, SeriesSequenceProps } from "./Sequence";
export { interpolate } from "./interpolate";
export type { ExtrapolateType, InterpolateOptions } from "./interpolate";
export { Easing } from "./easing";
export type { EasingFunction } from "./easing";
export { spring, measureSpring, JAL_SPRING } from "./spring";
export type { SpringConfig, SpringOptions, MeasureSpringOptions } from "./spring";
export { createFrameClock, frameAtElapsed, clampFrame } from "./clock";
export type { FrameClock, FrameClockOptions, ElapsedFrame } from "./clock";
export { Player, usePrefersReducedMotion } from "./Player";
export type { PlayerProps } from "./Player";
export {
  resolveInitialPlayback,
  posterFrameFor,
  shouldClockRun,
  mustShowControls,
  formatTime,
} from "./player-state";
export type { InitialPlaybackInput, PlaybackState, RunInput, ControlsInput } from "./player-state";
