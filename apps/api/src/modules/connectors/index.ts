// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// connectors module: the owner's MCP servers (stdio in the Mac app,
// streamable HTTP anywhere) and HTTP APIs (optional OpenAPI 3 import), their
// namespaced tools and the calls into them. Mounted at /api/connectors; the
// kill switch kills every MCP server process. The only public export.
import type { ModuleContext, MountedModule } from "../../core/module";
import type { KillSwitch } from "../../core/services";
import type { ConnectorsService } from "./ports";
import { createConnectorsRoutes } from "./routes";
import { createConnectorsService, type ConnectorsOptions } from "./service";

export type { ConnectorCallResult, ConnectorsService, ConnectorToolDef, HttpOperation, SpawnedProcess, Spawner } from "./ports";
export type { ConnectorsOptions } from "./service";
export { CONNECTOR_LIMITS } from "./service";
export { classify, namespaced, needsApproval } from "./risk";

export interface ConnectorsDeps {
  killswitch?: KillSwitch;
}

export function createConnectorsModule(ctx: ModuleContext, deps: ConnectorsDeps = {}, opts: ConnectorsOptions = {}): MountedModule & { service: ConnectorsService } {
  const service = createConnectorsService(ctx, opts);
  deps.killswitch?.register("connectors", () => service.killAll());
  return {
    name: "connectors",
    mountPath: "connectors",
    routes: createConnectorsRoutes(service, { kv: ctx.kv }),
    service,
    close: () => service.close(),
  };
}
