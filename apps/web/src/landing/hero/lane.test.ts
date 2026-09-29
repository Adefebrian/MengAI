import { describe, expect, test } from "bun:test";
import { ACTIVITY_MIN_DWELL_MS } from "@mengai/shared";
import {
  DONE_AT,
  LEGS,
  RELAY_FPS,
  RELAY_FRAMES,
  RELAY_MS,
  RELAY_POSTER_MS,
  RELAY_STAGES,
  RELAY_STATUS_LABEL,
  RELAY_SUMMARY,
  SCRIPT,
  TRAVEL_MS,
  relayAt,
  relayCrew,
  relayStageAt,
  shortestSpanMs,
} from "./lane";

const EMDASH = String.fromCharCode(0x2014);

describe("hero relay", () => {
  test("the four cats are the sample run's crew, in lane order", () => {
    const crew = relayCrew();
    expect(crew.map((c) => c.name)).toEqual(["Kopi", "Klepon", "Tempe", "Mochi"]);
    expect(crew.map((c) => c.role)).toEqual(["lead", "engineer", "reviewer", "designer"]);
  });

  test("the card goes forward, bounces back from review once, then forward to Done", () => {
    const stations: number[] = [];
    const seen: string[] = [];
    for (let ms = 0; ms <= RELAY_MS; ms += 50) {
      const m = relayAt(ms);
      expect(m.pos).toBeGreaterThanOrEqual(0);
      expect(m.pos).toBeLessThanOrEqual(3);
      if (m.travel === 1 && stations[stations.length - 1] !== m.pos) stations.push(m.pos);
      if (seen[seen.length - 1] !== m.status) seen.push(m.status);
    }
    expect(stations).toEqual([0, 1, 2, 1, 2, 3]);
    expect(seen).toEqual(["planned", "building", "review", "changes", "again", "passed", "handedoff", "done"]);
    const backwards = LEGS.filter((l) => l.to < l.from);
    expect(backwards).toHaveLength(1);
  });

  test("the card rests exactly under a cat between legs", () => {
    for (const ms of [0, 2_000, 4_000, 9_000, 12_000, 15_000, 17_000, RELAY_MS]) {
      const m = relayAt(ms);
      expect(m.travel).toBe(1);
      expect(Number.isInteger(m.pos)).toBe(true);
    }
    for (const leg of LEGS) expect(relayAt(leg.at + TRAVEL_MS / 2).travel).toBeCloseTo(0.5, 5);
  });

  test("every cat holds each behaviour for at least the minimum dwell", () => {
    expect(shortestSpanMs()).toBeGreaterThanOrEqual(ACTIVITY_MIN_DWELL_MS);
    for (const spans of SCRIPT) for (let i = 1; i < spans.length; i++) expect(spans[i]!.at).toBeGreaterThan(spans[i - 1]!.at);
  });

  test("a receiver waits before the card lands, so its catch beat plays", () => {
    for (const leg of LEGS) {
      const before = relayAt(leg.at + TRAVEL_MS - 50).cats[leg.to]!;
      expect(["wait", "review"]).toContain(before.activity);
    }
    expect(relayAt(LEGS[0]!.at - 100).cats[1]!.activity).toBe("wait");
  });

  test("each role plays its own work beat and the review bounce is a frustrated review", () => {
    const acts = (i: number) => new Set(SCRIPT[i]!.map((s) => s.activity));
    expect(acts(0)).toContain("plan");
    expect(acts(1)).toContain("code");
    expect(acts(1)).toContain("run");
    expect(acts(2)).toContain("review");
    expect(acts(3)).toContain("design");
    const bounce = relayAt(9_600).cats[2]!;
    expect(bounce.activity).toBe("review");
    expect(bounce.mood).toBe("frustrated");
  });

  test("Done fires Kopi's celebration once and fills the run totals", () => {
    expect(relayAt(DONE_AT - 1).celebrateKey).toBe(0);
    const end = relayAt(DONE_AT);
    expect(end.celebrateKey).toBe(1);
    expect(end.cats[0]!.activity).toBe("celebrate");
    expect(end.tokens).toBe(182_400);
    expect(relayAt(RELAY_MS).cats.every((c) => c.status === "done")).toBe(true);
    expect(end.energy.every((e) => e > 0 && e < 0.85)).toBe(true);
  });

  test("the poster is the card back at Klepon after the bounce", () => {
    const m = relayAt(RELAY_POSTER_MS);
    expect(m.holder).toBe(1);
    expect(m.status).toBe("changes");
    expect(m.cats[1]!.activity).toBe("code");
    expect(RELAY_FRAMES).toBe(Math.round((RELAY_MS / 1000) * RELAY_FPS));
  });

  test("stage marks are in order and each still falls in its own stage", () => {
    for (const s of RELAY_STAGES) {
      expect(relayStageAt(s.startMs)).toBe(s.id);
      expect(relayStageAt(s.stillMs)).toBe(s.id);
    }
  });

  test("words carry no em-dash or emoji", () => {
    const words = [...Object.values(RELAY_STATUS_LABEL), RELAY_SUMMARY, ...SCRIPT.flat().map((s) => `${s.note ?? ""} ${s.task ?? ""}`)].join(" ");
    expect(words.includes(EMDASH)).toBe(false);
    expect(/\p{Extended_Pictographic}/u.test(words)).toBe(false);
  });
});
