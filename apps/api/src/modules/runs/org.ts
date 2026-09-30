// The unlimited org: who hires whom, why, and when a struggling cat is let
// go. Any cat can hire a helper at any depth; the owner's maxAgents and
// maxDepth (0 = unlimited) and the run budget bound it, the scheduler's
// concurrency queue bounds how many cats work at once. Soft calls (hire or
// do it yourself, hire or wait, let go, coach or keep) go to runtime JEV
// (judge.ts); these are the pure rules around them.
import { bounded, withArticle } from "./policy";

export const ORG = {
  /** an optional hire needs at least this much token budget left per live cat, after the hire */
  reserveTokensPerCat: 25_000,
  /** no optional hires once this share of the USD budget is spent */
  usdShare: 0.7,
  /** JEV orch.playbooks let_go_ask_threshold: runtime JEV is asked at three failures in a row */
  askAfter: 3,
  /** JEV orch.playbooks departures_per_run: three */
  maxDepartures: 3,
  reasonChars: 160,
} as const;

export type HireKind = "lead" | "needed" | "handoff" | "helper" | "queue" | "replacement";

export interface BudgetView {
  budgetTokens: number;
  usedTokens: number;
  budgetUsd: number;
  usedUsd: number;
}

/** Budget-aware check for an optional cat: enough tokens left per live cat after the hire, USD not mostly spent. 0 budgets are unlimited. */
export function canAffordHire(b: BudgetView, liveCats: number): boolean {
  if (b.budgetTokens > 0) {
    const left = b.budgetTokens - b.usedTokens;
    if (left < ORG.reserveTokensPerCat * (liveCats + 1)) return false;
  }
  if (b.budgetUsd > 0 && b.usedUsd >= ORG.usdShare * b.budgetUsd) return false;
  return true;
}

/** Share of the token budget still left, 0..1; null when the budget is unlimited. */
export function budgetLeftShare(b: BudgetView): number | null {
  if (b.budgetTokens <= 0) return null;
  return Math.max(0, Math.min(1, (b.budgetTokens - b.usedTokens) / b.budgetTokens));
}

/** Depth of an agent in the org tree: the CEO is 0, the cats it hired 1, their helpers 2. */
export function depthOf(agentId: string | null, parentOf: (id: string) => string | null | undefined): number {
  let d = 0;
  let cur = agentId;
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const p = parentOf(cur);
    if (!p) break;
    d++;
    cur = p;
  }
  return d;
}

/** Role titles that read as adjectives get "cat": "a security cat", "a QA cat". */
const ADJECTIVE_TITLES = new Set(["security", "qa", "lead"]);

/** "an engineer", "a QA cat", "a launch tester" */
export function aRole(title: string): string {
  const low = title.trim().toLowerCase();
  const noun = ADJECTIVE_TITLES.has(low) ? `${low === "qa" ? "QA" : low} cat` : low;
  return withArticle(noun);
}

/** "engineer", "QA cat", "launch tester" (no article) */
const roleNoun = (title: string) => aRole(title).replace(/^an? /, "");

export function hireReason(kind: HireKind, title: string, detail: { waiting?: number; task?: string; by?: string; replaces?: string } = {}): string {
  const task = detail.task ? `: ${detail.task}` : "";
  switch (kind) {
    case "lead":
      return bounded("Runs the company for this goal", ORG.reasonChars);
    case "needed":
      return bounded(`The plan needs ${aRole(title)}${task}`, ORG.reasonChars);
    case "handoff":
      return bounded(`${detail.by ?? "A cat"} needs ${aRole(title)}${task}`, ORG.reasonChars);
    case "helper":
      return bounded(`${detail.by ?? "A cat"} hired ${aRole(title)} as a helper${task}`, ORG.reasonChars);
    case "queue": {
      const n = detail.waiting ?? 1;
      const noun = roleNoun(title);
      return bounded(`${n} ${noun} task${n === 1 ? " is" : "s are"} waiting and every ${noun} is busy`, ORG.reasonChars);
    }
    case "replacement":
      return bounded(`Replaces ${detail.replaces ?? "a cat that left"}${task}`, ORG.reasonChars);
  }
}

export function letGoReason(failures: number, last: string | null): string {
  return bounded(`Let go after ${failures} failures in a row${last ? `. Last: ${last}` : ""}`, ORG.reasonChars);
}
