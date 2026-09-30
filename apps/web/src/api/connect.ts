// Finding and signing in to the local runtime, once per page state. The
// sequence: take a pairing link out of the address bar (before any
// request, so the one-time token never lands in history), look for the
// runtime at each candidate address, exchange the link for a session, then
// read the session. One exchange at a time: a second caller (React's
// development double effect, a retry pressed mid flight) shares the first.
import type { HealthDTO, SessionDTO } from "@mengai/shared";
import { ApiError, createApiClient, errorMessage, type ApiClient, type FetchLike } from "./client";
import {
  clearSessionToken,
  hasPairHash,
  normalizeRuntimeUrl,
  originOf,
  probeRuntime,
  readPairLink,
  readSessionToken,
  runtimeCandidates,
  writeRuntimeSetting,
  writeSessionToken,
  type PairLink,
} from "./runtime";

export type Connection =
  /** nothing answers at any candidate address */
  | { kind: "offline"; tried: string[] }
  /** the runtime answers, but this browser holds no session for it */
  | { kind: "unpaired"; base: string; error: string | null; health: HealthDTO | null }
  | { kind: "ready"; base: string; session: SessionDTO };

export interface ConnectOptions {
  /** a pairing link to exchange first (from the address bar or pasted) */
  link?: PairLink | null;
  fetch?: FetchLike;
  candidates?: string[];
}

/**
 * Read #pair or #launch from the address bar and remove it at once. A
 * #runtime=<loopback address> on its own (the runtime on another port
 * opening a page that is already paired) saves that address.
 */
export function takePairLink(): PairLink | null {
  if (typeof window === "undefined") return null;
  const { hash, pathname, search } = window.location;
  if (!hasPairHash(hash)) return null;
  window.history?.replaceState?.(null, "", pathname + search);
  const link = readPairLink(hash);
  if (!link) {
    const runtime = normalizeRuntimeUrl(new URLSearchParams(hash.replace(/^#/, "")).get("runtime") ?? "");
    if (runtime) writeRuntimeSetting(runtime);
  }
  return link;
}

/** The typed client for one runtime base, signed with its stored session. */
export function runtimeClient(base: string, opts: { fetch?: FetchLike; onUnauthenticated?: () => void } = {}): ApiClient {
  const origin = originOf(base);
  return createApiClient({
    base,
    fetch: opts.fetch,
    token: () => readSessionToken(origin),
    onUnauthenticated: () => {
      clearSessionToken(origin);
      opts.onUnauthenticated?.();
    },
  });
}

function pairFailure(err: unknown): string {
  if (err instanceof ApiError && (err.status === 400 || err.status === 401 || err.status === 403 || err.status === 404 || err.status === 410)) {
    return "That pairing link was used already or has run out. Click Open in browser in the MengAI menu for a fresh one.";
  }
  return `Pairing did not finish: ${errorMessage(err)}`;
}

async function run(opts: ConnectOptions): Promise<Connection> {
  const link = opts.link ?? null;
  if (link?.runtime) writeRuntimeSetting(link.runtime);
  const tried = opts.candidates ?? runtimeCandidates();
  let base: string | null = null;
  let health: HealthDTO | null = null;
  for (const b of tried) {
    const probe = await probeRuntime(b, { fetch: opts.fetch });
    if (probe.state === "down") continue;
    base = b;
    health = probe.state === "open" ? probe.health : null;
    break;
  }
  if (base === null) return { kind: "offline", tried };

  const origin = originOf(base);
  const api = runtimeClient(base, { fetch: opts.fetch });
  let error: string | null = null;
  if (link?.kind === "pair") {
    try {
      const out = await api.call("POST /api/auth/pair", { body: { token: link.token } });
      writeSessionToken(origin, out.sessionToken);
    } catch (err) {
      error = pairFailure(err);
    }
  } else if (link?.kind === "launch") {
    try {
      if (base) throw new ApiError(400, "launch_cross_origin", "A launch link only works on the page MengAI serves itself.");
      await api.call("POST /api/auth/launch", { body: { token: link.token } });
    } catch (err) {
      error = pairFailure(err);
    }
  }

  try {
    const session = await api.call("GET /api/session");
    if (session.authenticated) return { kind: "ready", base, session };
    clearSessionToken(origin);
    return { kind: "unpaired", base, error, health };
  } catch (err) {
    // A refused CORS read (this origin is not paired yet) surfaces as a
    // network error from a runtime that did answer the probe.
    if (err instanceof ApiError && (err.isNetwork || err.isAuth)) return { kind: "unpaired", base, error, health };
    return { kind: "unpaired", base, error: error ?? errorMessage(err), health };
  }
}

let inflight: Promise<Connection> | null = null;

export function connectRuntime(opts: ConnectOptions = {}): Promise<Connection> {
  if (inflight && !opts.link) return inflight;
  const next = (inflight ? inflight.catch(() => null) : Promise.resolve(null)).then(() => run(opts));
  inflight = next;
  void next.finally(() => {
    if (inflight === next) inflight = null;
  });
  return next;
}

/** Test hook: forget a pending connection. */
export function resetConnectForTests(): void {
  inflight = null;
}
