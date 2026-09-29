// usage repo: the llm_calls table only (plus a read-only join on agents for
// the per-role breakdown, which the usage report contract asks for).
import type { AgentRole, CallPurpose, LlmCallDTO, UsageTotals } from "@mengai/shared";
import type { Db } from "../../core/ports/db";
import { b01, bool, num } from "../../lib/sql";

export interface CallFilter {
  runId: string | null;
  from: number;
  to: number;
}

type CallRow = {
  id: string;
  run_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  provider_id: string;
  model: string;
  purpose: string;
  input_tokens: unknown;
  output_tokens: unknown;
  cached_tokens: unknown;
  cache_write_tokens: unknown;
  cost_usd: unknown;
  latency_ms: unknown;
  retries: unknown;
  ok: unknown;
  error: string | null;
  created_at: unknown;
};

type SumRow = {
  input_tokens: unknown;
  output_tokens: unknown;
  cached_tokens: unknown;
  cache_write_tokens: unknown;
  cost_usd: unknown;
  calls: unknown;
};

export function toCallDto(r: CallRow): LlmCallDTO {
  return {
    id: r.id,
    runId: r.run_id,
    agentId: r.agent_id,
    taskId: r.task_id,
    providerId: r.provider_id,
    model: r.model,
    purpose: r.purpose as CallPurpose,
    inputTokens: num(r.input_tokens),
    outputTokens: num(r.output_tokens),
    cachedTokens: num(r.cached_tokens),
    cacheWriteTokens: num(r.cache_write_tokens),
    costUsd: num(r.cost_usd),
    latencyMs: num(r.latency_ms),
    retries: num(r.retries),
    ok: bool(r.ok),
    error: r.error,
    createdAt: num(r.created_at),
  };
}

export function toTotals(r: SumRow | undefined): UsageTotals {
  return {
    inputTokens: num(r?.input_tokens),
    outputTokens: num(r?.output_tokens),
    cachedTokens: num(r?.cached_tokens),
    cacheWriteTokens: num(r?.cache_write_tokens),
    costUsd: num(r?.cost_usd),
    calls: num(r?.calls),
  };
}

export function createUsageRepo(db: Db) {
  return {
    async insert(c: LlmCallDTO): Promise<void> {
      await db.query`insert into llm_calls (id, run_id, agent_id, task_id, provider_id, model, purpose, input_tokens, output_tokens, cached_tokens, cache_write_tokens, cost_usd, latency_ms, retries, ok, error, created_at)
        values (${c.id}, ${c.runId}, ${c.agentId}, ${c.taskId}, ${c.providerId}, ${c.model}, ${c.purpose}, ${c.inputTokens}, ${c.outputTokens}, ${c.cachedTokens}, ${c.cacheWriteTokens}, ${c.costUsd}, ${c.latencyMs}, ${c.retries}, ${b01(c.ok)}, ${c.error}, ${c.createdAt})`;
    },

    async listByRun(runId: string): Promise<LlmCallDTO[]> {
      const rows = await db.query<CallRow>`select * from llm_calls where run_id = ${runId} order by created_at asc, id asc`;
      return rows.map(toCallDto);
    },

    async totals(f: CallFilter): Promise<UsageTotals> {
      const rows = f.runId
        ? await db.query<SumRow>`select coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens, coalesce(sum(cached_tokens), 0) as cached_tokens, coalesce(sum(cache_write_tokens), 0) as cache_write_tokens, coalesce(sum(cost_usd), 0) as cost_usd, count(*) as calls
            from llm_calls where run_id = ${f.runId} and created_at >= ${f.from} and created_at < ${f.to}`
        : await db.query<SumRow>`select coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens, coalesce(sum(cached_tokens), 0) as cached_tokens, coalesce(sum(cache_write_tokens), 0) as cache_write_tokens, coalesce(sum(cost_usd), 0) as cost_usd, count(*) as calls
            from llm_calls where created_at >= ${f.from} and created_at < ${f.to}`;
      return toTotals(rows[0]);
    },

    async byModel(f: CallFilter): Promise<Array<{ model: string } & UsageTotals>> {
      const rows = f.runId
        ? await db.query<SumRow & { model: string }>`select model, coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens, coalesce(sum(cached_tokens), 0) as cached_tokens, coalesce(sum(cache_write_tokens), 0) as cache_write_tokens, coalesce(sum(cost_usd), 0) as cost_usd, count(*) as calls
            from llm_calls where run_id = ${f.runId} and created_at >= ${f.from} and created_at < ${f.to} group by model order by model`
        : await db.query<SumRow & { model: string }>`select model, coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens, coalesce(sum(cached_tokens), 0) as cached_tokens, coalesce(sum(cache_write_tokens), 0) as cache_write_tokens, coalesce(sum(cost_usd), 0) as cost_usd, count(*) as calls
            from llm_calls where created_at >= ${f.from} and created_at < ${f.to} group by model order by model`;
      return rows.map((r) => ({ model: r.model, ...toTotals(r) }));
    },

    async byRole(f: CallFilter): Promise<Array<{ role: AgentRole } & UsageTotals>> {
      const rows = f.runId
        ? await db.query<SumRow & { role: string }>`select a.role as role, coalesce(sum(c.input_tokens), 0) as input_tokens, coalesce(sum(c.output_tokens), 0) as output_tokens, coalesce(sum(c.cached_tokens), 0) as cached_tokens, coalesce(sum(c.cache_write_tokens), 0) as cache_write_tokens, coalesce(sum(c.cost_usd), 0) as cost_usd, count(*) as calls
            from llm_calls c join agents a on a.id = c.agent_id
            where c.run_id = ${f.runId} and c.created_at >= ${f.from} and c.created_at < ${f.to} group by a.role order by a.role`
        : await db.query<SumRow & { role: string }>`select a.role as role, coalesce(sum(c.input_tokens), 0) as input_tokens, coalesce(sum(c.output_tokens), 0) as output_tokens, coalesce(sum(c.cached_tokens), 0) as cached_tokens, coalesce(sum(c.cache_write_tokens), 0) as cache_write_tokens, coalesce(sum(c.cost_usd), 0) as cost_usd, count(*) as calls
            from llm_calls c join agents a on a.id = c.agent_id
            where c.created_at >= ${f.from} and c.created_at < ${f.to} group by a.role order by a.role`;
      return rows.map((r) => ({ role: r.role as AgentRole, ...toTotals(r) }));
    },
  };
}

export type UsageRepo = ReturnType<typeof createUsageRepo>;
