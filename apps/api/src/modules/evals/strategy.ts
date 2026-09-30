// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The strategy lab: autonomous prompt engineering for one role (base or
// dynamic) or one cat. Deterministic apart from the one fast-tier call the
// memory module makes with strategyPrompt():
//   strategyPrompt / parseStrategy   write a candidate addendum (at most 3 rules,
//                                    at most 120 tokens) from the subject's failures
//   mergeStrategies                  the "merge" answer: candidate rules first, then the
//                                    current rules that say something new, capped
//   evaluateStrategy                 offline evaluation against the current addendum:
//     scripted outcomes  the share of the role's recent failure causes the text
//                        addresses (term overlap on content words)
//     context size       the role's core-suite scenarios replayed through the real
//                        ContextService with the addendum in the charter layer;
//                        the billable input it adds is a cost, and it must stay
//                        below the legacy baseline
// The evaluation is evidence: the runtime JEV prompt.adopt decision (runs
// module) answers adopt, keep or merge from it. `adopt` below is the
// deterministic rule used as the fallback when JEV is unverified: a candidate
// that addresses strictly more failures, fits the cap, stays under legacy and
// scores higher.
import { ROLE_LABEL, type AgentRole, type StrategyEvidenceDTO } from "@mengai/shared";
import type { ToolSpec } from "../../core/ports/llm";
import type { ContextService } from "../../core/services";
import { redact } from "../../lib/redact";
import { PrefixCache, charEstimate } from "./meter";
import { replayLegacy, replayV2 } from "./replay";
import { fixtureSpecsFor, loadSuites, type ScenarioFixture } from "./suites";

export const STRATEGY = {
  maxTokens: 120,
  maxRules: 3,
  ruleChars: 170,
  /** output cap of the candidate call: one call, at most 120 tokens */
  outputTokens: 120,
  causes: 6,
  causeChars: 220,
  /** weight of the billable-input share the addendum adds */
  costWeight: 1,
  suite: "core",
} as const;

/** System prompt of the candidate call (the demo crew answers it by exact match). */
export const STRATEGY_SYSTEM = [
  "You tune the working strategy of one role, or one crew member, in an AI crew. From its recent failures and its current strategy, write the strategy that would have prevented those failures.",
  "At most 3 short imperative rules, 70 words in total, concrete and general enough for the next tasks. Keep what still helps from the current strategy.",
  "No names, no secrets, no project-specific paths.",
  'Reply with JSON only: {"rules":["..."]}',
].join("\n");

export interface StrategyCase {
  outcome: "win" | "loss";
  kind: string;
  cause: string;
}

const oneLine = (t: string) => t.replace(/\s+/g, " ").trim();
const cut = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 3).trimEnd()}...` : t);

export interface StrategySubjectInfo {
  subject: "role" | "agent";
  /** the archetype */
  role: AgentRole;
  /** a dynamic role's title, when there is one */
  title?: string | null;
}

export function strategyPrompt(i: StrategySubjectInfo & { current: string | null; cases: StrategyCase[] }): string {
  const wins = i.cases.filter((c) => c.outcome === "win").length;
  const losses = i.cases.filter((c) => c.outcome === "loss");
  const causes = [...new Set(losses.map((c) => `[${c.kind}] ${cut(oneLine(redact(c.cause)), STRATEGY.causeChars)}`).filter((c) => c.length > 12))].slice(0, STRATEGY.causes);
  const who = i.title ? `${cut(oneLine(redact(i.title)), 60)} (a ${ROLE_LABEL[i.role]} specialist)` : `${i.role} (${ROLE_LABEL[i.role]})`;
  return [
    i.subject === "agent" ? `One crew member, role: ${who}` : `Role: ${who}`,
    `Current strategy: ${i.current ? oneLine(redact(i.current)) : "none"}`,
    `Recent outcomes: ${wins} wins, ${losses.length} losses`,
    causes.length ? `Failures, newest first:\n${causes.map((c) => `- ${c}`).join("\n")}` : "Failures: none recorded",
  ].join("\n");
}

/** The candidate's rules as the addendum text ("- rule" lines), capped at 120 tokens; null when unusable. */
export function parseStrategy(text: string): string | null {
  const raw = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const rules = v && typeof v === "object" && Array.isArray((v as { rules?: unknown }).rules) ? ((v as { rules: unknown[] }).rules as unknown[]) : null;
  if (!rules) return null;
  return strategyText(rules.filter((r): r is string => typeof r === "string"));
}

/** Rules to addendum text: redacted, one line each, whole rules only while they fit 120 tokens. */
export function strategyText(rules: string[]): string | null {
  const max = STRATEGY.maxTokens * 4;
  const out: string[] = [];
  let size = 0;
  for (const r of rules.slice(0, STRATEGY.maxRules)) {
    const rule = cut(oneLine(redact(r)).replace(/^[-*\d.)\s]+/, ""), STRATEGY.ruleChars);
    if (rule.length < 8) continue;
    const line = `- ${rule}`;
    if (size + line.length + (out.length ? 1 : 0) > max) break;
    out.push(line);
    size += line.length + (out.length > 1 ? 1 : 0);
  }
  return out.length ? out.join("\n") : null;
}

const rulesOf = (text: string) =>
  text
    .split("\n")
    .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(Boolean);

function overlap(a: string, b: string): number {
  const x = terms(a);
  const y = terms(b);
  if (x.size === 0 || y.size === 0) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

/**
 * The "merge" answer: the candidate's rules first, then the current rules
 * that do not repeat one of them (term overlap under one half), cut to 3
 * rules and 120 tokens. Null when nothing usable is left.
 */
export function mergeStrategies(current: string | null, candidate: string): string | null {
  const next = rulesOf(candidate);
  const keep = rulesOf(current ?? "").filter((r) => next.every((c) => overlap(r, c) < 0.5));
  return strategyText([...next, ...keep]);
}

// ------------------------------------------------------ scripted outcomes
const STOP = new Set(
  "the and for with that this from into your you have has had was were are not but its all any one two own out off yet very just more most less least also then than only each every when while what which who whom whose why how where there their them they our ours use used using make made sure some such been being does did done doing can could should would will must may might about above below over under again once here task tasks work call calls step steps before after".split(
    " ",
  ),
);

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Content words of a text, lowercased and lightly stemmed. */
export function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (w.length < 3 || STOP.has(w)) continue;
    const s = stem(w);
    if (s.length >= 3 && !STOP.has(s)) out.add(s);
  }
  return out;
}

/** A failure cause is addressed when the strategy shares at least two of its content words (one for a one-word cause). */
export function addresses(strategy: string, cause: string): boolean {
  const c = terms(cause);
  if (c.size === 0) return false;
  const st = terms(strategy);
  let hit = 0;
  for (const t of c) if (st.has(t)) hit++;
  return hit >= Math.min(2, c.size);
}

// ---------------------------------------------------------- evaluation
export interface StrategyScore {
  tokens: number;
  /** loss causes the text addresses */
  addressed: number;
  losses: number;
  coverage: number;
  /** billable input of the role's scenarios replayed with this text in the charter */
  billableInputTokens: number;
  /** billable input this text adds over no strategy, as a share */
  costShare: number;
  score: number;
}

export interface StrategyEval {
  current: StrategyScore;
  candidate: StrategyScore;
  /** the same scenarios under the legacy policy */
  legacyBillableInputTokens: number;
  adopt: boolean;
  reason: string;
}

export interface StrategyEvalInput extends StrategySubjectInfo {
  context: ContextService;
  specsFor?: (role: AgentRole) => ToolSpec[];
  current: { version: number; text: string } | null;
  candidate: string;
  cases: StrategyCase[];
}

function scenariosFor(role: AgentRole): ScenarioFixture[] {
  const suite = loadSuites().get(STRATEGY.suite)!;
  const own = suite.scenarios.filter((s) => s.role === role);
  // a role without its own scenario is measured on the first one, played by that role
  return own.length ? own : [{ ...suite.scenarios[0]!, id: `${suite.scenarios[0]!.id}-${role}`, role }];
}

async function billableWith(input: StrategyEvalInput, strategy: { version: number; text: string } | null): Promise<number> {
  const suite = loadSuites().get(STRATEGY.suite)!;
  const deps = { context: input.context, specsFor: input.specsFor ?? fixtureSpecsFor };
  const cache = new PrefixCache("prefix");
  let total = 0;
  for (const s of scenariosFor(input.role)) {
    const brain = strategy ? { addenda: [{ scope: input.subject, version: strategy.version, text: strategy.text }] } : null;
    total += (await replayV2(s, suite, deps, cache, brain)).billableInputTokens;
  }
  return total;
}

function scoreOf(text: string | null, cases: StrategyCase[], billable: number, none: number): StrategyScore {
  const losses = cases.filter((c) => c.outcome === "loss" && c.cause.trim());
  const addressed = text ? losses.filter((c) => addresses(text, c.cause)).length : 0;
  const coverage = losses.length ? addressed / losses.length : 0;
  const costShare = none > 0 ? Math.max(0, billable - none) / none : 0;
  return {
    tokens: text ? charEstimate(text) : 0,
    addressed,
    losses: losses.length,
    coverage: Math.round(coverage * 1000) / 1000,
    billableInputTokens: billable,
    costShare: Math.round(costShare * 10_000) / 10_000,
    score: Math.round((coverage - STRATEGY.costWeight * costShare) * 1000) / 1000,
  };
}

export async function evaluateStrategy(input: StrategyEvalInput): Promise<StrategyEval> {
  const suite = loadSuites().get(STRATEGY.suite)!;
  const legacy = scenariosFor(input.role).reduce((sum, s) => sum + replayLegacy(s, suite, charEstimate).billableInputTokens, 0);
  const version = (input.current?.version ?? 0) + 1;
  const none = await billableWith(input, null);
  const cur = input.current ? await billableWith(input, input.current) : none;
  const cand = await billableWith(input, { version, text: input.candidate });
  const current = scoreOf(input.current?.text ?? null, input.cases, cur, none);
  const candidate = scoreOf(input.candidate, input.cases, cand, none);
  let reason: string;
  let adopt = false;
  if (candidate.tokens > STRATEGY.maxTokens) reason = `rejected: ${candidate.tokens} tokens is over the ${STRATEGY.maxTokens} token cap`;
  else if (candidate.addressed <= current.addressed) reason = `rejected: addresses ${candidate.addressed} of ${candidate.losses} recent failures, the current text ${current.addressed}`;
  else if (candidate.billableInputTokens >= legacy) reason = "rejected: the replay would cost more than the legacy baseline";
  else if (candidate.score <= current.score) reason = `rejected: scores ${candidate.score}, the current text ${current.score}`;
  else {
    adopt = true;
    reason = `addresses ${candidate.addressed} of ${candidate.losses} recent failures (the current text ${current.addressed}) for ${(candidate.costShare * 100).toFixed(1)} percent more billable input`;
  }
  return { current, candidate, legacyBillableInputTokens: legacy, adopt, reason };
}

/** The evaluation as the wire evidence of a strategy version. */
export function strategyEvidence(ev: StrategyEval): StrategyEvidenceDTO {
  return {
    scores: { current: ev.current.score, candidate: ev.candidate.score },
    addressed: { current: ev.current.addressed, candidate: ev.candidate.addressed, losses: ev.candidate.losses },
    billableInputTokens: { current: ev.current.billableInputTokens, candidate: ev.candidate.billableInputTokens, legacy: ev.legacyBillableInputTokens },
    tokens: { current: ev.current.tokens, candidate: ev.candidate.tokens },
  };
}
