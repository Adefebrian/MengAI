// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The island's live feed. At boot: the run list (GET /api/runs), a
// snapshot of each live run (GET /api/runs/:id, newest first), the orders
// (GET /api/trading/orders) and the owner's motion setting. Then one
// stream for all runs (GET /api/events without runId), opened after the
// oldest snapshot so nothing between a snapshot and the stream is lost;
// the browser resumes a dropped stream with Last-Event-ID on its own, and
// when it gives up the island reopens it with after=<last seq>, backing
// off up to 30 s, after reading the run list again. A run that goes live
// later arrives as run.created or run.status and loads its snapshot.
// Nothing polls faster than the stream, except a light refresh of the
// orders every 20 s. Every event the feed reduces reaches `onEvent` with the
// island before and after it, for the moments (useIslandMoments); the
// preview's scenarios push their events through the same `apply`.
import { SSE_EVENT_NAME, type MengaiEvent, type OwnerSettings } from "@mengai/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { EventSourceLike } from "../store/runStore";
import { applyEvent, emptyLive, withOrders, withRunList, withSnapshot, type Applied, type IslandLive } from "./live";

export const ORDERS_REFRESH_MS = 20_000;
const CLOSED = 2;

export type LiveConnection = "connecting" | "live" | "offline";

export interface IslandFeed {
  live: IslandLive;
  connection: LiveConnection;
  /** the owner's motion setting: "off" makes the island instant and the cats still */
  motion: OwnerSettings["motion"];
  update(fn: (live: IslandLive) => IslandLive): void;
  /** reduce one event of the stream (the preview's scenarios push theirs here too) */
  apply(e: MengaiEvent): Applied;
  /** read the orders again now (after a decision) */
  refreshOrders(): void;
}

/** One reduced event, with the island before and after it. */
export type EventSink = (before: IslandLive, e: MengaiEvent, after: IslandLive) => void;

export interface FeedOptions {
  /** null keeps the feed idle (the preview with sample data) */
  api: ApiClient | null;
  /** island clock, for a fresh finish */
  now?: () => number;
  ordersEveryMs?: number;
  initial?: IslandLive;
  /** every event the feed reduces, for the moments */
  onEvent?: EventSink;
}

export function useIslandLive({ api, now = Date.now, ordersEveryMs = ORDERS_REFRESH_MS, initial, onEvent }: FeedOptions): IslandFeed {
  const [live, setLive] = useState<IslandLive>(() => initial ?? emptyLive());
  const [connection, setConnection] = useState<LiveConnection>(api ? "connecting" : "offline");
  const [motion, setMotion] = useState<OwnerSettings["motion"]>("full");
  const ref = useRef(live);
  const ordersRef = useRef<() => void>(() => {});
  const nowRef = useRef(now);
  nowRef.current = now;
  const sinkRef = useRef(onEvent);
  sinkRef.current = onEvent;

  const update = useCallback((fn: (l: IslandLive) => IslandLive) => {
    const next = fn(ref.current);
    if (next === ref.current) return;
    ref.current = next;
    setLive(next);
  }, []);

  const apply = useCallback(
    (e: MengaiEvent) => {
      const before = ref.current;
      const r = applyEvent(before, e, nowRef.current());
      update(() => r.live);
      sinkRef.current?.(before, e, r.live);
      return r;
    },
    [update],
  );

  // A fixture handed in later (the preview switching states) replaces the picture.
  useEffect(() => {
    if (!initial) return;
    ref.current = initial;
    setLive(initial);
  }, [initial]);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    const ctrl = new AbortController();
    const signal = ctrl.signal;
    let source: EventSourceLike | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const loading = new Set<string>();

    const loadSnapshot = async (id: string) => {
      if (loading.has(id)) return;
      loading.add(id);
      try {
        const snap = await api.call("GET /api/runs/:id", { params: { id }, signal });
        if (alive) update((l) => withSnapshot(l, snap));
      } catch {
        // the run is gone or the engine is away: the stream or the next list read catches up
      } finally {
        loading.delete(id);
      }
    };

    const loadRuns = async () => {
      const list = await api.call("GET /api/runs", { signal });
      if (!alive) return;
      const r = withRunList(ref.current, list);
      update(() => r.live);
      await Promise.all(r.missing.map(loadSnapshot));
    };

    const loadOrders = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        const list = await api.call("GET /api/trading/orders", { signal });
        if (alive) update((l) => withOrders(l, list));
      } catch {
        // trading may be off on this engine: no orders wait then
      }
    };
    ordersRef.current = () => void loadOrders();

    const open = () => {
      if (!alive) return;
      const after = ref.current.lastSeq;
      const es = api.stream(api.url("GET /api/events", { query: after > 0 ? { after } : {} }));
      source = es;
      es.onopen = () => {
        attempts = 0;
        if (alive) setConnection("live");
      };
      es.addEventListener(SSE_EVENT_NAME, (msg: MessageEvent) => {
        let e: MengaiEvent;
        try {
          e = JSON.parse(String(msg.data)) as MengaiEvent;
        } catch {
          return;
        }
        if (typeof e.seq !== "number" || typeof e.type !== "string") return;
        const r = apply(e);
        if (r.fetch) void loadSnapshot(r.fetch);
      });
      es.onerror = () => {
        if (!alive || es.readyState !== CLOSED) return;
        es.close();
        attempts += 1;
        setConnection("offline");
        retry = setTimeout(
          () => {
            void loadRuns()
              .catch(() => {})
              .finally(open);
          },
          Math.min(30_000, 2000 * 2 ** Math.min(attempts - 1, 4)),
        );
      };
    };

    void (async () => {
      try {
        await loadRuns();
      } catch {
        if (alive) setConnection("offline");
      }
      if (!alive) return;
      // Start after the oldest snapshot: each run skips what it already holds.
      if (ref.current.lastSeq === 0) {
        const seqs = Object.values(ref.current.runs).map((s) => s.lastSeq);
        if (seqs.length) update((l) => ({ ...l, lastSeq: Math.min(...seqs) }));
      }
      void loadOrders();
      api.call("GET /api/settings", { signal }).then(
        (s) => {
          if (alive && (s.motion === "full" || s.motion === "calm" || s.motion === "off")) setMotion(s.motion);
        },
        () => {},
      );
      open();
    })();

    const timer = setInterval(() => void loadOrders(), ordersEveryMs);
    return () => {
      alive = false;
      ctrl.abort();
      clearInterval(timer);
      if (retry) clearTimeout(retry);
      source?.close();
      ordersRef.current = () => {};
    };
  }, [api, ordersEveryMs, update, apply]);

  const refreshOrders = useCallback(() => ordersRef.current(), []);
  return { live, connection, motion, update, apply, refreshOrders };
}
