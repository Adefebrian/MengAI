import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "..", "kit.css"), "utf8");
const marker = css.indexOf("2. Component layer (var() only");
const knobs = css.slice(0, marker);
const components = css.slice(marker);
const EM_DASH = String.fromCharCode(0x2014);

function hue(hex: string): { h: number; s: number } {
  const v = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c) : [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)];
  const [r, g, b] = v.map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s };
}

describe("kit.css law", () => {
  test("has the component-layer marker", () => {
    expect(marker).toBeGreaterThan(0);
  });

  test("no gradients, no blur, no glow, no transparency fades", () => {
    expect(css).not.toMatch(/gradient/i);
    expect(css).not.toMatch(/filter\s*:|backdrop-filter|drop-shadow|text-shadow|glow|mask-image/i);
  });

  test("box-shadow only ever none", () => {
    for (const m of css.matchAll(/box-shadow\s*:\s*([^;]+);/g)) expect(m[1].trim()).toBe("none");
  });

  test("no purple family: no named hues and no hex in HSL 235 to 330", () => {
    expect(css).not.toMatch(/purple|violet|indigo|magenta|fuchsia|lavender|orchid|plum/i);
    for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
      const { h, s } = hue(m[0]);
      if (s > 0.08) expect({ hex: m[0], inBan: h >= 235 && h <= 330 }).toEqual({ hex: m[0], inBan: false });
    }
  });

  test("no em-dash anywhere in the kit", () => {
    expect(css.includes(EM_DASH)).toBe(false);
    for (const f of readdirSync(import.meta.dir)) {
      if (/\.(tsx?|css)$/.test(f)) expect({ f, dash: readFileSync(join(import.meta.dir, f), "utf8").includes(EM_DASH) }).toEqual({ f, dash: false });
    }
  });

  test("the component layer reads tokens only: no raw hex, no raw font sizes", () => {
    expect(components).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    for (const m of components.matchAll(/font-size\s*:\s*([^;]+);/g)) expect(m[1]).toMatch(/^var\(--(text-|kit-)/);
    for (const m of components.matchAll(/line-height\s*:\s*([^;]+);/g)) expect(m[1]).toMatch(/^var\(--(line-|kit-)/);
  });

  test("five type roles only: display, heading, title (19), body (16), meta (13)", () => {
    const sizes = new Set([...components.matchAll(/font-size\s*:\s*var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
    const allowed = new Set(["--kit-display-size", "--kit-display-sm-size", "--kit-display-md-size", "--kit-display-lg-size", "--kit-heading-sm-size", "--kit-heading-lg-size", "--text-1", "--text-0", "--text-n1"]);
    for (const s of sizes) expect({ s, allowed: allowed.has(s) }).toEqual({ s, allowed: true });
  });

  test("no side lines: no inline-start or inline-end border at all", () => {
    expect(css).not.toMatch(/border-(left|right|inline-start|inline-end)\s*:/);
  });

  test("no eyebrow machinery: no uppercase transforms or tracked-out caps", () => {
    expect(css).not.toMatch(/text-transform\s*:\s*uppercase/i);
    expect(css).not.toMatch(/letter-spacing\s*:\s*0?\.\d+em/);
  });

  test("no space-between or flex-grow fill on rows", () => {
    expect(css).not.toMatch(/space-between|flex-grow/);
  });

  test("every direction D1 to D13 has a knob block, and D13 needs an explicit dark theme", () => {
    for (let i = 1; i <= 13; i++) expect(knobs).toContain(`[data-direction="D${i}"]`);
    expect(knobs).toContain('[data-direction="D13"][data-theme="dark"]');
    expect(knobs).not.toMatch(/prefers-color-scheme/);
  });

  test("the display size is the direction's step capped by measure, never larger", () => {
    const display = rules(components).find((r) => r.selector === ".kit-display");
    expect(display?.body).toMatch(/--kit-display-size:\s*min\(var\(--kit-display-step\), var\(--kit-display-fit\), 100cqi \/ 6\);/);
    expect(display?.body).toMatch(/font-size:\s*var\(--kit-display-size\);/);
    expect(css).toMatch(/\.kit-masthead-text \{\s*container-type: inline-size;/);
  });

  test("the accent fills only the conversion actions, never every primary", () => {
    for (const d of ["D2", "D9"]) {
      const at = knobs.indexOf(`[data-direction="${d}"]`);
      const block = knobs.slice(at, knobs.indexOf("}", at));
      expect(block).not.toMatch(/--color-primary:/);
      expect(block).toMatch(/--kit-action: var\(--color-accent\);/);
    }
  });

  test("the motion layer hides only a pending state, and only without reduced motion", () => {
    const hide = components.match(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(hide).toContain('[data-motion-state="pending"]');
    // The pending state never moves the box: the rise plays only after reveal.
    const pending = rules(components).find((r) => r.selector.includes('[data-motion-state="pending"]'));
    expect(pending?.body).not.toMatch(/transform/);
    for (const r of rules(components)) {
      if (/opacity:\s*0\s*;/.test(r.body)) expect({ sel: r.selector, ok: /data-motion-state="pending"|kit-story-frame|^from$/.test(r.selector) }).toEqual({ sel: r.selector, ok: true });
    }
  });

  test("proximity: related gaps are smaller than item insets, insets smaller than group gaps", () => {
    const px = (v: string) => Number(v.match(/--space-(\d+)px/)?.[1] ?? NaN);
    const blocks = rules(css).filter((r) => r.selector.includes(".kit-page") && r.body.includes("--kit-gap-related"));
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const base = decls(blocks[0].body);
    expect(px(base["--kit-gap-inside"])).toBeLessThan(px(base["--kit-gap-related"]));
    expect(px(base["--kit-gap-related"])).toBeLessThan(px(base["--kit-inset"]));
    expect(px(base["--kit-inset"])).toBeLessThan(px(base["--kit-gap-group"]));
  });

  test("reduced motion collapses the story and the chevron", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.kit-story-frame/);
  });
});

/* Strip comments, then split a CSS text into flat { selector, body } rules.
   Good enough for kit.css: nested at-rules yield their inner rules, with the
   at-rule prelude folded into the first inner selector, so selectors are
   matched with includes() or trimmed at the last newline. */
function rules(text: string): { selector: string; body: string }[] {
  const flat = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; body: string }[] = [];
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1].split(";").pop() ?? "").replace(/^[\s\S]*@media[^{]*\{/, "").trim().replace(/\s+/g, " ");
    out.push({ selector, body: m[2] });
  }
  return out;
}

function decls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const allRules = rules(css);

describe("kit.css masthead grid", () => {
  const selectors = allRules.map((r) => r.selector);
  const count = (s: string) => selectors.filter((x) => x.split(/\s*,\s*/).includes(s)).length;

  test("each masthead proof placement is scoped to its variant, once", () => {
    expect(count('.kit-masthead[data-variant="left"] .kit-masthead-proof')).toBe(1);
    expect(count('.kit-masthead[data-variant="centered"] .kit-masthead-proof')).toBe(1);
    expect(count('.kit-masthead[data-variant="split"] .kit-masthead-proof')).toBe(1);
    const centered = allRules.find((r) => r.selector === '.kit-masthead[data-variant="centered"] .kit-masthead-proof');
    expect(centered?.body).toContain("grid-column: 3 / span 8");
  });

  test("the wordmark rule exists once and the base proof rule once", () => {
    expect(count(".kit-masthead[data-variant] .kit-masthead-text:has(.kit-wordmark)")).toBe(1);
    expect(count(".kit-masthead-proof")).toBe(1);
  });

  test("no selector repeats .kit-masthead[ twice (a spliced paste)", () => {
    for (const s of selectors) {
      for (const part of s.split(/\s*,\s*/)) {
        expect({ part, n: part.split(".kit-masthead[").length - 1 <= 1 }).toEqual({ part, n: true });
      }
    }
  });
});

describe("kit.css prose links", () => {
  const link = allRules.filter((r) => /\ba\b[^,]*\{?/.test(r.selector) && r.body.includes("var(--kit-link)") && r.body.includes("text-underline-offset"));

  test("the prose link rule is zero class specificity and never reaches nav or footer links", () => {
    expect(link.length).toBe(1);
    const sel = link[0].selector;
    // Everything but the bare `a` type selector sits inside :where().
    const outside = sel.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, "").replace(/\s+/g, " ").trim();
    expect(outside).toBe("a");
    for (const banned of [".shell-nav-item", ".kit-footer-links"]) {
      const scope = sel.match(/:where\(([^()]*)\)/g)?.find((w) => w.includes(".kit-lead")) ?? "";
      expect(scope.includes(banned)).toBe(false);
    }
    expect(sel).not.toMatch(/^\.kit-page a/);
    expect(sel).toContain(".btn");
  });

  test("no rule anywhere styles every link on the page", () => {
    for (const r of allRules) expect(r.selector).not.toMatch(/(^|,\s*)\.kit-page a(:not\([^)]*\))?\s*($|,)/);
  });
});

describe("direction contrast (WCAG 2.x, text roles need 4.5:1)", () => {
  const tokens = readFileSync(join(import.meta.dir, "..", "tokens.css"), "utf8");
  const base = { ...decls(rules(tokens).find((r) => r.selector === ":root")?.body ?? "") };
  for (const r of rules(knobs)) if (r.selector === ":root") Object.assign(base, decls(r.body));

  function lum(hex: string): number {
    const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = v.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function ratio(a: string, b: string): number {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }
  function resolve(vars: Record<string, string>, name: string, depth = 0): string {
    const v = vars[name];
    if (!v || depth > 8) throw new Error(`unresolved ${name}`);
    const ref = v.match(/^var\((--[a-z0-9-]+)\)$/);
    if (ref) return resolve(vars, ref[1], depth + 1);
    const hex = v.match(/^#[0-9a-f]{6}$/i);
    if (!hex) throw new Error(`${name} is not a plain hex: ${v}`);
    return hex[0].toLowerCase();
  }

  for (let i = 1; i <= 13; i++) {
    test(`D${i}: ink, ink-muted, ink-subtle, accent, and link read at 4.5:1`, () => {
      const sel = i === 13 ? '[data-direction="D13"][data-theme="dark"]' : `[data-direction="D${i}"]`;
      const block = rules(knobs).find((r) => r.selector === sel);
      expect(block).toBeDefined();
      const vars = { ...base, ...decls(block!.body) };
      const grounds = ["--color-page", "--color-surface", "--color-layer-1"];
      const inks = ["--color-ink", "--color-ink-muted", "--color-ink-subtle", "--kit-link", "--kit-signal"];
      for (const g of grounds) {
        for (const t of inks) {
          const r = ratio(resolve(vars, t), resolve(vars, g));
          expect({ d: `D${i}`, t, g, ok: r >= 4.5 }).toEqual({ d: `D${i}`, t, g, ok: true });
        }
      }
      for (const g of ["--color-page", "--color-surface"]) {
        const r = ratio(resolve(vars, "--color-accent"), resolve(vars, g));
        expect({ d: `D${i}`, t: "--color-accent", g, ok: r >= 4.5 }).toEqual({ d: `D${i}`, t: "--color-accent", g, ok: true });
      }
    });
  }
});

describe("kit.css layout regressions", () => {
  test("a contained shell's sticky story stage ignores the header height", () => {
    const r = allRules.find((x) => x.selector === '.shell[data-scroll="contained"] .kit-story-stage');
    expect(r).toBeDefined();
    expect(r!.body).toMatch(/top\s*:/);
    expect(r!.body).not.toContain("--shell-header-h");
  });

  test("the compare table keeps a readable floor from 768 and shows one plan below it", () => {
    const base = allRules.find((x) => x.selector === ".kit-compare-table");
    expect(base?.body).not.toMatch(/min-inline-size/);
    expect(css).toMatch(/@media \(min-width: 768px\)\s*\{[^@]*\.kit-compare-table\s*\{\s*min-inline-size\s*:\s*36rem/);
    expect(allRules.find((x) => x.selector === ".kit-compare-table [data-off]")?.body).toMatch(/display\s*:\s*none/);
    for (const r of allRules.filter((x) => x.selector.includes(".kit-compare-table"))) {
      expect(r.body).not.toMatch(/overflow-wrap\s*:\s*anywhere|word-break\s*:\s*break-all/);
    }
  });
});
