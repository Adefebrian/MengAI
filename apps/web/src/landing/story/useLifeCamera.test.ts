// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, test } from "bun:test";
import { WINDOW_MAX, cameraTop, windowHeight, type FloorBoxes } from "./useLifeCamera";

const boxes: FloorBoxes = {
  door: { y: 70, h: 90 },
  meeting: { y: 1177, h: 294 },
  desks: new Map([
    ["oyen", { y: 150, h: 150 }],
    ["cemong", { y: 361, h: 150 }],
    ["onde", { y: 769, h: 150 }],
  ]),
};

describe("the phone floor's window", () => {
  test("a fixed height from the width, capped", () => {
    expect(windowHeight(343)).toBe(559);
    expect(windowHeight(620)).toBe(WINDOW_MAX);
  });

  test("the door keeps the resting frame, rooms further down are centred inside the floor", () => {
    const viewH = windowHeight(343);
    expect(cameraTop({ kind: "door" }, boxes, 1481, viewH)).toBe(0);
    expect(cameraTop({ kind: "desks", ids: ["cemong"] }, boxes, 1481, viewH)).toBe(0);
    const meet = cameraTop({ kind: "meeting" }, boxes, 1481, viewH);
    expect(meet).toBe(1481 - viewH);
    const onde = cameraTop({ kind: "desks", ids: ["onde"] }, boxes, 1481, viewH);
    expect(onde).toBeGreaterThan(0);
    expect(onde).toBeLessThanOrEqual(769);
    expect(onde + viewH).toBeGreaterThanOrEqual(769 + 150);
  });
});
