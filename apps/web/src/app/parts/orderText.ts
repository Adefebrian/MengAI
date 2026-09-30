// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// An order in words, shared by the trading rows and the Mac island: the
// trade as a title (side, quantity, symbol), whether it waits on the
// owner (live and proposed; a paper order never does), and a rationale as
// a sentence. Pure, no React, so the island entry stays small.
import type { OrderDTO } from "@mengai/shared";
import { fmtPrice, fmtQty } from "../format";

export function orderTitle(o: OrderDTO): string {
  const side = o.side === "buy" ? "Buy" : "Sell";
  return `${side} ${fmtQty(o.qty)} ${o.symbol}`;
}

/** How the order is priced: "limit at $64,120.00" or "at market". */
export function orderType(o: OrderDTO): string {
  return o.type === "limit" && o.limitPrice !== null ? `limit at ${fmtPrice(o.limitPrice)}` : "at market";
}

/** A rationale reads as a sentence: its first letter capitalised. */
export function sentence(text: string): string {
  const t = text.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Orders a person must answer: live and proposed. Paper orders never wait on you. */
export function waitsOnYou(o: OrderDTO): boolean {
  return o.status === "proposed" && o.mode === "live";
}
