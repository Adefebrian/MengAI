// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// GET /api/usage: aggregated usage report. Validation only, no logic.
import { Hono } from "hono";
import { z } from "zod";
import { badRequest, parseQuery } from "../../lib/http";
import type { UsageModuleService } from "./service";

const ReportQuery = z
  .object({
    runId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
    from: z.coerce.number().int().min(0).optional(),
    to: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export function usageRoutes(service: UsageModuleService): Hono {
  return new Hono().get("/", async (c) => {
    const q = parseQuery(c, ReportQuery);
    if (q.from !== undefined && q.to !== undefined && q.to < q.from) throw badRequest("to must not be before from", "invalid_query");
    return c.json(await service.report(q));
  });
}
