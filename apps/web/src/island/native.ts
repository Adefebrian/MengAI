// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The bridge to the Tauri shell, the contract both sides keep exactly:
//   island_geometry()                                -> { hasNotch, notchWidth, notchHeight, menuBarHeight, scale } in points
//   island_set_state({ state, width, height, hit?, band? })
//                                                    resizes the native window to exactly that size,
//                                                    centred on the notch (or under the menu bar);
//                                                    hit: 1 to 4 rects { x, y, width, height } in
//                                                    window-local points (top left), the parts that
//                                                    take the pointer, the shape first; clicks
//                                                    elsewhere go through to the app below. Without
//                                                    hit the whole window takes the pointer.
//                                                    band: { x, width } in window-local points, sent
//                                                    while the ears are folded away: the footprint
//                                                    they come back to (notch plus both ears, centred
//                                                    like the window, so x is negative); finite, a
//                                                    non-negative width, clipped by the shell to the
//                                                    widest island (640 pt) around the same centre.
//   island_open_main({ path })                       shows and focuses the main window on an /app path
// and one call back, shell to page, while the island is on screen:
//   window.__islandPointer({ zone, x, y })           zone "inside" a hit rect, "near" (within 48 pt beside
//                                                    the shape or beside band, in the menu bar band) or
//                                                    "far", sent when it changes and after the page's
//                                                    first island_set_state; x, y window-local points.
//                                                    So a pointer resting where a folded ear was stays
//                                                    "near" and the ears never come back under it.
// The commands are allowed for the "island" window only. Inside Tauri the
// page calls them through window.__TAURI_INTERNALS__.invoke (no npm
// package); in a plain browser the page is the development preview, where
// the window calls are recorded, Open opens the app path in a new tab and
// the pointer zone is driven by hand (emitPointer).
export type NativeState = "collapsed" | "peek" | "expanded" | "hidden";

export interface IslandGeometry {
  hasNotch: boolean;
  /** logical points */
  notchWidth: number;
  notchHeight: number;
  menuBarHeight: number;
  /** backing scale factor, 2 on a Retina panel */
  scale: number;
}

/** A part of the window that takes the pointer, in window-local points (origin top left). */
export interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The folded ears' footprint, a horizontal span in window-local points: x is
 * negative while the window is the bare notch, the band being centred like it.
 */
export interface NearBand {
  x: number;
  width: number;
}

export interface NativeSize {
  state: NativeState;
  width: number;
  height: number;
  /** the parts that take the pointer, the shape first; none: the whole window */
  hit?: HitRect[];
  /** while the ears are folded: where the shell measures "near" beside, instead of the bare notch */
  band?: NearBand;
}

export type PointerZone = "far" | "near" | "inside";

export interface IslandPointer {
  zone: PointerZone;
  /** window-local points */
  x: number;
  y: number;
}

export interface IslandBridge {
  /** true inside the Tauri island window, false in the browser preview */
  readonly native: boolean;
  geometry(): Promise<IslandGeometry>;
  setState(size: NativeSize): Promise<void>;
  openMain(path: string): Promise<void>;
  /** the shell's pointer zone, on every change; returns the unsubscribe */
  onPointer(cb: (p: IslandPointer) => void): () => void;
}

/** Most hit rects the shell takes. */
export const MAX_HIT = 4;

/** A 14 inch MacBook Pro: the preview's notch, and the fallback when the shell answers nonsense. */
export const PREVIEW_GEOMETRY: IslandGeometry = { hasNotch: true, notchWidth: 185, notchHeight: 32, menuBarHeight: 37, scale: 2 };

/** A display without a notch: the island is a pill under a 24 pt menu bar. */
export const NO_NOTCH_GEOMETRY: IslandGeometry = { hasNotch: false, notchWidth: 0, notchHeight: 0, menuBarHeight: 24, scale: 2 };

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

interface TauriInternals {
  invoke: Invoke;
}

/** The shell's invoke, or null outside Tauri. */
export function tauriInvoke(w: unknown = typeof window === "undefined" ? undefined : window): Invoke | null {
  const internals = (w as { __TAURI_INTERNALS__?: Partial<TauriInternals> } | undefined)?.__TAURI_INTERNALS__;
  return internals && typeof internals.invoke === "function" ? internals.invoke.bind(internals) : null;
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

/** The shell's answer read defensively: a missing or odd field falls back to a sane value. */
export function readGeometry(raw: unknown): IslandGeometry {
  const g = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hasNotch = g.hasNotch === true;
  const base = hasNotch ? PREVIEW_GEOMETRY : NO_NOTCH_GEOMETRY;
  return {
    hasNotch,
    notchWidth: hasNotch ? Math.round(num(g.notchWidth, 80, 480, base.notchWidth)) : 0,
    notchHeight: hasNotch ? Math.round(num(g.notchHeight, 16, 64, base.notchHeight)) : 0,
    menuBarHeight: Math.round(num(g.menuBarHeight, 16, 64, base.menuBarHeight)),
    scale: num(g.scale, 1, 4, base.scale),
  };
}

/** Only app paths may be opened in the main window. */
export function isAppPath(path: string): boolean {
  return (path === "/app" || path.startsWith("/app/") || path.startsWith("/app?")) && !path.includes("//") && !path.includes("\\");
}

/**
 * Hit rects as the shell takes them: whole points that cover the fractional rect
 * (edges floored and ceiled outwards), non-negative sizes, at most MAX_HIT. A rect
 * with a non-finite number is dropped; none left means no `hit` (the whole window),
 * so a bad rect never costs the resize itself.
 */
export function nativeHit(hit: readonly HitRect[] | undefined): HitRect[] | undefined {
  if (!hit) return undefined;
  const out: HitRect[] = [];
  for (const r of hit) {
    if (!r || ![r.x, r.y, r.width, r.height].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    const x = Math.floor(r.x);
    const y = Math.floor(r.y);
    const width = Math.max(0, Math.ceil(r.x + Math.max(0, r.width)) - x);
    const height = Math.max(0, Math.ceil(r.y + Math.max(0, r.height)) - y);
    // huge values can overflow to Infinity, which JSON sends as null
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
    out.push({ x, y, width, height });
    if (out.length === MAX_HIT) break;
  }
  return out.length > 0 ? out : undefined;
}

/**
 * The band as the shell takes it: whole points that cover the fractional span
 * (edges floored and ceiled outwards). Undefined for a non-finite number or an
 * empty span, so a bad band never costs the resize itself.
 */
export function nativeBand(band: NearBand | undefined): NearBand | undefined {
  if (!band || ![band.x, band.width].every((v) => typeof v === "number" && Number.isFinite(v))) return undefined;
  const x = Math.floor(band.x);
  const width = Math.ceil(band.x + Math.max(0, band.width)) - x;
  // huge values can overflow to Infinity, which JSON sends as null
  return Number.isFinite(width) && width > 0 ? { x, width } : undefined;
}

/** The size as sent to the shell: whole points, the window ceiled, `hit` and `band` only when there is one. */
function nativeSize({ state, width, height, hit, band }: NativeSize): NativeSize {
  const out: NativeSize = { state, width: Math.ceil(width), height: Math.ceil(height) };
  const rects = nativeHit(hit);
  if (rects) out.hit = rects;
  const span = nativeBand(band);
  if (span) out.band = span;
  return out;
}

const ZONES: readonly PointerZone[] = ["far", "near", "inside"];

/** The shell's pointer call read defensively: null for an unknown zone, odd coordinates become 0. */
export function readPointer(raw: unknown): IslandPointer | null {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const zone = ZONES.find((z) => z === p.zone);
  if (!zone) return null;
  return { zone, x: num(p.x, -10000, 10000, 0), y: num(p.y, -10000, 10000, 0) };
}

/** A set of pointer listeners; `emit` validates the payload and reaches each one. */
function pointerHub() {
  const listeners = new Set<(p: IslandPointer) => void>();
  return {
    listeners,
    add(cb: (p: IslandPointer) => void): () => void {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    emit(raw: unknown): void {
      const p = readPointer(raw);
      if (!p) return;
      for (const cb of [...listeners]) cb(p);
    },
  };
}

/** Where the shell's call back lands: the page's window. */
export interface PointerHost {
  __islandPointer?: (raw: unknown) => void;
}

export function tauriBridge(invoke: Invoke, host: PointerHost | undefined = typeof window === "undefined" ? undefined : (window as unknown as PointerHost)): IslandBridge {
  const hub = pointerHub();
  const receive = (raw: unknown) => hub.emit(raw);
  return {
    native: true,
    async geometry() {
      try {
        return readGeometry(await invoke("island_geometry"));
      } catch {
        return PREVIEW_GEOMETRY;
      }
    },
    async setState(size) {
      await invoke("island_set_state", { ...nativeSize(size) });
    },
    async openMain(path) {
      if (!isAppPath(path)) return;
      await invoke("island_open_main", { path });
    },
    onPointer(cb) {
      if (!host) return () => {};
      const off = hub.add(cb);
      host.__islandPointer = receive;
      return () => {
        off();
        if (hub.listeners.size === 0 && host.__islandPointer === receive) delete host.__islandPointer;
      };
    },
  };
}

export interface PreviewBridge extends IslandBridge {
  /** every window call, in order, for tests and the preview readout */
  readonly calls: Array<{ cmd: "island_set_state"; args: NativeSize } | { cmd: "island_open_main"; args: { path: string } }>;
  /** plays a shell pointer call (validated like the real one) to the onPointer listeners */
  emitPointer(raw: unknown): void;
}

export function previewBridge(geometry: IslandGeometry = PREVIEW_GEOMETRY, open: (path: string) => void = defaultOpen): PreviewBridge {
  const calls: PreviewBridge["calls"] = [];
  const hub = pointerHub();
  return {
    native: false,
    calls,
    async geometry() {
      return geometry;
    },
    async setState(size) {
      calls.push({ cmd: "island_set_state", args: nativeSize(size) });
    },
    async openMain(path) {
      if (!isAppPath(path)) return;
      calls.push({ cmd: "island_open_main", args: { path } });
      open(path);
    },
    onPointer(cb) {
      return hub.add(cb);
    },
    emitPointer(raw) {
      hub.emit(raw);
    },
  };
}

function defaultOpen(path: string): void {
  if (typeof window !== "undefined") window.open(path, "_blank", "noopener");
}

/** The bridge for this page: Tauri when the shell is present, else the preview. */
export function detectBridge(geometry?: IslandGeometry): IslandBridge {
  const invoke = tauriInvoke();
  return invoke ? tauriBridge(invoke) : previewBridge(geometry);
}
