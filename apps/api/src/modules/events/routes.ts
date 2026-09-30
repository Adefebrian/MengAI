// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// GET /api/events: SSE stream. Query: runId (optional), after (seq).
// Last-Event-ID (sent by EventSource on reconnect) wins over `after`.
import { Hono } from "hono";
import { z } from "zod";
import { HttpError, parseQuery } from "../../lib/http";
import type { EventBus } from "./service";
import { createEventStream } from "./sse";

const query = z
  .object({
    runId: z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/).optional(),
    after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();

export interface EventsRouteOptions {
  heartbeatMs?: number;
  maxStreams?: number;
}

export function createEventsRoutes(bus: EventBus, opts: EventsRouteOptions = {}): Hono {
  const maxStreams = opts.maxStreams ?? 64;
  let open = 0;
  return new Hono().get("/", (c) => {
    const q = parseQuery(c, query);
    const lastEventId = c.req.header("last-event-id");
    let after: number | null = q.after ?? null;
    if (lastEventId !== undefined && lastEventId.trim() !== "") {
      if (!/^\d{1,15}$/.test(lastEventId.trim())) throw new HttpError(400, "invalid_last_event_id", "Last-Event-ID must be a sequence number");
      after = Number(lastEventId.trim());
    }
    if (open >= maxStreams) throw new HttpError(503, "too_many_streams", "Too many open event streams");
    open++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        open--;
      }
    };
    const stream = createEventStream({
      bus,
      runId: q.runId ?? null,
      after,
      signal: c.req.raw.signal,
      heartbeatMs: opts.heartbeatMs,
      onClose: release,
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });
}
