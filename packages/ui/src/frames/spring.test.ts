import { describe, expect, test } from "bun:test";
import { JAL_SPRING, measureSpring, spring } from "./spring";

const fps = 30;

function run(config?: Parameters<typeof spring>[0]["config"], frames = 120): number[] {
  return Array.from({ length: frames }, (_, frame) => spring({ frame, fps, config }));
}

describe("spring", () => {
  test("starts at from and settles exactly on to", () => {
    expect(spring({ frame: 0, fps })).toBe(0);
    const settle = measureSpring({ fps });
    expect(settle).toBeGreaterThan(0);
    expect(spring({ frame: settle, fps })).toBe(1);
    expect(spring({ frame: settle + 500, fps })).toBe(1);
    expect(spring({ frame: settle - 1, fps })).toBeGreaterThan(0.99);
  });

  test("is deterministic: same inputs, same values, in any order", () => {
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    const backward = Array.from({ length: 120 }, (_, i) => spring({ frame: 119 - i, fps })).reverse();
    expect(backward).toEqual(a);
  });

  test("the JAL default is critically damped and never overshoots", () => {
    expect(JAL_SPRING.damping).toBe(2 * Math.sqrt(JAL_SPRING.stiffness * JAL_SPRING.mass));
    const values = run();
    let prev = 0;
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });

  test("an underdamped spring overshoots only when clamping is off", () => {
    const loose = { damping: 6, stiffness: 180, mass: 1 };
    const free = run({ ...loose, overshootClamping: false });
    expect(Math.max(...free)).toBeGreaterThan(1);
    const clamped = run({ ...loose, overshootClamping: true });
    expect(Math.max(...clamped)).toBeLessThanOrEqual(1);
    // Both still settle.
    expect(spring({ frame: 2000, fps, config: { ...loose, overshootClamping: false } })).toBe(1);
  });

  test("overdamped springs settle too", () => {
    const heavy = { damping: 60, stiffness: 100, mass: 1 };
    const settle = measureSpring({ fps, config: heavy });
    expect(spring({ frame: settle, fps, config: heavy })).toBe(1);
    expect(spring({ frame: Math.floor(settle / 2), fps, config: heavy })).toBeLessThan(1);
  });

  test("from, to, delay, and durationInFrames", () => {
    expect(spring({ frame: 0, fps, from: 10, to: 20 })).toBe(10);
    expect(spring({ frame: 999, fps, from: 10, to: 20 })).toBe(20);
    expect(spring({ frame: 5, fps, delay: 10 })).toBe(0);
    expect(spring({ frame: 15, fps, delay: 10 })).toBe(spring({ frame: 5, fps }));
    expect(spring({ frame: 12, fps, durationInFrames: 12 })).toBe(1);
    expect(spring({ frame: 11, fps, durationInFrames: 12 })).toBeLessThan(1);
    expect(spring({ frame: 6, fps, durationInFrames: 12 })).toBeGreaterThan(0.5);
  });

  test("rejects invalid physics", () => {
    expect(() => spring({ frame: 1, fps, config: { mass: 0 } })).toThrow(RangeError);
    expect(() => spring({ frame: 1, fps, config: { stiffness: -1 } })).toThrow(RangeError);
    expect(() => spring({ frame: 1, fps: 0 })).toThrow(RangeError);
    expect(() => spring({ frame: Number.NaN, fps })).toThrow(TypeError);
  });
});
