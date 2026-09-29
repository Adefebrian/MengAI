// runs module: the orchestrator. Mounted at /api/runs; stopAll is registered
// on the kill switch. The only public export of this module.
import type { ModuleContext, MountedModule } from "../../core/module";
import type { RunsDeps } from "./ports";
import { createRunsRoutes } from "./routes";
import { createRunsService, type RunsServiceImpl } from "./service";

export type { RunsDeps, MemoryPromotion } from "./ports";
export type { RunsServiceImpl } from "./service";

export function createRunsModule(ctx: ModuleContext, deps: RunsDeps): MountedModule & { service: RunsServiceImpl; ready: Promise<void> } {
  const service = createRunsService(ctx, deps);
  deps.killswitch.register("runs", () => service.stopAll("killswitch"));
  return {
    name: "runs",
    mountPath: "runs",
    routes: createRunsRoutes(service),
    service,
    ready: service.ready,
    close: () => service.close(),
  };
}
