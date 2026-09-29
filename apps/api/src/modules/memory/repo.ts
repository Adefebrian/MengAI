// memory repo: lessons, lesson_uses, skills, and the run_digest rows of
// summaries. Portable SQL only (Bun.SQL on SQLite and Postgres): every
// ${value} is a bound parameter, optional filters use cast(x as text) so
// Postgres can type a null parameter, scores are computed with 1.0 literals
// so neither dialect does integer division.
import type { AgentRole, LessonDTO, LessonScope, LessonStatus, SkillDTO } from "@mengai/shared";
import type { Db, Row } from "../../core/ports/db";
import { b01, json, num, numOrNull, toJson } from "../../lib/sql";

// ------------------------------------------------------------------ lessons
export function toLesson(r: Row): LessonDTO {
  return {
    id: String(r.id),
    scope: String(r.scope) as LessonScope,
    role: (r.role ?? null) as AgentRole | null,
    projectId: (r.project_id ?? null) as string | null,
    text: String(r.text),
    tags: json<string[]>(r.tags, []),
    status: String(r.status) as LessonStatus,
    uses: num(r.uses),
    wins: num(r.wins),
    losses: num(r.losses),
    score: num(r.score),
    createdAt: num(r.created_at),
    lastUsedAt: numOrNull(r.last_used_at),
  };
}

/** Lessons visible to (role, project): global, role-scoped for this role, project-scoped for this project. */
export async function scopedLessons(
  db: Db,
  q: { role: AgentRole | null; projectId: string | null; includeRetired: boolean },
): Promise<LessonDTO[]> {
  const rows = await db.query`
    select * from lessons
    where (${b01(q.includeRetired)} = 1 or status <> 'retired')
      and (scope = 'global'
        or (scope = 'role' and role = ${q.role})
        or (scope = 'project' and project_id = ${q.projectId}))
    order by created_at asc, id asc`;
  return rows.map(toLesson);
}

/** Keyset cursor for newest-first lists: rows strictly older than (createdAt, id). */
export interface Cursor {
  createdAt: number;
  id: string;
}

// No cursor means "older than everything": a sentinel keeps the SQL free of
// nullable parameters (Postgres cannot type a bare null in a comparison).
const NO_CURSOR: Cursor = { createdAt: Number.MAX_SAFE_INTEGER, id: "" };

export interface LessonFilter {
  status?: LessonStatus;
  scope?: LessonScope;
  projectId?: string;
  role?: AgentRole;
  before?: Cursor;
  limit: number;
}

export async function listLessons(db: Db, f: LessonFilter): Promise<LessonDTO[]> {
  const status = f.status ?? null;
  const scope = f.scope ?? null;
  const projectId = f.projectId ?? null;
  const role = f.role ?? null;
  const c = f.before ?? NO_CURSOR;
  const rows = await db.query`
    select * from lessons
    where (cast(${status} as text) is null or status = ${status})
      and (cast(${scope} as text) is null or scope = ${scope})
      and (cast(${projectId} as text) is null or project_id = ${projectId})
      and (cast(${role} as text) is null or role = ${role})
      and (created_at < ${c.createdAt} or (created_at = ${c.createdAt} and id < ${c.id}))
    order by created_at desc, id desc
    limit ${f.limit}`;
  return rows.map(toLesson);
}

export async function nonGlobalLessons(db: Db): Promise<LessonDTO[]> {
  const rows = await db.query`select * from lessons where scope <> 'global' and status <> 'retired' order by created_at asc, id asc`;
  return rows.map(toLesson);
}

export async function globalLessons(db: Db): Promise<LessonDTO[]> {
  const rows = await db.query`select * from lessons where scope = 'global' and status <> 'retired' order by created_at asc, id asc`;
  return rows.map(toLesson);
}

export async function getLesson(db: Db, id: string): Promise<LessonDTO | null> {
  const rows = await db.query`select * from lessons where id = ${id}`;
  return rows[0] ? toLesson(rows[0]) : null;
}

export async function insertLesson(
  db: Db,
  l: { id: string; scope: LessonScope; role: AgentRole | null; projectId: string | null; text: string; tags: string[]; sourceRunId: string | null; now: number },
): Promise<LessonDTO> {
  const rows = await db.query`
    insert into lessons (id, scope, role, project_id, text, tags, status, uses, wins, losses, score, source_run_id, created_at, last_used_at)
    values (${l.id}, ${l.scope}, ${l.role}, ${l.projectId}, ${l.text}, ${toJson(l.tags)}, 'candidate', 0, 0, 0, 0.5, ${l.sourceRunId}, ${l.now}, null)
    returning *`;
  return toLesson(rows[0]!);
}

export async function setLessonTags(db: Db, id: string, tags: string[]): Promise<LessonDTO | null> {
  const rows = await db.query`update lessons set tags = ${toJson(tags)} where id = ${id} returning *`;
  return rows[0] ? toLesson(rows[0]) : null;
}

export async function patchLesson(db: Db, id: string, p: { status?: LessonStatus; text?: string }): Promise<LessonDTO | null> {
  const status = p.status ?? null;
  const text = p.text ?? null;
  const rows = await db.query`
    update lessons
    set status = coalesce(cast(${status} as text), status),
        text = coalesce(cast(${text} as text), text)
    where id = ${id}
    returning *`;
  return rows[0] ? toLesson(rows[0]) : null;
}

export async function deleteLesson(db: Db, id: string): Promise<boolean> {
  return db.tx(async (tx) => {
    await tx.query`delete from lesson_uses where lesson_id = ${id}`;
    const rows = await tx.query`delete from lessons where id = ${id} returning id`;
    return rows.length > 0;
  });
}

export async function lessonExists(db: Db, id: string): Promise<boolean> {
  const rows = await db.query`select id from lessons where id = ${id}`;
  return rows.length > 0;
}

export async function touchLesson(db: Db, id: string, now: number): Promise<void> {
  await db.query`update lessons set last_used_at = ${now} where id = ${id}`;
}

/** Closed-use accounting: uses, wins, losses and score move together in one statement. */
export async function applyOutcome(db: Db, id: string, win: boolean): Promise<LessonDTO | null> {
  const w = win ? 1 : 0;
  const l = win ? 0 : 1;
  const rows = await db.query`
    update lessons
    set uses = uses + 1,
        wins = wins + ${w},
        losses = losses + ${l},
        score = (wins + ${w} + 1.0) / (uses + 3.0)
    where id = ${id}
    returning *`;
  return rows[0] ? toLesson(rows[0]) : null;
}

/** Writes the status only if no other outcome landed in between (uses unchanged). */
export async function setStatusIfUses(db: Db, id: string, status: LessonStatus, uses: number): Promise<void> {
  await db.query`update lessons set status = ${status} where id = ${id} and uses = ${uses}`;
}

export async function setStatus(db: Db, id: string, status: LessonStatus): Promise<void> {
  await db.query`update lessons set status = ${status} where id = ${id}`;
}

export async function moveToGlobal(db: Db, id: string): Promise<LessonDTO | null> {
  const rows = await db.query`update lessons set scope = 'global', project_id = null where id = ${id} returning *`;
  return rows[0] ? toLesson(rows[0]) : null;
}

/**
 * Folds `memberId` (stats and uses) into `repId`, then deletes the member.
 * One use per lesson and task: when both were used on the same task the
 * rep's row wins, the member's row is dropped, and the member's closed
 * outcome on that task is not added (it would count the task twice).
 * Returns false when the member no longer exists.
 */
export async function mergeLessonInto(db: Db, repId: string, memberId: string): Promise<boolean> {
  return db.tx(async (tx) => {
    const rows = await tx.query`select uses, wins, losses from lessons where id = ${memberId}`;
    const m = rows[0];
    if (!m) return false;
    const [dup] = await tx.query`
      select
        coalesce(sum(case when outcome is null then 0 else 1 end), 0) as uses,
        coalesce(sum(case when outcome = 'win' then 1 else 0 end), 0) as wins,
        coalesce(sum(case when outcome = 'loss' then 1 else 0 end), 0) as losses
      from lesson_uses
      where lesson_id = ${memberId}
        and task_id in (select task_id from lesson_uses where lesson_id = ${repId})`;
    const mu = Math.max(0, num(m.uses) - num(dup?.uses));
    const mw = Math.max(0, num(m.wins) - num(dup?.wins));
    const ml = Math.max(0, num(m.losses) - num(dup?.losses));
    await tx.query`
      update lessons
      set uses = uses + ${mu},
          wins = wins + ${mw},
          losses = losses + ${ml},
          score = (wins + ${mw} + 1.0) / (uses + ${mu} + 2.0)
      where id = ${repId}`;
    await tx.query`
      update lesson_uses set lesson_id = ${repId}
      where lesson_id = ${memberId}
        and task_id not in (select task_id from lesson_uses where lesson_id = ${repId})`;
    await tx.query`delete from lesson_uses where lesson_id = ${memberId}`;
    await tx.query`delete from lessons where id = ${memberId}`;
    return true;
  });
}

// -------------------------------------------------------------- lesson_uses
/** true when this call created the use (one use per lesson and task). */
export async function insertUse(db: Db, u: { lessonId: string; taskId: string; runId: string; now: number }): Promise<boolean> {
  const rows = await db.query`
    insert into lesson_uses (lesson_id, task_id, run_id, outcome, created_at)
    values (${u.lessonId}, ${u.taskId}, ${u.runId}, null, ${u.now})
    on conflict (lesson_id, task_id) do nothing
    returning lesson_id`;
  return rows.length > 0;
}

export async function openUses(db: Db, runId: string, taskId: string): Promise<string[]> {
  const rows = await db.query<{ lesson_id: string }>`
    select lesson_id from lesson_uses where run_id = ${runId} and task_id = ${taskId} and outcome is null order by lesson_id`;
  return rows.map((r) => String(r.lesson_id));
}

/** true when this call closed the use (guards double closing). */
export async function closeUse(db: Db, lessonId: string, taskId: string, outcome: "win" | "loss"): Promise<boolean> {
  const rows = await db.query`
    update lesson_uses set outcome = ${outcome}
    where lesson_id = ${lessonId} and task_id = ${taskId} and outcome is null
    returning lesson_id`;
  return rows.length > 0;
}

// -------------------------------------------------------------- run digests
export const DIGEST_KIND = "run_digest";

// summaries has no project_id column yet, and a run digest has no task, so
// the project id of a run_digest row lives in summaries.task_id (indexed by
// summaries_task_idx). This is the only place that knows it: once a
// migration adds summaries.project_id, only these three functions change.
export async function replaceDigest(
  db: Db,
  d: { id: string; runId: string; projectId: string; text: string; tokens: number; now: number },
): Promise<void> {
  await db.tx(async (tx) => {
    await tx.query`delete from summaries where run_id = ${d.runId} and kind = ${DIGEST_KIND}`;
    await tx.query`
      insert into summaries (id, run_id, agent_id, task_id, kind, text, tokens, covers_to, created_at)
      values (${d.id}, ${d.runId}, null, ${d.projectId}, ${DIGEST_KIND}, ${d.text}, ${d.tokens}, 0, ${d.now})`;
  });
}

export async function recentDigests(db: Db, projectId: string, limit: number): Promise<Array<{ runId: string; text: string; createdAt: number }>> {
  const rows = await db.query`
    select run_id, text, created_at from summaries
    where task_id = ${projectId} and kind = ${DIGEST_KIND}
    order by created_at desc, id desc
    limit ${limit}`;
  return rows.map((r) => ({ runId: String(r.run_id), text: String(r.text), createdAt: num(r.created_at) }));
}

/** (lesson, project) pairs for every winning use whose run has a digest. */
export async function winProjects(db: Db): Promise<Array<{ lessonId: string; projectId: string }>> {
  const rows = await db.query`
    select distinct lu.lesson_id as lesson_id, s.task_id as project_id
    from lesson_uses lu
    join summaries s on s.run_id = lu.run_id and s.kind = ${DIGEST_KIND}
    where lu.outcome = 'win' and s.task_id is not null`;
  return rows.map((r) => ({ lessonId: String(r.lesson_id), projectId: String(r.project_id) }));
}

// ------------------------------------------------------------------- skills
export function toSkill(r: Row): SkillDTO {
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description),
    role: (r.role ?? null) as AgentRole | null,
    steps: json<SkillDTO["steps"]>(r.steps, []),
    uses: num(r.uses),
    wins: num(r.wins),
    createdAt: num(r.created_at),
  };
}

export async function upsertSkill(
  db: Db,
  s: { id: string; name: string; description: string; role: AgentRole | null; steps: SkillDTO["steps"]; now: number },
): Promise<SkillDTO> {
  const rows = await db.query`
    insert into skills (id, name, description, role, steps, uses, wins, created_at, updated_at)
    values (${s.id}, ${s.name}, ${s.description}, ${s.role}, ${toJson(s.steps)}, 0, 0, ${s.now}, ${s.now})
    on conflict (owner_id, name) do update
      set description = excluded.description,
          role = excluded.role,
          steps = excluded.steps,
          updated_at = excluded.updated_at
    returning *`;
  return toSkill(rows[0]!);
}

export async function listSkills(db: Db, f: { role?: AgentRole; before?: Cursor; limit: number }): Promise<SkillDTO[]> {
  const role = f.role ?? null;
  const c = f.before ?? NO_CURSOR;
  const rows = await db.query`
    select * from skills
    where (cast(${role} as text) is null or role = ${role})
      and (created_at < ${c.createdAt} or (created_at = ${c.createdAt} and id < ${c.id}))
    order by created_at desc, id desc
    limit ${f.limit}`;
  return rows.map(toSkill);
}

/** Skills a role may recall: its own plus role-less ones (all when role is null). */
export async function skillsFor(db: Db, role: AgentRole | null): Promise<SkillDTO[]> {
  const rows = await db.query`
    select * from skills
    where cast(${role} as text) is null or role is null or role = ${role}
    order by created_at asc, id asc`;
  return rows.map(toSkill);
}

export async function deleteSkill(db: Db, id: string): Promise<boolean> {
  const rows = await db.query`delete from skills where id = ${id} returning id`;
  return rows.length > 0;
}
