// runs module: the orchestrator. Mounted at /api/runs; stopAll is registered
// on the kill switch. The only public export of this module.
import type { ModuleContext, MountedModule } from "../../core/module";
import type { RunsDeps } from "./ports";
import { createRunsRoutes } from "./routes";
import { createRunsService, type RunsServiceImpl } from "./service";

export type { RunsDeps, MemoryPromotion, CompanyPace, BrainMemory, BrainOptions, JudgeHint, StrategySubject } from "./ports";
export { BRAIN_DEFAULTS } from "./ports";
export { ORG } from "./org";
export { CEO_SYSTEM, packetQuestion } from "./company";
export { EvidenceLog, REFLEXION, REFLEXION_SYSTEM, StepBudget, parseReflexion, precheck, reflexionPacket } from "./brain";
export type { Evidence, Verdict } from "./brain";
export { ROLE_GEN, ROLE_HEADER_RE, ROLE_SYSTEM, rolePacket } from "./roles";
export { BRAIN_DECISIONS, UNVERIFIED } from "./judge";
export type { OrgSettings } from "./engine";
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
