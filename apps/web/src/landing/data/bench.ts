// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The token benchmark as published in docs/reports/token-benchmark.md
// (measured 2026-09-29 by the evals module on the core fixture suite,
// replayed through the real ContextService; deterministic, no model calls).
// Copied by hand: when the report changes, this file changes with it, and
// bench.test.ts checks the totals still add up.

export interface Scenario {
  id: string;
  role: string;
  steps: number;
  /** Legacy prompt tokens (legacy is uncached, so this is its billable input). */
  legacy: number;
  /** v2 billable input tokens (uncached plus cached at the 0.5 price ratio). */
  v2: number;
  savingsPct: number;
}

export const SCENARIOS: Scenario[] = [
  { id: "engineer-settings-migration", role: "engineer", steps: 24, legacy: 290_434, v2: 106_288, savingsPct: 63.4 },
  { id: "engineer-discount", role: "engineer", steps: 16, legacy: 155_159, v2: 57_786, savingsPct: 62.8 },
  { id: "qa-flaky-checkout", role: "qa", steps: 14, legacy: 131_576, v2: 46_156, savingsPct: 64.9 },
  { id: "reviewer-payments", role: "reviewer", steps: 9, legacy: 67_916, v2: 22_682, savingsPct: 66.6 },
  { id: "security-audit", role: "security", steps: 9, legacy: 63_835, v2: 21_504, savingsPct: 66.3 },
  { id: "researcher-search-index", role: "researcher", steps: 8, legacy: 59_051, v2: 18_469, savingsPct: 68.7 },
  { id: "lead-plan", role: "lead", steps: 6, legacy: 37_499, v2: 13_449, savingsPct: 64.1 },
  { id: "designer-landing-hero", role: "designer", steps: 6, legacy: 33_248, v2: 11_139, savingsPct: 66.5 },
];

export const HEADLINE = {
  legacyBillable: 838_718,
  v2Billable: 297_473,
  savingsPct: 64.5,
  promptCutPct: 38.3,
  cachedSharePct: 85.1,
  legacyMaxPrompt: 18_912,
  v2MaxPrompt: 12_102,
  /** If legacy had been served with the same automatic caching (report, Limits). */
  savingsIfLegacyCachedPct: 36.4,
  scenarios: 8,
  roles: 7,
  steps: 92,
} as const;
