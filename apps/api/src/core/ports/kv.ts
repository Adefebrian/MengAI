// Small key-value port: rate limits, response cache, short locks, dedupe.
// local mode = in-memory LRU, server mode = Redis (Bun RedisClient).
export interface Kv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Atomic increment; sets the TTL when the key is created. Returns the new value. */
  incr(key: string, ttlSec: number): Promise<number>;
  /** Set only if absent (lock). Returns true when this call created the key. */
  setNx(key: string, value: string, ttlSec: number): Promise<boolean>;
}
