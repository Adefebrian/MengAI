// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The product's runtime brain decisions, asked of JEV through the Judge port
// (the owner's jev key): the same plan shape as the jev module's catalog.
//   prompt.adopt  adopt, keep or merge a candidate strategy addendum, from its offline evaluation
//   orch.role     a new role or an existing one for a requested title, and its archetype
//   orch.hire     hire a cat or let the asker do it itself (handoffs), hire or wait (queues)
//   orch.let_go   let a struggling cat go, coach it, or keep it
// Every plan runs precheck in code (hard rules, JEV not asked) -> redacted
// state -> kv cache (10 min) -> Judge -> interpret with the low-confidence
// rule -> deterministic fallback stamped UNVERIFIED BY JEV. The runner
// persists the decision (brain_decisions) and publishes the decision event.
import { ROLE_LABEL, type AgentRole, type DecisionDTO, type StrategyChoice, type StrategyEvidenceDTO } from "@mengai/shared";
import type { Clock, JevAnswer, JevQuestion, Judge, Kv, Logger } from "../../core/ports";
import { clip, redact, redactDeep } from "../../lib/redact";
import { aRole } from "./org";
import { withArticle } from "./policy";
import { ARCHETYPE_NOTE } from "./roles";

export const BRAIN_DECISIONS = {
  adopt: "prompt.adopt",
  role: "orch.role",
  hire: "orch.hire",
  letGo: "orch.let_go",
} as const;
export type BrainDecisionId = (typeof BRAIN_DECISIONS)[keyof typeof BRAIN_DECISIONS];

export const UNVERIFIED = "UNVERIFIED BY JEV";
/** under this confidence the runner-up rule of each plan applies */
export const LOW_CONFIDENCE = 0.5;
export const CACHE_TTL_SEC = 600;

const PRODUCT = "MengAI: an autonomous AI agent company where every agent is a cat; owners bring their own model keys for any provider and any model.";

export interface BrainOutcome<R> {
  result: R;
  answers: Record<string, unknown>;
  action: string;
  confidence: number | null;
}

export interface BrainPlan<R> {
  decisionId: BrainDecisionId;
  runId: string | null;
  /** the agent the decision is about (the mind panel lists it) */
  agentId: string | null;
  /** role key, or agent id, or role id the decision is about */
  subject: string | null;
  precheck: (BrainOutcome<R> & { rule: string }) | null;
  state: Record<string, unknown>;
  questions: Record<string, JevQuestion>;
  interpret(answers: Record<string, JevAnswer>): BrainOutcome<R> | null;
  fallback(): BrainOutcome<R>;
}

// ----------------------------------------------------------------- helpers
const clamp01 = (v: unknown) => Math.min(1, Math.max(0, typeof v === "number" && Number.isFinite(v) ? v : 0));

interface Choice<K extends string> {
  choice: K;
  confidence: number;
  runnerUp: K | null;
  probabilities: Record<string, number>;
}

export function readChoice<K extends string>(a: JevAnswer | undefined, options: readonly K[]): Choice<K> | null {
  if (!a || a.type !== "choice" || typeof a.choice !== "string" || !(options as readonly string[]).includes(a.choice)) return null;
  const probabilities: Record<string, number> = {};
  for (const [k, p] of Object.entries(a.probabilities ?? {})) if ((options as readonly string[]).includes(k)) probabilities[k] = clamp01(p);
  let runnerUp: K | null = null;
  let best = 0;
  for (const o of options) {
    if (o === a.choice) continue;
    const p = probabilities[o] ?? 0;
    if (p > best) {
      best = p;
      runnerUp = o;
    }
  }
  return { choice: a.choice as K, confidence: clamp01(a.confidence), runnerUp, probabilities };
}

const record = (c: Choice<string>, extra: Record<string, unknown> = {}) => ({ type: "choice", choice: c.choice, confidence: c.confidence, probabilities: c.probabilities, ...extra });
const heuristic = (choice: string) => ({ type: "choice", choice });
const short = (t: string, max = 300) => clip(redact(String(t ?? "")).replace(/\s+/g, " ").trim(), max);

// ------------------------------------------------------------ prompt.adopt
export interface AdoptInput {
  runId: string | null;
  agentId: string | null;
  subject: "role" | "agent";
  subjectKey: string;
  role: AgentRole;
  title: string;
  current: { version: number; text: string } | null;
  candidate: string;
  merged: string | null;
  evidence: StrategyEvidenceDTO;
  causes: string[];
  /** the deterministic adoption rule of the evaluation (the fallback) */
  ruleAdopt: boolean;
  capTokens: number;
}

export function planAdopt(i: AdoptInput): BrainPlan<StrategyChoice> {
  const options: StrategyChoice[] = i.current && i.merged ? ["adopt", "keep", "merge"] : ["adopt", "keep"];
  const who = i.subject === "agent" ? `one ${i.title} cat` : `the ${i.title} role`;
  const base = { decisionId: BRAIN_DECISIONS.adopt, runId: i.runId, agentId: i.agentId, subject: i.subjectKey } as const;
  const same = i.current && i.current.text.replace(/\s+/g, " ").trim() === i.candidate.replace(/\s+/g, " ").trim();
  const ev = i.evidence;
  let precheck: BrainPlan<StrategyChoice>["precheck"] = null;
  if (ev.tokens.candidate > i.capTokens) precheck = { rule: "over_token_cap", result: "keep", answers: { adopt: heuristic("keep") }, action: `keep: the candidate is over the ${i.capTokens} token cap`, confidence: null };
  else if (ev.billableInputTokens.candidate >= ev.billableInputTokens.legacy) precheck = { rule: "over_legacy", result: "keep", answers: { adopt: heuristic("keep") }, action: "keep: the candidate would cost more than the legacy baseline", confidence: null };
  else if (same) precheck = { rule: "same_text", result: "keep", answers: { adopt: heuristic("keep") }, action: "keep: the candidate repeats the current strategy", confidence: null };
  const action = (c: StrategyChoice) =>
    c === "keep" ? `keep the current strategy of ${who}` : `${c} strategy v${(i.current?.version ?? 0) + 1} for ${who}`;
  return {
    ...base,
    precheck,
    state: {
      product: PRODUCT,
      task: `Autonomous prompt engineering: ${who} underperformed; a candidate strategy addendum (at most ${i.capTokens} tokens, injected into its charter layer) was written from its failures and evaluated offline.`,
      proposal: {
        subject: i.subject,
        role: `${i.title} (${ROLE_LABEL[i.role]})`,
        current: i.current ? { version: i.current.version, text: short(i.current.text, 600) } : null,
        candidate: short(i.candidate, 600),
        ...(i.merged && i.current ? { merged: short(i.merged, 600) } : {}),
      },
      evidence: {
        scores: ev.scores,
        failures_addressed: ev.addressed,
        billable_input_tokens: ev.billableInputTokens,
        tokens: ev.tokens,
        recent_failures: i.causes.slice(0, 5).map((c) => short(c, 200)),
      },
    },
    questions: {
      adopt: {
        type: "choice",
        instructions:
          "Decide what the crew does with the candidate strategy in state.proposal, from the offline evaluation in state.evidence (scores, recent failures each text addresses, billable tokens against the legacy baseline).",
        criteria: {
          adopt: "The candidate addresses the recent failures clearly better than the current strategy at a small token cost: it becomes the next version.",
          keep: "The candidate is not clearly better, is vague or risky, or costs too much: the current strategy stays.",
          ...(options.includes("merge") ? { merge: "Both texts carry useful, non-overlapping rules: the merged text in state.proposal becomes the next version." } : {}),
        },
      },
    },
    interpret(answers) {
      const c = readChoice(answers.adopt, options);
      if (!c) return null;
      // low confidence: keep when keep is the runner-up (a strategy change needs a clear yes)
      const pick: StrategyChoice = c.confidence < LOW_CONFIDENCE && c.runnerUp === "keep" ? "keep" : c.choice;
      return { result: pick, answers: { adopt: record(c, pick !== c.choice ? { applied: pick, rule: "low_confidence_keep" } : {}) }, action: action(pick), confidence: c.confidence };
    },
    fallback() {
      const pick: StrategyChoice = i.ruleAdopt ? "adopt" : "keep";
      return { result: pick, answers: { adopt: heuristic(pick), rule: "evaluation_rule" }, action: action(pick), confidence: null };
    },
  };
}

// -------------------------------------------------------------- orch.role
export interface RoleInput {
  runId: string;
  agentId: string | null;
  goal: string;
  title: string;
  key: string;
  requested: AgentRole;
  task: { title: string; spec: string };
  /** dynamic roles of the project */
  existing: Array<{ key: string; title: string; archetype: AgentRole }>;
  archetypes: readonly AgentRole[];
  /** new roles already defined in this run, and the cap */
  created: number;
  cap: number;
}

export interface RoleResult {
  need: "new_role" | "existing";
  archetype: AgentRole;
  /** the existing dynamic role key to reuse, when need is existing and one fits */
  reuse: string | null;
}

export function planRole(i: RoleInput): BrainPlan<RoleResult> {
  const archetypes = i.archetypes.includes(i.requested) ? i.archetypes : [...i.archetypes, i.requested];
  const known = i.existing.find((r) => r.key === i.key) ?? null;
  const base = { decisionId: BRAIN_DECISIONS.role, runId: i.runId, agentId: i.agentId, subject: i.key } as const;
  let precheck: BrainPlan<RoleResult>["precheck"] = null;
  if (known) precheck = { rule: "known_role", result: { need: "existing", archetype: known.archetype, reuse: known.key }, answers: { need: heuristic("existing") }, action: `reuse the ${known.title} role`, confidence: null };
  else if (i.created >= i.cap) precheck = { rule: "role_cap", result: { need: "existing", archetype: i.requested, reuse: null }, answers: { need: heuristic("existing") }, action: `use the ${ROLE_LABEL[i.requested]} role: ${i.cap} new roles per run`, confidence: null };
  const act = (r: RoleResult) => (r.need === "new_role" ? `define the ${i.title} role (${r.archetype})` : `use the ${ROLE_LABEL[r.archetype]} role`);
  return {
    ...base,
    precheck,
    state: {
      product: PRODUCT,
      task: "A crew cat asked for a role the base roles do not name. Decide whether a new specialist role is needed or an existing role fits, and which base role (archetype) it sits on.",
      proposal: { title: short(i.title, 60), requested_archetype: i.requested, task: { title: short(i.task.title, 160), spec: short(i.task.spec, 500) } },
      evidence: {
        goal: short(i.goal, 300),
        base_roles: archetypes.map((r) => `${r}: ${ARCHETYPE_NOTE[r]}`),
        existing_roles: i.existing.slice(0, 12).map((r) => `${short(r.title, 60)} (${r.archetype})`),
      },
    },
    questions: {
      need: {
        type: "choice",
        instructions: "Decide whether the work in state.proposal needs the new specialist role it names, or an existing role in state.evidence already covers it.",
        criteria: {
          new_role: "The work needs a specialist stance, checks or outputs that no base role or existing role describes well: define the new role.",
          existing: "A base role or an existing role already covers this work well: reuse it, no new role.",
        },
      },
      archetype: {
        type: "choice",
        instructions: "Pick the base role whose tools and stance fit the role in state.proposal best. It drives the cat's pose and its default tools.",
        criteria: Object.fromEntries(archetypes.map((r) => [r, `${ROLE_LABEL[r]}: ${ARCHETYPE_NOTE[r]}`])),
      },
    },
    interpret(answers) {
      const need = readChoice(answers.need, ["new_role", "existing"] as const);
      const arch = readChoice(answers.archetype, archetypes);
      if (!need || !arch) return null;
      // low confidence on the archetype: the requested one, when JEV's runner-up is it
      const archetype = arch.confidence < LOW_CONFIDENCE && arch.runnerUp === i.requested ? i.requested : arch.choice;
      const r: RoleResult = { need: need.choice, archetype, reuse: null };
      return { result: r, answers: { need: record(need), archetype: record(arch, archetype !== arch.choice ? { applied: archetype } : {}) }, action: act(r), confidence: Math.min(need.confidence, arch.confidence) };
    },
    fallback() {
      // the asking cat named the specialist it needs: define it on the archetype it asked for
      const r: RoleResult = { need: "new_role", archetype: i.requested, reuse: null };
      return { result: r, answers: { need: heuristic("new_role"), archetype: heuristic(i.requested), rule: "requested" }, action: act(r), confidence: null };
    },
  };
}

// -------------------------------------------------------------- orch.hire
export interface HireInput {
  runId: string;
  kind: "handoff" | "queue";
  /** the cat asking (handoff), or the CEO (queue) */
  asker: { id: string; name: string; title: string } | null;
  roleKey: string;
  role: AgentRole;
  title: string;
  task: { title: string; spec: string };
  pool: number;
  waiting: number;
  crew: number;
  maxAgents: number;
  /** org depth of the new cat, and the owner's limit (0 = unlimited) */
  depth: number;
  maxDepth: number;
  affordable: boolean;
  budgetLeftShare: number | null;
}

export type HireResult = "hire" | "self" | "wait";

export function planHire(i: HireInput): BrainPlan<HireResult> {
  const no: HireResult = i.kind === "handoff" ? "self" : "wait";
  const options: HireResult[] = ["hire", no];
  const base = { decisionId: BRAIN_DECISIONS.hire, runId: i.runId, agentId: i.asker?.id ?? null, subject: i.roleKey } as const;
  let precheck: BrainPlan<HireResult>["precheck"] = null;
  const hold = (rule: string, why: string) => ({ rule, result: no, answers: { hire: heuristic(no) }, action: `${no}: ${why}`, confidence: null });
  if (i.maxAgents > 0 && i.crew >= i.maxAgents) precheck = hold("at_max_agents", `the crew is at its size limit (${i.maxAgents})`);
  else if (i.maxDepth > 0 && i.depth > i.maxDepth) precheck = hold("at_max_depth", `the org is at its depth limit (${i.maxDepth})`);
  else if (!i.affordable) precheck = hold("budget", "the run budget cannot carry another cat");
  const act = (r: HireResult) => (r === "hire" ? `hire ${aRole(i.title)}` : r === "self" ? `${i.asker?.name ?? "the asking cat"} does it itself` : `the ${i.title} queue waits`);
  return {
    ...base,
    precheck,
    state: {
      product: PRODUCT,
      task:
        i.kind === "handoff"
          ? `${i.asker?.name ?? "A cat"} (${i.asker?.title ?? "crew"}) wants to hand a sub-problem to ${aRole(i.title)} and none is free. Decide: hire one, or the asking cat does it itself.`
          : `Every ${i.title} cat is busy and ${i.waiting} ${i.title} task${i.waiting === 1 ? " is" : "s are"} waiting. Decide: hire another one now, or the queue waits for the cats at work.`,
      proposal: { role: `${i.title} (${ROLE_LABEL[i.role]})`, task: { title: short(i.task.title, 160), spec: short(i.task.spec, 400) } },
      evidence: {
        cats_of_role: i.pool,
        waiting_tasks: i.waiting,
        crew_size: i.crew,
        org_depth_of_new_cat: i.depth,
        budget_left_share: i.budgetLeftShare === null ? "unlimited" : Math.round(i.budgetLeftShare * 100) / 100,
      },
    },
    questions: {
      hire: {
        type: "choice",
        instructions: "Decide whether the company hires a cat for the work in state.proposal now, from the crew, queue and budget facts in state.evidence.",
        criteria:
          i.kind === "handoff"
            ? {
                hire: "The sub-problem needs the other role's skills or would take the asking cat far off its task: hire a cat for it.",
                self: "The asking cat can do this part itself at little cost, or a hire is not worth the budget: it does it itself.",
              }
            : {
                hire: "The waiting work is substantial and parallel, and the budget can carry another cat: hire one now.",
                wait: "The cats at work will reach the waiting tasks soon, or the budget is tight: the queue waits.",
              },
      },
    },
    interpret(answers) {
      const c = readChoice(answers.hire, options);
      if (!c) return null;
      return { result: c.choice, answers: { hire: record(c) }, action: act(c.choice), confidence: c.confidence };
    },
    fallback() {
      return { result: "hire", answers: { hire: heuristic("hire"), rule: "work_needs_a_cat" }, action: act("hire"), confidence: null };
    },
  };
}

// ------------------------------------------------------------ orch.let_go
export interface LetGoInput {
  runId: string;
  agent: { id: string; name: string; title: string; role: AgentRole };
  consecutive: number;
  failures: string[];
  done: number;
  coached: boolean;
  departures: number;
  maxDepartures: number;
  canReplace: boolean;
}

export type LetGoResult = "let_go" | "coach" | "keep";

export function planLetGo(i: LetGoInput): BrainPlan<LetGoResult> {
  const options: LetGoResult[] = i.coached ? ["let_go", "keep"] : ["let_go", "coach", "keep"];
  const base = { decisionId: BRAIN_DECISIONS.letGo, runId: i.runId, agentId: i.agent.id, subject: i.agent.id } as const;
  let precheck: BrainPlan<LetGoResult>["precheck"] = null;
  if (i.agent.role === "lead") precheck = { rule: "ceo", result: "keep", answers: { decision: heuristic("keep") }, action: "keep: the CEO stays", confidence: null };
  else if (i.departures >= i.maxDepartures) precheck = { rule: "departure_cap", result: "keep", answers: { decision: heuristic("keep") }, action: `keep: ${i.maxDepartures} cats already left this run`, confidence: null };
  const act = (r: LetGoResult) => (r === "let_go" ? `let ${i.agent.name} go` : r === "coach" ? `coach ${i.agent.name} with a strategy of its own` : `keep ${i.agent.name}`);
  return {
    ...base,
    precheck,
    state: {
      product: PRODUCT,
      task: `${i.agent.name}, ${withArticle(i.agent.title)} cat, failed ${i.consecutive} times in a row. Decide: let it go (its tasks go back on the board for a replacement), coach it, or keep it as it is.`,
      proposal: { cat: `${i.agent.name} (${i.agent.title}, ${ROLE_LABEL[i.agent.role]})` },
      evidence: {
        consecutive_failures: i.consecutive,
        recent_failures: i.failures.slice(0, 4).map((f) => short(f, 200)),
        tasks_done_this_run: i.done,
        already_coached: i.coached,
        replacement_possible: i.canReplace,
      },
    },
    questions: {
      decision: {
        type: "choice",
        instructions: "Decide what the company does with the struggling cat in state.proposal, from its record in state.evidence.",
        criteria: {
          let_go: "The failures repeat the same cause and a fresh cat is likely to do better: let it go and hire a replacement for its tasks.",
          ...(i.coached ? {} : { coach: "The failures share a fixable habit a short strategy of its own can correct: coach it and keep it." }),
          keep: "The failures come from the tasks or the environment, not from the cat: keep it as it is.",
        },
      },
    },
    interpret(answers) {
      const c = readChoice(answers.decision, options);
      if (!c) return null;
      // low confidence: never let a cat go on a weak answer
      const pick: LetGoResult = c.choice === "let_go" && c.confidence < LOW_CONFIDENCE ? (i.coached ? "keep" : "coach") : c.choice;
      return { result: pick, answers: { decision: record(c, pick !== c.choice ? { applied: pick, rule: "low_confidence_soften" } : {}) }, action: act(pick), confidence: c.confidence };
    },
    fallback() {
      const pick: LetGoResult = i.coached && i.canReplace ? "let_go" : i.coached ? "keep" : "coach";
      return { result: pick, answers: { decision: heuristic(pick), rule: "coach_first" }, action: act(pick), confidence: null };
    },
  };
}

// ----------------------------------------------------------------- runner
export interface BrainDecisionRow {
  id: string;
  runId: string | null;
  agentId: string | null;
  subject: string | null;
  decisionId: string;
  domain: string;
  stateDigest: string;
  questions: Record<string, JevQuestion>;
  answers: Record<string, unknown>;
  action: string;
  confidence: number | null;
  verified: boolean;
  stamp: string | null;
  latencyMs: number;
  createdAt: number;
}

export interface BrainJudgeDeps {
  judge: Judge | null;
  kv: Kv;
  clock: Clock;
  log: Logger;
  save(row: BrainDecisionRow): Promise<void>;
  publish(decision: DecisionDTO, agentId: string | null): Promise<void>;
}

function canonical(value: unknown): string {
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

const sha = (t: string) => new Bun.CryptoHasher("sha256").update(t).digest("hex");

export function toDecisionDTO(r: BrainDecisionRow): DecisionDTO {
  return { id: r.id, runId: r.runId, decisionId: r.decisionId, answers: r.answers, action: r.action, confidence: r.confidence, verified: r.verified, stamp: r.stamp, latencyMs: r.latencyMs, createdAt: r.createdAt };
}

export interface BrainJudge {
  run<R>(plan: BrainPlan<R>): Promise<{ result: R; decision: DecisionDTO }>;
}

export function createBrainJudge(deps: BrainJudgeDeps): BrainJudge {
  async function cached(key: string): Promise<Record<string, JevAnswer> | null> {
    try {
      const raw = await deps.kv.get(key);
      if (!raw) return null;
      const c = JSON.parse(raw) as { at?: number; answers?: Record<string, JevAnswer> };
      if (typeof c.at !== "number" || !c.answers || deps.clock.now() - c.at > CACHE_TTL_SEC * 1000) return null;
      return c.answers;
    } catch {
      return null;
    }
  }

  return {
    async run<R>(plan: BrainPlan<R>) {
      const state = redactDeep(plan.state);
      const questions = redactDeep(plan.questions);
      let outcome: BrainOutcome<R>;
      let verified = false;
      let stamp: string | null = null;
      let latencyMs = 0;
      if (plan.precheck) {
        const { rule, ...rest } = plan.precheck;
        outcome = { ...rest, answers: { precheck: rule, ...rest.answers } };
      } else {
        const key = `brain:decision:${sha(canonical({ decisionId: plan.decisionId, state, questions }))}`;
        let interpreted: BrainOutcome<R> | null = null;
        let error = "";
        const hit = await cached(key);
        if (hit) interpreted = plan.interpret(hit);
        if (!interpreted) {
          if (deps.judge) {
            try {
              const res = await deps.judge.decide({ decisionId: plan.decisionId, state, questions });
              latencyMs = res.latencyMs;
              if (res.verified) {
                interpreted = plan.interpret(res.answers);
                if (interpreted) {
                  try {
                    await deps.kv.set(key, JSON.stringify({ at: deps.clock.now(), answers: res.answers }), CACHE_TTL_SEC);
                  } catch {
                    // the cache is best effort
                  }
                } else error = "JEV answers did not match the questions";
              } else error = res.error;
            } catch (e) {
              error = e instanceof Error ? e.message : String(e);
            }
          } else error = "no runtime JEV judge is configured";
        }
        if (interpreted) {
          outcome = interpreted;
          verified = true;
        } else {
          const fb = plan.fallback();
          outcome = { ...fb, answers: { ...fb.answers, error: clip(redact(error || "judge unavailable"), 200) } };
          stamp = UNVERIFIED;
        }
      }
      const row: BrainDecisionRow = {
        id: deps.clock.id(),
        runId: plan.runId,
        agentId: plan.agentId,
        subject: plan.subject,
        decisionId: plan.decisionId,
        domain: plan.decisionId.slice(0, plan.decisionId.indexOf(".")),
        stateDigest: sha(canonical(state)),
        questions,
        answers: redactDeep(outcome.answers),
        action: clip(redact(outcome.action), 200),
        confidence: outcome.confidence,
        verified,
        stamp,
        latencyMs,
        createdAt: deps.clock.now(),
      };
      try {
        await deps.save(row);
      } catch (e) {
        deps.log.log("warn", "brain decision save failed", { decisionId: plan.decisionId, error: redact(e instanceof Error ? e.message : String(e)) });
      }
      const decision = toDecisionDTO(row);
      await deps.publish(decision, plan.agentId);
      return { result: outcome.result, decision };
    },
  };
}
