// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The paper broker's math: fills against a position with an average price,
// realized P&L on the part that closes, unrealized P&L at the last price.
// Shorts are allowed (qty below zero). Pure; amounts rounded to cents and
// quantities to 1e-8 so float dust never shows.
export interface Book {
  qty: number;
  avgPrice: number;
  realizedUsd: number;
}

export const EMPTY_BOOK: Book = { qty: 0, avgPrice: 0, realizedUsd: 0 };

export const cents = (v: number) => Math.round(v * 100) / 100;
const qtyRound = (v: number) => Math.round(v * 1e8) / 1e8;

/** A fill of `qty` (always positive) on `side` at `price`. Returns the new book and the P&L realized by this fill. */
export function applyFill(book: Book, side: "buy" | "sell", qty: number, price: number): { book: Book; realized: number } {
  if (!(qty > 0) || !(price > 0)) throw new Error("a fill needs a positive quantity and price");
  const dir = side === "buy" ? 1 : -1;
  const q = book.qty;
  if (q === 0 || Math.sign(q) === dir) {
    const size = Math.abs(q) + qty;
    const avg = (Math.abs(q) * book.avgPrice + qty * price) / size;
    return { book: { qty: qtyRound(q + dir * qty), avgPrice: avg, realizedUsd: book.realizedUsd }, realized: 0 };
  }
  const closing = Math.min(qty, Math.abs(q));
  const realized = cents(closing * (price - book.avgPrice) * Math.sign(q));
  const next = qtyRound(q + dir * qty);
  const avg = next === 0 ? 0 : Math.sign(next) === Math.sign(q) ? book.avgPrice : price;
  return { book: { qty: next, avgPrice: avg, realizedUsd: cents(book.realizedUsd + realized) }, realized };
}

export function unrealized(book: Pick<Book, "qty" | "avgPrice">, last: number | null): number {
  if (last === null || book.qty === 0) return 0;
  return cents(book.qty * (last - book.avgPrice));
}

/** Whether a limit order can fill at the last price, and at what price (the better of the two for the order). */
export function limitFill(side: "buy" | "sell", limit: number, last: number): number | null {
  if (side === "buy") return last <= limit ? last : null;
  return last >= limit ? last : null;
}
