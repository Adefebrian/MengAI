// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, test } from "bun:test";
import { CLOSE_MAX, PLAN_THREE, PLAN_TWO, TARGET_ZOOM, cropFor, cropRows, deskRows, focusShot, planWidthFor, sameShot, transformOf, union, wideShot } from "./camera";
import { OPENING_NOTES, feedAt } from "../story/script";
import { visibleFeed } from "./HeroFeed";
import { frameLayout } from "./HeroFrame";

// A three column hero plan, 560 wide: Oyen's corner and Cemong on row one,
// three desks on row two, one on row three.
const DESKS = [
  { id: "oyen", box: { x: 12, y: 80, w: 330, h: 170 } },
  { id: "cemong", box: { x: 390, y: 84, w: 150, h: 166 } },
  { id: "klepon", box: { x: 12, y: 330, w: 150, h: 166 } },
  { id: "tempe", box: { x: 200, y: 332, w: 150, h: 164 } },
  { id: "onde", box: { x: 390, y: 330, w: 150, h: 166 } },
  { id: "cilok", box: { x: 12, y: 580, w: 150, h: 166 } },
];
const PLAN = { w: 560, h: 780 };

describe("the hero camera", () => {
  test("the plan width seats three columns on a wide view at the target zoom, two on a phone", () => {
    expect(planWidthFor(821)).toBe(PLAN_THREE);
    expect(821 / planWidthFor(821)).toBeGreaterThan(TARGET_ZOOM - 0.05);
    expect(planWidthFor(1182)).toBe(Math.round(1182 / TARGET_ZOOM));
    expect(planWidthFor(343)).toBe(PLAN_TWO);
    expect(planWidthFor(0)).toBe(PLAN_TWO);
    expect(planWidthFor(Number.NaN)).toBe(PLAN_TWO);
  });

  test("desks group into rows by their bottom edge", () => {
    const rows = deskRows(DESKS);
    expect(rows.map((r) => r.ids)).toEqual([["oyen", "cemong"], ["klepon", "tempe", "onde"], ["cilok"]]);
    expect(rows[0]!.top).toBe(80);
  });

  test("the crop takes rows until it holds two desks: one row on a three column plan, two on a phone", () => {
    const rows = deskRows(DESKS);
    expect(cropRows(rows)).toBe(1);
    const phone = deskRows([
      { id: "oyen", box: { x: 12, y: 80, w: 330, h: 170 } },
      { id: "cemong", box: { x: 12, y: 330, w: 150, h: 166 } },
      { id: "klepon", box: { x: 190, y: 330, w: 150, h: 166 } },
    ]);
    expect(cropRows(phone)).toBe(2);
    const crop = cropFor(PLAN, rows);
    expect(crop).toEqual({ x: 0, y: 0, w: 560, h: 250 + 18 });
    const fromDesks = cropFor(PLAN, rows, undefined, undefined, true);
    expect(fromDesks.y).toBe(72);
    expect(fromDesks.y + fromDesks.h).toBe(crop.h);
  });

  test("the wide shot spans the crop; a close shot fills the view with its subject, inside the crop and the zoom limit", () => {
    const rows = deskRows(DESKS);
    const crop = cropFor(PLAN, rows);
    const view = { w: 821, h: crop.h * (821 / 560) };
    const wide = wideShot(view, crop);
    expect(wide).toEqual({ x: 0, y: 0, z: 821 / 560 });
    const close = focusShot(view, crop, DESKS[1]!.box);
    expect(close.z).toBeGreaterThan(wide.z);
    expect(close.z).toBeLessThanOrEqual(wide.z * CLOSE_MAX + 1e-9);
    expect(close.x).toBeGreaterThanOrEqual(0);
    expect(close.y).toBeGreaterThanOrEqual(0);
    expect(close.x + view.w / close.z).toBeLessThanOrEqual(crop.w + 1e-6);
    expect(close.y + view.h / close.z).toBeLessThanOrEqual(crop.h + 1e-6);
    // a subject as wide as the plan never zooms past the wide shot
    const whole = focusShot(view, crop, union(DESKS.slice(0, 2).map((d) => d.box))!);
    expect(whole.z).toBe(wide.z);
  });

  test("the transform is one translate and one scale, from the top-left origin", () => {
    expect(transformOf({ x: 10, y: 20, z: 1.5 })).toBe("translate3d(-15px, -30px, 0) scale(1.5)");
    expect(sameShot({ x: 1, y: 1, z: 1 }, { x: 1.2, y: 1.1, z: 1 })).toBe(true);
    expect(sameShot({ x: 1, y: 1, z: 1 }, { x: 4, y: 1, z: 1 })).toBe(false);
    expect(sameShot(null, null)).toBe(true);
  });

  test("the frame lays its feed beside the office from 1120, across under it below, one notice on a phone", () => {
    expect(frameLayout(1184)).toBe("rail");
    expect(frameLayout(928)).toBe("strip3");
    expect(frameLayout(702)).toBe("strip2");
    expect(frameLayout(343)).toBe("one");
  });

  test("the opening notices are dealt oldest first, each new one on top", () => {
    const feed = feedAt(0);
    expect(visibleFeed(feed, 0, 3)).toEqual([]);
    expect(visibleFeed(feed, 1, 3).map((n) => n.id)).toEqual([OPENING_NOTES[2]!.id]);
    expect(visibleFeed(feed, 2, 3).map((n) => n.id)).toEqual([OPENING_NOTES[1]!.id, OPENING_NOTES[2]!.id]);
    expect(visibleFeed(feed, 3, 3).map((n) => n.id)).toEqual(OPENING_NOTES.map((n) => n.id));
    expect(visibleFeed(feed, 3, 1).map((n) => n.id)).toEqual([OPENING_NOTES[0]!.id]);
  });
});
