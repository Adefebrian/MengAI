// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Trading: the paper broker's math, every live-order gate, the risk review,
// the owner's decision, auto trade, the venue tool, open limit orders, the
// kill switch, and the routes. A fake venue stands in for the connectors.
import { describe, expect, test } from "bun:test";
import { DEFAULT_TRADING, type TradingSettings } from "@mengai/shared";
import { Hono } from "hono";
import type { ModuleContext } from "../../core/module";
import { HttpError } from "../../lib/http";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { applyFill, EMPTY_BOOK, limitFill, unrealized } from "./broker";
import { dailyLoss, liveGate, normalizeSettings } from "./gates";
import { createTradingModule, TradingError, type VenueTool } from "./index";
import { parsePrice, venueArgs } from "./service";

function fakeVenue() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const tools: VenueTool[] = [
    { name: "exch.get_price", connectorId: "conn-1", alias: "exch__get_price", description: "price", risk: "read", money: false, schema: { type: "object", properties: { symbol: { type: "string" } } } },
    {
      name: "exch.place_order",
      connectorId: "conn-1",
      alias: "exch__place_order",
      description: "place an order",
      risk: "sensitive",
      money: true,
      schema: { type: "object", properties: { symbol: {}, side: {}, quantity: {}, type: {}, price: {}, clientOrderId: {} } },
    },
  ];
  const state = { price: 100, fill: 100.5 as number | null, fail: false };
  return {
    calls,
    state,
    tools: async () => tools,
    async call(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "exch.get_price") return { ok: true, output: JSON.stringify({ symbol: args.symbol, price: state.price }) };
      if (state.fail) return { ok: false, output: "HTTP 400 rejected by the exchange" };
      return { ok: true, output: state.fill === null ? '{"status":"accepted"}' : JSON.stringify({ status: "filled", avgPrice: state.fill }) };
    },
  };
}

async function setup(opts: { venue?: boolean } = {}) {
  const events = captureEvents();
  const clock = fakeClock(Date.UTC(2026, 8, 30, 10));
  const ctx: ModuleContext = {
    config: { mode: "local", version: "0.0.0-test", dataDir: "/tmp", workspacesDir: "/tmp", webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null },
    db: await createTestDb(),
    kv: memoryKv(),
    blob: {} as ModuleContext["blob"],
    vault: memoryVault(),
    clock,
    logger: silentLogger,
    events,
  };
  const venue = fakeVenue();
  const hooks = new Map<string, () => Promise<number>>();
  const mod = createTradingModule(ctx, {
    venue: opts.venue === false ? null : venue,
    killswitch: { register: (n, h) => void hooks.set(n, h), trigger: async () => ({ stoppedRuns: 0, killedProcesses: 0 }) },
  });
  return { svc: mod.service, mod, venue, events, clock, hooks };
}

const LIVE: TradingSettings = { mode: "live", autoTrade: false, maxOrderUsd: 1000, dailyLossLimitUsd: 50, allowedSymbols: ["ABC"] };
const RUN = "run-1";
const TRADER = "cat-trader";
const RISK = "cat-risk";

async function reject(p: Promise<unknown>): Promise<Error> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(Error);
  return e as Error;
}

describe("paper broker math", () => {
  test("averages in, realizes on the closing part, flips, and marks unrealized P&L", () => {
    let b = applyFill(EMPTY_BOOK, "buy", 2, 100).book;
    b = applyFill(b, "buy", 2, 110).book;
    expect(b).toEqual({ qty: 4, avgPrice: 105, realizedUsd: 0 });
    expect(unrealized(b, 120)).toBe(60);
    const sold = applyFill(b, "sell", 1, 125);
    expect(sold.realized).toBe(20);
    expect(sold.book).toEqual({ qty: 3, avgPrice: 105, realizedUsd: 20 });
    // selling past zero flips to a short at the fill price
    const flip = applyFill(sold.book, "sell", 5, 100);
    expect(flip.realized).toBe(-15);
    expect(flip.book).toEqual({ qty: -2, avgPrice: 100, realizedUsd: 5 });
    expect(unrealized(flip.book, 90)).toBe(20);
    const cover = applyFill(flip.book, "buy", 2, 95);
    expect(cover.book).toEqual({ qty: 0, avgPrice: 0, realizedUsd: 15 });
    expect(unrealized(cover.book, 80)).toBe(0);
    // float dust never shows
    const dust = applyFill(applyFill(EMPTY_BOOK, "buy", 0.1, 10).book, "buy", 0.2, 10).book;
    expect(dust.qty).toBe(0.3);
    expect(() => applyFill(EMPTY_BOOK, "buy", 0, 10)).toThrow();
  });

  test("limit orders fill only when the price crosses; prices parse from tool output", () => {
    expect(limitFill("buy", 100, 99)).toBe(99);
    expect(limitFill("buy", 100, 101)).toBeNull();
    expect(limitFill("sell", 100, 101)).toBe(101);
    expect(limitFill("sell", 100, 99)).toBeNull();
    expect(parsePrice('{"data":{"lastPrice":"61200.5"}}')).toBe(61200.5);
    expect(parsePrice("HTTP 200 text/plain\nBTC is at 61,250.75 now")).toBe(61250.75);
    expect(parsePrice("nothing here")).toBeNull();
  });
});

describe("live gate", () => {
  const base = { settings: LIVE, halted: false, symbol: "ABC", qty: 5, price: 100, dailyLossUsd: 0, venue: "exch.place_order" };
  test("every rule, in order", () => {
    expect(liveGate(base)).toBeNull();
    expect(liveGate({ ...base, halted: true })).toContain("kill switch");
    expect(liveGate({ ...base, settings: { ...LIVE, mode: "paper" } })).toBe("live trading is off (paper mode)");
    expect(liveGate({ ...base, symbol: "XYZ" })).toBe("XYZ is not on the allowed symbols list");
    expect(liveGate({ ...base, settings: { ...LIVE, maxOrderUsd: 0 } })).toContain("max order size");
    expect(liveGate({ ...base, price: null })).toContain("no price");
    expect(liveGate({ ...base, qty: 11 })).toBe("the order is $1,100.00, over the $1,000.00 cap per order");
    expect(liveGate({ ...base, settings: { ...LIVE, dailyLossLimitUsd: 0 } })).toContain("daily loss limit is set");
    expect(liveGate({ ...base, dailyLossUsd: 50 })).toBe("the daily loss limit is reached ($50.00 of $50.00)");
    expect(liveGate({ ...base, venue: null })).toContain("no venue");
    expect(liveGate({ ...base, settings: DEFAULT_TRADING })).toBe("live trading is off (paper mode)");
  });

  test("daily loss counts realized and unrealized; settings normalize", () => {
    expect(dailyLoss(-30, -25)).toBe(55);
    expect(dailyLoss(-30, 40)).toBe(0);
    expect(normalizeSettings({ mode: "live", autoTrade: true, maxOrderUsd: -3, dailyLossLimitUsd: 10.555, allowedSymbols: [" btc-usd", "BTC-USD", "eth-usd"] })).toEqual({
      mode: "live",
      autoTrade: true,
      maxOrderUsd: 0,
      dailyLossLimitUsd: 10.56,
      allowedSymbols: ["BTC-USD", "ETH-USD"],
    });
  });
});

describe("orders", () => {
  test("paper: proposed, reviewed by another cat, filled at the trader's quote, positions streamed", async () => {
    const { svc, events } = await setup();
    expect(await svc.settings()).toEqual(DEFAULT_TRADING);
    const o = await svc.propose({ runId: RUN, agentId: TRADER, symbol: "abc", side: "buy", qty: 2, type: "market", quote: 50, reason: "breakout above the range" });
    expect(o).toMatchObject({ symbol: "ABC", mode: "paper", status: "proposed", riskNote: null, venue: null, fillPrice: null });
    expect((await svc.pendingReview(RUN)).map((x) => x.id)).toEqual([o.id]);
    expect((await reject(svc.review({ runId: RUN, agentId: TRADER, verdict: "approve", note: "looks fine" }))).message).toContain("cannot review");
    const filled = await svc.review({ runId: RUN, agentId: RISK, verdict: "approve", note: "inside the size limit" });
    expect(filled).toMatchObject({ id: o.id, status: "filled", fillPrice: 50, riskNote: "inside the size limit" });
    expect(await svc.positions("paper")).toEqual([{ symbol: "ABC", mode: "paper", qty: 2, avgPrice: 50, lastPrice: 50, unrealizedUsd: 0, realizedUsd: 0 }]);
    expect(events.ofType("trade.order").map((e) => e.data.order.status)).toEqual(["proposed", "filled"]);
    expect(events.ofType("trade.positions").at(-1)!.data.positions[0]!.qty).toBe(2);
    // a later price marks the book
    await svc.quote("ABC", { price: 55, runId: RUN });
    expect((await svc.positions("paper"))[0]!.unrealizedUsd).toBe(10);
    // a risk rejection ends the order
    await svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "sell", qty: 1, type: "market", quote: 55, reason: "trim" });
    expect((await svc.review({ runId: RUN, agentId: RISK, verdict: "reject", note: "no reason to trim yet" })).status).toBe("rejected");
    expect((await reject(svc.review({ runId: RUN, agentId: RISK, verdict: "approve", note: "x ok" }))).message).toContain("no order is waiting");
  });

  test("paper: the price comes from a connector price tool; without one a market order needs a quote", async () => {
    const { svc, venue } = await setup();
    venue.state.price = 42;
    const q = await svc.quote("ABC");
    expect(q).toEqual({ symbol: "ABC", price: 42, source: "exch.get_price" });
    expect(venue.calls[0]).toEqual({ name: "exch.get_price", args: { symbol: "ABC" } });
    const o = await svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "buy", qty: 1, type: "market", reason: "the price tool read 42" });
    expect((await svc.review({ runId: RUN, agentId: RISK, verdict: "approve", note: "small size" })).fillPrice).toBe(42);
    expect(o.status).toBe("proposed");
    const none = await setup({ venue: false });
    const e = await reject(none.svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "buy", qty: 1, type: "market", reason: "no price" }));
    expect(e).toBeInstanceOf(TradingError);
    expect(e.message).toContain("no price for ABC");
  });

  test("paper: a limit order that is not marketable stays open until a price crosses it", async () => {
    const { svc } = await setup({ venue: false });
    await svc.quote("ABC", { price: 100 });
    await svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "buy", qty: 1, type: "limit", limitPrice: 95, reason: "buy the dip at 95" });
    const open = await svc.review({ runId: RUN, agentId: RISK, verdict: "approve", note: "limit inside the range" });
    expect(open.status).toBe("approved");
    await svc.quote("ABC", { price: 97 });
    expect((await svc.orders({ runId: RUN }))[0]!.status).toBe("approved");
    await svc.quote("ABC", { price: 94 });
    expect((await svc.orders({ runId: RUN }))[0]).toMatchObject({ status: "filled", fillPrice: 94 });
    expect((await reject(svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "buy", qty: 1, type: "limit", reason: "no limit" }))).message).toContain("limit_price");
  });

  test("live: risk approval, then the owner's decision through every gate, then the venue tool", async () => {
    const { svc, venue } = await setup();
    const o = await svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "buy", qty: 5, type: "limit", limitPrice: 100, live: true, venue: "exch__place_order", reason: "add at the level" });
    expect(o).toMatchObject({ mode: "live", status: "proposed", venue: "conn-1" });
    // the owner cannot approve before the risk manager
    expect((await reject(svc.decide(o.id, "approve"))).message).toContain("not reviewed");
    const reviewed = await svc.review({ runId: RUN, agentId: RISK, verdict: "approve", note: "a fifth of the paper size" });
    expect(reviewed.status).toBe("proposed");
    const gate = async () => (await reject(svc.decide(o.id, "approve"))) as HttpError;
    expect(await gate()).toMatchObject({ status: 409, code: "trading_gate", message: "live trading is off (paper mode)" });
    await svc.saveSettings({ ...LIVE, allowedSymbols: [] });
    expect((await gate()).message).toBe("ABC is not on the allowed symbols list");
    await svc.saveSettings({ ...LIVE, maxOrderUsd: 400 });
    expect((await gate()).message).toContain("over the $400.00 cap");
    await svc.saveSettings(LIVE);
    expect(venue.calls).toEqual([]);
    const done = await svc.decide(o.id, "approve");
    expect(done).toMatchObject({ status: "filled", fillPrice: 100.5 });
    expect(venue.calls).toEqual([{ name: "exch.place_order", args: { symbol: "ABC", side: "buy", quantity: 5, type: "limit", price: 100, clientOrderId: o.id } }]);
    expect((await svc.positions("live"))[0]).toMatchObject({ symbol: "ABC", qty: 5, avgPrice: 100.5 });
    expect((await reject(svc.decide(o.id, "approve"))).message).toContain("the order is filled");
  });

  test("an identical proposal still waiting is returned, not created twice, and nothing new is published", async () => {
    const { svc, events, clock } = await setup();
    const ask = { runId: RUN, agentId: TRADER, symbol: "ABC", side: "buy" as const, qty: 1, type: "limit" as const, limitPrice: 99, live: true, venue: "exch.place_order", reason: "entry at the level" };
    const a = await svc.propose(ask);
    await svc.review({ runId: RUN, agentId: RISK, orderId: a.id, verdict: "approve", note: "small size" });
    const published = events.ofType("trade.order").length;
    clock.advance(13 * 60_000);
    const b = await svc.propose({ ...ask, reason: "entry at the level, again" });
    expect(b.id).toBe(a.id);
    expect(events.ofType("trade.order")).toHaveLength(published);
    expect((await svc.orders({ runId: RUN })).filter((o) => o.status === "proposed")).toHaveLength(1);
    // a different limit, another run, or a decided order is a new proposal
    expect((await svc.propose({ ...ask, limitPrice: 98 })).id).not.toBe(a.id);
    expect((await svc.propose({ ...ask, runId: "run-2" })).id).not.toBe(a.id);
    await svc.decide(a.id, "reject");
    expect((await svc.propose(ask)).id).not.toBe(a.id);
  });

  test("live: the daily loss limit stops new orders; a venue failure marks the order failed", async () => {
    const { svc, venue } = await setup();
    await svc.saveSettings({ ...LIVE, autoTrade: true, dailyLossLimitUsd: 20 });
    // auto trade: the risk approval sends it through the gate right away
    await svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "buy", qty: 5, type: "limit", limitPrice: 100, live: true, venue: "exch.place_order", reason: "entry" });
    expect((await svc.review({ runId: RUN, agentId: RISK, verdict: "approve", note: "ok size" })).status).toBe("filled");
    // the price drops: 5 x (95 - 100.5) = -27.50 unrealized, past the 20 dollar limit
    await svc.quote("ABC", { price: 95 });
    venue.state.fill = 95;
    await svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "buy", qty: 1, type: "limit", limitPrice: 95, live: true, venue: "exch.place_order", reason: "average down" });
    const held = await svc.review({ runId: RUN, agentId: RISK, verdict: "approve", note: "small add" });
    expect(held.status).toBe("proposed");
    expect((await reject(svc.decide(held.id, "approve"))).message).toBe("the daily loss limit is reached ($27.50 of $20.00)");
    // with room again, a venue failure is recorded, not thrown
    await svc.saveSettings({ ...LIVE, dailyLossLimitUsd: 500 });
    venue.state.fail = true;
    expect(await svc.decide(held.id, "approve")).toMatchObject({ status: "failed" });
    // a venue that answers without a price leaves the order sent (approved)
    venue.state.fail = false;
    venue.state.fill = null;
    const o3 = await svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "sell", qty: 1, type: "limit", limitPrice: 96, live: true, venue: "exch.place_order", reason: "trim" });
    await svc.review({ runId: RUN, agentId: RISK, orderId: o3.id, verdict: "approve", note: "reduces risk" });
    expect((await svc.decide(o3.id, "approve")).status).toBe("approved");
    // a non-order tool is no venue
    expect((await reject(svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "buy", qty: 1, type: "market", quote: 1, live: true, venue: "exch.get_price", reason: "wrong venue" }))).message).toContain("does not place orders");
  });

  test("owner decisions: reject, paper orders and unknown orders", async () => {
    const { svc } = await setup();
    const paper = await svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "buy", qty: 1, type: "market", quote: 10, reason: "paper entry" });
    expect(((await reject(svc.decide(paper.id, "approve"))) as HttpError).status).toBe(409);
    expect((await svc.decide(paper.id, "reject")).status).toBe("rejected");
    expect(((await reject(svc.decide("nope", "approve"))) as HttpError).status).toBe(404);
  });

  test("the kill switch cancels open orders and stops trading until the owner saves the settings", async () => {
    const { svc, hooks, events } = await setup();
    await svc.saveSettings(LIVE);
    const a = await svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "buy", qty: 1, type: "limit", limitPrice: 100, live: true, venue: "exch.place_order", reason: "entry" });
    await svc.review({ runId: RUN, agentId: RISK, verdict: "approve", note: "fine size" });
    const b = await svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "buy", qty: 1, type: "limit", limitPrice: 1, reason: "far limit" });
    expect([...hooks.keys()]).toEqual(["trading"]);
    await hooks.get("trading")!();
    const after = await svc.orders({ runId: RUN });
    expect(after.filter((o) => o.id === a.id || o.id === b.id).map((o) => o.status)).toEqual(["cancelled", "cancelled"]);
    expect(events.ofType("trade.order").filter((e) => e.data.order.status === "cancelled")).toHaveLength(2);
    expect(await svc.halted()).toBe(true);
    expect((await reject(svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "buy", qty: 1, type: "market", quote: 1, reason: "again" }))).message).toContain("kill switch");
    await svc.saveSettings(LIVE);
    expect(await svc.halted()).toBe(false);
    expect((await svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "buy", qty: 1, type: "market", quote: 1, reason: "again" })).status).toBe("proposed");
  });

  test("venue arguments follow the venue tool's schema", () => {
    const tool: VenueTool = { name: "x.order", connectorId: "c", alias: "x__order", description: "", risk: "sensitive", money: true, schema: { type: "object", properties: { pair: {}, side: {}, amount: {}, order_type: {} } } };
    const o = { id: "o1", symbol: "BTC-USD", side: "sell", qty: 2, type: "market", limitPrice: null } as Parameters<typeof venueArgs>[1];
    expect(venueArgs(tool, o)).toEqual({ pair: "BTC-USD", side: "sell", amount: 2, order_type: "market" });
  });
});

describe("routes", () => {
  test("validate settings, queries and decisions", async () => {
    const { mod, svc } = await setup();
    const app = new Hono();
    app.onError((e, c) => (e instanceof HttpError ? c.json({ error: { code: e.code, message: e.message } }, e.status) : c.json({ error: { code: "internal", message: String(e) } }, 500)));
    app.route("/api/trading", mod.routes!);
    const call = (method: string, path: string, body?: unknown) =>
      app.request(`/api/trading${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    expect(await (await call("GET", "/settings")).json()).toEqual(DEFAULT_TRADING);
    expect((await call("PUT", "/settings", { ...LIVE, extra: true })).status).toBe(422);
    expect((await call("PUT", "/settings", { ...LIVE, maxOrderUsd: -1 })).status).toBe(422);
    expect((await call("PUT", "/settings", { ...LIVE, allowedSymbols: ["no spaces"] })).status).toBe(422);
    expect((await call("PUT", "/settings", { mode: "live" })).status).toBe(422);
    const saved = await call("PUT", "/settings", { ...LIVE, allowedSymbols: ["btc-usd"] });
    expect(await saved.json()).toEqual({ ...LIVE, allowedSymbols: ["BTC-USD"] });
    expect((await call("GET", "/orders?status=weird")).status).toBe(422);
    expect((await call("GET", "/orders?limit=0")).status).toBe(422);
    expect((await call("GET", "/positions?mode=paper")).status).toBe(200);
    const o = await svc.propose({ runId: RUN, agentId: TRADER, symbol: "ABC", side: "buy", qty: 1, type: "market", quote: 3, reason: "entry now" });
    expect(((await (await call("GET", `/orders?runId=${RUN}`)).json()) as unknown[]).length).toBe(1);
    expect((await call("POST", `/orders/${o.id}/decision`, { decision: "maybe" })).status).toBe(422);
    expect((await call("POST", `/orders/${o.id}/decision`, { decision: "reject" })).status).toBe(200);
    expect((await call("POST", "/orders/missing/decision", { decision: "approve" })).status).toBe(404);
  });
});
