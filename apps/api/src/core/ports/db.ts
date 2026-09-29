// Port interface for the relational database. Modules depend on this shape,
// never on `pg` directly. See core/adapters/db.ts for the concrete adapter.
export interface DbPort {
  /** Runs a parameterized query and returns the result rows. */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}
