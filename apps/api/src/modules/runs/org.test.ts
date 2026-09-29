// The brain in the live loop, through the real engine with scripted cats:
// the self-check rounds, strategy tuning adopted by runtime JEV and injected
// into the next step, dynamic roles, the unlimited org (hire or do it
// yourself, hire or wait, helpers at any depth), letting a cat go and hiring
// its replacement, the CEO's name, the tracker stages and the mind API.
import { describe, expect, test } from "bun:test";
import type { LessonDTO, MengaiEvent, TaskDTO } from "@mengai/shared";
import { Hono } from "hono";
import { jsonErrorHandler } from "../../core/app";
import { silentLogger } from "../../testing";
import { choice, fakeBrain, fakeJudge, fakeTools, harness, type CallInfo, type Reply } from "./testkit";

type Ev<T extends MengaiEvent["type"]> = MengaiEvent<T>;
const byTitle = (tasks: TaskDTO[], title: string) => tasks.find((t) => t.title === title)!;
const at = (events: MengaiEvent[], pred: (e: MengaiEvent) => boolean) => events.findIndex(pred);
const plan = (tasks: unknown[]): Reply => ({ calls: [{ name: "create_tasks", args: { tasks } }, { name: "finish", args: { summary: "planned" } }] });
const finish = (summary: string, extra: Record<string, unknown> = {}): Reply => ({ calls: [{ name: "finish", args: { summary, ...extra } }] });
const blocked = (summary: string): Reply => finish(summary, { outcome: "blocked" });
const call = (name: string, args: Record<string, unknown> = {}): Reply => ({ calls: [{ name, args }] });
const revise = (critique: string) => ({ text: JSON.stringify({ verdict: "revise", critique }) });
const pass = { text: JSON.stringify({ verdict: "pass", critique: "ok" }) };
const leadThen = (tasks: unknown[]) => (info: CallInfo): Reply | null => (info.role === "lead" ? (info.n === 0 ? plan(tasks) : finish("report")) : null);

describe("brain: work, verify, self-critique, fix", () => {
  test("a revise verdict sends the cat into another round; the rule passes the finish once a check ran after the change", async () => {
    const lead = leadThen([{ title: "Build form", spec: "Build it", acceptance: ["Validates email"], role: "engineer" }]);
    const h = await harness({
      brain: { reflexion: true },
      side: { reflexion: (_packet, n) => (n === 1 ? revise("No check covers the email validation. Run the tests.") : pass) },
      script: (info) => {
        const l = lead(info);
        if (l) return l;
        return [call("fs_write", { path: "form.ts", content: "x" }), finish("Built the form", { files: ["form.ts"] }), call("shell_run", { command: "bun test" }), finish("Built the form, bun test exit 0")][info.n] ?? finish("again");
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "A login form" });
    await h.untilStatus(run.id, "done");
    const rx = h.events.ofType("agent.reflexion");
    expect(rx.map((e) => [e.data.check, e.data.verdict, e.data.by])).toEqual([
      [1, "revise", "critic"],
      [2, "pass", "rule"],
    ]);
    expect(rx[0]!.data.evidence).toEqual({ files: 1, checks: 0, failedChecks: 0 });
    // one critic call, fast tier, 150 output tokens, evidence first
    expect(h.llm.reflexionCalls).toHaveLength(1);
    expect(h.llm.reflexionCalls[0]!.maxOutputTokens).toBe(150);
    const packet = h.llm.reflexionCalls[0]!.messages[0]!.content as string;
    expect(packet.indexOf("Files changed (1): form.ts")).toBeLessThan(packet.indexOf("Its finish summary"));
    // the model sees the critique as the result of its first finish
    const third = h.context.builds.filter((b) => b.role === "engineer")[2]!;
    expect(third.steps[1]!.results[0]!.output).toBe("Not finished yet. Self-check 1: No check covers the email validation. Run the tests. Address it, then call finish again.");
    const snap = await h.svc.snapshot(run.id);
    expect(byTitle(snap.tasks, "Build form")).toMatchObject({ status: "done", resultSummary: "Built the form, bun test exit 0" });
    expect(h.usage.calls.filter((c) => c.purpose === "reflect")).toHaveLength(1);
  });

  test("at most two extra rounds: the third revise is accepted with the open point noted", async () => {
    const lead = leadThen([{ title: "Tidy the page", spec: "Tidy", role: "designer" }]);
    const h = await harness({
      brain: { reflexion: true },
      side: { reflexion: () => revise("The spacing is still off on mobile.") },
      script: (info) => lead(info) ?? ([call("fs_write", { path: "a.css", content: "a" }), finish("Tidied"), call("fs_read", { path: "a.css" }), finish("Tidied again"), call("fs_list"), finish("Tidied a third time")][info.n] ?? finish("x")),
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Tidy" });
    await h.untilStatus(run.id, "done");
    expect(h.events.ofType("agent.reflexion").map((e) => e.data.verdict)).toEqual(["revise", "revise", "revise"]);
    const t = byTitle((await h.svc.snapshot(run.id)).tasks, "Tidy the page");
    expect(t.status).toBe("done");
    expect(t.resultSummary).toBe("Tidied a third time\nOpen after the self-check: The spacing is still off on mobile.");
  });

  test("a failed check after the last change revises by rule without a critic call; a critic that fails lets the finish stand", async () => {
    const lead = leadThen([
      { key: "a", title: "Fix the bug", spec: "Fix", role: "engineer" },
      { key: "b", title: "Write docs", spec: "Docs", role: "designer" },
    ]);
    let runs = 0;
    const tools = fakeTools((c) => (c.name === "shell_run" && runs++ === 0 ? { output: "exit 1 in 0.3s\n1 fail", ok: false, durationMs: 3 } : { output: c.name === "shell_run" ? "exit 0 in 0.2s" : `ok ${c.name}`, ok: true, durationMs: 1 }));
    const h = await harness({
      brain: { reflexion: true },
      tools,
      side: { reflexion: () => ({ error: new Error("critic down") }) },
      script: (info) => {
        const l = lead(info);
        if (l) return l;
        if (info.role === "engineer") return [call("fs_edit", { path: "a.ts", find: "a", replace: "b" }), call("shell_run", { command: "bun test --bail" }), finish("Fixed"), call("shell_run", { command: "bun test --bail" }), finish("Fixed, tests pass")][info.n] ?? finish("x");
        return [call("fs_write", { path: "README.md", content: "docs" }), finish("Docs written")][info.n] ?? finish("x");
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Fix and document" });
    await h.untilStatus(run.id, "done");
    const rx = h.events.ofType("agent.reflexion");
    const eng = rx.filter((e) => e.data.critique.startsWith("The last check failed") || e.data.by === "rule");
    expect(eng.map((e) => [e.data.verdict, e.data.by])).toEqual([
      ["revise", "rule"],
      ["pass", "rule"],
    ]);
    expect(eng[0]!.data.critique).toBe("The last check failed: bun test --bail (exit 1). Fix the cause and run it again, or finish with blocked true and the reason.");
    const docs = rx.find((e) => e.data.by === "critic")!;
    expect(docs.data).toMatchObject({ verdict: "pass", critique: "The self-check gave no usable verdict; the finish stands." });
    expect(byTitle((await h.svc.snapshot(run.id)).tasks, "Write docs").status).toBe("done");
  });

  test("no self-check for a blocked finish, the CEO's own tasks or reviews", async () => {
    const lead = leadThen([{ title: "Scan it", spec: "Scan", role: "security", review: false }, { title: "Build it", spec: "Build", role: "engineer", review: true }]);
    const h = await harness({
      brain: { reflexion: true },
      script: (info) => {
        const l = lead(info);
        if (l) return l;
        if (info.role === "security") return blocked("No lockfile to scan");
        if (info.role === "reviewer") return call("submit_review", { verdict: "pass", notes: ["fine"] });
        return [call("shell_run", { command: "bun test" }), finish("Built")][info.n] ?? finish("x");
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Scan and build" });
    await h.untilStatus(run.id, "done");
    const rx = h.events.ofType("agent.reflexion");
    expect(rx).toHaveLength(1);
    const snap = await h.svc.snapshot(run.id);
    expect(rx[0]!.data.taskId).toBe(byTitle(snap.tasks, "Build it").id);
  });

  test("the adaptive budget stops a stalled cat early; a productive one runs to the hard cap", async () => {
    const lead = leadThen([{ title: "Dig", spec: "Find it", role: "engineer" }]);
    const tools = fakeTools((c) => (c.name === "fs_read" ? { output: `not found: ${JSON.parse(c.arguments).path}`, ok: false, durationMs: 1 } : { output: "ok", ok: true, durationMs: 1 }));
    const h = await harness({ tools, script: (info) => lead(info) ?? call("fs_read", { path: `missing-${info.n}.ts` }) });
    const run = await h.svc.create({ projectId: "p1", goal: "Dig" });
    await h.untilStatus(run.id, "done");
    const t = byTitle((await h.svc.snapshot(run.id)).tasks, "Dig");
    expect(t.status).toBe("failed");
    expect(t.resultSummary).toBe("Failed: step budget reached (5 steps without enough progress)");
    expect(h.llm.calls.filter((c) => c.role === "engineer")).toHaveLength(5);
  });
});

describe("brain: strategies tuned when a role or a cat underperforms", () => {
  const three = [
    { key: "a", title: "Task A", spec: "A", role: "engineer" },
    { key: "b", title: "Task B", spec: "B", role: "engineer" },
    { key: "c", title: "Task C", spec: "C", role: "engineer" },
  ];

  async function tuned(answer: string | null, extra: Parameters<typeof fakeBrain>[0] = {}) {
    const brain = fakeBrain({ tuneAfter: 2, ...extra });
    const judge = fakeJudge((id) => (id === "prompt.adopt" && answer ? { adopt: choice(answer) } : null));
    const lead = leadThen(three);
    const h = await harness({
      brain: { tuning: true },
      brainMemory: brain,
      judge,
      settings: { maxConcurrentAgents: 1 },
      script: (info) => lead(info) ?? (info.title === "Task C" ? finish("C done") : blocked(`${info.title} is stuck`)),
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Three tasks" });
    await h.untilStatus(run.id, "done");
    return { h, brain, judge, run };
  }

  test("adopt: the new version reaches the role's very next step, and its dispatch waited for the answer", async () => {
    const { h, brain, judge } = await tuned("adopt");
    expect(brain.trace.outcomes.filter((o) => o.role === "engineer").map((o) => [o.role, o.outcome, o.kind])).toEqual([
      ["engineer", "loss", "blocked"],
      ["engineer", "loss", "blocked"],
      ["engineer", "win", "done"],
    ]);
    // the CEO's own work counts for its role too
    expect(brain.trace.outcomes.filter((o) => o.role === "lead").map((o) => o.outcome)).toEqual(["win", "win"]);
    expect(judge.calls.map((c) => c.decisionId)).toEqual(["prompt.adopt"]);
    expect(brain.trace.applied).toEqual([{ subject: { kind: "role", key: "engineer", role: "engineer", title: null }, choice: "adopt", verified: true, stamp: null }]);
    const up = h.events.ofType("strategy.updated");
    expect(up).toHaveLength(1);
    expect(up[0]!.data).toMatchObject({ subject: "role", subjectKey: "engineer", version: 1, previousVersion: null, choice: "adopt", roleTitle: "Engineer" });
    const c = h.llm.calls.find((x) => x.title === "Task C")!;
    expect(c.strategies).toEqual(["role:v1"]);
    expect(h.llm.calls.filter((x) => x.title === "Task B").every((x) => x.strategies.length === 0)).toBe(true);
    const cStart = at(h.events.events, (e) => e.type === "task.updated" && (e as Ev<"task.updated">).data.task.title === "Task C" && (e as Ev<"task.updated">).data.task.status === "running");
    expect(cStart).toBeGreaterThan(at(h.events.events, (e) => e.type === "strategy.updated"));
    const d = h.events.ofType("decision").find((e) => e.data.decision.decisionId === "prompt.adopt")!.data.decision;
    expect(d).toMatchObject({ verified: true, action: "adopt strategy v1 for the Engineer role", confidence: 0.9 });
    // the snapshot lists the brain decision with the catalog ones
    expect((await h.svc.snapshot(h.events.events[0]!.runId!)).decisions.map((x) => x.decisionId)).toContain("prompt.adopt");
  });

  test("keep: no new version, the candidate stays out of the prompt", async () => {
    const { h, brain } = await tuned("keep");
    expect(brain.trace.applied.map((a) => a.choice)).toEqual(["keep"]);
    expect(h.events.ofType("strategy.updated")).toHaveLength(0);
    expect(h.llm.calls.find((x) => x.title === "Task C")!.strategies).toEqual([]);
  });

  test("merge on top of the current version; a JEV outage falls back to the evaluation rule, stamped", async () => {
    const seed = [
      { id: "s0", subject: "role" as const, subjectKey: "engineer", role: "engineer" as const, version: 1, text: "- Old rule.", tokens: 3, status: "active" as const, choice: "adopt" as const, reason: "", decision: null, evidence: null, createdAt: 0 },
    ];
    const merged = await tuned("merge", { seed });
    const up = merged.h.events.ofType("strategy.updated")[0]!.data;
    expect(up).toMatchObject({ version: 2, previousVersion: 1, choice: "merge" });
    expect(up.text).toContain("- Old rule.");
    expect(merged.h.llm.calls.find((x) => x.title === "Task C")!.strategies).toEqual(["role:v2"]);
    const down = await tuned(null);
    expect(down.brain.trace.applied).toEqual([expect.objectContaining({ choice: "adopt", verified: false, stamp: "UNVERIFIED BY JEV" })]);
  });

  test("a candidate that would cost more than legacy is kept out by the precheck, JEV is not asked", async () => {
    const { brain, judge, h } = await tuned("adopt", { overLegacy: true });
    expect(judge.calls).toHaveLength(0);
    expect(brain.trace.applied.map((a) => a.choice)).toEqual(["keep"]);
    const d = h.events.ofType("decision").find((e) => e.data.decision.decisionId === "prompt.adopt")!.data.decision;
    expect(d.answers.precheck).toBe("over_legacy");
  });
});

describe("brain: dynamic roles", () => {
  const judgeFor = (need = "new_role", archetype = "qa") =>
    fakeJudge((id) => (id === "orch.role" ? { need: choice(need), archetype: choice(archetype) } : id === "orch.hire" ? { hire: choice("hire") } : null));

  test("the CEO asks for a specialist: JEV defines the role, one capped charter call, a tool subset, the cat is hired for it", async () => {
    const judge = judgeFor();
    const h = await harness({
      brain: { org: true },
      judge,
      script: (info) =>
        info.role === "lead"
          ? info.title === "Plan the work"
            ? plan([{ title: "Smoke check the page", spec: "Test it like a visitor", role: "qa", role_title: "Launch tester" }])
            : finish("report")
          : finish(`done by ${info.roleTitle}`),
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Ship a page" });
    await h.untilStatus(run.id, "done");
    expect(h.llm.roleCalls).toHaveLength(1);
    expect(h.llm.roleCalls[0]!.maxOutputTokens).toBe(220);
    expect(h.llm.resolved.some((r) => r.tier === "fast" && r.role === "qa")).toBe(true);
    const created = h.events.ofType("role.created");
    expect(created).toHaveLength(1);
    const role = created[0]!.data.role;
    expect(role).toMatchObject({ key: "launch-tester", title: "Launch tester", archetype: "qa", projectId: "p1", charterVersion: 1 });
    expect(role.tools).toEqual(["finish", "note", "fs_read", "fs_search", "shell_run"]);
    const snap = await h.svc.snapshot(run.id);
    const tester = snap.agents.find((a) => a.roleId === role.id)!;
    expect(tester).toMatchObject({ role: "qa", archetype: "qa", roleTitle: "Launch tester", hireReason: "The plan needs a launch tester: Smoke check the page" });
    expect(byTitle(snap.tasks, "Smoke check the page")).toMatchObject({ role: "qa", roleId: role.id, status: "done", resultSummary: "done by Launch tester" });
    expect(snap.roles!.map((r) => r.title)).toEqual(["Launch tester"]);
    const build = h.context.builds.find((b) => b.role === "qa")! as unknown as { tools: Array<{ name: string }>; roleKey: string; charter: { title: string; text: string } };
    expect(build.tools.map((t) => t.name)).toEqual(role.tools);
    expect(build.roleKey).toBe("launch-tester");
    expect(build.charter.text.startsWith("You are the Launch tester cat on a MengAI crew, a QA specialist.")).toBe(true);
    expect(h.events.ofType("decision").find((e) => e.data.decision.decisionId === "orch.role")!.data.decision).toMatchObject({ verified: true, action: "define the Launch tester role (qa)" });

    // the next run of the project reuses the role: no second JEV call, no second charter
    const again = await h.svc.create({ projectId: "p1", goal: "Ship it again" });
    await h.untilStatus(again.id, "done");
    expect(h.llm.roleCalls).toHaveLength(1);
    expect(judge.calls.filter((c) => c.decisionId === "orch.role")).toHaveLength(1);
    const planSpec = h.context.builds.filter((b) => b.runId === again.id && b.role === "lead")[0]!.task!.spec;
    expect(planSpec).toContain("Specialists this project already has: Launch tester (qa).");
    const snap2 = await h.svc.snapshot(again.id);
    expect(snap2.agents.find((a) => a.role === "qa")!.roleId).toBe(role.id);
  });

  test("JEV says an existing role fits: no new role; a base role title is never asked about", async () => {
    const judge = judgeFor("existing", "qa");
    const h = await harness({
      brain: { org: true },
      judge,
      script: (info) =>
        info.role === "lead"
          ? info.n === 0
            ? plan([
                { key: "a", title: "Test it", spec: "t", role: "qa", role_title: "Tester" },
                { key: "b", title: "Check it", spec: "c", role: "qa", role_title: "QA" },
              ])
            : finish("report")
          : finish("ok"),
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Test" });
    await h.untilStatus(run.id, "done");
    expect(h.events.ofType("role.created")).toHaveLength(0);
    expect(judge.calls.filter((c) => c.decisionId === "orch.role")).toHaveLength(1);
    const snap = await h.svc.snapshot(run.id);
    expect(snap.tasks.filter((t) => t.role === "qa").every((t) => t.roleId === null)).toBe(true);
  });

  test("at most three new roles per run (JEV orch.playbooks): the fourth specialist stays on its base role", async () => {
    const judge = judgeFor();
    const titles = ["Launch tester", "Link checker", "Copy proofer", "Load tester"];
    const h = await harness({
      brain: { org: true },
      judge,
      script: (info) =>
        info.role === "lead" ? (info.n === 0 ? plan(titles.map((t, i) => ({ key: `k${i}`, title: `Task ${i}`, spec: "s", role: "qa", role_title: t }))) : finish("report")) : finish("ok"),
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Many specialists" });
    await h.untilStatus(run.id, "done");
    expect(h.events.ofType("role.created").map((e) => e.data.role.title)).toEqual(titles.slice(0, 3));
    expect(judge.calls.filter((c) => c.decisionId === "orch.role")).toHaveLength(3);
    const capped = h.events.ofType("decision").map((e) => e.data.decision).filter((d) => d.decisionId === "orch.role" && d.answers.precheck === "role_cap");
    expect(capped).toHaveLength(1);
    expect(byTitle((await h.svc.snapshot(run.id)).tasks, "Task 3")).toMatchObject({ role: "qa", roleId: null });
  });

  test("any cat can define a role: a designer's handoff asks for a specialist", async () => {
    const judge = judgeFor("new_role", "researcher");
    const h = await harness({
      brain: { org: true },
      judge,
      script: (info) => {
        if (info.role === "lead") return info.n === 0 ? plan([{ title: "Draft copy", spec: "Copy", role: "designer" }]) : finish("report");
        if (info.role === "designer") return info.n === 0 ? call("handoff", { to_role: "researcher", role_title: "Tagline scout", title: "Find taglines", spec: "Five patterns", acceptance: ["five"] }) : finish("copy drafted");
        return finish(`found by ${info.roleTitle}`);
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Copy" });
    await h.untilStatus(run.id, "done");
    const role = h.events.ofType("role.created")[0]!.data;
    expect(role.role).toMatchObject({ title: "Tagline scout", archetype: "researcher" });
    const snap = await h.svc.snapshot(run.id);
    const designer = snap.agents.find((a) => a.role === "designer")!;
    expect(role.byAgentId).toBe(designer.id);
    const scout = snap.agents.find((a) => a.roleTitle === "Tagline scout")!;
    expect(scout).toMatchObject({ parentId: designer.id, hiredBy: designer.id, hireReason: `${designer.name} needs a tagline scout: Find taglines` });
    expect(byTitle(snap.tasks, "Find taglines").resultSummary).toBe("found by Tagline scout");
  });
});

describe("brain: the unlimited org", () => {
  const two = [
    { key: "a", title: "Engine A", spec: "A", role: "engineer" },
    { key: "b", title: "Engine B", spec: "B", role: "engineer" },
  ];
  function slowFirst() {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    return { gate, release };
  }

  test("every engineer busy and work waiting: JEV hires a second one, or the queue waits", async () => {
    for (const answer of ["hire", "wait"] as const) {
      const g = slowFirst();
      const judge = fakeJudge((id) => (id === "orch.hire" ? { hire: choice(answer) } : null));
      const lead = leadThen(two);
      const h = await harness({
        brain: { org: true },
        judge,
        script: (info) => {
          const l = lead(info);
          if (l) return l;
          if (info.title === "Engine A") return { ...finish("A done"), wait: g.gate };
          return finish("B done");
        },
      });
      const run = await h.svc.create({ projectId: "p1", goal: "Two engines" });
      await h.until(() => judge.calls.some((c) => c.decisionId === "orch.hire"), "a hire decision");
      await Bun.sleep(5);
      g.release();
      await h.untilStatus(run.id, "done");
      const snap = await h.svc.snapshot(run.id);
      const engineers = snap.agents.filter((a) => a.role === "engineer");
      if (answer === "hire") {
        expect(engineers).toHaveLength(2);
        expect(engineers[1]!.hireReason).toBe("1 engineer task is waiting and every engineer is busy");
        expect(engineers[1]!.parentId).toBe(snap.agents.find((a) => a.role === "lead")!.id);
      } else {
        expect(engineers).toHaveLength(1);
        expect(byTitle(snap.tasks, "Engine B").assigneeId).toBe(engineers[0]!.id);
      }
    }
  });

  test("maxAgents is a hard cap: no JEV call, the queue waits", async () => {
    const g = slowFirst();
    const judge = fakeJudge(() => ({ hire: choice("hire") }));
    const lead = leadThen(two);
    const h = await harness({
      brain: { org: true },
      judge,
      settings: { maxAgents: 2 },
      script: (info) => lead(info) ?? (info.title === "Engine A" ? { ...finish("A"), wait: g.gate } : finish("B")),
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Capped" });
    await h.until(async () => (await h.svc.snapshot(run.id)).tasks.some((t) => t.title === "Engine A" && t.status === "running"), "A running");
    await Bun.sleep(10);
    g.release();
    await h.untilStatus(run.id, "done");
    expect((await h.svc.snapshot(run.id)).agents).toHaveLength(2);
    expect(judge.calls).toHaveLength(0);
  });

  test("a cat hires a helper of its own role one level below itself; the owner's maxDepth stops it; JEV can say do it yourself", async () => {
    const helperScript = (info: CallInfo): Reply => {
      if (info.role === "lead") return info.n === 0 ? plan([{ title: "Big parser", spec: "Parse", role: "engineer" }]) : finish("report");
      if (info.title === "Big parser") return info.n === 0 ? call("handoff", { to_role: "engineer", title: "Split the lexer", spec: "Lexer", acceptance: ["tokens"] }) : finish("parser done");
      return finish("lexer done");
    };
    const judge = fakeJudge((id) => (id === "orch.hire" ? { hire: choice("hire") } : null));
    const h = await harness({ brain: { org: true }, judge, script: helperScript });
    const run = await h.svc.create({ projectId: "p1", goal: "Parser" });
    await h.untilStatus(run.id, "done");
    const snap = await h.svc.snapshot(run.id);
    const [lead, first, helper] = [snap.agents.find((a) => a.role === "lead")!, ...snap.agents.filter((a) => a.role === "engineer")];
    expect(first!.parentId).toBe(lead.id);
    expect(helper).toMatchObject({ parentId: first!.id, hiredBy: first!.id, hireReason: `${first!.name} hired an engineer as a helper: Split the lexer` });
    expect(byTitle(snap.tasks, "Split the lexer")).toMatchObject({ status: "done", assigneeId: helper!.id });
    expect(snap.handoffs).toHaveLength(1);

    const deep = await harness({ brain: { org: true }, judge: fakeJudge(() => ({ hire: choice("hire") })), settings: { maxDepth: 1 }, script: helperScript });
    const r2 = await deep.svc.create({ projectId: "p1", goal: "Parser" });
    await deep.untilStatus(r2.id, "done");
    const s2 = await deep.svc.snapshot(r2.id);
    expect(s2.agents.filter((a) => a.role === "engineer")).toHaveLength(1);
    expect(s2.handoffs).toHaveLength(0);
    const out = deep.context.builds.filter((b) => b.role === "engineer")[1]!.steps[0]!.results[0]!.output;
    expect(out).toBe("Do this part yourself: the company is not hiring for it (self: the org is at its depth limit (1)).");

    const self = await harness({ brain: { org: true }, judge: fakeJudge(() => ({ hire: choice("self") })), script: helperScript });
    const r3 = await self.svc.create({ projectId: "p1", goal: "Parser" });
    await self.untilStatus(r3.id, "done");
    expect((await self.svc.snapshot(r3.id)).handoffs).toHaveLength(0);
    expect(self.context.builds.filter((b) => b.role === "engineer")[1]!.steps[0]!.results[0]!.output).toStartWith("Do this part yourself:");
  });
});

describe("brain: letting a cat go", () => {
  const checks = [
    { key: "a", title: "Check A", spec: "A", role: "security" },
    { key: "b", title: "Check B", spec: "B", role: "security" },
    { key: "c", title: "Check C", spec: "C", role: "security" },
  ];

  test("three failures in a row: JEV lets it go, its failed checks go back on the board, a replacement redoes them", async () => {
    const judge = fakeJudge((id) => (id === "orch.let_go" ? { decision: choice("let_go") } : id === "orch.hire" ? { hire: choice("wait") } : null));
    const lead = leadThen(checks);
    let first: string | null = null;
    const h = await harness({
      brain: { org: true },
      judge,
      settings: { maxConcurrentAgents: 1 },
      script: (info) => {
        const l = lead(info);
        if (l) return l;
        return info.n < 3 ? blocked("No lockfile") : finish(`${info.title} passed`);
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Three checks" });
    await h.untilStatus(run.id, "done");
    const snap = await h.svc.snapshot(run.id);
    expect(snap.departed).toHaveLength(1);
    const gone = snap.departed![0]!;
    first = gone.id;
    expect(gone).toMatchObject({ role: "security", status: "stopped", leftReason: "Let go after 3 failures in a row. Last: blocked on Check C" });
    const left = h.events.ofType("agent.left");
    expect(left).toHaveLength(1);
    expect(left[0]!.agentId).toBe(first);
    expect(new Set(left[0]!.data.requeued)).toEqual(new Set(["Check A", "Check B", "Check C"].map((t) => byTitle(snap.tasks, t).id)));
    const replacement = snap.agents.find((a) => a.role === "security")!;
    expect(replacement.id).not.toBe(first);
    expect(replacement.hireReason).toStartWith(`Replaces ${gone.name}`);
    for (const t of ["Check A", "Check B", "Check C"]) expect(byTitle(snap.tasks, t)).toMatchObject({ status: "done", assigneeId: replacement.id });
    const lead0 = snap.agents.find((a) => a.role === "lead")!;
    expect(h.events.ofType("agent.say").some((e) => e.agentId === lead0.id && e.data.to === first && e.data.text.startsWith(`${gone.name}, thank you for your work here.`))).toBe(true);
    expect(judge.calls.filter((c) => c.decisionId === "orch.let_go")).toHaveLength(1);
    expect(snap.agents.some((a) => a.id === first)).toBe(false);
  });

  test("coach: the cat gets a strategy of its own on its next task and stays", async () => {
    const brain = fakeBrain({ tuneAfter: 99 });
    const judge = fakeJudge((id) => (id === "orch.let_go" ? { decision: choice("coach") } : id === "prompt.adopt" ? { adopt: choice("adopt") } : { hire: choice("wait") }));
    const lead = leadThen([...checks, { key: "d", title: "Check D", spec: "D", role: "security" }]);
    const h = await harness({
      brain: { org: true, tuning: true },
      brainMemory: brain,
      judge,
      settings: { maxConcurrentAgents: 1 },
      script: (info) => lead(info) ?? (info.n < 3 ? blocked("No lockfile") : finish("passed")),
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Coach" });
    await h.untilStatus(run.id, "done");
    const snap = await h.svc.snapshot(run.id);
    expect(snap.departed ?? []).toHaveLength(0);
    const cat = snap.agents.find((a) => a.role === "security")!;
    const up = h.events.ofType("strategy.updated");
    expect(up.map((e) => [e.data.subject, e.data.subjectKey])).toEqual([["agent", cat.id]]);
    expect(brain.trace.proposals[0]!.causes.length).toBe(3);
    expect(h.llm.calls.find((c) => c.title === "Check D")!.strategies).toEqual(["agent:v1"]);
    // the mind shows the cat's own addendum and the decisions about it
    const mind = await h.svc.mind(run.id, cat.id);
    expect(mind.addenda.map((a) => [a.subject, a.version])).toEqual([["agent", 1]]);
    expect(mind.layerVersion).toBe("c1.a1");
    expect(mind.decisions.map((d) => d.decisionId)).toEqual(expect.arrayContaining(["orch.let_go", "prompt.adopt"]));
  });

  test("keep: nobody leaves; the question is asked again only after another failure", async () => {
    const judge = fakeJudge((id) => (id === "orch.let_go" ? { decision: choice("keep") } : { hire: choice("wait") }));
    const lead = leadThen([...checks, { key: "d", title: "Check D", spec: "D", role: "security" }]);
    const h = await harness({ brain: { org: true }, judge, settings: { maxConcurrentAgents: 1 }, script: (info) => lead(info) ?? blocked("stuck") });
    const run = await h.svc.create({ projectId: "p1", goal: "Keep" });
    await h.untilStatus(run.id, "done");
    expect(judge.calls.filter((c) => c.decisionId === "orch.let_go")).toHaveLength(2);
    expect(h.events.ofType("agent.left")).toHaveLength(0);
  });
});

describe("brain: the CEO's name, the tracker, the mind API, unlimited budgets", () => {
  test("the CEO takes the owner's ceoName", async () => {
    const h = await harness({ settings: { ceoName: "Mas Oyen" }, script: (info) => (info.role === "lead" ? finish("trivial") : finish("x")) });
    const run = await h.svc.create({ projectId: "p1", goal: "Trivial" });
    await h.untilStatus(run.id, "done");
    expect((await h.svc.snapshot(run.id)).agents[0]!.name).toBe("Mas Oyen");
  });

  test("run.stage walks the tracker and loops back on a failed review", async () => {
    const h = await harness({
      script: {
        lead: [plan([{ key: "b", title: "Build", spec: "b", role: "engineer", review: true }, { key: "t", title: "Test", spec: "t", role: "qa", deps: ["b"] }]), finish("report")],
        engineer: [finish("built"), finish("fixed")],
        reviewer: [call("submit_review", { verdict: "fail", notes: ["Missing tests"] }), call("submit_review", { verdict: "pass", notes: ["ok"] })],
        qa: [finish("tested")],
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Build and test" });
    await h.untilStatus(run.id, "done");
    const stages = h.events.ofType("run.stage").map((e) => [e.data.previous, e.data.stage]);
    expect(stages).toEqual([
      [null, "goal"],
      ["goal", "planned"],
      ["planned", "hired"],
      ["hired", "working"],
      ["working", "review"],
      ["review", "working"],
      ["working", "review"],
      ["review", "testing"],
      ["testing", "shipped"],
    ]);
    expect((await h.svc.snapshot(run.id)).stage).toBe("shipped");
    // run.created, the CEO, the plan task come first; the goal stage follows
    expect(h.events.events.slice(0, 4).map((e) => e.type)).toEqual(["run.created", "agent.spawned", "task.created", "run.stage"]);
  });

  test("GET .../agents/:agentId/mind: charter, lessons with their reason, redacted; 404 and 422", async () => {
    const secret = "sk-" + "c".repeat(40);
    const lesson: LessonDTO = { id: "l1", scope: "project", role: "engineer", projectId: "p1", text: `Run bun test first. Token ${secret}`, tags: [], status: "active", uses: 4, wins: 3, losses: 1, score: 0.67, createdAt: 0, lastUsedAt: null };
    const h = await harness({ script: { lead: [plan([{ title: "Build", spec: "b", role: "engineer" }]), finish("report")], engineer: [finish("built")] } });
    h.memory.retrieve = async () => [lesson];
    const run = await h.svc.create({ projectId: "p1", goal: "Build" });
    await h.untilStatus(run.id, "done");
    const eng = (await h.svc.snapshot(run.id)).agents.find((a) => a.role === "engineer")!;
    const app = new Hono();
    app.onError(jsonErrorHandler(silentLogger));
    app.route("/api/runs", h.mod.routes!);
    const res = await app.request(`/api/runs/${run.id}/agents/${eng.id}/mind`);
    expect(res.status).toBe(200);
    const mind = (await res.json()) as import("@mengai/shared").AgentMindDTO;
    expect(mind).toMatchObject({ runId: run.id, agentId: eng.id, name: eng.name, role: "engineer", roleTitle: "Engineer", roleId: null, layerVersion: "" });
    expect(mind.charter).toMatchObject({ version: 1, title: "Engineer", dynamic: false, text: "charter for engineer" });
    expect(mind.lessons).toEqual([{ id: "l1", text: expect.stringContaining("Run bun test first."), reason: "A lesson from this project that matches this task, 3 of 4 uses went well." }]);
    expect(JSON.stringify(mind)).not.toContain(secret);
    expect(mind.addenda).toEqual([]);
    expect((await app.request(`/api/runs/${run.id}/agents/nope/mind`)).status).toBe(404);
    expect((await app.request(`/api/runs/${run.id}/agents/bad%20id!/mind`)).status).toBe(422);
    expect((await app.request(`/api/runs/missing/agents/${eng.id}/mind`)).status).toBe(404);
  });

  test("a budget of 0 is unlimited: routes accept it and the run never pauses for budget", async () => {
    const h = await harness({ script: { lead: [plan([{ title: "Build", spec: "b", role: "engineer" }]), finish("report")], engineer: [{ ...finish("built"), usage: { inputTokens: 5_000_000, outputTokens: 1_000_000 } }] } });
    const app = new Hono();
    app.onError(jsonErrorHandler(silentLogger));
    app.route("/api/runs", h.mod.routes!);
    const res = await app.request("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "p1", goal: "Unlimited", budgetTokens: 0, budgetUsd: 0 }) });
    expect(res.status).toBe(201);
    const run = (await res.json()) as { id: string; budgetTokens: number; budgetUsd: number };
    expect([run.budgetTokens, run.budgetUsd]).toEqual([0, 0]);
    await h.untilStatus(run.id, "done");
    expect(h.events.ofType("run.status").some((e) => e.data.reason === "budget")).toBe(false);
    const bad = await app.request("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "p1", goal: "Tiny", budgetTokens: 500 }) });
    expect(bad.status).toBe(422);
  });
});
