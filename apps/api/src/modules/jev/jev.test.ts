import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { ModuleContext } from "../../core/module";
import type { JevAnswer, JevQuestion, Judge, JudgeResult } from "../../core/ports/judge";
import { HttpError, errorBody } from "../../lib/http";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { createJevModule, UNVERIFIED_STAMP } from "./index";

type Reply = Record<string, JevAnswer> | "unverified" | "throw";

interface FakeJudge extends Judge {
  calls: Array<{ decisionId: string; state: Record<string, unknown>; questions: Record<string, JevQuestion> }>;
  replies: Reply[];
}

function fakeJudge(...replies: Reply[]): FakeJudge {
  const j: FakeJudge = {
    calls: [],
    replies,
    async configured() {
      return true;
    },
    async decide(req): Promise<JudgeResult> {
      j.calls.push({ decisionId: req.decisionId, state: req.state, questions: req.questions });
      const r = j.replies.length > 1 ? j.replies.shift()! : j.replies[0];
      if (r === undefined || r === "unverified") return { verified: false, stamp: "UNVERIFIED BY JEV", error: "no JEV key", latencyMs: 3 };
      if (r === "throw") throw new Error("socket closed");
      return { verified: true, model: "jev-test", answers: r, latencyMs: 42 };
    },
  };
  return j;
}

const choice = (c: string, confidence: number, probabilities: Record<string, number>): JevAnswer => ({ type: "choice", choice: c, confidence, probabilities });
const noul = (p: number): JevAnswer => ({ type: "noul", noul: p });

async function setup(judge: Judge) {
  const clock = fakeClock();
  const db = await createTestDb();
  const events = captureEvents(clock);
  const ctx: ModuleContext = {
    config: { mode: "local", version: "test", dataDir: "/tmp/x", workspacesDir: "/tmp/x", webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null },
    db,
    kv: memoryKv(),
    blob: { put: async () => ({ key: "", size: 0 }), get: async () => null, delete: async () => {}, exists: async () => false },
    vault: memoryVault(),
    clock,
    logger: silentLogger,
    events,
  };
  const mod = createJevModule(ctx, { judge });
  return { ctx, clock, db, events, mod, svc: mod.service };
}

const task = { title: "Add a discount endpoint", spec: "Implement POST /cart/discount in the api module and fix the rounding bug." };

describe("orch.route", () => {
  test("verified answer dispatches to the owner, persisted and published", async () => {
    const judge = fakeJudge({ owner: choice("engineer", 0.82, { engineer: 0.82, qa: 0.1, reviewer: 0.08 }), split: noul(0.9) });
    const { svc, events } = await setup(judge);
    const r = await svc.route({ runId: "run-1", goal: "shop api", task, candidates: ["engineer", "qa", "reviewer"] });
    expect(r.role).toBe("engineer");
    expect(r.split).toBe(false);
    expect(r.decision.verified).toBe(true);
    expect(r.decision.stamp).toBeNull();
    expect(r.decision.confidence).toBe(0.82);
    expect(r.decision.decisionId).toBe("orch.route");
    expect(r.decision.action).toBe("dispatch to engineer");
    expect(r.decision.latencyMs).toBe(42);
    const owner = judge.calls[0]!.questions.owner as { type: string; criteria: Record<string, string> };
    expect(owner.type).toBe("choice");
    expect(Object.keys(owner.criteria)).toEqual(["engineer", "qa", "reviewer"]);
    const listed = await svc.list("run-1");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(r.decision);
    const ev = events.ofType("decision");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.runId).toBe("run-1");
    expect(ev[0]!.data.decision.id).toBe(r.decision.id);
  });

  test("low confidence keeps the primary owner and adds the runner-up as consultant", async () => {
    const judge = fakeJudge({ owner: choice("engineer", 0.41, { engineer: 0.41, reviewer: 0.35, qa: 0.24 }), split: noul(0.8) });
    const { svc } = await setup(judge);
    const r = await svc.route({ runId: "run-1", goal: "g", task, candidates: ["engineer", "qa", "reviewer"] });
    expect(r.role).toBe("engineer");
    expect(r.decision.answers.consultant).toBe("reviewer");
    expect(r.decision.action).toBe("dispatch to engineer, reviewer consults");
  });

  test("split under 0.5 means split before dispatch", async () => {
    const judge = fakeJudge({ owner: choice("engineer", 0.7, { engineer: 0.7, designer: 0.3 }), split: noul(0.2) });
    const { svc } = await setup(judge);
    const r = await svc.route({ runId: "run-1", goal: "g", task, candidates: ["engineer", "designer"] });
    expect(r.split).toBe(true);
    expect(r.decision.action).toBe("split before dispatch (owner engineer)");
  });

  test("precheck: a single candidate is decided in code, JEV is not asked", async () => {
    const judge = fakeJudge({});
    const { svc } = await setup(judge);
    const r = await svc.route({ runId: "run-1", goal: "g", task, candidates: ["qa", "qa"] });
    expect(judge.calls).toHaveLength(0);
    expect(r.role).toBe("qa");
    expect(r.decision.verified).toBe(false);
    expect(r.decision.stamp).toBeNull();
    expect(r.decision.answers.precheck).toBe("single_candidate");
    expect(r.decision.action.startsWith("precheck:")).toBe(true);
  });

  test("unverified: keyword fallback stamped UNVERIFIED BY JEV", async () => {
    const judge = fakeJudge("unverified");
    const { svc } = await setup(judge);
    const r = await svc.route({
      runId: "run-1",
      goal: "g",
      task: { title: "Write e2e tests for checkout", spec: "Add regression tests and verify coverage of the acceptance criteria." },
      candidates: ["engineer", "qa", "designer"],
    });
    expect(r.role).toBe("qa");
    expect(r.split).toBe(false);
    expect(r.decision.verified).toBe(false);
    expect(r.decision.stamp).toBe(UNVERIFIED_STAMP);
    expect(r.decision.confidence).toBeNull();
    expect(String(r.decision.answers.fallback)).toContain("qa");
    expect(r.decision.answers.error).toBe("no JEV key");
  });

  test("answers outside the offered options are treated as unverified", async () => {
    const judge = fakeJudge({ owner: choice("operator", 0.9, { operator: 0.9 }), split: noul(0.9) });
    const { svc } = await setup(judge);
    const r = await svc.route({ runId: "run-1", goal: "g", task, candidates: ["engineer", "qa"] });
    expect(r.role).toBe("engineer");
    expect(r.decision.stamp).toBe(UNVERIFIED_STAMP);
    expect(r.decision.answers.error).toBe("JEV answers did not match the questions");
  });

  test("a throwing transport falls back instead of failing the run", async () => {
    const judge = fakeJudge("throw");
    const { svc } = await setup(judge);
    const r = await svc.route({ runId: "run-1", goal: "g", task, candidates: ["engineer", "qa"] });
    expect(r.decision.stamp).toBe(UNVERIFIED_STAMP);
    expect(r.decision.answers.error).toBe("socket closed");
  });
});

describe("orch.model", () => {
  const base = {
    runId: "run-1",
    role: "engineer" as const,
    task: { title: "Rename a helper", spec: "Rename formatPrice to formatMoney.", acceptance: ["tests pass"] },
    signals: { priorFailures: 0, risk: false, files: 1 },
    available: ["fast", "balanced", "deep"] as Array<"fast" | "balanced" | "deep">,
  };

  test("verified tier is used", async () => {
    const judge = fakeJudge({ tier: choice("fast", 0.9, { fast: 0.9, balanced: 0.1 }) });
    const { svc } = await setup(judge);
    const r = await svc.modelTier(base);
    expect(r.tier).toBe("fast");
    expect(r.decision.action).toBe("use fast tier");
  });

  test("low confidence takes the higher tier of primary and runner-up", async () => {
    const judge = fakeJudge({ tier: choice("fast", 0.45, { fast: 0.45, balanced: 0.4, deep: 0.15 }) });
    const { svc } = await setup(judge);
    const r = await svc.modelTier(base);
    expect(r.tier).toBe("balanced");
    expect((r.decision.answers.tier as { applied: string }).applied).toBe("balanced");
  });

  test("history goes into the state", async () => {
    const judge = fakeJudge({ tier: choice("balanced", 0.8, { balanced: 0.8, fast: 0.2 }) });
    const { svc } = await setup(judge);
    await svc.modelTier({ ...base, signals: { ...base.signals, history: { fast: { uses: 10, wins: 3 } } } });
    const ev = judge.calls[0]!.state.evidence as { history: Record<string, { winRate: number }> };
    expect(ev.history.fast!.winRate).toBe(0.3);
  });

  test("precheck: only one tier available", async () => {
    const judge = fakeJudge({});
    const { svc } = await setup(judge);
    const r = await svc.modelTier({ ...base, available: ["balanced"] });
    expect(judge.calls).toHaveLength(0);
    expect(r.tier).toBe("balanced");
    expect(r.decision.answers.precheck).toBe("single_tier");
  });

  test("unverified fallback scores complexity, bumps on poor history, clamps to available", async () => {
    const { svc } = await setup(fakeJudge("unverified"));
    const simple = await svc.modelTier(base);
    expect(simple.tier).toBe("fast");
    const poorHistory = await svc.modelTier({ ...base, signals: { ...base.signals, history: { fast: { uses: 6, wins: 1 } } } });
    expect(poorHistory.tier).toBe("balanced");
    const hard = await svc.modelTier({
      ...base,
      task: { title: "Redesign the auth architecture", spec: "Cross-module security refactor.", acceptance: ["a", "b", "c", "d", "e"] },
      signals: { priorFailures: 1, risk: true, files: 8 },
      available: ["fast", "balanced"],
    });
    expect(hard.tier).toBe("balanced");
    expect(hard.decision.stamp).toBe(UNVERIFIED_STAMP);
    expect(String(hard.decision.answers.fallback)).toContain("deep not available");
  });
});

describe("orch.loop_exit", () => {
  const green = { runId: "run-1", goal: "discount endpoint", round: 1, gates: [{ name: "bun test", ok: true }], open: [], recurring: 0 };

  test("exit_done with meets_ask >= 0.7 exits", async () => {
    const judge = fakeJudge({ next: choice("exit_done", 0.9, { exit_done: 0.9, another_round: 0.1 }), meets_ask: noul(0.85) });
    const { svc } = await setup(judge);
    const r = await svc.loopExit(green);
    expect(r.next).toBe("exit_done");
    expect(r.meetsAsk).toBe(0.85);
    expect(r.decision.action).toBe("exit the review loop");
  });

  test("exit_done below the meets_ask threshold runs another round", async () => {
    const judge = fakeJudge({ next: choice("exit_done", 0.9, { exit_done: 0.9 }), meets_ask: noul(0.6) });
    const { svc } = await setup(judge);
    expect((await svc.loopExit(green)).next).toBe("another_round");
  });

  test("low-confidence exit_done takes the runner-up", async () => {
    const judge = fakeJudge({ next: choice("exit_done", 0.4, { exit_done: 0.4, change_approach: 0.35, another_round: 0.25 }), meets_ask: noul(0.9) });
    const { svc } = await setup(judge);
    expect((await svc.loopExit(green)).next).toBe("change_approach");
  });

  test("precheck: a failing gate removes exit_done from the options", async () => {
    const judge = fakeJudge({ next: choice("another_round", 0.8, { another_round: 0.8 }), meets_ask: noul(0.4) });
    const { svc } = await setup(judge);
    const r = await svc.loopExit({ ...green, gates: [{ name: "bun test", ok: false }] });
    expect(r.next).toBe("another_round");
    const criteria = (judge.calls[0]!.questions.next as { criteria: Record<string, string> }).criteria;
    expect(Object.keys(criteria)).toEqual(["another_round", "change_approach", "escalate"]);
  });

  test("precheck: still blocked at the round cap escalates without JEV", async () => {
    const judge = fakeJudge({});
    const { svc } = await setup(judge);
    const r = await svc.loopExit({ ...green, round: 3, open: [{ severity: "high", title: "SQL injection in search" }] });
    expect(judge.calls).toHaveLength(0);
    expect(r.next).toBe("escalate");
    expect(r.decision.answers.precheck).toBe("max_rounds_blocked");
  });

  test("unverified fallback: recurring blockers change approach, green exits", async () => {
    const { svc } = await setup(fakeJudge("unverified"));
    const stuck = await svc.loopExit({ ...green, gates: [{ name: "bun test", ok: false }], recurring: 2 });
    expect(stuck.next).toBe("change_approach");
    expect(stuck.decision.stamp).toBe(UNVERIFIED_STAMP);
    const done = await svc.loopExit({ ...green, open: [{ severity: "low", title: "naming nit" }] });
    expect(done.next).toBe("exit_done");
    expect(done.meetsAsk).toBe(1);
  });
});

describe("orch.escalate", () => {
  test("precheck: destructive work always goes to the owner", async () => {
    const judge = fakeJudge({});
    const { svc } = await setup(judge);
    const r = await svc.escalate({ runId: "run-1", proposal: "Drop table orders and recreate it", impact: "local dev db", reversibleHint: true });
    expect(judge.calls).toHaveLength(0);
    expect(r.decider).toBe("human");
    expect(r.reversible).toBe(0);
    expect(r.decision.answers.precheck).toBe("destructive_data_or_history");
  });

  test("precheck: spending money always goes to the owner", async () => {
    for (const proposal of ["Buy a domain for the landing page", "Pay for the Vercel Pro plan", "Make a payment to the vendor", "Subscribe to a paid API plan", "Raise the budget to $50"]) {
      const judge = fakeJudge({});
      const { svc } = await setup(judge);
      const r = await svc.escalate({ runId: "run-1", proposal, impact: "one module", reversibleHint: true });
      expect(judge.calls).toHaveLength(0);
      expect(r.decider).toBe("human");
      expect(r.decision.answers.precheck).toBe("money");
    }
  });

  test("payment nouns without a spending action go to JEV", async () => {
    for (const proposal of ["Fix the payment form validation", "Render the invoice PDF layout", "Wire the SSE subscription for run events", "Tweak the billing page copy"]) {
      const judge = fakeJudge({ decider: choice("crew", 0.8, { crew: 0.8, lead: 0.2 }), reversible: noul(0.9) });
      const { svc } = await setup(judge);
      const r = await svc.escalate({ runId: "run-1", proposal, impact: "one module", reversibleHint: true });
      expect(judge.calls).toHaveLength(1);
      expect(r.decider).toBe("crew");
      expect(r.decision.verified).toBe(true);
      expect(r.decision.answers.precheck).toBeUndefined();
    }
  });

  test("crew with low reversibility is raised to lead", async () => {
    const judge = fakeJudge({ decider: choice("crew", 0.8, { crew: 0.8, lead: 0.2 }), reversible: noul(0.2) });
    const { svc } = await setup(judge);
    const r = await svc.escalate({ runId: "run-1", proposal: "Switch the date library helper", impact: "one module", reversibleHint: true });
    expect(r.decider).toBe("lead");
    expect(r.decision.action).toBe("lead decides");
  });

  test("low confidence takes the higher authority", async () => {
    const judge = fakeJudge({ decider: choice("crew", 0.42, { crew: 0.42, human: 0.4, lead: 0.18 }), reversible: noul(0.9) });
    const { svc } = await setup(judge);
    const r = await svc.escalate({ runId: "run-1", proposal: "Rename the settings page", impact: "ui", reversibleHint: true });
    expect(r.decider).toBe("human");
  });

  test("unverified fallback uses the reversible hint", async () => {
    const { svc } = await setup(fakeJudge("unverified"));
    const r = await svc.escalate({ runId: "run-1", proposal: "Split the helper file", impact: "one module", reversibleHint: true });
    expect(r.decider).toBe("crew");
    expect(r.reversible).toBe(0.7);
    const r2 = await svc.escalate({ runId: "run-1", proposal: "Change the export format", impact: "affects the timeline", reversibleHint: true });
    expect(r2.decider).toBe("human");
  });
});

describe("mem.promote", () => {
  const lesson = "Run bun test with --bail when a suite has more than 200 tests to keep feedback fast.";

  test("precheck: secrets and duplicates are discarded without JEV", async () => {
    const judge = fakeJudge({});
    const { svc } = await setup(judge);
    const secret = await svc.promoteLesson({ lesson: "Use api_key=abcd1234efgh5678 for the staging provider calls", context: "shop", existing: [], projects: 3 });
    expect(secret.scope).toBe("discard");
    expect(secret.decision.answers.precheck).toBe("contains_secret");
    const dup = await svc.promoteLesson({ lesson, context: "shop", existing: [lesson.toUpperCase()], projects: 3 });
    expect(dup.decision.answers.precheck).toBe("duplicate");
    expect(judge.calls).toHaveLength(0);
    expect(secret.decision.runId).toBeNull();
  });

  test("global needs evidence from two projects", async () => {
    const judge = fakeJudge({ scope: choice("global", 0.9, { global: 0.9, project: 0.1 }), durable: noul(0.8) });
    const { svc } = await setup(judge);
    expect((await svc.promoteLesson({ lesson, context: "shop", existing: [], projects: 1 })).scope).toBe("project");
    expect((await svc.promoteLesson({ lesson: `${lesson} Always.`, context: "shop", existing: [], projects: 2 })).scope).toBe("global");
  });

  test("durable under 0.5 discards; low confidence narrows global to project", async () => {
    const judge = fakeJudge(
      { scope: choice("project", 0.9, { project: 0.9 }), durable: noul(0.3) },
      { scope: choice("global", 0.45, { global: 0.45, discard: 0.3, project: 0.25 }), durable: noul(0.9) },
    );
    const { svc } = await setup(judge);
    expect((await svc.promoteLesson({ lesson, context: "shop", existing: [], projects: 4 })).scope).toBe("discard");
    const low = await svc.promoteLesson({ lesson: `${lesson} Also for CI.`, context: "shop", existing: [], projects: 4 });
    expect(low.scope).toBe("project");
  });

  test("unverified fallback", async () => {
    const { svc } = await setup(fakeJudge("unverified"));
    const temp = await svc.promoteLesson({ lesson: "For now skip the flaky payment test in CI until the vendor fixes it", context: "shop", existing: [], projects: 3 });
    expect(temp.scope).toBe("discard");
    const specific = await svc.promoteLesson({ lesson: "Edit src/cart/discount.ts through the pricing helper, never inline", context: "shop", existing: [], projects: 3 });
    expect(specific.scope).toBe("project");
    expect(specific.decision.stamp).toBe(UNVERIFIED_STAMP);
  });
});

describe("sec.severity", () => {
  const finding = { kind: "config" as const, rule: "cors-wildcard", title: "CORS allows any origin", detail: "Access-Control-Allow-Origin: * on /api" };

  test("precheck: leaked secrets are critical without JEV", async () => {
    const judge = fakeJudge({});
    const { svc } = await setup(judge);
    const r = await svc.severity({ runId: null, finding: { ...finding, kind: "secrets", rule: "aws-key" }, ruleSeverity: "high" });
    expect(judge.calls).toHaveLength(0);
    expect(r.severity).toBe("critical");
    expect(r.decision.answers.precheck).toBe("leaked_secret");
  });

  test("low confidence takes the higher grade", async () => {
    const judge = fakeJudge({ severity: choice("medium", 0.44, { medium: 0.44, high: 0.41, low: 0.15 }) });
    const { svc } = await setup(judge);
    const r = await svc.severity({ runId: "run-1", finding, ruleSeverity: "medium" });
    expect(r.severity).toBe("high");
    expect(r.decision.action).toBe("high, block ship, fix now");
  });

  test("state is redacted before it reaches JEV", async () => {
    const judge = fakeJudge({ severity: choice("low", 0.9, { low: 0.9 }) });
    const { svc } = await setup(judge);
    await svc.severity({ runId: "run-1", finding: { ...finding, detail: "header set next to sk-proj-abcdefghijklmnopqrstuvwx" }, ruleSeverity: "low" });
    const sent = JSON.stringify(judge.calls[0]!.state);
    expect(sent).not.toContain("sk-proj-abcdefghijklmnopqrstuvwx");
    expect(sent).toContain("[REDACTED]");
  });

  test("unverified fallback uses the rule table severity", async () => {
    const { svc } = await setup(fakeJudge("unverified"));
    const r = await svc.severity({ runId: "run-1", finding, ruleSeverity: "medium" });
    expect(r.severity).toBe("medium");
    expect(r.decision.stamp).toBe(UNVERIFIED_STAMP);
  });
});

describe("cache and log", () => {
  const input = { runId: "run-1", goal: "g", task, candidates: ["engineer", "qa"] as Array<"engineer" | "qa"> };
  const answers = { owner: choice("engineer", 0.9, { engineer: 0.9, qa: 0.1 }), split: noul(0.9) };

  test("identical decision within 10 minutes is served from kv, and still logged", async () => {
    const judge = fakeJudge(answers);
    const { svc, clock, events } = await setup(judge);
    const a = await svc.route(input);
    clock.advance(9 * 60_000);
    const b = await svc.route(input);
    expect(judge.calls).toHaveLength(1);
    expect(b.role).toBe(a.role);
    expect(b.decision.verified).toBe(true);
    expect(b.decision.latencyMs).toBe(0);
    expect(b.decision.id).not.toBe(a.decision.id);
    clock.advance(2 * 60_000);
    await svc.route(input);
    expect(judge.calls).toHaveLength(2);
    expect(events.ofType("decision")).toHaveLength(3);
    expect(await svc.list("run-1")).toHaveLength(3);
  });

  test("different state misses the cache; unverified results are never cached", async () => {
    const judge = fakeJudge("unverified", answers);
    const { svc } = await setup(judge);
    const first = await svc.route(input);
    expect(first.decision.stamp).toBe(UNVERIFIED_STAMP);
    const second = await svc.route(input);
    expect(second.decision.verified).toBe(true);
    await svc.route({ ...input, goal: "other goal" });
    expect(judge.calls).toHaveLength(3);
  });

  test("a verified answer that does not fit the questions is never cached", async () => {
    const judge = fakeJudge({ owner: choice("operator", 0.9, { operator: 0.9 }), split: noul(0.9) }, answers);
    const { svc, ctx } = await setup(judge);
    const first = await svc.route(input);
    expect(first.decision.verified).toBe(false);
    expect(first.decision.stamp).toBe(UNVERIFIED_STAMP);
    const second = await svc.route(input);
    expect(judge.calls).toHaveLength(2);
    expect(second.decision.verified).toBe(true);
    expect(second.decision.stamp).toBeNull();
    expect(second.role).toBe("engineer");
    // the good answer is the one cached now
    await svc.route(input);
    expect(judge.calls).toHaveLength(2);
    // a stale malformed entry already in the kv is skipped and JEV is asked again
    const keys: string[] = [];
    const kv = ctx.kv;
    const spy = { ...kv, set: async (k: string, v: string, t?: number) => (keys.push(k), kv.set(k, v, t)) };
    const other = createJevModule({ ...ctx, kv: spy }, { judge: fakeJudge(answers) }).service;
    await other.route({ ...input, goal: "stale" });
    await kv.set(keys[0]!, JSON.stringify({ at: ctx.clock.now(), model: "x", answers: { owner: choice("operator", 0.9, { operator: 0.9 }) } }), 600);
    const judge3 = fakeJudge(answers);
    const third = await createJevModule({ ...ctx, kv }, { judge: judge3 }).service.route({ ...input, goal: "stale" });
    expect(judge3.calls).toHaveLength(1);
    expect(third.decision.verified).toBe(true);
  });

  test("persisted rows round-trip and list filters by run, oldest first", async () => {
    const judge = fakeJudge(answers);
    const { svc, db, clock } = await setup(judge);
    const a = await svc.route(input);
    clock.advance(1000);
    await svc.route({ ...input, runId: "run-2", goal: "x" });
    clock.advance(1000);
    const c = await svc.route({ ...input, goal: "y" });
    const run1 = await svc.list("run-1");
    expect(run1.map((d) => d.id)).toEqual([a.decision.id, c.decision.id]);
    expect(await svc.list()).toHaveLength(3);
    expect(await svc.list(undefined, { limit: 1 })).toEqual([c.decision]);
    const rows = await db.query<{ domain: string; state_digest: string; questions: string }>`select domain, state_digest, questions from decisions where id = ${a.decision.id}`;
    expect(rows[0]!.domain).toBe("orch");
    expect(rows[0]!.state_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(rows[0]!.questions).owner.type).toBe("choice");
  });
});

describe("routes", () => {
  test("GET /api/decisions lists and validates the query", async () => {
    const judge = fakeJudge({ owner: choice("engineer", 0.9, { engineer: 0.9 }), split: noul(0.9) });
    const { svc, mod } = await setup(judge);
    await svc.route({ runId: "run-1", goal: "g", task, candidates: ["engineer", "qa"] });
    const app = new Hono();
    app.onError((err, c) => (err instanceof HttpError ? c.json(errorBody(err.code, err.message), err.status) : c.json(errorBody("internal", "error"), 500)));
    app.route(`/api/${mod.mountPath}`, mod.routes!);
    const ok = await app.request("/api/decisions?runId=run-1");
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Array<{ decisionId: string }>;
    expect(body.map((d) => d.decisionId)).toEqual(["orch.route"]);
    const none = await app.request("/api/decisions?runId=run-9");
    expect(await none.json()).toEqual([]);
    const bad = await app.request("/api/decisions?limit=0");
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("invalid_query");
    const badId = await app.request("/api/decisions?runId=x%27%3B");
    expect(badId.status).toBe(422);
  });
});
