// Postgres pool, lazily constructed. `new Pool(...)` never opens a socket by
// itself, only `.connect()` / a query does, so importing this module (or
// importing something that imports it) is always safe with no Postgres
// running, e.g. under `bun test`.
import { Pool } from "pg";

let pool: Pool | undefined;

export function getDb(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? "postgres://user:password@localhost:5432/app",
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}
