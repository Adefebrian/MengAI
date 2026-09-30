// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Event sink port. The events module implements it (append to the events
// table, then fan out to SSE subscribers). Every other module publishes
// through this port, so no module imports the events module directly.
import type { EventMap, EventType, MengaiEvent } from "@mengai/shared";

export interface EventInput<T extends EventType = EventType> {
  type: T;
  runId: string | null;
  agentId?: string | null;
  taskId?: string | null;
  data: EventMap[T];
}

export interface EventSink {
  publish<T extends EventType>(e: EventInput<T>): Promise<MengaiEvent<T>>;
}
