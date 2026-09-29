import { describe, expect, test } from "bun:test";
import { act } from "react";
import { clientRenderer, staticRenderer } from "./test-render";
import { clampFrame, createFrameClock, frameAtElapsed } from "./clock";
import { useCurrentFrame } from "./context";
import { Player } from "./Player";
import { formatTime, mustShowControls, posterFrameFor, resolveInitialPlayback, shouldClockRun } from "./player-state";

// Render suites need react-dom (see test-render.ts); pure suites always run.
const server = staticRenderer;

describe("reduced-motion poster behavior", () => {
  test("reduced motion shows the poster frame and never autoplays", () => {
    expect(resolveInitialPlayback({ reducedMotion: true, autoPlay: true, durationInFrames: 90 })).toEqual({
      frame: 89,
      playing: false,
    });
    expect(
      resolveInitialPlayback({ reducedMotion: true, autoPlay: true, durationInFrames: 90, posterFrame: 42, initialFrame: 3 }),
    ).toEqual({ frame: 42, playing: false });
  });

  test("the default poster is the last frame, the final complete state", () => {
    expect(posterFrameFor(150)).toBe(149);
    expect(posterFrameFor(150, 999)).toBe(149);
    expect(posterFrameFor(150, -4)).toBe(0);
  });

  test("without reduced motion, autoPlay decides and initialFrame is used", () => {
    expect(resolveInitialPlayback({ reducedMotion: false, autoPlay: true, durationInFrames: 90 })).toEqual({
      frame: 0,
      playing: true,
    });
    expect(
      resolveInitialPlayback({ reducedMotion: false, autoPlay: false, durationInFrames: 90, initialFrame: 12 }),
    ).toEqual({ frame: 12, playing: false });
  });
});

describe("clock run gate", () => {
  test("runs only when playing, in view, and the tab is visible", () => {
    expect(shouldClockRun({ playing: true, inView: true, pageVisible: true })).toBe(true);
    expect(shouldClockRun({ playing: false, inView: true, pageVisible: true })).toBe(false);
    expect(shouldClockRun({ playing: true, inView: false, pageVisible: true })).toBe(false);
    expect(shouldClockRun({ playing: true, inView: true, pageVisible: false })).toBe(false);
  });

  test("controls cannot be hidden on an autoplaying piece longer than 5s", () => {
    expect(mustShowControls({ controls: false, autoPlay: true, fps: 30, durationInFrames: 300 })).toBe(true);
    expect(mustShowControls({ controls: false, autoPlay: true, fps: 30, durationInFrames: 150 })).toBe(false);
    expect(mustShowControls({ controls: false, autoPlay: false, fps: 30, durationInFrames: 900 })).toBe(false);
    expect(mustShowControls({ controls: true, autoPlay: false, fps: 30, durationInFrames: 30 })).toBe(true);
  });

  test("formatTime renders m:ss", () => {
    expect(formatTime(0, 30)).toBe("0:00");
    expect(formatTime(95, 30)).toBe("0:03");
    expect(formatTime(30 * 75, 30)).toBe("1:15");
  });
});

function fakeTime() {
  let t = 0;
  let queue: Array<() => void> = [];
  let nextId = 1;
  const ids = new Map<number, () => void>();
  return {
    now: () => t,
    requestFrame: (cb: () => void) => {
      const id = nextId++;
      ids.set(id, cb);
      queue.push(cb);
      return id;
    },
    cancelFrame: (id: number) => {
      const cb = ids.get(id);
      queue = queue.filter((q) => q !== cb);
      ids.delete(id);
    },
    /** Advance wall time, then fire one pending rAF callback. */
    advance(ms: number) {
      t += ms;
      const pending = queue;
      queue = [];
      for (const cb of pending) cb();
    },
    pending: () => queue.length,
  };
}

describe("frame clock", () => {
  test("frameAtElapsed is driven by elapsed time", () => {
    expect(frameAtElapsed(0, 0, 30, 90, false)).toEqual({ frame: 0, ended: false });
    expect(frameAtElapsed(0, 100, 30, 90, false)).toEqual({ frame: 3, ended: false });
    expect(frameAtElapsed(10, 1000, 30, 90, false)).toEqual({ frame: 40, ended: false });
    expect(frameAtElapsed(0, 2999, 30, 90, false)).toEqual({ frame: 89, ended: false });
    expect(frameAtElapsed(0, 3000, 30, 90, false)).toEqual({ frame: 89, ended: true });
    expect(frameAtElapsed(0, 3500, 30, 90, true)).toEqual({ frame: 15, ended: false });
  });

  test("a long gap between callbacks jumps to the right frame, not the next one", () => {
    const time = fakeTime();
    const seen: number[] = [];
    const clock = createFrameClock({ fps: 30, durationInFrames: 300, onFrame: (f) => seen.push(f), ...time });
    clock.play();
    time.advance(16);
    time.advance(1000);
    expect(clock.frame).toBe(30);
    expect(seen).toEqual([30]);
    clock.destroy();
  });

  test("emits only when the integer frame changes (120Hz display, 30fps piece)", () => {
    const time = fakeTime();
    const seen: number[] = [];
    const clock = createFrameClock({ fps: 30, durationInFrames: 300, onFrame: (f) => seen.push(f), ...time });
    clock.play();
    for (let i = 0; i < 12; i++) time.advance(1000 / 120);
    expect(seen).toEqual([1, 2, 3]);
    clock.destroy();
  });

  test("pause freezes, play resumes from the same frame", () => {
    const time = fakeTime();
    const clock = createFrameClock({ fps: 30, durationInFrames: 300, onFrame: () => {}, ...time });
    clock.play();
    time.advance(500);
    clock.pause();
    expect(clock.frame).toBe(15);
    expect(time.pending()).toBe(0);
    time.advance(10_000);
    expect(clock.frame).toBe(15);
    clock.play();
    time.advance(100);
    expect(clock.frame).toBe(18);
    clock.destroy();
  });

  test("non-looping playback ends on the last frame and restarts on play", () => {
    const time = fakeTime();
    let ended = 0;
    const clock = createFrameClock({
      fps: 30,
      durationInFrames: 30,
      onFrame: () => {},
      onEnded: () => ended++,
      ...time,
    });
    clock.play();
    time.advance(5000);
    expect(clock.frame).toBe(29);
    expect(clock.running).toBe(false);
    expect(ended).toBe(1);
    clock.play();
    expect(clock.frame).toBe(0);
    clock.destroy();
  });

  test("looping wraps and seek re-anchors a running clock", () => {
    const time = fakeTime();
    const clock = createFrameClock({ fps: 30, durationInFrames: 30, loop: true, onFrame: () => {}, ...time });
    clock.play();
    time.advance(1500);
    expect(clock.frame).toBe(15);
    clock.seek(5);
    time.advance(100);
    expect(clock.frame).toBe(8);
    clock.seek(999);
    expect(clock.frame).toBe(29);
    clock.destroy();
    expect(clock.running).toBe(false);
  });

  test("clampFrame keeps frames integral and in range", () => {
    expect(clampFrame(-3, 10)).toBe(0);
    expect(clampFrame(4.6, 10)).toBe(5);
    expect(clampFrame(40, 10)).toBe(9);
    expect(clampFrame(Number.NaN, 10)).toBe(0);
  });
});

function ShowFrame() {
  return <span>{`frame:${useCurrentFrame()}`}</span>;
}

describe.skipIf(server === null)("Player rendering", () => {
  // Server rendering resolves prefers-reduced-motion to its server
  // snapshot (reduce), which is exactly the poster path.
  test("renders the poster frame, paused, with a 44px control set", () => {
    const html = server!.renderToStaticMarkup(
      <Player label="Demo" fps={30} durationInFrames={90} width={1280} height={720} autoPlay component={ShowFrame} />,
    );
    expect(html).toContain("frame:89");
    expect(html).toContain('data-state="paused"');
    expect(html).toContain('data-reduced-motion="true"');
    expect(html).toContain(">Play</button>");
    expect(html).toContain('type="range"');
    expect(html).toContain('aria-label="Seek"');
    expect(html).toContain('role="group"');
  });

  test("honors an explicit posterFrame", () => {
    const html = server!.renderToStaticMarkup(
      <Player label="Demo" fps={30} durationInFrames={90} width={1280} height={720} posterFrame={30} component={ShowFrame} />,
    );
    expect(html).toContain("frame:30");
  });
});

// Live client path. Runs when a DOM is registered (bun test from the
// template root preloads happy-dom); skips under a bare packages/ui run.
describe.skipIf(clientRenderer === null)("Player in a DOM", () => {
  async function mount(reduce: boolean, props: { autoPlay?: boolean; posterFrame?: number }) {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: reduce && query.includes("reduce"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = clientRenderer!.createRoot(container);
    // React 19 schedules root renders; act() flushes them before asserting.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => {
      root.render(
        <Player label="Demo" fps={30} durationInFrames={90} width={1280} height={720} component={ShowFrame} {...props} />,
      );
    });
    const cleanup = () => {
      act(() => root.unmount());
      container.remove();
      window.matchMedia = original;
    };
    return { container, cleanup };
  }

  test("reduced motion: poster frame, paused, autoplay ignored", async () => {
    const { container, cleanup } = await mount(true, { autoPlay: true });
    expect(container.textContent).toContain("frame:89");
    expect(container.querySelector(".frames-player")?.getAttribute("data-state")).toBe("paused");
    expect(container.querySelector("button")?.textContent).toBe("Play");
    cleanup();
  });

  test("motion allowed: autoplay intent starts on frame 0", async () => {
    const { container, cleanup } = await mount(false, { autoPlay: true });
    expect(container.textContent).toContain("frame:0");
    expect(container.querySelector(".frames-player")?.getAttribute("data-state")).toBe("playing");
    expect(container.querySelector("button")?.textContent).toBe("Pause");
    cleanup();
  });
});
