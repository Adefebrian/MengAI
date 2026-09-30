// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// trading_settings, orders, positions and trading_venues. One owner
// ("owner") like the rest of the schema; amounts are USD doubles,
// quantities doubles.
import { DEFAULT_TRADING, type OrderDTO, type OrderStatus, type TradingSettings } from "@mengai/shared";
import type { Db, Row } from "../../core/ports/db";
import { b01, bool, json, num, numOrNull, toJson } from "../../lib/sql";
import type { Book } from "./broker";
import type { VenueProfile } from "./learn";

export interface OrderRow extends OrderDTO {
  /** the quote the order was proposed at */
  quote: number | null;
  /** the dotted connector tool that places a live order */
  venueTool: string | null;
  riskVerdict: "approve" | "reject" | null;
  riskAgentId: string | null;
  realizedUsd: number;
  error: string | null;
  /** the trading venue that priced (paper) or placed (live) the order */
  venueId: string | null;
}

/** One trading venue. Secrets never land here: they stay with the connector in the vault. */
export interface VenueRow {
  id: string;
  connectorId: string;
  /** the venue created the connector (removing the venue removes it) */
  ownsConnector: boolean;
  preset: string;
  label: string;
  /** the connector label at creation: the name key of the venue's crew skills */
  skillKey: string;
  /** the command or URL before the mode flags */
  target: string;
  mode: "paper" | "live";
  testnet: boolean;
  enabled: boolean;
  status: "connected" | "learning" | "ready" | "error" | "disabled";
  error: string | null;
  profile: VenueProfile | null;
  /** non-secret setup from the wizard (the exchange id) */
  settings: { exchange?: string | null };
  skillVersion: number;
  learnedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PositionRow extends Book {
  mode: "paper" | "live";
  symbol: string;
  lastPrice: number | null;
  updatedAt: number;
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

function orderFromRow(r: Row): OrderRow {
  return {
    id: String(r.id),
    runId: str(r.run_id),
    agentId: str(r.agent_id),
    symbol: String(r.symbol),
    side: String(r.side) as OrderDTO["side"],
    qty: num(r.qty),
    type: String(r.type) as OrderDTO["type"],
    limitPrice: numOrNull(r.limit_price),
    mode: String(r.mode) as OrderDTO["mode"],
    status: String(r.status) as OrderStatus,
    venue: str(r.venue),
    reason: String(r.reason ?? ""),
    riskNote: str(r.risk_note),
    fillPrice: numOrNull(r.fill_price),
    createdAt: num(r.created_at),
    decidedAt: numOrNull(r.decided_at),
    filledAt: numOrNull(r.filled_at),
    quote: numOrNull(r.quote),
    venueTool: str(r.venue_tool),
    riskVerdict: (str(r.risk_verdict) as OrderRow["riskVerdict"]) ?? null,
    riskAgentId: str(r.risk_agent_id),
    realizedUsd: num(r.realized_usd),
    error: str(r.error),
    venueId: str(r.venue_id),
  };
}

function venueFromRow(r: Row): VenueRow {
  const profile = json<VenueProfile | null>(r.profile, null);
  return {
    id: String(r.id),
    connectorId: String(r.connector_id),
    ownsConnector: bool(r.owns_connector),
    preset: String(r.preset),
    label: String(r.label),
    skillKey: String(r.skill_key),
    target: String(r.target ?? ""),
    mode: String(r.mode) === "live" ? "live" : "paper",
    testnet: bool(r.testnet),
    enabled: bool(r.enabled),
    status: String(r.status) as VenueRow["status"],
    error: str(r.error),
    profile: profile && typeof profile === "object" && (profile as { v?: unknown }).v === 1 ? profile : null,
    settings: json<VenueRow["settings"]>(r.settings, {}),
    skillVersion: num(r.skill_version),
    learnedAt: numOrNull(r.learned_at),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export function orderDto(o: OrderRow): OrderDTO {
  return {
    id: o.id,
    runId: o.runId,
    agentId: o.agentId,
    symbol: o.symbol,
    side: o.side,
    qty: o.qty,
    type: o.type,
    limitPrice: o.limitPrice,
    mode: o.mode,
    status: o.status,
    venue: o.venue,
    reason: o.reason,
    riskNote: o.riskNote,
    fillPrice: o.fillPrice,
    createdAt: o.createdAt,
    decidedAt: o.decidedAt,
    filledAt: o.filledAt,
  };
}

function positionFromRow(r: Row): PositionRow {
  return {
    mode: String(r.mode) as PositionRow["mode"],
    symbol: String(r.symbol),
    qty: num(r.qty),
    avgPrice: num(r.avg_price),
    lastPrice: numOrNull(r.last_price),
    realizedUsd: num(r.realized_usd),
    updatedAt: num(r.updated_at),
  };
}

export function createTradingRepo(db: Db) {
  return {
    async settings(): Promise<{ value: TradingSettings; haltedAt: number | null; haltReason: string | null }> {
      const rows = await db.query`select value, halted_at, halt_reason from trading_settings where owner_id = 'owner'`;
      const r = rows[0];
      if (!r) return { value: { ...DEFAULT_TRADING, allowedSymbols: [] }, haltedAt: null, haltReason: null };
      return { value: { ...DEFAULT_TRADING, ...json<Partial<TradingSettings>>(r.value, {}) }, haltedAt: numOrNull(r.halted_at), haltReason: str(r.halt_reason) };
    },
    async saveSettings(value: TradingSettings, now: number): Promise<void> {
      await db.query`insert into trading_settings (owner_id, value, halted_at, halt_reason, updated_at) values ('owner', ${toJson(value)}, ${null}, ${null}, ${now})
        on conflict (owner_id) do update set value = excluded.value, halted_at = null, halt_reason = null, updated_at = excluded.updated_at`;
    },
    async halt(reason: string, now: number): Promise<void> {
      await db.query`insert into trading_settings (owner_id, value, halted_at, halt_reason, updated_at) values ('owner', ${toJson(DEFAULT_TRADING)}, ${now}, ${reason}, ${now})
        on conflict (owner_id) do update set halted_at = excluded.halted_at, halt_reason = excluded.halt_reason, updated_at = excluded.updated_at`;
    },

    async insertOrder(o: OrderRow, now: number): Promise<void> {
      await db.query`insert into orders (id, run_id, agent_id, symbol, side, qty, type, limit_price, quote, mode, status, venue, venue_tool, venue_id, reason, risk_note, risk_verdict, risk_agent_id, fill_price, realized_usd, error, created_at, decided_at, filled_at, updated_at)
        values (${o.id}, ${o.runId}, ${o.agentId}, ${o.symbol}, ${o.side}, ${o.qty}, ${o.type}, ${o.limitPrice}, ${o.quote}, ${o.mode}, ${o.status}, ${o.venue}, ${o.venueTool}, ${o.venueId}, ${o.reason}, ${o.riskNote}, ${o.riskVerdict}, ${o.riskAgentId}, ${o.fillPrice}, ${o.realizedUsd}, ${o.error}, ${o.createdAt}, ${o.decidedAt}, ${o.filledAt}, ${now})`;
    },
    async saveOrder(o: OrderRow, now: number): Promise<void> {
      await db.query`update orders set status = ${o.status}, risk_note = ${o.riskNote}, risk_verdict = ${o.riskVerdict}, risk_agent_id = ${o.riskAgentId},
        fill_price = ${o.fillPrice}, realized_usd = ${o.realizedUsd}, error = ${o.error}, decided_at = ${o.decidedAt}, filled_at = ${o.filledAt}, updated_at = ${now}
        where id = ${o.id} and owner_id = 'owner'`;
    },
    async order(id: string): Promise<OrderRow | null> {
      const rows = await db.query`select * from orders where id = ${id} and owner_id = 'owner'`;
      return rows[0] ? orderFromRow(rows[0]) : null;
    },
    async orders(q: { runId?: string; status?: OrderStatus; limit: number }): Promise<OrderRow[]> {
      const rows = q.runId
        ? await db.query`select * from orders where owner_id = 'owner' and run_id = ${q.runId} order by created_at desc, id desc limit ${q.limit}`
        : await db.query`select * from orders where owner_id = 'owner' order by created_at desc, id desc limit ${q.limit}`;
      const all = rows.map(orderFromRow);
      return q.status ? all.filter((o) => o.status === q.status) : all;
    },
    async openOrders(): Promise<OrderRow[]> {
      const rows = await db.query`select * from orders where owner_id = 'owner' and status in ('proposed', 'approved') order by created_at, id`;
      return rows.map(orderFromRow);
    },
    async realizedSince(mode: "paper" | "live", since: number): Promise<number> {
      const rows = await db.query<{ s: unknown }>`select coalesce(sum(realized_usd), 0) as s from orders where owner_id = 'owner' and mode = ${mode} and status = 'filled' and filled_at >= ${since}`;
      return num(rows[0]?.s);
    },

    async positions(mode?: "paper" | "live"): Promise<PositionRow[]> {
      const rows = mode
        ? await db.query`select * from positions where owner_id = 'owner' and mode = ${mode} order by symbol`
        : await db.query`select * from positions where owner_id = 'owner' order by mode, symbol`;
      return rows.map(positionFromRow);
    },
    async position(mode: "paper" | "live", symbol: string): Promise<PositionRow | null> {
      const rows = await db.query`select * from positions where owner_id = 'owner' and mode = ${mode} and symbol = ${symbol}`;
      return rows[0] ? positionFromRow(rows[0]) : null;
    },
    async savePosition(p: PositionRow): Promise<void> {
      await db.query`insert into positions (owner_id, mode, symbol, qty, avg_price, last_price, realized_usd, updated_at)
        values ('owner', ${p.mode}, ${p.symbol}, ${p.qty}, ${p.avgPrice}, ${p.lastPrice}, ${p.realizedUsd}, ${p.updatedAt})
        on conflict (owner_id, mode, symbol) do update set qty = excluded.qty, avg_price = excluded.avg_price, last_price = excluded.last_price,
          realized_usd = excluded.realized_usd, updated_at = excluded.updated_at`;
    },
    async mark(symbol: string, price: number, now: number): Promise<void> {
      await db.query`update positions set last_price = ${price}, updated_at = ${now} where owner_id = 'owner' and symbol = ${symbol}`;
    },

    async venues(): Promise<VenueRow[]> {
      return (await db.query`select * from trading_venues where owner_id = 'owner' order by created_at, id`).map(venueFromRow);
    },
    async venue(id: string): Promise<VenueRow | null> {
      const rows = await db.query`select * from trading_venues where id = ${id} and owner_id = 'owner'`;
      return rows[0] ? venueFromRow(rows[0]) : null;
    },
    async venueByConnector(connectorId: string): Promise<VenueRow | null> {
      const rows = await db.query`select * from trading_venues where connector_id = ${connectorId} and owner_id = 'owner'`;
      return rows[0] ? venueFromRow(rows[0]) : null;
    },
    async insertVenue(v: VenueRow): Promise<void> {
      await db.query`insert into trading_venues (id, connector_id, owns_connector, preset, label, skill_key, target, mode, testnet, enabled, status, error, profile, settings, skill_version, learned_at, created_at, updated_at)
        values (${v.id}, ${v.connectorId}, ${b01(v.ownsConnector)}, ${v.preset}, ${v.label}, ${v.skillKey}, ${v.target}, ${v.mode}, ${b01(v.testnet)}, ${b01(v.enabled)}, ${v.status}, ${v.error},
          ${toJson(v.profile ?? {})}, ${toJson(v.settings)}, ${v.skillVersion}, ${v.learnedAt}, ${v.createdAt}, ${v.updatedAt})`;
    },
    async saveVenue(v: VenueRow): Promise<void> {
      await db.query`update trading_venues set label = ${v.label}, target = ${v.target}, mode = ${v.mode}, testnet = ${b01(v.testnet)}, enabled = ${b01(v.enabled)},
        status = ${v.status}, error = ${v.error}, profile = ${toJson(v.profile ?? {})}, settings = ${toJson(v.settings)}, skill_version = ${v.skillVersion},
        learned_at = ${v.learnedAt}, updated_at = ${v.updatedAt}
        where id = ${v.id} and owner_id = 'owner'`;
    },
    async removeVenue(id: string): Promise<void> {
      await db.query`delete from trading_venues where id = ${id} and owner_id = 'owner'`;
    },
  };
}

export type TradingRepo = ReturnType<typeof createTradingRepo>;
