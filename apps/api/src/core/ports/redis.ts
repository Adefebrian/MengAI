// Port interface for the cache/keystore. Modules depend on this shape,
// never on `ioredis` directly. See core/adapters/redis.ts for the concrete
// adapter (which fails open, matching the rest of this codebase's stance on
// Redis being unavailable).
export interface CachePort {
  /** Increments the integer value at `key` and returns the new value. */
  incr(key: string): Promise<number>;
  /** Sets an expiry, in seconds, on `key`. */
  expire(key: string, seconds: number): Promise<void>;
  /** Reads the string value at `key`, or `null` if unset. */
  get(key: string): Promise<string | null>;
}
