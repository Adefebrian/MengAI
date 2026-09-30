// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Finding the local engine, once per page state. There is nothing to sign
// in to: the page looks for the engine at each candidate address and uses
// the first one that answers /api/health. One look at a time: a second
// caller (React's development double effect, the 2 s poll, a retry
// pressed mid flight) shares the look in flight.
//
// When no candidate answers, the look also probes 127.0.0.1:4191..4199 in
// parallel (the Mac app moves there when 4190 is taken) and takes the lowest
// port whose health reads as a local MengAI engine. A port that only answers
// an opaque request proves nothing there, so it does not count (JEV
// sec.runtime_discovery range_closed ignore 0.76). The range is probed on the
// first look that finds nothing and then at most every 10 s while nothing
// answers, so the 2 s poll stays cheap. A found port is saved as the runtime
// address when none is saved or the saved one is itself a range address, and
// a saved range address is forgotten once 4190 or this page's own engine
// answers again; an address the owner typed outside the range is never
// overwritten (JEV sec.runtime_discovery remember_policy unset_or_discovered 0.99).
import type { HealthDTO } from "@mengai/shared";
import { createApiClient, type ApiClient, type FetchLike } from "./client";
import { RANGE_RECHECK_MS, isRangeAddress, originOf, probeRuntime, readRuntimeSetting, runtimeCandidates, runtimeRange, writeRuntimeSetting } from "./runtime";

export type Connection =
  /** nothing answers at any candidate address (`tried` lists the candidates, not the range) */
  | { kind: "offline"; tried: string[] }
  /** the engine answers, but refuses this page's origin (a site that is not on its allowlist) */
  | { kind: "refused"; base: string }
  | { kind: "ready"; base: string; health: HealthDTO };

export interface ConnectOptions {
  fetch?: FetchLike;
  /** Addresses to look at first. Given without `range`, no range is probed. */
  candidates?: string[];
  /** Range addresses to probe when no candidate answers. Defaults to 4191..4199 minus the candidates. */
  range?: string[];
  /** Clock for the range throttle (tests). */
  now?: () => number;
}

/** The typed client for one engine base. No token, no cookies across origins. */
export function runtimeClient(base: string, opts: { fetch?: FetchLike } = {}): ApiClient {
  return createApiClient({ base, fetch: opts.fetch });
}

/** When the range was last probed without finding an engine; null means probe on the next look. */
let rangeProbedAt: number | null = null;

/** The lowest range address whose health reads as a local MengAI engine, probed in parallel. */
async function probeRange(range: string[], fetch: FetchLike | undefined): Promise<{ base: string; health: HealthDTO } | null> {
  const probes = await Promise.all(range.map((base) => probeRuntime(base, { fetch, opaque: false })));
  for (let i = 0; i < range.length; i++) {
    const p = probes[i]!;
    if (p.state === "open" && p.health.mode === "local") return { base: range[i]!, health: p.health };
  }
  return null;
}

/** Keeps the saved address in step with where the engine was found. */
function remember(base: string, fromRange: boolean, saved: string | null): void {
  const origin = originOf(base);
  if (saved === origin) return;
  if (fromRange) {
    if (saved === null || isRangeAddress(saved)) writeRuntimeSetting(origin);
  } else if (saved !== null && isRangeAddress(saved)) {
    writeRuntimeSetting(null);
  }
}

async function run(opts: ConnectOptions): Promise<Connection> {
  const saved = readRuntimeSetting();
  const tried = opts.candidates ?? runtimeCandidates(undefined, saved);
  let refused: string | null = null;
  for (const base of tried) {
    const probe = await probeRuntime(base, { fetch: opts.fetch });
    if (probe.state === "open") {
      rangeProbedAt = null;
      remember(base, false, saved);
      return { kind: "ready", base, health: probe.health };
    }
    if (probe.state === "closed" && refused === null) refused = base;
  }
  const range = opts.range ?? (opts.candidates ? [] : runtimeRange(tried));
  const now = (opts.now ?? Date.now)();
  if (range.length > 0 && (rangeProbedAt === null || now - rangeProbedAt >= RANGE_RECHECK_MS)) {
    rangeProbedAt = now;
    const found = await probeRange(range, opts.fetch);
    if (found) {
      rangeProbedAt = null;
      remember(found.base, true, saved);
      return { kind: "ready", base: found.base, health: found.health };
    }
  }
  return refused === null ? { kind: "offline", tried } : { kind: "refused", base: refused };
}

let inflight: Promise<Connection> | null = null;

export function connectRuntime(opts: ConnectOptions = {}): Promise<Connection> {
  if (inflight && !opts.fetch && !opts.candidates && !opts.range) return inflight;
  const next = run(opts);
  inflight = next;
  void next.finally(() => {
    if (inflight === next) inflight = null;
  });
  return next;
}

/** Test hook: forget a pending look and the range throttle. */
export function resetConnectForTests(): void {
  inflight = null;
  rangeProbedAt = null;
}
