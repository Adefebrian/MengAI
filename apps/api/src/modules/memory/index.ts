// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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
