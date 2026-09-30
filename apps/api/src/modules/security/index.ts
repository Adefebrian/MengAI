// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Public surface of the security module: the factory and its types only.
import type { ModuleContext, MountedModule } from "../../core/module";
import { securityRoutes } from "./routes";
import { createSecurityService, type SecurityDeps, type SecurityModuleService } from "./service";

export type { SecurityDeps, SecurityModuleService } from "./service";

export function createSecurityModule(ctx: ModuleContext, deps: SecurityDeps): MountedModule & { service: SecurityModuleService } {
  const service = createSecurityService(ctx, deps);
  return {
    name: "security",
    mountPath: "security",
    routes: securityRoutes(service, { kv: ctx.kv }),
    service,
    close: () => service.close(),
  };
}
