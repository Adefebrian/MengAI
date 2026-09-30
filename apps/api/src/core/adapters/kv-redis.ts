// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Redis Kv over Bun's built-in RedisClient (server mode). Every key is
// prefixed so one Redis can be shared. incr sets the TTL atomically in the
// same round trip through a tiny Lua script.
import { RedisClient } from "bun";
import type { Kv } from "../ports/kv";
import type { Logger } from "../ports/logger";

const INCR_WITH_TTL = "local v = redis.call('INCR', KEYS[1]) if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return v";

export interface RedisKv extends Kv {
  close(): void;
}

export function createRedisKv(client: RedisClient, prefix = "mengai:"): RedisKv {
  const k = (key: string) => prefix + key;
  return {
    async get(key) {
      const v = await client.get(k(key));
      return v ?? null;
    },
    async set(key, value, ttlSec) {
      if (ttlSec && ttlSec > 0) await client.send("SET", [k(key), value, "EX", String(Math.ceil(ttlSec))]);
      else await client.send("SET", [k(key), value]);
    },
    async del(key) {
      await client.send("DEL", [k(key)]);
    },
    async incr(key, ttlSec) {
      const v = await client.send("EVAL", [INCR_WITH_TTL, "1", k(key), String(Math.max(1, Math.ceil(ttlSec)))]);
      return Number(v);
    },
    async setNx(key, value, ttlSec) {
      const r = await client.send("SET", [k(key), value, "EX", String(Math.max(1, Math.ceil(ttlSec))), "NX"]);
      return r === "OK";
    },
    close() {
      client.close();
    },
  };
}

/**
 * Connects and pings once. Returns null (after a warning) when Redis is not
 * reachable so the caller can fall back to the in-memory kv. The URL is never
 * logged (it can carry a password).
 */
export async function connectRedisKv(url: string, logger: Logger, timeoutMs = 3000): Promise<RedisKv | null> {
  const client = new RedisClient(url, {
    connectionTimeout: timeoutMs,
    autoReconnect: true,
    enableOfflineQueue: false,
    maxRetries: 10,
  });
  try {
    await Promise.race([
      (async () => {
        await client.connect();
        await client.send("PING", []);
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("redis connect timeout")), timeoutMs)),
    ]);
    return createRedisKv(client);
  } catch (err) {
    logger.log("warn", "redis unavailable, using the in-memory kv (rate limits are per process)", {
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      client.close();
    } catch {
      // already closed
    }
    return null;
  }
}
