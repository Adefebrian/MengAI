import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { staticRenderer } from "../frames/test-render";
import {
  BENTO_PRESETS,
  BentoGrid,
  BentoTile,
  CTABand,
  FAQ,
  FeatureGrid,
  Quote,
  SpecRail,
  SpecTable,
  Split,
  StatRow,
  StickyStory,
  bentoPreset,
  validateBentoLayout,
  validatePageRecipe,
  validateVarietyLedger,
  readPageLedger,
  type BentoKind,
} from "./index";
import { Landing } from "./preview/Landing";
import { LANDING_LEDGER, MOTION_LEDGER } from "./preview/ledgers";

const render = (el: ReactElement) => staticRenderer!.renderToStaticMarkup(el);
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const sections = (html: string) => [...html.matchAll(/data-kit-composition="([^"]+)" data-variant="([^"]+)"/g)].map((m) => `${m[1]}.${m[2]}`);
const media = <div className="m" />;

describe.skipIf(staticRenderer === null)("structural variants render", () => {
  test("Split inset, bleed, and over-spec write their structure", () => {
    for (const variant of ["inset", "bleed", "over-spec"] as const) {
      const html = render(<Split variant={variant} title="Reads the room" lead="Lead" media={media} actions={<a className="btn" href="#">Buy</a>}>
        <SpecRail layout="strip" rows={[{ label: "CO2", value: 30, unit: "ppm" }, { label: "Dust", value: 5, unit: "µg" }]} />
      </Split>);
      expect(html).toContain(`data-kit-composition="split" data-variant="${variant}"`);
      expect(html).toContain(`class="kit-split" data-variant="${variant}"`);
      expect(count(html, /<h2 /g)).toBe(1);
      if (variant === "over-spec") {
        expect(html).toContain('class="kit-split-spec"');
        expect(html).not.toContain("data-ratio");
        expect(html).toContain('data-layout="strip"');
      } else expect(html).toContain('class="kit-split-extra"');
    }
  });

  test("StatRow row, lead, and chart", () => {
    const stats = [{ value: "38", unit: "%", caption: "Less" }, { value: "4", unit: "rooms", caption: "Rule" }];
    expect(render(<StatRow label="Proof" stats={stats} />)).toContain('data-variant="row"');
    const lead = render(<StatRow variant="lead" title="Numbers" lead="Checked." stats={stats} />);
    expect(lead).toContain('class="kit-statrow" data-variant="lead"');
    expect(count(lead, /<h2 /g)).toBe(1);
    const chart = render(<StatRow variant="chart" title="Month" stats={stats} chart={media} />);
    expect(chart).toContain('class="kit-statrow-chart"');
    expect(() => render(<StatRow variant="lead" title="x" stats={[stats[0]]} />)).toThrow(/2 to 4/);
    expect(() => render(<StatRow variant="chart" title="x" stats={stats} />)).toThrow(/needs a chart/);
    expect(() => render(<StatRow variant="lead" stats={stats} />)).toThrow(/needs a title/);
  });

  test("StatRow figures count: plain numbers carry data-motion=count", () => {
    const html = render(<StatRow label="x" stats={[{ value: "612", unit: "ppm", caption: "a" }, { value: "0 to 500", caption: "b" }]} />);
    expect(count(html, /data-motion="count"/g)).toBe(2);
  });

  test("FeatureGrid cells, rows, detail, and lead", () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => ({ title: `T${n}`, body: "b", media, meta: `${n} h` }));
    const cells = render(<FeatureGrid title="x" items={six.slice(0, 3)} />);
    expect(cells).toContain('class="kit-cells"');
    const rows = render(<FeatureGrid variant="rows" title="x" items={six.slice(0, 4)} />);
    expect(count(rows, /class="kit-row-meta kit-num"/g)).toBe(4);
    const detail = render(<FeatureGrid variant="detail" title="x" items={six.slice(0, 3)} />);
    expect(detail).toContain('role="tablist"');
    expect(count(detail, /role="tab"/g)).toBe(3);
    expect(count(detail, /aria-selected="true"/g)).toBe(1);
    expect(count(detail, /role="tabpanel"/g)).toBe(3);
    expect(count(detail, /hidden=""/g)).toBe(2);
    const lead = render(<FeatureGrid variant="lead" title="x" items={six} />);
    expect(count(lead, /class="kit-tile"/g)).toBe(2);
    expect(count(lead, /class="kit-tile-media"/g)).toBe(2);
    // The four short items share one grouped hairline surface, never four cards.
    expect(lead).toMatch(/<ul class="kit-cells" data-lg="4" data-md="2"[^>]*>(<li class="kit-cell"[^]*?<\/li>){4}<\/ul>/);
    expect(() => render(<FeatureGrid variant="lead" title="x" items={six.slice(0, 5)} />)).toThrow(/exactly 6/);
    expect(() => render(<FeatureGrid variant="detail" title="x" items={six} />)).toThrow(/3 to 5/);
  });

  test("SpecTable grouped and rail", () => {
    const groups = [{ name: "Sensing", note: "Four sensors.", rows: [{ label: "CO2", value: "400 to 5000", unit: "ppm", note: "NDIR" }] }];
    const grouped = render(<SpecTable title="Specs" groups={groups} />);
    expect(grouped).toContain('class="kit-spec-group-head"');
    expect(grouped).toContain("Four sensors.");
    const rail = render(<SpecTable variant="rail" title="Specs" groups={groups} prose={<p>story</p>} />);
    expect(rail).toContain('class="kit-spec-sticky"');
    expect(rail).toContain('class="kit-spec-prose"');
    expect(() => render(<SpecTable variant="rail" title="x" groups={groups} />)).toThrow(/needs prose/);
  });

  test("Quote pull and results; CTABand split, form, band; FAQ split and open", () => {
    expect(render(<Quote quote="q" name="Rina" />)).toContain('data-variant="pull"');
    const results = render(<Quote variant="results" quote="q" name="Rina" metrics={[{ value: "38", unit: "%", caption: "a" }, { value: "4", caption: "b" }]} />);
    expect(results).toContain('class="kit-quote-results"');
    expect(results).toMatch(/class="kit-quote-metrics" data-count="2"/);
    expect(() => render(<Quote variant="results" quote="q" name="x" />)).toThrow(/use 2 or 3/);
    for (const variant of ["split", "band"] as const) {
      const html = render(<CTABand variant={variant} title="Close" actions={<a className="btn" href="#">Buy</a>} proof={<p>proof</p>} />);
      expect(html).toContain(`class="kit-cta" data-variant="${variant}"`);
      expect(html).toContain("proof");
      // The band is its own tone, so it never collapses into a neighbour's padding.
      if (variant === "band") expect(html).toContain('data-tone="band"');
    }
    const form = render(<CTABand variant="form" title="Close" form={<form className="kit-form" />} />);
    expect(form).toContain('<form class="kit-form">');
    expect(() => render(<CTABand variant="form" title="x" />)).toThrow(/needs a form/);
    const items = [1, 2, 3, 4].map((n) => ({ q: `Q${n}`, a: `A${n}` }));
    const open = render(<FAQ variant="open" title="Questions" items={items} />);
    expect(count(open, /<dt class="kit-title">/g)).toBe(4);
    expect(open).not.toContain("<details");
    expect(() => render(<FAQ variant="open" title="x" items={items.slice(0, 3)} />)).toThrow(/even count/);
  });

  test("StickyStory writes a marker per step and both stage sides", () => {
    const steps = [1, 2, 3].map((n) => ({ title: `S${n}`, body: "b", media }));
    const html = render(<StickyStory variant="stage-start" title="How" steps={steps} />);
    expect(html).toContain('class="kit-story" data-variant="stage-start"');
    expect(count(html, /class="kit-story-marker"/g)).toBe(3);
    expect(html).toContain('<div class="kit-story-track" aria-hidden="true">');
    expect(html).toContain("--kit-story-count:3");
    expect(() => render(<StickyStory title="x" steps={[...steps, ...steps]} />)).toThrow(/2 to 5/);
  });

  test("BentoGrid renders a named preset and names it as the variant", () => {
    const html = render(
      <BentoGrid preset="lead-right" title="Week">
        <BentoTile area="a" kind="stat" value="612" unit="ppm" />
        <BentoTile area="b" kind="text" title="t" />
        <BentoTile area="c" kind="media" media={media} />
        <BentoTile area="d" kind="list" items={[]} />
      </BentoGrid>,
    );
    expect(html).toContain('data-kit-composition="bento" data-variant="lead-right"');
    expect(html).toContain("&quot;a b c c&quot;");
    expect(() => bentoPreset(4, "row")).toThrow(/lead-left, lead-right, band/);
  });
});

describe("Bento presets", () => {
  test("three lawful maps per tile count, 3 to 6 tiles, media where rows span, areas in reading order", () => {
    for (const [n, byName] of Object.entries(BENTO_PRESETS)) {
      expect(Object.keys(byName).length).toBe(3);
      for (const [name, p] of Object.entries(byName)) {
        const areas = "abcdef".slice(0, Number(n)).split("");
        const tiles = areas.map((area) => ({ area, kind: (p.media.includes(area) ? "media" : "text") as BentoKind }));
        expect({ n, name, lg: validateBentoLayout(p.lg, tiles, 4) }).toEqual({ n, name, lg: [] });
        expect({ n, name, md: validateBentoLayout(p.md!, tiles, 2) }).toEqual({ n, name, md: [] });
        // Source order is reading order: the first cell of each area, row by row, is a, b, c, ...
        for (const map of [p.lg, p.md!]) {
          const order = [...new Set(map.join(" ").split(/\s+/))];
          expect({ n, name, order }).toEqual({ n, name, order: areas });
        }
      }
    }
  });
});

describe("variety ledger", () => {
  test("rejects adjacent composition and variant repeats", () => {
    const errors = validateVarietyLedger(["masthead.split", "split.inset", "split.inset", "footer.inline"]);
    expect(errors.some((e) => /sections 2 and 3 are both split\.inset/.test(e))).toBe(true);
  });

  test("rejects a composition and variant used more than twice", () => {
    const errors = validateVarietyLedger(["masthead.left", "split.bleed", "quote.pull", "split.bleed", "faq.split", "split.bleed", "footer.inline"]);
    expect(errors).toContain("split.bleed appears 3 times; a composition and variant at most twice");
  });

  test("a marketing page uses at least three compositions, footer excluded", () => {
    expect(validateVarietyLedger(["masthead.left", "split.inset", "footer.inline"])).toContain("a marketing page uses 2 different compositions; at least 3");
    expect(validateVarietyLedger(["custom.header", "bento.grid"], "product")).toEqual([]);
  });

  test("the same composition may return in a new structure, not adjacent", () => {
    expect(validateVarietyLedger(["masthead.split", "split.inset", "quote.pull", "split.bleed", "footer.inline"])).toEqual([]);
  });

  test("validatePageRecipe accepts ledger entries and still runs the composition law", () => {
    expect(validatePageRecipe(["masthead.left", { composition: "split", variant: "bleed" }, "stat-row.chart", "footer.statement"])).toEqual([]);
    const errors = validatePageRecipe(["masthead.left", "stat-row.single", "footer.inline"]);
    expect(errors.some((e) => /big-number hero/.test(e))).toBe(true);
    expect(validatePageRecipe(["custom.hero", "custom.hero", "bento.grid"], "product").some((e) => /custom\.hero/.test(e))).toBe(true);
  });

  test("hand-written sections read back as custom.default and stay exempt from the repeat rules", () => {
    const ledger = ["masthead.left", "custom.default", "custom.default", "custom.default", "bento.grid", "footer.inline"] as const;
    expect(validatePageRecipe([...ledger])).toEqual([]);
    expect(validateVarietyLedger([...ledger])).toEqual([]);
    expect(validatePageRecipe(["custom", { composition: "custom", variant: "default" }, "bento.grid"], "product")).toEqual([]);
    expect(validatePageRecipe(["custom.hero", "custom.hero", "bento.grid"], "product").some((e) => /custom\.hero/.test(e))).toBe(true);
  });

  test("both preview pages keep the law and the ledger", () => {
    for (const ledger of [LANDING_LEDGER, MOTION_LEDGER]) {
      expect(ledger.length).toBeGreaterThanOrEqual(9);
      expect(validatePageRecipe(ledger)).toEqual([]);
      expect(validateVarietyLedger(ledger)).toEqual([]);
    }
  });
});

describe.skipIf(staticRenderer === null)("audit attributes", () => {
  test("page A renders its ledger in order, every top-level section named", () => {
    const html = render(<Landing direction="D1" />);
    expect(sections(html)).toEqual(LANDING_LEDGER as string[]);
    expect(count(html, /<section /g)).toBe(LANDING_LEDGER.length - 1);
  });

  test("readPageLedger reads the rendered attributes in document order", () => {
    if (typeof document === "undefined") return;
    const box = document.createElement("div");
    box.innerHTML = render(<Landing direction="D1" />);
    expect(readPageLedger(box).map((e) => `${e.composition}.${e.variant}`)).toEqual(LANDING_LEDGER as string[]);
  });
});
