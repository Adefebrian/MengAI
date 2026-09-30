// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// HTTP surface for generated assets (mounted at /api/assets). Parse and
// validate, call the service, shape the response. The file route adds the
// serving headers (stored mime, nosniff, sandbox CSP) and byte ranges so
// video seeking works in WKWebView.
import { ASSET_KINDS } from "@mengai/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { consumeLimit } from "../../core/hardening";
import type { Kv } from "../../core/ports/kv";
import { HttpError, errorBody, parseBody, parseQuery } from "../../lib/http";
import type { AssetFile, AssetsModuleService } from "./service";

const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const CreateAssetSchema = z
  .object({
    kind: z.enum(ASSET_KINDS),
    prompt: z.string().trim().min(1).max(4000),
    providerId: Id.optional(),
    model: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:/@+-]+$/).optional(),
    size: z.enum(["1024x1024", "1536x1024", "1024x1536"]).optional(),
    durationSec: z.number().int().min(1).max(60).optional(),
    runId: Id.optional(),
  })
  .strict();

const ListQuery = z.object({
  runId: Id.optional(),
  kind: z.enum(ASSET_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

function param(c: Context, name: string): string {
  const r = Id.safeParse(c.req.param(name));
  if (!r.success) throw new HttpError(422, "invalid_param", `${name}: invalid id`);
  return r.data;
}

/** Per-route limit on the shared kv counter from core hardening (single-owner API); fails open on kv errors. */
async function routeLimit(c: Context, kv: Kv, bucket: string, max: number, windowSec: number): Promise<Response | null> {
  let r;
  try {
    r = await consumeLimit(kv, `route:${bucket}`, max, windowSec);
  } catch {
    return null;
  }
  if (r.allowed) return null;
  c.header("Retry-After", String(r.retryAfterSec));
  return c.json(errorBody("rate_limited", "Too many generations requested, try again shortly"), 429);
}

/** Serve bytes without copying when they already sit in a plain ArrayBuffer. */
function bodyOf(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return data.buffer instanceof ArrayBuffer ? (data as Uint8Array<ArrayBuffer>) : new Uint8Array(data);
}

export function fileHeaders(f: AssetFile): Record<string, string> {
  return {
    "content-type": f.mime,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "cache-control": "private, max-age=3600",
    "accept-ranges": "bytes",
    "content-disposition": `${f.inline ? "inline" : "attachment"}; filename="${f.filename}"`,
  };
}

/** Single byte range per RFC 9110; malformed or multi-range headers get the full body. */
export function parseRange(header: string | undefined, total: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
  }
  if (start >= total || start > end) return "unsatisfiable";
  return { start, end };
}

export function assetsRoutes(service: AssetsModuleService, env: { kv: Kv }): Hono {
  return new Hono()
    .get("/", async (c) => {
      const q = parseQuery(c, ListQuery);
      return c.json(await service.list(q));
    })
    .post("/", async (c) => {
      const limited = await routeLimit(c, env.kv, "assets.generate", 20, 60);
      if (limited) return limited;
      const body = await parseBody(c, CreateAssetSchema);
      const asset = await service.generate(body);
      return c.json(asset, asset.status === "queued" || asset.status === "running" ? 202 : 201);
    })
    .get("/:id/file", async (c) => {
      const f = await service.file(param(c, "id"));
      const total = f.data.byteLength;
      const headers = fileHeaders(f);
      const range = parseRange(c.req.header("range"), total);
      if (range === "unsatisfiable") {
        return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${total}` } });
      }
      if (range) {
        // BlobStore has no ranged read yet, so the part is a view into the loaded blob (no copy)
        const part = bodyOf(f.data.subarray(range.start, range.end + 1));
        return new Response(part, {
          status: 206,
          headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${total}`, "content-length": String(part.byteLength) },
        });
      }
      return new Response(bodyOf(f.data), { status: 200, headers: { ...headers, "content-length": String(total) } });
    })
    .delete("/:id", async (c) => {
      await service.remove(param(c, "id"));
      return c.json({ ok: true as const });
    });
}
