// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The desktop builds, in one place for the landing and the app onboarding.
// Mac (Apple Silicon) and Windows (x64) are both betas on the v0.1.0-beta
// release, a prerelease, so releases/latest does not point at it. Windows is
// hidden from the pages for now (the owner's call): its build stays on the
// release, and it shows again the moment `hidden` is removed here. Android
// has no build yet: it shows as coming soon with no link, and turns into a
// download the moment its href is set here.
import { REPO_URL } from "./api/runtime";

export const RELEASE_TAG = "v0.1.0-beta";
export const RELEASE_URL = `${REPO_URL}/releases/tag/${RELEASE_TAG}`;

export type DownloadId = "mac" | "windows" | "android";

export interface DownloadTarget {
  id: DownloadId;
  /** the button words: "Download for Mac" */
  label: string;
  /** the system and the build, for the platform line: "Apple Silicon" */
  build: string;
  /** null while the build is not out yet */
  href: string | null;
  /** kept off the pages entirely, neither a download nor coming soon */
  hidden?: boolean;
}

export const DOWNLOADS: readonly DownloadTarget[] = [
  { id: "mac", label: "Download for Mac", build: "Apple Silicon", href: RELEASE_URL },
  { id: "windows", label: "Download for Windows", build: "x64", href: RELEASE_URL, hidden: true },
  { id: "android", label: "Android", build: "phones and tablets", href: null },
];

/** The builds a person can download today, in page order. */
export function availableDownloads(): DownloadTarget[] {
  return DOWNLOADS.filter((d) => d.href !== null && !d.hidden);
}

/** The builds still to come. */
export function comingDownloads(): DownloadTarget[] {
  return DOWNLOADS.filter((d) => d.href === null && !d.hidden);
}

/** What each shown build is called in the platform line. */
const LINE_NAME: Record<DownloadId, string> = { mac: "Apple Silicon Macs", windows: "Windows x64", android: "Android" };

/**
 * The line under the download buttons: which builds are out (all betas),
 * that a few crew features reach Windows later when Windows shows, and what
 * is still to come.
 */
export function downloadLine(): string {
  const out = availableDownloads();
  const names = out.map((d) => LINE_NAME[d.id]).join(" and ");
  const betas = out.length > 1 ? `Betas for ${names}.` : `A beta for ${names}.`;
  const later = out.some((d) => d.id === "windows") ? " A few crew tricks reach Windows later." : "";
  const coming = comingDownloads().map((d) => d.label);
  const soon = coming.length ? ` ${coming.join(" and ")} is coming soon.` : "";
  return `${betas}${later}${soon}`;
}

/** The visitor's own system from the browser, so its download can lead; null when it is neither. */
export function visitorDownload(userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent): DownloadId | null {
  if (/Android/i.test(userAgent)) return "android";
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(userAgent) && !/iPhone|iPad/i.test(userAgent)) return "mac";
  return null;
}
