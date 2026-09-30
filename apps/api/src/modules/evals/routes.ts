// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// GET  /api/evals?suite=&limit=  -> EvalRunDTO[]
//   query: suite?: string (suite id), limit?: number (1 to MAX_LIST_LIMIT,
//          default DEFAULT_LIST_LIMIT); 422 invalid_query otherwise
//   order: NEWEST FIRST (created_at desc, id desc), a history table. Opposite of
//   GET /api/decisions on purpose (JEV be.api_quality list_order).
// POST /api/evals/run {suite?}    -> { legacy, v2, savingsPct }, both persisted
// The run route has its own limiter over ctx.kv (on top of the global one):
// each run blocks the event loop for about 125 ms and writes two rows, so it
// is bounded per client. The client key is the trust-proxy-aware clientIp
// that core/app.ts sets (core/hardening requestContext); raw X-Forwarded-For
// is never read here, so a client cannot mint fresh buckets by spoofing it.
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { createMemoryKv } from "../../core/adapters/kv-memory";
import { consumeLimit, type LimitResult } from "../../core/hardening";
import type { Kv } from "../../core/ports/kv";
import { errorBody, parseBody, parseQuery } from "../../lib/http";
import type { EvalsService } from "./service";
import { MAX_LIST_LIMIT } from "./service";

export const RUN_LIMIT_PER_WINDOW = 6;
export const RUN_WINDOW_SEC = 60;

const SuiteId = z.string().regex(/^[a-z0-9-]{1,40}$/, "must be a suite id");
const ListQuery = z.object({ suite: SuiteId.optional(), limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).optional() });
const RunBody = z.object({ suite: SuiteId.optional() }).strict();

function runLimiter(kv: Kv): MiddlewareHandler {
  // used only while the shared kv errors, so this limit never switches off
  // (the same pattern as the auth limiter)
  const fallback = createMemoryKv({ maxEntries: 5_000 });
  return async (c, next) => {
    const key = `evals.run:${c.get("clientIp") ?? "unknown"}`;
    let result: LimitResult;
    try {
      result = await consumeLimit(kv, key, RUN_LIMIT_PER_WINDOW, RUN_WINDOW_SEC);
    } catch {
      result = await consumeLimit(fallback, key, RUN_LIMIT_PER_WINDOW, RUN_WINDOW_SEC);
    }
    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfterSec));
      return c.json(errorBody("rate_limited", "Too many eval runs, retry later"), 429);
    }
    return next();
  };
}

export function evalRoutes(service: EvalsService, kv: Kv): Hono {
  return new Hono()
    .get("/", async (c) => {
      const q = parseQuery(c, ListQuery);
      return c.json(await service.list({ suite: q.suite, limit: q.limit }));
    })
    .post("/run", runLimiter(kv), async (c) => {
      const body = await parseBody(c, RunBody);
      return c.json(await service.run({ suite: body.suite }));
    });
}
