// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The stage under the island: every moment type renders its cats (size,
// pose, what they hold) with no text at all, the row sits on the top edge
// without overlap, the moves follow their timeline (slide out, hop, back
// up, leave, the ask's nudge every 20 s), the clickable boxes reach the
// shell, and reduced motion shows the same cats still, at once.
import { afterEach, describe, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { lookFor } from "@mengai/cats/src/roster";
import type { AgentRole } from "@mengai/shared";
import type { MiniCat } from "../live";
import { MOMENT_TYPES, type Moment, type MomentType, type StageCat } from "../moment-types";
import {
  ENTER_MS,
  EXIT_MS,
  HOP_MS,
  NUDGE_MS,
  SLOT,
  STAGE_GAP,
  Stage,
  clickableRects,
  continues,
  hopsBy,
  minStageWidth,
  nextChange,
  phaseAt,
  planStage,
  poseState,
  stageLayout,
  type StageRect,
} from "../Stage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STAGE_W = 160;
const STAGE_H = 72;
const realMatchMedia = window.matchMedia;
let root: ReactRoot | null = null;
let host: HTMLElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.matchMedia = realMatchMedia;
});

function reduceMotion(on: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: on && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Real time in short act steps, so each timeout's render lands before the next one is planned. */
const wait = async (ms: number) => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, Math.min(10, Math.max(1, end - performance.now()))));
    });
  }
};

async function mount(node: ReactNode): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

async function rerender(node: ReactNode) {
  await act(async () => root!.render(node));
}

/* ---------------------------------------------------------------------
 * A tiny crew and one scene per moment type (spec 4.1), built inline
 * ------------------------------------------------------------------- */

function mini(name: string, role: AgentRole): MiniCat {
  return { id: `a-${name.toLowerCase()}`, name, look: lookFor(name), role, status: "working", activity: "code", mood: "calm" };
}
const OYEN = mini("Oyen", "lead");
const GEMBUL = mini("Gembul", "engineer");
const KLEPON = mini("Klepon", "reviewer");

function sc(cat: MiniCat, pose: StageCat["pose"], over: Partial<StageCat> = {}): StageCat {
  return { cat, pose, prop: null, quirk: null, move: "visit", delayMs: 0, ...over };
}

const SCENES: Record<MomentType, { cats: StageCat[]; ms: number | null }> = {
  ask_approval: { cats: [sc(GEMBUL, "ask", { prop: "terminal", move: "emerge" })], ms: null },
  ask_order: { cats: [sc(GEMBUL, "ask", { prop: "card", move: "emerge" })], ms: null },
  ask_question: { cats: [sc(KLEPON, "think", { prop: "page", move: "emerge" })], ms: null },
  hire: { cats: [sc(KLEPON, "ask")], ms: 2200 },
  let_go: { cats: [sc(GEMBUL, "stopped", { move: "leave" })], ms: 1800 },
  handoff: { cats: [sc(GEMBUL, "handoff", { prop: "card" }), sc(KLEPON, "wait", { delayMs: 80 })], ms: 2400 },
  review_pass: { cats: [sc(KLEPON, "review", { prop: "magnifier" })], ms: 2200 },
  review_fail: { cats: [sc(KLEPON, "review", { prop: "bugcard" })], ms: 2200 },
  ceo_approved: { cats: [sc(OYEN, "review")], ms: 1800 },
  ceo_denied: { cats: [sc(OYEN, "stopped")], ms: 1800 },
  rethink: { cats: [sc(GEMBUL, "think")], ms: 1800 },
  stuck: { cats: [sc(GEMBUL, "think", { quirk: "twitch" })], ms: 1800 },
  budget_low: { cats: [sc(OYEN, "plan", { prop: "clipboard" })], ms: 2200 },
  stage_done: { cats: [sc(GEMBUL, "celebrate", { move: "hop" })], ms: 2400 },
  // left to right as the deriver orders them: crew, the lead in the middle, crew; the lead comes out first
  shipped: {
    cats: [sc(GEMBUL, "celebrate", { move: "hop", delayMs: 80 }), sc(OYEN, "celebrate", { move: "hop" }), sc(KLEPON, "celebrate", { move: "hop", delayMs: 160 })],
    ms: 4000,
  },
  failed: { cats: [sc(OYEN, "stopped", { move: "emerge" })], ms: null },
  quirk: { cats: [sc(GEMBUL, "rest", { quirk: "yawn" })], ms: 3000 },
  tap: { cats: [sc(OYEN, "rest", { move: "hop" })], ms: 900 },
};

function moment(type: MomentType, over: Partial<Moment> = {}): Moment {
  const scene = SCENES[type];
  return {
    id: `m-${type}`,
    type,
    runId: "r-1",
    cats: scene.cats,
    ms: scene.ms,
    priority: 50,
    text: `Something about ${type.replace(/_/g, " ")}.`,
    path: "/app",
    at: 0,
    ...over,
  };
}

function stage(m: Moment | null, opts: { reduced?: boolean; rects?: StageRect[][]; clicks?: Array<[string, number]>; width?: number } = {}) {
  return (
    <Stage
      moment={m}
      reduced={opts.reduced ?? false}
      width={opts.width ?? STAGE_W}
      height={STAGE_H}
      onCatClick={(mm, i) => opts.clicks?.push([mm.id, i])}
      onCatRects={(r) => opts.rects?.push(r)}
    />
  );
}

function textNodes(el: Node): string[] {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3 && (n.textContent ?? "").trim() !== "") out.push(n.textContent!);
    n.childNodes.forEach(walk);
  };
  walk(el);
  return out;
}

function noOverlap(rects: StageRect[]): boolean {
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!;
      const b = rects[j]!;
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) return false;
    }
  return true;
}

/* ---------------------------------------------------------------------
 * Pure: layout and timeline
 * ------------------------------------------------------------------- */

describe("layout: a row on the top edge, centred, never overlapping", () => {
  test("one, two and three 48 pt slots in the 160 pt stage", () => {
    expect(stageLayout(STAGE_W, 1)).toEqual([{ x: 56, y: 0, width: 48, height: 48 }]);
    expect(stageLayout(STAGE_W, 2).map((r) => r.x)).toEqual([28, 84]);
    expect(stageLayout(STAGE_W, 3).map((r) => r.x)).toEqual([0, 56, 112]);
    expect(minStageWidth(3)).toBe(STAGE_W);
    expect(minStageWidth(2)).toBe(SLOT * 2 + STAGE_GAP);
    // a 32 pt quirk cat keeps the full 48 pt target
    expect(planStage(moment("quirk"), STAGE_W, false)[0]!.rect).toEqual({ x: 56, y: 0, width: 48, height: 48 });
  });

  test("every box touches y 0, stays inside the stage and never overlaps, at any width that holds the row", () => {
    for (const n of [1, 2, 3]) {
      for (let w = minStageWidth(n); w <= 400; w += 7) {
        const rects = stageLayout(w, n);
        expect(rects.length).toBe(n);
        for (const r of rects) {
          expect(r.y).toBe(0);
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.x + r.width).toBeLessThanOrEqual(w + 1e-9);
        }
        expect(noOverlap(rects)).toBe(true);
        for (let i = 1; i < rects.length; i++) expect(rects[i]!.x - (rects[i - 1]!.x + rects[i - 1]!.width)).toBeCloseTo(STAGE_GAP, 9);
      }
    }
  });

  test("a stage narrower than the row closes the gap before anything overlaps", () => {
    const rects = stageLayout(150, 3);
    expect(noOverlap(rects)).toBe(true);
    expect(rects[2]!.x + 48).toBeLessThanOrEqual(150);
  });
});

describe("timeline per move", () => {
  test("emerge: slides out over --dur-300 and stays", () => {
    const [p] = planStage(moment("ask_approval"), STAGE_W, false);
    expect(p!.exitAt).toBeNull();
    expect(phaseAt(p!, 0)).toBe("entering");
    expect(phaseAt(p!, ENTER_MS - 1)).toBe("entering");
    expect(phaseAt(p!, ENTER_MS)).toBe("resting");
    expect(phaseAt(p!, 10 * 60_000 + 500)).toBe("resting");
  });

  test("visit: back up at --dur-300-exit so it is gone exactly when the moment ends", () => {
    const m = moment("hire");
    const [p] = planStage(m, STAGE_W, false);
    expect(p!.exit).toBe("up");
    expect(p!.exitAt).toBe(2200 - EXIT_MS);
    expect(phaseAt(p!, 2200 - EXIT_MS - 1)).toBe("resting");
    expect(phaseAt(p!, 2200 - EXIT_MS)).toBe("exiting");
    expect(phaseAt(p!, 2200)).toBe("gone");
  });

  test("hop: once out, one hop of --dur-300", () => {
    const [p] = planStage(moment("stage_done"), STAGE_W, false);
    expect(phaseAt(p!, ENTER_MS)).toBe("hopping");
    expect(phaseAt(p!, ENTER_MS + HOP_MS - 1)).toBe("hopping");
    expect(phaseAt(p!, ENTER_MS + HOP_MS)).toBe("resting");
    expect(hopsBy(p!, 2000)).toBe(1);
  });

  test("leave: slides to the side and fades, never past the stage's side", () => {
    const [p] = planStage(moment("let_go"), STAGE_W, false);
    expect(p!.exit).toBe("side");
    expect(p!.exitAt).toBe(1800 - EXIT_MS);
    expect(p!.leaveX).toBe(24);
    expect(p!.rect.x + p!.rect.width + p!.leaveX).toBeLessThanOrEqual(STAGE_W);
    // in a full row the edge cats have no room: they only fade
    const row = planStage({ ...moment("shipped"), cats: SCENES.shipped.cats.map((c) => ({ ...c, move: "leave" as const })) }, STAGE_W, false);
    expect(row.map((r) => r.leaveX)).toEqual([0, 24, 0]);
  });

  test("a row comes out on each cat's own delay, in array order left to right: shipped 80, 0, 160 ms; handoff 0, 80 ms", () => {
    const shipped = planStage(moment("shipped"), STAGE_W, false);
    expect(shipped.map((p) => p.enterAt)).toEqual([80, 0, 160]);
    expect(shipped.map((p) => p.rect.x)).toEqual([0, 56, 112]);
    expect(shipped.map((p) => phaseAt(p, 40))).toEqual(["waiting", "entering", "waiting"]);
    expect(shipped.map((p) => phaseAt(p, 120))).toEqual(["entering", "entering", "waiting"]);
    const handoff = planStage(moment("handoff"), STAGE_W, false);
    expect(handoff.map((p) => p.enterAt)).toEqual([0, 80]);
  });

  test("an unanswered ask nudges with one hop every 20 s, a pure function of elapsed time", () => {
    const [p] = planStage(moment("ask_approval"), STAGE_W, false);
    expect(hopsBy(p!, NUDGE_MS - 1)).toBe(0);
    expect(hopsBy(p!, NUDGE_MS)).toBe(1);
    expect(hopsBy(p!, 3 * NUDGE_MS - 1)).toBe(2);
    expect(hopsBy(p!, 3 * NUDGE_MS)).toBe(3);
    expect(phaseAt(p!, NUDGE_MS)).toBe("hopping");
    expect(phaseAt(p!, NUDGE_MS + HOP_MS)).toBe("resting");
    expect(nextChange([p!], ENTER_MS)).toBe(NUDGE_MS);
    expect(nextChange([p!], NUDGE_MS)).toBe(NUDGE_MS + HOP_MS);
    // the same elapsed time always gives the same answer
    for (const t of [0, 123, 19_999, 20_000, 45_678]) expect(phaseAt(p!, t)).toBe(phaseAt(p!, t));
    // a failure also stays (ms null) but sits still: no nudges
    const [f] = planStage(moment("failed"), STAGE_W, false);
    expect(hopsBy(f!, 5 * NUDGE_MS)).toBe(0);
    expect(nextChange([f!], ENTER_MS)).toBeNull();
  });

  test("reduced motion: every cat still and out for the whole moment, no change ever scheduled", () => {
    for (const type of MOMENT_TYPES) {
      const plans = planStage(moment(type), STAGE_W, true);
      for (const t of [0, 50, 1000, 60_000]) for (const p of plans) expect(phaseAt(p, t)).toBe("resting");
      expect(nextChange(plans, 0)).toBeNull();
      expect(clickableRects(plans, 0).length).toBe(plans.length);
    }
  });

  test("poses map to the rig: stopped lies down, an ask looks up alert", () => {
    expect(poseState("stopped")).toEqual({ status: "stopped", activity: "rest" });
    expect(poseState("ask")).toEqual({ status: "approval", activity: "ask" });
    expect(poseState("think").status).toBe("thinking");
    expect(poseState("celebrate").status).toBe("idle");
    expect(poseState("review").status).toBe("working");
  });
});

/* ---------------------------------------------------------------------
 * Render
 * ------------------------------------------------------------------- */

describe("every moment type renders on the stage", () => {
  test("its cats at their size, pose and prop, in a labelled group, with no text at all", async () => {
    reduceMotion(false);
    for (const type of MOMENT_TYPES) {
      const m = moment(type);
      const el = await mount(stage(m));
      await wait(200);
      const region = el.querySelector(".moment-stage")!;
      expect(region.getAttribute("role")).toBe("group");
      expect(region.getAttribute("aria-label")).toBe(m.text);
      expect((region as HTMLElement).style.width).toBe(`${STAGE_W}px`);
      expect((region as HTMLElement).style.height).toBe(`${STAGE_H}px`);
      expect(el.querySelectorAll(".moment-slot").length).toBe(m.cats.length);
      const cats = [...el.querySelectorAll(".moment-stage .cat")];
      expect({ type, cats: cats.length }).toEqual({ type, cats: m.cats.length });
      m.cats.forEach((c, i) => {
        const cat = cats[i]!;
        expect(cat.getAttribute("data-size")).toBe(type === "quirk" ? "32" : "48");
        expect(cat.getAttribute("data-pose")).toBe(c.pose);
        if (c.pose === "stopped") expect(cat.getAttribute("data-status")).toBe("stopped");
        expect(cat.getAttribute("data-holding")).toBe(c.prop);
        expect(cat.getAttribute("data-motion")).toBe("live");
        expect(cat.closest("button.moment-cat")).not.toBeNull();
      });
      expect({ type, text: textNodes(region) }).toEqual({ type, text: [] });
      expect(region.querySelector("text, title, desc, .cat-caption")).toBeNull();
      await act(async () => root!.unmount());
      host!.remove();
      root = null;
    }
  });

  test("an empty stage is hidden from assistive tech and draws nothing", async () => {
    const el = await mount(stage(null));
    const region = el.querySelector(".moment-stage")!;
    expect(region.getAttribute("aria-hidden")).toBe("true");
    expect(region.hasAttribute("role")).toBe(false);
    expect(region.children.length).toBe(0);
  });

  test("the slide out clips the top edge, and only while something moves", async () => {
    reduceMotion(false);
    const el = await mount(stage(moment("stage_done")));
    const slot = () => el.querySelector(".moment-slot")!;
    expect(slot().hasAttribute("data-clip")).toBe(true);
    expect(slot().getAttribute("data-phase")).toBe("entering");
    await wait(ENTER_MS + 60);
    expect(slot().getAttribute("data-phase")).toBe("hopping");
    expect(slot().hasAttribute("data-clip")).toBe(true);
    await wait(HOP_MS + 60);
    expect(slot().getAttribute("data-phase")).toBe("resting");
    expect(slot().hasAttribute("data-clip")).toBe(false);
  });

  test("a leave slides sideways inside the stage: only vertical moves clip", async () => {
    reduceMotion(false);
    const el = await mount(stage(moment("let_go", { ms: 700 })));
    const slot = () => el.querySelector(".moment-slot")!;
    expect(slot().hasAttribute("data-clip")).toBe(true);
    await wait(700 - EXIT_MS + 40);
    expect(slot().getAttribute("data-phase")).toBe("exiting");
    expect(slot().hasAttribute("data-clip")).toBe(false);
  });

  test("a row comes out on its stagger, each slot at its own place on the top edge", async () => {
    reduceMotion(false);
    const el = await mount(stage(moment("shipped")));
    expect(el.querySelectorAll(".moment-stage .cat").length).toBe(1);
    // the lead, in the middle slot, is out first
    expect(el.querySelectorAll(".moment-slot")[1]!.querySelector(".cat")!.getAttribute("aria-label")).toContain("Oyen");
    await wait(240);
    expect(el.querySelectorAll(".moment-stage .cat").length).toBe(3);
    const lefts = [...el.querySelectorAll<HTMLElement>(".moment-slot")].map((s) => s.style.left);
    expect(lefts).toEqual(["0px", "56px", "112px"]);
  });

  test("a quirk moment plays its quirk once the cat is out", async () => {
    reduceMotion(false);
    const el = await mount(stage(moment("quirk")));
    const cat = () => el.querySelector(".moment-stage .cat")!;
    expect(cat().className).not.toContain("cat-quirk-");
    await wait(ENTER_MS + 80);
    expect(cat().classList.contains("cat-quirk-yawn")).toBe(true);
    expect(cat().getAttribute("data-size")).toBe("32");
  });

  test("a visit goes back up before the moment ends and leaves an empty slot", async () => {
    reduceMotion(false);
    const rects: StageRect[][] = [];
    const el = await mount(stage(moment("hire", { ms: 600 }), { rects }));
    expect(rects.at(-1)).toEqual([{ x: 56, y: 0, width: 48, height: 48 }]);
    await wait(600 - EXIT_MS + 40);
    expect(el.querySelector(".moment-slot")!.getAttribute("data-phase")).toBe("exiting");
    expect(rects.at(-1)).toEqual([]);
    await wait(EXIT_MS + 60);
    expect(el.querySelector(".moment-stage .cat")).toBeNull();
  });
});

describe("moment changes", () => {
  test("the old cats go back up before the next ones come out, never two rows at once", async () => {
    reduceMotion(false);
    const el = await mount(stage(moment("ask_approval")));
    await wait(ENTER_MS + 40);
    await rerender(stage(moment("review_pass")));
    // the ask's cat is on its way back up, the reviewer waits for it
    expect(el.querySelectorAll(".moment-cats").length).toBe(1);
    expect(el.querySelector(".moment-cats")!.getAttribute("data-type")).toBe("ask_approval");
    expect(el.querySelector(".moment-slot")!.hasAttribute("data-clip")).toBe(true);
    await wait(EXIT_MS + 200);
    expect(el.querySelectorAll(".moment-cats").length).toBe(1);
    expect(el.querySelector(".moment-cats")!.getAttribute("data-type")).toBe("review_pass");
    await rerender(stage(null));
    await wait(EXIT_MS + 200);
    expect(el.querySelector(".moment-cats")).toBeNull();
  });
});

describe("an answer carries on its ask", () => {
  const ask = moment("ask_approval", { id: "ask_approval:approval:a1", askId: "approval:a1" });
  const yes = moment("ask_approval", {
    id: "answer:approval:a1",
    askId: "approval:a1",
    ms: 1200,
    cats: [sc({ ...GEMBUL, mood: "proud" }, "celebrate")],
    text: "Gembul got your yes.",
  });

  test("continues: same ask, same cats in the same places", () => {
    expect(continues(ask, yes)).toBe(true);
    expect(continues(ask, ask)).toBe(false);
    expect(continues(null, yes)).toBe(false);
    expect(continues(ask, { ...yes, askId: "approval:other" })).toBe(false);
    expect(continues(ask, { ...yes, cats: [sc(KLEPON, "celebrate")] })).toBe(false);
    expect(continues(moment("hire"), moment("review_pass"))).toBe(false);
    // the answer's cats are out from its first instant and go back up before it ends
    const [p] = planStage(yes, STAGE_W, false, true);
    expect(phaseAt(p!, 0)).toBe("resting");
    expect(p!.exitAt).toBe(1200 - EXIT_MS);
  });

  test("the asking cat stays where it is and changes pose: no second entrance", async () => {
    reduceMotion(false);
    const rects: StageRect[][] = [];
    const el = await mount(stage(ask, { rects }));
    await wait(ENTER_MS + 60);
    const row = el.querySelector(".moment-cats")!;
    const cat = el.querySelector(".moment-stage .cat")!;
    const sent = rects.length;
    await rerender(stage(yes, { rects }));
    expect(el.querySelector(".moment-cats")).toBe(row);
    expect(el.querySelector(".moment-stage .cat")).toBe(cat);
    expect(cat.getAttribute("data-activity")).toBe("celebrate");
    expect(cat.getAttribute("data-mood")).toBe("proud");
    expect(el.querySelector(".moment-slot")!.getAttribute("data-phase")).toBe("resting");
    expect(el.querySelector(".moment-slot")!.hasAttribute("data-clip")).toBe(false);
    expect(el.querySelector(".moment-stage")!.getAttribute("aria-label")).toBe("Gembul got your yes.");
    // same box, so nothing new for the shell
    expect(rects.length).toBe(sent);
    await wait(1200 - EXIT_MS + 40);
    expect(el.querySelector(".moment-slot")!.getAttribute("data-phase")).toBe("exiting");
    expect(rects.at(-1)).toEqual([]);
  });
});

describe("clicks and hit rects", () => {
  test("each clickable cat's box reaches the shell, in stage-local points, whenever it changes", async () => {
    reduceMotion(false);
    const rects: StageRect[][] = [];
    await mount(stage(null, { rects }));
    expect(rects).toEqual([[]]);
    await rerender(stage(moment("shipped"), { rects }));
    expect(rects.at(-1)).toEqual([{ x: 56, y: 0, width: 48, height: 48 }]);
    await wait(240);
    expect(rects.at(-1)).toEqual([
      { x: 0, y: 0, width: 48, height: 48 },
      { x: 56, y: 0, width: 48, height: 48 },
      { x: 112, y: 0, width: 48, height: 48 },
    ]);
    const before = rects.length;
    await wait(400);
    // nothing changed (hops do not move the box), so nothing new was sent
    expect(rects.length).toBe(before);
    await rerender(stage(null, { rects }));
    expect(rects.at(-1)).toEqual([]);
  });

  test("a wider stage moves the boxes and says so", async () => {
    const rects: StageRect[][] = [];
    await mount(stage(moment("handoff"), { rects, reduced: true }));
    expect(rects.at(-1)).toEqual([
      { x: 28, y: 0, width: 48, height: 48 },
      { x: 84, y: 0, width: 48, height: 48 },
    ]);
    await rerender(stage(moment("handoff"), { rects, reduced: true, width: 200 }));
    expect(rects.at(-1)!.map((r) => r.x)).toEqual([48, 104]);
  });

  test("a click on a cat names the moment and the cat; the cat reacts with its tap", async () => {
    reduceMotion(false);
    const clicks: Array<[string, number]> = [];
    const el = await mount(stage(moment("handoff"), { clicks }));
    await wait(200);
    const buttons = [...el.querySelectorAll<HTMLButtonElement>("button.moment-cat")];
    expect(buttons.length).toBe(2);
    expect(buttons[0]!.getAttribute("type")).toBe("button");
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Gembul, Engineer, handing off");
    await act(async () => (buttons[1]!.querySelector(".cat") as HTMLElement).click());
    expect(clicks).toEqual([["m-handoff", 1]]);
    expect(buttons[1]!.querySelector(".cat")!.classList.contains("cat-react-tap")).toBe(true);
  });
});

describe("reduced motion", () => {
  test("the same cats, still at their resting frame, all at once, nothing clipped or moving", async () => {
    reduceMotion(false);
    for (const type of MOMENT_TYPES) {
      const m = moment(type);
      const rects: StageRect[][] = [];
      const el = await mount(stage(m, { reduced: true, rects }));
      const region = el.querySelector(".moment-stage")!;
      expect(region.getAttribute("data-motion")).toBe("still");
      const cats = [...region.querySelectorAll(".cat")];
      expect({ type, cats: cats.length }).toEqual({ type, cats: m.cats.length });
      for (const cat of cats) {
        expect(cat.getAttribute("data-motion")).toBe("still");
        expect(cat.className).not.toMatch(/cat--live|cat-quirk-|cat-celebrate/);
      }
      for (const s of region.querySelectorAll(".moment-slot")) expect(s.getAttribute("data-phase")).toBe("resting");
      for (const mover of region.querySelectorAll<HTMLElement>(".moment-mover")) expect(mover.style.transform).not.toMatch(/translateY\(-/);
      expect(region.querySelector("[data-clip]")).toBeNull();
      expect(rects.at(-1)!.length).toBe(m.cats.length);
      expect(textNodes(region)).toEqual([]);
      await act(async () => root!.unmount());
      host!.remove();
      root = null;
    }
  });

  test("a visit stays the whole moment and no quirk plays", async () => {
    const el = await mount(stage(moment("quirk", { ms: 500 }), { reduced: true }));
    await wait(ENTER_MS + 300);
    expect(el.querySelector(".moment-slot")!.getAttribute("data-phase")).toBe("resting");
    expect(el.querySelector(".moment-stage .cat")!.className).not.toContain("cat-quirk-");
  });

  test("the cats go at once when the moment ends", async () => {
    await mount(stage(moment("failed"), { reduced: true }));
    await rerender(stage(null, { reduced: true }));
    expect(host!.querySelector(".moment-stage .cat")).toBeNull();
  });
});
