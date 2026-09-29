import { describe, expect, test } from "bun:test";
import { ACTIVITIES, AGENT_ROLES, ACTIVITY_LABEL } from "@mengai/shared";
import { QUIRKS, QUIRK_MAX_GAP_MS, QUIRK_MIN_GAP_MS, dwellWait, lookAt, quirkSchedule, seededRandom } from "./motion";
import { ACTIVITY_PROP, MOOD_TEMPO, ROLE_PROP, SIT, clampEnergy, coatOf, energyPercent, phaseMs, poseFor, propFor, stillCaption } from "./poses";
import { PROP_BOUNDS, asideTransform } from "./props";

describe("dwell", () => {
  test("waits out the rest of the hold, never less than zero", () => {
    expect(dwellWait(1000, 1000, 1200)).toBe(1200);
    expect(dwellWait(1000, 1500, 1200)).toBe(700);
    expect(dwellWait(1000, 2200, 1200)).toBe(0);
    expect(dwellWait(1000, 9000, 1200)).toBe(0);
  });
});

describe("quirk schedule", () => {
  test("every gap is 8 to 20 s, no quirk twice in a row, all from the set", () => {
    const next = quirkSchedule(123456);
    let last: string | null = null;
    for (let i = 0; i < 500; i++) {
      const step = next();
      expect(step.delay).toBeGreaterThanOrEqual(QUIRK_MIN_GAP_MS);
      expect(step.delay).toBeLessThanOrEqual(QUIRK_MAX_GAP_MS);
      expect(QUIRKS).toContain(step.quirk);
      expect(step.quirk).not.toBe(last);
      last = step.quirk;
    }
  });

  test("seeded: the same cat always gets the same schedule, crewmates differ", () => {
    const a = quirkSchedule(99);
    const b = quirkSchedule(99);
    const c = quirkSchedule(100);
    const sa = Array.from({ length: 8 }, () => a());
    const sb = Array.from({ length: 8 }, () => b());
    const sc = Array.from({ length: 8 }, () => c());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  test("the PRNG stays in 0..1", () => {
    const r = seededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("poses", () => {
  test("stopped overrides the activity, everything else shows the activity", () => {
    expect(poseFor("stopped", "code")).toBe("stopped");
    for (const a of ACTIVITIES) expect(poseFor("working", a)).toBe(a);
  });

  test("every activity has a sitting spec, and a still caption from the shared labels", () => {
    for (const a of ACTIVITIES) {
      expect(SIT[a]).toBeDefined();
      expect(stillCaption(a)).toBe(ACTIVITY_LABEL[a]);
    }
    expect(stillCaption("stopped")).toBe("Stopped");
  });

  test("props: the activity prop in use, else the role prop set aside, none while lying", () => {
    for (const role of AGENT_ROLES) {
      expect(propFor("rest", role)).toEqual({ id: ROLE_PROP[role], mode: "aside" });
      expect(propFor("stopped", role)).toBeNull();
      expect(propFor("celebrate", role)).toBeNull();
      for (const [activity, id] of Object.entries(ACTIVITY_PROP)) {
        expect(propFor(activity as (typeof ACTIVITIES)[number], role)).toEqual({ id, mode: "use" });
      }
    }
  });

  test("every role prop fits the aside corner inside the viewBox", () => {
    for (const id of Object.values(ROLE_PROP)) {
      const [x, y, w, h] = PROP_BOUNDS[id];
      const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)/.exec(asideTransform(id))!;
      const tx = Number(m[1]);
      const ty = Number(m[2]);
      const s = Number(m[3]);
      const left = tx + x * s;
      const right = tx + (x + w) * s;
      const top = ty + y * s;
      const bottom = ty + (y + h) * s;
      expect(left).toBeGreaterThanOrEqual(7.9);
      expect(right).toBeLessThanOrEqual(44.1);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(bottom).toBeLessThanOrEqual(148.1);
    }
  });

  test("mood only scales tempo, within a calm range", () => {
    for (const t of Object.values(MOOD_TEMPO)) {
      expect(t).toBeGreaterThanOrEqual(0.8);
      expect(t).toBeLessThanOrEqual(1.35);
    }
  });

  test("seeded phase is negative and under one long loop", () => {
    for (const seed of [0, 1, 4799, 4800, 2 ** 31 - 1]) {
      const p = phaseMs(seed);
      expect(p).toBeLessThanOrEqual(0);
      expect(p).toBeGreaterThan(-4800);
    }
  });

  test("coats and energy helpers", () => {
    expect(coatOf("calico", 1)).toBe("calico");
    expect(coatOf("nope", 9)).toBe(coatOf("nope", 1));
    expect(clampEnergy(2)).toBe(1);
    expect(clampEnergy(-1)).toBe(0);
    expect(clampEnergy(Number.POSITIVE_INFINITY)).toBe(0);
    expect(energyPercent(0.499)).toBe(50);
  });
});

describe("pointer follow", () => {
  test("look offsets stay within -1..1 on both axes", () => {
    const rect = { left: 100, top: 100, width: 96, height: 96 };
    expect(lookAt(rect, 148, 138.4)).toEqual([0, 0]);
    const [x, y] = lookAt(rect, 99999, -99999);
    expect(x).toBe(1);
    expect(y).toBe(-1);
  });
});
