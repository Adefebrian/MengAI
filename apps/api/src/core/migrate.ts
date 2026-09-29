// Applies migrations/<dialect>/*.sql in order, once each, recorded in
// schema_migrations. Used by the server entry, the desktop entry and tests.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "./ports/db";

export const MIGRATIONS_ROOT = new URL("../../../../migrations/", import.meta.url).pathname;

export async function applyMigrations(db: Db, root: string = MIGRATIONS_ROOT): Promise<string[]> {
  await db.exec("create table if not exists schema_migrations (version text primary key, applied_at bigint not null)");
  const dir = join(root, db.dialect);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await db.query<{ version: string }>`select version from schema_migrations`).map((r) => r.version));
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const text = await Bun.file(join(dir, file)).text();
    await db.tx(async (tx) => {
      await tx.exec(text);
      await tx.query`insert into schema_migrations (version, applied_at) values (${file}, ${Date.now()})`;
    });
    applied.push(file);
  }
  return applied;
}
