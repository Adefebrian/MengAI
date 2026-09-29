// SQL for the runs module: runs, agents, tasks, handoffs, plus the per-call
// tool_calls log and the per-agent context_snapshots (X-ray) the engine
// writes. Portable SQL only (TEXT ids, epoch ms, JSON as TEXT, 0/1 booleans).
import type {
  Activity,
  AgentDTO,
  AgentRole,
  AgentStatus,
  ContextLayer,
  ContextXrayDTO,
  HandoffDTO,
  Mood,
  RunDTO,
  RunStatus,
  TaskDTO,
  TaskStatus,
  Tier,
  ToolCallDetail,
  UsageTotals,
} from "@mengai/shared";
import type { Db, Row } from "../../core/ports/db";
import { b01, bool, json, num, numOrNull, toJson } from "../../lib/sql";

export const emptyUsage = (): UsageTotals => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  calls: 0,
});

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function usageOf(r: Row): UsageTotals {
  return {
    inputTokens: num(r.input_tokens),
    outputTokens: num(r.output_tokens),
    cachedTokens: num(r.cached_tokens),
    cacheWriteTokens: num(r.cache_write_tokens),
    costUsd: num(r.cost_usd),
    calls: num(r.calls),
  };
}

export function runFromRow(r: Row, progress = 0): RunDTO {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    goal: str(r.goal),
    status: str(r.status) as RunStatus,
    statusReason: strOrNull(r.status_reason),
    budgetTokens: num(r.budget_tokens),
    budgetUsd: num(r.budget_usd),
    usage: usageOf(r),
    progress,
    startedAt: numOrNull(r.started_at),
    endedAt: numOrNull(r.ended_at),
    createdAt: num(r.created_at),
  };
}

export function agentFromRow(r: Row): AgentDTO {
  return {
    id: str(r.id),
    runId: str(r.run_id),
    parentId: strOrNull(r.parent_id),
    role: str(r.role) as AgentRole,
    name: str(r.name),
    look: { coat: str(r.coat), seed: num(r.seed) },
    tier: str(r.tier) as Tier,
    status: str(r.status) as AgentStatus,
    activity: str(r.activity) as Activity,
    mood: str(r.mood) as Mood,
    statusText: strOrNull(r.status_text),
    currentTaskId: strOrNull(r.current_task_id),
    steps: num(r.steps),
    usage: usageOf(r),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export function taskFromRow(r: Row): TaskDTO {
  return {
    id: str(r.id),
    runId: str(r.run_id),
    parentId: strOrNull(r.parent_id),
    title: str(r.title),
    spec: str(r.spec),
    acceptance: json<string[]>(r.acceptance, []),
    role: str(r.role) as AgentRole,
    assigneeId: strOrNull(r.assignee_id),
    status: str(r.status) as TaskStatus,
    priority: num(r.priority),
    deps: json<string[]>(r.deps, []),
    review: bool(r.review),
    attempts: num(r.attempts),
    resultSummary: strOrNull(r.result_summary),
    createdBy: strOrNull(r.created_by),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    startedAt: numOrNull(r.started_at),
    endedAt: numOrNull(r.ended_at),
  };
}

export function handoffFromRow(r: Row): HandoffDTO {
  return {
    id: str(r.id),
    runId: str(r.run_id),
    taskId: str(r.task_id),
    fromAgentId: str(r.from_agent_id),
    toAgentId: strOrNull(r.to_agent_id),
    toRole: str(r.to_role) as AgentRole,
    summary: str(r.summary),
    createdAt: num(r.created_at),
  };
}

export interface ToolCallRow {
  id: string;
  runId: string;
  agentId: string;
  taskId: string | null;
  tool: string;
  args: string;
  output: string;
  ok: boolean;
  durationMs: number;
  createdAt: number;
}

export interface HistoryRow {
  goal: string;
  tokens: number;
  costUsd: number;
  tasks: number;
}

/** done / all non-cancelled tasks, 0 when there are none */
export function progressOf(tasks: Array<Pick<TaskDTO, "status">>): number {
  const live = tasks.filter((t) => t.status !== "cancelled");
  if (live.length === 0) return 0;
  return live.filter((t) => t.status === "done").length / live.length;
}

export function createRunsRepo(db: Db) {
  return {
    // ------------------------------------------------------------ runs
    async insertRun(run: RunDTO, now: number): Promise<void> {
      await db.query`insert into runs (id, project_id, goal, status, status_reason, budget_tokens, budget_usd, started_at, ended_at, created_at, updated_at)
        values (${run.id}, ${run.projectId}, ${run.goal}, ${run.status}, ${run.statusReason}, ${run.budgetTokens}, ${run.budgetUsd}, ${run.startedAt}, ${run.endedAt}, ${run.createdAt}, ${now})`;
    },

    async getRun(id: string): Promise<RunDTO | null> {
      const rows = await db.query`select * from runs where id = ${id}`;
      if (!rows[0]) return null;
      const tasks = await db.query`select status from tasks where run_id = ${id}`;
      return runFromRow(rows[0], progressOf(tasks.map((t) => ({ status: str(t.status) as TaskStatus }))));
    },

    async listRuns(limit: number): Promise<RunDTO[]> {
      const rows = await db.query`select * from runs order by created_at desc, id desc limit ${limit}`;
      if (rows.length === 0) return [];
      const counts = await db.query`select t.run_id as run_id, t.status as status, count(*) as c from tasks t
        join (select id from runs order by created_at desc, id desc limit ${limit}) r on r.id = t.run_id
        group by t.run_id, t.status`;
      const byRun = new Map<string, { done: number; live: number }>();
      for (const c of counts) {
        const e = byRun.get(str(c.run_id)) ?? { done: 0, live: 0 };
        const n = num(c.c);
        if (c.status !== "cancelled") e.live += n;
        if (c.status === "done") e.done += n;
        byRun.set(str(c.run_id), e);
      }
      return rows.map((r) => {
        const e = byRun.get(str(r.id));
        return runFromRow(r, e && e.live > 0 ? e.done / e.live : 0);
      });
    },

    async runIdsByStatus(statuses: RunStatus[]): Promise<Array<{ id: string; status: RunStatus }>> {
      const out: Array<{ id: string; status: RunStatus }> = [];
      for (const s of statuses) {
        const rows = await db.query`select id from runs where status = ${s} order by created_at`;
        for (const r of rows) out.push({ id: str(r.id), status: s });
      }
      return out;
    },

    async setRunStatus(id: string, status: RunStatus, reason: string | null, now: number, endedAt: number | null): Promise<void> {
      await db.query`update runs set status = ${status}, status_reason = ${reason}, ended_at = ${endedAt}, updated_at = ${now} where id = ${id}`;
    },

    async setRunBudget(id: string, budgetTokens: number, budgetUsd: number, now: number): Promise<void> {
      await db.query`update runs set budget_tokens = ${budgetTokens}, budget_usd = ${budgetUsd}, updated_at = ${now} where id = ${id}`;
    },

    async addRunUsage(id: string, d: UsageTotals, now: number): Promise<void> {
      await db.query`update runs set input_tokens = input_tokens + ${d.inputTokens}, output_tokens = output_tokens + ${d.outputTokens},
        cached_tokens = cached_tokens + ${d.cachedTokens}, cache_write_tokens = cache_write_tokens + ${d.cacheWriteTokens},
        cost_usd = cost_usd + ${d.costUsd}, calls = calls + ${d.calls}, updated_at = ${now} where id = ${id}`;
    },

    /** finished runs of a project with real usage, newest first */
    async projectHistory(projectId: string, limit: number): Promise<HistoryRow[]> {
      const rows = await db.query`select r.goal as goal, r.input_tokens + r.output_tokens as tokens, r.cost_usd as cost_usd,
          (select count(*) from tasks t where t.run_id = r.id and t.status <> 'cancelled') as tasks
        from runs r
        where r.project_id = ${projectId} and r.status in ('done', 'failed', 'stopped')
        order by r.created_at desc limit ${limit}`;
      return rows
        .map((r) => ({ goal: str(r.goal), tokens: num(r.tokens), costUsd: num(r.cost_usd), tasks: num(r.tasks) }))
        .filter((r) => r.tokens > 0 && r.tasks > 0);
    },

    /** boot recovery: in-flight work of a run that is no longer live goes back to the queue */
    async resetLiveRows(runId: string, now: number): Promise<void> {
      await db.query`update tasks set status = 'queued', updated_at = ${now} where run_id = ${runId} and status in ('running', 'waiting', 'ready')`;
      await db.query`update agents set status = 'idle', activity = 'rest', current_task_id = null, updated_at = ${now} where run_id = ${runId} and status not in ('stopped', 'error')`;
    },

    /** a run stopped without a live engine: cancel open tasks, stop agents */
    async closeRunRows(runId: string, now: number): Promise<void> {
      await db.query`update tasks set status = 'cancelled', ended_at = ${now}, updated_at = ${now} where run_id = ${runId} and status not in ('done', 'failed', 'blocked', 'cancelled')`;
      await db.query`update agents set status = 'stopped', activity = 'rest', current_task_id = null, updated_at = ${now} where run_id = ${runId} and status <> 'stopped'`;
    },

    // ---------------------------------------------------------- agents
    async insertAgent(a: AgentDTO): Promise<void> {
      await db.query`insert into agents (id, run_id, parent_id, role, name, coat, seed, tier, status, activity, mood, status_text, current_task_id, steps, created_at, updated_at)
        values (${a.id}, ${a.runId}, ${a.parentId}, ${a.role}, ${a.name}, ${a.look.coat}, ${a.look.seed}, ${a.tier}, ${a.status}, ${a.activity}, ${a.mood}, ${a.statusText}, ${a.currentTaskId}, ${a.steps}, ${a.createdAt}, ${a.updatedAt})`;
    },

    async saveAgentState(a: AgentDTO): Promise<void> {
      await db.query`update agents set status = ${a.status}, activity = ${a.activity}, mood = ${a.mood}, status_text = ${a.statusText},
        current_task_id = ${a.currentTaskId}, steps = ${a.steps}, tier = ${a.tier}, updated_at = ${a.updatedAt} where id = ${a.id}`;
    },

    async addAgentUsage(id: string, d: UsageTotals, now: number): Promise<void> {
      await db.query`update agents set input_tokens = input_tokens + ${d.inputTokens}, output_tokens = output_tokens + ${d.outputTokens},
        cached_tokens = cached_tokens + ${d.cachedTokens}, cache_write_tokens = cache_write_tokens + ${d.cacheWriteTokens},
        cost_usd = cost_usd + ${d.costUsd}, calls = calls + ${d.calls}, updated_at = ${now} where id = ${id}`;
    },

    async addAgentOutcome(id: string, win: boolean, now: number): Promise<void> {
      if (win) await db.query`update agents set wins = wins + 1, updated_at = ${now} where id = ${id}`;
      else await db.query`update agents set losses = losses + 1, updated_at = ${now} where id = ${id}`;
    },

    async listAgents(runId: string): Promise<AgentDTO[]> {
      const rows = await db.query`select * from agents where run_id = ${runId} order by created_at, id`;
      return rows.map(agentFromRow);
    },

    async agentOutcomes(runId: string): Promise<Map<string, { wins: number; losses: number }>> {
      const rows = await db.query`select id, wins, losses from agents where run_id = ${runId}`;
      return new Map(rows.map((r) => [str(r.id), { wins: num(r.wins), losses: num(r.losses) }]));
    },

    // ----------------------------------------------------------- tasks
    async insertTask(t: TaskDTO): Promise<void> {
      await db.query`insert into tasks (id, run_id, parent_id, title, spec, acceptance, role, assignee_id, status, priority, deps, review, attempts, result_summary, created_by, created_at, updated_at, started_at, ended_at)
        values (${t.id}, ${t.runId}, ${t.parentId}, ${t.title}, ${t.spec}, ${toJson(t.acceptance)}, ${t.role}, ${t.assigneeId}, ${t.status}, ${t.priority}, ${toJson(t.deps)}, ${b01(t.review)}, ${t.attempts}, ${t.resultSummary}, ${t.createdBy}, ${t.createdAt}, ${t.updatedAt}, ${t.startedAt}, ${t.endedAt})`;
    },

    async saveTask(t: TaskDTO): Promise<void> {
      await db.query`update tasks set title = ${t.title}, spec = ${t.spec}, acceptance = ${toJson(t.acceptance)}, role = ${t.role},
        assignee_id = ${t.assigneeId}, status = ${t.status}, priority = ${t.priority}, deps = ${toJson(t.deps)}, review = ${b01(t.review)},
        attempts = ${t.attempts}, result_summary = ${t.resultSummary}, updated_at = ${t.updatedAt}, started_at = ${t.startedAt}, ended_at = ${t.endedAt}
        where id = ${t.id}`;
    },

    async listTasks(runId: string): Promise<TaskDTO[]> {
      const rows = await db.query`select * from tasks where run_id = ${runId} order by created_at, id`;
      return rows.map(taskFromRow);
    },

    // -------------------------------------------------------- handoffs
    async insertHandoff(h: HandoffDTO): Promise<void> {
      await db.query`insert into handoffs (id, run_id, task_id, from_agent_id, to_agent_id, to_role, summary, created_at)
        values (${h.id}, ${h.runId}, ${h.taskId}, ${h.fromAgentId}, ${h.toAgentId}, ${h.toRole}, ${h.summary}, ${h.createdAt})`;
    },

    async setHandoffTarget(id: string, toAgentId: string): Promise<void> {
      await db.query`update handoffs set to_agent_id = ${toAgentId} where id = ${id}`;
    },

    async listHandoffs(runId: string): Promise<HandoffDTO[]> {
      const rows = await db.query`select * from handoffs where run_id = ${runId} order by created_at, id`;
      return rows.map(handoffFromRow);
    },

    // ------------------------------------------------------ tool calls
    async insertToolCall(c: ToolCallRow): Promise<void> {
      await db.query`insert into tool_calls (id, run_id, agent_id, task_id, tool, args, output, ok, duration_ms, created_at)
        values (${c.id}, ${c.runId}, ${c.agentId}, ${c.taskId}, ${c.tool}, ${c.args}, ${c.output}, ${b01(c.ok)}, ${c.durationMs}, ${c.createdAt})`;
    },

    async getToolCall(runId: string, id: string): Promise<ToolCallDetail | null> {
      const rows = await db.query`select * from tool_calls where id = ${id} and run_id = ${runId}`;
      const r = rows[0];
      if (!r) return null;
      const rawArgs = str(r.args);
      return {
        id: str(r.id),
        tool: str(r.tool),
        args: json<unknown>(rawArgs, rawArgs),
        output: str(r.output),
        ok: bool(r.ok),
        durationMs: num(r.duration_ms),
        createdAt: num(r.created_at),
      };
    },

    // ------------------------------------------------- context X-ray
    async upsertSnapshot(runId: string, x: ContextXrayDTO): Promise<void> {
      await db.query`insert into context_snapshots (agent_id, run_id, task_id, model, budget, layers, total_tokens, compactions, last_cached_tokens, created_at)
        values (${x.agentId}, ${runId}, ${x.taskId}, ${x.model}, ${x.budget}, ${toJson(x.layers)}, ${x.totalTokens}, ${x.compactions}, ${x.lastCachedTokens}, ${x.createdAt})
        on conflict (agent_id) do update set run_id = excluded.run_id, task_id = excluded.task_id, model = excluded.model, budget = excluded.budget,
          layers = excluded.layers, total_tokens = excluded.total_tokens, compactions = excluded.compactions,
          last_cached_tokens = excluded.last_cached_tokens, created_at = excluded.created_at`;
    },

    async getSnapshot(runId: string, agentId: string): Promise<ContextXrayDTO | null> {
      const rows = await db.query`select * from context_snapshots where agent_id = ${agentId} and run_id = ${runId}`;
      const r = rows[0];
      if (!r) return null;
      return {
        agentId: str(r.agent_id),
        taskId: strOrNull(r.task_id),
        model: str(r.model),
        budget: num(r.budget),
        layers: json<Array<{ layer: ContextLayer; tokens: number; cached: boolean }>>(r.layers, []),
        totalTokens: num(r.total_tokens),
        compactions: num(r.compactions),
        lastCachedTokens: num(r.last_cached_tokens),
        createdAt: num(r.created_at),
      };
    },
  };
}

export type RunsRepo = ReturnType<typeof createRunsRepo>;
