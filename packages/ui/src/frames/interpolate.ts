// interpolate(): map a frame (or any number) through piecewise-linear
// ranges, optionally eased per segment. Pure and deterministic, so every
// composition is a function of the frame and nothing else.
import type { EasingFunction } from "./easing";

/**
 * - `extend` (default): continue the edge segment's straight line.
 * - `clamp`: hold the edge output value.
 * - `identity`: return the input unchanged.
 */
export type ExtrapolateType = "extend" | "clamp" | "identity";

export interface InterpolateOptions {
  /** Applied to the 0..1 progress inside each segment. Default linear. */
  easing?: EasingFunction;
  extrapolateLeft?: ExtrapolateType;
  extrapolateRight?: ExtrapolateType;
}

function assertRanges(inputRange: readonly number[], outputRange: readonly number[]): void {
  if (inputRange.length !== outputRange.length) {
    throw new RangeError(
      `interpolate: inputRange (${inputRange.length}) and outputRange (${outputRange.length}) must have the same length`,
    );
  }
  if (inputRange.length < 2) {
    throw new RangeError("interpolate: ranges need at least 2 values");
  }
  for (let i = 0; i < inputRange.length; i++) {
    const a = inputRange[i];
    const b = outputRange[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      throw new TypeError("interpolate: range values must be finite numbers");
    }
    if (i > 0 && !(a > inputRange[i - 1])) {
      throw new RangeError("interpolate: inputRange must be strictly increasing");
    }
  }
}

export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: InterpolateOptions = {},
): number {
  if (typeof input !== "number" || Number.isNaN(input)) {
    throw new TypeError("interpolate: input must be a number");
  }
  assertRanges(inputRange, outputRange);

  const { easing, extrapolateLeft = "extend", extrapolateRight = "extend" } = options;
  const last = inputRange.length - 1;

  if (input < inputRange[0]) {
    if (extrapolateLeft === "clamp") return outputRange[0];
    if (extrapolateLeft === "identity") return input;
  } else if (input > inputRange[last]) {
    if (extrapolateRight === "clamp") return outputRange[last];
    if (extrapolateRight === "identity") return input;
  }

  // Segment [i - 1, i]. Below the range this is the first segment, above
  // it the last one, which is exactly what `extend` needs.
  let i = 1;
  while (i < last && input > inputRange[i]) i++;

  const a = inputRange[i - 1];
  const b = inputRange[i];
  const outA = outputRange[i - 1];
  const outB = outputRange[i];

  let t = (input - a) / (b - a);
  // Easing shapes progress inside the segment only; `extend` beyond the
  // range stays a straight line so values never curl back.
  if (easing && t >= 0 && t <= 1) t = easing(t);
  return outA + t * (outB - outA);
}
