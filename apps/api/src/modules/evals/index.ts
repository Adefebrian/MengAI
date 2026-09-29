// evals module: legacy vs v2 token benchmark over scripted scenarios, plus
// the scripted LLM doubles the integration wave replays the orchestrator with.
// Mounted at /api/evals. The only public surface of this module.
import type { ModuleContext, MountedModule } from "../../core/module";
import { evalRoutes } from "./routes";
import { createEvalsService, type EvalsDeps, type EvalsService } from "./service";

export type { EvalsDeps, EvalsService, EvalRunResult } from "./service";
export type { SuiteReplay, PolicyReplay, ScenarioResult, ReplayOptions } from "./replay";
export type { CacheModel } from "./meter";
export { MockLlmRouter, ScriptedProvider } from "./mock-llm";
export {
  STRATEGY,
  STRATEGY_SYSTEM,
  addresses,
  evaluateStrategy,
  mergeStrategies,
  parseStrategy,
  strategyEvidence,
  strategyPrompt,
  strategyText,
  terms,
} from "./strategy";
export type { StrategyCase, StrategyEval, StrategyEvalInput, StrategyScore, StrategySubjectInfo } from "./strategy";
export { costUnits, OUTPUT_WEIGHT } from "./replay";
export type { ReplayBrain, SuiteBrain } from "./replay";
export { BRAIN_REVISE_EVERY, BRAIN_ROLES_PER_SUITE, BRAIN_TUNE_EVERY, sampleStrategy, worstCaseBrain } from "./brain";
export type { MockLlmRouterOptions, ScriptedProviderOptions, ScriptedTurn, ScriptedCall, Script } from "./mock-llm";

export function createEvalsModule(ctx: ModuleContext, deps: EvalsDeps): MountedModule & { service: EvalsService } {
  const service = createEvalsService(ctx, deps);
  return { name: "evals", mountPath: "evals", routes: evalRoutes(service, ctx.kv), service };
}
