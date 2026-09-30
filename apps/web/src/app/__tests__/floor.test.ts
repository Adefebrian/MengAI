// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The floor's beats as data: the plan is dealt in order, cards move to the
// cat that works them, a review that asks for changes bounces the card back
// to its maker with the next round, the handoff carries it forward again,
// done returns it to its maker, and a finished run celebrates once for
// every cat. The screen animates exactly these state changes.
import { describe, expect, test } from "bun:test";
import type { MengaiEvent } from "@mengai/shared";
import { DEMO_EVENTS } from "../../demo/fixture";
import { emptyRunState, replay, type RunState } from "../../store/runStore";
import { columnOf, floorOf, laneOf, shortTitle } from "../run/derive";
import { groupLines } from "../run/Timeline";
import { timelineLines } from "../run/describe";

const upTo = (pred: (e: MengaiEvent) => boolean): RunState => {
  const i = DEMO_EVENTS.findIndex(pred);
  if (i < 0) throw new Error("event not in the demo");
  return replay(DEMO_EVENTS.slice(0, i + 1), emptyRunState("demo"));
};
const isHandoff = (id: string) => (e: MengaiEvent) => e.type === "handoff" && (e as MengaiEvent<"handoff">).data.handoff.id === id;
const created = (id: string) => (e: MengaiEvent) => e.type === "task.created" && (e as MengaiEvent<"task.created">).data.task.id === id;

describe("the floor", () => {
  test("the lead's plan is one batch dealt in order into the lead's lane", () => {
    const s = upTo(created("t-scan"));
    expect(["t-csv", "t-button", "t-wire", "t-test", "t-scan"].map((id) => s.deal[id])).toEqual([0, 1, 2, 3, 4]);
    const f = floorOf(s);
    expect(f.lanes["agent-kopi"]!.planned.map((t) => t.id)).toEqual(["t-csv", "t-button", "t-wire", "t-test", "t-scan"]);
  });

  test("a handoff carries the card to the next cat's lane", () => {
    const s = upTo(isHandoff("h-1"));
    expect(laneOf(s, s.tasks["t-csv"]!)).toBe("agent-mochi");
    const review = upTo(isHandoff("h-2"));
    expect(laneOf(review, review.tasks["t-csv"]!)).toBe("agent-tempe");
    expect(review.rounds["t-csv"]).toBe(1);
    expect(floorOf(review).lanes["agent-tempe"]!.review.map((t) => t.id)).toEqual(["t-csv"]);
  });

  test("a review that asks for changes bounces the card back to its maker, then it goes forward again", () => {
    const bounced = upTo(created("t-fix"));
    expect(bounced.holders["t-csv"]).toBe("agent-mochi");
    expect(bounced.rounds["t-csv"]).toBe(2);
    const forward = upTo(isHandoff("h-3"));
    expect(forward.holders["t-csv"]).toBe("agent-tempe");
    expect(forward.rounds["t-csv"]).toBe(2);
  });

  test("a done card returns to the cat that made it", () => {
    const end = replay(DEMO_EVENTS, emptyRunState("demo"));
    expect(end.holders["t-csv"]).toBe("agent-mochi");
    expect(columnOf(end.tasks["t-csv"]!.status)).toBe("done");
    const f = floorOf(end);
    expect(f.counts.done).toBe(Object.keys(end.tasks).length);
  });

  test("the run ending celebrates once for every cat on the board", () => {
    const last = DEMO_EVENTS[DEMO_EVENTS.length - 1]!;
    expect(last.type).toBe("run.status");
    const before = replay(DEMO_EVENTS.slice(0, -1), emptyRunState("demo"));
    const end = replay(DEMO_EVENTS, emptyRunState("demo"));
    for (const id of end.agentOrder) expect(end.celebrate[id] ?? 0).toBe((before.celebrate[id] ?? 0) + 1);
  });

  test("changed files remember the cat that changed them", () => {
    const end = replay(DEMO_EVENTS, emptyRunState("demo"));
    expect(end.files["src/report/csv.ts"]?.by).toBe("agent-mochi");
  });

  test("dependency chips use a short title", () => {
    expect(shortTitle("Add a CSV serializer for daily sales rows", 24)).toBe("Add a CSV serializer fo…");
    expect(shortTitle("Fix quoting, then test")).toBe("Fix quoting");
  });
});

describe("the timeline", () => {
  test("consecutive lines by one cat share a group keyed by its oldest line", () => {
    const s = replay(DEMO_EVENTS, emptyRunState("demo"));
    const groups = groupLines(timelineLines(s, 40));
    for (let i = 1; i < groups.length; i++) expect(groups[i]!.who).not.toBe(groups[i - 1]!.who);
    for (const g of groups) expect(g.key).toBe(Math.min(...g.lines.map((l) => l.seq)));
  });
});
