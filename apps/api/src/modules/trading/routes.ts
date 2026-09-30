// /api/trading: settings, orders, positions, the owner's decision on a live
// order, and the trading venues (exchange or broker connections and their
// learning pass). zod on every body and query; every write is rate limited.
// Venue secrets are accepted once and never returned.
import { ORDER_STATUSES } from "@mengai/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { consumeLimit, TooManyRequestsError, type LimitResult } from "../../core/hardening";
import type { Kv } from "../../core/ports/kv";
import { notFound, parseBody, parseQuery } from "../../lib/http";
import type { TradingService } from "./ports";
import { SYMBOL_RE } from "./symbols";

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

const VenueFields = {
  preset: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/, "a preset id from TRADING_VENUE_PRESETS"),
  label: z.string().trim().min(1).max(40),
  target: z.string().trim().min(1).max(2000),
  secrets: z
    .record(z.string().trim().min(1).max(64), z.string().max(4000))
    .refine((o) => Object.keys(o).length <= 12, { message: "at most 12 secret fields" }),
  mode: z.enum(["paper", "live"]),
  testnet: z.boolean(),
};

export const createVenueSchema = z
  .object({
    preset: VenueFields.preset,
    label: VenueFields.label.optional(),
    target: VenueFields.target.optional(),
    secrets: VenueFields.secrets.optional(),
    mode: VenueFields.mode,
    testnet: VenueFields.testnet.optional(),
  })
  .strict();

export const updateVenueSchema = z
  .object({
    preset: VenueFields.preset.optional(),
    label: VenueFields.label.optional(),
    target: VenueFields.target.optional(),
    secrets: VenueFields.secrets.optional(),
    mode: VenueFields.mode.optional(),
    testnet: VenueFields.testnet.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "nothing to change" });

async function limit(c: Context, kv: Kv, name: string, max: number, windowSec: number): Promise<void> {
  let r: LimitResult;
  try {
    r = await consumeLimit(kv, `${name}:${c.get("clientIp") ?? "unknown"}`, max, windowSec);
  } catch {
    return;
  }
  if (!r.allowed) throw new TooManyRequestsError(r.retryAfterSec);
}

function venueId(c: Context): string {
  const r = Id.safeParse(c.req.param("id"));
  if (!r.success) throw notFound("venue");
  return r.data;
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
    })
    .get("/venues", async (c) => c.json(await service.venues()))
    .post("/venues", async (c) => {
      await limit(c, o.kv, "trading.venues.write", 20, 60);
      const body = await parseBody(c, createVenueSchema);
      return c.json(await service.createVenue(body), 201);
    })
    .patch("/venues/:id", async (c) => {
      const id = venueId(c);
      await limit(c, o.kv, "trading.venues.write", 20, 60);
      const body = await parseBody(c, updateVenueSchema);
      return c.json(await service.updateVenue(id, body));
    })
    .delete("/venues/:id", async (c) => {
      const id = venueId(c);
      await limit(c, o.kv, "trading.venues.write", 20, 60);
      await service.removeVenue(id);
      return c.json({ ok: true as const });
    })
    .post("/venues/:id/learn", async (c) => {
      const id = venueId(c);
      await limit(c, o.kv, "trading.venues.learn", 5, 60);
      return c.json(await service.learnVenue(id));
    });
}
