// Finding the local engine, once per page state. There is nothing to sign
// in to: the page looks for the engine at each candidate address and uses
// the first one that answers /api/health. One look at a time: a second
// caller (React's development double effect, the 2 s poll, a retry
// pressed mid flight) shares the look in flight.
import type { HealthDTO } from "@mengai/shared";
import { createApiClient, type ApiClient, type FetchLike } from "./client";
import { probeRuntime, runtimeCandidates } from "./runtime";

export type Connection =
  /** nothing answers at any candidate address */
  | { kind: "offline"; tried: string[] }
  /** the engine answers, but refuses this page's origin (a site that is not on its allowlist) */
  | { kind: "refused"; base: string }
  | { kind: "ready"; base: string; health: HealthDTO };

export interface ConnectOptions {
  fetch?: FetchLike;
  candidates?: string[];
}

/** The typed client for one engine base. No token, no cookies across origins. */
export function runtimeClient(base: string, opts: { fetch?: FetchLike } = {}): ApiClient {
  return createApiClient({ base, fetch: opts.fetch });
}

async function run(opts: ConnectOptions): Promise<Connection> {
  const tried = opts.candidates ?? runtimeCandidates();
  let refused: string | null = null;
  for (const base of tried) {
    const probe = await probeRuntime(base, { fetch: opts.fetch });
    if (probe.state === "open") return { kind: "ready", base, health: probe.health };
    if (probe.state === "closed" && refused === null) refused = base;
  }
  return refused === null ? { kind: "offline", tried } : { kind: "refused", base: refused };
}

let inflight: Promise<Connection> | null = null;

export function connectRuntime(opts: ConnectOptions = {}): Promise<Connection> {
  if (inflight && !opts.fetch && !opts.candidates) return inflight;
  const next = run(opts);
  inflight = next;
  void next.finally(() => {
    if (inflight === next) inflight = null;
  });
  return next;
}

/** Test hook: forget a pending look. */
export function resetConnectForTests(): void {
  inflight = null;
}
