// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Relational database port. One tagged-template API for both dialects
// (Bun.SQL speaks SQLite locally and Postgres on the server). Modules write
// portable SQL: TEXT ids, BIGINT epoch-ms timestamps, JSON stored as TEXT,
// booleans as INTEGER 0/1, `insert ... on conflict ... do update`, `returning`.
// Never interpolate strings into SQL: every ${value} is a bound parameter.
export type Dialect = "sqlite" | "postgres";

export type Row = Record<string, unknown>;

export interface Db {
  readonly dialect: Dialect;
  /** Parameterized query: db.query`select * from runs where id = ${id}` */
  query<T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  /** Runs fn inside one transaction; rolls back on throw. */
  tx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  /** Raw DDL/migration text, no parameters. Only tools/migrate and tests use this. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}
