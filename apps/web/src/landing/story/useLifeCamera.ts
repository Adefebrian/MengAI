// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The lifecycle floor on a phone (critic round 2, life-375): below 640 px
// the whole floor is seen through one fixed window, reserved from the first
// frame, so the floor never grows under a reader as the story adds desks
// (the hires' desks are drawn as empty seats until they walk in). The
// window's camera sits on the room where the current beat plays, keyed to
// the story step (roomOf in lifecycle.ts): the door and the top room while
// Oyen hires, the meeting room at the kickoff, the desk rows the crew
// walks back to after it, the desks of the cats in a beat. The camera is one translate on
// the Office's own camera group, eased by the Office's own pan transition;
// a still story moves it at once.
import { useLayoutEffect, useState, type RefObject } from "react";
import type { LifeRoom } from "./lifecycle";

/** Below this floor width the floor is seen through the window. */
export const WINDOW_BELOW = 640;
/** The window's height in floor widths (about 560 px at 343 wide), and its cap. */
export const WINDOW_RATIO = 1.63;
export const WINDOW_MAX = 760;

export interface Span {
  y: number;
  h: number;
}

export interface FloorBoxes {
  door: Span | null;
  meeting: Span | null;
  desks: ReadonlyMap<string, Span>;
}

/** The window's height for a floor this wide. Pure. */
export function windowHeight(width: number): number {
  return Math.min(Math.round(width * WINDOW_RATIO), WINDOW_MAX);
}

function union(spans: Span[]): Span | null {
  if (spans.length === 0) return null;
  const y0 = Math.min(...spans.map((s) => s.y));
  const y1 = Math.max(...spans.map((s) => s.y + s.h));
  return { y: y0, h: y1 - y0 };
}

/**
 * The window's top, in floor units, for a room: the resting frame (top of
 * the floor, with the plan board and the door) when the room already fits
 * inside it, else the room centred, or its top when it is taller
 * than the window; always inside the floor. Pure.
 */
export function cameraTop(room: LifeRoom, boxes: FloorBoxes, floorH: number, viewH: number): number {
  const max = Math.max(0, floorH - viewH);
  const clamp = (v: number) => Math.round(Math.max(0, Math.min(max, v)));
  let target: Span | null;
  if (room.kind === "door") target = boxes.door;
  else if (room.kind === "meeting") target = boxes.meeting;
  else target = union(room.ids.map((id) => boxes.desks.get(id)).filter((s): s is Span => Boolean(s)));
  if (!target) return 0;
  if (target.y + target.h <= viewH - 8) return 0;
  if (target.h >= viewH) return clamp(target.y - 8);
  return clamp(target.y + target.h / 2 - viewH / 2);
}

function spanOf(el: Element | null): Span | null {
  const g = el as SVGGraphicsElement | null;
  if (!g || typeof g.getBBox !== "function") return null;
  try {
    const b = g.getBBox();
    return b.height > 0 ? { y: b.y, h: b.height } : null;
  } catch {
    return null;
  }
}

function measure(floor: HTMLElement): { boxes: FloorBoxes; floorH: number } | null {
  const world = floor.querySelector("svg.office-art g.of-camera");
  const all = spanOf(world);
  if (!world || !all) return null;
  const desks = new Map<string, Span>();
  for (const g of Array.from(world.querySelectorAll("g.of-desk[data-agent]"))) {
    const s = spanOf(g);
    const id = g.getAttribute("data-agent");
    if (s && id) desks.set(id, s);
  }
  return {
    boxes: { door: spanOf(world.querySelector("g.of-door")), meeting: spanOf(world.querySelector("g.of-meeting")), desks },
    floorH: all.y + all.h,
  };
}

export interface LifeCamera {
  /** the floor is seen through the window */
  narrow: boolean;
  /** the window's height in px */
  viewH: number;
  /** the window's top on the floor, in px */
  top: number;
}

/** The phone window and its camera for the floor inside `floor`; `key` changes with every step and every remount. */
export function useLifeCamera(floor: RefObject<HTMLElement | null>, room: LifeRoom, key: string): LifeCamera {
  const [width, setWidth] = useState(0);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const el = floor.current;
    if (!el) return;
    const read = () => setWidth((old) => (Math.abs(old - el.clientWidth) >= 1 ? el.clientWidth : old));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [floor]);
  const narrow = width > 0 && width < WINDOW_BELOW;
  const viewH = windowHeight(width);
  const roomKey = JSON.stringify(room);
  useLayoutEffect(() => {
    const el = floor.current;
    if (!narrow || !el) return;
    const place = () => {
      const got = measure(el);
      if (got) setTop(cameraTop(room, got.boxes, got.floorH, viewH));
    };
    place();
    // the Office re-plans after its own width read: place the camera again on the next frame
    const raf = typeof requestAnimationFrame === "undefined" ? 0 : requestAnimationFrame(place);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
    // room is read through roomKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, narrow, viewH, roomKey, key]);
  return { narrow, viewH, top: narrow ? top : 0 };
}
