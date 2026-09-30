// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Number, money and time formatting. Figures are en-US grouped and meant
// to sit in tabular mono (the .num class), so live counts never jitter.
const INT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function fmtInt(n: number): string {
  return INT.format(Math.round(Number.isFinite(n) ? n : 0));
}

export function fmtTokens(n: number): string {
  return `${fmtInt(n)} tokens`;
}

export function fmtUsd(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  if (v === 0) return "$0.00";
  if (Math.abs(v) < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function fmtPct(fraction: number): string {
  const v = Number.isFinite(fraction) ? fraction : 0;
  return `${Math.round(v * 100)}%`;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? `${m}m ${rest}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

export function fmtClock(ts: number): string {
  return CLOCK.format(new Date(ts));
}

export function fmtDay(ts: number): string {
  return DAY.format(new Date(ts));
}

export function fmtAgo(ts: number, now: number): string {
  const d = Math.max(0, now - ts);
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return fmtDay(ts);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

const PRICE = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });

/** A price in USD with two decimals: "$182.10". */
export function fmtPrice(n: number): string {
  return `$${PRICE.format(Number.isFinite(n) ? n : 0)}`;
}

/** A signed USD amount for P&L: "+$124.30", "-$12.10", "$0.00". The sign carries the meaning, never color alone. */
export function fmtSignedUsd(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  if (Math.abs(v) < 0.005) return "$0.00";
  return `${v > 0 ? "+" : "-"}$${PRICE.format(Math.abs(v))}`;
}

/** A quantity with up to 8 decimals, for shares and crypto alike. */
export function fmtQty(n: number): string {
  return QTY.format(Number.isFinite(n) ? n : 0);
}

/** A count where 0 means no cap. */
export function fmtLimit(n: number | undefined | null, unit?: string): string {
  if (!n) return "Unlimited";
  return unit ? `${fmtInt(n)} ${unit}` : fmtInt(n);
}
