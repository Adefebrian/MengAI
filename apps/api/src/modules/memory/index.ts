// memory module public API: mounted at /api/memory, service handed to the
// runs and tools modules through core/container.ts.
import type { MountedModule, ModuleContext } from "../../core/module";
import { memoryRoutes } from "./routes";
import { createMemoryService, type MemoryDeps, type MemoryModuleService } from "./service";

export type { MemoryDeps, MemoryModuleService, PromotionResult } from "./service";
export type { ApplyInput, MemoryBrain, OutcomeKind, ProposeInput, RoleOutcomeInput, StrategyProposal, StrategySubject } from "./brain";
export { BRAIN } from "./brain";

export function createMemoryModule(ctx: ModuleContext, deps: MemoryDeps): MountedModule & { service: MemoryModuleService } {
  const service = createMemoryService(ctx, deps);
  return { name: "memory", mountPath: "memory", routes: memoryRoutes(service), service };
}
