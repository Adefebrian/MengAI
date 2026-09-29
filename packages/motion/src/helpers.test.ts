// Pure helpers of the motion module, tested with fakes: no browser, no
// lenis or gsap install needed (bun test from this folder).
import { describe, expect, test } from "bun:test";
import { anchorTarget, handleAnchorClick, headerOffset, lenisOffset, scrollPaddingTop, scrollToAnchor, type ScrollToLike } from "./anchor";
import { DEFAULT_LAG, wireClock, type TickerCallback } from "./clock";
import { isTouchFirst, readSignals, resolveScrollTarget, smoothScrollEnabled } from "./policy";

function fakeTicker() {
  const calls: string[] = [];
  const listeners: { cb: TickerCallback; prioritize?: boolean }[] = [];
  return {
    calls,
    listeners,
    add(cb: TickerCallback, _once?: boolean, prioritize?: boolean) {
      calls.push(`add:${prioritize}`);
      listeners.push({ cb, prioritize });
    },
    remove(cb: TickerCallback) {
      calls.push("remove");
      const i = listeners.findIndex((l) => l.cb === cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    lagSmoothing(threshold: number | boolean, adjusted?: number) {
      calls.push(`lag:${threshold}${adjusted === undefined ? "" : `,${adjusted}`}`);
    },
    tick(seconds: number) {
      for (const l of listeners) l.cb(seconds, 16, 1);
    },
  };
}

function fakeLenis() {
  const rafs: number[] = [];
  const scroll: (() => void)[] = [];
  let offs = 0;
  return {
    rafs,
    scroll,
    get offs() {
      return offs;
    },
    raf(t: number) {
      rafs.push(t);
    },
    on(_event: "scroll", cb: () => void) {
      scroll.push(cb);
      return () => {
        offs++;
        scroll.splice(scroll.indexOf(cb), 1);
      };
    },
  };
}

describe("wireClock: one clock for Lenis and ScrollTrigger", () => {
  test("the ticker drives lenis.raf in milliseconds, prioritized, with lag smoothing off", () => {
    const ticker = fakeTicker();
    const lenis = fakeLenis();
    let updates = 0;
    wireClock(ticker, lenis, { update: () => updates++ });
    expect(ticker.calls).toEqual(["add:true", "lag:0"]);
    ticker.tick(1.5);
    expect(lenis.rafs).toEqual([1500]);
    for (const cb of lenis.scroll) cb();
    expect(updates).toBe(1);
  });

  test("unwiring removes both callbacks and restores lag smoothing, once", () => {
    const ticker = fakeTicker();
    const lenis = fakeLenis();
    const unwire = wireClock(ticker, lenis, { update: () => {} });
    unwire();
    unwire();
    expect(ticker.listeners.length).toBe(0);
    expect(lenis.scroll.length).toBe(0);
    expect(lenis.offs).toBe(1);
    expect(ticker.calls).toEqual(["add:true", "lag:0", "remove", `lag:${DEFAULT_LAG.threshold},${DEFAULT_LAG.adjusted}`]);
  });
});

describe("smooth scroll policy", () => {
  const desktop = { reducedMotion: false, coarsePointer: false, noHover: false };
  const phone = { reducedMotion: false, coarsePointer: true, noHover: true };

  test("on for a fine pointer, off under reduced motion whatever the page asks", () => {
    expect(smoothScrollEnabled(desktop)).toBe(true);
    expect(smoothScrollEnabled({ ...desktop, reducedMotion: true })).toBe(false);
    expect(smoothScrollEnabled({ ...phone, reducedMotion: true }, "smooth")).toBe(false);
  });

  test("touch-first devices stay native unless the page opts in", () => {
    expect(isTouchFirst(phone)).toBe(true);
    expect(isTouchFirst({ ...phone, noHover: false })).toBe(false); // a laptop touchscreen with a trackpad
    expect(smoothScrollEnabled(phone)).toBe(false);
    expect(smoothScrollEnabled(phone, "smooth")).toBe(true);
  });

  test("signals read from matchMedia; without it, motion reads as off", () => {
    expect(readSignals(undefined).reducedMotion).toBe(true);
    const s = readSignals((q) => ({ matches: q === "(pointer: coarse)" }));
    expect(s).toEqual({ reducedMotion: false, coarsePointer: true, noHover: false });
  });
});

describe("resolveScrollTarget", () => {
  const doc = { documentElement: { tag: "html" } } as unknown as Document;

  test("a document shell scrolls the window over the root element", () => {
    const win = { scrollY: 0 } as unknown as Window;
    const t = resolveScrollTarget(win, doc);
    expect(t.contained).toBe(false);
    expect(t.wrapper).toBe(win);
    expect(t.content).toBe(doc.documentElement);
  });

  test("a contained shell scrolls main over its single wrapper child", () => {
    const child = { tag: "div" };
    const main = { nodeType: 1, childElementCount: 1, firstElementChild: child } as unknown as HTMLElement;
    const t = resolveScrollTarget(main, doc);
    expect(t).toEqual({ wrapper: main, content: child as unknown as HTMLElement, contained: true });
  });

  test("refuses a contained main with more than one child", () => {
    const main = { nodeType: 1, childElementCount: 2, firstElementChild: {} } as unknown as HTMLElement;
    expect(() => resolveScrollTarget(main, doc)).toThrow(/exactly one wrapper/);
  });
});

describe("anchors through Lenis", () => {
  function fakeDoc(opts: { position?: string; height?: number; ids?: Record<string, object> } = {}) {
    const header = { offsetHeight: opts.height ?? 57 };
    const pushed: string[] = [];
    const doc = {
      querySelector: (sel: string) => (sel.includes("shell-header") ? header : null),
      getElementById: (id: string) => opts.ids?.[id] ?? null,
      defaultView: {
        getComputedStyle: () => ({ position: opts.position ?? "sticky" }),
        location: { hash: "" },
        history: { pushState: (_s: unknown, _t: string, url: string) => pushed.push(url) },
      },
    };
    return { doc: doc as unknown as Document, pushed };
  }

  test("the offset is the sticky header on a document shell, 0 when contained, the page's own when given", () => {
    expect(headerOffset(fakeDoc().doc, false)).toBe(57);
    expect(headerOffset(fakeDoc({ height: 64.4 }).doc, false)).toBe(64);
    expect(headerOffset(fakeDoc({ position: "static" }).doc, false)).toBe(0);
    expect(headerOffset(fakeDoc().doc, true)).toBe(0);
    expect(headerOffset(fakeDoc().doc, false, 24)).toBe(24);
  });

  test("Lenis gets only the room the scroller's scroll-padding does not already give", () => {
    // ui.css sets html scroll-padding-top to the header height on a document
    // shell, and Lenis subtracts it itself: the extra offset is then 0, and a
    // target at 1200px lands at 1200 - 64 = 1136, right below the header.
    const view = { getComputedStyle: () => ({ scrollPaddingTop: "64px" }) } as unknown as Window;
    const html = {} as Element;
    const padding = scrollPaddingTop(html, view);
    expect(padding).toBe(64);
    expect(lenisOffset(64, padding)).toBe(0);
    const lands = (targetTop: number, extra: number) => targetTop - padding - extra;
    expect(lands(1200, lenisOffset(64, padding))).toBe(1136);
    // No scroll-padding (a page without the shell rule): the header's full
    // height; a taller explicit room adds only the difference.
    expect(lenisOffset(64, scrollPaddingTop(html, { getComputedStyle: () => ({ scrollPaddingTop: "auto" }) } as unknown as Window))).toBe(64);
    expect(lenisOffset(96.4, 64)).toBe(32);
    expect(lenisOffset(40, 64)).toBe(0);
    expect(scrollPaddingTop(null, view)).toBe(0);
  });

  test("only same-page ids resolve", () => {
    const target = { id: "specs" };
    const { doc } = fakeDoc({ ids: { specs: target } });
    const link = (href: string) => ({ getAttribute: () => href }) as unknown as HTMLAnchorElement;
    expect(anchorTarget(link("#specs"), doc)).toBe(target as unknown as HTMLElement);
    expect(anchorTarget(link("#"), doc)).toBeNull();
    expect(anchorTarget(link("/pricing#specs"), doc)).toBeNull();
    expect(anchorTarget(link("#missing"), doc)).toBeNull();
  });

  test("scrollToAnchor passes the negative header offset, the curve, and immediate under reduced motion, then focuses", () => {
    const seen: { target: unknown; opts: Record<string, unknown> }[] = [];
    const lenis: ScrollToLike = {
      scrollTo: (target, opts) => {
        seen.push({ target, opts: opts as Record<string, unknown> });
        opts?.onComplete?.();
      },
    };
    const attrs: Record<string, string> = {};
    let focused: unknown = null;
    const target = {
      tagName: "SECTION",
      hasAttribute: (n: string) => n in attrs,
      setAttribute: (n: string, v: string) => (attrs[n] = v),
      focus: (o: unknown) => (focused = o),
    } as unknown as HTMLElement;
    const easing = (t: number) => t;
    scrollToAnchor(lenis, target, { offset: 57, duration: 0.6, easing, reduced: true });
    expect(seen[0].opts.offset).toBe(-57);
    expect(seen[0].opts.duration).toBe(0.6);
    expect(seen[0].opts.easing).toBe(easing);
    expect(seen[0].opts.immediate).toBe(true);
    expect(attrs.tabindex).toBe("-1");
    expect(focused).toEqual({ preventScroll: true });
  });

  test("a plain left click on an in-page link is taken; modified clicks and opted-out links are not", () => {
    const target = { tagName: "SECTION", hasAttribute: () => true, focus() {} };
    const { doc, pushed } = fakeDoc({ ids: { story: target } });
    let scrolled = 0;
    const lenis: ScrollToLike = { scrollTo: () => void scrolled++ };
    const link = (attrs: Record<string, string> = {}) => ({
      getAttribute: () => "#story",
      hasAttribute: (n: string) => n in attrs,
      hash: "#story",
      target: attrs.target ?? "",
    });
    const click = (over: Partial<MouseEvent> = {}, l = link()) => {
      let prevented = false;
      const ev = {
        defaultPrevented: false,
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        target: { closest: () => l },
        preventDefault: () => (prevented = true),
        ...over,
      } as unknown as MouseEvent;
      const took = handleAnchorClick(ev, lenis, doc, { offset: 0, duration: 0.6, easing: (t) => t, reduced: false });
      return { took, prevented };
    };
    expect(click()).toEqual({ took: true, prevented: true });
    expect(pushed).toEqual(["#story"]);
    expect(click({ metaKey: true }).took).toBe(false);
    expect(click({ button: 1 }).took).toBe(false);
    expect(click({}, link({ "data-lenis-prevent": "" })).took).toBe(false);
    expect(scrolled).toBe(1);
  });
});
