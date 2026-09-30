// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The brain as the benchmark pays for it, worst case: every cat carries a
// full 120-token role addendum and a full 120-token addendum of its own,
// every task pays the fast-tier critic (as if the evidence were always
// ambiguous), every fourth task takes one extra round, one tuning call lands
// for every three tasks, and the suite defines one dynamic role. The critic
// packet is the runs engine's own (EvidenceLog + reflexionPacket), built
// from the scenario's real steps; the role charter call is the engine's own
// prompt (ROLE_SYSTEM + rolePacket).
import type { AgentRole } from "@mengai/shared";
import type { StepRecord } from "../../core/services";
import { EvidenceLog, REFLEXION, REFLEXION_SYSTEM, ROLE_GEN, ROLE_SYSTEM, reflexionPacket, rolePacket } from "../runs";
import type { SuiteBrain } from "./replay";
import { STRATEGY, STRATEGY_SYSTEM, strategyPrompt } from "./strategy";
import type { ScenarioFixture } from "./suites";

/** revise rounds in the benchmark: one in this many tasks */
export const BRAIN_REVISE_EVERY = 4;
/** tuning calls: one per this many tasks (the trigger needs 3 new outcomes) */
export const BRAIN_TUNE_EVERY = 3;
/** dynamic roles defined per suite replay */
export const BRAIN_ROLES_PER_SUITE = 1;

const RULES = [
  "Before finish, reread the acceptance list and show each item in a file you changed or a check you ran, with its exit code.",
  "Run the project's own test or typecheck after the last edit; never finish on an unchecked change.",
  "When review notes repeat a gap such as missing alt text or error handling, fix every instance, not just the first.",
];

/** A full-size addendum: the three sample rules, cut to exactly the 120-token cap. */
export function sampleStrategy(): { version: number; text: string } {
  let text = RULES.map((r) => `- ${r}`).join("\n");
  while (text.length < STRATEGY.maxTokens * 4) text += ` ${RULES[text.length % RULES.length]}`;
  return { version: 1, text: text.slice(0, STRATEGY.maxTokens * 4) };
}

function criticPacket(s: ScenarioFixture, history: StepRecord[]): string {
  const log = new EvidenceLog();
  for (const step of history) log.record(step);
  const last = history[history.length - 1];
  return reflexionPacket({
    title: s.task?.title ?? s.goal,
    acceptance: s.task?.acceptance ?? [],
    summary: last?.assistant.text || "Finished the task.",
    evidence: log.snapshot(),
    check: 1,
  });
}

const LONG_CAUSE = (i: number) =>
  `Review round ${i + 1}: the hero image has no alt text, the page has no meta description, and the summary claims tests that were never run in the workspace.`;

/** The worst-case brain for the suite replay (ReplayOptions.brain). */
export function worstCaseBrain(): SuiteBrain {
  const strategy = sampleStrategy();
  const tune = {
    system: STRATEGY_SYSTEM,
    user: strategyPrompt({
      subject: "role",
      role: "engineer" as AgentRole,
      current: strategy.text,
      cases: Array.from({ length: 10 }, (_, i) => ({ outcome: i < 6 ? ("loss" as const) : ("win" as const), kind: "review_fail", cause: LONG_CAUSE(i) })),
    }),
    outputTokens: STRATEGY.outputTokens,
  };
  const role = {
    system: ROLE_SYSTEM,
    user: rolePacket({
      goal: "Build a one page landing site for a cafe: a tagline, menu highlights and visit details, reviewed and smoke checked before launch.",
      title: "Accessibility and launch tester",
      archetype: "qa",
      task: { title: "Audit the page before launch", spec: "Check the page like a first visitor: placeholders, alt text, focus states, broken links, then run the smoke check.".repeat(3) },
      tools: ["finish", "note", "recall", "record_lesson", "fs_list", "fs_read", "fs_search", "shell_run", "report_issue"],
    }),
    outputTokens: ROLE_GEN.outputTokens,
  };
  return {
    addendaFor: () => [
      { scope: "role", version: strategy.version, text: strategy.text },
      { scope: "agent", version: strategy.version, text: strategy.text },
    ],
    reflexion: { system: REFLEXION_SYSTEM, packet: criticPacket, outputTokens: REFLEXION.outputTokens, reviseEvery: BRAIN_REVISE_EVERY },
    sideCalls: (n) => [
      { ...tune, count: Math.ceil(n / BRAIN_TUNE_EVERY) },
      { ...role, count: BRAIN_ROLES_PER_SUITE },
    ],
  };
}
