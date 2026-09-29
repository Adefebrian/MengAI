// eval_runs table only.
import type { EvalRunDTO } from "@mengai/shared";
import type { Db } from "../../core/ports/db";
import { json, num, toJson } from "../../lib/sql";

interface EvalRow {
  id: string;
  suite: string;
  policy: string;
  metrics: string;
  created_at: unknown;
}

const EMPTY: EvalRunDTO["metrics"] = { scenarios: 0, passed: 0, calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, billableInputTokens: 0, maxPromptTokens: 0 };

function toDto(r: EvalRow): EvalRunDTO {
  return {
    id: r.id,
    suite: r.suite,
    policy: r.policy === "legacy" ? "legacy" : "v2",
    metrics: { ...EMPTY, ...json<Partial<EvalRunDTO["metrics"]>>(r.metrics, {}) },
    createdAt: num(r.created_at),
  };
}

export function createEvalsRepo(db: Db) {
  return {
    async insertPair(runs: [EvalRunDTO, EvalRunDTO]): Promise<void> {
      await db.tx(async (tx) => {
        for (const r of runs) {
          await tx.query`insert into eval_runs (id, suite, policy, metrics, created_at) values (${r.id}, ${r.suite}, ${r.policy}, ${toJson(r.metrics)}, ${r.createdAt})`;
        }
      });
    },

    /** newest first */
    async list(suite: string | null, limit: number): Promise<EvalRunDTO[]> {
      const rows = suite
        ? await db.query<EvalRow>`select id, suite, policy, metrics, created_at from eval_runs where suite = ${suite} order by created_at desc, id desc limit ${limit}`
        : await db.query<EvalRow>`select id, suite, policy, metrics, created_at from eval_runs order by created_at desc, id desc limit ${limit}`;
      return rows.map(toDto);
    },
  };
}
