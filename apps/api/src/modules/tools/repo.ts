// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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
    /** workspace paths this run wrote or edited successfully, newest first, each once */
    async changedPaths(runId: string, limit = 500): Promise<string[]> {
      const rows = await db.query<{ args: string }>`
        select args from tool_calls
        where run_id = ${runId} and (tool = 'fs_write' or tool = 'fs_edit') and ok = ${1}
        order by created_at desc limit ${limit}`;
      const out: string[] = [];
      for (const r of rows) {
        const path = json<Record<string, unknown>>(r.args, {}).path;
        if (typeof path === "string" && path.trim() && !out.includes(path.trim())) out.push(path.trim());
      }
      return out;
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
