// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// memory brain repo: role_outcomes and strategies. Portable SQL only
// (Bun.SQL on SQLite and Postgres): every ${value} is a bound parameter,
// JSON is TEXT, booleans are 0/1.
import type { AgentRole, StrategyChoice, StrategyEvidenceDTO, StrategyStatus, StrategyVersionDTO } from "@mengai/shared";
import type { Db, Row } from "../../core/ports/db";
import { b01, bool, json, num, numOrNull, toJson } from "../../lib/sql";

// ------------------------------------------------------------ outcomes
export type OutcomeKind = "done" | "review_pass" | "review_fail" | "failed" | "blocked" | "reflexion";

export interface RoleOutcomeRow {
  id: string;
  /** role key: a base role or a dynamic role key */
  role: string;
  runId: string | null;
  taskId: string | null;
  agentId: string | null;
  outcome: "win" | "loss";
  kind: OutcomeKind;
  cause: string;
  strategyVersion: number;
  createdAt: number;
}

function toOutcome(r: Row): RoleOutcomeRow {
  return {
    id: String(r.id),
    role: String(r.role),
    runId: (r.run_id ?? null) as string | null,
    taskId: (r.task_id ?? null) as string | null,
    agentId: (r.agent_id ?? null) as string | null,
    outcome: String(r.outcome) === "win" ? "win" : "loss",
    kind: String(r.kind) as OutcomeKind,
    cause: String(r.cause ?? ""),
    strategyVersion: num(r.strategy_version),
    createdAt: num(r.created_at),
  };
}

export async function insertOutcome(db: Db, o: RoleOutcomeRow): Promise<void> {
  await db.query`
    insert into role_outcomes (id, role, run_id, task_id, agent_id, outcome, kind, cause, strategy_version, created_at)
    values (${o.id}, ${o.role}, ${o.runId}, ${o.taskId}, ${o.agentId}, ${o.outcome}, ${o.kind}, ${o.cause}, ${o.strategyVersion}, ${o.createdAt})`;
}

/** The role's newest outcomes, newest first. */
export async function recentOutcomes(db: Db, role: string, limit: number): Promise<RoleOutcomeRow[]> {
  const rows = await db.query`
    select * from role_outcomes where role = ${role}
    order by created_at desc, id desc
    limit ${limit}`;
  return rows.map(toOutcome);
}

/** Keyset position of a row: (created_at, id). Ids are UUIDv7, so they sort in creation order too. */
export interface Mark {
  createdAt: number;
  id: string;
}

/** Outcomes of the role recorded after `mark`. */
export async function outcomesSince(db: Db, role: string, mark: Mark): Promise<number> {
  const rows = await db.query`
    select count(*) as n from role_outcomes
    where role = ${role} and (created_at > ${mark.createdAt} or (created_at = ${mark.createdAt} and id > ${mark.id}))`;
  return num(rows[0]?.n);
}

export async function countOutcomes(db: Db, role: string): Promise<number> {
  const rows = await db.query`select count(*) as n from role_outcomes where role = ${role}`;
  return num(rows[0]?.n);
}

/** Keeps the newest `keep` outcomes of the role, deletes the rest. */
export async function trimOutcomes(db: Db, role: string, keep: number): Promise<void> {
  await db.query`
    delete from role_outcomes
    where role = ${role}
      and id not in (select id from role_outcomes where role = ${role} order by created_at desc, id desc limit ${keep})`;
}

// ---------------------------------------------------------- strategies
export type SubjectKind = "role" | "agent";

function toStrategy(r: Row): StrategyVersionDTO {
  const choice = r.choice === null || r.choice === undefined ? null : (String(r.choice) as StrategyChoice);
  const hasDecision = r.decision_ref !== null && r.decision_ref !== undefined;
  return {
    id: String(r.id),
    subject: String(r.subject_kind) === "agent" ? "agent" : "role",
    subjectKey: String(r.subject_key),
    role: String(r.archetype) as AgentRole,
    version: num(r.version),
    text: String(r.text ?? ""),
    tokens: num(r.tokens),
    status: String(r.status) as StrategyStatus,
    choice,
    reason: String(r.reason ?? ""),
    decision:
      hasDecision || r.stamp
        ? { id: hasDecision ? String(r.decision_ref) : null, confidence: numOrNull(r.confidence), verified: bool(r.verified), stamp: (r.stamp ?? null) as string | null }
        : null,
    evidence: json<StrategyEvidenceDTO | null>(r.evidence, null),
    createdAt: num(r.created_at),
  };
}

export async function activeStrategy(db: Db, kind: SubjectKind, key: string): Promise<StrategyVersionDTO | null> {
  const rows = await db.query`
    select * from strategies where subject_kind = ${kind} and subject_key = ${key} and status = 'active'
    order by version desc limit 1`;
  return rows[0] ? toStrategy(rows[0]) : null;
}

export async function strategiesByIds(db: Db, ids: string[]): Promise<StrategyVersionDTO[]> {
  const out: StrategyVersionDTO[] = [];
  for (const id of [...new Set(ids)].slice(0, 20)) {
    const rows = await db.query`select * from strategies where id = ${id}`;
    if (rows[0]) out.push(toStrategy(rows[0]));
  }
  return out;
}

/** Every version and candidate of the subject, newest first. */
export async function strategyHistory(db: Db, kind: SubjectKind, key: string, limit: number): Promise<StrategyVersionDTO[]> {
  const rows = await db.query`
    select * from strategies where subject_kind = ${kind} and subject_key = ${key}
    order by created_at desc, id desc
    limit ${limit}`;
  return rows.map(toStrategy);
}

/** The newest tuning attempt (adopted or rejected): outcomes after it count toward the next one. */
export async function lastAttempt(db: Db, kind: SubjectKind, key: string): Promise<Mark | null> {
  const rows = await db.query`select id, created_at from strategies where subject_kind = ${kind} and subject_key = ${key} order by created_at desc, id desc limit 1`;
  return rows[0] ? { createdAt: num(rows[0].created_at), id: String(rows[0].id) } : null;
}

export async function maxAdoptedVersion(db: Db, kind: SubjectKind, key: string): Promise<number> {
  const rows = await db.query`select max(version) as v from strategies where subject_kind = ${kind} and subject_key = ${key} and status <> 'rejected'`;
  return num(rows[0]?.v);
}

export interface StrategyRow {
  id: string;
  kind: SubjectKind;
  key: string;
  archetype: AgentRole;
  version: number;
  text: string;
  tokens: number;
  status: StrategyStatus;
  choice: StrategyChoice | null;
  decisionRef: string | null;
  confidence: number | null;
  verified: boolean;
  stamp: string | null;
  evidence: StrategyEvidenceDTO | null;
  reason: string;
  sourceRunId: string | null;
  createdAt: number;
}

export async function insertStrategy(db: Db, s: StrategyRow): Promise<StrategyVersionDTO> {
  const rows = await db.query`
    insert into strategies (id, subject_kind, subject_key, archetype, version, text, tokens, status, choice, decision_ref, confidence, verified, stamp, evidence, reason, source_run_id, created_at)
    values (${s.id}, ${s.kind}, ${s.key}, ${s.archetype}, ${s.version}, ${s.text}, ${s.tokens}, ${s.status}, ${s.choice}, ${s.decisionRef}, ${s.confidence}, ${b01(s.verified)},
      ${s.stamp}, ${s.evidence ? toJson(s.evidence) : null}, ${s.reason}, ${s.sourceRunId}, ${s.createdAt})
    returning *`;
  return toStrategy(rows[0]!);
}

export async function retireActive(db: Db, kind: SubjectKind, key: string): Promise<void> {
  await db.query`update strategies set status = 'retired' where subject_kind = ${kind} and subject_key = ${key} and status = 'active'`;
}

/** History stays bounded: the newest `adopted` adopted versions and `rejected` rejected candidates per subject. */
export async function trimStrategies(db: Db, kind: SubjectKind, key: string, adopted: number, rejected: number): Promise<void> {
  await db.query`
    delete from strategies
    where subject_kind = ${kind} and subject_key = ${key} and status = 'rejected'
      and id not in (select id from strategies where subject_kind = ${kind} and subject_key = ${key} and status = 'rejected' order by created_at desc, id desc limit ${rejected})`;
  await db.query`
    delete from strategies
    where subject_kind = ${kind} and subject_key = ${key} and status = 'retired'
      and id not in (select id from strategies where subject_kind = ${kind} and subject_key = ${key} and status <> 'rejected' order by version desc limit ${adopted})`;
}
