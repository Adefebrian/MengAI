// tool_calls table: one row per executed (non-control) tool call, args and
// output already redacted by the service before they get here.
import type { ToolCallDetail } from "@mengai/shared";
import type { Db } from "../../core/ports/db";
import { b01, bool, json, num } from "../../lib/sql";

export interface ToolCallRow {
  id: string;
  runId: string;
  agentId: string;
  taskId: string | null;
  tool: string;
  /** JSON text */
  args: string;
  output: string;
  ok: boolean;
  durationMs: number;
  createdAt: number;
}

type RawRow = { id: string; tool: string; args: string; output: string; ok: unknown; duration_ms: unknown; created_at: unknown };

export function createToolCallsRepo(db: Db) {
  return {
    async insert(r: ToolCallRow): Promise<void> {
      await db.query`
        insert into tool_calls (id, run_id, agent_id, task_id, tool, args, output, ok, duration_ms, created_at)
        values (${r.id}, ${r.runId}, ${r.agentId}, ${r.taskId}, ${r.tool}, ${r.args}, ${r.output}, ${b01(r.ok)}, ${r.durationMs}, ${r.createdAt})`;
    },
    async get(runId: string, id: string): Promise<ToolCallDetail | null> {
      const rows = await db.query<RawRow>`
        select id, tool, args, output, ok, duration_ms, created_at from tool_calls
        where id = ${id} and run_id = ${runId}`;
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id,
        tool: r.tool,
        args: json<unknown>(r.args, null),
        output: r.output,
        ok: bool(r.ok),
        durationMs: num(r.duration_ms),
        createdAt: num(r.created_at),
      };
    },
  };
}
