// Server-sent events transport for GET /api/events. Subscribes first and
// buffers live events while the table replay runs, so nothing is lost or
// duplicated between replay and live (dedupe by seq). A heartbeat comment
// keeps proxies and Bun's idle timeout from closing the stream. Slow clients
// are cut off once their queue grows past a cap; EventSource reconnects with
// Last-Event-ID and the replay fills the gap from the table.
import { SSE_EVENT_NAME, SSE_HEARTBEAT_MS, type MengaiEvent } from "@mengai/shared";
import type { EventBus } from "./service";

export interface EventStreamOptions {
  bus: EventBus;
  runId: string | null;
  /** replay events with seq > after; null = live only */
  after: number | null;
  signal?: AbortSignal;
  heartbeatMs?: number;
  replayBatch?: number;
  /** close after this many replayed events; the client resumes with Last-Event-ID */
  replayCap?: number;
  /** close when this many chunks are queued and unread */
  maxQueued?: number;
  onClose?: () => void;
}

const encoder = new TextEncoder();

export function formatSse(e: MengaiEvent): string {
  return `id: ${e.seq}\nevent: ${SSE_EVENT_NAME}\ndata: ${JSON.stringify(e)}\n\n`;
}

export function createEventStream(opts: EventStreamOptions): ReadableStream<Uint8Array> {
  const heartbeatMs = opts.heartbeatMs ?? SSE_HEARTBEAT_MS;
  const batch = opts.replayBatch ?? 500;
  const replayCap = opts.replayCap ?? 5000;
  const maxQueued = opts.maxQueued ?? 1000;
  let cleanup = () => {};

  return new ReadableStream<Uint8Array>(
    {
      async start(controller) {
        let closed = false;
        let replaying = true;
        let lastSeq = opts.after ?? 0;
        const buffered: MengaiEvent[] = [];
        const matches = (e: MengaiEvent) => !opts.runId || e.runId === opts.runId;

        const close = () => {
          if (closed) return;
          cleanup();
          try {
            controller.close();
          } catch {
            // already closed or errored
          }
        };

        const push = (text: string) => {
          if (closed) return;
          if ((controller.desiredSize ?? 0) <= -maxQueued) return close();
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            cleanup();
          }
        };

        const send = (e: MengaiEvent) => {
          if (e.seq <= lastSeq) return;
          lastSeq = e.seq;
          push(formatSse(e));
        };

        const unsubscribe = opts.bus.subscribe((e) => {
          if (closed || !matches(e)) return;
          if (replaying) buffered.push(e);
          else send(e);
        });
        const heartbeat = setInterval(() => push(": ping\n\n"), heartbeatMs);
        const onAbort = () => close();

        cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
          opts.signal?.removeEventListener("abort", onAbort);
          opts.onClose?.();
        };

        if (opts.signal?.aborted) return close();
        opts.signal?.addEventListener("abort", onAbort, { once: true });

        push("retry: 2000\n: connected\n\n");

        if (opts.after !== null) {
          try {
            let replayed = 0;
            while (!closed) {
              const rows = await opts.bus.after(lastSeq, opts.runId, batch);
              for (const e of rows) send(e);
              replayed += rows.length;
              if (rows.length < batch) break;
              if (replayed >= replayCap) return close();
            }
          } catch {
            return close();
          }
        }

        replaying = false;
        for (const e of buffered.splice(0)) send(e);
      },
      cancel() {
        cleanup();
      },
    },
    { highWaterMark: 1 },
  );
}
