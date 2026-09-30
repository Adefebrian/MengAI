// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Pure orchestration policy: limits, mood, repeat guards, estimate math and
// text bounding. No I/O here, so every rule is unit-testable on its own.
import type { AgentRole, Mood } from "@mengai/shared";
import { redact } from "../../lib/redact";
import type { HistoryRow } from "./repo";

export const LIMITS = {
  maxStepsPerTask: 24,
  identicalCallLimit: 3,
  identicalErrorLimit: 3,
  noProgressLimit: 3,
  taskWallClockMs: 15 * 60_000,
  maxTasksPerCall: 12,
  maxTasksPerRun: 80,
  maxReviewRounds: 3,
  hardReviewRounds: 5,
  maxHandoffDepth: 2,
  perRoleAgents: 2,
  finalReportsCap: 3,
  tiredRunMs: 45 * 60_000,
  tiredShare: 0.8,
  focusedSteps: 6,
  frustratedFailures: 2,
  sayChars: 280,
  statusChars: 80,
  resultChars: 2000,
  noteChars: 2000,
  depSummaryChars: 400,
  toolOutputStoreChars: 200_000,
  argsStoreChars: 50_000,
  previewChars: 160,
  inputBudgetCap: 12_000,
  inputBudgetShare: 0.4,
  keepRecentSteps: 4,
  stopGraceMs: 5_000,
  listLimit: 100,
} as const;

/** Output token caps per role (architecture section 7: output caps per role). */
export const OUTPUT_CAP: Record<AgentRole, number> = {
  lead: 4096,
  engineer: 8192,
  designer: 4096,
  reviewer: 2048,
  qa: 4096,
  security: 2048,
  researcher: 4096,
  operator: 2048,
};

/** Titles the engine generates; kinds are inferred from them after a restart. */
export const TITLES = {
  plan: "Plan the work",
  final: "Report to the owner",
  /** final report title used before the rename; still recognized on hydrate */
  legacyFinal: "Final report",
  reviewPrefix: "Review: ",
  fixPrefix: "Fix: ",
  depBlocked: "Blocked: a dependency failed or is blocked",
} as const;

export function roleCap(role: AgentRole): number {
  return role === "lead" ? 1 : LIMITS.perRoleAgents;
}

// ------------------------------------------------------------------- mood
export interface MoodInput {
  /** the agent's last task just passed (done or review pass) and it has not stepped since */
  justPassed: boolean;
  consecutiveFailures: number;
  /** consecutive steps without a failed tool result */
  cleanSteps: number;
  /** input + output tokens this agent used */
  tokensUsed: number;
  /** the agent's share of the run token budget (budget / live agents), 0 = unlimited */
  budgetShare: number;
  runElapsedMs: number;
}

/** Deterministic mood, first match wins in the documented order. */
export function moodFor(i: MoodInput): Mood {
  if (i.justPassed) return "proud";
  if (i.consecutiveFailures >= LIMITS.frustratedFailures) return "frustrated";
  if (i.cleanSteps >= LIMITS.focusedSteps) return "focused";
  const overShare = i.budgetShare > 0 && i.tokensUsed > LIMITS.tiredShare * i.budgetShare;
  if (overShare || i.runElapsedMs > LIMITS.tiredRunMs) return "tired";
  return "calm";
}

// ----------------------------------------------------------------- guards
/** JSON args with sorted keys so {"a":1,"b":2} and {"b":2,"a":1} count as the same call. */
export function stableArgs(raw: string): string {
  try {
    return JSON.stringify(sortKeys(JSON.parse(raw)));
  } catch {
    return raw.trim();
  }
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/**
 * Per-task repeat guards.
 * Identical call guard: counts a streak of identical consecutive calls that
 * also returned identical results. Any different call, or the same call with
 * a different result, restarts the streak, so a normal test, edit, test loop
 * never trips it. Identical error guard: counts one exact error over the task.
 */
export class RepeatGuard {
  private lastCall: string | null = null;
  private lastResult: string | null = null;
  private streak = 0;
  private errors = new Map<string, number>();

  private static key(tool: string, rawArgs: string): string {
    return tool + "\u0000" + stableArgs(rawArgs);
  }

  /** how many identical calls in a row this call would make, when every earlier one returned the same result */
  wouldRepeat(tool: string, rawArgs: string): number {
    return this.lastCall === RepeatGuard.key(tool, rawArgs) ? this.streak + 1 : 1;
  }

  /** records a finished call in model order; returns the current identical streak */
  record(tool: string, rawArgs: string, output: string, ok: boolean): number {
    const call = RepeatGuard.key(tool, rawArgs);
    const result = (ok ? "ok\u0000" : "err\u0000") + output.trim().slice(0, 2000);
    this.streak = call === this.lastCall && result === this.lastResult ? this.streak + 1 : 1;
    this.lastCall = call;
    this.lastResult = result;
    return this.streak;
  }

  /** returns how many times this exact error has now been seen */
  error(tool: string, output: string): number {
    const key = tool + "\u0000" + output.trim().slice(0, 500);
    const n = (this.errors.get(key) ?? 0) + 1;
    this.errors.set(key, n);
    return n;
  }
}

// --------------------------------------------------------------- estimate
export const HEURISTIC = {
  tokensPerTask: 12_000,
  minTasks: 3,
  maxTasks: 14,
  wordsPerTask: 15,
  inputShare: 0.85,
  cachedShareOfInput: 0.3,
} as const;

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** plan + final report + roughly one task per 15 words of goal */
export function heuristicTaskCount(goal: string): number {
  return clamp(HEURISTIC.minTasks + Math.ceil(countWords(goal) / HEURISTIC.wordsPerTask), HEURISTIC.minTasks, HEURISTIC.maxTasks);
}

export interface EstimatePlan {
  tasks: number;
  tokens: number;
  basis: "history" | "heuristic";
  /** observed USD per token from history, null for the heuristic */
  usdPerToken: number | null;
}

/**
 * History: average tokens per task over this project's finished runs, times a
 * task count predicted from the past average scaled by relative goal length.
 * Heuristic: task count from goal length, fixed tokens per task.
 */
export function estimatePlan(goal: string, history: HistoryRow[]): EstimatePlan {
  if (history.length === 0) {
    const tasks = heuristicTaskCount(goal);
    return { tasks, tokens: tasks * HEURISTIC.tokensPerTask, basis: "heuristic", usdPerToken: null };
  }
  const totalTokens = history.reduce((s, h) => s + h.tokens, 0);
  const totalTasks = history.reduce((s, h) => s + h.tasks, 0);
  const totalCost = history.reduce((s, h) => s + h.costUsd, 0);
  const perTask = totalTokens / totalTasks;
  const avgTasks = totalTasks / history.length;
  const avgWords = Math.max(1, history.reduce((s, h) => s + countWords(h.goal), 0) / history.length);
  const ratio = clamp(Math.max(1, countWords(goal)) / avgWords, 0.5, 2);
  const tasks = clamp(Math.round(avgTasks * ratio), 2, LIMITS.maxTasksPerRun);
  return { tasks, tokens: Math.round(perTask * tasks), basis: "history", usdPerToken: totalCost / totalTokens };
}

// ------------------------------------------------------------------- text
/** Redacted, trimmed, capped text that keeps line breaks (summaries, notes). */
export function bounded(text: string, max: number): string {
  const clean = redact(String(text ?? "")).trim();
  return clean.length > max ? clean.slice(0, max - 3) + "..." : clean;
}

/** "an engineer", "a reviewer", "a UX researcher", "an SRE", "an hour": the phrase with its indefinite article. */
export function withArticle(phrase: string): string {
  const p = String(phrase ?? "").trim();
  const word = p.split(/\s+/)[0] ?? "";
  let an: boolean;
  if (/^[A-Z]{2,}\b/.test(word)) an = /^[AEFHILMNORSX]/.test(word);
  else if (/^(uni|use|usu|ure|uti|ux\b|eu|one\b|once\b)/i.test(word)) an = false;
  else if (/^(hour|honest|honor|honour|heir)/i.test(word)) an = true;
  else an = /^[aeiou]/i.test(word);
  return `${an ? "an" : "a"} ${p}`;
}

export function roundUsd(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}
