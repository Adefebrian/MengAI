// Redis client, lazily constructed. Nothing here connects at import time:
// `new Redis(...)` with `lazyConnect: true` only opens a socket on the first
// command, and every call site that actually issues a command swallows
// connection errors so a missing/unreachable Redis never crashes a request,
// it only disables the feature that needed it (rate limiting fails open).
import Redis from "ioredis";

let client: Redis | undefined;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // never keep retrying in the background
    });
    client.on("error", () => {
      // Swallow: callers already handle rejected commands. This listener
      // only exists so an unhandled 'error' event does not crash the process.
    });
  }
  return client;
}

/**
 * Fixed-window rate limiter backed by Redis. Returns `{ allowed, remaining }`.
 * Fails open (allowed: true) if Redis is unavailable, never blocks traffic
 * because the cache is down and never throws.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch {
    return { allowed: true, remaining: limit };
  }
}
