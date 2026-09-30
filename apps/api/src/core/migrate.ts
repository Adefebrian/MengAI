// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Applies migrations/<dialect>/*.sql in order, once each, recorded in
// schema_migrations. Used by the server entry, the desktop entry and tests.
//
// The SQL is embedded at build time (Bun text imports), so a binary built
// with `bun build --compile` migrates with no folder on disk. A folder passed
// explicitly (MENGAI_MIGRATIONS_DIR) overrides the embedded set.
// Adding a migration: drop the .sql file in both dialect folders and add it
// to EMBEDDED_MIGRATIONS below; container.test.ts fails when the two drift.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db, Dialect } from "./ports/db";
// @ts-ignore Bun text import: there are no type declarations for .sql files
import postgres0001 from "../../../../migrations/postgres/0001_init.sql" with { type: "text" };
// @ts-ignore Bun text import: there are no type declarations for .sql files
import sqlite0001 from "../../../../migrations/sqlite/0001_init.sql" with { type: "text" };
// @ts-ignore Bun text import: there are no type declarations for .sql files
import postgres0002 from "../../../../migrations/postgres/0002_brain.sql" with { type: "text" };
// @ts-ignore Bun text import: there are no type declarations for .sql files
import sqlite0002 from "../../../../migrations/sqlite/0002_brain.sql" with { type: "text" };
// @ts-ignore Bun text import: there are no type declarations for .sql files
import postgres0003 from "../../../../migrations/postgres/0003_capabilities.sql" with { type: "text" };
// @ts-ignore Bun text import: there are no type declarations for .sql files
import sqlite0003 from "../../../../migrations/sqlite/0003_capabilities.sql" with { type: "text" };
// @ts-ignore Bun text import: there are no type declarations for .sql files
import postgres0005 from "../../../../migrations/postgres/0005_trading_venues.sql" with { type: "text" };
// @ts-ignore Bun text import: there are no type declarations for .sql files
import sqlite0005 from "../../../../migrations/sqlite/0005_trading_venues.sql" with { type: "text" };

/** Repo migrations folder (dev and server image); inside a compiled binary this path does not exist. */
export const MIGRATIONS_ROOT = (() => {
  const url = new URL("../../../../migrations/", import.meta.url);
  // fileURLToPath, so a Windows path is C:\... and not /C:/...; a non-file URL keeps its path
  try {
    return fileURLToPath(url);
  } catch {
    return url.pathname;
  }
})();

export interface Migration {
  /** file name, the version recorded in schema_migrations */
  version: string;
  sql: string;
}

export const EMBEDDED_MIGRATIONS: Readonly<Record<Dialect, readonly Migration[]>> = {
  sqlite: [
    { version: "0001_init.sql", sql: sqlite0001 as string },
    { version: "0002_brain.sql", sql: sqlite0002 as string },
    { version: "0003_capabilities.sql", sql: sqlite0003 as string },
    { version: "0005_trading_venues.sql", sql: sqlite0005 as string },
  ],
  postgres: [
    { version: "0001_init.sql", sql: postgres0001 as string },
    { version: "0002_brain.sql", sql: postgres0002 as string },
    { version: "0003_capabilities.sql", sql: postgres0003 as string },
    { version: "0005_trading_venues.sql", sql: postgres0005 as string },
  ],
};

/** Migrations for a dialect: from `root/<dialect>/*.sql` when root is given, else the embedded set. */
export async function loadMigrations(dialect: Dialect, root?: string | null): Promise<Migration[]> {
  if (!root) return [...EMBEDDED_MIGRATIONS[dialect]].sort((a, b) => (a.version < b.version ? -1 : 1));
  const dir = join(root, dialect);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    throw new Error(`migrations folder not found for ${dialect} at ${dir} (check MENGAI_MIGRATIONS_DIR)`);
  }
  if (names.length === 0) throw new Error(`no .sql migrations for ${dialect} in ${dir}`);
  return Promise.all(names.map(async (version) => ({ version, sql: await Bun.file(join(dir, version)).text() })));
}

/** Applies what is not recorded yet and returns the versions applied now. root: see loadMigrations. */
export async function applyMigrations(db: Db, root?: string | null): Promise<string[]> {
  const migrations = await loadMigrations(db.dialect, root);
  await db.exec("create table if not exists schema_migrations (version text primary key, applied_at bigint not null)");
  const done = new Set((await db.query<{ version: string }>`select version from schema_migrations`).map((r) => r.version));
  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.version)) continue;
    await db.tx(async (tx) => {
      await tx.exec(m.sql);
      await tx.query`insert into schema_migrations (version, applied_at) values (${m.version}, ${Date.now()})`;
    });
    applied.push(m.version);
  }
  return applied;
}
