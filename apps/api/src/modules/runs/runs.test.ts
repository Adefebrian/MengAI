// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { RunDTO, RunSnapshotDTO, TaskDTO } from "@mengai/shared";
import { HttpError, errorBody } from "../../lib/http";
import { createTestDb } from "../../testing";
import { createTasksArgs, parseArgs, resolveDeps, submitReviewArgs } from "./controls";
import { HEURISTIC, RepeatGuard, estimatePlan, heuristicTaskCount, moodFor, stableArgs, type MoodInput } from "./policy";
import { createRunsRepo, emptyUsage } from "./repo";
import { fakeContext, harness } from "./testkit";
import { STATUS_MAX, batchLine, commandNoun, pathNoun, thinkingLine, toolLine } from "./voice";

function app(routes: Hono) {
  const a = new Hono();
  a.onError((e, c) => (e instanceof HttpError ? c.json(errorBody(e.code, e.message), e.status) : c.json(errorBody("internal", "internal error"), 500)));
  a.route("/api/runs", routes);
  return a;
}

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("runs routes", () => {
  test("validation, create, list, snapshot, calls, tool call, xray, control conflicts", async () => {
    const h = await harness({
      script: { lead: [{ calls: [{ name: "note", args: { text: "on it" } }] }, { calls: [{ name: "finish", args: { summary: "trivial goal done" } }] }] },
    });
    const api = app(h.mod.routes!);
    expect(h.mod.mountPath).toBe("runs");

    let res = await api.request("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("invalid_json");

    res = await api.request("/api/runs", json({ projectId: "p1" }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.code).toBe("invalid_body");

    res = await api.request("/api/runs", json({ projectId: "p1", goal: "ok goal", extra: 1 }));
    expect(res.status).toBe(422);

    res = await api.request("/api/runs", json({ projectId: "p1", goal: "ok goal", budgetTokens: 10 }));
    expect(res.status).toBe(422);

    res = await api.request("/api/runs", json({ projectId: "missing", goal: "ok goal" }));
    expect(res.status).toBe(404);

    res = await api.request("/api/runs", json({ projectId: "p1", goal: "Say hello to the team", budgetUsd: 2 }));
    expect(res.status).toBe(201);
    const run = (await res.json()) as RunDTO;
    expect(run.budgetUsd).toBe(2);
    await h.untilStatus(run.id, "done");

    res = await api.request("/api/runs");
    const list = (await res.json()) as RunDTO[];
    expect(list.map((r) => r.id)).toEqual([run.id]);
    expect(list[0]!.progress).toBe(1);

    res = await api.request(`/api/runs/${run.id}`);
    const snap = (await res.json()) as RunSnapshotDTO;
    expect(snap.run.status).toBe("done");
    expect(snap.agents).toHaveLength(1);
    expect(snap.lastSeq).toBe(h.events.events.at(-1)!.seq);
    expect(snap.decisions).toEqual([]);
    expect(snap.approvals).toEqual([]);

    res = await api.request("/api/runs/bad%20id!");
    expect(res.status).toBe(422);
    res = await api.request("/api/runs/unknown-run");
    expect(res.status).toBe(404);

    // plan (note, finish) then the report to the owner
    res = await api.request(`/api/runs/${run.id}/calls`);
    expect(((await res.json()) as unknown[]).length).toBe(3);

    const noteCall = h.events.ofType("tool.call")[0]!;
    res = await api.request(`/api/runs/${run.id}/tools/${noteCall.data.callId}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).tool).toBe("note");
    res = await api.request(`/api/runs/${run.id}/tools/nope`);
    expect(res.status).toBe(404);

    res = await api.request(`/api/runs/${run.id}/xray/${snap.agents[0]!.id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).agentId).toBe(snap.agents[0]!.id);
    res = await api.request(`/api/runs/${run.id}/xray/nobody`);
    expect(res.status).toBe(404);

    res = await api.request(`/api/runs/${run.id}/pause`, { method: "POST" });
    expect(res.status).toBe(409);
    res = await api.request(`/api/runs/${run.id}/stop`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as RunDTO).status).toBe("done");

    res = await api.request(`/api/runs/${run.id}/budget`, { ...json({}), method: "PATCH" });
    expect(res.status).toBe(422);
    res = await api.request(`/api/runs/${run.id}/budget`, { ...json({ budgetTokens: 5000 }), method: "PATCH" });
    expect(res.status).toBe(409);
    res = await api.request(`/api/runs/${run.id}/tasks/${snap.tasks[0]!.id}`, { ...json({ status: "done" }), method: "PATCH" });
    expect(res.status).toBe(422);
    res = await api.request(`/api/runs/${run.id}/message`, json({ text: "" }));
    expect(res.status).toBe(422);
    res = await api.request(`/api/runs/${run.id}/message`, json({ text: "hello" }));
    expect(res.status).toBe(409);

    res = await api.request("/api/runs/estimate", json({ projectId: "p1", goal: "Build a thing" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).basis).toBe("history");
  });

  test("create refuses when no chat provider is configured", async () => {
    const h = await harness({ script: {} });
    h.llm.configuredValue = false;
    await expect(h.svc.create({ projectId: "p1", goal: "anything at all" })).rejects.toMatchObject({ status: 409, code: "llm_not_configured" });
    expect(await h.svc.list()).toEqual([]);
  });

  test("routes patch a live task and message the crew", async () => {
    const h = await harness({ script: { lead: [{ hang: true }] } });
    const api = app(h.mod.routes!);
    const run = await h.svc.create({ projectId: "p1", goal: "Stay busy for a while" });
    await h.until(() => h.llm.calls.length === 1, "in flight");
    const task = (await h.svc.snapshot(run.id)).tasks[0]!;
    let res = await api.request(`/api/runs/${run.id}/tasks/${task.id}`, { ...json({ priority: 7 }), method: "PATCH" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as TaskDTO).priority).toBe(7);
    res = await api.request(`/api/runs/${run.id}/tasks/nope`, { ...json({ priority: 7 }), method: "PATCH" });
    expect(res.status).toBe(404);
    res = await api.request(`/api/runs/${run.id}/message`, json({ text: "hi", agentId: "ghost" }));
    expect(res.status).toBe(404);
    res = await api.request(`/api/runs/${run.id}/message`, json({ text: "hi there" }));
    expect(res.status).toBe(200);
    res = await api.request(`/api/runs/${run.id}/budget`, { ...json({ budgetUsd: 3 }), method: "PATCH" });
    expect(((await res.json()) as RunDTO).budgetUsd).toBe(3);
    const lead = (await h.svc.snapshot(run.id)).agents[0]!;
    res = await api.request(`/api/runs/${run.id}/agents/${lead.id}/stop`, { method: "POST" });
    expect(res.status).toBe(200);
    res = await api.request(`/api/runs/${run.id}/stop`, { method: "POST" });
    expect(((await res.json()) as RunDTO).status).toBe("stopped");
  });
});

describe("runs estimate", () => {
  test("from this project's history: tokens per task times predicted task count", async () => {
    const db = await createTestDb();
    const repo = createRunsRepo(db);
    const seed = async (id: string, goal: string, tokens: number, cost: number, tasks: number) => {
      await repo.insertRun(
        { id, projectId: "p1", goal, status: "done", statusReason: null, budgetTokens: 1, budgetUsd: 1, usage: emptyUsage(), progress: 0, startedAt: 1, endedAt: 2, createdAt: 1 },
        1,
      );
      await repo.addRunUsage(id, { ...emptyUsage(), inputTokens: tokens * 0.9, outputTokens: tokens * 0.1, costUsd: cost, calls: 3 }, 2);
      for (let i = 0; i < tasks; i++) {
        await repo.insertTask({
          id: `${id}-t${i}`, runId: id, parentId: null, title: `t${i}`, spec: "", acceptance: [], role: "engineer", assigneeId: null, status: "done",
          priority: 0, deps: [], review: false, attempts: 1, resultSummary: null, createdBy: null, createdAt: 1, updatedAt: 1, startedAt: 1, endedAt: 2,
        });
      }
    };
    await seed("r1", "build a login page", 40_000, 0.04, 4);
    await seed("r2", "add a signup form", 60_000, 0.06, 6);
    const h = await harness({ db, script: {} });
    const est = await h.svc.estimate({ projectId: "p1", goal: "make a reset page" });
    expect(est).toEqual({ tasks: 5, tokens: 50_000, costUsd: 0.05, basis: "history" });
    const longer = await h.svc.estimate({ projectId: "p1", goal: "make a reset page with email codes, rate limits and audit logs" });
    expect(longer.basis).toBe("history");
    expect(longer.tasks).toBe(10);
  });

  test("heuristic from goal length when the project has no history", async () => {
    const h = await harness({ script: {} });
    const goal = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen";
    const est = await h.svc.estimate({ projectId: "p2", goal });
    expect(est.basis).toBe("heuristic");
    expect(est.tasks).toBe(heuristicTaskCount(goal));
    expect(est.tasks).toBe(5);
    expect(est.tokens).toBe(5 * HEURISTIC.tokensPerTask);
    expect(est.costUsd).toBeGreaterThan(0);
    await expect(h.svc.estimate({ projectId: "nope", goal })).rejects.toMatchObject({ status: 404 });
  });
});

describe("runs policy", () => {
  const base: MoodInput = { justPassed: false, consecutiveFailures: 0, cleanSteps: 0, tokensUsed: 0, budgetShare: 1000, runElapsedMs: 0 };
  test("mood transitions are deterministic and ordered", () => {
    expect(moodFor(base)).toBe("calm");
    expect(moodFor({ ...base, cleanSteps: 5 })).toBe("calm");
    expect(moodFor({ ...base, cleanSteps: 6 })).toBe("focused");
    expect(moodFor({ ...base, consecutiveFailures: 1 })).toBe("calm");
    expect(moodFor({ ...base, consecutiveFailures: 2, cleanSteps: 9 })).toBe("frustrated");
    expect(moodFor({ ...base, justPassed: true, consecutiveFailures: 3 })).toBe("proud");
    expect(moodFor({ ...base, tokensUsed: 800 })).toBe("calm");
    expect(moodFor({ ...base, tokensUsed: 801 })).toBe("tired");
    expect(moodFor({ ...base, runElapsedMs: 45 * 60_000 + 1 })).toBe("tired");
    expect(moodFor({ ...base, tokensUsed: 5000, budgetShare: 0 })).toBe("calm");
    expect(moodFor({ ...base, cleanSteps: 6, runElapsedMs: 50 * 60_000 })).toBe("focused");
  });

  test("repeat guard counts identical consecutive calls with identical results, regardless of key order", () => {
    const g = new RepeatGuard();
    expect(stableArgs('{"b":1,"a":{"d":2,"c":3}}')).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(g.wouldRepeat("fs_read", '{"a":1,"b":2}')).toBe(1);
    expect(g.record("fs_read", '{"a":1,"b":2}', "same", true)).toBe(1);
    expect(g.wouldRepeat("fs_read", '{"b":2,"a":1}')).toBe(2);
    expect(g.record("fs_read", '{"b":2,"a":1}', "same", true)).toBe(2);
    expect(g.wouldRepeat("fs_read", '{"a":1,"b":2}')).toBe(3);
    // a different result restarts the streak
    expect(g.record("fs_read", '{"a":1,"b":2}', "changed", true)).toBe(1);
    // a different call in between restarts it too
    expect(g.record("fs_edit", '{"path":"a"}', "ok", true)).toBe(1);
    expect(g.wouldRepeat("fs_read", '{"a":1,"b":2}')).toBe(1);
    expect(g.record("shell_run", '{"command":"bun test"}', "1 fail", false)).toBe(1);
    expect(g.record("shell_run", '{"command":"bun test"}', "1 fail", true)).toBe(1);
    expect(g.error("shell_run", "boom")).toBe(1);
    expect(g.error("shell_run", "boom ")).toBe(2);
  });

  test("cat voice status lines: friendly nouns, no secrets, at most 80 characters", () => {
    expect(STATUS_MAX).toBe(80);
    expect(pathNoun("bun.lock")).toBe("the lockfile");
    expect(pathNoun("apps/web/src/pages/settings.tsx")).toBe("the settings page");
    expect(pathNoun("src/routes/billing/index.tsx")).toBe("the billing page");
    expect(pathNoun("src/lib/format.ts")).toBe("format.ts");
    expect(pathNoun(".")).toBe("the workspace");
    expect(commandNoun("OPENAI_API_KEY=sk-proj-" + "a".repeat(30) + " bun test --watch")).toBe("bun test");
    expect(commandNoun("git -C . status")).toBe("git");
    expect(toolLine("shell_run", JSON.stringify({ command: "bun test" }))).toBe("Watching bun test like a bird at the window");
    expect(toolLine("fs_read", JSON.stringify({ path: "bun.lock" }))).toBe("Sniffing through the lockfile");
    expect(toolLine("fs_write", JSON.stringify({ path: "src/pages/settings.tsx", content: "password: hunter22" }))).toBe("Kneading the settings page");
    expect(toolLine("web_fetch", JSON.stringify({ url: "https://docs.example.com/a?token=abc" }))).toBe("Peeking out the window at docs.example.com");
    expect(batchLine([{ name: "fs_read", arguments: '{"path":"a"}' }, { name: "fs_read", arguments: '{"path":"b"}' }])).toBe("Sniffing through 2 files");
    const long = "x".repeat(500);
    for (const line of [
      toolLine("fs_read", JSON.stringify({ path: `${long}.ts` })),
      toolLine("fs_search", JSON.stringify({ pattern: long })),
      toolLine("note", JSON.stringify({ text: long })),
      toolLine("some_future_tool", "{}"),
      thinkingLine("engineer", long, 3, false),
      thinkingLine("reviewer", "Review: Build feature", 0, false),
    ]) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
    expect(thinkingLine("reviewer", "Review: Build feature", 0, false)).toBe("Eyeing Build feature closely");
    expect(toolLine("note", JSON.stringify({ text: "key sk-proj-" + "b".repeat(30) }))).not.toContain("bbbbbbbb");
  });

  test("estimate math", () => {
    expect(estimatePlan("x", [])).toMatchObject({ basis: "heuristic", tasks: 4 });
    const e = estimatePlan("a b c d", [{ goal: "a b c d", tokens: 10_000, costUsd: 0.01, tasks: 2 }]);
    expect(e).toEqual({ tasks: 2, tokens: 10_000, basis: "history", usdPerToken: 0.000001 });
  });
});

describe("runs control tool parsing", () => {
  test("create_tasks accepts common variants and resolves deps", () => {
    const p = parseArgs(
      "create_tasks",
      createTasksArgs,
      JSON.stringify({
        tasks: [
          { id: "api", title: "API", description: "build it", acceptance_criteria: "- returns 200\n- validates", role: "Engineer", review: "yes" },
          { title: "UI", spec: "screens", role: "designer", depends_on: ["api"] },
          { title: "Tests", spec: "cover", role: "qa", deps: [1, "UI"] },
        ],
      }),
    );
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const [api, ui, tests] = p.value.tasks;
    expect(api!.acceptance).toEqual(["returns 200", "validates"]);
    expect(api!.role).toBe("engineer");
    expect(api!.review).toBe(false);
    expect(ui!.spec).toBe("screens");
    const r = resolveDeps(p.value.tasks, ["A", "B", "C"], [{ id: "old", title: "Old task" }]);
    expect(r).toEqual({ ok: true, deps: [[], ["A"], ["A", "B"]] });
  });

  test("create_tasks rejects unknown roles, unknown deps and cycles", () => {
    expect(parseArgs("create_tasks", createTasksArgs, JSON.stringify({ tasks: [{ title: "x", role: "wizard" }] })).ok).toBe(false);
    expect(parseArgs("create_tasks", createTasksArgs, "not json")).toEqual({ ok: false, error: "Invalid arguments for create_tasks: not valid JSON." });
    const planned = (deps: Array<Array<string | number>>) =>
      deps.map((d, i) => ({ key: `k${i}`, title: `t${i}`, spec: "", acceptance: [], role: "engineer" as const, deps: d, review: false, priority: 0, roleTitle: null }));
    expect(resolveDeps(planned([["ghost"]]), ["A"], []).ok).toBe(false);
    const cyc = resolveDeps(planned([["k1"], ["k0"]]), ["A", "B"], []);
    expect(cyc.ok).toBe(false);
    expect(resolveDeps(planned([[], ["old"]]), ["A", "B"], [{ id: "old", title: "Old" }])).toEqual({ ok: true, deps: [[], ["old"]] });
  });

  test("submit_review normalizes verdicts", () => {
    const v = (args: unknown) => parseArgs("submit_review", submitReviewArgs, JSON.stringify(args));
    expect(v({ verdict: "Approved", notes: "fine" })).toEqual({ ok: true, value: { verdict: "pass", notes: ["fine"] } });
    expect(v({ verdict: "changes requested", issues: [{ severity: "high", title: "No auth" }] })).toEqual({ ok: true, value: { verdict: "fail", notes: ["[high] No auth"] } });
    expect(v({ approved: false })).toMatchObject({ ok: true, value: { verdict: "fail" } });
    expect(v({ notes: "hm" }).ok).toBe(false);
  });
});

describe("runs engine: tool errors go back to the model", () => {
  test("bad create_tasks, same-role handoff and finish in a review task return tool errors", async () => {
    const h = await harness({
      script: (info) => {
        if (info.role === "lead") {
          if (info.n === 0) return { calls: [{ name: "create_tasks", args: { tasks: Array.from({ length: 13 }, (_, i) => ({ title: `t${i}`, role: "engineer" })) } }] };
          if (info.n === 1) return { calls: [{ name: "create_tasks", args: { tasks: [{ title: "Only", spec: "x", role: "engineer", review: true }] } }, { name: "finish", args: { summary: "p" } }] };
          return { calls: [{ name: "finish", args: { summary: "report" } }] };
        }
        if (info.role === "engineer") {
          if (info.n === 0) return { calls: [{ name: "handoff", args: { to_role: "engineer", title: "me again" } }] };
          return { calls: [{ name: "finish", args: { summary: "did it" } }] };
        }
        if (info.role === "reviewer") {
          if (info.n === 0) return { calls: [{ name: "finish", args: { summary: "looks fine" } }] };
          return { calls: [{ name: "submit_review", args: { verdict: "pass" } }] };
        }
        return {};
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Exercise tool errors" });
    await h.untilStatus(run.id, "done");
    const results = h.events.ofType("tool.result");
    expect(results.filter((r) => !r.data.ok).map((r) => r.data.summary)).toEqual([
      "At most 12 tasks per call. Split the plan.",
      "Hand off to a different role, or do this part yourself.",
      "This is a review task: call submit_review with verdict pass or fail and your notes.",
    ]);
    const snap = await h.svc.snapshot(run.id);
    expect(snap.tasks.find((t) => t.title === "Only")!.status).toBe("done");
    expect(snap.handoffs).toEqual([]);
  });

  test("finish with outcome blocked blocks the task and its dependents; ask_human shows options", async () => {
    const h = await harness({
      script: (info) => {
        if (info.role === "lead") {
          if (info.n === 0)
            return {
              calls: [
                { name: "create_tasks", args: { tasks: [{ key: "a", title: "Needs creds", spec: "x", acceptance: ["ok"], role: "engineer" }, { key: "b", title: "Uses it", spec: "y", acceptance: ["ok"], role: "qa", deps: ["a"] }] } },
                { name: "finish", args: { summary: "planned" } },
              ],
            };
          if (info.n === 1) return { calls: [{ name: "ask_human", args: { question: "Ship anyway?", options: ["yes", "no"] } }] };
          return { calls: [{ name: "finish", args: { summary: "report", outcome: "blocked" } }] };
        }
        return { calls: [{ name: "finish", args: { summary: "no database credentials", outcome: "blocked", files: ["db.ts"] } }] };
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Hit a blocker" });
    await h.until(() => h.events.ofType("agent.status").some((e) => e.data.status === "approval"), "question");
    expect(h.events.ofType("agent.say").find((e) => e.data.to === "human")!.data.text).toBe("Ship anyway? Options: yes | no");
    await h.svc.message(run.id, { text: "no" });
    await h.untilStatus(run.id, "done");
    const snap = await h.svc.snapshot(run.id);
    const blocked = snap.tasks.find((t) => t.title === "Needs creds")!;
    expect(blocked.status).toBe("blocked");
    expect(blocked.resultSummary).toBe("Blocked: no database credentials\nFiles: db.ts");
    expect(snap.tasks.find((t) => t.title === "Uses it")!.status).toBe("blocked");
    expect(snap.run.statusReason).toBe("2 tasks failed or blocked");
  });

  test("compaction summarizes through the fast tier and publishes memory.compacted", async () => {
    const context = fakeContext({ compactWhen: (input) => input.steps.length >= 3 });
    const h = await harness({
      context,
      script: (info) => {
        if (info.n < 4) return { calls: [{ name: "fs_read", args: { path: `f${info.n}` } }] };
        return { calls: [{ name: "finish", args: { summary: "compact done" } }] };
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Read until compaction" });
    await h.untilStatus(run.id, "done");
    expect(h.events.ofType("memory.compacted").length).toBeGreaterThan(0);
    expect(h.llm.resolved.some((r) => r.tier === "fast")).toBe(true);
    expect(h.usage.calls.some((c) => c.purpose === "summarize")).toBe(true);
    const after = context.builds.find((b) => b.summary === "summary of earlier steps");
    expect(after).toBeDefined();
    expect(h.usage.calls.find((c) => c.purpose === "plan")).toBeDefined();
  });

  test("secrets in model text and tool args are redacted before events and storage", async () => {
    const key = "sk-proj-" + "a".repeat(30);
    const h = await harness({
      script: { lead: [{ text: `using ${key}`, calls: [{ name: "note", args: { text: `key ${key}` } }] }, { calls: [{ name: "finish", args: { summary: `done ${key}` } }] }] },
    });
    const run = await h.svc.create({ projectId: "p1", goal: `Goal with ${key}` });
    await h.untilStatus(run.id, "done");
    const dump = JSON.stringify(h.events.events);
    expect(dump).not.toContain(key);
    const snap = await h.svc.snapshot(run.id);
    expect(JSON.stringify(snap)).not.toContain(key);
    const call = await h.svc.toolCall(run.id, h.events.ofType("tool.call")[0]!.data.callId);
    expect(JSON.stringify(call)).not.toContain(key);
  });
});
