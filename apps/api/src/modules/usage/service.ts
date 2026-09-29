// usage service: cost math with the owner's price overrides, llm_calls
// persistence and the aggregated report. No Hono here.
import { DEFAULT_PRICES, costUsd, type LlmCallDTO, type ModelPrice, type UsageReport } from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import type { Usage } from "../../core/ports/llm";
import type { RecordCallInput, SettingsService, UsageService } from "../../core/services";
import { redact } from "../../lib/redact";
import { createUsageRepo, type CallFilter } from "./repo";

export interface UsageDeps {
  settings: SettingsService;
}

export interface UsageReportQuery {
  runId?: string;
  from?: number;
  to?: number;
}

export interface UsageModuleService extends UsageService {
  report(q?: UsageReportQuery): Promise<UsageReport>;
}

const MAX_ERROR_CHARS = 500;
/** upper bound for "no end" filters, a safe integer in both dialects */
const NO_END = Number.MAX_SAFE_INTEGER;

function tokens(v: number): number {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function cleanUsage(u: Usage): Usage {
  const inputTokens = tokens(u.inputTokens);
  const cachedTokens = Math.min(inputTokens, tokens(u.cachedTokens));
  return {
    inputTokens,
    outputTokens: tokens(u.outputTokens),
    cachedTokens,
    cacheWriteTokens: Math.min(inputTokens - cachedTokens, tokens(u.cacheWriteTokens)),
  };
}

export function createUsageService(ctx: ModuleContext, deps: UsageDeps): UsageModuleService {
  const repo = createUsageRepo(ctx.db);
  const log = ctx.logger.child({ module: "usage" });

  async function overrides(): Promise<Record<string, ModelPrice>> {
    try {
      return (await deps.settings.get()).prices ?? {};
    } catch (e) {
      log.log("warn", "price overrides unavailable, using defaults", { error: redact(String(e)) });
      return {};
    }
  }

  const service: UsageModuleService = {
    async record(input: RecordCallInput): Promise<LlmCallDTO> {
      const usage = cleanUsage(input.usage);
      const cost = costUsd(input.model, usage, await overrides());
      const call: LlmCallDTO = {
        id: ctx.clock.id(),
        runId: input.runId,
        agentId: input.agentId,
        taskId: input.taskId,
        providerId: input.providerId,
        model: input.model,
        purpose: input.purpose,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        costUsd: cost,
        latencyMs: tokens(input.latencyMs),
        retries: tokens(input.retries),
        ok: input.ok,
        error: input.error ? redact(input.error).slice(0, MAX_ERROR_CHARS) : null,
        createdAt: ctx.clock.now(),
      };
      await repo.insert(call);
      return call;
    },
    async cost(model: string, usage: Usage): Promise<number> {
      return costUsd(model, cleanUsage(usage), await overrides());
    },
    async prices(): Promise<Record<string, ModelPrice>> {
      return { ...DEFAULT_PRICES, ...(await overrides()) };
    },
    listCalls(runId: string): Promise<LlmCallDTO[]> {
      return repo.listByRun(runId);
    },
    async report(q: UsageReportQuery = {}): Promise<UsageReport> {
      const f: CallFilter = { runId: q.runId ?? null, from: q.from ?? 0, to: q.to ?? NO_END };
      const [totals, byModel, byRole] = await Promise.all([repo.totals(f), repo.byModel(f), repo.byRole(f)]);
      const cacheHitRate = totals.inputTokens > 0 ? Math.round((totals.cachedTokens / totals.inputTokens) * 10_000) / 10_000 : 0;
      return { totals, cacheHitRate, byModel, byRole };
    },
  };
  return service;
}
