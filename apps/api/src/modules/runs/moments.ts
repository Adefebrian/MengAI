// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Island moment hints: the facts the engine knows best (a review verdict,
// the CEO answering a crew request, a cat rethinking or stuck, the budget
// running low), as one plain sentence each. Facts only, never an animation
// name: the island decides how a moment looks. Pure, no I/O.
import { MOMENT_BUDGET_LOW_SHARE, MOMENT_TEXT_MAX, type EventMap, type MomentKind, type MomentLevel } from "@mengai/shared";
import type { BudgetView } from "./org";
import { bounded } from "./policy";

export type MomentPayload = EventMap["moment"];

/** Who and what a moment is about: AgentDTO and TaskDTO fit as they are. */
export interface MomentAbout {
  cat: { id: string; name: string } | null | undefined;
  task?: { id: string; title: string } | null;
  /** the crew cat whose request the CEO answered */
  asker?: string;
}

const LEVEL: Record<MomentKind, MomentLevel> = {
  review_pass: "good",
  ceo_approved: "good",
  review_fail: "bad",
  ceo_denied: "bad",
  stuck: "bad",
  budget_low: "bad",
  rethink: "info",
};

const SENTENCE: Record<MomentKind, (cat: string, task: string, asker: string) => string> = {
  review_pass: (cat, task) => `${cat} passed ${task} in review.`,
  review_fail: (cat, task) => `${cat} sent ${task} back after review.`,
  ceo_approved: (cat, _task, asker) => `${cat} approved ${asker}'s request.`,
  ceo_denied: (cat, _task, asker) => `${cat} turned down ${asker}'s request.`,
  rethink: (cat, task) => `${cat} is taking another look at ${task}.`,
  stuck: (cat, task) => `${cat} is stuck on ${task}.`,
  budget_low: () => `The run has used ${Math.round(MOMENT_BUDGET_LOW_SHARE * 100)}% of its budget.`,
};

/** One line, redacted, capped. */
const line = (text: string, max: number) => bounded(String(text ?? "").replace(/\s+/g, " "), max);

/** The moment payload; a long task title is shortened so the sentence keeps its end, then the whole is capped. */
export function momentFor(kind: MomentKind, about: MomentAbout): MomentPayload {
  const cat = line(about.cat?.name ?? "", 40) || "The crew";
  const asker = line(about.asker ?? "", 40) || "a cat";
  const say = (title: string) => SENTENCE[kind](cat, title, asker);
  const room = Math.max(12, MOMENT_TEXT_MAX - say("").length);
  const text = line(say(line(about.task?.title ?? "", room) || "the task"), MOMENT_TEXT_MAX);
  return { kind, agentId: about.cat?.id ?? null, taskId: about.task?.id ?? null, level: LEVEL[kind], text };
}

/** True once usage reaches MOMENT_BUDGET_LOW_SHARE of either budget; a 0 budget is unlimited and never runs low. */
export function budgetLow(b: BudgetView): boolean {
  return (b.budgetTokens > 0 && b.usedTokens >= b.budgetTokens * MOMENT_BUDGET_LOW_SHARE) || (b.budgetUsd > 0 && b.usedUsd >= b.budgetUsd * MOMENT_BUDGET_LOW_SHARE);
}
