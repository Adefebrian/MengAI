// The Mac app opens http://127.0.0.1:<port>/#launch=<token>. The token is
// single use: it is read once, removed from the address bar before any
// request (so it never lands in history, a bookmark or a screenshot), and
// posted to POST /api/auth/launch exactly once per page load.
import type { SessionDTO } from "@mengai/shared";
import type { ApiClient } from "./client";

export function readLaunchToken(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  const token = params.get("launch");
  return token && /^[A-Za-z0-9._~-]{16,256}$/.test(token) ? token : null;
}

let inflight: Promise<SessionDTO | null> | null = null;

/** Strip #launch from the URL and exchange it once. Returns null when there is no token. */
export function consumeLaunchToken(api: ApiClient, loc: Pick<Location, "hash" | "pathname" | "search"> = window.location): Promise<SessionDTO | null> {
  if (inflight) return inflight;
  const token = readLaunchToken(loc.hash);
  if (!token) return Promise.resolve(null);
  if (typeof window !== "undefined" && window.history?.replaceState) {
    window.history.replaceState(null, "", loc.pathname + loc.search);
  }
  inflight = api.call("POST /api/auth/launch", { body: { token } });
  return inflight;
}

/** Test hook: forget the one-shot exchange. */
export function resetLaunchForTests(): void {
  inflight = null;
}
