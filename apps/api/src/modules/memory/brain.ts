// The memory side of the crew's brain: what the crew learns across runs.
//   role outcomes     win or loss per finished unit of work, with its cause,
//                     per role key (a base role or a dynamic role)
//   strategies        a learned addendum (at most 120 tokens), versioned, per
//                     role key or per agent. When a subject underperforms, one
//                     fast-tier call writes a candidate from its failures, the
//                     evals strategy lab scores it offline against the current
//                     text (proposeStrategy), the runs engine sends that
//                     evidence to runtime JEV prompt.adopt, and applyStrategy
//                     writes the answer: adopt, merge (a new version) or keep
//                     (the candidate is kept as rejected history).
// The runs engine records outcomes and injects the active versions into the
// charter layer of the next step.
import type { AgentRole, StrategyChoice, StrategyEvidenceDTO, StrategyVersionDTO } from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import type { ChatResult, LlmRouter, ResolvedModel, ToolSpec } from "../../core/ports/llm";
import type { ContextService, UsageService } from "../../core/services";
import { redact } from "../../lib/redact";
import {
  STRATEGY,
  STRATEGY_SYSTEM,
  evaluateStrategy,
  mergeStrategies,
  parseStrategy,
  strategyEvidence,
  strategyPrompt,
  type StrategyCase,
  type StrategyEval,
} from "../evals";
import * as repo from "./brain-repo";

export type { OutcomeKind } from "./brain-repo";

export const BRAIN = {
  /** outcomes of a role that decide its success rate */
  window: 10,
  /** JEV orch.playbooks role_tune_min_samples: three */
  minSamples: 3,
  /** tuning is due when the success rate over the window is below this */
  triggerRate: 0.5,
  /** and at least this many outcomes landed since the last attempt */
  minNewOutcomes: 3,
  keepOutcomes: 200,
  keepAdopted: 20,
  keepRejected: 10,
  causeChars: 300,
  tuneLockSec: 120,
} as const;

const oneLine = (t: string) => t.replace(/\s+/g, " ").trim();
const cut = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 3).trimEnd()}...` : t);

export interface StrategySubject {
  kind: "role" | "agent";
  /** role key (base role or dynamic role key) or agent id */
  key: string;
  /** the archetype */
  role: AgentRole;
  /** a dynamic role's title */
  title?: string | null;
}

export interface RoleOutcomeInput {
  /** role key: a base role or a dynamic role key */
  role: string;
  runId: string | null;
  taskId: string | null;
  agentId: string | null;
  outcome: "win" | "loss";
  kind: repo.OutcomeKind;
  cause: string;
}

export interface ProposeInput {
  subject: StrategySubject;
  runId: string | null;
  /** the live ContextService: the offline replay meters the real prompt */
  context: ContextService;
  specsFor?: (role: AgentRole) => ToolSpec[];
  /** the evidence to learn from; a role subject defaults to its outcome window */
  cases?: StrategyCase[];
  signal?: AbortSignal;
}

/** A scored candidate, waiting for the JEV prompt.adopt answer. */
export interface StrategyProposal {
  subject: StrategySubject;
  runId: string | null;
  current: StrategyVersionDTO | null;
  candidate: string;
  /** the merge answer's text: candidate rules first, then current rules that add something */
  merged: string | null;
  /** the version an adopt or merge answer writes */
  version: number;
  eval: StrategyEval;
  evidence: StrategyEvidenceDTO;
  /** recent failure causes, newest first (for the JEV state) */
  causes: string[];
  /** the candidate call as billed, so the run's totals and budget include it */
  call: { inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens: number; costUsd: number } | null;
  lock: { key: string; token: string } | null;
}

export interface ApplyInput {
  proposal: StrategyProposal;
  choice: StrategyChoice;
  decision: { id: string | null; confidence: number | null; verified: boolean; stamp: string | null } | null;
  reason?: string;
}

export interface MemoryBrain {
  recordRoleOutcome(input: RoleOutcomeInput): Promise<{ tuneDue: boolean; rate: number; samples: number }>;
  /** one fast-tier candidate plus the offline evaluation; null when no usable candidate (the attempt is still recorded) */
  proposeStrategy(input: ProposeInput): Promise<StrategyProposal | null>;
  /** writes the JEV answer: adopt or merge make the next active version, keep records the candidate as rejected */
  applyStrategy(input: ApplyInput): Promise<StrategyVersionDTO>;
  activeStrategy(subject: { kind: "role" | "agent"; key: string }): Promise<StrategyVersionDTO | null>;
  strategiesByIds(ids: string[]): Promise<StrategyVersionDTO[]>;
  strategyHistory(subject: { kind: "role" | "agent"; key: string }, limit?: number): Promise<StrategyVersionDTO[]>;
}

export interface BrainDeps {
  llm: LlmRouter;
  usage: UsageService;
}

export function createMemoryBrain(ctx: ModuleContext, deps: BrainDeps): MemoryBrain {
  const { db, clock, kv } = ctx;
  const log = ctx.logger.child({ module: "memory", part: "brain" });

  type Billed = NonNullable<StrategyProposal["call"]>;

  async function recordUsage(runId: string | null, resolved: ResolvedModel, result: ChatResult | null, error: string | null, started: number): Promise<Billed | null> {
    const u = result?.usage ?? { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 };
    try {
      const call = await deps.usage.record({
        runId,
        agentId: null,
        taskId: null,
        providerId: resolved.provider.id,
        model: result?.model || resolved.model,
        purpose: "reflect",
        usage: result?.usage ?? { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 },
        latencyMs: result?.latencyMs ?? Math.max(0, clock.now() - started),
        retries: result?.retries ?? 0,
        ok: result !== null,
        error,
      });
      return { ...u, costUsd: call.costUsd };
    } catch (err) {
      log.log("warn", "tuning usage record failed", { error: redact(String(err)) });
      return { ...u, costUsd: 0 };
    }
  }

  /** One fast-tier call: the candidate addendum (or null) and the call as billed. */
  async function candidate(input: ProposeInput, current: StrategyVersionDTO | null, cases: StrategyCase[]): Promise<{ text: string | null; call: Billed | null }> {
    let resolved: ResolvedModel;
    try {
      if (!(await deps.llm.configured())) return { text: null, call: null };
      resolved = await deps.llm.resolve({ tier: "fast", role: input.subject.role });
    } catch (err) {
      log.log("info", "tuning skipped: no fast tier model", { error: redact(String(err)) });
      return { text: null, call: null };
    }
    const started = clock.now();
    let result: ChatResult;
    try {
      result = await resolved.provider.chat({
        model: resolved.model,
        system: STRATEGY_SYSTEM,
        messages: [
          {
            role: "user",
            content: strategyPrompt({ subject: input.subject.kind, role: input.subject.role, title: input.subject.title ?? null, current: current?.text ?? null, cases }),
          },
        ],
        maxOutputTokens: STRATEGY.outputTokens,
        temperature: 0,
        responseFormat: "json",
        signal: input.signal,
      });
    } catch (err) {
      const message = redact(err instanceof Error ? err.message : String(err));
      if (input.signal?.aborted) throw err;
      await recordUsage(input.runId, resolved, null, message, started);
      log.log("warn", "tuning call failed", { subject: input.subject.key, error: message });
      return { text: null, call: null };
    }
    const call = await recordUsage(input.runId, resolved, result, null, started);
    return { text: parseStrategy(result.text), call };
  }

  async function release(lock: { key: string; token: string } | null): Promise<void> {
    if (!lock) return;
    try {
      if ((await kv.get(lock.key)) === lock.token) await kv.del(lock.key);
    } catch (err) {
      log.log("warn", "tuning lock release failed", { error: redact(String(err)) });
    }
  }

  const cleanCause = (c: string) => cut(oneLine(redact(c ?? "")), BRAIN.causeChars);

  return {
    async recordRoleOutcome(input) {
      const role = String(input.role).slice(0, 64);
      const active = await repo.activeStrategy(db, "role", role);
      await repo.insertOutcome(db, {
        id: clock.id(),
        role,
        runId: input.runId,
        taskId: input.taskId,
        agentId: input.agentId,
        outcome: input.outcome,
        kind: input.kind,
        cause: cleanCause(input.cause),
        strategyVersion: active?.version ?? 0,
        createdAt: clock.now(),
      });
      await repo.trimOutcomes(db, role, BRAIN.keepOutcomes);
      const window = await repo.recentOutcomes(db, role, BRAIN.window);
      const samples = window.length;
      const rate = samples ? window.filter((o) => o.outcome === "win").length / samples : 1;
      if (samples < BRAIN.minSamples || rate >= BRAIN.triggerRate) return { tuneDue: false, rate, samples };
      const mark = await repo.lastAttempt(db, "role", role);
      const fresh = mark ? await repo.outcomesSince(db, role, mark) : await repo.countOutcomes(db, role);
      return { tuneDue: fresh >= BRAIN.minNewOutcomes, rate, samples };
    },

    async proposeStrategy(input) {
      const { subject } = input;
      const lockKey = `mem:tune:${subject.kind}:${subject.key}`;
      const token = clock.id();
      if (!(await kv.setNx(lockKey, token, BRAIN.tuneLockSec))) return null;
      const lock = { key: lockKey, token };
      try {
        const cases: StrategyCase[] =
          input.cases ??
          (subject.kind === "role" ? (await repo.recentOutcomes(db, subject.key, BRAIN.window)).map((o) => ({ outcome: o.outcome, kind: o.kind, cause: o.cause })) : []);
        const clean = cases.slice(0, BRAIN.window).map((c) => ({ ...c, cause: cleanCause(c.cause) }));
        const current = await repo.activeStrategy(db, subject.kind, subject.key);
        const version = (await repo.maxAdoptedVersion(db, subject.kind, subject.key)) + 1;
        const { text, call } = await candidate(input, current, clean);
        if (!text) {
          // the attempt still counts: the next one waits for fresh outcomes
          await repo.insertStrategy(db, {
            id: clock.id(),
            kind: subject.kind,
            key: subject.key,
            archetype: subject.role,
            version,
            text: "",
            tokens: 0,
            status: "rejected",
            choice: null,
            decisionRef: null,
            confidence: null,
            verified: false,
            stamp: null,
            evidence: null,
            reason: "no usable candidate",
            sourceRunId: input.runId,
            createdAt: clock.now(),
          });
          await release(lock);
          return null;
        }
        const ev = await evaluateStrategy({
          context: input.context,
          specsFor: input.specsFor,
          subject: subject.kind,
          role: subject.role,
          title: subject.title ?? null,
          current: current ? { version: current.version, text: current.text } : null,
          candidate: text,
          cases: clean,
        });
        const causes = [...new Set(clean.filter((c) => c.outcome === "loss" && c.cause).map((c) => c.cause))].slice(0, 5);
        return {
          subject,
          runId: input.runId,
          current,
          candidate: text,
          merged: current ? mergeStrategies(current.text, text) : null,
          version,
          eval: ev,
          evidence: strategyEvidence(ev),
          causes,
          call,
          lock,
        };
      } catch (err) {
        await release(lock);
        throw err;
      }
    },

    async applyStrategy(input) {
      const p = input.proposal;
      const { subject } = p;
      try {
        const adopt = input.choice === "adopt" || (input.choice === "merge" && !!p.merged);
        const text = input.choice === "merge" && p.merged ? p.merged : p.candidate;
        const row: repo.StrategyRow = {
          id: clock.id(),
          kind: subject.kind,
          key: subject.key,
          archetype: subject.role,
          version: p.version,
          text,
          tokens: Math.ceil(text.length / 4),
          status: adopt ? "active" : "rejected",
          choice: input.choice,
          decisionRef: input.decision?.id ?? null,
          confidence: input.decision?.confidence ?? null,
          verified: input.decision?.verified ?? false,
          stamp: input.decision?.stamp ?? null,
          evidence: p.evidence,
          reason: cut(oneLine(redact(input.reason ?? p.eval.reason)), 300),
          sourceRunId: p.runId,
          createdAt: clock.now(),
        };
        const out = adopt
          ? await db.tx(async (tx) => {
              await repo.retireActive(tx, subject.kind, subject.key);
              return repo.insertStrategy(tx, row);
            })
          : await repo.insertStrategy(db, row);
        await repo.trimStrategies(db, subject.kind, subject.key, BRAIN.keepAdopted, BRAIN.keepRejected);
        return out;
      } finally {
        await release(p.lock);
      }
    },

    activeStrategy: (s) => repo.activeStrategy(db, s.kind, s.key),
    strategiesByIds: (ids) => repo.strategiesByIds(db, ids),
    strategyHistory: (s, limit = 30) => repo.strategyHistory(db, s.kind, s.key, Math.max(1, Math.min(100, Math.floor(limit)))),
  };
}
