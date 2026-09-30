// /api/trading: settings, orders, positions and the owner's decision on a
// live order. zod on every body and query; the decision is rate limited.
import { ORDER_STATUSES } from "@mengai/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { consumeLimit, TooManyRequestsError, type LimitResult } from "../../core/hardening";
import type { Kv } from "../../core/ports/kv";
import { notFound, parseBody, parseQuery } from "../../lib/http";
import type { TradingService } from "./ports";
import { SYMBOL_RE } from "./service";

const Id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const Usd = z.number().finite().min(0).max(10_000_000);

export const settingsSchema = z
  .object({
    mode: z.enum(["paper", "live"]),
    autoTrade: z.boolean(),
    maxOrderUsd: Usd,
    dailyLossLimitUsd: Usd,
    allowedSymbols: z
      .array(
        z
          .string()
          .trim()
          .transform((s) => s.toUpperCase())
          .pipe(z.string().regex(SYMBOL_RE, "a symbol like BTC-USD or AAPL")),
      )
      .max(100),
  })
  .strict();

export const decisionSchema = z.object({ decision: z.enum(["approve", "reject"]) }).strict();

const ordersQuery = z
  .object({
    runId: Id.optional(),
    status: z.enum(ORDER_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

const positionsQuery = z.object({ mode: z.enum(["paper", "live"]).optional() }).strict();

async function limit(c: Context, kv: Kv, name: string, max: number, windowSec: number): Promise<void> {
  let r: LimitResult;
  try {
    r = await consumeLimit(kv, `${name}:${c.get("clientIp") ?? "unknown"}`, max, windowSec);
  } catch {
    return;
  }
  if (!r.allowed) throw new TooManyRequestsError(r.retryAfterSec);
}

export function createTradingRoutes(service: TradingService, o: { kv: Kv }): Hono {
  return new Hono()
    .get("/settings", async (c) => c.json(await service.settings()))
    .put("/settings", async (c) => {
      await limit(c, o.kv, "trading.settings", 20, 60);
      return c.json(await service.saveSettings(await parseBody(c, settingsSchema)));
    })
    .get("/orders", async (c) => c.json(await service.orders(parseQuery(c, ordersQuery))))
    .get("/positions", async (c) => c.json(await service.positions(parseQuery(c, positionsQuery).mode)))
    .post("/orders/:id/decision", async (c) => {
      const id = Id.safeParse(c.req.param("id"));
      if (!id.success) throw notFound("order");
      await limit(c, o.kv, "trading.decision", 30, 60);
      const body = await parseBody(c, decisionSchema);
      return c.json(await service.decide(id.data, body.decision));
    });
}
