// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, test } from "bun:test";
import {
  CREW,
  FEED_SIZE,
  OPENING_NOTES,
  OPENING_PLAN,
  PLAN,
  POSTER_STEP,
  START_STEP,
  STEPS,
  STORY_BUDGET,
  STORY_MS,
  beatsFor,
  energyAt,
  feedAt,
  hourOf,
  sceneAt,
  sceneLabel,
  stepAt,
  tokensAt,
} from "./script";
import { nextDelay, openingStep, visibleShare } from "./useStory";

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

  test("the loop opens on desk work and moves the kickoff of the next goal to the end", () => {
    const order = ["desk", "question", "approval", "handoff", "review", "sync", "fix", "tests", "coffee", "wrapup", "celebrate", "kickoff", "plan"];
    expect(STEPS.map((s) => s.id)).toEqual(order);
    const kinds = (id: string) => (STEPS[indexOf(id)]!.beats ?? []).map((b) => b.kind);
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
    expect(STEPS[indexOf("kickoff")]!.meetingStart?.kind).toBe("kickoff");
    expect(STEPS[indexOf("kickoff")]!.planReset).toBe(true);
    expect(kinds("plan")).toContain("deliver");
  });

  test("the first frame is the company at work: every cat seated on a card, code on screens, one handoff walking", () => {
    expect(START_STEP).toBe(0);
    expect(STEPS[START_STEP]!.id).toBe("desk");
    const first = sceneAt(START_STEP);
    expect(first.agents.length).toBe(CREW.length);
    expect(first.agents.every((a) => a.taskTitle !== null)).toBe(true);
    expect(first.agents.every((a) => a.status === "working")).toBe(true);
    expect(first.agents.filter((a) => a.activity === "code").length).toBeGreaterThanOrEqual(2);
    expect(first.agents.filter((a) => a.file !== null).length).toBeGreaterThanOrEqual(4);
    expect(first.meetings.length).toBe(0);
    expect(first.plan.length).toBe(PLAN.length);
    expect(first.plan.map((p) => p.status)).toEqual(PLAN.map((p) => OPENING_PLAN[p.id]!));
    expect((STEPS[START_STEP]!.beats ?? []).map((b) => b.kind)).toEqual(["handoff"]);
    expect(STEPS[START_STEP]!.shot.focus).toBe("wide");
  });

  test("reduced motion rests on the same desk work", () => {
    expect(POSTER_STEP).toBe(START_STEP);
    expect(openingStep(false)).toBe(START_STEP);
    expect(openingStep(true)).toBe(POSTER_STEP);
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
      if (Array.isArray(s.shot.focus)) for (const r of s.shot.focus) expect(ids.has(r)).toBe(true);
    }
    const decided = beats.find((b) => b.kind === "decided");
    expect(decided && decided.kind === "decided" && decided.byId).toBe("oyen");
  });

  test("every meeting that starts also ends, and only one runs at a time", () => {
    for (let i = 0; i < STEPS.length; i++) expect(sceneAt(i).meetings.filter((m) => m.endedAt === null).length).toBeLessThanOrEqual(1);
    const started = STEPS.flatMap((s) => (s.meetingStart ? [s.meetingStart.id] : []));
    const ended = STEPS.flatMap((s) => (s.meetingEnd ? [s.meetingEnd.id] : []));
    expect(ended.sort()).toEqual(started.sort());
    expect(sceneAt(indexOf("kickoff")).meetings.filter((m) => m.endedAt === null).map((m) => m.kind)).toEqual(["kickoff"]);
  });

  test("the board: dealt at the start, the export bounces once, every card done by the celebration, cleared for the next goal", () => {
    const card = (i: number) => sceneAt(i).plan.find((p) => p.id === "p2")?.status;
    expect(card(0)).toBe("doing");
    expect(card(indexOf("handoff"))).toBe("review");
    expect(card(indexOf("review"))).toBe("doing");
    expect(card(indexOf("fix"))).toBe("done");
    expect(sceneAt(indexOf("celebrate")).plan.every((p) => p.status === "done")).toBe(true);
    expect(sceneAt(indexOf("celebrate")).done).toBe(PLAN.length);
    expect(sceneAt(indexOf("kickoff")).plan.length).toBe(0);
    expect(sceneAt(indexOf("plan")).plan.length).toBe(PLAN.length);
    expect(sceneAt(indexOf("plan")).done).toBe(0);
  });

  test("energy and the budget climb through the day and stay inside the budget", () => {
    let prev = -1;
    for (let i = 0; i < STEPS.length; i++) {
      const e = sceneAt(i).agents[0]!.energy;
      expect(e).toBeGreaterThan(prev);
      expect(e).toBeLessThanOrEqual(1);
      prev = e;
      expect(sceneAt(i).tokens).toBe(tokensAt(STEPS[i]!.at));
      expect(sceneAt(i).tokens).toBeLessThanOrEqual(STORY_BUDGET);
      expect(sceneAt(i).tokens % 100).toBe(0);
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

  test("walking beats get time to finish, and a camera shot holds at least 1.5 s", () => {
    for (let i = 0; i < STEPS.length; i++) {
      const s = STEPS[i]!;
      const walks = (s.beats ?? []).some((b) => b.kind !== "celebrate" && b.kind !== "decided");
      const room = nextDelay(i, s.at);
      if (walks) expect(room).toBeGreaterThanOrEqual(5_000);
      if (s.meetingStart) expect(room).toBeGreaterThanOrEqual(8_000);
      expect(room - (s.shot.after ?? 0)).toBeGreaterThanOrEqual(1_500);
    }
  });

  test("the feed: the three opening notices, newest first, then what the story adds", () => {
    expect(OPENING_NOTES.map((n) => n.kind)).toEqual(["cache", "meeting", "approve"]);
    expect(feedAt(0).map((n) => n.id)).toEqual(OPENING_NOTES.map((n) => n.id));
    const approval = feedAt(indexOf("approval"));
    expect(approval.length).toBe(FEED_SIZE);
    expect(approval[0]!.kind).toBe("approve");
    expect(approval[1]!.kind).toBe("ask");
    expect(feedAt(indexOf("sync"))[0]!.title).toBe("Meeting starting");
    expect(feedAt(indexOf("coffee"))[0]!.kind).toBe("cache");
    for (let i = 0; i < STEPS.length; i++) {
      const f = feedAt(i);
      expect(f.length).toBe(FEED_SIZE);
      expect(new Set(f.map((n) => n.id)).size).toBe(f.length);
    }
  });

  test("beat ids stay unique across plays", () => {
    const all = [0, 1, 2].flatMap((play) => STEPS.flatMap((_, i) => beatsFor(i, play).map((b) => b.id)));
    expect(new Set(all).size).toBe(all.length);
  });

  test("every caption, scene name, notice and label is plain copy, labelled as a sample", () => {
    const notes = [...OPENING_NOTES, ...STEPS.flatMap((s) => s.notes ?? [])];
    for (const s of STEPS) {
      for (const text of [s.caption, s.scene, ...(s.meetingStart?.agenda ?? []), ...(s.meetingEnd?.notes ?? [])]) {
        expect(text.includes(EMDASH)).toBe(false);
        expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
      }
      expect(sceneLabel(s)).toContain("Sample run");
    }
    for (const n of notes) {
      for (const text of [n.title, n.text]) {
        expect(text.includes(EMDASH)).toBe(false);
        expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
      }
    }
  });
});

describe("the story clock drives the windows", () => {
  test("an office clock reads as an hour of the day", () => {
    expect(hourOf("10:08")).toBeCloseTo(10.133, 2);
    expect(hourOf("09:00")).toBe(9);
    expect(hourOf("19:20")).toBeCloseTo(19.333, 2);
    expect(hourOf("later")).toBe(12);
    for (const s of STEPS) expect(hourOf(s.clock)).toBeGreaterThanOrEqual(8);
  });
});

describe("story visibility", () => {
  test("the share in view counts the viewport for an element taller than it", () => {
    expect(visibleShare(0.5, 400, 800)).toBe(0.5);
    expect(visibleShare(0.3, 800, 800)).toBe(1);
    expect(visibleShare(0.2, 200, 800)).toBe(0.25);
    expect(visibleShare(0, 0, 0)).toBe(0);
  });
});

describe("the hero crew's looks (critic round 2)", () => {
  test("Oyen is the ginger CEO and no coat repeats", () => {
    expect(CREW[0]?.id).toBe("oyen");
    expect(CREW[0]?.coat).toBe("ginger");
    expect(new Set(CREW.map((c) => c.coat)).size).toBe(CREW.length);
  });
});
