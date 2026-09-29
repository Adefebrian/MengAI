// spring(): a damped harmonic oscillator evaluated in closed form at a
// frame. No accumulated state and no time step, so the same frame always
// returns the same value (scrubbing backward is exact, not a replay).
//
// JAL default config is critically damped (damping = 2 * sqrt(stiffness *
// mass)) with overshoot clamping on, because JAL motion law bans overshoot.
// An underdamped spring is only for a showcase piece that argues for it.

export interface SpringConfig {
  damping: number;
  stiffness: number;
  mass: number;
  /** When true the value never passes `to`. Default true. */
  overshootClamping: boolean;
}

export const JAL_SPRING: SpringConfig = {
  damping: 20,
  stiffness: 100,
  mass: 1,
  overshootClamping: true,
};

export interface SpringOptions {
  frame: number;
  fps: number;
  config?: Partial<SpringConfig>;
  from?: number;
  to?: number;
  /** Frames to wait before the spring starts. */
  delay?: number;
  /**
   * Stretch or compress time so the spring settles on exactly this many
   * frames. Omit to use the spring's natural duration.
   */
  durationInFrames?: number;
}

export interface MeasureSpringOptions {
  fps: number;
  config?: Partial<SpringConfig>;
  /** Settled when displacement and velocity stay under this share of the travel. */
  threshold?: number;
}

const DEFAULT_THRESHOLD = 0.001;
const MAX_MEASURE_FRAMES = 60 * 600;

function resolveConfig(config: Partial<SpringConfig> | undefined): SpringConfig {
  const c = { ...JAL_SPRING, ...config };
  if (!(c.mass > 0)) throw new RangeError("spring: mass must be > 0");
  if (!(c.stiffness > 0)) throw new RangeError("spring: stiffness must be > 0");
  if (!(c.damping >= 0)) throw new RangeError("spring: damping must be >= 0");
  return c;
}

/**
 * Normalized displacement d(t) and velocity v(t) for a unit spring that
 * starts at d = -1 (the `from` side), at rest, pulled toward 0 (the `to`
 * side). Value progress is 1 + d.
 */
function unitSpring(t: number, c: SpringConfig): { d: number; v: number } {
  const w0 = Math.sqrt(c.stiffness / c.mass);
  const zeta = c.damping / (2 * Math.sqrt(c.stiffness * c.mass));
  const d0 = -1;
  const v0 = 0;

  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const B = (v0 + zeta * w0 * d0) / wd;
    const env = Math.exp(-zeta * w0 * t);
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    const d = env * (d0 * cos + B * sin);
    const v = env * ((-zeta * w0) * (d0 * cos + B * sin) + (-d0 * wd * sin + B * wd * cos));
    return { d, v };
  }
  if (zeta === 1) {
    const env = Math.exp(-w0 * t);
    const A = d0;
    const B = v0 + w0 * d0;
    const d = env * (A + B * t);
    const v = env * (B - w0 * (A + B * t));
    return { d, v };
  }
  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - s);
  const r2 = -w0 * (zeta + s);
  const C2 = (v0 - r1 * d0) / (r2 - r1);
  const C1 = d0 - C2;
  const d = C1 * Math.exp(r1 * t) + C2 * Math.exp(r2 * t);
  const v = C1 * r1 * Math.exp(r1 * t) + C2 * r2 * Math.exp(r2 * t);
  return { d, v };
}

const settleCache = new Map<string, number>();

/** Frames until the spring is at rest, for layout of Sequences and Series. */
export function measureSpring({ fps, config, threshold = DEFAULT_THRESHOLD }: MeasureSpringOptions): number {
  if (!(fps > 0)) throw new RangeError("measureSpring: fps must be > 0");
  const c = resolveConfig(config);
  const key = `${fps}|${c.damping}|${c.stiffness}|${c.mass}|${threshold}`;
  const hit = settleCache.get(key);
  if (hit !== undefined) return hit;

  let result = MAX_MEASURE_FRAMES;
  for (let f = 0; f <= MAX_MEASURE_FRAMES; f++) {
    const { d, v } = unitSpring(f / fps, c);
    if (Math.abs(d) < threshold && Math.abs(v) / fps < threshold) {
      result = f;
      break;
    }
  }
  settleCache.set(key, result);
  return result;
}

export function spring({
  frame,
  fps,
  config,
  from = 0,
  to = 1,
  delay = 0,
  durationInFrames,
}: SpringOptions): number {
  if (typeof frame !== "number" || Number.isNaN(frame)) {
    throw new TypeError("spring: frame must be a number");
  }
  if (!(fps > 0)) throw new RangeError("spring: fps must be > 0");
  const c = resolveConfig(config);

  const local = frame - delay;
  if (local <= 0) return from;

  const natural = measureSpring({ fps, config: c });
  let effective = local;
  if (durationInFrames !== undefined) {
    if (!(durationInFrames > 0)) throw new RangeError("spring: durationInFrames must be > 0");
    effective = local * (natural / durationInFrames);
  }
  // Past the settle point, report the target exactly. The residual is
  // under the threshold, so the snap is invisible and tests stay exact.
  if (effective >= natural) return to;

  const { d } = unitSpring(effective / fps, c);
  let progress = 1 + d;
  if (c.overshootClamping) progress = Math.min(Math.max(progress, 0), 1);
  return from + (to - from) * progress;
}
