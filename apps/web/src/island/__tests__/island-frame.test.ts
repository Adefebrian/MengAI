// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The machine around the moments, as data: a quiet run tucks into the
// notch (or off the screen without one), the pointer near folds the ears
// on a notch only, nothing folds while something waits on the owner or a
// moment plays (a quirk under the tucked notch aside), a finished stage
// pops the body; the stage sits under the shape, centred, its top edge on
// the shape's bottom edge, the window is the union of the two and only the
// shape and the clickable cats take the pointer; the ear is as wide as its
// widest item so a rotation or a label never shrinks it; the ring shows in
// every live view, in the warning tone while asks wait put aside.
import { describe, expect, test } from "bun:test";
import type { MengaiEvent } from "@mengai/shared";
import { askOwner, previewLive, sampleRun } from "../fixture";
import { applyEvent, deriveModel, emptyLive, type IslandLive, type IslandModel } from "../live";
import {
  EAR_INNER,
  EAR_OUTER,
  RING,
  RING_GAP,
  STAGE_H,
  STAGE_W,
  bandOf,
  earTexts,
  frameOf,
  hitOf,
  momentEarTexts,
  nativeStateOf,
  pickView,
  showsRing,
  stageOf,
  windowOf,
  type ViewInput,
} from "../machine";
import { MOMENT_TYPES, type MomentType, type StageCat } from "../moment-types";
import { MAX_HIT, NO_NOTCH_GEOMETRY, PREVIEW_GEOMETRY } from "../native";
import { minStageWidth, stageLayout } from "../Stage";

const NOW = 1_800_000_000_000;
const measure = (t: string) => Math.ceil(t.length * 6.5);

function fold(events: readonly MengaiEvent[]): IslandLive {
  let l = emptyLive();
  for (const e of events) l = applyEvent(l, e, NOW).live;
  return l;
}

const running = (): IslandModel => deriveModel(previewLive("collapsed", NOW));
const asking = (): IslandModel => {
  const s = sampleRun(NOW - 60_000);
  askOwner(s);
  return deriveModel(fold(s.events));
};

function view(model: IslandModel, over: Partial<ViewInput> = {}) {
  return pickView({ model, hover: false, snoozed: false, pinned: false, now: NOW, ...over });
}

describe("tucked, near and pop", () => {
  test("a quiet live run tucks: exactly the notch on a notched Mac, off the screen without one", () => {
    const model = running();
    expect(view(model, { tucked: true })).toBe("tucked");
    const f = frameOf({ view: "tucked", model, geometry: PREVIEW_GEOMETRY, measure });
    expect(f.native).toBe("collapsed");
    expect(f.width).toBe(PREVIEW_GEOMETRY.notchWidth);
    expect(f.height).toBe(PREVIEW_GEOMETRY.notchHeight);
    expect(f.band.ear).toBe(0);
    expect(f.band.text).toBe("");
    expect(f.body).toBeNull();
    expect(nativeStateOf("tucked", false)).toBe("hidden");
    expect(earTexts("tucked", model, 0)).toEqual([]);
    // nothing live: idle, never tucked
    expect(view(deriveModel(emptyLive()), { tucked: true })).toBe("idle");
  });

  test("the pointer near folds the ears on a notch at once; the pill under the menu bar stays", () => {
    const model = running();
    expect(view(model, { near: true })).toBe("tucked");
    expect(view(model, { near: true, notch: false })).toBe("collapsed");
    // hover on the notch untucks to the peek
    expect(view(model, { near: true, tucked: true, hover: true })).toBe("peek");
  });

  test("never folded while something waits on the owner, even put aside, nor over a moment on the stage", () => {
    const model = asking();
    expect(view(model, { near: true })).toBe("ask");
    expect(view(model, { near: true, tucked: true, snoozed: true })).toBe("collapsed");
    const live = running();
    for (const m of ["hire", "handoff", "review_fail", "tap", "budget_low"] as const) {
      expect(view(live, { near: true, moment: m })).toBe("collapsed");
      expect(view(live, { tucked: true, moment: m })).toBe("collapsed");
    }
    // a quirk plays right under the tucked notch; never brings a fold on its own
    expect(view(live, { tucked: true, moment: "quirk" })).toBe("tucked");
    expect(view(live, { near: true, moment: "quirk" })).toBe("collapsed");
    expect(view(live, { tucked: true, moment: "quirk", notch: false })).toBe("collapsed");
  });

  test("a finished stage pops the body with its sentence; the owner's hover still wins", () => {
    const model = running();
    expect(view(model, { moment: "stage_done" })).toBe("pop");
    expect(view(model, { moment: "stage_done", hover: true })).toBe("peek");
    expect(view(model, { moment: "stage_done", tucked: true })).toBe("pop");
    const f = frameOf({ view: "pop", model, geometry: PREVIEW_GEOMETRY, measure, popText: "Klepon finished review, testing is next." });
    expect(f.native).toBe("expanded");
    expect(f.body?.width).toBe(Math.max(340, f.band.width));
    expect(f.height).toBe(PREVIEW_GEOMETRY.notchHeight + 8 + 44 + 16);
    expect(f.band.ring).toBe(true);
  });
});

describe("the stage under the shape", () => {
  test("160 x 72, centred under the shape, the window the union of both", () => {
    const model = running();
    const f = frameOf({ view: "collapsed", model, geometry: PREVIEW_GEOMETRY, measure, stageRow: minStageWidth(1) });
    // the shape is wider than the stage: the stage's left edge in the window centres it
    expect(f.width).toBeGreaterThan(STAGE_W);
    expect(f.stage).toEqual({ width: STAGE_W, height: STAGE_H, x: (f.width - STAGE_W) / 2 });
    expect(windowOf(f)).toEqual({ width: f.width, height: f.height + STAGE_H });
  });

  test("three cats still fit 160; a narrow pill sits centred over a wider stage", () => {
    expect(minStageWidth(3)).toBeLessThanOrEqual(STAGE_W);
    expect(stageOf(120, minStageWidth(3))).toEqual({ width: STAGE_W, height: STAGE_H, x: 0 });
    const narrow = { width: 120, height: 32, stage: stageOf(120, minStageWidth(2)) };
    expect(windowOf(narrow)).toEqual({ width: STAGE_W, height: 32 + STAGE_H });
    const hit = hitOf(narrow, windowOf(narrow), [])!;
    expect(hit[0]).toEqual({ x: 20, y: 0, width: 120, height: 32 });
  });

  test("no stage without cats, and none for an island off the screen", () => {
    const model = running();
    expect(frameOf({ view: "collapsed", model, geometry: PREVIEW_GEOMETRY, measure }).stage).toBeNull();
    expect(frameOf({ view: "tucked", model, geometry: NO_NOTCH_GEOMETRY, measure, stageRow: 48 }).stage).toBeNull();
    // a quirk under the tucked notch has its stage
    const tucked = frameOf({ view: "tucked", model, geometry: PREVIEW_GEOMETRY, measure, stageRow: 48 });
    expect(tucked.stage).toEqual({ width: STAGE_W, height: STAGE_H, x: (PREVIEW_GEOMETRY.notchWidth - STAGE_W) / 2 });
  });

  test("every grown view keeps the stage under its body", () => {
    const model = asking();
    const f = frameOf({ view: "ask", model, geometry: PREVIEW_GEOMETRY, measure, stageRow: minStageWidth(1) });
    expect(f.stage!.width).toBe(STAGE_W);
    expect(windowOf(f)).toEqual({ width: 400, height: f.height + STAGE_H });
  });
});

describe("hit rects: only the shape and the clickable cats take the pointer", () => {
  test("the shape alone filling the window sends none: the shell takes the whole window, the same thing", () => {
    const f = frameOf({ view: "collapsed", model: running(), geometry: PREVIEW_GEOMETRY, measure });
    expect(hitOf(f, windowOf(f))).toBeUndefined();
  });

  test("with the stage: the shape first, then each cat under it, offset into the window", () => {
    const f = frameOf({ view: "ask", model: asking(), geometry: PREVIEW_GEOMETRY, measure, stageRow: minStageWidth(1) });
    const win = windowOf(f);
    const cats = stageLayout(f.stage!.width, 1);
    const hit = hitOf(f, win, cats)!;
    expect(hit).toHaveLength(2);
    expect(hit[0]).toEqual({ x: 0, y: 0, width: 400, height: f.height });
    expect(hit[1]).toEqual({ x: (400 - STAGE_W) / 2 + cats[0]!.x, y: f.height, width: 48, height: 48 });
    // the cat touches the shape's bottom edge, never overlaps it
    expect(hit[1]!.y).toBe(hit[0]!.y + hit[0]!.height);
    // a stage with no clickable cat: the shape alone, inside the bigger window
    expect(hitOf(f, win, [])).toEqual([hit[0]!]);
  });

  test("a window held at the union during a morph keeps the shape centred; never more than four rects", () => {
    const f = frameOf({ view: "collapsed", model: running(), geometry: PREVIEW_GEOMETRY, measure, stageRow: minStageWidth(3) });
    const hit = hitOf(f, { width: f.width + 100, height: 300 }, stageLayout(STAGE_W, 3))!;
    expect(hit[0]).toEqual({ x: 50, y: 0, width: f.width, height: f.height });
    expect(hit).toHaveLength(MAX_HIT);
    expect(hitOf(f, windowOf(f), [...stageLayout(STAGE_W, 3), ...stageLayout(STAGE_W, 3)])).toHaveLength(MAX_HIT);
  });
});

describe("the ear", () => {
  test("as wide as its widest item: rotating to a shorter one never shrinks the shape", () => {
    const model = running();
    const items = [["Review 5 of 7", "Review", "5 of 7"], ["Klepon reviews", "Klepon"], ["3 tasks left", "3 left"]];
    const widths = items.map((_, i) => bandOf("collapsed", model, PREVIEW_GEOMETRY, measure, 0, { items, index: i }));
    expect(widths.map((b) => b.text)).toEqual(["Review 5 of 7", "Klepon reviews", "3 tasks left"]);
    expect(new Set(widths.map((b) => b.width)).size).toBe(1);
    const widest = measure("Klepon reviews");
    expect(widths[0]!.ear).toBe(EAR_INNER + RING + RING_GAP + widest + EAR_OUTER);
  });

  test("ask, shipped and failed keep their own words whatever the rotation says", () => {
    const items = [["Kopi joined"]];
    expect(bandOf("ask", asking(), PREVIEW_GEOMETRY, measure, 1, { items, index: 0 }).text).toBe("Needs you");
    expect(bandOf("tucked", running(), PREVIEW_GEOMETRY, measure, 0, { items, index: 0 }).text).toBe("");
  });

  test("a label for every moment that is not an ask or a run's end, naming who when it fits", () => {
    const cat = (name: string, quirk: StageCat["quirk"] = null): StageCat[] => [
      { cat: { id: "a", name, look: { coat: "ginger", seed: 1 }, role: "engineer", status: "working", activity: "code", mood: "calm" }, pose: "code", prop: null, quirk, move: "visit", delayMs: 0 },
    ];
    const want: Partial<Record<MomentType, string>> = {
      hire: "Kopi joined",
      let_go: "Kopi left",
      handoff: "Handoff",
      review_pass: "Review passed",
      review_fail: "Needs a look",
      ceo_approved: "Kopi approved",
      ceo_denied: "Kopi said no",
      rethink: "Kopi rethinks",
      stuck: "Kopi is stuck",
      budget_low: "Budget low",
      stage_done: "Stage done",
      tap: "Kopi says hi",
    };
    for (const type of MOMENT_TYPES) {
      const texts = momentEarTexts({ type, cats: cat("Kopi") });
      if (want[type]) expect(texts[0]).toBe(want[type]!);
      else if (type !== "quirk") expect(texts).toEqual([]);
      for (const t of texts) expect(t.length).toBeLessThanOrEqual(20);
    }
    expect(momentEarTexts({ type: "quirk", cats: cat("Kopi", "yawn") })).toEqual(["Kopi yawns", "Kopi"]);
  });
});

describe("the ring in every live view", () => {
  test("collapsed with asks put aside shows it (in the warning tone); an open ask hides it; ship and failure show it", () => {
    const model = asking();
    expect(showsRing("collapsed", model)).toBe(true);
    expect(showsRing("ask", model)).toBe(false);
    expect(showsRing("pop", running())).toBe(true);
    expect(showsRing("failed", deriveModel(previewLive("failed", NOW)))).toBe(true);
    expect(showsRing("shipped", deriveModel(previewLive("shipped", NOW)))).toBe(true);
    expect(showsRing("tucked", running())).toBe(false);
  });
});
