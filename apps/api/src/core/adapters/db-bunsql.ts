// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Db port over Bun.SQL. The same tagged-template API serves SQLite (local
// mode, tests) and Postgres (server mode). Postgres returns int8 columns as
// strings: repos must read numbers through lib/sql num().
import { SQL } from "bun";
import type { Db, Dialect, Row } from "../ports/db";

type BunSql = InstanceType<typeof SQL>;

/** Splits SQL text on top-level semicolons, skipping quoted text and -- comments. */
export function splitStatements(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "-" && text[i + 1] === "-") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl;
      cur += "\n";
      continue;
    }
    if (ch === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function wrap(sql: BunSql, dialect: Dialect, root?: BunSql): Db {
  return {
    dialect,
    query<T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
      return sql(strings, ...values) as unknown as Promise<T[]>;
    },
    async tx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      // nested tx() calls reuse the outer transaction
      if (root) return fn(wrap(sql, dialect, root));
      return (sql as any).begin((tx: BunSql) => fn(wrap(tx, dialect, sql))) as Promise<T>;
    },
    async exec(text: string): Promise<void> {
      // Bun.SQL runs only the first statement of a multi-statement string
      // inside a transaction, so statements always run one by one.
      for (const stmt of splitStatements(text)) await sql.unsafe(stmt);
    },
    async close(): Promise<void> {
      if (!root) await sql.close();
    },
  };
}

export interface DbConfig {
  /** postgres://... or sqlite path (":memory:" for tests) */
  url: string;
  /** pool size for Postgres */
  max?: number;
}

export function createDb(config: DbConfig): Db {
  const isPg = /^postgres(ql)?:\/\//.test(config.url);
  if (isPg) {
    const sql = new SQL({ url: config.url, max: config.max ?? 10, idleTimeout: 30 });
    return wrap(sql, "postgres");
  }
  const filename = config.url.replace(/^sqlite:\/\//, "");
  const sql = new SQL({ adapter: "sqlite", filename } as any);
  const db = wrap(sql, "sqlite");
  if (filename !== ":memory:") {
    // WAL + busy timeout for a single-user desktop app with concurrent agents
    void db.exec("pragma journal_mode = wal; pragma busy_timeout = 5000; pragma foreign_keys = on;");
  }
  return db;
}
