// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The brain's pure rules: loop engineering (evidence, self-check, step
// budget), the runtime JEV decision plans and their runner, dynamic roles,
// the tracker stages and the org rules. No engine, no model.
import { describe, expect, test } from "bun:test";
import type { StrategyEvidenceDTO } from "@mengai/shared";
import type { JevAnswer, Judge } from "../../core/ports";
import type { StepRecord } from "../../core/services";
import { fakeClock, memoryKv, silentLogger } from "../../testing";
import { EvidenceLog, REFLEXION, STEPS, StepBudget, initialSteps, parseReflexion, precheck, reflexionPacket, shellStatus } from "./brain";
import { UNVERIFIED, createBrainJudge, planAdopt, planHire, planLetGo, planRole, readChoice, type BrainDecisionRow } from "./judge";
import { ORG, aRole, budgetLeftShare, canAffordHire, depthOf, hireReason, letGoReason } from "./org";
import { baseRoleOf, closestRole, fallbackCharter, parseRoleReply, roleCharterText, roleSlug, roleTitle, toolSubset } from "./roles";
import { withArticle } from "./policy";
import { stageFromBoard, stageMoves } from "./stage";
import { VOICE } from "./voice";

let n = 0;
function step(calls: Array<{ name: string; args?: unknown; output?: string; ok?: boolean }>, text = ""): StepRecord {
  const toolCalls = calls.map((c) => ({ id: `c${++n}`, name: c.name, arguments: JSON.stringify(c.args ?? {}) }));
  return { assistant: { text, toolCalls }, results: calls.map((c, i) => ({ callId: toolCalls[i]!.id, tool: c.name, output: c.output ?? "ok", ok: c.ok ?? true })) };
}

describe("loop engineering: evidence and the self-check", () => {
  test("the evidence log keeps files changed, checks with exit codes and unresolved errors", () => {
    const log = new EvidenceLog();
    log.record(step([{ name: "shell_run", args: { command: "bun test" }, output: "exit 1 in 0.4s\nfail", ok: false }]));
    log.record(step([{ name: "fs_write", args: { path: "src/a.ts" } }, { name: "fs_edit", args: { path: "src/b.ts" }, output: "no match", ok: false }]));
    log.record(step([{ name: "fs_read", args: { path: "src/a.ts" } }]));
    log.declare(["README.md", " "]);
    const ev = log.snapshot();
    expect(ev.files).toEqual(["src/a.ts", "README.md"]);
    expect(ev.changed).toBe(true);
    expect(ev.checks).toEqual([{ command: "bun test", status: "exit 1", exit: 1, ok: false, afterChange: false }]);
    expect(ev.openErrors).toEqual(["bun test: exit 1", "fs_edit src/b.ts: no match"]);
    log.record(step([{ name: "shell_run", args: { command: "bun test" }, output: "exit 0 in 0.2s" }, { name: "fs_edit", args: { path: "src/b.ts" } }]));
    const after = log.snapshot();
    expect(after.openErrors).toEqual([]);
    expect(after.checks.map((c) => [c.status, c.afterChange])).toEqual([
      ["exit 1", false],
      ["exit 0", false],
    ]);
    expect(shellStatus("timed out after 60s", false)).toEqual({ status: "timed out", exit: null });
    expect(shellStatus("killed by SIGKILL", false)).toEqual({ status: "killed by SIGKILL", exit: null });
  });

  test("rule verdicts on conclusive evidence, the critic on everything else", () => {
    const base = { files: ["a.ts"], openErrors: [], changed: true };
    expect(precheck({ ...base, checks: [{ command: "bun test", status: "exit 1", exit: 1, ok: false, afterChange: true }] })?.verdict).toBe("revise");
    expect(precheck({ ...base, checks: [{ command: "bun test", status: "exit 0", exit: 0, ok: true, afterChange: true }] })).toEqual({ verdict: "pass", critique: "1 check passed after the last change." });
    // a check that ran before the last change proves nothing about it
    expect(precheck({ ...base, checks: [{ command: "bun test", status: "exit 0", exit: 0, ok: true, afterChange: false }] })).toBeNull();
    expect(precheck({ ...base, checks: [] })).toBeNull();
    expect(precheck({ files: [], checks: [{ command: "bun test", status: "exit 0", exit: 0, ok: true, afterChange: true }], openErrors: ["x: failed"], changed: false })).toBeNull();
  });

  test("the critic packet is evidence first, then the claim, capped and redacted", () => {
    const secret = "sk-" + "b".repeat(40);
    const text = reflexionPacket({
      title: "Build the form",
      acceptance: ["Validates email", "Tests pass"],
      summary: `Done, tests pass. key ${secret}`,
      evidence: { files: ["src/form.ts"], checks: [{ command: "bun test", status: "exit 0", exit: 0, ok: true, afterChange: true }], openErrors: [], changed: true },
      check: 2,
    });
    expect(text.indexOf("Files changed")).toBeLessThan(text.indexOf("Its finish summary"));
    expect(text.indexOf("Checks run")).toBeLessThan(text.indexOf("Its finish summary"));
    expect(text).toContain("- bun test -> exit 0, after the last change");
    expect(text).toContain(`Self-check 2 of ${REFLEXION.maxExtraRounds + 1}.`);
    expect(text).not.toContain(secret);
    const huge = reflexionPacket({ title: "t", acceptance: [], summary: "x ".repeat(5000), evidence: { files: Array.from({ length: 40 }, (_, i) => `f${i}.ts`), checks: [], openErrors: [], changed: true }, check: 1 });
    expect(huge.length).toBeLessThanOrEqual(REFLEXION.packetChars);
    expect(REFLEXION.outputTokens).toBe(150);
    expect(REFLEXION.maxExtraRounds).toBe(2);
  });

  test("the critic reply parses to pass or revise; anything else is no verdict", () => {
    expect(parseReflexion('{"verdict":"revise","critique":"Run the tests."}')).toEqual({ verdict: "revise", critique: "Run the tests." });
    expect(parseReflexion('```json\n{"verdict":"PASS"}\n```')).toEqual({ verdict: "pass", critique: "" });
    expect(parseReflexion('{"verdict":"revise","critique":""}')).toBeNull();
    expect(parseReflexion('{"verdict":"maybe"}')).toBeNull();
    expect(parseReflexion("no json")).toBeNull();
  });

  test("the step budget is sized from the task, grows with progress to the hard cap, shrinks when the cat stalls", () => {
    expect(initialSteps("work", 0, 10)).toBe(STEPS.base);
    expect(initialSteps("work", 9, 800)).toBe(STEPS.base + STEPS.perAcceptance * STEPS.acceptanceCounted + 4);
    expect(initialSteps("plan", 0, 0)).toBe(STEPS.plan);
    expect(initialSteps("review", 3, 0)).toBe(STEPS.review);
    // progress every step: grows by 4 at each limit until the hard cap
    const grow = new StepBudget(8);
    let steps = 0;
    while (grow.allows()) grow.record(step([{ name: "fs_read", args: { path: `f${steps++}.ts` }, output: `content ${steps}` }]));
    expect(steps).toBe(STEPS.hardCap);
    expect(grow.reason()).toBe(`step limit reached (${STEPS.hardCap} steps)`);
    // failed or repeated steps are no progress: two in a row cap the budget a few steps out
    const stall = new StepBudget(8);
    let used = 0;
    while (stall.allows()) {
      stall.record(step([{ name: "fs_read", args: { path: `missing${used++}.ts` }, output: "not found", ok: false }]));
    }
    expect(used).toBe(2 + STEPS.slack);
    expect(stall.reason()).toBe(`step budget reached (${2 + STEPS.slack} steps without enough progress)`);
    // a repeat with the same output is no progress either; a new output is
    const repeat = new StepBudget(8);
    expect(repeat.record(step([{ name: "shell_run", args: { command: "bun test" }, output: "exit 1" }]))).toBe(true);
    expect(repeat.record(step([{ name: "shell_run", args: { command: "bun test" }, output: "exit 1" }]))).toBe(false);
    expect(repeat.record(step([{ name: "shell_run", args: { command: "bun test" }, output: "exit 0" }]))).toBe(true);
    // a reflexion round extends it, never past the hard cap
    const round = new StepBudget(6);
    for (let i = 0; i < 5; i++) round.record(step([{ name: "fs_read", args: { path: `r${i}` }, output: `r${i}` }]));
    round.extend(REFLEXION.roundSteps);
    expect(round.limit).toBe(5 + REFLEXION.roundSteps);
    const capped = new StepBudget(STEPS.hardCap);
    for (let i = 0; i < STEPS.hardCap - 1; i++) capped.record(step([{ name: "fs_read", args: { path: `c${i}` }, output: `c${i}` }]));
    capped.extend(REFLEXION.roundSteps);
    expect(capped.limit).toBe(STEPS.hardCap);
  });
});

// ----------------------------------------------------------- JEV plans
const evidence = (over: Partial<StrategyEvidenceDTO> = {}): StrategyEvidenceDTO => ({
  scores: { current: 0.1, candidate: 0.6 },
  addressed: { current: 0, candidate: 2, losses: 3 },
  billableInputTokens: { current: 1000, candidate: 1100, legacy: 9000 },
  tokens: { current: 0, candidate: 40 },
  ...over,
});
const ch = (c: string, confidence = 0.9, probabilities: Record<string, number> = { [c]: confidence }): JevAnswer => ({ type: "choice", choice: c, confidence, probabilities });

const adoptInput = (over: Partial<Parameters<typeof planAdopt>[0]> = {}) => ({
  runId: "r1",
  agentId: null,
  subject: "role" as const,
  subjectKey: "engineer",
  role: "engineer" as const,
  title: "Engineer",
  current: null,
  candidate: "- Run the tests after the last edit.",
  merged: null,
  evidence: evidence(),
  causes: ["review fail: no tests"],
  ruleAdopt: true,
  capTokens: 120,
  ...over,
});

describe("runtime JEV plans", () => {
  test("prompt.adopt: hard prechecks keep without asking; merge is offered only with a current strategy", () => {
    expect(planAdopt(adoptInput({ evidence: evidence({ tokens: { current: 0, candidate: 130 } }) })).precheck).toMatchObject({ rule: "over_token_cap", result: "keep" });
    expect(planAdopt(adoptInput({ evidence: evidence({ billableInputTokens: { current: 1, candidate: 9000, legacy: 9000 } }) })).precheck).toMatchObject({ rule: "over_legacy", result: "keep" });
    expect(planAdopt(adoptInput({ current: { version: 1, text: "- Run the tests after the last edit." } })).precheck).toMatchObject({ rule: "same_text" });
    const fresh = planAdopt(adoptInput());
    expect(fresh.precheck).toBeNull();
    expect(Object.keys((fresh.questions.adopt as { criteria: Record<string, string> }).criteria)).toEqual(["adopt", "keep"]);
    const both = planAdopt(adoptInput({ current: { version: 2, text: "- Old rule." }, merged: "- Run the tests.\n- Old rule." }));
    expect(Object.keys((both.questions.adopt as { criteria: Record<string, string> }).criteria)).toEqual(["adopt", "keep", "merge"]);
    expect(both.interpret({ adopt: ch("merge") })).toMatchObject({ result: "merge", action: "merge strategy v3 for the Engineer role" });
    // an answer outside the options does not fit the questions
    expect(fresh.interpret({ adopt: ch("merge") })).toBeNull();
    // low confidence with keep as the runner-up keeps
    expect(fresh.interpret({ adopt: ch("adopt", 0.45, { adopt: 0.45, keep: 0.4 }) })?.result).toBe("keep");
    expect(fresh.interpret({ adopt: ch("adopt", 0.8) })?.result).toBe("adopt");
    expect(fresh.fallback().result).toBe("adopt");
    expect(planAdopt(adoptInput({ ruleAdopt: false })).fallback().result).toBe("keep");
    expect(JSON.stringify(fresh.state)).toContain("recent_failures");
  });

  test("orch.role: a known key is reused without asking, the cap holds, the archetype comes from JEV", () => {
    const input = {
      runId: "r1",
      agentId: "a1",
      goal: "Ship a page",
      title: "Launch tester",
      key: "launch-tester",
      requested: "qa" as const,
      task: { title: "Smoke check", spec: "Test it" },
      existing: [] as Array<{ key: string; title: string; archetype: "qa" }>,
      archetypes: ["engineer", "qa", "reviewer"] as const,
      created: 0,
      cap: 6,
    };
    const plan = planRole({ ...input, archetypes: [...input.archetypes] });
    expect(plan.precheck).toBeNull();
    expect(plan.interpret({ need: ch("new_role"), archetype: ch("reviewer") })?.result).toEqual({ need: "new_role", archetype: "reviewer", reuse: null });
    // low confidence on the archetype with the requested one as runner-up: the requested one
    expect(plan.interpret({ need: ch("new_role"), archetype: ch("reviewer", 0.4, { reviewer: 0.4, qa: 0.35 }) })?.result.archetype).toBe("qa");
    expect(plan.interpret({ need: ch("new_role") })).toBeNull();
    expect(plan.fallback().result).toEqual({ need: "new_role", archetype: "qa", reuse: null });
    const known = planRole({ ...input, archetypes: [...input.archetypes], existing: [{ key: "launch-tester", title: "Launch tester", archetype: "qa" }] });
    expect(known.precheck).toMatchObject({ rule: "known_role", result: { need: "existing", reuse: "launch-tester" } });
    expect(planRole({ ...input, archetypes: [...input.archetypes], created: 6 }).precheck).toMatchObject({ rule: "role_cap" });
  });

  test("orch.hire: caps and budget are hard rules; handoffs choose hire or self, queues hire or wait", () => {
    const input = {
      runId: "r1",
      kind: "handoff" as const,
      asker: { id: "a1", name: "Belang", title: "Designer" },
      roleKey: "researcher",
      role: "researcher" as const,
      title: "Researcher",
      task: { title: "Collect references", spec: "..." },
      pool: 0,
      waiting: 0,
      crew: 3,
      maxAgents: 0,
      depth: 2,
      maxDepth: 0,
      affordable: true,
      budgetLeftShare: 0.8,
    };
    const hand = planHire(input);
    expect(hand.precheck).toBeNull();
    expect(Object.keys((hand.questions.hire as { criteria: Record<string, string> }).criteria)).toEqual(["hire", "self"]);
    expect(hand.interpret({ hire: ch("self") })).toMatchObject({ result: "self", action: "Belang does it itself" });
    expect(hand.interpret({ hire: ch("wait") })).toBeNull();
    expect(hand.fallback().result).toBe("hire");
    expect(planHire({ ...input, maxAgents: 3 }).precheck).toMatchObject({ rule: "at_max_agents", result: "self" });
    expect(planHire({ ...input, maxDepth: 1 }).precheck).toMatchObject({ rule: "at_max_depth", result: "self" });
    const queue = planHire({ ...input, kind: "queue", pool: 1, waiting: 2, affordable: false });
    expect(queue.precheck).toMatchObject({ rule: "budget", result: "wait" });
    expect(Object.keys((planHire({ ...input, kind: "queue" }).questions.hire as { criteria: Record<string, string> }).criteria)).toEqual(["hire", "wait"]);
    expect(planHire(input).interpret({ hire: ch("hire") })?.action).toBe("hire a researcher");
  });

  test("orch.let_go: the CEO stays, departures are capped, a weak let_go softens, coaching comes first in the fallback", () => {
    const input = {
      runId: "r1",
      agent: { id: "a1", name: "Cemong", title: "Security", role: "security" as const },
      consecutive: 3,
      failures: ["blocked: no lockfile"],
      done: 0,
      coached: false,
      departures: 0,
      maxDepartures: ORG.maxDepartures,
      canReplace: true,
    };
    const plan = planLetGo(input);
    expect(plan.precheck).toBeNull();
    expect(plan.interpret({ decision: ch("let_go") })).toMatchObject({ result: "let_go", action: "let Cemong go" });
    expect(plan.interpret({ decision: ch("let_go", 0.3) })?.result).toBe("coach");
    expect(plan.fallback().result).toBe("coach");
    expect(planLetGo({ ...input, coached: true }).fallback().result).toBe("let_go");
    expect(Object.keys((planLetGo({ ...input, coached: true }).questions.decision as { criteria: Record<string, string> }).criteria)).toEqual(["let_go", "keep"]);
    expect(planLetGo({ ...input, agent: { ...input.agent, role: "lead" } }).precheck).toMatchObject({ rule: "ceo", result: "keep" });
    expect(planLetGo({ ...input, departures: ORG.maxDepartures }).precheck).toMatchObject({ rule: "departure_cap", result: "keep" });
    expect(readChoice(ch("let_go"), ["keep"] as const)).toBeNull();
  });

  test("the runner: verified answers are cached and persisted; an outage falls back stamped; prechecks never call JEV", async () => {
    const clock = fakeClock();
    const saved: BrainDecisionRow[] = [];
    const published: string[] = [];
    let calls = 0;
    let up = true;
    const judge: Judge = {
      configured: async () => true,
      async decide() {
        calls++;
        return up ? { verified: true, model: "jev", answers: { adopt: ch("keep") }, latencyMs: 5 } : { verified: false, stamp: "UNVERIFIED BY JEV", error: "down", latencyMs: 1 };
      },
    };
    const runner = createBrainJudge({ judge, kv: memoryKv(), clock, log: silentLogger, save: async (r) => void saved.push(r), publish: async (d) => void published.push(d.decisionId) });
    const a = await runner.run(planAdopt(adoptInput()));
    expect(a.result).toBe("keep");
    expect(a.decision).toMatchObject({ decisionId: "prompt.adopt", verified: true, stamp: null, confidence: 0.9 });
    // the same state again: the cache answers, JEV is not called twice
    await runner.run(planAdopt(adoptInput()));
    expect(calls).toBe(1);
    up = false;
    const b = await runner.run(planAdopt(adoptInput({ subjectKey: "qa", title: "QA", role: "qa" })));
    expect(b.result).toBe("adopt");
    expect(b.decision).toMatchObject({ verified: false, stamp: UNVERIFIED });
    expect(b.decision.answers.error).toBe("down");
    const c = await runner.run(planAdopt(adoptInput({ evidence: evidence({ tokens: { current: 0, candidate: 500 } }) })));
    expect(c.decision).toMatchObject({ verified: false, stamp: null, confidence: null });
    expect(c.decision.answers.precheck).toBe("over_token_cap");
    expect(calls).toBe(2);
    expect(saved.map((r) => [r.decisionId, r.domain, r.subject])).toEqual([
      ["prompt.adopt", "prompt", "engineer"],
      ["prompt.adopt", "prompt", "engineer"],
      ["prompt.adopt", "prompt", "qa"],
      ["prompt.adopt", "prompt", "engineer"],
    ]);
    expect(published).toHaveLength(4);
    // no judge at all: every decision takes its fallback, stamped
    const none = createBrainJudge({ judge: null, kv: memoryKv(), clock, log: silentLogger, save: async () => {}, publish: async () => {} });
    expect((await none.run(planAdopt(adoptInput()))).decision.stamp).toBe(UNVERIFIED);
  });
});

describe("dynamic roles", () => {
  test("titles, keys and base role names", () => {
    expect(roleTitle("  launch   tester!! ")).toBe("Launch tester");
    expect(roleTitle("x")).toBeNull();
    expect(roleSlug("Launch Tester")).toBe("launch-tester");
    expect(roleSlug("QA")).toBeNull();
    expect(roleSlug("Engineers")).toBeNull();
    expect(baseRoleOf("Security")).toBe("security");
    expect(baseRoleOf("Accessibility auditor")).toBeNull();
  });

  test("the charter call's reply becomes a capped charter and a tool subset of the archetype", () => {
    expect(parseRoleReply('{"charter":["Test like a first visitor.","Name each check."],"tools":["shell_run","fs_write"]}')).toEqual({
      lines: ["Test like a first visitor.", "Name each check."],
      tools: ["shell_run", "fs_write"],
    });
    expect(parseRoleReply('{"charter":[]}')).toBeNull();
    expect(parseRoleReply("nope")).toBeNull();
    // generate_image is not a qa tool in the registry: dropped; finish and note always stay
    expect(toolSubset("qa", ["shell_run", "generate_image", "fs_read", "fs_search"])).toEqual(["finish", "note", "fs_read", "fs_search", "shell_run"]);
    expect(toolSubset("qa", ["finish"])).toContain("report_issue");
    const charter = roleCharterText("Launch tester", "qa", ["Test the page like a first visitor.", "x".repeat(2000), ...Array.from({ length: 10 }, (_, i) => `Line number ${i} of the charter`)]);
    expect(charter.startsWith("You are the Launch tester cat on a MengAI crew, a QA specialist.")).toBe(true);
    expect(charter.length).toBeLessThanOrEqual(1100);
    expect(fallbackCharter("Launch tester", "qa", { title: "Smoke check" })).toContain("Prove every result");
    const roles = [{ id: "1", projectId: "p", runId: null, key: "launch-tester", title: "Launch tester", archetype: "qa" as const, charter: "", charterVersion: 1, tools: [], reason: "", createdBy: null, createdAt: 0 }];
    expect(closestRole("Launch testers", "qa", roles)?.key).toBe("launch-tester");
    expect(closestRole("Launch tester", "engineer", roles)).toBeNull();
  });
});

describe("the tracker and the org", () => {
  test("stages move forward only, and back to working after a failed review", () => {
    expect(stageMoves(null, "goal")).toBe(true);
    expect(stageMoves("goal", "planned")).toBe(true);
    expect(stageMoves("review", "working")).toBe(false);
    expect(stageMoves("review", "working", true)).toBe(true);
    expect(stageMoves("testing", "working", true)).toBe(true);
    expect(stageMoves("working", "working", true)).toBe(false);
    expect(stageMoves("testing", "review")).toBe(false);
    expect(stageMoves("shipped", "working", true)).toBe(false);
    const t = (role: "lead" | "engineer" | "qa", status: "queued" | "running" | "done" | "review", kind = "work") => ({ role, status, kind });
    expect(stageFromBoard([], "running", 1)).toBe("goal");
    expect(stageFromBoard([t("lead", "running", "plan"), t("engineer", "queued")], "running", 1)).toBe("planned");
    expect(stageFromBoard([t("engineer", "queued")], "running", 3)).toBe("hired");
    expect(stageFromBoard([t("engineer", "running")], "running", 3)).toBe("working");
    expect(stageFromBoard([t("engineer", "review")], "running", 3)).toBe("review");
    expect(stageFromBoard([t("engineer", "done"), t("qa", "running")], "running", 3)).toBe("testing");
    expect(stageFromBoard([t("engineer", "done")], "done", 3)).toBe("shipped");
  });

  test("budget-aware hiring, org depth, reasons with the right article", () => {
    expect(canAffordHire({ budgetTokens: 0, usedTokens: 10_000_000, budgetUsd: 0, usedUsd: 99 }, 50)).toBe(true);
    expect(canAffordHire({ budgetTokens: 100_000, usedTokens: 60_000, budgetUsd: 0, usedUsd: 0 }, 1)).toBe(false);
    expect(canAffordHire({ budgetTokens: 0, usedTokens: 0, budgetUsd: 10, usedUsd: 7 }, 1)).toBe(false);
    expect(budgetLeftShare({ budgetTokens: 0, usedTokens: 5, budgetUsd: 0, usedUsd: 0 })).toBeNull();
    expect(budgetLeftShare({ budgetTokens: 100, usedTokens: 25, budgetUsd: 0, usedUsd: 0 })).toBe(0.75);
    const parents = new Map<string, string | null>([
      ["ceo", null],
      ["eng", "ceo"],
      ["helper", "eng"],
    ]);
    expect(depthOf("helper", (id) => parents.get(id))).toBe(2);
    expect(depthOf("ceo", (id) => parents.get(id))).toBe(0);
    expect([aRole("Engineer"), aRole("QA"), aRole("Security"), aRole("Launch tester"), aRole("Operator")]).toEqual(["an engineer", "a QA cat", "a security cat", "a launch tester", "an operator"]);
    expect(hireReason("queue", "Engineer", { waiting: 2 })).toBe("2 engineer tasks are waiting and every engineer is busy");
    expect(hireReason("helper", "Engineer", { by: "Belang", task: "Split the parser" })).toBe("Belang hired an engineer as a helper: Split the parser");
    expect(hireReason("replacement", "Security", { replaces: "Cemong" })).toBe("Replaces Cemong");
    expect(letGoReason(3, "blocked on X")).toBe("Let go after 3 failures in a row. Last: blocked on X");
    expect(ORG.askAfter).toBe(3);
    // every hire reason and hiring line reads with the right article
    expect(hireReason("needed", "Engineer", { task: "Build it" })).toBe("The plan needs an engineer: Build it");
    expect(hireReason("handoff", "Reviewer", { by: "Kopi" })).toBe("Kopi needs a reviewer");
    expect(hireReason("needed", "Operator")).toBe("The plan needs an operator");
    expect([withArticle("engineer"), withArticle("reviewer"), withArticle("UX researcher"), withArticle("SRE"), withArticle("user tester"), withArticle("hour")]).toEqual([
      "an engineer",
      "a reviewer",
      "a UX researcher",
      "an SRE",
      "a user tester",
      "an hour",
    ]);
    expect([VOICE.hiring("engineer"), VOICE.definingRole("Analyst")]).toEqual(["Hiring an engineer", "Writing a charter for an Analyst"]);
  });
});
