// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// crew_skills (the owner's own skills) and crew_skill_state (the enabled
// flag of a built-in; no row means on). The only file that touches them.
import type { AgentRole, CompanyKind } from "@mengai/shared";
import type { Db, Row } from "../../core/ports/db";
import { b01, bool, json, num, toJson } from "../../lib/sql";

export const OWNER = "owner";

export interface OwnerSkillRow {
  id: string;
  name: string;
  summary: string;
  body: string;
  roles: AgentRole[] | null;
  kinds: CompanyKind[] | null;
  enabled: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

const list = <T>(v: unknown): T[] | null => {
  const parsed = json<unknown>(v, null);
  return Array.isArray(parsed) && parsed.length ? (parsed as T[]) : null;
};

function fromRow(r: Row): OwnerSkillRow {
  return {
    id: String(r.id),
    name: String(r.name),
    summary: String(r.summary ?? ""),
    body: String(r.body),
    roles: list<AgentRole>(r.roles),
    kinds: list<CompanyKind>(r.kinds),
    enabled: bool(r.enabled),
    version: num(r.version),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

/** The unique key of a name: trimmed, inner spaces collapsed, lower case. */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export function createCrewSkillsRepo(db: Db) {
  return {
    /** every owner skill, newest first */
    async listOwner(limit = 500): Promise<OwnerSkillRow[]> {
      const rows = await db.query`select * from crew_skills where owner_id = ${OWNER} order by created_at desc, id desc limit ${limit}`;
      return rows.map(fromRow);
    },

    async getOwner(id: string): Promise<OwnerSkillRow | null> {
      const rows = await db.query`select * from crew_skills where owner_id = ${OWNER} and id = ${id}`;
      return rows[0] ? fromRow(rows[0]) : null;
    },

    async countOwner(): Promise<number> {
      const rows = await db.query<{ n: unknown }>`select count(*) as n from crew_skills where owner_id = ${OWNER}`;
      return num(rows[0]?.n);
    },

    /** the id holding this name key, if any */
    async idByName(name: string): Promise<string | null> {
      const rows = await db.query<{ id: string }>`select id from crew_skills where owner_id = ${OWNER} and name_key = ${nameKey(name)}`;
      return rows[0] ? String(rows[0].id) : null;
    },

    async insertOwner(s: OwnerSkillRow): Promise<void> {
      await db.query`insert into crew_skills (id, owner_id, name, name_key, summary, body, roles, kinds, enabled, version, created_at, updated_at)
        values (${s.id}, ${OWNER}, ${s.name}, ${nameKey(s.name)}, ${s.summary}, ${s.body}, ${s.roles ? toJson(s.roles) : null}, ${s.kinds ? toJson(s.kinds) : null},
          ${b01(s.enabled)}, ${s.version}, ${s.createdAt}, ${s.updatedAt})`;
    },

    async updateOwner(s: OwnerSkillRow): Promise<void> {
      await db.query`update crew_skills set name = ${s.name}, name_key = ${nameKey(s.name)}, summary = ${s.summary}, body = ${s.body},
          roles = ${s.roles ? toJson(s.roles) : null}, kinds = ${s.kinds ? toJson(s.kinds) : null}, enabled = ${b01(s.enabled)},
          version = ${s.version}, updated_at = ${s.updatedAt}
        where owner_id = ${OWNER} and id = ${s.id}`;
    },

    async deleteOwner(id: string): Promise<boolean> {
      const rows = await db.query`delete from crew_skills where owner_id = ${OWNER} and id = ${id} returning id`;
      return rows.length > 0;
    },

    /** built-in id -> enabled flag and when the owner last switched it */
    async builtinState(): Promise<Map<string, { enabled: boolean; updatedAt: number }>> {
      const rows = await db.query`select skill_id, enabled, updated_at from crew_skill_state where owner_id = ${OWNER}`;
      return new Map(rows.map((r) => [String(r.skill_id), { enabled: bool(r.enabled), updatedAt: num(r.updated_at) }]));
    },

    async setBuiltin(id: string, enabled: boolean, now: number): Promise<void> {
      await db.query`insert into crew_skill_state (owner_id, skill_id, enabled, updated_at) values (${OWNER}, ${id}, ${b01(enabled)}, ${now})
        on conflict (owner_id, skill_id) do update set enabled = excluded.enabled, updated_at = excluded.updated_at`;
    },
  };
}

export type CrewSkillsRepo = ReturnType<typeof createCrewSkillsRepo>;
