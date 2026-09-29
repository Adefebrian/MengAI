// The smooth-scroll lifecycle, the refresh sources, the SplitText reveal, and
// the count-up, each driven with fakes for gsap, Lenis, and the DOM (bun
// test from this folder, no install).
import { describe, expect, test } from "bun:test";
import { DEFAULT_LAG, type TickerCallback } from "./clock";
import { createSmoothController, preventNode, type LenisInit, type SmoothLenis } from "./controller";
import { countTo, type CountEngine } from "./count";
import type { ScrollTarget, SmoothSignals } from "./policy";
import { createRefresher, watchRefresh } from "./refresh";
import { SPLIT_VARS, splitReveal, type SplitEngine } from "./split";

// ---------------------------------------------------------------- fakes

function fakeTicker() {
  const listeners = new Set<TickerCallback>();
  const lag: string[] = [];
  return {
    listeners,
    lag,
    adds: 0,
    add(cb: TickerCallback) {
      this.adds++;
      listeners.add(cb);
    },
    remove(cb: TickerCallback) {
      listeners.delete(cb);
    },
    lagSmoothing(t: number | boolean, a?: number) {
      lag.push(a === undefined ? `${t}` : `${t},${a}`);
    },
    tick(seconds: number) {
      for (const cb of listeners) cb(seconds, 16, 1);
    },
  };
}

interface FakeLenis extends SmoothLenis {
  init: LenisInit;
  rafs: number[];
  scrollListeners: Set<() => void>;
  destroyed: boolean;
}

function lenisFactory() {
  const made: FakeLenis[] = [];
  const create = (init: LenisInit): FakeLenis => {
    const scrollListeners = new Set<() => void>();
    const l: FakeLenis = {
      init,
      rafs: [],
      scrollListeners,
      destroyed: false,
      raf(t) {
        l.rafs.push(t);
      },
      on(_e, cb) {
        scrollListeners.add(cb);
        return () => scrollListeners.delete(cb);
      },
      destroy() {
        l.destroyed = true;
      },
    };
    made.push(l);
    return l;
  };
  return { made, create };
}

const desktop: SmoothSignals = { reducedMotion: false, coarsePointer: false, noHover: false };
const win = { kind: "window" } as unknown as Window;
const html = { tag: "html" } as unknown as HTMLElement;
const docTarget: ScrollTarget = { wrapper: win, content: html, contained: false };

function harness(target: ScrollTarget = docTarget, start: SmoothSignals = desktop, touch: "native" | "smooth" = "native") {
  let signals = start;
  const ticker = fakeTicker();
  const lenis = lenisFactory();
  const log: string[] = [];
  let updates = 0;
  const current: (FakeLenis | null)[] = [];
  const c = createSmoothController<FakeLenis>({
    target,
    signals: () => signals,
    touch,
    lerp: 0.1,
    createLenis: lenis.create,
    ticker,
    triggers: { update: () => void updates++ },
    register: () => void log.push("register"),
    setScroller: (s) => void log.push(s ? `scroller:${(s as unknown as { tag: string }).tag}` : "scroller:window"),
    bindAnchors: () => {
      log.push("bind");
      return () => void log.push("unbind");
    },
    onChange: (l) => void current.push(l),
  });
  return {
    c,
    ticker,
    lenis,
    log,
    current,
    get updates() {
      return updates;
    },
    set: (s: Partial<SmoothSignals>) => {
      signals = { ...signals, ...s };
      c.sync();
    },
  };
}

// ------------------------------------------------------ one clock, lifecycle

describe("smooth-scroll lifecycle: one clock", () => {
  test("a desktop page gets one Lenis driven by exactly one ticker callback, in ms, with lag smoothing off", () => {
    const h = harness();
    h.c.sync();
    expect(h.lenis.made.length).toBe(1);
    expect(h.ticker.listeners.size).toBe(1);
    expect(h.ticker.lag).toEqual(["0"]);
    const l = h.lenis.made[0];
    expect(l.init).toMatchObject({ wrapper: win, content: html, autoRaf: false, anchors: false, syncTouch: false, lerp: 0.1 });
    h.ticker.tick(2);
    expect(l.rafs).toEqual([2000]);
    for (const cb of l.scrollListeners) cb();
    expect(h.updates).toBe(1); // lenis scroll -> ScrollTrigger.update
    expect(h.log).toEqual(["register", "bind"]);
  });

  test("re-syncing while running never adds a second callback or a second Lenis", () => {
    const h = harness();
    h.c.sync();
    h.c.sync();
    h.set({ coarsePointer: true }); // still has hover: stays smooth
    expect(h.lenis.made.length).toBe(1);
    expect(h.ticker.adds).toBe(1);
    expect(h.ticker.listeners.size).toBe(1);
  });

  test("unmount destroys Lenis, removes the one ticker callback and the scroll listener, restores lag smoothing; twice is safe", () => {
    const h = harness();
    h.c.sync();
    const l = h.lenis.made[0];
    h.c.destroy();
    h.c.destroy();
    expect(l.destroyed).toBe(true);
    expect(h.ticker.listeners.size).toBe(0);
    expect(l.scrollListeners.size).toBe(0);
    expect(h.ticker.lag).toEqual(["0", `${DEFAULT_LAG.threshold},${DEFAULT_LAG.adjusted}`]);
    expect(h.log).toEqual(["register", "bind", "unbind"]);
    expect(h.current).toEqual([l, null]);
    expect(h.c.lenis).toBeNull();
  });
});

describe("smooth-scroll lifecycle: reduced motion", () => {
  test("reduced motion at load never creates Lenis and never touches GSAP", () => {
    const h = harness(docTarget, { ...desktop, reducedMotion: true });
    h.c.sync();
    h.c.sync();
    expect(h.lenis.made.length).toBe(0);
    expect(h.ticker.adds).toBe(0);
    expect(h.ticker.lag).toEqual([]);
    expect(h.log).toEqual([]); // no register, no scroller defaults, no anchors
  });

  test("reduced motion even with touch='smooth' on a phone creates nothing", () => {
    const h = harness(docTarget, { reducedMotion: true, coarsePointer: true, noHover: true }, "smooth");
    h.c.sync();
    expect(h.lenis.made.length).toBe(0);
  });

  test("switching reduced motion on mid-session destroys Lenis at once; off again starts a fresh one", () => {
    const h = harness();
    h.c.sync();
    const first = h.lenis.made[0];
    h.set({ reducedMotion: true });
    expect(first.destroyed).toBe(true);
    expect(h.ticker.listeners.size).toBe(0);
    expect(h.c.lenis).toBeNull();
    h.set({ reducedMotion: false });
    expect(h.lenis.made.length).toBe(2);
    expect(h.ticker.listeners.size).toBe(1);
    expect(h.c.lenis).toBe(h.lenis.made[1]);
  });
});

describe("smooth-scroll lifecycle: touch and contained shells", () => {
  const phone: SmoothSignals = { reducedMotion: false, coarsePointer: true, noHover: true };

  test("touch-first keeps native scroll unless the page opts in, and then Lenis syncs touch", () => {
    const native = harness(docTarget, phone);
    native.c.sync();
    expect(native.lenis.made.length).toBe(0);
    expect(native.ticker.adds).toBe(0);
    const smooth = harness(docTarget, phone, "smooth");
    smooth.c.sync();
    expect(smooth.lenis.made[0].init.syncTouch).toBe(true);
  });

  test("a contained shell hands Lenis main as wrapper and its single child as content, and points ScrollTrigger at main", () => {
    const main = { tag: "main" } as unknown as HTMLElement;
    const root = { tag: "div.motion-root" } as unknown as HTMLElement;
    const h = harness({ wrapper: main, content: root, contained: true });
    h.c.sync();
    expect(h.lenis.made[0].init.wrapper).toBe(main);
    expect(h.lenis.made[0].init.content).toBe(root);
    expect(h.log).toEqual(["register", "scroller:main", "bind"]);
    h.c.destroy();
    expect(h.log.at(-1)).toBe("scroller:window");
  });

  test("a contained shell on a touch-first device still points triggers at main, without Lenis", () => {
    const main = { tag: "main" } as unknown as HTMLElement;
    const h = harness({ wrapper: main, content: html, contained: true }, phone);
    h.c.sync();
    expect(h.lenis.made.length).toBe(0);
    expect(h.log).toEqual(["register", "scroller:main"]);
  });

  test("open dialogs and text areas are never smoothed through", () => {
    const node = (sel: string) => ({ matches: (s: string) => s.split(", ").includes(sel) }) as unknown as HTMLElement;
    expect(preventNode(node("dialog"))).toBe(true);
    expect(preventNode(node('[role="dialog"]'))).toBe(true);
    expect(preventNode(node("textarea"))).toBe(true);
    expect(preventNode(node("section"))).toBe(false);
  });
});

// ------------------------------------------------------------------ refresh

function fakeFrames() {
  const queue = new Map<number, () => void>();
  let id = 0;
  return {
    raf: (cb: () => void) => {
      queue.set(++id, cb);
      return id;
    },
    caf: (n: number) => void queue.delete(n),
    flush() {
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb();
    },
    get size() {
      return queue.size;
    },
  };
}

describe("refresh on fonts ready and resize", () => {
  test("many asks in one frame refresh once", () => {
    const f = fakeFrames();
    let runs = 0;
    const r = createRefresher(() => runs++, f.raf, f.caf);
    r.request();
    r.request();
    r.request();
    f.flush();
    expect(runs).toBe(1);
  });

  test("document.fonts.ready resolving refreshes Lenis and ScrollTrigger once", async () => {
    const f = fakeFrames();
    let runs = 0;
    let resolveFonts: () => void = () => {};
    const fonts = { ready: new Promise<void>((r) => (resolveFonts = r)) };
    watchRefresh({ fonts, observe: [], refresher: createRefresher(() => runs++, f.raf, f.caf) });
    f.flush();
    expect(runs).toBe(0);
    resolveFonts();
    await fonts.ready;
    f.flush();
    expect(runs).toBe(1);
  });

  test("a later font load refreshes too; unwatching before fonts resolve refreshes nothing", async () => {
    const f = fakeFrames();
    let runs = 0;
    const listeners = new Set<() => void>();
    let resolveFonts: () => void = () => {};
    const fonts = {
      ready: new Promise<void>((r) => (resolveFonts = r)),
      addEventListener: (_t: "loadingdone", cb: () => void) => void listeners.add(cb),
      removeEventListener: (_t: "loadingdone", cb: () => void) => void listeners.delete(cb),
    };
    const unwatch = watchRefresh({ fonts, observe: [], refresher: createRefresher(() => runs++, f.raf, f.caf) });
    for (const cb of listeners) cb();
    f.flush();
    expect(runs).toBe(1);
    unwatch();
    expect(listeners.size).toBe(0);
    resolveFonts();
    await fonts.ready;
    f.flush();
    expect(runs).toBe(1);
  });

  test("the observer's first report is ignored; a real size change refreshes; disconnect on unwatch", () => {
    const f = fakeFrames();
    let runs = 0;
    let report: (e: { target: Element; contentRect: { width: number; height: number } }[]) => void = () => {};
    const observed: Element[] = [];
    let disconnected = false;
    const content = { tag: "content" } as unknown as Element;
    const unwatch = watchRefresh({
      observe: [content],
      createObserver: (cb) => {
        report = cb;
        return { observe: (el) => void observed.push(el), disconnect: () => void (disconnected = true) };
      },
      refresher: createRefresher(() => runs++, f.raf, f.caf),
    });
    expect(observed).toEqual([content]);
    report([{ target: content, contentRect: { width: 1280, height: 4000 } }]);
    f.flush();
    expect(runs).toBe(0);
    report([{ target: content, contentRect: { width: 1280, height: 4000.3 } }]);
    f.flush();
    expect(runs).toBe(0);
    report([{ target: content, contentRect: { width: 1280, height: 4400 } }]);
    f.flush();
    expect(runs).toBe(1);
    unwatch();
    expect(disconnected).toBe(true);
  });
});

// ---------------------------------------------------------------- SplitText

function fakeSplitEngine() {
  const sets: Record<string, unknown>[] = [];
  const triggers: { vars: Parameters<SplitEngine["trigger"]>[0]; killed: boolean }[] = [];
  const splits: { reverted: boolean; lines: Element[] }[] = [];
  const rises: { lines: Element[]; vars: Parameters<SplitEngine["rise"]>[1]; killed: boolean }[] = [];
  const engine: SplitEngine = {
    set: (_t, vars) => void sets.push(vars),
    trigger: (vars) => {
      const t = { vars, killed: false };
      triggers.push(t);
      return { kill: () => void (t.killed = true) };
    },
    split: () => {
      const s = { reverted: false, lines: [{} as Element, {} as Element], revert: () => void (s.reverted = true) };
      splits.push(s);
      return s;
    },
    rise: (lines, vars) => {
      const r = { lines, vars, killed: false };
      rises.push(r);
      return { kill: () => void (r.killed = true) };
    },
  };
  return { engine, sets, triggers, splits, rises };
}

const heading = () => ({ style: {} }) as unknown as HTMLElement;
const opts = { start: "clamp(top 90%)", duration: 0.6, stagger: 0.08, fontsReady: Promise.resolve() };

describe("SplitText line reveal", () => {
  test("waits at opacity 0 unsplit, splits on enter after fonts, rises, and reverts when the lines land", async () => {
    const e = fakeSplitEngine();
    splitReveal(heading(), e.engine, opts);
    expect(e.sets).toEqual([{ opacity: 0 }]);
    expect(e.splits.length).toBe(0);
    expect(e.triggers[0].vars).toMatchObject({ start: "clamp(top 90%)", once: true });
    e.triggers[0].vars.onEnter();
    await opts.fontsReady;
    expect(e.splits.length).toBe(1);
    expect(e.sets.at(-1)).toEqual({ opacity: 1 });
    expect(e.rises[0].lines).toBe(e.splits[0].lines);
    expect(e.rises[0].vars).toMatchObject({ duration: 0.6, stagger: 0.08 });
    e.rises[0].vars.onComplete();
    expect(e.splits[0].reverted).toBe(true);
  });

  test("the split is masked by line with SplitText's aria handling kept", () => {
    expect(SPLIT_VARS).toEqual({ type: "lines", mask: "lines", linesClass: "kit-line", aria: "auto" });
  });

  test("unmount mid-rise kills the rise, reverts the split, kills the trigger, and clears the opacity", async () => {
    const e = fakeSplitEngine();
    const undo = splitReveal(heading(), e.engine, opts);
    e.triggers[0].vars.onEnter();
    await opts.fontsReady;
    undo();
    undo();
    expect(e.rises[0].killed).toBe(true);
    expect(e.splits[0].reverted).toBe(true);
    expect(e.triggers[0].killed).toBe(true);
    expect(e.sets.at(-1)).toEqual({ clearProps: "opacity" });
    expect(e.sets.filter((s) => "clearProps" in s).length).toBe(1);
  });

  test("unmount before fonts resolve never splits", async () => {
    const e = fakeSplitEngine();
    let resolve: () => void = () => {};
    const fontsReady = new Promise<void>((r) => (resolve = r));
    const undo = splitReveal(heading(), e.engine, { ...opts, fontsReady });
    e.triggers[0].vars.onEnter();
    undo();
    resolve();
    await fontsReady;
    expect(e.splits.length).toBe(0);
    expect(e.sets.at(-1)).toEqual({ clearProps: "opacity" });
  });
});

// ----------------------------------------------------------------- count-up

describe("count-up on the ticker", () => {
  const parse = (t: string) => (/^\d+$/.test(t) ? { value: Number(t) } : null);
  const format = (_c: { value: number }, n: number) => String(Math.round(n));
  function figure(text: string, width = 48) {
    const node = { nodeType: 3, nodeValue: text };
    return {
      node,
      el: { firstChild: node, childNodes: [node], style: { inlineSize: "" }, getBoundingClientRect: () => ({ width }) } as unknown as HTMLElement,
    };
  }
  function engine() {
    const tweens: { state: { v: number }; vars: Parameters<CountEngine["tween"]>[1]; killed: boolean }[] = [];
    const e: CountEngine = {
      tween: (state, vars) => {
        const t = { state, vars, killed: false };
        tweens.push(t);
        return { kill: () => void (t.killed = true) };
      },
    };
    return { e, tweens };
  }

  test("counts from 0 to the figure with the width locked, then writes the exact text and unlocks", () => {
    const { el, node } = figure("612");
    const { e, tweens } = engine();
    const stop = countTo(el, parse, format, e, 0.6);
    expect(stop).not.toBeNull();
    expect(node.nodeValue).toBe("0");
    expect(el.style.inlineSize).toBe("48px");
    expect(tweens[0].vars).toMatchObject({ v: 612, duration: 0.6 });
    tweens[0].state.v = 306;
    tweens[0].vars.onUpdate();
    expect(node.nodeValue).toBe("306");
    tweens[0].vars.onComplete();
    expect(node.nodeValue).toBe("612");
    expect(el.style.inlineSize).toBe("");
  });

  test("a stop mid-count (unmount, reduced motion) kills the tween and writes the final value", () => {
    const { el, node } = figure("612");
    const { e, tweens } = engine();
    const stop = countTo(el, parse, format, e, 0.6)!;
    stop();
    expect(tweens[0].killed).toBe(true);
    expect(node.nodeValue).toBe("612");
    tweens[0].vars.onUpdate();
    expect(node.nodeValue).toBe("612");
  });

  test("a new value mid-count (the figure re-rendered) stops the count and is never overwritten", () => {
    const { el, node } = figure("612");
    const { e, tweens } = engine();
    const stop = countTo(el, parse, format, e, 0.6)!;
    tweens[0].state.v = 200;
    tweens[0].vars.onUpdate();
    expect(node.nodeValue).toBe("200");
    node.nodeValue = "640"; // React writes the new value into the same text node
    tweens[0].state.v = 300;
    tweens[0].vars.onUpdate();
    expect(tweens[0].killed).toBe(true);
    expect(node.nodeValue).toBe("640");
    expect(el.style.inlineSize).toBe("");
    stop(); // unmount or reduced motion afterwards
    tweens[0].vars.onComplete();
    expect(node.nodeValue).toBe("640");
  });

  test("a new value written just before the stop is kept too", () => {
    const { el, node } = figure("612");
    const { e } = engine();
    const stop = countTo(el, parse, format, e, 0.6)!;
    node.nodeValue = "700";
    stop();
    expect(node.nodeValue).toBe("700");
    expect(el.style.inlineSize).toBe("");
  });

  test("a replaced text node (a keyed re-render) is left alone", () => {
    const { el, node } = figure("612");
    const { e, tweens } = engine();
    const stop = countTo(el, parse, format, e, 0.6)!;
    const fresh = { nodeType: 3, nodeValue: "9" };
    (el as unknown as { firstChild: unknown }).firstChild = fresh;
    tweens[0].vars.onUpdate();
    stop();
    expect(fresh.nodeValue).toBe("9");
    expect(node.nodeValue).toBe("0");
    expect(tweens[0].killed).toBe(true);
  });

  test("a word, a range, or zero stays still", () => {
    const { e, tweens } = engine();
    expect(countTo(figure("12 to 18").el, parse, format, e, 0.6)).toBeNull();
    expect(countTo(figure("0").el, parse, format, e, 0.6)).toBeNull();
    expect(tweens.length).toBe(0);
  });
});
