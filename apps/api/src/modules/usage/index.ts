// usage module: owns llm_calls, prices and cost math. Mounted at /api/usage.
import type { MountedModule, ModuleContext } from "../../core/module";
import { usageRoutes } from "./routes";
import { createUsageService, type UsageDeps, type UsageModuleService } from "./service";

export type { UsageDeps, UsageModuleService, UsageReportQuery } from "./service";

export function createUsageModule(ctx: ModuleContext, deps: UsageDeps): MountedModule & { service: UsageModuleService } {
  const service = createUsageService(ctx, deps);
  return { name: "usage", mountPath: "usage", routes: usageRoutes(service), service };
}
