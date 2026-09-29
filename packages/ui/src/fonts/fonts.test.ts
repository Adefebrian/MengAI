import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// The vendored default faces (Geist Sans, Geist Mono) and the font tokens
// that read them. Rules: skills/jal-design-system/references/typography.md.

const dir = import.meta.dir;
const src = join(dir, "..");
const fontsCss = readFileSync(join(dir, "fonts.css"), "utf8");
const tokens = readFileSync(join(src, "tokens.css"), "utf8");
const kit = readFileSync(join(src, "kit.css"), "utf8");
const EM_DASH = String.fromCharCode(0x2014);

function faces(css: string) {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const body = m[1];
    const get = (p: string) => body.match(new RegExp(`${p}\\s*:\\s*([^;]+);`))?.[1].trim();
    return { body, family: get("font-family")?.replace(/"/g, ""), src: get("src") ?? "", display: get("font-display") };
  });
}

describe("vendored fonts", () => {
  test("only the two variable woff2 files, the OFL, and the CSS are vendored, and they stay small", () => {
    const files = readdirSync(dir).filter((f) => !f.endsWith(".test.ts")).sort();
    expect(files).toEqual(["Geist-Variable.woff2", "GeistMono-Variable.woff2", "OFL.txt", "fonts.css"]);
    let bytes = 0;
    for (const f of ["Geist-Variable.woff2", "GeistMono-Variable.woff2"]) {
      const b = readFileSync(join(dir, f));
      expect(b.subarray(0, 4).toString("latin1")).toBe("wOF2");
      bytes += statSync(join(dir, f)).size;
    }
    expect(bytes).toBeLessThan(160_000);
  });

  test("the license is the SIL Open Font License 1.1 with the Geist copyright", () => {
    const ofl = readFileSync(join(dir, "OFL.txt"), "utf8");
    expect(ofl).toContain("Copyright (c) 2023 Vercel, in collaboration with basement.studio");
    expect(ofl).toContain("SIL Open Font License, Version 1.1");
  });

  test("webfont faces swap, and every url() is /fonts/<a vendored file>", () => {
    const web = faces(fontsCss).filter((f) => f.src.includes("url("));
    expect(web.map((f) => f.family).sort()).toEqual(["Geist", "Geist Mono"]);
    for (const f of web) {
      expect(f.display).toBe("swap");
      expect(f.body).toMatch(/font-weight:\s*100 900;/);
      const urls = [...f.src.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
      expect(urls.length).toBe(1);
      // Absolute, so a bundler keeps it external and never inlines it as base64.
      expect(urls[0]).toMatch(/^\/fonts\/[A-Za-z0-9-]+\.woff2$/);
      expect(() => statSync(join(dir, urls[0].slice("/fonts/".length)))).not.toThrow();
    }
  });

  test("the web build keeps /fonts external, copies the files, and preloads both faces", () => {
    const web = join(src, "..", "..", "..", "apps", "web");
    const build = readFileSync(join(web, "build.ts"), "utf8");
    expect(build).toContain('external: ["/fonts/*"]');
    expect(build).toMatch(/copyFonts\(\)/);
    const html = readFileSync(join(web, "src", "index.html"), "utf8");
    for (const f of ["Geist-Variable.woff2", "GeistMono-Variable.woff2"]) {
      expect(html).toContain(`<link rel="preload" href="/fonts/${f}" as="font" type="font/woff2" crossorigin />`);
    }
  });

  test("each face has a metric-matched local fallback with all four overrides", () => {
    const fallbacks = faces(fontsCss).filter((f) => f.src.startsWith("local("));
    expect(fallbacks.map((f) => f.family).sort()).toEqual(["Geist Fallback", "Geist Mono Fallback"]);
    for (const f of fallbacks) {
      for (const p of ["size-adjust", "ascent-override", "descent-override", "line-gap-override"]) expect(f.body).toMatch(new RegExp(`${p}:\\s*[0-9.]+%;`));
    }
  });

  test("tokens.css imports the faces first and names Geist first in every family token", () => {
    const firstRule = tokens.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    expect(firstRule.startsWith('@import "./fonts/fonts.css";')).toBe(true);
    expect(tokens).toMatch(/--font-sans:\s*"Geist", "Geist Fallback",/);
    expect(tokens).toMatch(/--font-mono:\s*"Geist Mono", "Geist Mono Fallback",/);
    expect(tokens).toMatch(/--font-display:\s*var\(--font-sans\);/);
    expect(tokens).toMatch(/--font-numeric:\s*tabular-nums slashed-zero;/);
  });

  test("every direction names a pairing whose stacks end in the Geist stack", () => {
    for (let i = 1; i <= 13; i++) {
      const open = i === 13 ? '[data-direction="D13"][data-theme="dark"] {' : `[data-direction="D${i}"] {`;
      const at = kit.indexOf(open);
      expect(at).toBeGreaterThan(0);
      const block = kit.slice(at, kit.indexOf("}", at));
      for (const role of ["sans", "display", "mono"]) {
        const v = block.match(new RegExp(`--kit-font-${role}:\\s*([^;]+);`))?.[1];
        expect({ d: i, role, set: Boolean(v) }).toEqual({ d: i, role, set: true });
        expect({ d: i, role, geistLast: /var\(--font-(sans|mono)\)$/.test(v!.trim()) }).toEqual({ d: i, role, geistLast: true });
      }
      // The text role is Geist in every preset; only the display may name a pool face.
      expect(block).toMatch(/--kit-font-sans:\s*var\(--font-sans\);/);
      expect(block).toMatch(/--kit-font-mono:\s*var\(--font-mono\);/);
    }
  });

  test("no em-dash in the font files", () => {
    expect(fontsCss.includes(EM_DASH)).toBe(false);
  });
});
