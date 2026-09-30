// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// users and sessions tables (this module only). Session tokens are stored as
// sha256 hex, never in the clear.
import { num } from "../../lib/sql";
import type { Db } from "../../core/ports/db";

export interface UserRow {
  id: string;
  email: string;
  passHash: string;
  createdAt: number;
}

export interface SessionRow {
  id: string;
  userId: string;
  email: string | null;
  expiresAt: number;
  lastSeenAt: number;
}

export function createAuthRepo(db: Db) {
  return {
    async countUsers(): Promise<number> {
      const rows = await db.query<{ n: unknown }>`select count(*) as n from users`;
      return num(rows[0]?.n);
    },
    async findUserByEmail(email: string): Promise<UserRow | null> {
      const rows = await db.query<{ id: string; email: string; pass_hash: string; created_at: unknown }>`
        select id, email, pass_hash, created_at from users where email = ${email}`;
      const r = rows[0];
      return r ? { id: r.id, email: r.email, passHash: r.pass_hash, createdAt: num(r.created_at) } : null;
    },
    async insertUser(u: UserRow): Promise<void> {
      await db.query`insert into users (id, email, pass_hash, created_at) values (${u.id}, ${u.email}, ${u.passHash}, ${u.createdAt})`;
    },
    async insertSession(s: { id: string; userId: string; tokenHash: string; createdAt: number; expiresAt: number }): Promise<void> {
      await db.query`
        insert into sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
        values (${s.id}, ${s.userId}, ${s.tokenHash}, ${s.createdAt}, ${s.expiresAt}, ${s.createdAt})`;
    },
    async findSession(tokenHash: string): Promise<SessionRow | null> {
      const rows = await db.query<{ id: string; user_id: string; email: string | null; expires_at: unknown; last_seen_at: unknown }>`
        select s.id, s.user_id, u.email, s.expires_at, s.last_seen_at
        from sessions s left join users u on u.id = s.user_id
        where s.token_hash = ${tokenHash}`;
      const r = rows[0];
      return r ? { id: r.id, userId: r.user_id, email: r.email ?? null, expiresAt: num(r.expires_at), lastSeenAt: num(r.last_seen_at) } : null;
    },
    async touchSession(id: string, now: number, expiresAt: number): Promise<void> {
      await db.query`update sessions set last_seen_at = ${now}, expires_at = ${expiresAt} where id = ${id}`;
    },
    async deleteSessionById(id: string): Promise<void> {
      await db.query`delete from sessions where id = ${id}`;
    },
    async deleteSessionByHash(tokenHash: string): Promise<void> {
      await db.query`delete from sessions where token_hash = ${tokenHash}`;
    },
    async deleteExpired(now: number): Promise<void> {
      await db.query`delete from sessions where expires_at <= ${now}`;
    },
  };
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
