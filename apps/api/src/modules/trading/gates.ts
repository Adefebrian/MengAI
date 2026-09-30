// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The live-order gate. Every rule is mechanical; the first one that fails is
// the reason the order waits. Conservative defaults: paper mode, and a max
// order size or a daily loss limit of 0 blocks live orders (JEV
// be.trading_defaults: blocks_live). Pure.
import type { TradingSettings } from "@mengai/shared";

export interface GateInput {
  settings: TradingSettings;
  halted: boolean;
  symbol: string;
  qty: number;
  /** the price the notional is measured at: the limit, else the last price */
  price: number | null;
  /** today's loss in live trading, USD, positive when losing (realized plus unrealized) */
  dailyLossUsd: number;
  venue: string | null;
}

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Null when a live order may go out; otherwise why not. */
export function liveGate(g: GateInput): string | null {
  const s = g.settings;
  if (g.halted) return "trading is stopped by the kill switch; save the trading settings to start again";
  if (s.mode !== "live") return "live trading is off (paper mode)";
  if (!s.allowedSymbols.includes(g.symbol)) return `${g.symbol} is not on the allowed symbols list`;
  if (!(s.maxOrderUsd > 0)) return "live orders are blocked until a max order size is set";
  if (g.price === null || !(g.price > 0)) return "the order has no price to size it against";
  const notional = g.qty * g.price;
  if (notional > s.maxOrderUsd) return `the order is ${usd(notional)}, over the ${usd(s.maxOrderUsd)} cap per order`;
  if (!(s.dailyLossLimitUsd > 0)) return "live orders are blocked until a daily loss limit is set";
  if (g.dailyLossUsd >= s.dailyLossLimitUsd) return `the daily loss limit is reached (${usd(g.dailyLossUsd)} of ${usd(s.dailyLossLimitUsd)})`;
  if (!g.venue) return "the order names no venue tool to place it through";
  return null;
}

/** Start of the UTC day of `now`, ms. */
export function dayStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Loss today, positive when losing: realized today plus unrealized now. */
export function dailyLoss(realizedToday: number, unrealizedNow: number): number {
  const pnl = realizedToday + unrealizedNow;
  return pnl < 0 ? Math.round(-pnl * 100) / 100 : 0;
}

/** Normalized settings: uppercase unique symbols, finite non-negative limits. */
export function normalizeSettings(s: TradingSettings): TradingSettings {
  const fin = (v: number) => (Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0);
  return {
    mode: s.mode === "live" ? "live" : "paper",
    autoTrade: s.autoTrade === true,
    maxOrderUsd: fin(s.maxOrderUsd),
    dailyLossLimitUsd: fin(s.dailyLossLimitUsd),
    allowedSymbols: [...new Set(s.allowedSymbols.map((x) => x.trim().toUpperCase()).filter(Boolean))].slice(0, 100),
  };
}
