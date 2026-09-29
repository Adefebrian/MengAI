import { afterEach, describe, expect, test } from "bun:test";
import { act, useLayoutEffect, type ReactElement } from "react";
import { AppShell } from "../AppShell";
import { clientRenderer } from "../frames/test-render";
import { armMotion, countUp, formatLike, motionTargets, parseCountable, standardCurve } from "./motion";
import { Figure, Page, SectionHead } from "./Page";
import { StatRow } from "./StatRow";
import { FeatureGrid } from "./FeatureGrid";

describe("count-up helpers", () => {
  test("parses plain numbers and keeps their written form", () => {
    const cases: [string, string][] = [
      ["612", "612"],
      ["1.490.000", "1.490.000"],
      ["12,900,000", "12,900,000"],
      ["±30", "±30"],
      ["2.9", "2.9"],
      ["-10", "-10"],
    ];
    for (const [text, back] of cases) {
      const c = parseCountable(text);
      expect({ text, ok: c !== null }).toEqual({ text, ok: true });
      expect(formatLike(c!, c!.value)).toBe(back);
    }
    expect(formatLike(parseCountable("1.490.000")!, 1234)).toBe("1.234");
    expect(formatLike(parseCountable("2.9")!, 1)).toBe("1.0");
  });

  test("leaves ranges, words, and dimensions still", () => {
    for (const text of ["0 to 500", "72 × 96 × 28", "NDIR", "", "1.2.3,4"]) expect({ text, c: parseCountable(text) }).toEqual({ text, c: null });
  });

  test("the curve is the standard ease, monotonic from 0 to 1", () => {
    expect(standardCurve(0)).toBe(0);
    expect(standardCurve(1)).toBe(1);
    let last = 0;
    for (let t = 0.05; t < 1; t += 0.05) {
      const v = standardCurve(t);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(standardCurve(0.25)).toBeGreaterThan(0.5); // decelerating: most of the change early
  });
});

describe.skipIf(typeof document === "undefined")("count-up in a DOM", () => {
  test("locks the box to the final width, counts, then releases at the final value", async () => {
    const el = document.createElement("span");
    el.textContent = "1.490.000";
    el.getBoundingClientRect = () => ({ width: 96, height: 24, top: 0, left: 0, right: 96, bottom: 24, x: 0, y: 0, toJSON() {} }) as DOMRect;
    document.body.appendChild(el);
    const seen: string[] = [];
    const stop = countUp(el, { duration: 60 });
    expect(stop).not.toBeNull();
    expect(el.style.inlineSize).toBe("96px");
    seen.push(el.textContent!);
    await new Promise((r) => setTimeout(r, 30));
    seen.push(el.textContent!);
    expect(el.style.inlineSize).toBe("96px");
    await new Promise((r) => setTimeout(r, 120));
    expect(el.textContent).toBe("1.490.000");
    expect(el.style.inlineSize).toBe("");
    for (const s of seen) expect(s).toMatch(/^\d{1,3}(\.\d{3})*$/);
    stop!();
    el.remove();
  });

  test("a word or a range is never counted", () => {
    const el = document.createElement("span");
    el.textContent = "0 to 500";
    expect(countUp(el)).toBeNull();
    expect(el.textContent).toBe("0 to 500");
  });
});

describe.skipIf(clientRenderer === null)("kit motion in a DOM", () => {
  type Observed = { cb: IntersectionObserverCallback; root: Element | Document | null | undefined; targets: Element[] };
  const observers: Observed[] = [];
  const OriginalIO = globalThis.IntersectionObserver;
  const OriginalMM = globalThis.matchMedia;

  afterEach(() => {
    globalThis.IntersectionObserver = OriginalIO;
    globalThis.matchMedia = OriginalMM;
    observers.length = 0;
  });

  function stubObserver() {
    class FakeObserver {
      rec: Observed;
      constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
        this.rec = { cb, root: opts?.root, targets: [] };
        observers.push(this.rec);
      }
      observe(el: Element) {
        this.rec.targets.push(el);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  }

  function stubReduced(reduce: boolean) {
    globalThis.matchMedia = ((q: string) => ({
      matches: reduce && q.includes("reduce"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof matchMedia;
  }

  async function mount(el: ReactElement) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = clientRenderer!.createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => root.render(el));
    return {
      container,
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  const page = (motion?: "none" | "quiet" | "staged") => (
    <Page direction="D1" motion={motion}>
      <SectionHead id="h" title="Specs" lead="Measured." />
      <StatRow label="Proof" stats={[{ value: "30", unit: "ppm", caption: "Accuracy" }, { value: "18", unit: "months", caption: "Battery" }]} />
      <FeatureGrid title="Built" items={[1, 2, 3].map((n) => ({ title: `T${n}`, body: "b" }))} />
    </Page>
  );

  test("without IntersectionObserver nothing is ever pending: the page renders finished", async () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;
    stubReduced(false);
    const { container, cleanup } = await mount(page());
    try {
      expect(container.querySelectorAll("[data-motion]").length).toBeGreaterThan(0);
      expect(container.querySelectorAll("[data-motion-state]").length).toBe(0);
    } finally {
      cleanup();
    }
  });

  test("under reduced motion the page never arms", async () => {
    stubObserver();
    stubReduced(true);
    const { container, cleanup } = await mount(page("staged"));
    try {
      expect(observers.length).toBe(0);
      expect(container.querySelectorAll("[data-motion-state]").length).toBe(0);
    } finally {
      cleanup();
    }
  });

  test("motion none arms nothing; a module engine takes over", async () => {
    stubObserver();
    stubReduced(false);
    const a = await mount(page("none"));
    expect(observers.length).toBe(0);
    a.cleanup();
    const b = await mount(page("quiet"));
    expect(observers.length).toBe(1);
    b.cleanup();
    observers.length = 0;
    // A module (templates/modules/motion) claims the page in a child layout
    // effect, which runs before the Page's own.
    function Engine() {
      useLayoutEffect(() => {
        const root = document.querySelector<HTMLElement>(".kit-page");
        if (root) root.dataset.motionEngine = "gsap";
      }, []);
      return null;
    }
    const c = await mount(
      <Page direction="D1">
        <Engine />
        <SectionHead id="h" title="Specs" />
      </Page>,
    );
    expect(observers.length).toBe(0);
    expect(c.container.querySelectorAll("[data-motion-state]").length).toBe(0);
    c.cleanup();
  });

  test("armed targets flip from pending to in once, rooted on the document viewport", async () => {
    stubObserver();
    stubReduced(false);
    const { container, cleanup } = await mount(page("quiet"));
    try {
      expect(observers.length).toBe(1);
      expect(observers[0].root).toBeNull();
      const pending = container.querySelectorAll('[data-motion-state="pending"]');
      expect(pending.length).toBe(observers[0].targets.length);
      const first = observers[0].targets[0] as HTMLElement;
      await act(async () => {
        observers[0].cb([{ isIntersecting: true, target: first } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      });
      expect(first.dataset.motionState).toBe("in");
    } finally {
      cleanup();
    }
  });

  test("quiet animates blocks, staged animates items instead of the blocks that hold them", () => {
    const box = document.createElement("div");
    box.innerHTML = '<div data-motion="rise"><p data-motion="item"></p><p data-motion="item"></p></div><div data-motion="rise"></div><span data-motion="count">1</span>';
    expect(motionTargets(box, "quiet").map((e) => e.dataset.motion)).toEqual(["rise", "rise", "count"]);
    expect(motionTargets(box, "staged").map((e) => e.dataset.motion)).toEqual(["item", "item", "rise", "count"]);
    expect(motionTargets(box, "none")).toEqual([]);
  });

  test("what is on screen when the page arms paints finished; only what scrolls in waits", () => {
    stubObserver();
    stubReduced(false);
    const root = document.createElement("div");
    root.innerHTML = '<div data-motion="rise" id="above"></div><div data-motion="rise" id="below"></div>';
    document.body.appendChild(root);
    const rect = (top: number) => () => ({ top, bottom: top + 200, left: 0, right: 300, width: 300, height: 200, x: 0, y: top, toJSON() {} }) as DOMRect;
    const above = root.querySelector<HTMLElement>("#above")!;
    const below = root.querySelector<HTMLElement>("#below")!;
    above.getBoundingClientRect = rect(80);
    below.getBoundingClientRect = rect(window.innerHeight + 400);
    const cleanup = armMotion(root, "quiet");
    try {
      expect(above.dataset.motionState).toBeUndefined();
      expect(below.dataset.motionState).toBe("pending");
      expect(observers[0].targets).toEqual([below]);
    } finally {
      cleanup();
      root.remove();
    }
  });

  test("a target in the observer's trimmed bottom band is revealed on mount or at the end of scroll", async () => {
    stubObserver();
    stubReduced(false);
    const root = document.createElement("div");
    root.innerHTML = '<span data-motion="count" id="fig">612</span><div data-motion="rise" id="last"></div>';
    document.body.appendChild(root);
    const rect = (top: number) => () => ({ top, bottom: top + 40, left: 0, right: 300, width: 300, height: 40, x: 0, y: top, toJSON() {} }) as DOMRect;
    const fig = root.querySelector<HTMLElement>("#fig")!;
    const last = root.querySelector<HTMLElement>("#last")!;
    // The figure sits inside the viewport's bottom 8%, where the observer's
    // rootMargin never reports it; the last band sits below the fold.
    fig.getBoundingClientRect = rect(window.innerHeight - 45);
    last.getBoundingClientRect = rect(window.innerHeight + 20);
    const se = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    const metrics = { scrollTop: 0, clientHeight: window.innerHeight, scrollHeight: window.innerHeight + 60 };
    const saved = Object.keys(metrics).map((k) => [k, Object.getOwnPropertyDescriptor(se, k)] as const);
    for (const [k, v] of Object.entries(metrics)) Object.defineProperty(se, k, { configurable: true, get: () => (metrics as Record<string, number>)[k] });
    const cleanup = armMotion(root, "quiet");
    try {
      expect(fig.dataset.motionState).toBe("in");
      expect(last.dataset.motionState).toBe("pending");
      // No intersection is ever reported; the page scrolls part way, then to its end.
      metrics.scrollTop = 20;
      window.dispatchEvent(new Event("scroll"));
      await new Promise((r) => setTimeout(r, 40));
      expect(last.dataset.motionState).toBe("pending");
      metrics.scrollTop = 60;
      window.dispatchEvent(new Event("scroll"));
      await new Promise((r) => setTimeout(r, 40));
      expect(last.dataset.motionState).toBe("in");
    } finally {
      cleanup();
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(se, k, d);
        else delete (se as unknown as Record<string, unknown>)[k];
      }
      root.remove();
    }
  });

  test("a contained shell roots the observer on its scroller, after mount", async () => {
    stubObserver();
    stubReduced(false);
    const { container, cleanup } = await mount(
      <Page direction="D1">
        <AppShell title="Hawa" destinations={[{ id: "a", label: "A", href: "#" }]} current="a" scroll="contained">
          <SectionHead id="h" title="Specs" />
        </AppShell>
      </Page>,
    );
    try {
      expect(observers[0].root).toBe(container.querySelector("main.shell-main"));
    } finally {
      cleanup();
    }
  });

  test("unmount leaves every target visible", async () => {
    stubObserver();
    stubReduced(false);
    const { container, cleanup } = await mount(page("staged"));
    const targets = [...observers[0].targets] as HTMLElement[];
    expect(targets.every((t) => t.dataset.motionState === "pending")).toBe(true);
    cleanup();
    expect(targets.every((t) => t.dataset.motionState === undefined)).toBe(true);
    expect(container.isConnected).toBe(false);
  });
});

describe.skipIf(clientRenderer === null)("count-up when the value changes mid-count", () => {
  const box = () => ({ width: 64, height: 24, top: 0, left: 0, right: 64, bottom: 24, x: 0, y: 0, toJSON() {} }) as DOMRect;

  test("a new value prop cancels the count: neither the next frame nor stop writes the old value back", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = clientRenderer!.createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => root.render(<Figure value="612" count />));
    const el = container.querySelector<HTMLElement>(".kit-num")!;
    el.getBoundingClientRect = box;
    const stop = countUp(el, { duration: 400 });
    expect(stop).not.toBeNull();
    await new Promise((r) => setTimeout(r, 40));
    expect(el.textContent).not.toBe("612");
    await act(async () => root.render(<Figure value="900" count />));
    expect(el.textContent).toBe("900");
    await new Promise((r) => setTimeout(r, 60));
    expect(el.textContent).toBe("900");
    expect(el.style.inlineSize).toBe("");
    stop!();
    expect(el.textContent).toBe("900");
    act(() => root.unmount());
    container.remove();
  });

  test("stop right after an outside write keeps the new text", () => {
    const el = document.createElement("span");
    el.textContent = "1.490.000";
    el.getBoundingClientRect = box;
    document.body.appendChild(el);
    const stop = countUp(el, { duration: 400 })!;
    el.firstChild!.nodeValue = "2.000.000";
    stop();
    expect(el.textContent).toBe("2.000.000");
    expect(el.style.inlineSize).toBe("");
    el.textContent = "3";
    el.remove();
  });

  test("an unchanged value still lands on its final text when stopped early", () => {
    const el = document.createElement("span");
    el.textContent = "612";
    el.getBoundingClientRect = box;
    document.body.appendChild(el);
    const stop = countUp(el, { duration: 400 })!;
    expect(el.textContent).toBe("0");
    stop();
    expect(el.textContent).toBe("612");
    el.remove();
  });
});
