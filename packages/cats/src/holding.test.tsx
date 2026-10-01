// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The two host controls the island stage uses: `holding` (the one object a
// cat holds, over its beat's own and the role's aside) and `playQuirk` (one
// quirk on demand, in any pose). Both are optional: without them a cat
// renders exactly as before. Nothing either draws leaves the 160 x 160 box.
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AGENT_ROLES, type Activity, type AgentStatus } from "@mengai/shared";
import { Cat, type CatProps } from "./index";
import { QUIRKS, QUIRK_MS } from "./motion";
import { AsideArt } from "./props";
import { BEATS, BEAT_PROP, ROLE_PROP, SIT, asideFor, heldFor, type PropId } from "./poses";
import { emulateReducedMotion, motionClasses, mount, wait, type Mounted } from "./test-kit";

const PROPS: readonly PropId[] = ["terminal", "page", "magnifier", "canvas", "spyglass", "shield", "clipboard", "card", "bugcard", "runbook"];

function props(over: Partial<CatProps> = {}): CatProps {
  return {
    look: { coat: "ginger", seed: 1234 },
    role: "engineer",
    status: "waiting",
    activity: "ask",
    mood: "calm",
    label: "Kopi, Engineer, asking you",
    ...over,
  };
}

function render(over: Partial<CatProps>): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<Cat {...props(over)} />);
  return host;
}

let mounted: Mounted | null = null;
let restore: (() => void) | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  restore?.();
  restore = null;
});

describe("heldFor: the cat shows exactly one object", () => {
  test("without holding the rig keeps its own choice", () => {
    for (const beat of BEATS) {
      for (const role of AGENT_ROLES) {
        expect(heldFor(beat, role, undefined)).toEqual({ aside: asideFor(beat, role), beatArt: true });
        expect(heldFor(beat, role, null)).toEqual({ aside: asideFor(beat, role), beatArt: true });
      }
    }
  });

  test("with holding, every beat shows that object once: in its art or in the corner, never both, never another", () => {
    for (const beat of BEATS) {
      for (const role of AGENT_ROLES) {
        for (const prop of PROPS) {
          const held = heldFor(beat, role, prop);
          const own = BEAT_PROP[beat];
          const shown = [held.beatArt ? own : null, held.aside].filter((p) => p !== null);
          expect({ beat, role, prop, shown }).toEqual({ beat, role, prop, shown: [prop] });
        }
      }
    }
  });
});

describe("holding", () => {
  test("an asking cat holds the object of the ask in the free corner, not its role's own", () => {
    const plain = render({});
    expect(plain.querySelector(".cat-aside[data-on]")).not.toBeNull();
    expect(plain.querySelector(".cat-aside[data-held]")).toBeNull();
    expect(plain.querySelector(".cat")!.hasAttribute("data-holding")).toBe(false);
    for (const prop of PROPS) {
      const host = render({ holding: prop });
      expect(host.querySelector(".cat")!.getAttribute("data-holding")).toBe(prop);
      expect(host.querySelector(".cat-aside[data-on]")?.getAttribute("data-held")).toBe(prop);
      // the ask gesture (paw up with its flag) stays
      expect(host.querySelector(".cat-arm[data-on]")).not.toBeNull();
      expect(host.querySelector(".cat-flag")).not.toBeNull();
    }
  });

  test("holding the object the beat already works with leaves the corner empty", () => {
    const host = render({ status: "working", activity: "handoff", holding: "card" });
    expect(host.querySelector(".cat-toss")).not.toBeNull();
    expect(host.querySelector(".cat-aside[data-on]")).toBeNull();
  });

  test("a beat working with another object gives it way: no beat art, paws at rest, the held object in the corner", () => {
    const host = render({ role: "security", status: "working", activity: "review", holding: "bugcard" });
    expect(host.querySelector(".cat")!.getAttribute("data-beat")).toBe("review-flag");
    expect(host.querySelector(".cat-layer")).toBeNull();
    expect(host.querySelector(".cat-aside[data-on]")?.getAttribute("data-held")).toBe("bugcard");
    for (const paw of host.querySelectorAll(".cat-paw")) expect(paw.getAttribute("style")).toContain("translate(0px, 0px)");
    // the researcher's spyglass paw comes back to the body when the spyglass gives way
    const spy = render({ role: "researcher", status: "working", activity: "research", holding: "page" });
    expect(spy.querySelector(".cat-paw-r")!.hasAttribute("data-off")).toBe(false);
  });

  test("a lying cat holds it at its right side", () => {
    const stopped = render({ status: "stopped", activity: "rest", holding: "shield" });
    expect(stopped.querySelector(".cat-aside-lie .cat-aside[data-on]")?.getAttribute("data-held")).toBe("shield");
    const done = render({ status: "idle", activity: "celebrate", holding: "card", still: true });
    expect(done.querySelector(".cat-aside-lie .cat-aside[data-on]")?.getAttribute("data-held")).toBe("card");
  });

  test("null and absent render the same cat, for every role and pose", () => {
    for (const role of AGENT_ROLES) {
      for (const activity of ["ask", "think", "code", "review", "handoff", "celebrate"] as Activity[]) {
        for (const status of ["working", "stopped"] as AgentStatus[]) {
          const a = renderToStaticMarkup(<Cat {...props({ role, activity, status, still: true })} />);
          const b = renderToStaticMarkup(<Cat {...props({ role, activity, status, still: true, holding: null })} />);
          expect(b).toBe(a);
        }
      }
    }
  });

  test("a still cat holds its object with no motion class", () => {
    const host = render({ holding: "terminal", still: true });
    expect(motionClasses(host)).toEqual([]);
    expect(host.querySelector(".cat-aside[data-on]")?.getAttribute("data-held")).toBe("terminal");
  });
});

describe("playQuirk", () => {
  const root = () => mounted!.host.querySelector(".cat")!;

  test("plays once whenever the key changes, never on mount, outside the idle poses", async () => {
    restore = emulateReducedMotion(false);
    mounted = mount(<Cat {...props({ status: "working", activity: "think", playQuirk: { quirk: "twitch", key: 0 } })} />);
    expect(root().className).not.toContain("cat-quirk-");
    mounted.render(<Cat {...props({ status: "working", activity: "think", playQuirk: { quirk: "twitch", key: 1 } })} />);
    expect(root().classList.contains("cat-quirk-twitch")).toBe(true);
    // the same key again plays nothing new
    mounted.render(<Cat {...props({ status: "working", activity: "think", playQuirk: { quirk: "twitch", key: 1 } })} />);
    await wait(QUIRK_MS + 80);
    expect(root().className).not.toContain("cat-quirk-");
  });

  test("a key arriving after mount plays, for every quirk", () => {
    restore = emulateReducedMotion(false);
    for (const quirk of QUIRKS) {
      mounted = mount(<Cat {...props({ status: "working", activity: "code" })} />);
      expect(root().className).not.toContain("cat-quirk-");
      mounted.render(<Cat {...props({ status: "working", activity: "code", playQuirk: { quirk, key: 7 } })} />);
      expect(root().classList.contains(`cat-quirk-${quirk}`)).toBe(true);
      mounted.unmount();
      mounted = null;
    }
  });

  test("reduced motion and still never play it", () => {
    restore = emulateReducedMotion(true);
    mounted = mount(<Cat {...props({ playQuirk: { quirk: "yawn", key: 0 } })} />);
    mounted.render(<Cat {...props({ playQuirk: { quirk: "yawn", key: 1 } })} />);
    expect(motionClasses(mounted.host)).toEqual([]);
    mounted.unmount();
    restore();
    restore = emulateReducedMotion(false);
    mounted = mount(<Cat {...props({ still: true, playQuirk: { quirk: "yawn", key: 0 } })} />);
    mounted.render(<Cat {...props({ still: true, playQuirk: { quirk: "yawn", key: 1 } })} />);
    expect(motionClasses(mounted.host)).toEqual([]);
  });

  test("a raised arm keeps its paw: the sitting rig marks it so a quirk never pulls the paw off the arm", () => {
    for (const activity of ["ask", "think"] as Activity[]) {
      expect(render({ activity }).querySelector(".cat-sit")!.hasAttribute("data-arm")).toBe(true);
    }
    expect(render({ activity: "rest" }).querySelector(".cat-sit")!.hasAttribute("data-arm")).toBe(false);
  });
});

/* ---------------------------------------------------------------------
 * Nothing leaves the viewBox
 * ------------------------------------------------------------------- */

const VIEW = 160;
/** Half the widest line a prop is drawn with: 3.34 is half of --cat-sw at size 24, the thickest. */
const LINE = 3.34;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function grow(b: Box, x: number, y: number, pad: number) {
  b.x0 = Math.min(b.x0, x - pad);
  b.y0 = Math.min(b.y0, y - pad);
  b.x1 = Math.max(b.x1, x + pad);
  b.y1 = Math.max(b.y1, y + pad);
}

/** translate(a b) and scale(s) from the element up to the svg, applied to one point. */
function place(el: Element, x: number, y: number): [number, number] {
  let px = x;
  let py = y;
  for (let n: Element | null = el.parentElement; n && n.tagName.toLowerCase() !== "svg"; n = n.parentElement) {
    const t = n.getAttribute("transform");
    if (!t) continue;
    const ops = [...t.matchAll(/(translate|scale)\(([^)]*)\)/g)].reverse();
    for (const [, op, args] of ops) {
      const v = args!.split(/[\s,]+/).filter(Boolean).map(Number);
      if (op === "scale") {
        px *= v[0]!;
        py *= v[1] ?? v[0]!;
      } else {
        px += v[0]!;
        py += v[1] ?? 0;
      }
    }
  }
  return [px, py];
}

/** A conservative box of everything drawn: geometry plus half its line. */
function drawnBox(svg: Element, dx = 0): Box {
  const b: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const num = (el: Element, a: string) => Number(el.getAttribute(a) ?? 0);
  for (const el of svg.querySelectorAll("rect, circle, ellipse, path")) {
    const pad = el.hasAttribute("stroke-width") ? num(el, "stroke-width") / 2 : LINE;
    const pts: Array<[number, number]> = [];
    const tag = el.tagName.toLowerCase();
    if (tag === "rect") {
      const [x, y, w, h] = [num(el, "x"), num(el, "y"), num(el, "width"), num(el, "height")];
      pts.push([x, y], [x + w, y + h]);
    } else if (tag === "circle") {
      const [cx, cy, r] = [num(el, "cx"), num(el, "cy"), num(el, "r")];
      pts.push([cx - r, cy - r], [cx + r, cy + r]);
    } else if (tag === "ellipse") {
      const [cx, cy, rx, ry] = [num(el, "cx"), num(el, "cy"), num(el, "rx"), num(el, "ry")];
      pts.push([cx - rx, cy - ry], [cx + rx, cy + ry]);
    } else {
      const d = el.getAttribute("d") ?? "";
      expect({ d, absolute: /[mlhvcsqtaz]/.test(d) }).toEqual({ d, absolute: false });
      const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i]!, n[i + 1]!]);
    }
    for (const [x, y] of pts) {
      const [px, py] = place(el, x, y);
      grow(b, px + dx, py, pad);
    }
  }
  return b;
}

function inside(b: Box): boolean {
  return b.x0 >= 0 && b.y0 >= 0 && b.x1 <= VIEW && b.y1 <= VIEW;
}

describe("nothing a held object draws leaves the viewBox", () => {
  test("every prop in the sitting corner and at the lying rig's right side (translate 112)", () => {
    for (const id of PROPS) {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(
        <svg viewBox="0 0 160 160">
          <AsideArt id={id} />
        </svg>,
      );
      const svg = host.querySelector("svg")!;
      const sit = drawnBox(svg);
      const lie = drawnBox(svg, 112);
      expect({ id, sit: inside(sit), lie: inside(lie) }).toEqual({ id, sit: true, lie: true });
      // the corner the rig keeps free for it, x 8..44 and y 114..148, give or take half its widest line (4)
      expect({ id, corner: sit.x0 >= 4 && sit.x1 <= 48 && sit.y0 >= 110 && sit.y1 <= 152 }).toEqual({ id, corner: true });
    }
  });

  test("every held object, in every beat and role, renders inside the cat's own box", () => {
    for (const role of AGENT_ROLES) {
      for (const prop of PROPS) {
        const host = render({ role, holding: prop, still: true });
        const svg = host.querySelector("svg")!;
        expect(svg.getAttribute("viewBox")).toBe("0 0 160 160");
        const aside = host.querySelector(".cat-aside[data-on]")!;
        const wrap = document.createElement("div");
        wrap.innerHTML = `<svg viewBox="0 0 160 160">${aside.outerHTML}</svg>`;
        expect({ role, prop, ok: inside(drawnBox(wrap.querySelector("svg")!)) }).toEqual({ role, prop, ok: true });
      }
    }
  });
});

const css = await Bun.file(new URL("./cats.css", import.meta.url)).text();

describe("a quirk on demand keeps every paw inside the viewBox", () => {

  /** Every translate offset a keyframe moves a paw by. */
  function offsets(name: string): Array<[number, number]> {
    const at = css.indexOf(`@keyframes ${name} {`);
    expect(at).toBeGreaterThan(-1);
    const body = css.slice(at, css.indexOf("\n}", at));
    const out: Array<[number, number]> = [[0, 0]];
    for (const m of body.matchAll(/translate\((-?[\d.]+)(?:px)?,\s*(-?[\d.]+)(?:px)?\)/g)) out.push([Number(m[1]), Number(m[2])]);
    for (const m of body.matchAll(/translateY\((-?[\d.]+)(?:px)?\)/g)) out.push([0, Number(m[1])]);
    return out;
  }

  test("groom, bat and knead on top of every sitting beat's paws (a raised arm keeps its paw)", () => {
    const right = [...offsets("cat-groom-paw"), ...offsets("cat-bat-paw"), ...offsets("cat-knead-r")];
    const left = offsets("cat-knead-l");
    expect(css).toMatch(/\.cat-sit\[data-arm\] \.cat-q-paw-r\s*\{\s*animation: none;/);
    for (const [beat, spec] of Object.entries(SIT)) {
      const moves: Array<{ side: "l" | "r"; base: readonly [number, number]; q: Array<[number, number]> }> = [
        { side: "l", base: spec.pawL, q: left },
        { side: "r", base: spec.pawR, q: spec.arm ? [[0, 0]] : right },
      ];
      for (const { side, base, q } of moves) {
        for (const [qx, qy] of q) {
          const cx = (side === "l" ? 68 : 92) + base[0] + qx;
          const cy = 144 + base[1] + qy;
          const ok = cx - 9 >= 0 && cx + 9 <= VIEW && cy - 6 >= 0 && cy + 6 <= VIEW;
          expect({ beat, side, qx, qy, ok }).toEqual({ beat, side, qx, qy, ok: true });
        }
      }
    }
  });

  test("the svg clips to its box and the stage contains its paint, the last guard", () => {
    expect(css).toMatch(/\.cat-svg\s*\{[^}]*overflow: hidden;/);
    expect(css).toMatch(/\.cat-stage\s*\{[^}]*contain: layout paint;/);
  });
});

test("the role's own object is still the default aside", () => {
  for (const role of AGENT_ROLES) {
    const host = render({ role });
    expect(host.querySelector(".cat-aside[data-on]")).not.toBeNull();
    expect(asideFor("ask", role)).toBe(ROLE_PROP[role]);
  }
});
