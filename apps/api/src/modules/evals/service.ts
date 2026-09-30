// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Eval harness: replays a fixture suite under the legacy and v2 prompt
// policies through the injected ContextService, persists one eval_runs row
// per policy and returns the savings on billable input tokens.
import type { EvalRunDTO } from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import type { ContextService, ToolsService } from "../../core/services";
import { notFound } from "../../lib/http";
import { worstCaseBrain } from "./brain";
import { replaySuite, type ReplayOptions, type SuiteReplay } from "./replay";
import { createEvalsRepo } from "./repo";
import { fixtureSpecsFor, loadSuites } from "./suites";

export const DEFAULT_SUITE = "core";
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

export interface EvalsDeps {
  context: ContextService;
  /** real role tool schemas when wired (integration wave); fixture schemas otherwise */
  tools?: Pick<ToolsService, "specsFor">;
}

export interface EvalRunResult {
  legacy: EvalRunDTO;
  v2: EvalRunDTO;
  savingsPct: number;
}

export interface EvalsService {
  suites(): string[];
  /**
   * replay only, nothing persisted (per-scenario numbers for reports and tests).
   * opts.brain true replays the worst-case brain too (SuiteReplay.brain).
   */
  replay(suite?: string, opts?: Omit<ReplayOptions, "brain"> & { brain?: boolean }): Promise<SuiteReplay>;
  run(input?: { suite?: string }): Promise<EvalRunResult>;
  list(opts?: { suite?: string; limit?: number }): Promise<EvalRunDTO[]>;
}

export function createEvalsService(ctx: ModuleContext, deps: EvalsDeps): EvalsService {
  const repo = createEvalsRepo(ctx.db);
  const log = ctx.logger.child({ module: "evals" });
  const specsFor = deps.tools ? (role: Parameters<ToolsService["specsFor"]>[0]) => deps.tools!.specsFor(role) : fixtureSpecsFor;

  async function replay(suiteId = DEFAULT_SUITE, opts: Omit<ReplayOptions, "brain"> & { brain?: boolean } = {}): Promise<SuiteReplay> {
    const suite = loadSuites().get(suiteId);
    if (!suite) throw notFound(`suite ${suiteId}`);
    const { brain, ...rest } = opts;
    return replaySuite(suite, { context: deps.context, specsFor }, { ...rest, brain: brain ? worstCaseBrain() : null });
  }

  return {
    suites: () => [...loadSuites().keys()],
    replay,
    async run(input = {}) {
      const r = await replay(input.suite ?? DEFAULT_SUITE);
      const at = ctx.clock.now();
      const legacy: EvalRunDTO = { id: ctx.clock.id(), suite: r.suite, policy: "legacy", metrics: r.legacy.metrics, createdAt: at };
      const v2: EvalRunDTO = { id: ctx.clock.id(), suite: r.suite, policy: "v2", metrics: r.v2.metrics, createdAt: at };
      await repo.insertPair([legacy, v2]);
      log.log("info", "eval run", { suite: r.suite, savingsPct: r.savingsPct, legacy: r.legacy.metrics.billableInputTokens, v2: r.v2.metrics.billableInputTokens });
      return { legacy, v2, savingsPct: r.savingsPct };
    },
    async list(opts = {}) {
      const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIST_LIMIT)));
      return repo.list(opts.suite ?? null, limit);
    },
  };
}
