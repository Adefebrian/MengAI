// Concrete DbPort adapter, wrapping the lazily-constructed pg Pool in
// ../../lib/db. Importing this module never opens a socket; only an actual
// query does (see lib/db.ts), so it is always safe under `bun test`.
import { getDb } from "../../lib/db";
import type { DbPort } from "../ports/db";

export function createDbAdapter(): DbPort {
  return {
    async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await getDb().query(sql, params);
      return result.rows as T[];
    },
  };
}
