// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Persistence for the security module. Owns the scans and findings tables
// only; portable SQL through the Db port.
import type { FindingDTO, FindingStatus, ScanDTO, ScanKind, ScanStatus, Severity } from "@mengai/shared";
import type { Db } from "../../core/ports/db";
import { json, num, numOrNull, toJson } from "../../lib/sql";
import { SEVERITY_RANK } from "./util";

export interface FindingRow extends FindingDTO {
  fingerprint: string;
  createdAt: number;
}

export function emptyCounts(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function toScan(r: Record<string, unknown>): ScanDTO {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    kinds: json<ScanKind[]>(r.kinds, []),
    status: String(r.status) as ScanStatus,
    counts: { ...emptyCounts(), ...json<Partial<Record<Severity, number>>>(r.counts, {}) },
    error: (r.error as string | null) ?? null,
    createdAt: num(r.created_at),
    finishedAt: numOrNull(r.finished_at),
  };
}

function toFinding(r: Record<string, unknown>): FindingDTO {
  return {
    id: String(r.id),
    scanId: String(r.scan_id),
    kind: String(r.kind) as ScanKind,
    severity: String(r.severity) as Severity,
    rule: String(r.rule),
    title: String(r.title),
    file: (r.file as string | null) ?? null,
    line: numOrNull(r.line),
    detail: String(r.detail),
    fix: (r.fix as string | null) ?? null,
    status: String(r.status) as FindingStatus,
  };
}

export function createSecurityRepo(db: Db) {
  return {
    async insertScan(s: ScanDTO): Promise<void> {
      await db.query`insert into scans (id, project_id, kinds, status, counts, error, created_at, finished_at)
        values (${s.id}, ${s.projectId}, ${toJson(s.kinds)}, ${s.status}, ${toJson(s.counts)}, ${s.error}, ${s.createdAt}, ${s.finishedAt})`;
    },

    async finishScan(id: string, patch: { status: ScanStatus; counts: Record<Severity, number>; error: string | null; finishedAt: number }): Promise<void> {
      await db.query`update scans set status = ${patch.status}, counts = ${toJson(patch.counts)}, error = ${patch.error}, finished_at = ${patch.finishedAt} where id = ${id}`;
    },

    async getScan(id: string): Promise<ScanDTO | null> {
      const rows = await db.query`select * from scans where id = ${id}`;
      return rows[0] ? toScan(rows[0]) : null;
    },

    async listScans(q: { projectId?: string; limit: number }): Promise<ScanDTO[]> {
      const rows = q.projectId
        ? await db.query`select * from scans where project_id = ${q.projectId} order by created_at desc, id desc limit ${q.limit}`
        : await db.query`select * from scans order by created_at desc, id desc limit ${q.limit}`;
      return rows.map(toScan);
    },

    async insertFindings(rows: FindingRow[]): Promise<void> {
      if (!rows.length) return;
      await db.tx(async (tx) => {
        for (const f of rows) {
          await tx.query`insert into findings (id, scan_id, kind, severity, rule, title, file, line, detail, fix, status, fingerprint, created_at)
            values (${f.id}, ${f.scanId}, ${f.kind}, ${f.severity}, ${f.rule}, ${f.title}, ${f.file}, ${f.line}, ${f.detail}, ${f.fix}, ${f.status}, ${f.fingerprint}, ${f.createdAt})`;
        }
      });
    },

    async listFindings(scanId: string, q: { severity?: Severity; status?: FindingStatus } = {}): Promise<FindingDTO[]> {
      const rows = await db.query`select * from findings where scan_id = ${scanId}`;
      return rows
        .map(toFinding)
        .filter((f) => (!q.severity || f.severity === q.severity) && (!q.status || f.status === q.status))
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0));
    },

    async getFinding(id: string): Promise<FindingDTO | null> {
      const rows = await db.query`select * from findings where id = ${id}`;
      return rows[0] ? toFinding(rows[0]) : null;
    },

    async setFindingStatus(id: string, status: FindingStatus): Promise<void> {
      await db.query`update findings set status = ${status} where id = ${id}`;
    },

    /** newest known status and severity per fingerprint across earlier scans of the project */
    async priorByFingerprint(projectId: string, excludeScanId: string): Promise<Map<string, { status: FindingStatus; severity: Severity }>> {
      const rows = await db.query<{ fingerprint: string; status: string; severity: string }>`
        select f.fingerprint as fingerprint, f.status as status, f.severity as severity
        from findings f join scans s on s.id = f.scan_id
        where s.project_id = ${projectId} and f.scan_id <> ${excludeScanId}
        order by f.created_at desc, f.id desc
        limit 5000`;
      const out = new Map<string, { status: FindingStatus; severity: Severity }>();
      for (const r of rows) {
        if (!out.has(r.fingerprint)) out.set(r.fingerprint, { status: r.status as FindingStatus, severity: r.severity as Severity });
      }
      return out;
    },
  };
}

export type SecurityRepo = ReturnType<typeof createSecurityRepo>;
