import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { officeScene } from "../hero/HeroOffice";
import { CREW, KICKOFF, PLAN, POSTER_STEP, STEPS, STORY_MS, beatsFor, sceneAt, sceneLabel, stepAt } from "./script";
import { nextDelay } from "./useStory";

const EMDASH = String.fromCharCode(0x2014);
const ids = new Set(CREW.map((c) => c.id));

describe("the hero story", () => {
  test("steps run in order inside one loop", () => {
    for (let i = 1; i < STEPS.length; i++) expect(STEPS[i]!.at).toBeGreaterThan(STEPS[i - 1]!.at);
    expect(STEPS[0]!.at).toBe(0);
    expect(STEPS.at(-1)!.at).toBeLessThan(STORY_MS);
  });

  test("the opening move: a handoff between two desks starts at 0 ms, and it is the poster", () => {
    const first = STEPS[0]!.beats?.[0];
    expect(first?.kind).toBe("handoff");
    expect(POSTER_STEP).toBe(0);
  });

  test("every beat and meeting names real crew, and the CEO decides a request", () => {
    for (const s of STEPS) {
      for (const b of s.beats ?? []) {
        const refs = Object.entries(b).filter(([k]) => k.endsWith("Id")).map(([, v]) => v as string);
        for (const r of refs) expect(ids.has(r)).toBe(true);
        if (b.kind === "celebrate") for (const r of b.agentIds) expect(ids.has(r)).toBe(true);
      }
      for (const r of s.meetingStart?.agentIds ?? []) expect(ids.has(r)).toBe(true);
      for (const r of Object.keys(s.agents ?? {})) expect(ids.has(r)).toBe(true);
    }
    const decided = STEPS.flatMap((s) => s.beats ?? []).find((b) => b.kind === "decided");
    expect(decided && decided.kind === "decided" && decided.byId).toBe("kopi");
  });

  test("sceneAt folds the plan and the meetings", () => {
    expect(sceneAt(0).plan.find((p) => p.id === "p2")?.status).toBe("review");
    const review = STEPS.findIndex((s) => s.beats?.some((b) => b.kind === "review"));
    expect(sceneAt(review).plan.find((p) => p.id === "p2")?.status).toBe("done");
    const start = STEPS.findIndex((s) => s.meetingStart);
    const end = STEPS.findIndex((s) => s.meetingEnd);
    expect(sceneAt(start).meetings.filter((m) => m.endedAt === null).length).toBe(1);
    expect(sceneAt(end).meetings.filter((m) => m.endedAt === null).length).toBe(0);
    expect(sceneAt(0).meetings[0]).toEqual(KICKOFF);
    expect(sceneAt(STEPS.length - 1).plan.every((p) => p.status === "done")).toBe(true);
    expect(sceneAt(0).agents.length).toBe(CREW.length);
    expect(sceneAt(0).plan.length).toBe(PLAN.length);
  });

  test("stepAt and nextDelay agree on the timeline, and wrap", () => {
    expect(stepAt(0)).toBe(0);
    expect(stepAt(STEPS[3]!.at + 1)).toBe(3);
    expect(stepAt(STORY_MS + STEPS[2]!.at)).toBe(2);
    expect(nextDelay(0, 0)).toBe(STEPS[1]!.at);
    expect(nextDelay(STEPS.length - 1, STEPS.at(-1)!.at)).toBe(STORY_MS - STEPS.at(-1)!.at);
  });

  test("beat ids stay unique across loops", () => {
    const all = [0, 1].flatMap((loop) => STEPS.flatMap((_, i) => beatsFor(i, loop).map((b) => b.id)));
    expect(new Set(all).size).toBe(all.length);
  });

  test("every caption and label is plain copy", () => {
    for (const s of STEPS) {
      expect(s.caption.includes(EMDASH)).toBe(false);
      expect(sceneLabel(s)).toContain("Sample story");
    }
  });

  test("the hero finds Office by name only when the package exports it", () => {
    expect(officeScene({})).toBeNull();
    const Office = () => createElement("div");
    expect(officeScene({ Office })).toBe(Office);
  });
});
