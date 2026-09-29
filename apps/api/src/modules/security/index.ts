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
