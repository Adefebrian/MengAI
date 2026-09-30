// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// HTTP surface for security scans (mounted at /api/security). Parse and
// validate, call the service, shape the response. No business logic here.
import { FINDING_STATUSES, SCAN_KINDS, SEVERITIES } from "@mengai/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { consumeLimit } from "../../core/hardening";
import type { Kv } from "../../core/ports/kv";
import { HttpError, errorBody, parseBody, parseQuery } from "../../lib/http";
import type { SecurityModuleService } from "./service";

const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const CreateScanSchema = z
  .object({
    projectId: Id,
    kinds: z.array(z.enum(SCAN_KINDS)).min(1).max(SCAN_KINDS.length),
  })
  .strict();

const ListScansQuery = z.object({
  projectId: Id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const FindingsQuery = z.object({
  severity: z.enum(SEVERITIES).optional(),
  status: z.enum(FINDING_STATUSES).optional(),
});

export const FindingPatchSchema = z.object({ status: z.enum(FINDING_STATUSES) }).strict();

function param(c: Context, name: string): string {
  const r = Id.safeParse(c.req.param(name));
  if (!r.success) throw new HttpError(422, "invalid_param", `${name}: invalid id`);
  return r.data;
}

/**
 * Per-route limit on an expensive route, on the shared kv counter from core
 * hardening. Keyed by route bucket only: the API serves a single owner, so
 * there is no client-controlled key to rotate. Fails open when the kv store
 * errors (the global limiter still applies).
 */
async function routeLimit(c: Context, kv: Kv, bucket: string, max: number, windowSec: number, message: string): Promise<Response | null> {
  let r;
  try {
    r = await consumeLimit(kv, `route:${bucket}`, max, windowSec);
  } catch {
    return null;
  }
  if (r.allowed) return null;
  c.header("Retry-After", String(r.retryAfterSec));
  return c.json(errorBody("rate_limited", message), 429);
}

export function securityRoutes(service: SecurityModuleService, env: { kv: Kv }): Hono {
  return new Hono()
    .post("/scans", async (c) => {
      const limited = await routeLimit(c, env.kv, "security.scan", 6, 60, "Too many scans started, try again shortly");
      if (limited) return limited;
      const body = await parseBody(c, CreateScanSchema);
      const scan = await service.start({ projectId: body.projectId, kinds: [...new Set(body.kinds)] });
      return c.json(scan, 201);
    })
    .get("/scans", async (c) => {
      const q = parseQuery(c, ListScansQuery);
      return c.json(await service.listScans(q));
    })
    .get("/scans/:id/findings", async (c) => {
      const q = parseQuery(c, FindingsQuery);
      return c.json(await service.findings(param(c, "id"), q));
    })
    .patch("/findings/:id", async (c) => {
      const id = param(c, "id");
      const body = await parseBody(c, FindingPatchSchema);
      return c.json(await service.setFindingStatus(id, body.status));
    });
}
