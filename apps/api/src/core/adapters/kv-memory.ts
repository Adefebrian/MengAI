// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// In-memory Kv (local mode, and the server fallback when Redis is down).
// LRU by insertion order of a Map: every read or write moves the key to the
// end, the oldest key is evicted past maxEntries. TTLs are checked lazily on
// access plus a cheap sweep of a few old keys on every write.
import type { Kv } from "../ports/kv";

interface Entry {
  value: string;
  /** epoch ms, 0 = no expiry */
  expiresAt: number;
}

export interface MemoryKvOptions {
  maxEntries?: number;
  now?: () => number;
}

export interface MemoryKv extends Kv {
  readonly size: number;
  clear(): void;
}

export function createMemoryKv(opts: MemoryKvOptions = {}): MemoryKv {
  const maxEntries = Math.max(1, opts.maxEntries ?? 10_000);
  const now = opts.now ?? Date.now;
  const map = new Map<string, Entry>();

  const expiry = (ttlSec: number | undefined) => (ttlSec && ttlSec > 0 ? now() + ttlSec * 1000 : 0);

  function live(key: string): Entry | null {
    const e = map.get(key);
    if (!e) return null;
    if (e.expiresAt !== 0 && e.expiresAt <= now()) {
      map.delete(key);
      return null;
    }
    // touch: move to the most recently used end
    map.delete(key);
    map.set(key, e);
    return e;
  }

  function write(key: string, entry: Entry): void {
    map.delete(key);
    map.set(key, entry);
    sweep();
  }

  function sweep(): void {
    // drop a few expired keys from the old end, then enforce the size cap
    let checked = 0;
    const t = now();
    for (const [k, e] of map) {
      if (checked++ >= 8) break;
      if (e.expiresAt !== 0 && e.expiresAt <= t) map.delete(k);
    }
    while (map.size > maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  return {
    get size() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    async get(key) {
      return live(key)?.value ?? null;
    },
    async set(key, value, ttlSec) {
      write(key, { value, expiresAt: expiry(ttlSec) });
    },
    async del(key) {
      map.delete(key);
    },
    async incr(key, ttlSec) {
      const e = live(key);
      const current = e ? Number(e.value) : 0;
      if (!Number.isFinite(current)) throw new Error("kv incr on a non-numeric value");
      const next = current + 1;
      write(key, { value: String(next), expiresAt: e ? e.expiresAt : expiry(ttlSec) });
      return next;
    },
    async setNx(key, value, ttlSec) {
      if (live(key)) return false;
      write(key, { value, expiresAt: expiry(ttlSec) });
      return true;
    },
  };
}
