// Persistence for generated assets. Owns the assets table only.
import type { AssetDTO, AssetKind, AssetStatus } from "@mengai/shared";
import type { Db } from "../../core/ports/db";
import { num, numOrNull } from "../../lib/sql";

export interface AssetRow {
  id: string;
  runId: string | null;
  kind: AssetKind;
  status: AssetStatus;
  providerId: string;
  model: string;
  prompt: string;
  blobKey: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  costUsd: number;
  error: string | null;
  jobId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type AssetPatch = Partial<Pick<AssetRow, "status" | "blobKey" | "mime" | "width" | "height" | "durationMs" | "costUsd" | "error" | "jobId">>;

function fromDb(r: Record<string, unknown>): AssetRow {
  return {
    id: String(r.id),
    runId: (r.run_id as string | null) ?? null,
    kind: String(r.kind) as AssetKind,
    status: String(r.status) as AssetStatus,
    providerId: String(r.provider_id),
    model: String(r.model),
    prompt: String(r.prompt),
    blobKey: (r.blob_key as string | null) ?? null,
    mime: (r.mime as string | null) ?? null,
    width: numOrNull(r.width),
    height: numOrNull(r.height),
    durationMs: numOrNull(r.duration_ms),
    costUsd: num(r.cost_usd),
    error: (r.error as string | null) ?? null,
    jobId: (r.job_id as string | null) ?? null,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export function toAssetDTO(a: AssetRow): AssetDTO {
  return {
    id: a.id,
    runId: a.runId,
    kind: a.kind,
    status: a.status,
    providerId: a.providerId,
    model: a.model,
    prompt: a.prompt,
    url: a.status === "done" && a.blobKey ? `/api/assets/${a.id}/file` : null,
    mime: a.mime,
    width: a.width,
    height: a.height,
    durationMs: a.durationMs,
    costUsd: a.costUsd,
    error: a.error,
    createdAt: a.createdAt,
  };
}

export function createAssetsRepo(db: Db) {
  return {
    async insert(a: AssetRow): Promise<void> {
      await db.query`insert into assets (id, run_id, kind, status, provider_id, model, prompt, blob_key, mime, width, height, duration_ms, cost_usd, error, job_id, created_at, updated_at)
        values (${a.id}, ${a.runId}, ${a.kind}, ${a.status}, ${a.providerId}, ${a.model}, ${a.prompt}, ${a.blobKey}, ${a.mime}, ${a.width}, ${a.height}, ${a.durationMs}, ${a.costUsd}, ${a.error}, ${a.jobId}, ${a.createdAt}, ${a.updatedAt})`;
    },

    /** Applies the patch to the stored row and returns the result, or null when the row is gone. */
    async update(id: string, patch: AssetPatch, now: number): Promise<AssetRow | null> {
      const cur = await this.get(id);
      if (!cur) return null;
      const n: AssetRow = { ...cur, ...patch, updatedAt: now };
      await db.query`update assets set status = ${n.status}, blob_key = ${n.blobKey}, mime = ${n.mime}, width = ${n.width}, height = ${n.height},
        duration_ms = ${n.durationMs}, cost_usd = ${n.costUsd}, error = ${n.error}, job_id = ${n.jobId}, updated_at = ${n.updatedAt} where id = ${id}`;
      return n;
    },

    async get(id: string): Promise<AssetRow | null> {
      const rows = await db.query`select * from assets where id = ${id}`;
      return rows[0] ? fromDb(rows[0]) : null;
    },

    async list(q: { runId?: string; kind?: AssetKind; limit: number }): Promise<AssetRow[]> {
      const rows =
        q.runId && q.kind
          ? await db.query`select * from assets where run_id = ${q.runId} and kind = ${q.kind} order by created_at desc, id desc limit ${q.limit}`
          : q.runId
            ? await db.query`select * from assets where run_id = ${q.runId} order by created_at desc, id desc limit ${q.limit}`
            : q.kind
              ? await db.query`select * from assets where kind = ${q.kind} order by created_at desc, id desc limit ${q.limit}`
              : await db.query`select * from assets order by created_at desc, id desc limit ${q.limit}`;
      return rows.map(fromDb);
    },

    async pendingVideos(): Promise<AssetRow[]> {
      const rows = await db.query`select * from assets where kind = ${"video"} and status in (${"queued"}, ${"running"}) and job_id is not null order by created_at asc limit 100`;
      return rows.map(fromDb);
    },

    async remove(id: string): Promise<void> {
      await db.query`delete from assets where id = ${id}`;
    },
  };
}

export type AssetsRepo = ReturnType<typeof createAssetsRepo>;
