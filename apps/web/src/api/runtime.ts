// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The local engine this page talks to. MengAI has no accounts and no sign
// in of any kind: the crew engine runs on the owner's own Mac (the MengAI
// app, or `bun run dev` from the repo) on 127.0.0.1, and this page, served
// by the engine itself or as a static copy on the MengAI website, talks
// straight to it. Trust comes from where the engine listens and from its
// own request checks (Host, an exact Origin allowlist, JSON only on every
// write), never from a token this page holds. Keys typed into the page go
// from the browser to the engine and into its OS keychain; the page keeps
// only UI preferences in localStorage.
//
// Where it looks: the runtime address setting when one is saved, else the
// page's own origin when the page is served from this machine, else
// http://127.0.0.1:4190. Only loopback addresses are accepted, so neither a
// crafted link nor a typo can point the page (and the keys typed into it)
// at another machine.
import type { HealthDTO } from "@mengai/shared";
import type { FetchLike } from "./client";

export const DEFAULT_RUNTIME_URL = "http://127.0.0.1:4190";
export const REPO_URL = "https://github.com/Adefebrian/MengAI";
/** The Mac beta. It is a prerelease, so releases/latest does not point at it. */
export const MAC_DOWNLOAD_URL = `${REPO_URL}/releases/tag/v0.1.0-beta`;

const RUNTIME_KEY = "mengai.runtime";

type PageLocation = Pick<Location, "origin" | "hostname">;

function page(): PageLocation {
  if (typeof window === "undefined") return { origin: "http://localhost", hostname: "localhost" };
  return window.location;
}

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || h === "[::1]" || h === "::1" || /^127(?:\.\d{1,3}){3}$/.test(h);
}

/** A runtime address as an origin, or null when it is not a loopback http(s) address. */
export function normalizeRuntimeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!isLoopbackHost(url.hostname)) return null;
  return url.origin;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The saved runtime address, or null for the default lookup. */
export function readRuntimeSetting(): string | null {
  const v = storage()?.getItem(RUNTIME_KEY);
  return v ? normalizeRuntimeUrl(v) : null;
}

export function writeRuntimeSetting(url: string | null): void {
  const s = storage();
  if (!s) return;
  try {
    const norm = url ? normalizeRuntimeUrl(url) : null;
    if (norm) s.setItem(RUNTIME_KEY, norm);
    else s.removeItem(RUNTIME_KEY);
  } catch {
    // private mode: the address lasts for this page only
  }
}

/** The client base for a runtime origin: "" when it is this page's own origin. */
export function baseFor(origin: string, loc: PageLocation = page()): string {
  return origin === loc.origin ? "" : origin;
}

/** The origin a base points at, "" meaning this page's origin. */
export function originOf(base: string, loc: PageLocation = page()): string {
  return base || loc.origin;
}

/** Where to look for the runtime, in order. */
export function runtimeCandidates(loc: PageLocation = page(), setting: string | null = readRuntimeSetting()): string[] {
  if (setting) return [baseFor(setting, loc)];
  const list: string[] = [];
  if (isLoopbackHost(loc.hostname)) list.push("");
  if (loc.origin !== DEFAULT_RUNTIME_URL) list.push(DEFAULT_RUNTIME_URL);
  return list;
}

/** The address a person reads: the runtime origin without the scheme. */
export function runtimeLabel(base: string, loc: PageLocation = page()): string {
  return originOf(base, loc).replace(/^https?:\/\//, "");
}

// ------------------------------------------------------------------ probe
export type Probe =
  /** the engine answered and this page may read it */
  | { state: "open"; health: HealthDTO }
  /** something answers on that address, but it refuses this page's origin (a site that is not on its allowlist) */
  | { state: "closed" }
  /** nothing answers */
  | { state: "down" };

function isHealth(v: unknown): v is HealthDTO {
  return !!v && typeof v === "object" && (v as HealthDTO).ok === true && typeof (v as HealthDTO).version === "string";
}

/** Look for the engine at one base, within a short timeout. No cookies, no credentials. */
export async function probeRuntime(base: string, opts: { fetch?: FetchLike; timeoutMs?: number } = {}): Promise<Probe> {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const url = `${base}/api/health`;
  const timeout = () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 1800);
    return { signal: ctrl.signal, done: () => clearTimeout(t) };
  };
  const first = timeout();
  try {
    const res = await doFetch(url, { method: "GET", headers: { accept: "application/json" }, credentials: "omit", cache: "no-store", signal: first.signal });
    if (res.status === 403) return { state: "closed" };
    if (!res.ok) return { state: "down" };
    const body = (await res.json().catch(() => null)) as unknown;
    // a page server that answers every path with index.html is not the engine
    return isHealth(body) ? { state: "open", health: body } : { state: "down" };
  } catch {
    if (!base) return { state: "down" };
  } finally {
    first.done();
  }
  // Cross origin: a refused CORS read and a closed port look the same to
  // fetch. An opaque request tells them apart without reading anything.
  const second = timeout();
  try {
    await doFetch(url, { method: "GET", mode: "no-cors", credentials: "omit", cache: "no-store", signal: second.signal });
    return { state: "closed" };
  } catch {
    return { state: "down" };
  } finally {
    second.done();
  }
}
