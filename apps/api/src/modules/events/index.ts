// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// events module: append-only event log, EventSink for every other module,
// SSE stream with Last-Event-ID replay. Public surface only.
import type { ModuleContext, MountedModule } from "../../core/module";
import { createEventsRepo } from "./repo";
import { createEventsRoutes, type EventsRouteOptions } from "./routes";
import { createEventBus, type EventBus } from "./service";

export type { EventBus, EventListener } from "./service";
export { formatSse } from "./sse";

/**
 * ctx.events is not used here (this module IS the sink): the container
 * creates this module first and puts `service` into ctx.events for the rest.
 */
export function createEventsModule(
  ctx: Pick<ModuleContext, "db" | "clock" | "logger">,
  deps: EventsRouteOptions = {},
): MountedModule & { service: EventBus } {
  const service = createEventBus(createEventsRepo(ctx.db), ctx.clock, ctx.logger);
  return { name: "events", mountPath: "events", routes: createEventsRoutes(service, deps), service };
}
