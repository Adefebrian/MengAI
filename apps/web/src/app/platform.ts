// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The platform the engine runs on, and what it can run safely there
// (GET /api/health: platform and features). macOS runs every crew process
// under a Seatbelt profile that keeps it away from the engine port; Windows
// and Linux have no such sandbox yet, so crew shell commands, live trading,
// local (stdio) MCP servers and dev script previews stay off there and the
// page shows them in place as coming soon, with the reason in one line.
// An engine from before this contract (no features in its health) was a
// Mac engine, so every feature counts as on.
import type { HealthDTO, PlatformFeatures } from "@mengai/shared";

export type FeatureKey = keyof PlatformFeatures;

export interface PlatformInfo {
  /** the engine's operating system: "darwin", "win32", "linux" or another Node platform id */
  os: string;
  /** the system as a person names it: macOS, Windows, Linux */
  name: string;
  /** the machine in a sentence: "this Mac", "this PC", "this computer" */
  machine: string;
  features: PlatformFeatures;
}

export const ALL_FEATURES: PlatformFeatures = { shell: true, liveTrading: true, mcpStdio: true, scriptPreview: true };

export function platformName(os: string): string {
  if (os === "darwin") return "macOS";
  if (os === "win32") return "Windows";
  if (os === "linux") return "Linux";
  return os || "this system";
}

export function machineWord(os: string): string {
  if (os === "darwin") return "this Mac";
  if (os === "win32") return "this PC";
  return "this computer";
}

/** The platform facts from a health answer; anything missing counts as the Mac engine it came from. */
export function platformOf(health: Pick<Partial<HealthDTO>, "platform" | "features"> | null | undefined): PlatformInfo {
  const os = typeof health?.platform === "string" && health.platform ? health.platform : "darwin";
  const given = health?.features;
  const features: PlatformFeatures = {
    shell: given?.shell ?? ALL_FEATURES.shell,
    liveTrading: given?.liveTrading ?? ALL_FEATURES.liveTrading,
    mcpStdio: given?.mcpStdio ?? ALL_FEATURES.mcpStdio,
    scriptPreview: given?.scriptPreview ?? ALL_FEATURES.scriptPreview,
  };
  return { os, name: platformName(os), machine: machineWord(os), features };
}

export const MAC_PLATFORM: PlatformInfo = platformOf(null);

/** The small label beside a control that is off on this platform. */
export function soonLabel(p: PlatformInfo): string {
  return `Coming soon on ${p.name}`;
}

/** Why a feature is off, in one plain line: the crew sandbox for this platform is not ready yet. */
export function soonReason(p: PlatformInfo, feature: FeatureKey): string {
  const gate = `the crew sandbox for ${p.name} is not ready yet`;
  switch (feature) {
    case "liveTrading":
      return `Live orders need the crew sandbox, and the one for ${p.name} is not ready yet. Paper trading works now.`;
    case "mcpStdio":
      return `A local MCP server runs as a process on ${p.machine}, and ${gate}. Remote MCP servers and HTTP APIs work now.`;
    case "scriptPreview":
      return `A dev script runs as a process on ${p.machine}, and ${gate}. Static sites preview now.`;
    case "shell":
      return `Tests, builds and installs run as processes on ${p.machine}, and ${gate}. The crew still plans, writes, reviews and ships the code.`;
  }
}

/** The same reason for one record (a venue, a connector, an order), short enough for its row. */
export function soonRowReason(p: PlatformInfo, feature: "mcpStdio" | "liveTrading", what: "venue" | "connector" | "order"): string {
  if (feature === "mcpStdio") return `Its ${what === "connector" ? "command" : "MCP server"} runs as a process on ${p.machine}, and the crew sandbox for ${p.name} is not ready yet.`;
  if (what === "order") return `Approving a live order needs the crew sandbox for ${p.name}, which is not ready yet. Reject works now.`;
  return `Live orders here need the crew sandbox for ${p.name}, which is not ready yet. Paper works now.`;
}

/** A full folder path on the engine's system: /Users/you/shop, or C:\Users\you\shop and \\server\share on Windows. */
export function isAbsolutePath(path: string, os: string): boolean {
  if (os === "win32") return /^[a-zA-Z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path);
  return path.startsWith("/");
}

/** A folder path without its trailing separators, keeping a bare root (/ or C:\). */
export function trimPath(path: string, os: string): string {
  const t = path.trim();
  if (os === "win32") return /^[a-zA-Z]:[\\/]+$/.test(t) ? `${t.slice(0, 2)}\\` : t.replace(/(.)[\\/]+$/, "$1");
  return t.replace(/(.)\/+$/, "$1");
}

/** An example folder path for this system, for placeholders and errors. */
export function examplePath(os: string): string {
  return os === "win32" ? "C:\\Users\\you\\code\\shop" : "/Users/you/code/shop";
}
