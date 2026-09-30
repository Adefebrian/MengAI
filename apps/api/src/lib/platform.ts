// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Platform features: what this engine can run safely today.
//
// The local engine has no login. What keeps a cat from calling it (and
// approving its own live order) is the crew sandbox: on macOS every process
// the crew starts (shell commands, preview dev scripts, stdio MCP servers)
// runs under a Seatbelt profile that denies the engine port
// (lib/engine-guard.ts). Windows and Linux have no equivalent yet, so every
// feature that starts crew code, or that such a call could abuse, is on only
// where that sandbox applies: macOS with a working sandbox-exec. Everywhere
// else all four are off, the engine refuses them with a plain
// "Coming soon on <platform>" reason (HTTP 422 coming_soon for API writes, a
// tool error for the crew) and GET /api/health tells the UI which ones to
// label "Coming soon".
//
// Computed once at boot by core/container.ts and passed to the modules that
// enforce it. Injectable, so the tests run it as win32 and linux on a Mac.
// A module built without it (its own unit tests) keeps every feature on.
import type { PlatformFeatures } from "@mengai/shared";
import { win32 } from "node:path";
import { sandboxUnavailable } from "./engine-guard";
import { HttpError } from "./http";

export type FeatureKey = keyof PlatformFeatures;

export const FEATURE_KEYS: readonly FeatureKey[] = ["shell", "liveTrading", "mcpStdio", "scriptPreview"];

export interface PlatformInfo {
  /** the engine's operating system: "darwin", "win32", "linux", ... */
  readonly platform: NodeJS.Platform;
  readonly features: Readonly<PlatformFeatures>;
  /** why the sandbox-dependent features are off; null when they are on */
  readonly reason: string | null;
}

export interface DetectOptions {
  /** default process.platform */
  platform?: NodeJS.Platform;
  /** null when the crew sandbox applies, otherwise why not; default lib/engine-guard.ts sandboxUnavailable */
  sandboxUnavailable?: (platform: NodeJS.Platform) => string | null;
}

const LABEL: Partial<Record<NodeJS.Platform, string>> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

/** "macOS", "Windows", "Linux", or the raw platform name */
export function platformLabel(platform: string): string {
  return LABEL[platform as NodeJS.Platform] ?? platform;
}

/** Runs the sandbox check once: macOS with a working sandbox turns every feature on, anything else turns every one off. */
export function detectPlatform(opts: DetectOptions = {}): PlatformInfo {
  const platform = opts.platform ?? process.platform;
  let reason: string | null;
  if (platform !== "darwin") reason = `${platformLabel(platform)} has no crew sandbox yet`;
  else {
    try {
      reason = (opts.sandboxUnavailable ?? sandboxUnavailable)(platform);
    } catch (e) {
      reason = `the sandbox check failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const on = reason === null;
  const features: PlatformFeatures = { shell: on, liveTrading: on, mcpStdio: on, scriptPreview: on };
  return Object.freeze({ platform, features: Object.freeze(features), reason });
}

const FEATURE_LABEL: Record<FeatureKey, string> = {
  shell: "crew shell commands",
  liveTrading: "live trading",
  mcpStdio: "local MCP servers",
  scriptPreview: "live preview of dev scripts",
};

const STILL_WORKS: Record<FeatureKey, string> = {
  shell: "File tools still work here.",
  liveTrading: "Paper trading works here.",
  mcpStdio: "Remote MCP servers and HTTP connectors work here.",
  scriptPreview: "Static sites still preview here.",
};

/** The plain reason a feature is off: "Coming soon on Windows: live trading. Paper trading works here." */
export function comingSoonText(platform: string, feature: FeatureKey): string {
  if (platform === "darwin") return `Not available on this Mac right now (${FEATURE_LABEL[feature]}): the macOS sandbox could not start. ${STILL_WORKS[feature]}`;
  return `Coming soon on ${platformLabel(platform)}: ${FEATURE_LABEL[feature]}. ${STILL_WORKS[feature]}`;
}

/** null when the feature may run; otherwise the reason. No info (a module built on its own) means on. */
export function featureOff(info: PlatformInfo | null | undefined, feature: FeatureKey): string | null {
  if (!info || info.features[feature] === true) return null;
  return comingSoonText(info.platform, feature);
}

export function comingSoonError(message: string): HttpError {
  return new HttpError(422, "coming_soon", message);
}

/** Throws 422 coming_soon when the feature is off. */
export function assertFeature(info: PlatformInfo | null | undefined, feature: FeatureKey): void {
  const off = featureOff(info, feature);
  if (off) throw comingSoonError(off);
}

// ------------------------------------------------------ process trees
/**
 * taskkill argv that ends a process and every child it started (Windows has
 * no process groups). The absolute path under SystemRoot, so a taskkill.exe
 * planted on PATH or in the working folder is never the one that runs.
 */
export function taskkillArgv(pid: number, systemRoot: string | undefined = process.env.SystemRoot ?? process.env.SYSTEMROOT): string[] {
  const exe = systemRoot && win32.isAbsolute(systemRoot) ? win32.join(systemRoot, "System32", "taskkill.exe") : "taskkill.exe";
  return [exe, "/PID", String(Math.trunc(pid)), "/T", "/F"];
}

/** Starts taskkill for pid and its tree and does not wait. Never throws. */
export function killTreeWindows(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
    Bun.spawn(taskkillArgv(pid, systemRoot), { stdin: "ignore", stdout: "ignore", stderr: "ignore", env: systemRoot ? { SystemRoot: systemRoot } : {} });
  } catch {
    // taskkill missing or the process is already gone
  }
}
