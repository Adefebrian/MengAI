// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The hero frame's camera, as pure math (critic fix round 2: the hero is a
// tight crop of the desk rows at about 1.5x cat scale, never the full floor
// the lifecycle section shows). The Office plans its floor for the width it
// is given; the camera gives it a plan width, draws it scaled into the
// frame's view, and crops it to the wall and the first desk rows. A shot
// (JEV ui.component_recipe hero_frame bang.shot_size, 0.68) is the part of
// that crop in view: wide on the desk rows, or closer on the desk where the
// story beat happens. Only the camera's one parent transform moves.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The part of the world in view: its top-left corner in plan units, and px per plan unit. */
export interface Shot {
  x: number;
  y: number;
  z: number;
}

/** A plan this wide or wider seats Oyen's corner and one crew desk in the first row. */
export const PLAN_THREE = 560;
/** A plan this wide or wider seats two crew desks side by side (the phone crop). */
export const PLAN_TWO = 360;
/** The cat scale the desktop frame aims for (critic: about 1.5x). */
export const TARGET_ZOOM = 1.5;
/** A close shot is at most this much closer than the wide shot. */
export const CLOSE_MAX = 1.4;
/** A close shot's subject fills about this share of the view. */
export const CLOSE_FILL = 0.78;
/** The crop takes desk rows until it holds at least this many desks: Oyen's and one crew desk on a three column plan, Oyen's and two on a phone. */
export const CROP_DESKS = 2;

/**
 * The width the Office plans for, for a view this many px wide: three
 * columns once the view is wide enough to show them at a readable scale,
 * two below that, and never wider than the target zoom asks for.
 */
export function planWidthFor(view: number): number {
  if (!Number.isFinite(view) || view <= 0) return PLAN_TWO;
  if (view >= PLAN_THREE * 0.95) return Math.round(Math.max(PLAN_THREE, view / TARGET_ZOOM));
  return Math.round(Math.max(PLAN_TWO, view / TARGET_ZOOM));
}

/** Rows of desks, top to bottom, from each desk's box: desks whose bottoms sit within `tolerance` share a row. */
export function deskRows(desks: { id: string; box: Box }[], tolerance = 24): { bottom: number; top: number; ids: string[] }[] {
  const sorted = [...desks].sort((a, b) => a.box.y + a.box.h - (b.box.y + b.box.h));
  const rows: { bottom: number; top: number; ids: string[] }[] = [];
  for (const d of sorted) {
    const bottom = d.box.y + d.box.h;
    const row = rows.find((r) => Math.abs(r.bottom - bottom) <= tolerance);
    if (row) {
      row.ids.push(d.id);
      row.bottom = Math.max(row.bottom, bottom);
      row.top = Math.min(row.top, d.box.y);
    } else rows.push({ bottom, top: d.box.y, ids: [d.id] });
  }
  return rows.sort((a, b) => a.bottom - b.bottom);
}

/** How many desk rows the crop shows: rows are added until they hold `desks` desks. */
export function cropRows(rows: { ids: string[] }[], desks = CROP_DESKS): number {
  let n = 0;
  let seen = 0;
  while (n < rows.length && seen < desks) seen += rows[n++]!.ids.length;
  return Math.max(1, n);
}

/**
 * The crop: the full plan width, from the top of the wall (or, on a phone,
 * from just above the first desk row, so a working cat sits inside the
 * first screen) to under the last shown desk row.
 */
export function cropFor(
  plan: { w: number; h: number },
  rows: { bottom: number; ids: string[]; top?: number }[],
  count = cropRows(rows),
  pad = 18,
  fromDesks = false,
): Box {
  const row = rows[Math.min(count, rows.length) - 1];
  const bottom = row ? Math.min(plan.h, row.bottom + pad) : plan.h;
  const first = rows[0];
  const top = fromDesks && first?.top !== undefined ? Math.max(0, Math.min(bottom - 1, first.top - 8)) : 0;
  return { x: 0, y: top, w: plan.w, h: Math.max(1, bottom - top) };
}

/** The wide shot: the whole crop across the view. */
export function wideShot(view: { w: number }, crop: Box): Shot {
  return { x: crop.x, y: crop.y, z: view.w / crop.w };
}

export function union(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A closer shot on `subject`: the subject fills about CLOSE_FILL of the view,
 * never closer than CLOSE_MAX times the wide shot and never wider than it,
 * centred on the subject and kept inside the crop, so the view never shows
 * anything the wide shot does not.
 */
export function focusShot(view: { w: number; h: number }, crop: Box, subject: Box): Shot {
  const wide = wideShot(view, crop);
  const fit = Math.min((view.w * CLOSE_FILL) / Math.max(1, subject.w), (view.h * CLOSE_FILL) / Math.max(1, subject.h));
  const z = clamp(fit, wide.z, wide.z * CLOSE_MAX);
  const vw = view.w / z;
  const vh = view.h / z;
  const cx = subject.x + subject.w / 2;
  const cy = subject.y + subject.h / 2;
  return {
    x: clamp(cx - vw / 2, crop.x, crop.x + crop.w - vw),
    y: clamp(cy - vh / 2, crop.y, crop.y + crop.h - vh),
    z,
  };
}

/** The camera's one transform, from its top-left origin. */
export function transformOf(s: Shot): string {
  const r = (v: number) => Math.round(v * 100) / 100;
  return `translate3d(${r(-s.x * s.z)}px, ${r(-s.y * s.z)}px, 0) scale(${r(s.z * 1000) / 1000})`;
}

export function sameShot(a: Shot | null, b: Shot | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.z - b.z) < 0.001;
}
