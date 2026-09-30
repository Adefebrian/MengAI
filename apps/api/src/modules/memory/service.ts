// memory service: self-learning without prompt rewrites. Lessons are short
// facts agents learned; BM25 picks the few that matter for a task, outcomes
// score them (score = (wins + 1) / (uses + 2), uses counted when a use
// closes), weak ones retire, cross-project winners are offered to the JEV
// mem.promote decision by promoteEligible() (the runs engine calls it after
// outcomes are recorded). Skills are saved procedures found by BM25. Run
// digests give later runs a short history of the project.
import type { AgentRole, LessonDTO, LessonScope, LessonStatus, SkillDTO } from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import type { ChatRequest, ChatResult, LlmRouter, ResolvedModel } from "../../core/ports/llm";
import type { DecisionService, MemoryService, RetrieveQuery, UsageService } from "../../core/services";
import { HttpError, notFound } from "../../lib/http";
import { redact, redactDeep } from "../../lib/redact";
import { NEAR_DUPLICATE, bm25, jaccard, shingles } from "./bm25";
import { createMemoryBrain, type MemoryBrain } from "./brain";
import * as repo from "./repo";

export interface MemoryDeps {
  llm: LlmRouter;
  decisions: DecisionService;
  usage: UsageService;
}

export interface PromotionResult {
  lessonId: string;
  scope: "global" | "project" | "discard";
  projects: number;
  merged: number;
}

export type Cursor = repo.Cursor;

export interface MemoryModuleService extends MemoryService, MemoryBrain {
  /** newest first; `before` pages past the last row of the previous page */
  listLessons(f: Omit<repo.LessonFilter, "limit"> & { limit?: number }): Promise<LessonDTO[]>;
  patchLesson(id: string, patch: { status?: LessonStatus; text?: string }): Promise<LessonDTO>;
  deleteLesson(id: string): Promise<void>;
  listSkills(f: { role?: AgentRole; before?: Cursor; limit?: number }): Promise<SkillDTO[]>;
  deleteSkill(id: string): Promise<void>;
  /**
   * Crew-wide skills (role null) by name prefix: the trading desk writes one
   * set per venue ("venue <key>: prices") and every cat reads them.
   */
  sharedSkills(prefix: string): Promise<SkillDTO[]>;
  /** one use of a skill by name, a win or a loss (the desk records fills); false when no skill has the name */
  skillOutcome(name: string, win: boolean): Promise<boolean>;
  /** deletes every crew-wide skill with the prefix; returns how many */
  deleteSharedSkills(prefix: string): Promise<number>;
  /**
   * Offers lessons with wins in 2+ projects to DecisionService.promoteLesson
   * and applies the answer. At most LIMITS.promotePerPass JEV calls per pass,
   * one pass at a time (kv lock); a pass that finds the lock held returns [].
   */
  promoteEligible(): Promise<PromotionResult[]>;
}

export const LIMITS = {
  retrieve: 5,
  retrieveMax: 20,
  retrieveTokens: 400,
  lessonChars: 400,
  tags: 8,
  tagChars: 24,
  reflectOutputTokens: 150,
  reflectNotesChars: 1500,
  skillName: 64,
  skillDescription: 400,
  skillSteps: 30,
  findSkills: 3,
  digestStoreChars: 2000,
  digestBriefTokens: 300,
  digestEach: 500,
  digestRecent: 5,
  list: 200,
  listMax: 500,
  promotePerPass: 5,
  promoteMemoTtlSec: 30 * 24 * 3600,
  /** a group whose JEV call failed is not asked again for this long */
  promoteRetrySec: 3600,
  /** covers promotePerPass JEV calls at their 15s timeout, with margin */
  promoteLockSec: 180,
} as const;

const PROMOTE_LOCK = "mem:promote:lock";

/** Scope width for dedupe: a lesson may merge into one that reaches at least as far. */
const SCOPE_RANK: Record<LessonScope, number> = { project: 0, role: 1, global: 2 };

/** Input rejected after normalizing (same status and code as a zod body failure). */
function invalid(field: string, message: string): HttpError {
  return new HttpError(422, "invalid_body", `${field}: ${message}`);
}

export const THRESHOLDS = { activeScore: 0.6, activeUses: 2, retireScore: 0.3, retireUses: 5 } as const;

/** Status after a closed use. Retired stays retired (only a manual patch revives). */
export function nextStatus(current: LessonStatus, uses: number, score: number): LessonStatus {
  if (current === "retired") return "retired";
  if (uses >= THRESHOLDS.retireUses && score < THRESHOLDS.retireScore) return "retired";
  if (uses >= THRESHOLDS.activeUses && score >= THRESHOLDS.activeScore) return "active";
  return "candidate";
}

const tokensOf = (text: string) => Math.ceil(text.length / 4);

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clipChars(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}

export function normalizeLessonText(text: string): string {
  return clipChars(oneLine(redact(text ?? "")), LIMITS.lessonChars);
}

export function normalizeTags(tags: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const tag = redact(String(raw))
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, LIMITS.tagChars);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}

function resolveScope(input: { scope?: LessonScope; role: AgentRole | null; projectId: string | null }): LessonScope {
  let scope: LessonScope = input.scope ?? (input.projectId ? "project" : input.role ? "role" : "global");
  if (scope === "project" && !input.projectId) scope = input.role ? "role" : "global";
  if (scope === "role" && !input.role) scope = "global";
  return scope;
}

export const REFLECT_SYSTEM =
  "You extract one reusable lesson from an agent task that failed or needed rework. " +
  "A lesson is one or two short sentences a future agent can act on: concrete, about the cause, no people, no secrets. " +
  'Reply with JSON only: {"lesson": "...", "tags": ["..."]}. Reply {"lesson": null} when nothing is reusable.';

export function parseReflection(text: string): { lesson: string; tags: string[] } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as { lesson?: unknown; tags?: unknown };
  if (typeof obj.lesson !== "string") return null;
  const lesson = oneLine(obj.lesson);
  if (lesson.length < 8) return null;
  const tags = Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === "string") : [];
  return { lesson, tags };
}

function reflectPrompt(input: { role: AgentRole; taskTitle: string; outcome: string; notes: string[] }): string {
  const notes: string[] = [];
  let used = 0;
  for (const n of input.notes) {
    const line = `- ${clipChars(oneLine(redact(n)), 300)}`;
    if (used + line.length > LIMITS.reflectNotesChars) break;
    notes.push(line);
    used += line.length;
  }
  return [
    `Role: ${input.role}`,
    `Task: ${clipChars(oneLine(redact(input.taskTitle)), 200)}`,
    `Outcome: ${clipChars(oneLine(redact(input.outcome)), 400)}`,
    notes.length ? `Notes:\n${notes.join("\n")}` : "Notes: none",
  ].join("\n");
}

function normalizeSteps(steps: SkillDTO["steps"]): SkillDTO["steps"] {
  if (!Array.isArray(steps)) throw invalid("steps", "must be an array");
  if (steps.length === 0) throw invalid("steps", "skill needs at least one step");
  if (steps.length > LIMITS.skillSteps) throw invalid("steps", `skill has more than ${LIMITS.skillSteps} steps`);
  return steps.map((s) => {
    const tool = typeof s?.tool === "string" ? redact(s.tool.trim()).slice(0, 64) : "";
    if (!tool) throw invalid("steps", "every skill step needs a tool");
    const args = s.args && typeof s.args === "object" && !Array.isArray(s.args) ? redactDeep(s.args) : {};
    const step: SkillDTO["steps"][number] = { tool, args };
    if (typeof s.note === "string" && s.note.trim()) step.note = clipChars(oneLine(redact(s.note)), 200);
    return step;
  });
}

export function createMemoryService(ctx: ModuleContext, deps: MemoryDeps): MemoryModuleService {
  const { db, clock, kv } = ctx;
  const log = ctx.logger.child({ module: "memory" });

  async function publish(lesson: LessonDTO, runId: string | null): Promise<void> {
    try {
      await ctx.events.publish({ type: "lesson.recorded", runId, data: { lesson } });
    } catch (err) {
      log.log("warn", "lesson.recorded publish failed", { error: redact(String(err)) });
    }
  }

  async function retrieve(q: RetrieveQuery): Promise<LessonDTO[]> {
    const limit = Math.min(LIMITS.retrieveMax, Math.max(1, Math.floor(q.limit ?? LIMITS.retrieve)));
    const budget = Math.max(0, Math.floor(q.tokenBudget ?? LIMITS.retrieveTokens));
    const lessons = await repo.scopedLessons(db, { role: q.role, projectId: q.projectId, includeRetired: false });
    // BM25 relevance, nudged by track record: factor 0.5 (score 0) to 1.5 (score 1)
    const ranked = bm25(q.text, lessons.map((l) => ({ item: l, text: `${l.text} ${l.tags.join(" ")}` })))
      .map((r) => ({ lesson: r.item, rank: r.score * (0.5 + r.item.score) }))
      .sort((a, b) => b.rank - a.rank || b.lesson.score - a.lesson.score);
    const out: LessonDTO[] = [];
    let used = 0;
    for (const { lesson } of ranked) {
      if (out.length >= limit) break;
      const cost = tokensOf(`- ${lesson.text}\n`);
      if (used + cost > budget) continue;
      out.push(lesson);
      used += cost;
    }
    return out;
  }

  async function markUsed(lessonIds: string[], use: { runId: string; taskId: string }): Promise<void> {
    const ids = [...new Set(lessonIds.filter((id) => typeof id === "string" && id.length > 0))];
    if (ids.length === 0) return;
    const now = clock.now();
    await db.tx(async (tx) => {
      for (const id of ids) {
        if (!(await repo.lessonExists(tx, id))) continue;
        if (await repo.insertUse(tx, { lessonId: id, taskId: use.taskId, runId: use.runId, now })) {
          await repo.touchLesson(tx, id, now);
        }
      }
    });
  }

  async function recordOutcome(o: { runId: string; taskId: string; success: boolean }): Promise<void> {
    const outcome = o.success ? "win" : "loss";
    await db.tx(async (tx) => {
      for (const id of await repo.openUses(tx, o.runId, o.taskId)) {
        if (!(await repo.closeUse(tx, id, o.taskId, outcome))) continue;
        const updated = await repo.applyOutcome(tx, id, o.success);
        if (!updated) continue;
        const status = nextStatus(updated.status, updated.uses, updated.score);
        if (status !== updated.status) await repo.setStatusIfUses(tx, id, status, updated.uses);
      }
    });
  }

  async function record(input: {
    text: string;
    tags?: string[];
    role: AgentRole | null;
    projectId: string | null;
    runId: string | null;
    scope?: LessonScope;
  }): Promise<LessonDTO> {
    const text = normalizeLessonText(input.text);
    if (!text) throw invalid("text", "lesson text is empty");
    const tags = normalizeTags(input.tags);
    const scope = resolveScope(input);

    // near-duplicate merge against the lessons the recorder can see that
    // reach at least as far as the requested scope: a narrower copy never
    // swallows an explicit wider scope (widening it would skip mem.promote).
    // A live copy wins over a retired one (retired lessons are never
    // retrieved); a retired copy only absorbs a restatement when it is the
    // only match, so a lesson retired for doing badly is not re-learned.
    const visible = await repo.scopedLessons(db, { role: input.role, projectId: input.projectId, includeRetired: true });
    const sh = shingles(text);
    let best: { lesson: LessonDTO; sim: number; live: boolean } | null = null;
    for (const l of visible) {
      if (SCOPE_RANK[l.scope] < SCOPE_RANK[scope]) continue;
      const sim = jaccard(sh, shingles(l.text));
      if (sim < NEAR_DUPLICATE) continue;
      const live = l.status !== "retired";
      if (!best || (live && !best.live) || (live === best.live && sim > best.sim)) best = { lesson: l, sim, live };
    }
    if (best) {
      const merged = [...best.lesson.tags];
      for (const t of tags) if (!merged.includes(t) && merged.length < LIMITS.tags) merged.push(t);
      const lesson =
        merged.length !== best.lesson.tags.length ? ((await repo.setLessonTags(db, best.lesson.id, merged)) ?? best.lesson) : best.lesson;
      await publish(lesson, input.runId);
      return lesson;
    }

    const lesson = await repo.insertLesson(db, {
      id: clock.id(),
      scope,
      role: input.role,
      projectId: scope === "project" ? input.projectId : null,
      text,
      tags,
      sourceRunId: input.runId,
      now: clock.now(),
    });
    await publish(lesson, input.runId);
    return lesson;
  }

  async function recordReflectUsage(
    input: { runId: string; taskId: string },
    resolved: ResolvedModel,
    result: ChatResult | null,
    error: string | null,
    started: number,
  ): Promise<void> {
    try {
      await deps.usage.record({
        runId: input.runId,
        agentId: null,
        taskId: input.taskId,
        providerId: resolved.provider.id,
        model: result?.model || resolved.model,
        purpose: "reflect",
        usage: result?.usage ?? { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 },
        latencyMs: result?.latencyMs ?? Math.max(0, clock.now() - started),
        retries: result?.retries ?? 0,
        ok: result !== null,
        error,
      });
    } catch (err) {
      log.log("warn", "reflect usage record failed", { error: redact(String(err)) });
    }
  }

  async function reflect(input: {
    runId: string;
    taskId: string;
    projectId: string;
    role: AgentRole;
    taskTitle: string;
    outcome: string;
    notes: string[];
  }): Promise<LessonDTO | null> {
    try {
      if (!(await deps.llm.configured())) return null;
    } catch {
      return null;
    }
    let resolved: ResolvedModel;
    try {
      resolved = await deps.llm.resolve({ tier: "fast" });
    } catch (err) {
      log.log("info", "reflect skipped: no fast tier model", { error: redact(String(err)) });
      return null;
    }
    const req: ChatRequest = {
      model: resolved.model,
      system: REFLECT_SYSTEM,
      messages: [{ role: "user", content: reflectPrompt(input) }],
      maxOutputTokens: LIMITS.reflectOutputTokens,
      temperature: 0,
      responseFormat: "json",
    };
    const started = clock.now();
    let result: ChatResult;
    try {
      result = await resolved.provider.chat(req);
    } catch (err) {
      const message = redact(err instanceof Error ? err.message : String(err));
      await recordReflectUsage(input, resolved, null, message, started);
      log.log("warn", "reflect call failed", { error: message });
      return null;
    }
    await recordReflectUsage(input, resolved, result, null, started);
    const parsed = parseReflection(result.text);
    if (!parsed) return null;
    return record({
      text: parsed.lesson,
      tags: parsed.tags,
      role: input.role,
      projectId: input.projectId,
      runId: input.runId,
      scope: "project",
    });
  }

  async function saveSkill(input: { name: string; description: string; role: AgentRole | null; steps: SkillDTO["steps"] }): Promise<SkillDTO> {
    const name = oneLine(redact(input.name ?? "")).slice(0, LIMITS.skillName);
    if (!name) throw invalid("name", "skill name is empty");
    const description = clipChars(oneLine(redact(input.description ?? "")), LIMITS.skillDescription);
    if (!description) throw invalid("description", "skill description is empty");
    const steps = normalizeSteps(input.steps);
    const now = clock.now();
    return repo.upsertSkill(db, { id: clock.id(), name, description, role: input.role ?? null, steps, now });
  }

  async function findSkills(q: { text: string; role?: AgentRole; limit?: number }): Promise<SkillDTO[]> {
    const limit = Math.min(LIMITS.retrieveMax, Math.max(1, Math.floor(q.limit ?? LIMITS.findSkills)));
    const skills = await repo.skillsFor(db, q.role ?? null);
    return bm25(q.text, skills.map((s) => ({ item: s, text: `${s.name} ${s.description}` })))
      .slice(0, limit)
      .map((r) => r.item);
  }

  async function runDigest(projectId: string): Promise<string | null> {
    const digests = await repo.recentDigests(db, projectId, LIMITS.digestRecent);
    if (digests.length === 0) return null;
    const maxChars = LIMITS.digestBriefTokens * 4;
    const lines = ["Earlier runs on this project, newest first:"];
    let size = lines[0]!.length;
    for (const d of digests) {
      const line = `- ${clipChars(oneLine(d.text), LIMITS.digestEach)}`;
      if (size + line.length + 1 > maxChars) break;
      lines.push(line);
      size += line.length + 1;
    }
    return lines.length > 1 ? lines.join("\n") : null;
  }

  /** Stores only: promotion is promoteEligible(), called once outcomes are in. */
  async function saveRunDigest(input: { projectId: string; runId: string; text: string }): Promise<void> {
    const text = clipChars(redact(input.text ?? "").trim(), LIMITS.digestStoreChars);
    if (!text) return;
    await repo.replaceDigest(db, {
      id: clock.id(),
      runId: input.runId,
      projectId: input.projectId,
      text,
      tokens: tokensOf(text),
      now: clock.now(),
    });
  }

  async function promoteEligible(): Promise<PromotionResult[]> {
    const token = clock.id();
    if (!(await kv.setNx(PROMOTE_LOCK, token, LIMITS.promoteLockSec))) return [];
    try {
      return await promotePass();
    } finally {
      try {
        if ((await kv.get(PROMOTE_LOCK)) === token) await kv.del(PROMOTE_LOCK);
      } catch (err) {
        log.log("warn", "promotion lock release failed", { error: redact(String(err)) });
      }
    }
  }

  /**
   * Best effort: a memo that cannot be written only means the group may be
   * asked again next pass; it must not undo an applied answer or end the pass.
   */
  async function remember(key: string, value: string, ttlSec: number): Promise<void> {
    try {
      await kv.set(key, value, ttlSec);
    } catch (err) {
      log.log("warn", "promotion memo write failed", { error: redact(String(err)) });
    }
  }

  async function promotePass(): Promise<PromotionResult[]> {
    const lessons = await repo.nonGlobalLessons(db);
    if (lessons.length === 0) return [];
    const projectsOf = new Map<string, Set<string>>();
    const add = (id: string, project: string) => {
      const set = projectsOf.get(id) ?? new Set<string>();
      set.add(project);
      projectsOf.set(id, set);
    };
    for (const w of await repo.winProjects(db)) add(w.lessonId, w.projectId);
    for (const l of lessons) if (l.scope === "project" && l.projectId && l.wins > 0) add(l.id, l.projectId);

    // only lessons with a winning project can reach the 2-project bar, so
    // only they are clustered (union-find over near duplicates)
    const winners = lessons.filter((l) => projectsOf.has(l.id));
    if (winners.length === 0) return [];
    const sh = new Map<string, Set<string>>();
    const shOf = (l: LessonDTO) => {
      let v = sh.get(l.id);
      if (!v) sh.set(l.id, (v = shingles(l.text)));
      return v;
    };
    const parent = winners.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    for (let i = 0; i < winners.length; i++) {
      for (let j = i + 1; j < winners.length; j++) {
        if (jaccard(shOf(winners[i]!), shOf(winners[j]!)) >= NEAR_DUPLICATE) parent[find(j)] = find(i);
      }
    }
    const groups = new Map<number, LessonDTO[]>();
    winners.forEach((l, i) => {
      const root = find(i);
      groups.set(root, [...(groups.get(root) ?? []), l]);
    });

    const winnerIds = new Set(winners.map((l) => l.id));
    let globals: LessonDTO[] | null = null;
    const results: PromotionResult[] = [];
    let asked = 0;
    for (const group of groups.values()) {
      const projects = new Set<string>();
      for (const l of group) for (const p of projectsOf.get(l.id) ?? []) projects.add(p);
      if (projects.size < 2) continue;
      const rep = [...group].sort((a, b) => b.score - a.score || b.wins - a.wins || a.createdAt - b.createdAt)[0]!;
      const memo = `mem:promote:${rep.id}:${projects.size}`;
      if (await kv.get(memo)) continue;
      // the cap counts JEV attempts, so failing calls cannot run unbounded
      if (asked >= LIMITS.promotePerPass) break;
      asked++;

      const totals = group.reduce((t, l) => ({ uses: t.uses + l.uses, wins: t.wins + l.wins, losses: t.losses + l.losses }), {
        uses: 0,
        wins: 0,
        losses: 0,
      });
      globals ??= await repo.globalLessons(db);
      const existing = bm25(rep.text, globals.map((g) => ({ item: g, text: g.text })))
        .slice(0, 5)
        .map((r) => r.item.text);
      let answer: Awaited<ReturnType<DecisionService["promoteLesson"]>>;
      try {
        answer = await deps.decisions.promoteLesson({
          lesson: rep.text,
          context: redact(
            `Lesson learned by the ${rep.role ?? "crew"} role; won in ${projects.size} projects; ` +
              `uses ${totals.uses}, wins ${totals.wins}, losses ${totals.losses}; ${group.length} near-duplicate copies.`,
          ),
          existing,
          projects: projects.size,
        });
      } catch (err) {
        log.log("warn", "promoteLesson failed", { lessonId: rep.id, error: redact(String(err)) });
        await remember(memo, "error", LIMITS.promoteRetrySec);
        continue;
      }
      // JEV be.promote_unverified_policy: defer_like_failure. A heuristic
      // fallback (stamped UNVERIFIED BY JEV) never merges or retires lessons;
      // the group backs off and JEV is asked again after the retry window.
      // Prechecks (verified false, no stamp) are rules, and are applied.
      if (answer.decision.stamp !== null) {
        log.log("info", "promotion deferred: unverified decision", { lessonId: rep.id, stamp: answer.decision.stamp });
        await remember(memo, "error", LIMITS.promoteRetrySec);
        continue;
      }

      // copies that never won anywhere were not clustered: fold the ones
      // that restate the rep so the answer covers every copy
      const members = [...group];
      if (answer.scope !== "project") {
        for (const l of lessons) if (!winnerIds.has(l.id) && jaccard(shOf(rep), shOf(l)) >= NEAR_DUPLICATE) members.push(l);
      }

      let merged = 0;
      try {
        if (answer.scope === "global") {
          const moved = await db.tx(async (tx) => {
            const current = await repo.getLesson(tx, rep.id);
            if (!current || current.scope === "global") return null;
            let n = 0;
            for (const member of members) {
              if (member.id !== rep.id && (await repo.mergeLessonInto(tx, rep.id, member.id))) n++;
            }
            const g = await repo.moveToGlobal(tx, rep.id);
            if (!g) return null;
            const status = nextStatus(g.status, g.uses, g.score);
            if (status !== g.status) await repo.setStatus(tx, g.id, status);
            merged = n;
            return { ...g, status };
          });
          if (moved) await publish(moved, null);
        } else if (answer.scope === "discard") {
          await db.tx(async (tx) => {
            for (const member of members) await repo.setStatus(tx, member.id, "retired");
          });
        }
      } catch (err) {
        // rolled back as a whole; no memo, so the next pass asks again
        log.log("warn", "lesson promotion apply failed", { lessonId: rep.id, error: redact(String(err)) });
        continue;
      }
      await remember(memo, answer.scope, LIMITS.promoteMemoTtlSec);
      results.push({ lessonId: rep.id, scope: answer.scope, projects: projects.size, merged });
    }
    return results;
  }

  const brain = createMemoryBrain(ctx, { llm: deps.llm, usage: deps.usage });

  return {
    ...brain,
    retrieve,
    markUsed,
    recordOutcome,
    record,
    reflect,
    saveSkill,
    findSkills,
    runDigest,
    saveRunDigest,
    promoteEligible,

    async listLessons(f) {
      const limit = Math.min(LIMITS.listMax, Math.max(1, Math.floor(f.limit ?? LIMITS.list)));
      return repo.listLessons(db, { ...f, limit });
    },
    async patchLesson(id, patch) {
      const p: { status?: LessonStatus; text?: string } = {};
      if (patch.status !== undefined) p.status = patch.status;
      if (patch.text !== undefined) {
        const text = normalizeLessonText(patch.text);
        if (!text) throw invalid("text", "lesson text is empty");
        p.text = text;
      }
      if (p.status === undefined && p.text === undefined) throw invalid("body", "status or text is required");
      const lesson = await repo.patchLesson(db, id, p);
      if (!lesson) throw notFound("lesson");
      return lesson;
    },
    async deleteLesson(id) {
      if (!(await repo.deleteLesson(db, id))) throw notFound("lesson");
    },
    async listSkills(f) {
      const limit = Math.min(LIMITS.listMax, Math.max(1, Math.floor(f.limit ?? LIMITS.list)));
      return repo.listSkills(db, { role: f.role, before: f.before, limit });
    },
    async deleteSkill(id) {
      if (!(await repo.deleteSkill(db, id))) throw notFound("skill");
    },
    async sharedSkills(prefix) {
      const p = String(prefix ?? "");
      if (!p.trim()) return [];
      return repo.sharedSkills(db, p);
    },
    async skillOutcome(name, win) {
      return repo.skillOutcome(db, String(name ?? ""), win === true, clock.now());
    },
    async deleteSharedSkills(prefix) {
      const p = String(prefix ?? "");
      if (!p.trim()) return 0;
      let n = 0;
      for (const s of await repo.sharedSkills(db, p)) if (await repo.deleteSkill(db, s.id)) n++;
      return n;
    },
  };
}
