// Product decision catalog, adapted from the JAL jal-jev catalog. Pure code:
// each planner turns a DecisionService input into a DecisionPlan with
//   1. a precheck (hard rules decided in code, JEV is not asked),
//   2. the redacted state and the JEV questions,
//   3. interpret(): catalog thresholds plus the low-confidence rules,
//   4. fallback(): the deterministic heuristic used when JEV is unverified.
// The service runs the plan (cache, Judge call, persistence, events).
import { AGENT_ROLES, SEVERITIES, TIERS } from "@mengai/shared";
import type { AgentRole, ScanKind, Severity, Tier } from "@mengai/shared";
import type { JevAnswer, JevQuestion } from "../../core/ports/judge";
import { clip, redact } from "../../lib/redact";

export const CATALOG_IDS = {
  route: "orch.route",
  modelTier: "orch.model",
  loopExit: "orch.loop_exit",
  escalate: "orch.escalate",
  promoteLesson: "mem.promote",
  severity: "sec.severity",
} as const;
export type CatalogId = (typeof CATALOG_IDS)[keyof typeof CATALOG_IDS];

/** Under this confidence the runner-up rules apply (jal-jev confidence handling). */
export const LOW_CONFIDENCE = 0.5;
/** Review loop cap from the orchestration engine (architecture section 6). */
export const MAX_REVIEW_ROUNDS = 3;
/** Global lesson promotion needs evidence from at least this many projects. */
export const GLOBAL_PROMOTION_PROJECTS = 2;

export const PRODUCT =
  "MengAI: a crew of AI agent cats (lead, engineer, designer, reviewer, qa, security, researcher, operator) that plans and builds software in the owner's workspace.";

export function domainOf(decisionId: string): string {
  const i = decisionId.indexOf(".");
  return i === -1 ? decisionId : decisionId.slice(0, i);
}

export interface Outcome<R> {
  result: R;
  /** what gets persisted and shown in the Decisions panel */
  answers: Record<string, unknown>;
  /** the action the engine takes because of the answer */
  action: string;
  confidence: number | null;
}

export interface PrecheckOutcome<R> extends Outcome<R> {
  /** stable rule id, stored in answers.precheck */
  rule: string;
}

export interface DecisionPlan<R> {
  decisionId: CatalogId;
  runId: string | null;
  precheck: PrecheckOutcome<R> | null;
  state: Record<string, unknown>;
  questions: Record<string, JevQuestion>;
  /** null when the answers do not fit the questions (treated as unverified) */
  interpret(answers: Record<string, JevAnswer>): Outcome<R> | null;
  fallback(): Outcome<R>;
}

// ------------------------------------------------------------------ helpers

export function clamp01(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.min(1, Math.max(0, n));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface ReadChoice<K extends string> {
  choice: K;
  confidence: number;
  runnerUp: K | null;
  probabilities: Record<string, number>;
}

/** Validates a choice answer against the offered options and finds the runner-up. */
export function readChoice<K extends string>(a: JevAnswer | undefined, options: readonly K[]): ReadChoice<K> | null {
  if (!a || a.type !== "choice" || typeof a.choice !== "string") return null;
  if (!(options as readonly string[]).includes(a.choice)) return null;
  const probabilities: Record<string, number> = {};
  for (const [k, p] of Object.entries(a.probabilities ?? {})) {
    if ((options as readonly string[]).includes(k)) probabilities[k] = clamp01(p);
  }
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

/** Validates a noul answer and returns the probability of yes. */
export function readNoul(a: JevAnswer | undefined): number | null {
  if (!a || a.type !== "noul" || typeof a.noul !== "number" || !Number.isFinite(a.noul)) return null;
  return clamp01(a.noul);
}

function choiceRecord(c: ReadChoice<string>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "choice", choice: c.choice, confidence: c.confidence, probabilities: c.probabilities, ...extra };
}

function heuristicChoice(choice: string): Record<string, unknown> {
  return { type: "choice", choice };
}

function heuristicNoul(noul: number): Record<string, unknown> {
  return { type: "noul", noul };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Number of distinct keywords present in text (word boundaries, case-insensitive). */
export function keywordHits(text: string, words: readonly string[]): number {
  const low = text.toLowerCase();
  let n = 0;
  for (const w of words) if (new RegExp(`\\b${escapeRe(w)}\\b`).test(low)) n++;
  return n;
}

/** Word trigram shingles (unigrams for very short text). */
export function shingles(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const out = new Set<string>();
  if (words.length < 3) {
    for (const w of words) out.add(w);
    return out;
  }
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function uniq<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

// -------------------------------------------------------------- orch.route

export interface RouteInput {
  runId: string;
  goal: string;
  task: { title: string; spec: string };
  candidates: AgentRole[];
}
export interface RouteResult {
  role: AgentRole;
  split: boolean;
}

export const ROLE_CRITERIA: Record<AgentRole, string> = {
  lead: "Planning and coordination: breaking a goal into tasks, sequencing work, tracking status, settling scope. Writes no feature code.",
  engineer: "Writing or changing code in the workspace: features, fixes, refactors, scripts, build and shell work.",
  designer: "Visual work: images, video, icons, illustrations, layout and styling files.",
  reviewer: "Reviewing an existing change for correctness, clarity and boundaries, then approving it or requesting fixes.",
  qa: "Tests: writing, running and fixing tests, reproducing bugs, verifying acceptance criteria.",
  security: "Security work: dependency audit, secret scan, config review, auth, secrets and input handling fixes.",
  researcher: "Looking up current external information: libraries, APIs, docs, comparisons and facts from the web.",
  operator: "Operating apps on the owner's Mac through the automation helper: screen, input, apps and browser.",
};

export const ROLE_KEYWORDS: Record<AgentRole, readonly string[]> = {
  lead: ["plan", "planning", "break down", "coordinate", "roadmap", "milestone", "prioritize", "scope", "delegate"],
  engineer: ["implement", "build", "code", "fix", "refactor", "function", "endpoint", "api", "module", "bug", "feature", "script", "compile", "migration"],
  designer: ["design", "image", "logo", "icon", "illustration", "video", "visual", "color", "layout", "style", "css", "mockup", "banner"],
  reviewer: ["review", "code review", "pull request", "diff", "approve", "critique", "feedback"],
  qa: ["test", "tests", "testing", "e2e", "coverage", "reproduce", "regression", "verify", "acceptance"],
  security: ["security", "vulnerability", "vulnerabilities", "cve", "secret", "secrets", "auth", "xss", "csrf", "injection", "permission", "owasp", "audit"],
  researcher: ["research", "look up", "find out", "compare", "investigate", "documentation", "survey", "sources", "evaluate options"],
  operator: ["open app", "click", "screenshot", "browser", "desktop", "window", "keyboard", "mouse", "automate", "mac"],
};

function roleScores(task: { title: string; spec: string }, roles: readonly AgentRole[]): Map<AgentRole, number> {
  const scores = new Map<AgentRole, number>();
  for (const r of roles) scores.set(r, keywordHits(task.title, ROLE_KEYWORDS[r]) * 2 + keywordHits(task.spec, ROLE_KEYWORDS[r]));
  return scores;
}

export function planRoute(input: RouteInput): DecisionPlan<RouteResult> {
  const valid = uniq(input.candidates.filter((r) => (AGENT_ROLES as readonly string[]).includes(r)));
  const candidates: AgentRole[] = valid.length > 0 ? valid : [...AGENT_ROLES];
  const criteria: Record<string, string> = {};
  for (const r of candidates) criteria[r] = ROLE_CRITERIA[r];

  const state = {
    product: PRODUCT,
    task: clip(input.goal, 400),
    proposal: { title: clip(input.task.title, 200), spec: clip(input.task.spec, 1200) },
    law: ["Every unit of work has exactly one owner role; others may review."],
    evidence: { candidates },
  };
  const questions: Record<string, JevQuestion> = {
    owner: {
      type: "choice",
      instructions: "Pick the single crew role that should own this unit of work, given state.proposal and state.task. Owner means it does the work; others may review.",
      criteria,
    },
    split: {
      type: "noul",
      instructions: "Yes means proceed as one unit with one owner. No means the work spans more than one role's surface and must be split into smaller tasks before dispatch.",
    },
  };

  const only = candidates.length === 1 ? candidates[0]! : null;
  const precheck: PrecheckOutcome<RouteResult> | null = only
    ? { rule: "single_candidate", result: { role: only, split: false }, answers: {}, action: `precheck: dispatch to ${only} (only candidate)`, confidence: null }
    : null;

  const finish = (role: AgentRole, split: boolean, consultant: AgentRole | null) =>
    split ? `split before dispatch (owner ${role})` : `dispatch to ${role}${consultant ? `, ${consultant} consults` : ""}`;

  return {
    decisionId: CATALOG_IDS.route,
    runId: input.runId,
    precheck,
    state,
    questions,
    interpret(answers) {
      const owner = readChoice(answers.owner, candidates);
      const oneUnit = readNoul(answers.split);
      if (!owner || oneUnit === null) return null;
      const split = oneUnit < 0.5;
      const consultant = owner.confidence < LOW_CONFIDENCE ? owner.runnerUp : null;
      return {
        result: { role: owner.choice, split },
        answers: { owner: choiceRecord(owner), split: { type: "noul", noul: oneUnit }, ...(consultant ? { consultant } : {}) },
        action: finish(owner.choice, split, consultant),
        confidence: owner.confidence,
      };
    },
    fallback() {
      const scores = roleScores(input.task, candidates);
      let role: AgentRole = candidates.includes("engineer") ? "engineer" : candidates[0]!;
      let best = 0;
      for (const r of candidates) {
        const s = scores.get(r) ?? 0;
        if (s > best) {
          best = s;
          role = r;
        }
      }
      const strongOthers = candidates.filter((r) => r !== role && (scores.get(r) ?? 0) >= 2).length;
      const split = strongOthers >= 2;
      return {
        result: { role, split },
        answers: {
          owner: heuristicChoice(role),
          split: heuristicNoul(split ? 0.3 : 0.7),
          fallback: `keyword match picked ${role} (score ${best}); ${strongOthers} other roles strongly matched`,
        },
        action: finish(role, split, null),
        confidence: null,
      };
    },
  };
}

// -------------------------------------------------------------- orch.model

export interface ModelTierInput {
  runId: string;
  role: AgentRole;
  task: { title: string; spec: string; acceptance: string[] };
  signals: { priorFailures: number; risk: boolean; files: number; history?: Partial<Record<Tier, { uses: number; wins: number }>> };
  available: Tier[];
}

export const TIER_CRITERIA: Record<Tier, string> = {
  fast: "Mechanical and bounded: one or two files, an obvious change, no design judgment. Renames, lookups, formatting, simple edits, summaries.",
  balanced: "Standard work: several files inside one area, established patterns to follow, clear acceptance criteria.",
  deep: "Hard reasoning: architecture or cross-module design, security-sensitive logic, unknown root cause, ambiguous requirements, or work that already failed before.",
};

const HARD_WORDS = ["architecture", "design", "refactor", "security", "migrate", "migration", "debug", "race", "concurrency", "performance", "root cause", "cross-module", "protocol", "encryption"];

export function tierRank(t: Tier): number {
  return TIERS.indexOf(t);
}

/** Nearest available tier at or above t, else the highest available below it. */
export function clampTier(t: Tier, available: readonly Tier[]): Tier {
  if (available.includes(t)) return t;
  const up = available.filter((a) => tierRank(a) > tierRank(t)).sort((a, b) => tierRank(a) - tierRank(b));
  if (up[0]) return up[0];
  const down = available.filter((a) => tierRank(a) < tierRank(t)).sort((a, b) => tierRank(b) - tierRank(a));
  return down[0] ?? t;
}

function smoothedWinRate(h: { uses: number; wins: number } | undefined): number | null {
  if (!h || h.uses <= 0) return null;
  return (h.wins + 1) / (h.uses + 2);
}

export function planModelTier(input: ModelTierInput): DecisionPlan<Tier> {
  const avail = uniq(input.available.filter((t) => (TIERS as readonly string[]).includes(t)));
  const available: Tier[] = (avail.length > 0 ? avail : [...TIERS]).sort((a, b) => tierRank(a) - tierRank(b));
  const criteria: Record<string, string> = {};
  for (const t of available) criteria[t] = TIER_CRITERIA[t];
  const history: Record<string, { uses: number; wins: number; winRate: number | null }> = {};
  for (const t of TIERS) {
    const h = input.signals.history?.[t];
    if (h) history[t] = { uses: h.uses, wins: h.wins, winRate: h.uses > 0 ? round2(h.wins / h.uses) : null };
  }

  const state = {
    product: PRODUCT,
    task: `Pick the model tier for one ${input.role} task.`,
    proposal: { role: input.role, title: clip(input.task.title, 200), spec: clip(input.task.spec, 1200), acceptance: input.task.acceptance.slice(0, 8).map((a) => clip(a, 160)) },
    law: ["Use the cheapest tier that gets the task right the first time."],
    evidence: { files: input.signals.files, risk: input.signals.risk, priorFailures: input.signals.priorFailures, history },
    constraints: { available },
  };
  const questions: Record<string, JevQuestion> = {
    tier: {
      type: "choice",
      instructions:
        "Pick the cheapest model tier that will get this task right the first time, from state.proposal and state.evidence (files touched, risk, prior failures, and this role's per-tier win history).",
      criteria,
    },
  };

  const precheck: PrecheckOutcome<Tier> | null =
    available.length === 1
      ? { rule: "single_tier", result: available[0]!, answers: {}, action: `precheck: use ${available[0]} tier (only tier available)`, confidence: null }
      : null;

  return {
    decisionId: CATALOG_IDS.modelTier,
    runId: input.runId,
    precheck,
    state,
    questions,
    interpret(answers) {
      const c = readChoice(answers.tier, available);
      if (!c) return null;
      let tier = c.choice;
      let lowRule = false;
      if (c.confidence < LOW_CONFIDENCE && c.runnerUp && tierRank(c.runnerUp) > tierRank(tier)) {
        tier = c.runnerUp;
        lowRule = true;
      }
      return {
        result: tier,
        answers: { tier: choiceRecord(c, lowRule ? { applied: tier, rule: "low confidence: higher of primary and runner-up" } : {}) },
        action: `use ${tier} tier`,
        confidence: c.confidence,
      };
    },
    fallback() {
      const s = input.signals;
      const text = `${input.task.title} ${input.task.spec}`;
      let score = 0;
      if (s.files > 5) score += 2;
      else if (s.files >= 2) score += 1;
      if (s.risk) score += 2;
      score += Math.min(2, Math.max(0, s.priorFailures));
      if (input.task.acceptance.length > 4) score += 1;
      if (input.task.spec.length > 1500) score += 1;
      if (keywordHits(text, HARD_WORDS) > 0) score += 1;
      let tier: Tier = score >= 4 ? "deep" : score >= 2 ? "balanced" : "fast";
      const reasons = [`complexity score ${score}`];
      const rate = smoothedWinRate(s.history?.[tier]);
      const uses = s.history?.[tier]?.uses ?? 0;
      if (rate !== null && uses >= 3 && rate < 0.5 && tier !== "deep") {
        tier = TIERS[tierRank(tier) + 1]!;
        reasons.push(`history win rate ${round2(rate)} moved it up`);
      }
      const chosen = clampTier(tier, available);
      if (chosen !== tier) reasons.push(`${tier} not available`);
      return {
        result: chosen,
        answers: { tier: heuristicChoice(chosen), fallback: reasons.join("; ") },
        action: `use ${chosen} tier`,
        confidence: null,
      };
    },
  };
}

// ---------------------------------------------------------- orch.loop_exit

export type LoopNext = "exit_done" | "another_round" | "change_approach" | "escalate";

export interface LoopExitInput {
  runId: string;
  goal: string;
  round: number;
  gates: Array<{ name: string; ok: boolean }>;
  open: Array<{ severity: Severity; title: string }>;
  recurring: number;
}
export interface LoopExitResult {
  next: LoopNext;
  meetsAsk: number;
}

const LOOP_CRITERIA: Record<LoopNext, string> = {
  exit_done: "Every gate is green and the remaining notes are minor and do not affect what was asked.",
  another_round: "Fixable findings remain and the current approach is converging: each round has fewer or smaller findings.",
  change_approach: "The same class of finding keeps recurring after fixes; the approach is not converging and needs a different design.",
  escalate: "Blocked on a decision outside the crew's authority, or on missing input from the owner.",
};

const LOOP_ACTION: Record<LoopNext, string> = {
  exit_done: "exit the review loop",
  another_round: "run another review round",
  change_approach: "send back to the owner to change approach",
  escalate: "escalate",
};

const BLOCKING: readonly Severity[] = ["critical", "high"];

export function planLoopExit(input: LoopExitInput): DecisionPlan<LoopExitResult> {
  const failing = input.gates.filter((g) => !g.ok).map((g) => g.name);
  const blockingOpen = input.open.filter((f) => BLOCKING.includes(f.severity));
  const blocked = failing.length > 0 || blockingOpen.length > 0;
  const atCap = input.round >= MAX_REVIEW_ROUNDS;
  const options: LoopNext[] = atCap ? ["exit_done", "escalate"] : ["exit_done", "another_round", "change_approach", "escalate"];
  if (blocked) options.splice(options.indexOf("exit_done"), 1);
  const criteria: Record<string, string> = {};
  for (const o of options) criteria[o] = LOOP_CRITERIA[o];

  const counts: Record<string, number> = {};
  for (const f of input.open) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const state = {
    product: PRODUCT,
    task: clip(input.goal, 400),
    proposal: "Decide the next step of the build-review loop for this task.",
    law: [
      "The loop cannot exit with a failing gate or an open critical or high finding.",
      `At most ${MAX_REVIEW_ROUNDS} review rounds per task.`,
    ],
    evidence: {
      round: input.round,
      gates: input.gates.map((g) => ({ name: clip(g.name, 80), ok: g.ok })),
      open: input.open.slice(0, 20).map((f) => ({ severity: f.severity, title: clip(f.title, 160) })),
      openCounts: counts,
      recurring: input.recurring,
    },
  };
  const questions: Record<string, JevQuestion> = {
    next: { type: "choice", instructions: "Decide the next step of the build-review loop from state.evidence.", criteria },
    meets_ask: { type: "noul", instructions: "Yes means the current build satisfies what was asked in state.task, no more and no less." },
  };

  const precheck: PrecheckOutcome<LoopExitResult> | null =
    atCap && blocked
      ? {
          rule: "max_rounds_blocked",
          result: { next: "escalate", meetsAsk: 0 },
          answers: { failingGates: failing, blockingOpen: blockingOpen.length },
          action: `precheck: escalate (round ${input.round} of ${MAX_REVIEW_ROUNDS} still blocked)`,
          confidence: null,
        }
      : null;

  // exit_done needs meets_ask >= 0.7; below that the loop continues (or escalates at the cap).
  const applyThresholds = (next: LoopNext, meetsAsk: number): LoopNext => {
    if (next !== "exit_done" || meetsAsk >= 0.7) return next;
    return atCap ? "escalate" : "another_round";
  };

  return {
    decisionId: CATALOG_IDS.loopExit,
    runId: input.runId,
    precheck,
    state,
    questions,
    interpret(answers) {
      const c = readChoice(answers.next, options);
      const meetsAsk = readNoul(answers.meets_ask);
      if (!c || meetsAsk === null) return null;
      let next = c.choice;
      let lowRule = false;
      if (c.confidence < LOW_CONFIDENCE && next === "exit_done") {
        next = c.runnerUp ?? (atCap ? "escalate" : "another_round");
        lowRule = true;
      }
      const final = applyThresholds(next, meetsAsk);
      return {
        result: { next: final, meetsAsk },
        answers: {
          next: choiceRecord(c, lowRule ? { applied: next, rule: "low confidence: never exit on a coin flip, runner-up taken" } : {}),
          meets_ask: { type: "noul", noul: meetsAsk },
        },
        action: LOOP_ACTION[final],
        confidence: c.confidence,
      };
    },
    fallback() {
      const okRatio = input.gates.length > 0 ? input.gates.filter((g) => g.ok).length / input.gates.length : 1;
      const mediumOpen = input.open.some((f) => f.severity === "medium");
      const meetsAsk = round2(blocked ? okRatio * 0.5 : mediumOpen ? okRatio * 0.5 : okRatio);
      let next: LoopNext;
      let why: string;
      if (blocked) {
        next = input.recurring >= 2 ? "change_approach" : "another_round";
        why = `blocked (${failing.length} failing gates, ${blockingOpen.length} critical/high open), ${input.recurring} recurring`;
      } else if (input.open.length > 0 && input.recurring >= 2 && !atCap) {
        next = "change_approach";
        why = `${input.recurring} findings recurring after fixes`;
      } else if (mediumOpen) {
        next = atCap ? "escalate" : "another_round";
        why = "medium findings still open";
      } else {
        next = "exit_done";
        why = "gates green, only minor notes open";
      }
      const final = applyThresholds(next, meetsAsk);
      return {
        result: { next: final, meetsAsk },
        answers: { next: heuristicChoice(final), meets_ask: heuristicNoul(meetsAsk), fallback: why },
        action: LOOP_ACTION[final],
        confidence: null,
      };
    },
  };
}

// ----------------------------------------------------------- orch.escalate

export type Decider = "crew" | "lead" | "human";

export interface EscalateInput {
  runId: string;
  proposal: string;
  impact: string;
  reversibleHint: boolean;
}
export interface EscalateResult {
  decider: Decider;
  reversible: number;
}

const DECIDER_CRITERIA: Record<Decider, string> = {
  crew: "Inside the current goal and task, reversible, no change the owner would notice beyond the ask. The owning agent decides.",
  lead: "Inside the goal but crosses tasks or roles, trades quality against time, or changes the plan. The lead cat decides.",
  human: "Changes behavior the owner will notice beyond the goal, costs money or time, or carries risk the crew cannot cheaply reverse. The owner decides.",
};
const DECIDER_RANK: Record<Decider, number> = { crew: 0, lead: 1, human: 2 };
const DECIDER_ACTION: Record<Decider, string> = { crew: "owning agent proceeds", lead: "lead decides", human: "ask the owner" };

/** Always the owner's call: never sent to JEV (mirrors the automation law). */
export const ALWAYS_HUMAN: ReadonlyArray<{ rule: string; re: RegExp }> = [
  { rule: "destructive_data_or_history", re: /\b(drop\s+(table|database|schema|column)|truncate\s+table|delete\s+(all|every|the\s+database|production|prod)|wipe|rm\s+-rf|force[\s-]push|reset\s+--hard|rewrite\s+(git\s+)?history)\b/i },
  // money needs a spending action, not a bare noun: "fix the payment form" or
  // "SSE subscription" is ordinary work and goes to JEV
  {
    rule: "money",
    re: /\b(make|makes|making|process|processing|authori[sz]e|approve|send|sending|submit)\s+(a\s+|an\s+|the\s+)?payments?\b|\bpay(ing)?\s+(for\b|the\s+(invoice|bill|fee|vendor)\b|\$|\d)|\bpurchas(e|es|ed|ing)\b|\bbuy(s|ing)?\b|\bsubscrib(e|es|ing)\s+to\b(?!\s+(the\s+)?(sse|events?|streams?|channels?|topics?|store|updates|changes)\b)|\bupgrad(e|es|ing)\s+to\s+(a\s+|the\s+)?paid\b|\bcharge\s+the\s+card\b|\b(raise|increase|exceed)\w*\s+(the\s+)?budget\b/i,
  },
  { rule: "production_release", re: /\b(deploy|publish|release|ship)\w*\s+(it\s+)?(to\s+)?(prod|production|live|the\s+app\s+store)\b|\bpush\s+to\s+(main|master|production)\b/i },
  { rule: "credentials", re: /\b(share|send|upload|expose|print|commit|rotate|revoke)\w*\b.{0,40}\b(api\s+key|credential|password|secret|private\s+key|keychain)s?\b/i },
  { rule: "system_change", re: /\bsudo\b|\b(install|uninstall)\w*\s+(a\s+|an\s+)?(system|global|homebrew|brew|kernel)\b/i },
  { rule: "external_send", re: /\b(send|email|post|upload|share)\w*\b.{0,40}\b(personal|customer|user|owner)\s+data\b/i },
];

const OWNER_VISIBLE = /\b(cost|costs|price|pricing|timeline|deadline|user-visible|visible\s+to|customers?|public|breaking\s+change|scope)\b/i;

export function planEscalate(input: EscalateInput): DecisionPlan<EscalateResult> {
  const text = `${input.proposal}\n${input.impact}`;
  const hit = ALWAYS_HUMAN.find((r) => r.re.test(text));
  const state = {
    product: PRODUCT,
    task: "Decide who makes a call that surfaced mid-run.",
    proposal: clip(input.proposal, 600),
    law: ["Destructive, money, production release, credential and system-level changes always go to the owner."],
    evidence: { impact: clip(input.impact, 600), reversibleHint: input.reversibleHint },
  };
  const questions: Record<string, JevQuestion> = {
    decider: {
      type: "choice",
      instructions: "Who should make the decision in state.proposal, given state.evidence? Choose the lowest level that has the authority and the context.",
      criteria: { ...DECIDER_CRITERIA },
    },
    reversible: { type: "noul", instructions: "Yes means the decision can be fully undone within one day with no data loss and no impact on the owner." },
  };

  const precheck: PrecheckOutcome<EscalateResult> | null = hit
    ? { rule: hit.rule, result: { decider: "human", reversible: 0 }, answers: {}, action: `precheck: ask the owner (${hit.rule})`, confidence: null }
    : null;

  const thresholds = (decider: Decider, reversible: number): Decider => (decider === "crew" && reversible < 0.3 ? "lead" : decider);

  return {
    decisionId: CATALOG_IDS.escalate,
    runId: input.runId,
    precheck,
    state,
    questions,
    interpret(answers) {
      const c = readChoice(answers.decider, ["crew", "lead", "human"] as const);
      const reversible = readNoul(answers.reversible);
      if (!c || reversible === null) return null;
      let decider = c.choice;
      let lowRule = false;
      if (c.confidence < LOW_CONFIDENCE && c.runnerUp && DECIDER_RANK[c.runnerUp] > DECIDER_RANK[decider]) {
        decider = c.runnerUp;
        lowRule = true;
      }
      const final = thresholds(decider, reversible);
      return {
        result: { decider: final, reversible },
        answers: {
          decider: choiceRecord(c, lowRule ? { applied: decider, rule: "low confidence: higher authority of primary and runner-up" } : {}),
          reversible: { type: "noul", noul: reversible },
        },
        action: DECIDER_ACTION[final],
        confidence: c.confidence,
      };
    },
    fallback() {
      const reversible = input.reversibleHint ? 0.7 : 0.2;
      let decider: Decider;
      let why: string;
      if (OWNER_VISIBLE.test(text)) {
        decider = "human";
        why = "impact mentions cost, timeline, scope or owner-visible change";
      } else if (!input.reversibleHint) {
        decider = "lead";
        why = "not marked reversible";
      } else {
        decider = "crew";
        why = "reversible and inside the task";
      }
      const final = thresholds(decider, reversible);
      return {
        result: { decider: final, reversible },
        answers: { decider: heuristicChoice(final), reversible: heuristicNoul(reversible), fallback: why },
        action: DECIDER_ACTION[final],
        confidence: null,
      };
    },
  };
}

// ------------------------------------------------------------- mem.promote

export type PromoteScope = "global" | "project" | "discard";

export interface PromoteInput {
  lesson: string;
  context: string;
  existing: string[];
  projects: number;
}
export interface PromoteResult {
  scope: PromoteScope;
  durable: number;
}

const SCOPE_CRITERIA: Record<PromoteScope, string> = {
  global: "True for any project the crew works on, not tied to this project's code, data, vendors or quirks.",
  project: "True for this project only: its code, data, setup, vendors or quirks.",
  discard: "Obvious, one-off, already covered by an existing lesson, or not useful to a future agent.",
};
const SCOPE_ACTION: Record<PromoteScope, string> = { global: "promote to global", project: "keep in project memory", discard: "discard" };

const TEMPORARY = /\b(today|currently|for now|temporary|temporarily|this time|workaround|hotfix|todo|until)\b/i;
const PROJECT_SPECIFIC = /[\w./-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|md|json|ya?ml|toml|sh|sql|css|html)\b|\b(?:src|apps|packages|lib)\/[\w./-]+/i;
export const DUPLICATE_JACCARD = 0.8;

export function planPromoteLesson(input: PromoteInput): DecisionPlan<PromoteResult> {
  const lesson = input.lesson.trim();
  const words = lesson.match(/[A-Za-z0-9]+/g) ?? [];
  const mine = shingles(lesson);
  const dup = input.existing.find((e) => jaccard(mine, shingles(e)) >= DUPLICATE_JACCARD);

  const state = {
    product: PRODUCT,
    task: "Decide where a learning from a run belongs.",
    proposal: clip(lesson, 600),
    law: [`Global lessons need evidence from at least ${GLOBAL_PROMOTION_PROJECTS} projects.`, "Lessons never hold secrets or personal data."],
    evidence: { context: clip(input.context, 400), existing: input.existing.slice(0, 5).map((e) => clip(e, 200)), projects: input.projects },
  };
  const questions: Record<string, JevQuestion> = {
    scope: { type: "choice", instructions: "Decide where the learning in state.proposal belongs, given state.evidence.", criteria: { ...SCOPE_CRITERIA } },
    durable: { type: "noul", instructions: "Yes means the learning will still be true and useful in three months." },
  };

  let precheck: PrecheckOutcome<PromoteResult> | null = null;
  const discard = (rule: string, why: string): PrecheckOutcome<PromoteResult> => ({
    rule,
    result: { scope: "discard", durable: 0 },
    answers: {},
    action: `precheck: discard (${why})`,
    confidence: null,
  });
  if (redact(lesson) !== lesson) precheck = discard("contains_secret", "contains a secret");
  else if (words.length < 4 || lesson.length < 16) precheck = discard("too_short", "too short to be useful");
  else if (dup !== undefined) precheck = discard("duplicate", "already covered by an existing lesson");

  const thresholds = (scope: PromoteScope, durable: number): PromoteScope => {
    if (durable < 0.5) return "discard";
    if (scope === "global" && input.projects < GLOBAL_PROMOTION_PROJECTS) return "project";
    return scope;
  };

  return {
    decisionId: CATALOG_IDS.promoteLesson,
    runId: null,
    precheck,
    state,
    questions,
    interpret(answers) {
      const c = readChoice(answers.scope, ["global", "project", "discard"] as const);
      const durable = readNoul(answers.durable);
      if (!c || durable === null) return null;
      let scope = c.choice;
      let lowRule = false;
      if (c.confidence < LOW_CONFIDENCE) {
        if (scope === "global") scope = "project";
        else if (scope === "discard" && c.runnerUp === "project") scope = "project";
        lowRule = scope !== c.choice;
      }
      const final = thresholds(scope, durable);
      return {
        result: { scope: final, durable },
        answers: {
          scope: choiceRecord(c, lowRule ? { applied: scope, rule: "low confidence: narrow to project" } : {}),
          durable: { type: "noul", noul: durable },
        },
        action: SCOPE_ACTION[final],
        confidence: c.confidence,
      };
    },
    fallback() {
      const temporary = TEMPORARY.test(lesson);
      const durable = temporary ? 0.3 : 0.6;
      const specific = PROJECT_SPECIFIC.test(lesson);
      const scope: PromoteScope = specific ? "project" : "global";
      const final = thresholds(scope, durable);
      const why = temporary ? "reads as temporary" : specific ? "names project files" : `general wording, ${input.projects} projects of evidence`;
      return {
        result: { scope: final, durable },
        answers: { scope: heuristicChoice(final), durable: heuristicNoul(durable), fallback: why },
        action: SCOPE_ACTION[final],
        confidence: null,
      };
    },
  };
}

// ------------------------------------------------------------ sec.severity

export interface SeverityInput {
  runId: string | null;
  finding: { kind: ScanKind; rule: string; title: string; detail: string };
  ruleSeverity: Severity;
}

const SEVERITY_CRITERIA: Record<Severity, string> = {
  critical: "Unauthenticated or trivial exploitation with account takeover, data breach, code execution, or payment abuse.",
  high: "Serious impact reachable by an authenticated or moderately skilled attacker, such as privilege escalation or access to other users' data.",
  medium: "Real but limited impact, or needs unlikely preconditions, such as stored XSS behind an admin or a missing rate limit on a sensitive route.",
  low: "Minor impact or a defense-in-depth gap with no direct exploit path, such as a missing header on a non-sensitive route.",
  info: "Hygiene observation with no security impact today.",
};
const SEVERITY_ACTION: Record<Severity, string> = {
  critical: "block ship, fix now",
  high: "block ship, fix now",
  medium: "fix before ship",
  low: "log to backlog",
  info: "log to backlog",
};
/** lower index = higher grade */
export function severityRank(s: Severity): number {
  return SEVERITIES.indexOf(s);
}

const CRITICAL_CLASSES = /\b(remote\s+code\s+execution|rce|command\s+injection|auth(entication)?\s+bypass)\b/i;

export function planSeverity(input: SeverityInput): DecisionPlan<Severity> {
  const f = input.finding;
  const state = {
    product: PRODUCT,
    task: "Grade a security finding in the owner's codebase.",
    proposal: { kind: f.kind, rule: clip(f.rule, 120), title: clip(f.title, 200), detail: clip(f.detail, 600) },
    law: ["Leaked secrets, authentication bypass and remote code execution are critical."],
    evidence: { ruleSeverity: input.ruleSeverity },
  };
  const questions: Record<string, JevQuestion> = {
    severity: { type: "choice", instructions: "Grade the finding in state.proposal by impact and exploitability.", criteria: { ...SEVERITY_CRITERIA } },
  };

  let precheck: PrecheckOutcome<Severity> | null = null;
  if (f.kind === "secrets") precheck = { rule: "leaked_secret", result: "critical", answers: {}, action: `precheck: critical, ${SEVERITY_ACTION.critical}`, confidence: null };
  else if (CRITICAL_CLASSES.test(`${f.rule} ${f.title}`))
    precheck = { rule: "rce_or_auth_bypass", result: "critical", answers: {}, action: `precheck: critical, ${SEVERITY_ACTION.critical}`, confidence: null };

  return {
    decisionId: CATALOG_IDS.severity,
    runId: input.runId,
    precheck,
    state,
    questions,
    interpret(answers) {
      const c = readChoice(answers.severity, SEVERITIES);
      if (!c) return null;
      let sev = c.choice;
      let lowRule = false;
      if (c.confidence < LOW_CONFIDENCE && c.runnerUp && severityRank(c.runnerUp) < severityRank(sev)) {
        sev = c.runnerUp;
        lowRule = true;
      }
      return {
        result: sev,
        answers: { severity: choiceRecord(c, lowRule ? { applied: sev, rule: "low confidence: higher grade of primary and runner-up" } : {}) },
        action: `${sev}, ${SEVERITY_ACTION[sev]}`,
        confidence: c.confidence,
      };
    },
    fallback() {
      const sev = input.ruleSeverity;
      return {
        result: sev,
        answers: { severity: heuristicChoice(sev), fallback: "rule table severity" },
        action: `${sev}, ${SEVERITY_ACTION[sev]}`,
        confidence: null,
      };
    },
  };
}
