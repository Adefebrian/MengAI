import { describe, expect, test } from "bun:test";
import { CREW, PLAN, POSTER_STEP, START_STEP, STEPS, STORY_MS, beatsFor, energyAt, sceneAt, sceneLabel, stepAt } from "./script";
import { nextDelay, openingStep } from "./useStory";

const EMDASH = String.fromCharCode(0x2014);
const ids = new Set(CREW.map((c) => c.id));
const beats = STEPS.flatMap((s) => s.beats ?? []);
const indexOf = (id: string) => STEPS.findIndex((s) => s.id === id);

describe("the hero story", () => {
  test("steps run in order inside one loop, with unique scene ids and names", () => {
    for (let i = 1; i < STEPS.length; i++) expect(STEPS[i]!.at).toBeGreaterThan(STEPS[i - 1]!.at);
    expect(STEPS[0]!.at).toBe(0);
    expect(STEPS.at(-1)!.at).toBeLessThan(STORY_MS);
    expect(new Set(STEPS.map((s) => s.id)).size).toBe(STEPS.length);
    expect(new Set(STEPS.map((s) => s.scene)).size).toBe(STEPS.length);
  });

  test("every scenario plays, in the order of a real day", () => {
    const order = ["kickoff", "plan", "coding", "question", "approval", "handoff", "review", "sync", "fix", "tests", "coffee", "wrapup", "celebrate"];
    expect(STEPS.map((s) => s.id)).toEqual(order);
    const kinds = (id: string) => (STEPS[indexOf(id)]!.beats ?? []).map((b) => b.kind);
    expect(STEPS[indexOf("kickoff")]!.meetingStart?.kind).toBe("kickoff");
    expect(kinds("plan")).toContain("deliver");
    expect(kinds("question")).toContain("ask");
    expect(kinds("approval")).toContain("decided");
    expect(kinds("handoff")).toContain("handoff");
    const review = STEPS[indexOf("review")]!.beats?.[0];
    expect(review?.kind === "review" && review.passed).toBe(false);
    expect(STEPS[indexOf("sync")]!.meetingStart?.kind).toBe("sync");
    const fix = STEPS[indexOf("fix")]!.beats?.[0];
    expect(fix?.kind === "review" && fix.passed).toBe(true);
    expect(sceneAt(indexOf("tests")).agents.find((a) => a.id === "onde")?.activity).toBe("run");
    const coffee = sceneAt(indexOf("coffee")).agents.filter((a) => a.status === "idle" && a.activity === "rest");
    expect(coffee.length).toBeGreaterThanOrEqual(1);
    expect(STEPS[indexOf("wrapup")]!.meetingStart?.kind).toBe("wrapup");
    expect(kinds("celebrate")).toContain("celebrate");
  });

  test("the opening move: the crew walks to the kickoff at 0 ms; reduced motion rests on the coding poster", () => {
    expect(START_STEP).toBe(0);
    expect(STEPS[START_STEP]!.meetingStart?.agentIds.length).toBe(CREW.length);
    expect(STEPS[POSTER_STEP]!.id).toBe("coding");
    expect(openingStep(false)).toBe(START_STEP);
    expect(openingStep(true)).toBe(POSTER_STEP);
    const poster = sceneAt(POSTER_STEP);
    expect(poster.meetings.every((m) => m.endedAt !== null)).toBe(true);
    expect(poster.agents.filter((a) => a.role !== "lead").every((a) => a.taskTitle !== null)).toBe(true);
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
      for (const p of Object.keys(s.plan ?? {})) expect(PLAN.some((c) => c.id === p)).toBe(true);
    }
    const decided = beats.find((b) => b.kind === "decided");
    expect(decided && decided.kind === "decided" && decided.byId).toBe("oyen");
  });

  test("every meeting that starts also ends, and only one runs at a time", () => {
    for (let i = 0; i < STEPS.length; i++) expect(sceneAt(i).meetings.filter((m) => m.endedAt === null).length).toBeLessThanOrEqual(1);
    const started = STEPS.flatMap((s) => (s.meetingStart ? [s.meetingStart.id] : []));
    const ended = STEPS.flatMap((s) => (s.meetingEnd ? [s.meetingEnd.id] : []));
    expect(ended.sort()).toEqual(started.sort());
    expect(sceneAt(0).meetings.filter((m) => m.endedAt === null).map((m) => m.kind)).toEqual(["kickoff"]);
  });

  test("the plan is dealt onto the whiteboard, bounces once, and ends all done", () => {
    expect(sceneAt(0).plan.length).toBe(0);
    expect(sceneAt(indexOf("plan")).plan.length).toBe(PLAN.length);
    const card = (i: number) => sceneAt(i).plan.find((p) => p.id === "p2")?.status;
    expect(card(indexOf("handoff"))).toBe("review");
    expect(card(indexOf("review"))).toBe("doing");
    expect(card(indexOf("fix"))).toBe("done");
    expect(sceneAt(STEPS.length - 1).plan.every((p) => p.status === "done")).toBe(true);
    expect(sceneAt(0).agents.length).toBe(CREW.length);
  });

  test("energy climbs through the day and stays in 0..1", () => {
    let prev = -1;
    for (let i = 0; i < STEPS.length; i++) {
      const e = sceneAt(i).agents[0]!.energy;
      expect(e).toBeGreaterThan(prev);
      expect(e).toBeLessThanOrEqual(1);
      prev = e;
    }
    expect(energyAt(-5)).toBeGreaterThanOrEqual(0);
    expect(energyAt(STORY_MS * 2)).toBeLessThanOrEqual(1);
  });

  test("stepAt and nextDelay agree on the timeline, and wrap", () => {
    expect(stepAt(0)).toBe(0);
    expect(stepAt(STEPS[3]!.at + 1)).toBe(3);
    expect(stepAt(STORY_MS + STEPS[2]!.at)).toBe(2);
    expect(nextDelay(0, 0)).toBe(STEPS[1]!.at);
    expect(nextDelay(STEPS.length - 1, STEPS.at(-1)!.at)).toBe(STORY_MS - STEPS.at(-1)!.at);
  });

  test("walking beats get time to finish before the next scene", () => {
    for (let i = 0; i < STEPS.length; i++) {
      const walks = (STEPS[i]!.beats ?? []).some((b) => b.kind !== "celebrate" && b.kind !== "decided");
      const meets = Boolean(STEPS[i]!.meetingStart);
      const room = nextDelay(i, STEPS[i]!.at);
      if (walks) expect(room).toBeGreaterThanOrEqual(5_000);
      if (meets) expect(room).toBeGreaterThanOrEqual(8_000);
    }
  });

  test("beat ids stay unique across plays", () => {
    const all = [0, 1, 2].flatMap((play) => STEPS.flatMap((_, i) => beatsFor(i, play).map((b) => b.id)));
    expect(new Set(all).size).toBe(all.length);
  });

  test("every caption, scene name and label is plain copy", () => {
    for (const s of STEPS) {
      for (const text of [s.caption, s.scene, ...(s.meetingStart?.agenda ?? []), ...(s.meetingEnd?.notes ?? [])]) {
        expect(text.includes(EMDASH)).toBe(false);
        expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
      }
      expect(sceneLabel(s)).toContain("Sample story");
    }
  });
});
