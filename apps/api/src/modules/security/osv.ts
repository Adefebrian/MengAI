// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// OSV client (https://osv.dev). Sends only package names, versions and
// ecosystems; never file contents, paths or project names. Callers must
// check network consent before calling. fetch is injected so tests never
// touch the network.
import type { Severity } from "@mengai/shared";
import type { PackageRef } from "./lockfiles";

export const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
export const OSV_VULN_URL = "https://api.osv.dev/v1/vulns/";

const BATCH_SIZE = 1000;
const MAX_DETAILS = 200;
const DETAIL_CONCURRENCY = 6;
const TIMEOUT_MS = 20_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OsvVuln {
  id: string;
  summary: string;
  aliases: string[];
  severity: Severity;
  fixed: string | null;
}

export interface OsvMatch {
  pkg: PackageRef;
  vuln: OsvVuln;
}

export class OsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OsvError";
  }
}

interface RawVuln {
  id?: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  severity?: Array<{ type?: string; score?: string }>;
  database_specific?: { severity?: string };
  affected?: Array<{
    package?: { name?: string; ecosystem?: string };
    ranges?: Array<{ events?: Array<{ introduced?: string; fixed?: string }> }>;
  }>;
}

function withTimeout(signal?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, t]) : t;
}

async function postJson(fetchFn: FetchLike, url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: withTimeout(signal),
  });
  if (!res.ok) throw new OsvError(`OSV responded ${res.status}`);
  return res.json();
}

async function getJson(fetchFn: FetchLike, url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetchFn(url, { method: "GET", headers: { accept: "application/json" }, signal: withTimeout(signal) });
  if (!res.ok) throw new OsvError(`OSV responded ${res.status}`);
  return res.json();
}

// --------------------------------------------------------------- severity
const W = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
} as const;

function roundUp1(x: number): number {
  const i = Math.round(x * 100_000);
  return i % 10_000 === 0 ? i / 100_000 : (Math.floor(i / 10_000) + 1) / 10;
}

/** CVSS v3.x base score from a vector string, or null when it cannot be read. */
export function cvss3Score(vector: string): number | null {
  if (!/^CVSS:3\.[01]\//.test(vector)) return null;
  const m: Record<string, string> = {};
  for (const part of vector.split("/").slice(1)) {
    const [k, v] = part.split(":");
    if (k && v) m[k] = v;
  }
  const av = W.AV[m.AV as keyof typeof W.AV];
  const ac = W.AC[m.AC as keyof typeof W.AC];
  const ui = W.UI[m.UI as keyof typeof W.UI];
  const c = W.CIA[m.C as keyof typeof W.CIA];
  const i = W.CIA[m.I as keyof typeof W.CIA];
  const a = W.CIA[m.A as keyof typeof W.CIA];
  const changed = m.S === "C";
  if (m.S !== "U" && !changed) return null;
  const pr = m.PR === "N" ? 0.85 : m.PR === "L" ? (changed ? 0.68 : 0.62) : m.PR === "H" ? (changed ? 0.5 : 0.27) : undefined;
  if ([av, ac, ui, c, i, a, pr].some((x) => x === undefined)) return null;
  const iss = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  const exploit = 8.22 * av! * ac! * pr! * ui!;
  if (impact <= 0) return 0;
  return roundUp1(Math.min(changed ? 1.08 * (impact + exploit) : impact + exploit, 10));
}

export function severityFromScore(score: number): Severity {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "info";
}

export function vulnSeverity(v: RawVuln): Severity {
  const label = v.database_specific?.severity?.toUpperCase();
  if (label === "CRITICAL") return "critical";
  if (label === "HIGH") return "high";
  if (label === "MODERATE" || label === "MEDIUM") return "medium";
  if (label === "LOW") return "low";
  let best: number | null = null;
  for (const s of v.severity ?? []) {
    if (!s.score) continue;
    const score = /^\d+(\.\d+)?$/.test(s.score) ? Number(s.score) : cvss3Score(s.score);
    if (score !== null && (best === null || score > best)) best = score;
  }
  return best === null ? "medium" : severityFromScore(best);
}

// ---------------------------------------------------------------- versions
/** Loose numeric compare for fix hints (semver-like and dotted versions). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = b.split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

function fixedVersion(v: RawVuln, pkg: PackageRef): string | null {
  const candidates: string[] = [];
  for (const aff of v.affected ?? []) {
    const name = aff.package?.name ?? "";
    if (name.toLowerCase() !== pkg.name.toLowerCase()) continue;
    for (const r of aff.ranges ?? []) {
      for (const e of r.events ?? []) {
        if (e.fixed) candidates.push(e.fixed.replace(/^v/, ""));
      }
    }
  }
  const above = candidates.filter((f) => compareVersions(f, pkg.version) > 0).sort(compareVersions);
  return above[0] ?? null;
}

function toVuln(raw: RawVuln, pkg: PackageRef): OsvVuln {
  const summary = raw.summary || raw.details?.split("\n")[0] || raw.id || "Known vulnerability";
  return {
    id: raw.id ?? "unknown",
    summary: summary.slice(0, 240),
    aliases: (raw.aliases ?? []).slice(0, 6),
    severity: vulnSeverity(raw),
    fixed: fixedVersion(raw, pkg),
  };
}

// ------------------------------------------------------------------ query
/** Batch-queries OSV for every package; returns one match per (package, vuln). */
export async function queryOsv(pkgs: PackageRef[], opts: { fetch: FetchLike; signal?: AbortSignal }): Promise<OsvMatch[]> {
  const hits: Array<{ pkg: PackageRef; ids: string[] }> = [];
  for (let start = 0; start < pkgs.length; start += BATCH_SIZE) {
    const chunk = pkgs.slice(start, start + BATCH_SIZE);
    const body = { queries: chunk.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })) };
    const data = (await postJson(opts.fetch, OSV_BATCH_URL, body, opts.signal)) as { results?: Array<{ vulns?: Array<{ id?: string }> }> };
    const results = Array.isArray(data?.results) ? data.results : [];
    chunk.forEach((pkg, i) => {
      const ids = (results[i]?.vulns ?? []).map((v) => v.id).filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9._:-]{3,80}$/.test(id));
      if (ids.length) hits.push({ pkg, ids });
    });
  }
  const unique = [...new Set(hits.flatMap((h) => h.ids))].slice(0, MAX_DETAILS);
  const details = new Map<string, RawVuln>();
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const id = unique[next++]!;
      try {
        details.set(id, (await getJson(opts.fetch, OSV_VULN_URL + encodeURIComponent(id), opts.signal)) as RawVuln);
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        details.set(id, { id });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, unique.length) }, worker));
  const out: OsvMatch[] = [];
  for (const h of hits) {
    for (const id of h.ids) out.push({ pkg: h.pkg, vuln: toVuln(details.get(id) ?? { id }, h.pkg) });
  }
  return out;
}
