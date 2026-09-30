// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Shared test kit for every module: an in-memory SQLite Db with the real
// migrations applied, a deterministic clock, and in-memory fakes for the
// kv, vault, event sink and logger ports. Import from "../../testing".
// testPlatform() pins the platform features (lib/platform.ts), so a test
// that boots the container behaves the same on the macOS and Linux CI.
import type { EventType, MengaiEvent } from "@mengai/shared";
import { createDb } from "../core/adapters/db-bunsql";
import { applyMigrations } from "../core/migrate";
import type { Clock } from "../core/ports/clock";
import type { Db } from "../core/ports/db";
import type { EventInput, EventSink } from "../core/ports/events";
import type { Kv } from "../core/ports/kv";
import type { Logger } from "../core/ports/logger";
import type { Vault } from "../core/ports/vault";
import { detectPlatform, type PlatformInfo } from "../lib/platform";

/** darwin with a working sandbox (every feature on) unless another platform is named; the sandbox probe never runs */
export function testPlatform(platform: NodeJS.Platform = "darwin", sandbox: string | null = null): PlatformInfo {
  return detectPlatform({ platform, sandboxUnavailable: () => sandbox });
}

export async function createTestDb(): Promise<Db> {
  const db = createDb({ url: ":memory:" });
  await applyMigrations(db);
  return db;
}

export function fakeClock(start = 1_760_000_000_000): Clock & { advance(ms: number): void } {
  let t = start;
  let n = 0;
  return {
    now: () => t,
    id: () => {
      n++;
      const hex = n.toString(16).padStart(12, "0");
      return `0192f0aa-0000-7000-8000-${hex}`;
    },
    advance(ms: number) {
      t += ms;
    },
  };
}

export function memoryKv(): Kv {
  const m = new Map<string, { v: string; exp: number }>();
  const live = (k: string) => {
    const e = m.get(k);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) {
      m.delete(k);
      return null;
    }
    return e;
  };
  return {
    async get(k) {
      return live(k)?.v ?? null;
    },
    async set(k, v, ttl) {
      m.set(k, { v, exp: ttl ? Date.now() + ttl * 1000 : 0 });
    },
    async del(k) {
      m.delete(k);
    },
    async incr(k, ttl) {
      const e = live(k);
      const next = (e ? Number(e.v) : 0) + 1;
      m.set(k, { v: String(next), exp: e?.exp || Date.now() + ttl * 1000 });
      return next;
    },
    async setNx(k, v, ttl) {
      if (live(k)) return false;
      m.set(k, { v, exp: Date.now() + ttl * 1000 });
      return true;
    },
  };
}

export function memoryVault(): Vault & { dump(): Map<string, string> } {
  const m = new Map<string, string>();
  return {
    kind: "memory",
    async set(ref, s) {
      m.set(ref, s);
    },
    async get(ref) {
      return m.get(ref) ?? null;
    },
    async delete(ref) {
      m.delete(ref);
    },
    async has(ref) {
      return m.has(ref);
    },
    dump: () => m,
  };
}

export function captureEvents(clock: Clock = fakeClock()): EventSink & { events: MengaiEvent[]; ofType<T extends EventType>(t: T): MengaiEvent<T>[] } {
  const events: MengaiEvent[] = [];
  let seq = 0;
  return {
    events,
    async publish<T extends EventType>(e: EventInput<T>): Promise<MengaiEvent<T>> {
      const ev: MengaiEvent<T> = {
        seq: ++seq,
        ts: clock.now(),
        type: e.type,
        runId: e.runId,
        agentId: e.agentId ?? null,
        taskId: e.taskId ?? null,
        data: e.data,
      };
      events.push(ev as MengaiEvent);
      return ev;
    },
    ofType<T extends EventType>(t: T) {
      return events.filter((x) => x.type === t) as MengaiEvent<T>[];
    },
  };
}

export const silentLogger: Logger = {
  log() {},
  child() {
    return silentLogger;
  },
};
