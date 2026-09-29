// health module: GET /api/health from injected probes. Public surface only.
import type { ModuleContext, MountedModule } from "../../core/module";
import { createHealthRoutes } from "./routes";
import { createHealthService, type HealthDeps, type HealthService } from "./service";

export type { HealthDeps, HealthService } from "./service";

export function createHealthModule(ctx: Pick<ModuleContext, "config" | "logger">, deps: HealthDeps): MountedModule & { service: HealthService } {
  const service = createHealthService(ctx.config, deps, ctx.logger);
  return { name: "health", mountPath: "health", routes: createHealthRoutes(service), service };
}
