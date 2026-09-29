// events table: append-only log. seq comes from the insert (autoincrement in
// SQLite, identity in Postgres); data is JSON text.
import type { EventType, MengaiEvent } from "@mengai/shared";
import { json, num, toJson } from "../../lib/sql";
import type { Db } from "../../core/ports/db";

interface EventRow {
  seq: unknown;
  run_id: string | null;
  ts: unknown;
  type: string;
  agent_id: string | null;
  task_id: string | null;
  data: string;
}

const toEvent = (r: EventRow): MengaiEvent => ({
  seq: num(r.seq),
  ts: num(r.ts),
  type: r.type as EventType,
  runId: r.run_id,
  agentId: r.agent_id,
  taskId: r.task_id,
  data: json(r.data, {}) as MengaiEvent["data"],
});

export function createEventsRepo(db: Db) {
  return {
    async append(e: { runId: string | null; ts: number; type: EventType; agentId: string | null; taskId: string | null; data: unknown }): Promise<number> {
      const rows = await db.query<{ seq: unknown }>`
        insert into events (run_id, ts, type, agent_id, task_id, data)
        values (${e.runId}, ${e.ts}, ${e.type}, ${e.agentId}, ${e.taskId}, ${toJson(e.data)})
        returning seq`;
      const seq = num(rows[0]?.seq);
      if (!seq) throw new Error("event insert returned no seq");
      return seq;
    },
    async after(seq: number, runId: string | null, limit: number): Promise<MengaiEvent[]> {
      const rows = runId
        ? await db.query<EventRow>`
            select seq, run_id, ts, type, agent_id, task_id, data from events
            where seq > ${seq} and run_id = ${runId} order by seq limit ${limit}`
        : await db.query<EventRow>`
            select seq, run_id, ts, type, agent_id, task_id, data from events
            where seq > ${seq} order by seq limit ${limit}`;
      return rows.map(toEvent);
    },
    async lastSeq(): Promise<number> {
      const rows = await db.query<{ s: unknown }>`select max(seq) as s from events`;
      return num(rows[0]?.s);
    },
  };
}

export type EventsRepo = ReturnType<typeof createEventsRepo>;
