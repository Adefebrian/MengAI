// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The hero camera in the browser: measures the Office the frame holds (its
// plan from the SVG view box, each desk's box, the whiteboard), keeps the
// crop to the wall and the first desk rows, and moves one transform between
// shots as the story plays. Under reduced motion, or while the story is
// paused, the camera holds the wide shot and never moves.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { cropFor, deskRows, focusShot, planWidthFor, sameShot, union, wideShot, type Box, type Shot } from "./camera";
import type { StoryShot } from "../story/script";

interface Measure {
  view: { w: number; h: number };
  crop: Box;
  desks: Map<string, Box>;
  board: Box | null;
}

export interface Camera {
  /** the width the Office plans its floor for */
  planW: number;
  /** the view's height in px, the crop at the wide shot */
  height: number | null;
  shot: Shot | null;
}

function boxOf(el: Element | null): Box | null {
  const g = el as SVGGraphicsElement | null;
  if (!g || typeof g.getBBox !== "function") return null;
  try {
    const b = g.getBBox();
    return b.width > 0 && b.height > 0 ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
  } catch {
    return null;
  }
}

function measure(view: HTMLElement, world: HTMLElement, fromDesks: boolean): (Omit<Measure, "view"> & { planW: number; planH: number }) | null {
  const svg = world.querySelector<SVGSVGElement>("svg.office-art");
  const vb = svg?.viewBox?.baseVal;
  if (!svg || !vb || vb.width <= 0 || vb.height <= 0) return null;
  const desks = new Map<string, Box>();
  for (const g of Array.from(world.querySelectorAll("g.of-desk[data-agent]"))) {
    const box = boxOf(g);
    const id = g.getAttribute("data-agent");
    if (box && id) desks.set(id, box);
  }
  const rows = deskRows([...desks].map(([id, box]) => ({ id, box })));
  const crop = cropFor({ w: vb.width, h: vb.height }, rows, undefined, undefined, fromDesks);
  const board = boxOf(world.querySelector("g.of-whiteboard")) ?? boxOf(world.querySelector(".of-board"));
  void view;
  return { crop, desks, board, planW: vb.width, planH: vb.height };
}

/** The subject of a shot, in plan units: the desks of the named cats (with the aisle in front), or the board and the huddle under it. */
export function subjectOf(focus: StoryShot["focus"], m: Pick<Measure, "desks" | "board" | "crop">): Box | null {
  if (focus === "wide") return null;
  if (focus === "board") {
    if (!m.board) return null;
    // the huddle stands in the aisle under the corner, so the shot keeps the floor under the board
    const lead = m.desks.get("oyen");
    return union([m.board, ...(lead ? [lead] : [])]);
  }
  const boxes = focus.map((id) => m.desks.get(id)).filter((b): b is Box => Boolean(b));
  const u = union(boxes);
  // a visitor stands in the aisle in front of the desk
  return u ? { ...u, h: Math.min(m.crop.h - u.y, u.h + 36) } : null;
}

/**
 * The camera for the frame's view. `compact` (a phone) crops from the first
 * desk row instead of the wall, so a working cat sits in the first screen;
 * the whiteboard is then out of the crop and a board shot holds the wide one.
 */
export function useCamera(
  viewRef: RefObject<HTMLElement | null>,
  worldRef: RefObject<HTMLElement | null>,
  want: StoryShot,
  key: string,
  live: boolean,
  compact = false,
): Camera {
  const [viewW, setViewW] = useState(0);
  const [m, setM] = useState<Measure | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const planW = planWidthFor(viewW);

  // the view's width decides the plan width
  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const read = () => setViewW((old) => (Math.abs(old - el.clientWidth) >= 1 ? el.clientWidth : old));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewRef]);

  // the world's layout changes whenever the Office re-plans: measure it again
  const remeasure = useCallback(() => {
    const view = viewRef.current;
    const world = worldRef.current;
    if (!view || !world || view.clientWidth <= 0) return;
    const got = measure(view, world, compact);
    if (!got) return;
    const w = view.clientWidth;
    const z = w / got.crop.w;
    setM({ view: { w, h: got.crop.h * z }, crop: got.crop, desks: got.desks, board: got.board });
  }, [viewRef, worldRef, compact]);

  useLayoutEffect(() => {
    remeasure();
    const world = worldRef.current;
    if (!world || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => remeasure());
    ro.observe(world);
    return () => ro.disconnect();
  }, [remeasure, worldRef, planW, viewW]);

  // the shot for this step: wide first, then the step's own shot after its delay
  const wantRef = useRef(want);
  wantRef.current = want;
  useEffect(() => {
    if (!m) return;
    const wide = wideShot(m.view, m.crop);
    const target = () => {
      const focus = compact && wantRef.current.focus === "board" ? "wide" : wantRef.current.focus;
      const subject = live ? subjectOf(focus, m) : null;
      return subject ? focusShot(m.view, m.crop, subject) : wide;
    };
    if (!live) {
      setShot((s) => (sameShot(s, wide) ? s : wide));
      return;
    }
    const delay = wantRef.current.after ?? 0;
    if (delay <= 0) {
      const t = target();
      setShot((s) => (sameShot(s, t) ? s : t));
      return;
    }
    const timer = setTimeout(() => {
      const t = target();
      setShot((s) => (sameShot(s, t) ? s : t));
    }, delay);
    return () => clearTimeout(timer);
  }, [m, key, live, compact]);

  return { planW, height: m ? Math.round(m.view.h) : null, shot: shot ?? (m ? wideShot(m.view, m.crop) : null) };
}
