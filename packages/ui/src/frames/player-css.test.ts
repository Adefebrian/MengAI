import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const dir = import.meta.dir;
const playerCss = await Bun.file(join(dir, "player.css")).text();
const uiCss = await Bun.file(join(dir, "..", "ui.css")).text();
const DASH = String.fromCharCode(0x2014);
// Rules only: the header comment names the banned things on purpose.
const rules = playerCss.replace(/\/\*[\s\S]*?\*\//g, "");

describe("player.css", () => {
  test("is copied verbatim into ui.css", () => {
    expect(uiCss.includes(playerCss.trim())).toBe(true);
  });

  test("uses tokens only: no gradient, shadow, raw hex, emoji, or long dash", () => {
    expect(rules).not.toMatch(/gradient/i);
    expect(rules).not.toMatch(/shadow/i);
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(playerCss).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(playerCss.includes(DASH)).toBe(false);
  });

  test("controls are 44px and use the control boundary token", () => {
    expect(playerCss).toMatch(/\.frames-toggle\s*\{[^}]*height:\s*var\(--control-h\)/);
    expect(playerCss).toMatch(/\.frames-scrub\s*\{[^}]*height:\s*var\(--control-h\)/);
    expect(playerCss).toContain("var(--color-border-control)");
  });
});
