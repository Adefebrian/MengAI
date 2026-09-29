// Guard for cats.css: the JAL law checks a stylesheet can fail on its own.
import { describe, expect, test } from "bun:test";
import { CROSSFADE_MS, QUIRK_MS, TAP_MS } from "./motion";

// cats.css and every stylesheet it imports (card/card.css).
const main = await Bun.file(new URL("./cats.css", import.meta.url)).text();
const imported = [...main.matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1]!);
const parts = [main, ...(await Promise.all(imported.map((p) => Bun.file(new URL(p, import.meta.url)).text())))];
const css = parts.join("\n");
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

function keyframeBlocks(src: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = re.lastIndex;
    while (depth > 0 && i < src.length) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    out.push({ name: m[1]!, body: src.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

function hue(hex: string): { h: number; s: number } {
  const v = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c).join("") : hex.slice(1, 7);
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h, s };
}

describe("cats.css law guard", () => {
  test("reads the card stylesheet too", () => {
    expect(imported).toEqual(["./card/card.css"]);
    expect(code).toContain(".cat-card-layout");
  });

  test("no gradient, shadow, blur, or glow", () => {
    expect(code).not.toMatch(/gradient|box-shadow|drop-shadow|text-shadow|filter\s*:|backdrop-filter|blur\(/i);
  });

  test("no side lines or accent bars", () => {
    expect(code).not.toMatch(/border-(left|right|top|bottom|inline|block)[\w-]*\s*:/i);
    expect(code).not.toMatch(/::?(before|after)/);
  });

  test("no em-dash and no emoji", () => {
    expect(css.includes(String.fromCharCode(0x2014))).toBe(false);
    expect(/\p{Extended_Pictographic}/u.test(css)).toBe(false);
  });

  test("no purple, violet or indigo in the art palette", () => {
    for (const hex of code.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) ?? []) {
      const { h, s } = hue(hex);
      expect({ hex, purple: s > 0.2 && h >= 235 && h <= 330 }).toEqual({ hex, purple: false });
    }
  });

  test("keyframes move transform and opacity only", () => {
    const blocks = keyframeBlocks(code);
    expect(blocks.length).toBeGreaterThan(20);
    for (const { name, body } of blocks) {
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect({ name, p, ok: p === "transform" || p === "opacity" }).toEqual({ name, p, ok: true });
    }
  });

  test("every animation names a keyframe that exists", () => {
    const names = new Set(keyframeBlocks(code).map((b) => b.name));
    for (const m of code.matchAll(/animation\s*:\s*([\w-]+)/g)) {
      if (m[1] === "none") continue;
      expect({ name: m[1], known: names.has(m[1]!) }).toEqual({ name: m[1], known: true });
    }
  });

  test("transitions name their properties: transform, opacity, background-color, never all", () => {
    const rules = [...code.matchAll(/transition\s*:\s*([^;]+);/g)].map((m) => m[1]!);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      if (rule.trim() === "none !important") continue;
      for (const part of rule.split(",")) {
        const prop = part.trim().split(/\s+/)[0];
        expect(["transform", "opacity", "background-color"]).toContain(prop);
      }
    }
  });

  test("durations and easing come from tokens, linear and steps only for loops", () => {
    for (const m of code.matchAll(/cubic-bezier|ease-in|ease-out|ease-in-out/g)) expect(m[0]).toBe("never");
    for (const m of code.matchAll(/(?:animation|transition)[^;]*?\b(\d+(?:\.\d+)?)m?s\b/g)) {
      throw new Error(`raw duration in: ${m[0]}`);
    }
  });

  test("reduced motion is handled in CSS as well as in the component", () => {
    expect(code).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  test("type and spacing use tokens", () => {
    for (const m of code.matchAll(/font-size\s*:\s*([^;]+);/g)) expect(m[1]).toMatch(/^var\(--text-/);
    for (const m of code.matchAll(/(?:^|[\s;{])(padding|margin|gap|row-gap|column-gap)[\w-]*\s*:\s*([^;]+);/g)) {
      expect({ rule: m[0].trim(), raw: /\d+px/.test(m[2]!.replace(/var\([^)]*\)/g, "")) }).toEqual({ rule: m[0].trim(), raw: false });
    }
  });

  test("JS timers mirror the CSS timings", () => {
    expect(code).toContain(`--cat-quirk: ${QUIRK_MS}ms`);
    expect(CROSSFADE_MS).toBe(300);
    expect(code).toContain("cat-fade-in var(--dur-300)");
    expect(TAP_MS).toBe(300);
    expect(code).toContain("cat-tap var(--dur-300)");
  });
});
