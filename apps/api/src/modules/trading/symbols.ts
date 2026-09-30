// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Symbols, prices and order arguments: the pure helpers the desk, the
// learning pass and the paper broker share. The crew writes symbols in one
// desk form (BTC-USD, BTC/USDT, AAPL); a learned venue gets its own form
// (BTC/USDT, BTCUSDT) through toVenueSymbol. Pure.
import { clip } from "../../lib/redact";
import { TradingError, type VenueTool } from "./ports";

export const SYMBOL_RE = /^[A-Z0-9][A-Z0-9._/:-]{0,23}$/;

export function normSymbol(raw: string): string {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!SYMBOL_RE.test(s)) throw new TradingError(`${clip(s, 30) || "the symbol"} is not a valid symbol (letters, digits and . _ / : -)`);
  return s;
}

/** A desk symbol in a venue's form: base and quote joined by the venue's separator. Single tickers (AAPL, BTCUSDT) stay as they are. */
export function toVenueSymbol(symbol: string, sep: string | null | undefined): string {
  if (sep === null || sep === undefined) return symbol;
  const m = /^([A-Z0-9.]+)[/_:-]([A-Z0-9.]+)$/.exec(symbol);
  if (!m) return symbol;
  return `${m[1]}${sep}${m[2]}`;
}

/** The first positive price in a tool's output: JSON fields first, then the first decimal number. */
export function parsePrice(text: string, keys: readonly string[] = ["price", "last", "lastPrice", "last_price", "close", "mark", "markPrice", "c"]): number | null {
  const t = text.trim();
  const fromObj = (o: unknown, depth: number): number | null => {
    if (!o || typeof o !== "object" || depth > 2) return null;
    if (Array.isArray(o)) {
      for (const v of o.slice(0, 5)) {
        const r = fromObj(v, depth + 1);
        if (r !== null) return r;
      }
      return null;
    }
    const rec = o as Record<string, unknown>;
    for (const k of keys) {
      const v = rec[k];
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      if (Number.isFinite(n) && n > 0) return n;
    }
    for (const v of Object.values(rec)) {
      const r = fromObj(v, depth + 1);
      if (r !== null) return r;
    }
    return null;
  };
  const start = t.search(/[[{]/);
  if (start >= 0) {
    try {
      const r = fromObj(JSON.parse(t.slice(start)), 0);
      if (r !== null) return r;
    } catch {
      // not JSON
    }
  }
  const m = /(?:^|[^\d.])(\d{1,12}(?:,\d{3})*(?:\.\d+)?)(?![\d.])/.exec(t.replace(/^HTTP \d{3}[^\n]*\n/, ""));
  const n = m ? Number(m[1]!.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The order fields a venue tool needs. */
export interface OrderLike {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  type: "market" | "limit";
  limitPrice: number | null;
}

/** An argument name with case and punctuation dropped ("client_order_id" to "clientorderid"). */
export const argKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");
export const SYMBOL_ARGS = ["symbol", "ticker", "pair", "instrument", "market", "asset", "coin", "product", "productid", "instrumentid"];
export const QTY_ARGS = ["qty", "quantity", "amount", "size", "units", "volume"];
export const PRICE_ARGS = ["price", "limitprice", "limit"];
export const TYPE_ARGS = ["type", "ordertype"];
export const CLIENT_ID_ARGS = ["clientorderid", "clientid", "clientoid"];

/** Arguments for a venue tool, mapped onto the names its schema uses. */
export function venueArgs(tool: Pick<VenueTool, "schema">, o: OrderLike): Record<string, unknown> {
  const props = Object.keys(((tool.schema as { properties?: Record<string, unknown> }).properties ?? {}) as Record<string, unknown>);
  const value = (name: string): unknown => {
    const n = argKey(name);
    if (SYMBOL_ARGS.includes(n)) return o.symbol;
    if (n === "side") return o.side;
    if (QTY_ARGS.includes(n)) return o.qty;
    if (TYPE_ARGS.includes(n)) return o.type;
    if (PRICE_ARGS.includes(n)) return o.limitPrice ?? undefined;
    if (CLIENT_ID_ARGS.includes(n)) return o.id;
    return undefined;
  };
  if (props.length === 0) return { symbol: o.symbol, side: o.side, qty: o.qty, type: o.type, ...(o.limitPrice !== null ? { price: o.limitPrice } : {}), client_order_id: o.id };
  const out: Record<string, unknown> = {};
  for (const p of props) {
    const v = value(p);
    if (v !== undefined) out[p] = v;
  }
  return out;
}
