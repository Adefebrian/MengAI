// The frame clock. Driven by elapsed wall time, never by counting rAF
// callbacks: a 120Hz display, a dropped frame, or a throttled tab all land
// on the frame the timeline says it should be at. It emits only when the
// integer frame changes, so a 30fps composition re-renders 30 times a
// second even on a 120Hz screen.

export interface FrameClockOptions {
  fps: number;
  durationInFrames: number;
  loop?: boolean;
  /** Frame to start on. Default 0. */
  initialFrame?: number;
  onFrame: (frame: number) => void;
  onEnded?: () => void;
  /** Injectable for tests. Default performance.now. */
  now?: () => number;
  /** Injectable for tests. Default requestAnimationFrame. */
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
}

export interface FrameClock {
  play(): void;
  pause(): void;
  seek(frame: number): void;
  setLoop(loop: boolean): void;
  readonly running: boolean;
  readonly frame: number;
  destroy(): void;
}

export interface ElapsedFrame {
  frame: number;
  /** True once a non-looping timeline has shown its last frame for a full frame. */
  ended: boolean;
}

/** Pure mapping from elapsed milliseconds to a frame. */
export function frameAtElapsed(
  startFrame: number,
  elapsedMs: number,
  fps: number,
  durationInFrames: number,
  loop: boolean,
): ElapsedFrame {
  // The epsilon absorbs float error such as 100 * 30 / 1000 landing a hair
  // under an integer.
  const advanced = Math.floor(Math.max(0, elapsedMs) * fps / 1000 + 1e-6);
  const pos = startFrame + advanced;
  if (loop) {
    return { frame: ((pos % durationInFrames) + durationInFrames) % durationInFrames, ended: false };
  }
  if (pos >= durationInFrames) return { frame: durationInFrames - 1, ended: true };
  return { frame: pos, ended: false };
}

export function clampFrame(frame: number, durationInFrames: number): number {
  if (!Number.isFinite(frame)) return 0;
  return Math.min(Math.max(Math.round(frame), 0), durationInFrames - 1);
}

function defaultNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function defaultRequest(cb: () => void): number {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(() => cb());
  return setTimeout(cb, 16) as unknown as number;
}

function defaultCancel(id: number): void {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  else clearTimeout(id);
}

export function createFrameClock(options: FrameClockOptions): FrameClock {
  const { fps, durationInFrames, onFrame, onEnded } = options;
  if (!(fps > 0)) throw new RangeError("createFrameClock: fps must be > 0");
  if (!Number.isInteger(durationInFrames) || durationInFrames < 1) {
    throw new RangeError("createFrameClock: durationInFrames must be an integer >= 1");
  }
  const now = options.now ?? defaultNow;
  const request = options.requestFrame ?? defaultRequest;
  const cancel = options.cancelFrame ?? defaultCancel;

  let loop = options.loop ?? false;
  let frame = clampFrame(options.initialFrame ?? 0, durationInFrames);
  let running = false;
  let destroyed = false;
  let anchorFrame = frame;
  let anchorTime = 0;
  let handle: number | null = null;

  const emit = (next: number) => {
    if (next === frame) return;
    frame = next;
    onFrame(frame);
  };

  const schedule = () => {
    handle = request(tick);
  };

  const reanchor = () => {
    anchorFrame = frame;
    anchorTime = now();
  };

  function tick(): void {
    handle = null;
    if (!running || destroyed) return;
    const next = frameAtElapsed(anchorFrame, now() - anchorTime, fps, durationInFrames, loop);
    emit(next.frame);
    if (next.ended) {
      running = false;
      onEnded?.();
      return;
    }
    schedule();
  }

  return {
    play() {
      if (running || destroyed) return;
      if (!loop && frame >= durationInFrames - 1) emit(0);
      reanchor();
      running = true;
      schedule();
    },
    pause() {
      if (!running) return;
      // Land on the frame the wall clock says we reached before stopping.
      const next = frameAtElapsed(anchorFrame, now() - anchorTime, fps, durationInFrames, loop);
      emit(next.frame);
      running = false;
      if (handle !== null) cancel(handle);
      handle = null;
    },
    seek(target: number) {
      if (destroyed) return;
      emit(clampFrame(target, durationInFrames));
      if (running) reanchor();
    },
    setLoop(next: boolean) {
      loop = next;
      if (running) reanchor();
    },
    get running() {
      return running;
    },
    get frame() {
      return frame;
    },
    destroy() {
      running = false;
      destroyed = true;
      if (handle !== null) cancel(handle);
      handle = null;
    },
  };
}
