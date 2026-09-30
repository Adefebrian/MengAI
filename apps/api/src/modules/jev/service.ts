// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// DecisionService: runs a catalog plan end to end.
//   precheck in code -> kv cache (10 min, identical decisionId + state + questions,
//   verified answers that fit the questions only)
//   -> Judge -> catalog thresholds and low-confidence rules
//   -> deterministic fallback stamped UNVERIFIED BY JEV when the Judge is unverified
//   -> persisted in decisions and published as a `decision` event.
// State is redacted before it is hashed, cached, sent or stored.
import type { DecisionDTO } from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import type { JevAnswer, Judge, JudgeResult } from "../../core/ports/judge";
import type { DecisionService } from "../../core/services";
import { clip, redact, redactDeep } from "../../lib/redact";
import {
  domainOf,
  planEscalate,
  planLoopExit,
  planModelTier,
  planPromoteLesson,
  planRoute,
  planSeverity,
  type DecisionPlan,
  type Outcome,
} from "./catalog";
import { createDecisionsRepo } from "./repo";

export const UNVERIFIED_STAMP = "UNVERIFIED BY JEV";
export const DECISION_CACHE_TTL_SEC = 600;
export const DEFAULT_LIST_LIMIT = 200;
export const MAX_LIST_LIMIT = 500;

export interface JevDeps {
  judge: Judge;
}

export interface JevDecisionService extends DecisionService {
  list(runId?: string, opts?: { limit?: number }): Promise<DecisionDTO[]>;
}

/** JSON with object keys sorted at every level, so equal values hash equally. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        const x = (v as Record<string, unknown>)[k];
        if (x !== undefined) out[k] = norm(x);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

interface CachedJudgement {
  at: number;
  model: string;
  answers: Record<string, JevAnswer>;
}

export function createDecisionService(ctx: ModuleContext, deps: JevDeps): JevDecisionService {
  const repo = createDecisionsRepo(ctx.db);
  const log = ctx.logger.child({ module: "jev" });

  async function readCache(key: string): Promise<CachedJudgement | null> {
    try {
      const raw = await ctx.kv.get(key);
      if (!raw) return null;
      const c = JSON.parse(raw) as CachedJudgement;
      if (typeof c.at !== "number" || !c.answers || ctx.clock.now() - c.at > DECISION_CACHE_TTL_SEC * 1000) return null;
      return c;
    } catch {
      return null;
    }
  }

  async function writeCache(key: string, value: CachedJudgement): Promise<void> {
    try {
      await ctx.kv.set(key, JSON.stringify(value), DECISION_CACHE_TTL_SEC);
    } catch (err) {
      log.log("warn", "decision cache write failed", { error: redact(String(err)) });
    }
  }

  async function judge(plan: DecisionPlan<unknown>, state: Record<string, unknown>): Promise<JudgeResult> {
    try {
      return await deps.judge.decide({ decisionId: plan.decisionId, state, questions: plan.questions });
    } catch (err) {
      return { verified: false, stamp: UNVERIFIED_STAMP, error: err instanceof Error ? err.message : String(err), latencyMs: 0 };
    }
  }

  async function run<R>(plan: DecisionPlan<R>): Promise<{ result: R; decision: DecisionDTO }> {
    const state = redactDeep(plan.state);
    const questions = redactDeep(plan.questions);
    const stateDigest = sha256(canonicalJson(state));

    let outcome: Outcome<R>;
    let verified = false;
    let stamp: string | null = null;
    let latencyMs = 0;

    if (plan.precheck) {
      const { rule, ...rest } = plan.precheck;
      outcome = { ...rest, answers: { precheck: rule, ...rest.answers } };
    } else {
      const key = `jev:decision:${sha256(canonicalJson({ decisionId: plan.decisionId, state, questions }))}`;
      let answers: Record<string, JevAnswer> | null = null;
      let error = "";
      const cached = await readCache(key);
      let interpreted = cached ? plan.interpret(cached.answers) : null;
      if (interpreted) {
        answers = cached!.answers;
      } else {
        // a cache entry that no longer fits the questions is ignored and JEV is asked again
        const res = await judge(plan as DecisionPlan<unknown>, state);
        latencyMs = res.latencyMs;
        if (res.verified) {
          answers = res.answers;
          interpreted = plan.interpret(res.answers);
          // only answers that fit the questions are cached, so a malformed
          // verified reply is never served again for the next 10 minutes
          if (interpreted) await writeCache(key, { at: ctx.clock.now(), model: res.model, answers: res.answers });
        } else {
          error = res.error;
        }
      }
      if (interpreted) {
        outcome = interpreted;
        verified = true;
      } else {
        if (answers) error = "JEV answers did not match the questions";
        const fb = plan.fallback();
        outcome = { ...fb, answers: { ...fb.answers, error: clip(error || "judge unavailable", 200) } };
        stamp = UNVERIFIED_STAMP;
        log.log("warn", "decision fell back", { decisionId: plan.decisionId, error: clip(error, 200) });
      }
    }

    const decision = await repo.insert({
      id: ctx.clock.id(),
      runId: plan.runId,
      decisionId: plan.decisionId,
      domain: domainOf(plan.decisionId),
      stateDigest,
      questions,
      answers: redactDeep(outcome.answers),
      action: clip(outcome.action, 200),
      confidence: outcome.confidence,
      verified,
      stamp,
      latencyMs,
      createdAt: ctx.clock.now(),
    });
    await ctx.events.publish({ type: "decision", runId: plan.runId, data: { decision } });
    log.log("info", "decision", { decisionId: plan.decisionId, action: decision.action, verified, stamp });
    return { result: outcome.result, decision };
  }

  return {
    async route(input) {
      const { result, decision } = await run(planRoute(input));
      return { role: result.role, split: result.split, decision };
    },
    async modelTier(input) {
      const { result, decision } = await run(planModelTier(input));
      return { tier: result, decision };
    },
    async loopExit(input) {
      const { result, decision } = await run(planLoopExit(input));
      return { next: result.next, meetsAsk: result.meetsAsk, decision };
    },
    async escalate(input) {
      const { result, decision } = await run(planEscalate(input));
      return { decider: result.decider, reversible: result.reversible, decision };
    },
    async promoteLesson(input) {
      const { result, decision } = await run(planPromoteLesson(input));
      return { scope: result.scope, durable: result.durable, decision };
    },
    async severity(input) {
      const { result, decision } = await run(planSeverity(input));
      return { severity: result, decision };
    },
    async list(runId, opts) {
      const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(opts?.limit ?? DEFAULT_LIST_LIMIT)));
      return repo.list(runId ?? null, limit);
    },
  };
}
