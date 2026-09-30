// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The bridge to the Tauri shell, the contract both sides keep exactly:
//   island_geometry()                          -> { hasNotch, notchWidth, notchHeight, menuBarHeight, scale } in points
//   island_set_state({ state, width, height }) resizes the native window to exactly that size,
//                                              centred on the notch (or under the menu bar)
//   island_open_main({ path })                 shows and focuses the main window on an /app path
// The commands are allowed for the "island" window only. Inside Tauri the
// page calls them through window.__TAURI_INTERNALS__.invoke (no npm
// package); in a plain browser the page is the development preview, where
// the window calls are recorded and Open opens the app path in a new tab.
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

export interface NativeSize {
  state: NativeState;
  width: number;
  height: number;
}

export interface IslandBridge {
  /** true inside the Tauri island window, false in the browser preview */
  readonly native: boolean;
  geometry(): Promise<IslandGeometry>;
  setState(size: NativeSize): Promise<void>;
  openMain(path: string): Promise<void>;
}

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

export function tauriBridge(invoke: Invoke): IslandBridge {
  return {
    native: true,
    async geometry() {
      try {
        return readGeometry(await invoke("island_geometry"));
      } catch {
        return PREVIEW_GEOMETRY;
      }
    },
    async setState({ state, width, height }) {
      await invoke("island_set_state", { state, width: Math.ceil(width), height: Math.ceil(height) });
    },
    async openMain(path) {
      if (!isAppPath(path)) return;
      await invoke("island_open_main", { path });
    },
  };
}

export interface PreviewBridge extends IslandBridge {
  /** every window call, in order, for tests and the preview readout */
  readonly calls: Array<{ cmd: "island_set_state"; args: NativeSize } | { cmd: "island_open_main"; args: { path: string } }>;
}

export function previewBridge(geometry: IslandGeometry = PREVIEW_GEOMETRY, open: (path: string) => void = defaultOpen): PreviewBridge {
  const calls: PreviewBridge["calls"] = [];
  return {
    native: false,
    calls,
    async geometry() {
      return geometry;
    },
    async setState(size) {
      calls.push({ cmd: "island_set_state", args: { state: size.state, width: Math.ceil(size.width), height: Math.ceil(size.height) } });
    },
    async openMain(path) {
      if (!isAppPath(path)) return;
      calls.push({ cmd: "island_open_main", args: { path } });
      open(path);
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
