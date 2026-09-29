// providers repo: the providers table, plus the single "routing" row in the
// settings table (the tier routing contract stores ModelRouting there).
// The key itself never touches these tables: only key_ref and a 4 char hint.
import type { ModelRouting, ProviderCap, ProviderModel, ProviderProtocol } from "@mengai/shared";
import type { Db } from "../../core/ports/db";
import { boolOrNull, json, num, numOrNull, toJson } from "../../lib/sql";

export const ROUTING_KEY = "routing";
const OWNER = "owner";

export interface ProviderRow {
  id: string;
  preset: string;
  label: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  keyRef: string | null;
  keyHint: string | null;
  models: ProviderModel[];
  caps: ProviderCap[];
  lastTestAt: number | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  createdAt: number;
  updatedAt: number;
}

type Raw = Record<string, unknown>;

function decode(r: Raw): ProviderRow {
  return {
    id: String(r.id),
    preset: String(r.preset),
    label: String(r.label),
    protocol: String(r.protocol) as ProviderProtocol,
    baseUrl: String(r.base_url),
    keyRef: (r.key_ref as string | null) ?? null,
    keyHint: (r.key_hint as string | null) ?? null,
    models: json<ProviderModel[]>(r.models, []),
    caps: json<ProviderCap[]>(r.caps, []),
    lastTestAt: numOrNull(r.last_test_at),
    lastTestOk: boolOrNull(r.last_test_ok),
    lastTestError: (r.last_test_error as string | null) ?? null,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export function createProvidersRepo(db: Db) {
  return {
    async list(): Promise<ProviderRow[]> {
      const rows = await db.query<Raw>`select * from providers order by created_at asc, id asc`;
      return rows.map(decode);
    },

    async get(id: string): Promise<ProviderRow | null> {
      const rows = await db.query<Raw>`select * from providers where id = ${id}`;
      return rows[0] ? decode(rows[0]) : null;
    },

    async insert(p: ProviderRow): Promise<void> {
      await db.query`insert into providers (id, preset, label, protocol, base_url, key_ref, key_hint, models, caps, last_test_at, last_test_ok, last_test_error, created_at, updated_at)
        values (${p.id}, ${p.preset}, ${p.label}, ${p.protocol}, ${p.baseUrl}, ${p.keyRef}, ${p.keyHint}, ${toJson(p.models)}, ${toJson(p.caps)}, ${null}, ${null}, ${null}, ${p.createdAt}, ${p.updatedAt})`;
    },

    async update(p: ProviderRow): Promise<void> {
      await db.query`update providers set label = ${p.label}, base_url = ${p.baseUrl}, key_ref = ${p.keyRef}, key_hint = ${p.keyHint}, models = ${toJson(p.models)}, last_test_at = ${p.lastTestAt}, last_test_ok = ${p.lastTestOk === null ? null : p.lastTestOk ? 1 : 0}, last_test_error = ${p.lastTestError}, updated_at = ${p.updatedAt} where id = ${p.id}`;
    },

    async setTest(id: string, at: number, ok: boolean, error: string | null): Promise<void> {
      await db.query`update providers set last_test_at = ${at}, last_test_ok = ${ok ? 1 : 0}, last_test_error = ${error} where id = ${id}`;
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db.query<Raw>`delete from providers where id = ${id} returning id`;
      return rows.length > 0;
    },

    async getRouting(): Promise<ModelRouting | null> {
      const rows = await db.query<Raw>`select value from settings where owner_id = ${OWNER} and key = ${ROUTING_KEY}`;
      return rows[0] ? json<ModelRouting | null>(rows[0].value, null) : null;
    },

    async putRouting(routing: ModelRouting, now: number): Promise<void> {
      await db.query`insert into settings (owner_id, key, value, updated_at) values (${OWNER}, ${ROUTING_KEY}, ${toJson(routing)}, ${now})
        on conflict (owner_id, key) do update set value = excluded.value, updated_at = excluded.updated_at`;
    },
  };
}

export type ProvidersRepo = ReturnType<typeof createProvidersRepo>;
