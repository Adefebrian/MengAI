// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// TradingService: the owner's trading settings, the paper broker, the venue
// desk, and the gate every live order passes. Order flow:
//   trader cat: propose (proposed) -> risk manager cat: review
//   paper: approve fills at the quote the trader read (or the last price from
//          a learned venue or a connector price tool); a limit order that is
//          not marketable stays open (approved) until a later price crosses it
//   live:  approve keeps it proposed for the owner (POST .../decision), or,
//          with autoTrade on, sends it through the gate right away; the gate
//          checks the kill switch, live mode, the allowed symbols, maxOrderUsd
//          and the daily loss limit, then one connector tool places it
// A ready venue (venues.ts) routes orders without the cat naming a tool: its
// learned price tool prices paper orders, its learned order tool places live
// ones in the venue's own symbol form. Fills record wins and losses on the
// venue's crew skills; a venue error becomes a crew lesson.
// The kill switch cancels every open order and stops trading until the
// owner saves the settings again. Texts state facts, never advice.
// Without a crew sandbox (lib/platform.ts) live trading is off: live mode,
// live proposals and the owner's approval of a live order are refused with
// the "Coming soon" reason and nothing reaches a venue's order tool; paper
// trading works as everywhere else.
import type { AgentRole, PositionDTO, TradingSettings } from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import { conflict, HttpError, notFound } from "../../lib/http";
import { comingSoonError, featureOff, type PlatformInfo } from "../../lib/platform";
import { clip, redact } from "../../lib/redact";
import { applyFill, cents, EMPTY_BOOK, limitFill, unrealized } from "./broker";
import { dailyLoss, dayStart, liveGate, normalizeSettings } from "./gates";
import { TradingError, type OrderQuery, type ProposeInput, type ReviewInput, type TradingService, type TradingVenue, type VenueTool } from "./ports";
import { createTradingRepo, orderDto, type OrderRow, type PositionRow } from "./repo";
import { normSymbol, parsePrice } from "./symbols";
import { createDesk } from "./venues";

export { normSymbol, parsePrice, SYMBOL_RE, toVenueSymbol, venueArgs } from "./symbols";

export interface TradingDeps {
  /** the connectors service: price tools, the venue tool of live orders, and the connectors of trading venues */
  venue?: TradingVenue | null;
  /** boot-time platform features: liveTrading off refuses every live order; absent keeps every feature on */
  platform?: PlatformInfo;
}

const MAX_QTY = 1e9;
const PRICE_TOOL = /(^|[._-])(price|prices|ticker|quote|last)([._-]|$)/i;
const FILL_KEYS = ["fillPrice", "fill_price", "avgPrice", "avg_price", "average", "averagePrice", "executedPrice", "filled_avg_price", "price"];

/** fill() mutates the row, so read the status through a call (no stale narrowing) */
const filled = (o: OrderRow): boolean => o.status === "filled";
const errText = (e: unknown) => clip(redact(e instanceof Error ? e.message : String(e)), 300);

export function createTradingService(ctx: ModuleContext, deps: TradingDeps = {}): TradingService & { close(): Promise<void> } {
  const repo = createTradingRepo(ctx.db);
  const log = ctx.logger.child({ module: "trading" });
  const last = new Map<string, { price: number; source: string; at: number }>();
  const desk = createDesk({ ctx, repo, venue: deps.venue ?? null, settings: async () => (await repo.settings()).value, log, platform: deps.platform });
  /** null when live orders may run; otherwise the coming soon reason */
  const liveOff = featureOff(deps.platform, "liveTrading");

  async function publishOrder(o: OrderRow): Promise<void> {
    try {
      await ctx.events.publish({ type: "trade.order", runId: o.runId, agentId: o.agentId, data: { order: orderDto(o) } });
    } catch (e) {
      log.log("warn", "trade.order publish failed", { error: errText(e) });
    }
  }

  async function publishPositions(mode: "paper" | "live", runId: string | null): Promise<void> {
    try {
      await ctx.events.publish({ type: "trade.positions", runId, data: { positions: await positionsOf(mode) } });
    } catch (e) {
      log.log("warn", "trade.positions publish failed", { error: errText(e) });
    }
  }

  function dto(p: PositionRow): PositionDTO {
    const lp = last.get(p.symbol)?.price ?? p.lastPrice;
    return {
      symbol: p.symbol,
      mode: p.mode,
      qty: p.qty,
      avgPrice: Math.round(p.avgPrice * 1e6) / 1e6,
      lastPrice: lp,
      unrealizedUsd: unrealized(p, lp),
      realizedUsd: cents(p.realizedUsd),
    };
  }

  async function positionsOf(mode?: "paper" | "live"): Promise<PositionDTO[]> {
    return (await repo.positions(mode)).filter((p) => p.qty !== 0 || p.realizedUsd !== 0).map(dto);
  }

  async function isHalted(): Promise<boolean> {
    return (await repo.settings()).haltedAt !== null;
  }

  async function fill(o: OrderRow, price: number): Promise<void> {
    const now = ctx.clock.now();
    const pos = (await repo.position(o.mode, o.symbol)) ?? { ...EMPTY_BOOK, mode: o.mode, symbol: o.symbol, lastPrice: null, updatedAt: now };
    const r = applyFill(pos, o.side, o.qty, price);
    await repo.savePosition({ ...pos, ...r.book, lastPrice: price, updatedAt: now });
    o.status = "filled";
    o.fillPrice = price;
    o.filledAt = now;
    o.realizedUsd = r.realized;
    o.error = null;
    if (o.venueId) {
      desk.observe(o.venueId, { kind: "filled", symbol: o.symbol, side: o.side, qty: o.qty, price });
      // a fill that realized no loss is a win for the venue's skills
      await desk.outcome(o.venueId, r.realized >= 0);
    }
  }

  const venueTools = () => desk.tools();

  async function setPrice(symbol: string, price: number, source: string, runId: string | null): Promise<void> {
    const now = ctx.clock.now();
    last.set(symbol, { price, source, at: now });
    await repo.mark(symbol, price, now);
    // open paper limit orders that this price crosses fill now
    let crossed = false;
    for (const o of await repo.openOrders()) {
      if (o.symbol !== symbol || o.mode !== "paper" || o.status !== "approved" || o.type !== "limit" || o.limitPrice === null) continue;
      const at = limitFill(o.side, o.limitPrice, price);
      if (at === null) continue;
      await fill(o, at);
      await repo.saveOrder(o, now);
      await publishOrder(o);
      crossed = true;
    }
    const held = (await repo.positions()).some((p) => p.symbol === symbol && p.qty !== 0);
    if (held || crossed) {
      await publishPositions("paper", runId);
      if ((await repo.positions("live")).some((p) => p.symbol === symbol)) await publishPositions("live", runId);
    }
  }

  async function lookupPrice(symbol: string, signal?: AbortSignal, runId?: string | null): Promise<{ price: number; source: string } | null> {
    // a learned venue first: its own price tool in its own symbol form
    const learned = await desk.price(symbol, { signal, runId });
    if (learned) return { price: learned.price, source: learned.source };
    const tools = (await venueTools()).filter((t) => !t.money && t.risk === "read" && PRICE_TOOL.test(t.name.slice(t.name.indexOf(".") + 1)));
    for (const t of tools.slice(0, 3)) {
      const props = Object.keys(((t.schema as { properties?: Record<string, unknown> }).properties ?? {}) as Record<string, unknown>);
      const key = props.find((p) => /^(symbol|ticker|pair|instrument|market|asset)$/i.test(p)) ?? (props.length ? null : "symbol");
      if (!key) continue;
      const r = await desk.call(t.name, { [key]: symbol }, { signal, timeoutMs: 20_000 });
      if (!r.ok) continue;
      const price = parsePrice(r.output);
      if (price !== null) return { price, source: t.name };
    }
    return null;
  }

  async function executeLive(o: OrderRow, signal?: AbortSignal): Promise<void> {
    const now = ctx.clock.now();
    o.decidedAt = now;
    if (liveOff) {
      o.status = "failed";
      o.error = liveOff;
      return;
    }
    const tool = (await venueTools()).find((t) => t.name === o.venueTool);
    if (!tool) {
      o.status = "failed";
      o.error = `the venue tool ${o.venueTool ?? "(none)"} is not available`;
      return;
    }
    const row = await desk.row(o.venueId);
    const r = await desk.call(tool.name, desk.orderArgs(row, tool, o), { signal, timeoutMs: 30_000 });
    if (!r.ok) {
      o.status = "failed";
      o.error = clip(redact(r.output), 300);
      if (o.venueId) {
        await desk.outcome(o.venueId, false, ["orders"]);
        await desk.lesson(tool.name, r.output, o.runId);
      }
      return;
    }
    const price = parsePrice(r.output, FILL_KEYS);
    if (price !== null) await fill(o, price);
    else {
      o.status = "approved";
      o.error = null;
    }
  }

  async function gateFor(o: OrderRow, settings: TradingSettings, halted: boolean): Promise<string | null> {
    if (liveOff) return liveOff;
    const now = ctx.clock.now();
    const livePositions = await repo.positions("live");
    const openLoss = livePositions.reduce((sum, p) => sum + unrealized(p, last.get(p.symbol)?.price ?? p.lastPrice), 0);
    const realized = await repo.realizedSince("live", dayStart(now));
    const price = o.limitPrice ?? last.get(o.symbol)?.price ?? o.quote;
    return liveGate({ settings, halted, symbol: o.symbol, qty: o.qty, price, dailyLossUsd: dailyLoss(realized, openLoss), venue: o.venueTool });
  }

  async function requireOrder(id: string): Promise<OrderRow> {
    const o = await repo.order(id);
    if (!o) throw notFound("order");
    return o;
  }

  const service: TradingService & { close(): Promise<void> } = {
    async settings() {
      return (await repo.settings()).value;
    },

    async saveSettings(s) {
      if (liveOff && s.mode === "live") throw comingSoonError(liveOff);
      const value = normalizeSettings(s);
      await repo.saveSettings(value, ctx.clock.now());
      // a live ccxt venue carries the max order size as its own cap
      desk.track(desk.syncSettings(value));
      return value;
    },

    async orders(q: OrderQuery = {}) {
      const limit = Math.min(500, Math.max(1, Math.floor(q.limit ?? 200)));
      return (await repo.orders({ runId: q.runId, status: q.status, limit })).map(orderDto);
    },

    positions: (mode) => positionsOf(mode),

    async halted() {
      return isHalted();
    },

    async quote(symbol, opts = {}) {
      const sym = normSymbol(symbol);
      let found: { price: number; source: string } | null = null;
      if (opts.price !== undefined && opts.price !== null) {
        if (!(Number.isFinite(opts.price) && opts.price > 0)) throw new TradingError("quote must be a positive price");
        found = { price: opts.price, source: "the quote the crew read" };
      } else {
        found = await lookupPrice(sym, opts.signal, opts.runId ?? null);
        if (!found) {
          const known = last.get(sym);
          if (known) return { symbol: sym, price: known.price, source: `${known.source} (last seen)` };
          throw new TradingError(`no price for ${sym}: no connector price tool answered; read a price and pass it as quote`, "no_price");
        }
      }
      await setPrice(sym, found.price, found.source, opts.runId ?? null);
      return { symbol: sym, ...found };
    },

    async propose(input: ProposeInput) {
      if (await isHalted()) throw new TradingError("trading is stopped by the kill switch", "halted");
      const symbol = normSymbol(input.symbol);
      if (input.side !== "buy" && input.side !== "sell") throw new TradingError("side must be buy or sell");
      if (!(Number.isFinite(input.qty) && input.qty > 0 && input.qty <= MAX_QTY)) throw new TradingError("qty must be a positive number");
      const type = input.type === "limit" ? "limit" : "market";
      const limitPrice = type === "limit" ? (input.limitPrice ?? null) : null;
      if (type === "limit" && !(limitPrice !== null && Number.isFinite(limitPrice) && limitPrice > 0)) throw new TradingError("a limit order needs a positive limit_price");
      const reason = clip(redact(String(input.reason ?? "")), 300);
      if (reason.length < 3) throw new TradingError("give a one line reason for the order");
      let venue: VenueTool | null = null;
      let venueId: string | null = null;
      if (input.venue) {
        const want = input.venue.trim();
        venue = (await venueTools()).find((t) => t.name === want || t.alias === want) ?? null;
        if (!venue) throw new TradingError(`the venue tool ${clip(want, 60)} is not connected`, "not_found");
        if (!venue.money) throw new TradingError(`${venue.name} does not place orders; name the connector tool that does`);
      }
      if (input.live === true && liveOff) throw new TradingError(`${liveOff} Propose it on paper instead.`, "gate");
      // live when asked; without an answer, live only when the owner set live mode and a live venue is ready (never without the crew sandbox)
      let mode: "paper" | "live" = input.live === true ? "live" : "paper";
      if (input.live === undefined && !venue && !liveOff && (await repo.settings()).value.mode === "live" && (await desk.hasLiveVenue())) mode = "live";
      if (!venue) {
        const route = await desk.route(mode);
        if (route) {
          venueId = route.row.id;
          if (mode === "live") venue = route.orderTool;
        }
      } else {
        venueId = await desk.venueOf(venue.connectorId);
      }
      // one live idea, one proposal: an identical order still waiting is returned as is, nothing new is published
      const same = (await repo.openOrders()).find(
        (x) =>
          x.status === "proposed" &&
          x.runId === input.runId &&
          x.mode === mode &&
          x.symbol === symbol &&
          x.side === input.side &&
          x.qty === input.qty &&
          x.type === type &&
          x.limitPrice === limitPrice,
      );
      if (same) return orderDto(same);
      let quote: number | null = null;
      if (input.quote !== undefined && input.quote !== null) {
        if (!(Number.isFinite(input.quote) && input.quote > 0)) throw new TradingError("quote must be a positive price");
        quote = input.quote;
        await setPrice(symbol, quote, "the quote the crew read", input.runId);
      } else if (type === "market") {
        try {
          quote = (await service.quote(symbol, { signal: input.signal, runId: input.runId })).price;
        } catch (e) {
          if (e instanceof TradingError) throw new TradingError(`${e.message}. A market order needs a price.`, "no_price");
          throw e;
        }
      }
      const now = ctx.clock.now();
      const o: OrderRow = {
        id: ctx.clock.id(),
        runId: input.runId,
        agentId: input.agentId,
        symbol,
        side: input.side,
        qty: input.qty,
        type,
        limitPrice,
        mode,
        status: "proposed",
        venue: mode === "live" && venue ? venue.connectorId : null,
        reason,
        riskNote: null,
        fillPrice: null,
        createdAt: now,
        decidedAt: null,
        filledAt: null,
        quote,
        venueTool: mode === "live" && venue ? venue.name : null,
        riskVerdict: null,
        riskAgentId: null,
        realizedUsd: 0,
        error: null,
        venueId,
      };
      await repo.insertOrder(o, now);
      desk.observe(venueId, { kind: "proposed", symbol, side: o.side, qty: o.qty, price: quote });
      await publishOrder(o);
      return orderDto(o);
    },

    async pendingReview(runId) {
      const open = await repo.openOrders();
      return open.filter((o) => o.status === "proposed" && o.riskVerdict === null && (runId === null || o.runId === runId)).map(orderDto);
    },

    async review(input: ReviewInput) {
      let o: OrderRow | null;
      if (input.orderId) {
        o = await repo.order(input.orderId);
        if (!o) throw new TradingError(`order ${clip(input.orderId, 40)} not found`, "not_found");
      } else {
        const next = (await service.pendingReview(input.runId))[0];
        o = next ? await repo.order(next.id) : null;
        if (!o) throw new TradingError("no order is waiting for a risk review", "not_found");
      }
      if (o.status !== "proposed" || o.riskVerdict !== null) throw new TradingError(`order ${o.id} is ${o.status}${o.riskVerdict ? " and already reviewed" : ""}`, "conflict");
      if (input.agentId && o.agentId === input.agentId) throw new TradingError("the cat that proposed an order cannot review it", "conflict");
      const note = clip(redact(String(input.note ?? "")), 400);
      if (note.length < 3) throw new TradingError("give the risk note: why the order fits or does not");
      const now = ctx.clock.now();
      o.riskNote = note;
      o.riskVerdict = input.verdict;
      o.riskAgentId = input.agentId;
      if (input.verdict === "reject") {
        o.status = "rejected";
        o.decidedAt = now;
      } else if (o.mode === "paper") {
        o.decidedAt = now;
        const price = o.type === "market" ? (o.quote ?? last.get(o.symbol)?.price ?? null) : (last.get(o.symbol)?.price ?? o.quote);
        if (o.type === "market") {
          if (price === null) {
            o.status = "failed";
            o.error = "no price to fill at";
          } else await fill(o, price);
        } else {
          const at = price === null ? null : limitFill(o.side, o.limitPrice!, price);
          if (at !== null) await fill(o, at);
          else o.status = "approved";
        }
      } else {
        const settings = (await repo.settings()).value;
        if (settings.autoTrade) {
          const why = await gateFor(o, settings, await isHalted());
          if (why) o.error = why;
          else await executeLive(o, input.signal);
        }
      }
      await repo.saveOrder(o, now);
      await publishOrder(o);
      if (filled(o)) await publishPositions(o.mode, o.runId);
      return orderDto(o);
    },

    async decide(orderId, decision) {
      const o = await requireOrder(orderId);
      const now = ctx.clock.now();
      if (decision === "reject") {
        if (o.status === "proposed") o.status = "rejected";
        else if (o.status === "approved") o.status = "cancelled";
        else throw conflict(`the order is ${o.status}`);
        o.decidedAt = now;
      } else {
        if (o.status !== "proposed") throw conflict(`the order is ${o.status}`);
        if (o.mode !== "live") throw conflict("paper orders fill after the risk review; there is nothing to approve");
        if (liveOff) throw comingSoonError(liveOff);
        if (o.riskVerdict === null) throw conflict("the risk manager has not reviewed this order yet");
        if (o.riskVerdict !== "approve") throw conflict("the risk manager rejected this order");
        const why = await gateFor(o, (await repo.settings()).value, await isHalted());
        if (why) throw new HttpError(409, "trading_gate", why);
        await executeLive(o);
      }
      await repo.saveOrder(o, now);
      await publishOrder(o);
      if (filled(o)) await publishPositions(o.mode, o.runId);
      return orderDto(o);
    },

    async halt(reason) {
      const now = ctx.clock.now();
      await repo.halt(clip(reason, 200), now);
      let n = 0;
      for (const o of await repo.openOrders()) {
        o.status = "cancelled";
        o.decidedAt = now;
        o.error = "cancelled by the kill switch";
        await repo.saveOrder(o, now);
        await publishOrder(o);
        n++;
      }
      if (n) log.log("warn", "kill switch cancelled open orders", { orders: n });
      return n;
    },

    // ------------------------------------------------------------ venues
    venues: () => desk.list(),
    createVenue: (body) => desk.create(body),
    updateVenue: (id, body) => desk.update(id, body),
    removeVenue: (id) => desk.remove(id),
    learnVenue: (id) => desk.learn(id),
    venueNotes: (role: AgentRole) => desk.notes(role),
    useMemory: (m) => desk.useMemory(m),
    connectSimulator: (sim, opts) => desk.connectSimulator(sim, opts),
    idle: () => desk.idle(),
    async close() {
      await desk.idle();
      desk.close();
    },
  };
  return service;
}
