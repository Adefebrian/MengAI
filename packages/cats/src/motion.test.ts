import { describe, expect, test } from "bun:test";
import { ACTIVITIES, AGENT_ROLES, ACTIVITY_LABEL } from "@mengai/shared";
import { LIVE_CAP, QUIRKS, QUIRK_MAX_GAP_MS, QUIRK_MIN_GAP_MS, dwellWait, lookAt, quirkSchedule, seededRandom } from "./motion";
import {
  BEATS,
  BEAT_PROP,
  LOW_ENERGY,
  MOOD_TEMPO,
  ROLE_BEAT,
  ROLE_ONLY_BEATS,
  ROLE_PROP,
  SHARED_BEATS,
  SIT,
  activityWords,
  asideFor,
  beatFor,
  clampEnergy,
  coatOf,
  energyPercent,
  isLowEnergy,
  phaseMs,
  poseFor,
  stillCaption,
  type SitBeat,
} from "./poses";

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

describe("poses and beats", () => {
  test("stopped overrides the activity, everything else shows the activity", () => {
    expect(poseFor("stopped", "code")).toBe("stopped");
    for (const a of ACTIVITIES) expect(poseFor("working", a)).toBe(a);
  });

  test("every role x activity resolves to a beat with a sitting spec or the lying rig", () => {
    for (const role of AGENT_ROLES) {
      for (const a of ACTIVITIES) {
        const beat = beatFor(role, a);
        expect(BEATS).toContain(beat);
        if (a !== "celebrate") expect(SIT[beat as SitBeat]).toBeDefined();
      }
      expect(beatFor(role, "stopped")).toBe("stopped");
      expect(beatFor(role, "read")).toBe(`read-${role}`);
    }
  });

  test("the signature beats land on their roles", () => {
    expect(beatFor("engineer", "code")).toBe("code-build");
    expect(beatFor("engineer", "run")).toBe("run-stamp");
    expect(beatFor("reviewer", "review")).toBe("review-stamp");
    expect(beatFor("qa", "review")).toBe("review-hunt");
    expect(beatFor("qa", "run")).toBe("run-tests");
    expect(beatFor("security", "scan")).toBe("scan-sweep");
    expect(beatFor("security", "review")).toBe("review-flag");
    expect(beatFor("researcher", "research")).toBe("research-pages");
    expect(beatFor("designer", "design")).toBe("design-paint");
    expect(beatFor("lead", "plan")).toBe("plan-board");
    expect(beatFor("lead", "review")).toBe("review-crew");
    // a role without a signature beat plays the shared one
    expect(beatFor("operator", "code")).toBe("code");
  });

  test("role-only beats belong to exactly one role", () => {
    for (const beat of ROLE_ONLY_BEATS) {
      const owners = AGENT_ROLES.filter((role) => Object.values(ROLE_BEAT[role]).includes(beat));
      expect({ beat, owners: owners.length }).toEqual({ beat, owners: 1 });
    }
  });

  test("shared beats keep the role's own object aside, unless the beat already uses it", () => {
    const own = new Set(Object.values(ROLE_PROP));
    expect(own.size).toBe(AGENT_ROLES.length);
    for (const role of AGENT_ROLES) {
      expect(asideFor("rest", role)).toBe(ROLE_PROP[role]);
      expect(asideFor("celebrate", role)).toBe(ROLE_PROP[role]);
      expect(asideFor("code-build", role)).toBeNull();
      for (const beat of SHARED_BEATS) {
        const aside = asideFor(beat, role);
        if (BEAT_PROP[beat] === ROLE_PROP[role]) expect(aside).toBeNull();
        else expect(aside).toBe(ROLE_PROP[role]);
      }
    }
    expect(asideFor("automate", "operator")).toBeNull();
  });

  test("no desk, computer or furniture props", () => {
    const banned = /laptop|desk|macbook|monitor|mouse|chair|keyboard|easel|office/i;
    for (const id of [...Object.values(ROLE_PROP), ...Object.values(BEAT_PROP)]) {
      if (id) expect({ id, banned: banned.test(id) }).toEqual({ id, banned: false });
    }
  });

  test("every sitting spec keeps the paws inside the viewBox", () => {
    for (const [beat, spec] of Object.entries(SIT)) {
      for (const [dx, dy] of [spec.pawL, spec.pawR]) {
        const y = 144 + dy;
        expect({ beat, ok: y - 6 >= 8 && y + 6 <= 158 && 68 + dx - 9 >= 0 && 92 + dx + 9 <= 160 }).toEqual({ beat, ok: true });
      }
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
    expect(isLowEnergy(undefined)).toBe(false);
    expect(isLowEnergy(LOW_ENERGY - 0.01)).toBe(false);
    expect(isLowEnergy(LOW_ENERGY)).toBe(true);
    expect(isLowEnergy(4)).toBe(true);
  });

  test("still captions come from the shared labels, error says so", () => {
    for (const a of ACTIVITIES) expect(stillCaption(a)).toBe(a === "automate" ? "Running a runbook" : ACTIVITY_LABEL[a]);
    expect(activityWords("automate")).not.toMatch(/mac|operat/i);
    expect(stillCaption("stopped")).toBe("Stopped");
    expect(stillCaption("code", "error")).toBe("Hit an error");
  });
});

describe("calm limit", () => {
  test("eight cats play full beats at once (JEV live_cap: cap_8)", () => {
    expect(LIVE_CAP).toBe(8);
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
