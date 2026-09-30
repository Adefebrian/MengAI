// The local runtime this page talks to. MengAI has no accounts and the
// website stores nothing: the page (served by the website or by the runtime
// itself) talks straight to the MengAI runtime on the owner's own machine,
// the Mac app or `bun run dev`, on 127.0.0.1. Keys typed into the page go
// from the browser to that runtime and into its OS keychain.
//
// Where it looks: the runtime address setting when one is saved, else the
// page's own origin when the page is served from this machine, else
// http://127.0.0.1:4190. Only loopback addresses are accepted, so neither a
// crafted link nor a typo can point the page (and the keys typed into it) at
// another machine.
//
// How it signs in: the runtime opens <website>/app#pair=<one-time token>.
// The page removes the token from the address bar first, posts it to the
// runtime's POST /api/auth/pair and keeps the bearer session token it gets
// back in localStorage, one per runtime address. Cookies are only used when
// the page and the runtime share an origin.
import type { HealthDTO } from "@mengai/shared";
import type { FetchLike } from "./client";

export const DEFAULT_RUNTIME_URL = "http://127.0.0.1:4190";
export const MAC_DOWNLOAD_URL = "https://github.com/Adefebrian/MengAI/releases/latest";
export const REPO_URL = "https://github.com/Adefebrian/MengAI";

const RUNTIME_KEY = "mengai.runtime";
const TOKENS_KEY = "mengai.runtimeTokens";
const TOKEN = /^[A-Za-z0-9._~+/=-]{16,512}$/;

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

// --------------------------------------------------------------- sessions
function readTokens(): Record<string, string> {
  try {
    const raw = storage()?.getItem(TOKENS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === "string" && TOKEN.test(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function writeTokens(map: Record<string, string>): void {
  try {
    const s = storage();
    if (!s) return;
    if (Object.keys(map).length) s.setItem(TOKENS_KEY, JSON.stringify(map));
    else s.removeItem(TOKENS_KEY);
  } catch {
    // private mode: the session lasts for this page only
  }
}

/** The bearer session token for one runtime origin. */
export function readSessionToken(origin: string): string | null {
  return readTokens()[origin] ?? null;
}

export function writeSessionToken(origin: string, token: string): void {
  if (!TOKEN.test(token)) return;
  writeTokens({ ...readTokens(), [origin]: token });
}

export function clearSessionToken(origin: string): void {
  const map = readTokens();
  if (!(origin in map)) return;
  delete map[origin];
  writeTokens(map);
}

// ------------------------------------------------------------ pairing links
export interface PairLink {
  kind: "pair" | "launch";
  token: string;
  /** a loopback runtime address the link carries, when it names one */
  runtime: string | null;
}

/**
 * A pairing link from a hash ("#pair=..."), a whole link someone pasted, or
 * the bare token. A launch link (#launch=...) is the same-origin sign in the
 * runtime's own page uses. A runtime address that is not loopback is dropped.
 */
export function readPairLink(input: string): PairLink | null {
  const raw = input.trim();
  if (!raw) return null;
  const hash = raw.includes("#") ? raw.slice(raw.indexOf("#") + 1) : /^[?]?(?:pair|launch|runtime)=/.test(raw) ? raw.replace(/^[?]/, "") : "";
  if (hash) {
    const params = new URLSearchParams(hash);
    const runtime = params.get("runtime");
    for (const kind of ["pair", "launch"] as const) {
      const token = params.get(kind);
      if (token && TOKEN.test(token) && token.length <= 256) return { kind, token, runtime: runtime ? normalizeRuntimeUrl(runtime) : null };
    }
    return null;
  }
  return TOKEN.test(raw) && raw.length <= 256 ? { kind: "pair", token: raw, runtime: null } : null;
}

/** True when a hash carries a pairing or a launch token, or a runtime address. */
export function hasPairHash(hash: string): boolean {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return params.has("pair") || params.has("launch") || params.has("runtime");
}

// ------------------------------------------------------------------ probe
export type Probe =
  /** the runtime answered and this page may read it */
  | { state: "open"; health: HealthDTO }
  /** something answers on that address, but it does not let this page read it yet (not paired) */
  | { state: "closed" }
  /** nothing answers */
  | { state: "down" };

function isHealth(v: unknown): v is HealthDTO {
  return !!v && typeof v === "object" && (v as HealthDTO).ok === true && typeof (v as HealthDTO).version === "string";
}

/** Look for the runtime at one base, within a short timeout. */
export async function probeRuntime(base: string, opts: { fetch?: FetchLike; timeoutMs?: number } = {}): Promise<Probe> {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const url = `${base}/api/health`;
  const timeout = () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 2500);
    return { signal: ctrl.signal, done: () => clearTimeout(t) };
  };
  const first = timeout();
  try {
    const res = await doFetch(url, { method: "GET", headers: { accept: "application/json" }, credentials: base ? "omit" : "include", cache: "no-store", signal: first.signal });
    if (!res.ok) return { state: "closed" };
    const body = (await res.json().catch(() => null)) as unknown;
    // a page server that answers every path with index.html is not the runtime
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
