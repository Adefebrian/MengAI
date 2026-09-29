// Concrete CachePort adapter, wrapping the lazily-constructed ioredis client
// in ../../lib/redis. Importing this module never opens a socket. Every
// method fails open (returns a safe default instead of throwing) so a
// missing/unreachable Redis degrades the feature using it, never crashes
// the request, consistent with the rate limiter in core/hardening.ts.
import { getRedis } from "../../lib/redis";
import type { CachePort } from "../ports/redis";

export function createRedisCacheAdapter(): CachePort {
  return {
    async incr(key: string): Promise<number> {
      try {
        return await getRedis().incr(key);
      } catch {
        return 0;
      }
    },
    async expire(key: string, seconds: number): Promise<void> {
      try {
        await getRedis().expire(key, seconds);
      } catch {
        // Fail open: expiry is best-effort.
      }
    },
    async get(key: string): Promise<string | null> {
      try {
        return await getRedis().get(key);
      } catch {
        return null;
      }
    },
  };
}
