// EventSink implementation plus in-process fan-out. publish() redacts the
// payload, appends it (seq from the insert) and then notifies subscribers.
// Publishes are serialized so subscribers always see seq in order.
import type { EventType, MengaiEvent } from "@mengai/shared";
import { redactDeep } from "../../lib/redact";
import type { Clock } from "../../core/ports/clock";
import type { EventInput, EventSink } from "../../core/ports/events";
import type { Logger } from "../../core/ports/logger";
import type { EventsRepo } from "./repo";

export type EventListener = (e: MengaiEvent) => void;

export interface EventBus extends EventSink {
  subscribe(listener: EventListener): () => void;
  /** events with seq > after (optionally one run), oldest first */
  after(seq: number, runId: string | null, limit: number): Promise<MengaiEvent[]>;
  lastSeq(): Promise<number>;
  subscribers(): number;
}

export function createEventBus(repo: EventsRepo, clock: Clock, logger: Logger): EventBus {
  const listeners = new Set<EventListener>();
  let chain: Promise<unknown> = Promise.resolve();

  async function write<T extends EventType>(e: EventInput<T>): Promise<MengaiEvent<T>> {
    const data = redactDeep(e.data);
    const ts = clock.now();
    const agentId = e.agentId ?? null;
    const taskId = e.taskId ?? null;
    const seq = await repo.append({ runId: e.runId, ts, type: e.type, agentId, taskId, data });
    const event: MengaiEvent<T> = { seq, ts, type: e.type, runId: e.runId, agentId, taskId, data };
    for (const listener of listeners) {
      try {
        listener(event as MengaiEvent);
      } catch (err) {
        logger.log("warn", "event listener failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }
    return event;
  }

  return {
    publish<T extends EventType>(e: EventInput<T>): Promise<MengaiEvent<T>> {
      const next = chain.then(() => write(e));
      chain = next.catch(() => undefined);
      return next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    after: (seq, runId, limit) => repo.after(seq, runId, limit),
    lastSeq: () => repo.lastSeq(),
    subscribers: () => listeners.size,
  };
}
