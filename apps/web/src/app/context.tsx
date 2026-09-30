// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What every app screen shares: the API client (the local engine or the
// demo server), the engine it came from and the platform it runs on (what
// it can run safely there), the owner settings, and the local cat motion
// choice. There is no session: nobody signs in to anything.
import type { OwnerSettings } from "@mengai/shared";
import { createContext, useContext, type ReactNode } from "react";
import type { ApiClient } from "../api/client";
import { MAC_PLATFORM, type PlatformInfo } from "./platform";

export type CatMotion = "live" | "still";

export interface Flash {
  tone: "info" | "success" | "warning" | "danger";
  title: string;
  text?: string;
}

export interface AppContextValue {
  api: ApiClient;
  demo: boolean;
  settings: OwnerSettings | null;
  setSettings: (s: OwnerSettings) => void;
  catMotion: CatMotion;
  setCatMotion: (m: CatMotion) => void;
  /** true when cats must hold still: OS reduced motion, settings.motion off, or the still choice */
  catsStill: boolean;
  /** app motion level after the OS preference */
  motion: "full" | "calm" | "off";
  flash: (f: Flash | null) => void;
  pendingApprovals: number;
  refreshApprovals: () => void;
  /** app-wide notices (demo label, Stop all result) that every Page shows first */
  notices: ReactNode;
  /** the local engine this page talks to, and whether it served this page itself */
  runtime: { label: string; own: boolean };
  /** the engine's system and the features it can run safely there; the rest show as coming soon */
  platform: PlatformInfo;
}

export const AppContext = createContext<AppContextValue | null>(null);

/** The context, or null outside the app frame (the engine gate). */
export function useAppMaybe(): AppContextValue | null {
  return useContext(AppContext);
}

/** The engine's platform, or the Mac defaults outside the app frame. */
export function usePlatform(): PlatformInfo {
  return useContext(AppContext)?.platform ?? MAC_PLATFORM;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppRoot");
  return ctx;
}

const CAT_MOTION_KEY = "mengai.catMotion";

export function readCatMotion(): CatMotion {
  try {
    return localStorage.getItem(CAT_MOTION_KEY) === "still" ? "still" : "live";
  } catch {
    return "live";
  }
}

export function writeCatMotion(m: CatMotion): void {
  try {
    localStorage.setItem(CAT_MOTION_KEY, m);
  } catch {
    // private mode: the choice lasts for this page only
  }
}

const DEMO_KEY = "mengai.demo";

/** Demo mode: ?demo=1 turns it on for the tab, ?demo=0 turns it off. */
export function detectDemo(search: string): boolean {
  const q = new URLSearchParams(search).get("demo");
  try {
    if (q === "1" || q === "true") sessionStorage.setItem(DEMO_KEY, "1");
    else if (q === "0" || q === "false") sessionStorage.removeItem(DEMO_KEY);
    return sessionStorage.getItem(DEMO_KEY) === "1";
  } catch {
    return q === "1" || q === "true";
  }
}
