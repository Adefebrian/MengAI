#!/usr/bin/env bun
// tools/migrate.ts - minimal SQL migration runner for Postgres.
//
// Migrations live in migrations/*.sql, one file per migration, named
// NNNN_description.sql so lexicographic order is chronological order
// (see migrations/0001_init.sql). Each file has an "up" section and an
// optional "down" section, marked by a line that is exactly "-- up" or
// "-- down" (case-insensitive, leading/trailing whitespace ignored), e.g.:
//
//   -- up
//   CREATE TABLE ...;
//
//   -- down
//   DROP TABLE ...;
//
// The "up" section runs on `migrate up`; the "down" section runs on
// `migrate down`. A file with no "-- down" section has no rollback, and
// `migrate down` refuses to touch it rather than silently no-op.
//
// Applied migrations are tracked in a `_migrations` table (created on first
// use), keyed by filename minus extension, so a migration never runs twice
// and `down` always knows exactly what to undo, in reverse order.
//
// Nothing here opens a database connection at import time: `getPool()` is
// only ever called from inside a command handler, once a command has
// already been chosen. This file is safe to import from anywhere (e.g. a
// future unit test for `parseMigrationFile`) with no live Postgres running.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations");

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? "postgres://user:password@localhost:5432/app",
    });
  }
  return pool;
}

export interface Migration {
  /** Filename minus the ".sql" extension, e.g. "0001_init". Primary key in `_migrations`. */
  id: string;
  file: string;
  up: string;
  down: string | null;
}

const UP_MARKER = /^--\s*up\s*$/im;
const DOWN_MARKER = /^--\s*down\s*$/im;

export function parseMigrationFile(file: string, contents: string): Migration {
  const upMatch = UP_MARKER.exec(contents);
  if (!upMatch) {
    throw new Error(`${file}: missing "-- up" marker`);
  }
  const downMatch = DOWN_MARKER.exec(contents);

  const upStart = upMatch.index + upMatch[0].length;
  const upEnd = downMatch ? downMatch.index : contents.length;
  const up = contents.slice(upStart, upEnd).trim();

  const downText = downMatch ? contents.slice(downMatch.index + downMatch[0].length).trim() : "";

  return {
    id: file.replace(/\.sql$/, ""),
    file,
    up,
    down: downText.length > 0 ? downText : null,
  };
}

async function loadMigrations(): Promise<Migration[]> {
  const entries = await readdir(MIGRATIONS_DIR).catch(() => [] as string[]);
  const files = entries.filter((name) => name.endsWith(".sql")).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const contents = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    migrations.push(parseMigrationFile(file, contents));
  }
  return migrations;
}

async function ensureMigrationsTable(db: Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedIds(db: Pool): Promise<Set<string>> {
  const result = await db.query<{ id: string }>("SELECT id FROM _migrations");
  return new Set(result.rows.map((row) => row.id));
}

async function up(): Promise<void> {
  const db = getPool();
  await ensureMigrationsTable(db);
  const applied = await getAppliedIds(db);
  const migrations = await loadMigrations();
  const pending = migrations.filter((m) => !applied.has(m.id));

  if (pending.length === 0) {
    console.log("No pending migrations.");
    return;
  }

  for (const migration of pending) {
    console.log(`Applying ${migration.file}...`);
    await db.query("BEGIN");
    try {
      await db.query(migration.up);
      await db.query("INSERT INTO _migrations (id) VALUES ($1)", [migration.id]);
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  }
  console.log(`Applied ${pending.length} migration(s).`);
}

async function down(): Promise<void> {
  const db = getPool();
  await ensureMigrationsTable(db);
  const applied = await getAppliedIds(db);
  const migrations = await loadMigrations();

  const appliedMigrations = migrations
    .filter((m) => applied.has(m.id))
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const last = appliedMigrations[0];

  if (!last) {
    console.log("No applied migrations to roll back.");
    return;
  }
  if (!last.down) {
    throw new Error(`${last.file} has no "-- down" section; cannot roll back.`);
  }

  console.log(`Rolling back ${last.file}...`);
  await db.query("BEGIN");
  try {
    await db.query(last.down);
    await db.query("DELETE FROM _migrations WHERE id = $1", [last.id]);
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
  console.log(`Rolled back ${last.file}.`);
}

async function create(name: string): Promise<void> {
  if (!name) {
    throw new Error("Usage: bun tools/migrate.ts create <name>");
  }
  const existing = await readdir(MIGRATIONS_DIR).catch(() => [] as string[]);
  const numbers = existing
    .map((file) => file.match(/^(\d+)_/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => Number(match[1]));
  const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const id = `${String(next).padStart(4, "0")}_${slug || "migration"}`;
  const file = join(MIGRATIONS_DIR, `${id}.sql`);

  await writeFile(file, "-- up\n\n\n-- down\n\n", { flag: "wx" });
  console.log(`Created ${file}`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "up":
      await up();
      break;
    case "down":
      await down();
      break;
    case "create":
      await create(rest[0] ?? "");
      break;
    default:
      console.error("Usage: bun tools/migrate.ts <up|down|create <name>>");
      process.exit(1);
      return;
  }

  await pool?.end();
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
