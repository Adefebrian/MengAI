import { describe, expect, test } from "bun:test";
import { Easing } from "./easing";
import { interpolate } from "./interpolate";

describe("interpolate", () => {
  test("maps linearly inside the range", () => {
    expect(interpolate(0, [0, 10], [0, 100])).toBe(0);
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50);
    expect(interpolate(10, [0, 10], [0, 100])).toBe(100);
    expect(interpolate(15, [10, 20], [1, 0])).toBe(0.5);
  });

  test("walks multiple segments", () => {
    const range = [0, 10, 20, 30];
    const out = [0, 1, 1, 0];
    expect(interpolate(5, range, out)).toBe(0.5);
    expect(interpolate(15, range, out)).toBe(1);
    expect(interpolate(25, range, out)).toBe(0.5);
    expect(interpolate(10, range, out)).toBe(1);
  });

  test("clamp holds the edge output on each side independently", () => {
    const opts = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
    expect(interpolate(-5, [0, 10], [0, 100], opts)).toBe(0);
    expect(interpolate(50, [0, 10], [0, 100], opts)).toBe(100);
    expect(interpolate(-5, [0, 10], [0, 100], { extrapolateRight: "clamp" })).toBe(-50);
    expect(interpolate(50, [0, 10], [0, 100], { extrapolateLeft: "clamp" })).toBe(500);
  });

  test("extend is the default and continues the edge segment", () => {
    expect(interpolate(-10, [0, 10], [0, 100])).toBe(-100);
    expect(interpolate(20, [0, 10], [0, 100])).toBe(200);
    // Last segment slope is used above the range.
    expect(interpolate(40, [0, 10, 30], [0, 10, 50])).toBe(70);
  });

  test("identity returns the input outside the range", () => {
    const opts = { extrapolateLeft: "identity", extrapolateRight: "identity" } as const;
    expect(interpolate(-3, [0, 10], [0, 100], opts)).toBe(-3);
    expect(interpolate(42, [0, 10], [0, 100], opts)).toBe(42);
  });

  test("easing shapes progress inside a segment", () => {
    const eased = interpolate(5, [0, 10], [0, 100], { easing: Easing.jal });
    // The JAL curve decelerates: well past halfway at half time.
    expect(eased).toBeGreaterThan(80);
    expect(eased).toBeLessThan(100);
    expect(interpolate(0, [0, 10], [0, 100], { easing: Easing.jal })).toBe(0);
    expect(interpolate(10, [0, 10], [0, 100], { easing: Easing.jal })).toBe(100);
  });

  test("easing does not curl extended values beyond the range", () => {
    const opts = { easing: Easing.jal };
    expect(interpolate(20, [0, 10], [0, 100], opts)).toBe(200);
    expect(interpolate(-10, [0, 10], [0, 100], opts)).toBe(-100);
  });

  test("rejects malformed ranges and inputs", () => {
    expect(() => interpolate(1, [0, 1, 2], [0, 1])).toThrow(RangeError);
    expect(() => interpolate(1, [0], [0])).toThrow(RangeError);
    expect(() => interpolate(1, [0, 0], [0, 1])).toThrow(RangeError);
    expect(() => interpolate(1, [2, 1], [0, 1])).toThrow(RangeError);
    expect(() => interpolate(Number.NaN, [0, 1], [0, 1])).toThrow(TypeError);
    expect(() => interpolate(1, [0, Infinity], [0, 1])).toThrow(TypeError);
  });
});

describe("Easing", () => {
  const curves = {
    linear: Easing.linear,
    jal: Easing.jal,
    jalExit: Easing.jalExit,
    cubic: Easing.cubic,
    outCubic: Easing.out(Easing.cubic),
    inOutQuad: Easing.inOut(Easing.quad),
    sin: Easing.sin,
    circle: Easing.circle,
  };

  test("every curve pins 0 and 1", () => {
    for (const [name, fn] of Object.entries(curves)) {
      expect({ name, v: fn(0) }).toEqual({ name, v: 0 });
      expect({ name, v: Math.round(fn(1) * 1e9) / 1e9 }).toEqual({ name, v: 1 });
    }
  });

  test("the JAL curve is monotonic and never overshoots", () => {
    let prev = 0;
    for (let i = 1; i <= 200; i++) {
      const v = Easing.jal(i / 200);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });

  test("jalExit is the time-reversed JAL curve", () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(Easing.jalExit(t)).toBeCloseTo(1 - Easing.jal(1 - t), 10);
    }
    expect(Easing.jalExit(0.5)).toBeLessThan(0.5);
  });

  test("bezier matches a known CSS ease point and validates input", () => {
    // CSS `ease` = cubic-bezier(0.25, 0.1, 0.25, 1); at x = 0.5, y ~ 0.8024.
    expect(Easing.bezier(0.25, 0.1, 0.25, 1)(0.5)).toBeCloseTo(0.8024, 3);
    expect(Easing.bezier(0.5, 0.5, 0.5, 0.5)(0.3)).toBe(0.3);
    expect(() => Easing.bezier(1.2, 0, 0.5, 1)).toThrow(RangeError);
  });
});
