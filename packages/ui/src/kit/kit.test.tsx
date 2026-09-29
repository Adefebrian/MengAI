import { afterEach, describe, expect, test } from "bun:test";
import { act, type ReactElement } from "react";
import { AppShell } from "../AppShell";
import { clientRenderer, staticRenderer } from "../frames/test-render";
import {
  BentoGrid,
  BentoTile,
  CTABand,
  FAQ,
  FeatureGrid,
  Footer,
  Masthead,
  MediaFrame,
  PAGE_RECIPES,
  Page,
  PricingTable,
  Quote,
  LogoRow,
  Section,
  SectionHead,
  SpecRail,
  SpecTable,
  Split,
  StatRow,
  StickyStory,
  validateBentoLayout,
  validatePageRecipe,
  type FooterVariant,
  type MastheadVariant,
} from "./index";

const render = (el: ReactElement) => staticRenderer!.renderToStaticMarkup(el);
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

const bento = (
  <BentoGrid title="What it shows" lead="One view per claim." layout={{ lg: ["a a b c", "a a d d"], md: ["a a", "b c", "d d"] }}>
    <BentoTile area="a" kind="media" title="The day" body="CO2 across a workday." media={<div />} />
    <BentoTile area="b" kind="stat" value="612" unit="ppm" body="Right now" signal />
    <BentoTile area="c" kind="text" title="Quiet" body="No fan." />
    <BentoTile area="d" kind="list" title="Today" items={[{ label: "Alerts", value: 3 }]} />
  </BentoGrid>
);

describe.skipIf(staticRenderer === null)("kit markup", () => {
  test("Page carries the direction and the explicit theme only when set", () => {
    const html = render(<Page direction="D9"><p>x</p></Page>);
    expect(html).toContain('class="kit-page" data-direction="D9"');
    expect(html).not.toContain("data-theme");
    expect(render(<Page direction="D13" theme="dark"><p>x</p></Page>)).toContain('data-theme="dark"');
  });

  test("Section is a labelled band around the grid, with its composition and variant", () => {
    const html = render(<Section label="Proof" tone="layer" attached composition="custom" variant="proof-band"><p>x</p></Section>);
    expect(html).toMatch(
      /<section class="kit-section" data-tone="layer" data-attached="" data-kit-composition="custom" data-variant="proof-band" aria-label="Proof"><div class="kit-grid">/,
    );
  });

  test("Page carries the one rhythm and the motion level", () => {
    const html = render(<Page direction="D1" rhythm="generous" motion="staged"><p>x</p></Page>);
    expect(html).toContain('data-rhythm="generous" data-motion-level="staged"');
    expect(render(<Page><p>x</p></Page>)).toContain('data-rhythm="default" data-motion-level="quiet"');
  });

  test("SectionHead renders one heading and one lead, no kicker", () => {
    const html = render(<SectionHead id="h" title="Specs" lead="Measured." />);
    expect(count(html, /<h[1-6]/g)).toBe(1);
    expect(html).toContain('<h2 id="h" class="kit-heading">Specs</h2><p class="kit-lead">Measured.</p>');
  });

  const variants: MastheadVariant[] = ["left", "centered", "split"];
  for (const variant of variants) {
    test(`Masthead ${variant} renders exactly one h1 that names its section`, () => {
      const html = render(
        <Masthead variant={variant} title="Air you can read" lead="A desk monitor." actions={<a className="btn" href="#buy">Buy</a>} media={<div className="m" />} />,
      );
      expect(count(html, /<h1 /g)).toBe(1);
      const id = html.match(/<h1 id="([^"]+)" class="kit-display"/)![1];
      expect(html).toContain(`aria-labelledby="${id}"`);
      expect(html).toContain(`data-variant="${variant}"`);
      expect(html).not.toContain("kit-overlay");
      expect(html).toContain('style="--kit-display-chars:16"');
    });
  }

  test("Masthead split refuses to render without media; a wordmark title writes no measure", () => {
    expect(() => render(<Masthead variant="split" title="x" />)).toThrow(/needs media/);
    expect(render(<Masthead title={<svg aria-label="Hawa" />} />)).not.toContain("--kit-display-chars");
  });

  test("Split places text and media with the declared ratio", () => {
    const html = render(<Split title="Reads the room" lead="Lead" ratio="7/5" mediaSide="start" mobileMedia="before" media={<div />} />);
    expect(html).toContain('data-ratio="7/5" data-media-side="start" data-mobile-media="before"');
    expect(count(html, /<h2 /g)).toBe(1);
  });

  test("BentoGrid writes the area maps and every tile anatomy", () => {
    const html = render(bento);
    expect(html).toContain('--kit-bento-lg:&quot;a a b c&quot; &quot;a a d d&quot;');
    expect(html).toContain("--kit-bento-lg-cols:4");
    expect(html).toContain("data-has-md");
    for (const kind of ["media", "stat", "text", "list"]) expect(html).toContain(`data-kind="${kind}"`);
    expect(html).toContain('<span class="kit-num" data-motion="count">612</span><span class="kit-unit">\u00a0ppm</span>');
  });

  test("SpecRail and SpecTable set numbers in tabular mono with small units", () => {
    const rail = render(<SpecRail label="Sensors" rows={[{ label: "CO2", value: "400 to 5000", unit: "ppm" }, { label: "Sensor", value: "NDIR" }]} />);
    expect(rail).toContain('<dl class="kit-spec-rail" data-layout="rows" data-count="2" aria-label="Sensors">');
    expect(count(rail, /class="kit-num"/g)).toBe(1);
    const table = render(<SpecTable title="Specifications" groups={[{ name: "Power", rows: [{ label: "Battery", value: 18, unit: "months" }] }]} />);
    expect(table).toContain('<th scope="row">Battery</th>');
    expect(table).toMatch(/<h3 id="[^"]+" class="kit-title">Power<\/h3><\/div><table class="kit-spec-grid" aria-labelledby=/);
  });

  test("StatRow renders 2 to 4 figures and refuses more", () => {
    const html = render(<StatRow label="Proof" stats={[{ value: "30", unit: "ppm", caption: "Accuracy" }, { value: "18", unit: "months", caption: "Battery" }]} />);
    expect(html).toContain('data-count="2"');
    expect(count(html, /class="kit-stat"/g)).toBe(2);
    expect(() => render(<StatRow label="x" stats={[{ value: 1, caption: "a" }]} />)).toThrow(/2 to 4/);
  });

  test("FeatureGrid has exactly one heading per item and no second heading anywhere", () => {
    const items = [1, 2, 3].map((n) => ({ title: `Title ${n}`, body: `Body ${n}`, icon: <svg /> }));
    const html = render(<FeatureGrid title="Built to stay" items={items} columns={3} />);
    expect(count(html, /<h3 /g)).toBe(3);
    expect(count(html, /<h[1-6] /g)).toBe(4);
    for (const li of html.split("<li ").slice(1)) expect(count(li, /<h[1-6] /g)).toBe(1);
    expect(html).toContain('data-lg="3" data-md="1"');
  });

  test("FeatureGrid refuses a count that leaves a dead cell", () => {
    const items = [1, 2, 3, 4].map((n) => ({ title: `T${n}`, body: "b" }));
    expect(() => render(<FeatureGrid title="x" items={items} columns={3} />)).toThrow(/do not fill 3 columns/);
  });

  test("MediaFrame renders every kind with a fixed ratio and a caption below", () => {
    const img = render(<MediaFrame src="/a.jpg" alt="Hawa on a desk" width={1600} height={900} priority caption="On a desk" />);
    expect(img).toContain('loading="eager"');
    expect(img).toMatch(/fetchPriority="high"|fetchpriority="high"/);
    expect(img).toContain("--kit-ratio:16 / 9");
    expect(img).toContain('<figcaption class="kit-meta">On a desk</figcaption>');
    expect(render(<MediaFrame src="/a.jpg" alt="x" />)).toContain('loading="lazy"');
    expect(render(<MediaFrame kind="placeholder" ratio="4/3" alt="Product on a desk, warm light" />)).toContain('role="img" aria-label="Product on a desk, warm light"');
    expect(render(<MediaFrame kind="canvas" ratio="1/1"><canvas aria-hidden="true" /></MediaFrame>)).toContain('data-jal-canvas=""');
    const video = render(<MediaFrame kind="video" src="/a.mp4" poster="/p.jpg" alt="" />);
    expect(video).toMatch(/playsinline/i);
    expect(video).toContain('preload="metadata"');
  });

  test("Quote, LogoRow, CTABand render as named sections", () => {
    expect(render(<Quote quote="It changed our afternoons." name="Rina Kartika" role="Facilities lead" />)).toContain('aria-label="Customer quote"');
    const logos = render(<LogoRow label="Works with" logos={[{ name: "Matter" }, { name: "Home Assistant" }]} />);
    expect(logos).toContain('aria-label="Works with"');
    expect(logos).toContain("data-attached");
    expect(logos).toContain('data-kit-composition="logo-row"');
    const cta = render(<CTABand title="Bring one home" actions={<a className="btn" href="#">Buy</a>} proof={<p>Ships in 2 days</p>} />);
    expect(cta).toContain('data-tone="layer"');
    expect(cta).toMatch(/aria-labelledby="([^"]+)"[\s\S]*<h2 id="\1"/);
  });

  test("FAQ uses native details and summary rows", () => {
    const html = render(<FAQ title="Questions" items={[{ q: "Does it need an account?", a: "No." }, { q: "Battery?", a: "18 months." }]} />);
    expect(count(html, /<details class="kit-faq-item">/g)).toBe(2);
    expect(count(html, /<summary>/g)).toBe(2);
  });

  test("PricingTable renders plans and a structured comparison", () => {
    const plans = [
      { name: "One", price: "1.490.000", unit: "IDR", summary: "The monitor", features: ["CO2"], action: <a className="btn" href="#">Buy</a>, recommended: true },
      { name: "Room kit", price: "2.290.000", unit: "IDR", summary: "Two rooms", features: ["CO2", "PM2.5"], action: <a className="btn btn-secondary" href="#">Buy</a> },
    ];
    const html = render(<PricingTable title="Pricing" plans={plans} compare={{ caption: "Compare", rows: [{ label: "PM2.5", values: [false, true] }] }} />);
    expect(html).toContain("data-recommended");
    expect(count(html, /class="kit-visually-hidden"> \(recommended\)<\/span>/g)).toBe(1);
    expect(html).toContain('<span class="kit-unit">\u00a0IDR</span>');
    expect(html).not.toMatch(/class="kit-unit"> /);
    expect(html).toContain('<th scope="row">PM2.5</th>');
    expect(html).toContain('role="img" aria-label="Included"');
    expect(html).toContain("Not included");
    // One plan column at a time below 768: the recommended plan shows first.
    expect(html).toContain('class="jal-segmented kit-compare-switch" role="group" aria-label="Plan to compare"');
    expect(count(html, /aria-pressed="true"/g)).toBe(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>One<\/button>/);
    expect(count(html, /data-off=""/g)).toBe(2);
    expect(html).toMatch(/<table class="kit-compare-table" id="[^"]+" aria-labelledby="[^"]+">/);
    expect(() => render(<PricingTable title="x" plans={plans} compare={{ caption: "c", rows: [{ label: "a", values: [true] }] }} />)).toThrow(/compare row 1/);
  });

  const footers: FooterVariant[] = ["inline", "statement", "masthead", "letter", "index"];
  for (const variant of footers) {
    test(`Footer ${variant} renders a footer landmark`, () => {
      const html = render(
        <Footer
          variant={variant}
          brand="Hawa"
          statement="Air you can read."
          links={[{ label: "Specs", href: "#specs" }]}
          groups={[{ title: "Product", links: [{ label: "Specs", href: "#specs" }] }]}
          legal="Hawa 2026"
        />,
      );
      expect(html).toMatch(new RegExp(`^<footer class="kit-footer" data-kit-composition="footer" data-variant="${variant}">`));
    });
  }

  test("StickyStory renders ordered steps, a stage, and marks the first step active", () => {
    const steps = [1, 2, 3].map((n) => ({ title: `Step ${n}`, body: "b", media: <div className="m" /> }));
    const html = render(<StickyStory title="How it works" steps={steps} />);
    expect(html).toContain('<ol class="kit-story-steps">');
    expect(count(html, /class="kit-story-frame"/g)).toBe(3);
    expect(count(html, /aria-current="step"/g)).toBe(1);
  });
});

describe("Bento layout validation", () => {
  const tiles = [
    { area: "a", kind: "media" as const },
    { area: "b", kind: "stat" as const },
    { area: "c", kind: "text" as const },
  ];

  test("a fully occupied map is lawful", () => {
    expect(validateBentoLayout(["a a b", "a a c"], tiles)).toEqual([]);
  });

  test("rejects dead cells", () => {
    expect(validateBentoLayout(["a a b", "a a ."], tiles).join()).toMatch(/dead cell at row 2, column 3/);
    expect(validateBentoLayout(["a a b", "a a d"], tiles).join()).toMatch(/area "d" has no tile/);
  });

  test("rejects ragged rows, split areas, and stray tiles", () => {
    expect(validateBentoLayout(["a a b", "a a"], tiles).join()).toMatch(/row 2 has 2 cells/);
    expect(validateBentoLayout(["a b a", "c c c"], tiles).join()).toMatch(/"a" is not one rectangle/);
    expect(validateBentoLayout(["a a", "a a"], tiles).join()).toMatch(/tile "b" is not in the layout map/);
  });

  test("rejects two tiles on one area", () => {
    const dup = [...tiles, { area: "b", kind: "text" as const }];
    expect(validateBentoLayout(["a a b", "a a c"], dup).join()).toMatch(/area "b" is used by more than one tile/);
  });

  test("only media tiles may span rows", () => {
    expect(validateBentoLayout(["a b c", "a b c"], tiles).join()).toMatch(/"b" spans 2 rows but is a stat tile/);
  });

  test.skipIf(staticRenderer === null)("BentoGrid throws on a map with dead cells", () => {
    expect(() =>
      staticRenderer!.renderToStaticMarkup(
        <BentoGrid label="x" layout={{ lg: ["a a b", "a a ."] }}>
          <BentoTile area="a" kind="media" media={<div />} />
          <BentoTile area="b" kind="text" title="t" body="b" />
        </BentoGrid>,
      ),
    ).toThrow(/BentoGrid layout: dead cell/);
  });

  test.skipIf(staticRenderer === null)("BentoGrid sees tiles wrapped in fragments", () => {
    const html = staticRenderer!.renderToStaticMarkup(
      <BentoGrid label="x" layout={{ lg: ["a a b", "a a c"] }}>
        <>
          <BentoTile area="a" kind="media" media={<div />} />
          <>
            <BentoTile area="b" kind="text" title="t" body="b" />
          </>
        </>
        <BentoTile area="c" kind="text" title="t" body="c" />
      </BentoGrid>,
    );
    expect(count(html, /class="kit-bento-tile/g)).toBe(3);
  });

  test.skipIf(staticRenderer === null)("BentoGrid throws on a duplicate area", () => {
    expect(() =>
      staticRenderer!.renderToStaticMarkup(
        <BentoGrid label="x" layout={{ lg: ["a a b", "a a c"] }}>
          <BentoTile area="a" kind="media" media={<div />} />
          <BentoTile area="b" kind="text" title="t" body="b" />
          <BentoTile area="c" kind="text" title="t" body="c" />
          <BentoTile area="c" kind="text" title="t" body="again" />
        </BentoGrid>,
      ),
    ).toThrow(/used by more than one tile/);
  });
});

describe("page recipes and the anti-repetition law", () => {
  test("every shipped recipe is lawful", () => {
    for (const [name, sections] of Object.entries(PAGE_RECIPES)) {
      const kind = name === "app_dashboard_entry" ? "product" : "marketing";
      expect({ name, errors: validatePageRecipe(sections, kind) }).toEqual({ name, errors: [] });
    }
  });

  test("catches a non-masthead hero, adjacent repeats, overuse, and a missing data identity", () => {
    expect(validatePageRecipe(["split", "faq"]).join()).toMatch(/opens on a masthead/);
    expect(validatePageRecipe(["masthead", "split", "split", "bento"]).join()).toMatch(/neighbors must differ/);
    expect(validatePageRecipe(["masthead", "split", "bento", "split", "faq", "split"]).join()).toMatch(/split appears 3 times/);
    expect(validatePageRecipe(["masthead", "split", "faq"]).join()).toMatch(/data identity/);
    expect(validatePageRecipe(["masthead", "stat-row", "faq"]).join()).toMatch(/big-number hero/);
    expect(validatePageRecipe(["masthead", "footer", "bento"]).join()).toMatch(/footer must be last/);
  });
});

// Live DOM: the scroll story's observer is rooted on the real scroller.
describe.skipIf(clientRenderer === null)("StickyStory in a DOM", () => {
  type Observed = { cb: IntersectionObserverCallback; root: Element | Document | null | undefined; targets: Element[] };
  const observers: Observed[] = [];
  const Original = globalThis.IntersectionObserver;

  afterEach(() => {
    globalThis.IntersectionObserver = Original;
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
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
    globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
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

  const steps = [1, 2, 3].map((n) => ({ title: `Step ${n}`, body: "b", media: <div className="m" /> }));

  test("the step crossing the middle becomes active, on a contained shell's scroller", async () => {
    stubObserver();
    const { container, cleanup } = await mount(
      <AppShell title="Hawa" destinations={[{ id: "a", label: "A", href: "#" }]} current="a" scroll="contained">
        <StickyStory title="How it works" steps={steps} />
      </AppShell>,
    );
    try {
      expect(observers.length).toBe(1);
      const main = container.querySelector("main.shell-main");
      expect(observers[0].root).toBe(main);
      expect(observers[0].targets.length).toBe(3);
      const second = observers[0].targets[1];
      await act(async () => {
        observers[0].cb([{ isIntersecting: true, target: second } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      });
      const active = container.querySelectorAll(".kit-story-step[data-active]");
      expect(active.length).toBe(1);
      expect(active[0].getAttribute("data-index")).toBe("1");
      expect(container.querySelectorAll(".kit-story-frame[data-active]").length).toBe(1);
    } finally {
      cleanup();
    }
  });

  test("the pricing plan switch shows one plan column at a time", async () => {
    const plans = [
      { name: "One", price: "1", summary: "s", features: ["a"], action: <a href="#">Buy</a> },
      { name: "Kit", price: "2", summary: "s", features: ["a"], action: <a href="#">Buy</a>, recommended: true },
    ];
    const { container, cleanup } = await mount(
      <PricingTable title="Pricing" plans={plans} compare={{ caption: "Compare", rows: [{ label: "PM2.5", values: [false, true] }] }} />,
    );
    try {
      const shown = () => [...container.querySelectorAll(".kit-compare-table thead th:not([data-off])")].map((th) => th.textContent);
      expect(shown()).toEqual(["Feature", "Kit"]);
      const one = [...container.querySelectorAll<HTMLButtonElement>(".kit-compare-switch button")].find((b) => b.textContent === "One")!;
      await act(async () => one.click());
      expect(shown()).toEqual(["Feature", "One"]);
      expect(one.getAttribute("aria-pressed")).toBe("true");
      expect(container.querySelectorAll(".kit-compare-table tbody td:not([data-off])").length).toBe(1);
    } finally {
      cleanup();
    }
  });

  test("a video starts playing after hydration when motion is allowed", async () => {
    const proto = HTMLMediaElement.prototype as { play: () => Promise<void> };
    const original = proto.play;
    let calls = 0;
    proto.play = function () {
      calls += 1;
      return Promise.reject(new Error("NotAllowedError"));
    };
    try {
      const { container, cleanup } = await mount(<MediaFrame kind="video" src="/v.mp4" poster="/p.jpg" alt="" />);
      try {
        expect(container.querySelector("video")).not.toBeNull();
        expect(calls).toBe(1);
      } finally {
        cleanup();
      }
    } finally {
      proto.play = original;
    }
  });

  test("a document shell roots the observer on the viewport", async () => {
    stubObserver();
    const { cleanup } = await mount(<StickyStory title="How it works" steps={steps} />);
    try {
      expect(observers[0].root).toBeNull();
    } finally {
      cleanup();
    }
  });
});
