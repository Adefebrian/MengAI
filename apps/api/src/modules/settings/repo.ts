// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// settings table: one row per (owner, key), value stored as JSON text.
import { json, num, toJson } from "../../lib/sql";
import type { Db } from "../../core/ports/db";

export const OWNER = "owner";

export function createSettingsRepo(db: Db) {
  return {
    async all(): Promise<Array<{ key: string; value: unknown; updatedAt: number }>> {
      const rows = await db.query<{ key: string; value: string; updated_at: unknown }>`
        select key, value, updated_at from settings where owner_id = ${OWNER}`;
      return rows.map((r) => ({ key: r.key, value: json<unknown>(r.value, null), updatedAt: num(r.updated_at) }));
    },
    async put(entries: Array<[string, unknown]>, now: number): Promise<void> {
      if (entries.length === 0) return;
      await db.tx(async (tx) => {
        for (const [key, value] of entries) {
          await tx.query`
            insert into settings (owner_id, key, value, updated_at)
            values (${OWNER}, ${key}, ${toJson(value)}, ${now})
            on conflict (owner_id, key) do update set value = excluded.value, updated_at = excluded.updated_at`;
        }
      });
    },
  };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
