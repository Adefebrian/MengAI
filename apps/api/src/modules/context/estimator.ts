// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Token estimator: chars divided by a per-model chars-per-token ratio. Every
// model starts at 4.0 and self-calibrates from the prompt size the vendor
// reports (exponential moving average of actual over estimated). Layout caps
// never use the calibrated ratio (see FIXED_CHARS_PER_TOKEN) so the rendered
// prompt stays byte-stable between calls and keeps hitting the prompt cache.

export const DEFAULT_CHARS_PER_TOKEN = 4.0;
/** Caps and clipping always use this fixed ratio, never a calibrated one. */
export const FIXED_CHARS_PER_TOKEN = 4;
/** EMA weight of one new observation. */
export const CALIBRATION_ALPHA = 0.3;
const MIN_RATIO = 1.0;
const MAX_RATIO = 8.0;
/** one observation may move the ratio at most this factor either way */
const MAX_STEP = 4;

export interface Estimator {
  estimate(text: string, model?: string): number;
  calibrate(model: string, estimated: number, actual: number): void;
  ratio(model?: string): number;
}

const key = (model: string) => model.trim().toLowerCase();

export function createEstimator(): Estimator {
  const ratios = new Map<string, number>();

  const ratio = (model?: string): number => (model ? ratios.get(key(model)) : undefined) ?? DEFAULT_CHARS_PER_TOKEN;

  return {
    ratio,
    estimate(text: string, model?: string): number {
      if (!text) return 0;
      return Math.ceil(text.length / ratio(model));
    },
    calibrate(model: string, estimated: number, actual: number): void {
      if (!model || !Number.isFinite(estimated) || !Number.isFinite(actual)) return;
      if (estimated <= 0 || actual <= 0) return;
      const current = ratio(model);
      // estimated = chars / current, so chars / actual = current * estimated / actual
      const step = Math.min(MAX_STEP, Math.max(1 / MAX_STEP, estimated / actual));
      const observed = current * step;
      const next = (1 - CALIBRATION_ALPHA) * current + CALIBRATION_ALPHA * observed;
      ratios.set(key(model), Math.min(MAX_RATIO, Math.max(MIN_RATIO, next)));
    },
  };
}
