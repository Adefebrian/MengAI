// jev module: product decision catalog over the Judge port, decision log.
// Mounted at /api/decisions. The only public surface of this module.
import type { ModuleContext, MountedModule } from "../../core/module";
import { decisionRoutes } from "./routes";
import { createDecisionService, type JevDecisionService, type JevDeps } from "./service";

export type { JevDecisionService, JevDeps } from "./service";
export { UNVERIFIED_STAMP } from "./service";
export { CATALOG_IDS, type CatalogId } from "./catalog";

export function createJevModule(ctx: ModuleContext, deps: JevDeps): MountedModule & { service: JevDecisionService } {
  const service = createDecisionService(ctx, deps);
  return { name: "jev", mountPath: "decisions", routes: decisionRoutes(service), service };
}
