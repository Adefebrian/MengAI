// Time map: real run time to replay time, one compression factor per stage
// so each beat reads, on the frame core's 30 fps clock.
import type { ReplayFixture, StageId, StageMark } from "./fixture";

export const FPS = 30;

export function durationFrames(f: ReplayFixture): number {
  const last = f.stages[f.stages.length - 1];
  return last ? Math.round((last.replayEndMs / 1000) * FPS) : 1;
}

export function frameToMs(frame: number): number {
  return (frame / FPS) * 1000;
}

export function msToFrame(ms: number): number {
  return Math.round((ms * FPS) / 1000);
}

/** The stage a replay moment falls in (the last stage holds the end). */
export function stageAtMs(stages: StageMark[], ms: number): StageMark {
  for (const s of stages) if (ms < s.replayEndMs) return s;
  return stages[stages.length - 1]!;
}

export function stageById(stages: StageMark[], id: StageId): StageMark {
  const s = stages.find((m) => m.id === id);
  if (!s) throw new Error(`replay: no stage ${id}`);
  return s;
}

/** Replay ms to real epoch ms, linear inside each stage. */
export function replayMsToTs(stages: StageMark[], ms: number): number {
  const s = stageAtMs(stages, ms);
  const span = s.replayEndMs - s.replayStartMs;
  const t = span > 0 ? Math.min(Math.max((ms - s.replayStartMs) / span, 0), 1) : 0;
  return s.startTs + t * (s.endTs - s.startTs);
}

/** Real epoch ms to replay ms, the inverse of replayMsToTs. */
export function tsToReplayMs(stages: StageMark[], ts: number): number {
  const first = stages[0]!;
  if (ts <= first.startTs) return first.replayStartMs;
  for (const s of stages) {
    if (ts < s.endTs) {
      const span = s.endTs - s.startTs;
      const t = span > 0 ? (ts - s.startTs) / span : 0;
      return s.replayStartMs + t * (s.replayEndMs - s.replayStartMs);
    }
  }
  return stages[stages.length - 1]!.replayEndMs;
}

/** The frame that stands for a stage as a still. */
export function stillFrame(f: ReplayFixture, id: StageId): number {
  const s = stageById(f.stages, id);
  return Math.min(msToFrame(tsToReplayMs(f.stages, s.stillTs)), durationFrames(f) - 1);
}

/** The first frame of a stage. */
export function stageStartFrame(f: ReplayFixture, id: StageId): number {
  return msToFrame(stageById(f.stages, id).replayStartMs);
}

/** How many times faster than the run the replay plays, rounded. */
export function speedup(f: ReplayFixture): number {
  const last = f.stages[f.stages.length - 1]!;
  return Math.round((f.endedAt - f.startedAt) / last.replayEndMs);
}

/** m:ss for a span of milliseconds. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
