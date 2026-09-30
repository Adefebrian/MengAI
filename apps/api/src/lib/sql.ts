// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Row decoding helpers. Bun.SQL returns Postgres int8 as string and SQLite
// integers as number; JSON columns are TEXT in both dialects.
export function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}

export function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v);
}

export function bool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "t" || v === "true";
}

export function boolOrNull(v: unknown): boolean | null {
  return v === null || v === undefined ? null : bool(v);
}

export function json<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || v.length === 0) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export function toJson(v: unknown): string {
  return JSON.stringify(v ?? null);
}

/** Booleans are stored as 0/1 in both dialects. */
export function b01(v: boolean): number {
  return v ? 1 : 0;
}
