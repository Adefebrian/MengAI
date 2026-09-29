// GET /api/decisions?runId=&limit=  -> DecisionDTO[]
//   query: runId?: string (id chars, 1 to 64), limit?: number (1 to MAX_LIST_LIMIT,
//          default DEFAULT_LIST_LIMIT); 422 invalid_query otherwise
//   order: the latest `limit` rows, returned OLDEST FIRST (created_at asc, id asc).
//   Deliberately the opposite of GET /api/evals (newest first): this is append
//   order, shared with the runs snapshot and the SSE `decision` events the run
//   panel appends (JEV be.api_quality list_order: per_route_documented).
import { Hono } from "hono";
import { z } from "zod";
import { parseQuery } from "../../lib/http";
import type { JevDecisionService } from "./service";
import { MAX_LIST_LIMIT } from "./service";

const ListQuery = z.object({
  runId: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,64}$/, "must be an id")
    .optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
});

export function decisionRoutes(service: Pick<JevDecisionService, "list">): Hono {
  return new Hono().get("/", async (c) => {
    const q = parseQuery(c, ListQuery);
    return c.json(await service.list(q.runId, { limit: q.limit }));
  });
}
