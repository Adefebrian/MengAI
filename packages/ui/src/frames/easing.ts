// Easing functions for the JAL frame core. Every function maps [0, 1] to
// [0, 1] with f(0) = 0 and f(1) = 1. There is deliberately no bounce,
// elastic, or back easing here: JAL motion law bans overshoot. `Easing.jal`
// is the one system curve (--ease-standard); reach for anything else only
// for a constant-speed loop (`Easing.linear`).

export type EasingFunction = (t: number) => number;

const NEWTON_ITERATIONS = 8;
const NEWTON_EPSILON = 1e-7;
const BISECTION_ITERATIONS = 32;

/**
 * Cubic bezier easing with the same control-point semantics as CSS
 * `cubic-bezier(x1, y1, x2, y2)`. Solves x(t) = input with Newton steps and
 * falls back to bisection, so the result is stable and deterministic.
 */
function bezier(x1: number, y1: number, x2: number, y2: number): EasingFunction {
  for (const v of [x1, y1, x2, y2]) {
    if (!Number.isFinite(v)) throw new TypeError("Easing.bezier: control points must be finite numbers");
  }
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw new RangeError("Easing.bezier: x1 and x2 must be within [0, 1]");
  }
  if (x1 === y1 && x2 === y2) return linear;

  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solveT = (x: number): number => {
    let t = x;
    for (let i = 0; i < NEWTON_ITERATIONS; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < NEWTON_EPSILON) return t;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < BISECTION_ITERATIONS; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < NEWTON_EPSILON) return t;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return sampleY(solveT(x));
  };
}

const linear: EasingFunction = (t) => t;

/** Mirror an ease-in curve into its ease-out form, and the reverse. */
const out = (easing: EasingFunction): EasingFunction => (t) => 1 - easing(1 - t);

const inOut = (easing: EasingFunction): EasingFunction => (t) =>
  t < 0.5 ? easing(t * 2) / 2 : 1 - easing((1 - t) * 2) / 2;

const poly = (n: number): EasingFunction => (t) => Math.pow(t, n);

/** The JAL system curve, identical to --ease-standard. Use for entrances. */
const jal = bezier(0.24, 1, 0.4, 1);

export const Easing = {
  linear,
  bezier,
  /** Identity wrapper, kept so `Easing.in(Easing.cubic)` reads naturally. */
  in: (easing: EasingFunction): EasingFunction => easing,
  out,
  inOut,
  poly,
  quad: poly(2),
  cubic: poly(3),
  sin: ((t) => 1 - Math.cos((t * Math.PI) / 2)) as EasingFunction,
  circle: ((t) => 1 - Math.sqrt(1 - t * t)) as EasingFunction,
  exp: ((t) => (t <= 0 ? 0 : Math.pow(2, 10 * (t - 1)))) as EasingFunction,
  /** --ease-standard, cubic-bezier(0.24, 1, 0.4, 1). The entrance curve. */
  jal,
  /**
   * The same JAL curve, time-reversed (slow start, fast finish). Use for
   * exits, which jal-motion runs eased in at about 70% of the entrance.
   */
  jalExit: out(jal),
} as const;
