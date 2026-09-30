// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// decisions table only. Portable SQL over the Db port (SQLite and Postgres).
import type { DecisionDTO } from "@mengai/shared";
import type { Db } from "../../core/ports/db";
import { b01, bool, json, num, numOrNull, toJson } from "../../lib/sql";

export interface DecisionRecord {
  id: string;
  runId: string | null;
  decisionId: string;
  domain: string;
  stateDigest: string;
  questions: unknown;
  answers: Record<string, unknown>;
  action: string;
  confidence: number | null;
  verified: boolean;
  stamp: string | null;
  latencyMs: number;
  createdAt: number;
}

interface DecisionRow {
  id: string;
  run_id: string | null;
  decision_id: string;
  answers: string;
  action: string;
  confidence: unknown;
  verified: unknown;
  stamp: string | null;
  latency_ms: unknown;
  created_at: unknown;
}

function toDto(r: DecisionRow): DecisionDTO {
  return {
    id: r.id,
    runId: r.run_id ?? null,
    decisionId: r.decision_id,
    answers: json<Record<string, unknown>>(r.answers, {}),
    action: r.action,
    confidence: numOrNull(r.confidence),
    verified: bool(r.verified),
    stamp: r.stamp ?? null,
    latencyMs: num(r.latency_ms),
    createdAt: num(r.created_at),
  };
}

export function createDecisionsRepo(db: Db) {
  return {
    async insert(d: DecisionRecord): Promise<DecisionDTO> {
      await db.query`
        insert into decisions (id, run_id, decision_id, domain, state_digest, questions, answers, action, confidence, verified, stamp, latency_ms, created_at)
        values (${d.id}, ${d.runId}, ${d.decisionId}, ${d.domain}, ${d.stateDigest}, ${toJson(d.questions)}, ${toJson(d.answers)}, ${d.action},
                ${d.confidence}, ${b01(d.verified)}, ${d.stamp}, ${Math.max(0, Math.round(d.latencyMs))}, ${d.createdAt})`;
      return {
        id: d.id,
        runId: d.runId,
        decisionId: d.decisionId,
        answers: d.answers,
        action: d.action,
        confidence: d.confidence,
        verified: d.verified,
        stamp: d.stamp,
        latencyMs: Math.max(0, Math.round(d.latencyMs)),
        createdAt: d.createdAt,
      };
    },

    /** The latest `limit` decisions (optionally of one run), returned oldest first. */
    async list(runId: string | null, limit: number): Promise<DecisionDTO[]> {
      const rows = runId
        ? await db.query<DecisionRow>`
            select id, run_id, decision_id, answers, action, confidence, verified, stamp, latency_ms, created_at
            from decisions where run_id = ${runId} order by created_at desc, id desc limit ${limit}`
        : await db.query<DecisionRow>`
            select id, run_id, decision_id, answers, action, confidence, verified, stamp, latency_ms, created_at
            from decisions order by created_at desc, id desc limit ${limit}`;
      return rows.map(toDto).reverse();
    },
  };
}

export type DecisionsRepo = ReturnType<typeof createDecisionsRepo>;
