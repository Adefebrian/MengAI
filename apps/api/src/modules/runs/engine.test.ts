import { describe, expect, test } from "bun:test";
import type { MengaiEvent, TaskDTO } from "@mengai/shared";
import { LlmError } from "../../core/ports";
import { createTestDb, fakeClock } from "../../testing";
import { deferred, fakeDecisions, fakeTools, harness } from "./testkit";

const byTitle = (tasks: TaskDTO[], title: string) => tasks.find((t) => t.title === title)!;
const idx = (events: MengaiEvent[], pred: (e: MengaiEvent) => boolean) => events.findIndex(pred);

describe("runs engine: full scenario", () => {
  test("plan -> two tasks with a dependency -> handoff -> review fail -> fix -> done", async () => {
    const h = await harness({
      script: {
        lead: [
          {
            text: "Planning the crew.",
            calls: [
              {
                name: "create_tasks",
                args: {
                  tasks: [
                    { key: "build", title: "Build feature", spec: "Implement it", acceptance: ["works"], role: "engineer", review: true },
                    { key: "test", title: "Test feature", spec: "Test it", role: "qa", deps: ["build"] },
                  ],
                },
              },
            ],
          },
          { calls: [{ name: "finish", args: { summary: "Planned build and test" } }] },
          { calls: [{ name: "finish", args: { summary: "Final: feature built, reviewed and tested" } }] },
        ],
        engineer: [
          {
            calls: [
              { name: "fs_write", args: { path: "a.ts", content: "export const a = 1;" } },
              { name: "handoff", args: { to_role: "designer", title: "Make icon", spec: "Draw a 64px icon", summary: "Need an icon for the feature" } },
            ],
          },
          { calls: [{ name: "finish", args: { summary: "Feature built" } }] },
          { calls: [{ name: "finish", args: { summary: "Added the missing tests" } }] },
        ],
        designer: [{ calls: [{ name: "finish", args: { summary: "Icon at assets/icon.png" } }] }],
        reviewer: [
          { calls: [{ name: "submit_review", args: { verdict: "fail", notes: ["Missing tests"] } }] },
          { calls: [{ name: "submit_review", args: { verdict: "pass", notes: ["Looks good"] } }] },
        ],
        qa: [{ calls: [{ name: "finish", args: { summary: "Tests pass" } }] }],
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Ship the feature with an icon" });
    expect(run.status).toBe("running");
    expect(run.budgetTokens).toBe(400_000);
    await h.untilStatus(run.id, "done");

    const snap = await h.svc.snapshot(run.id);
    const tasks = snap.tasks;
    expect(tasks.map((t) => t.title)).toEqual([
      "Plan the work",
      "Build feature",
      "Test feature",
      "Make icon",
      "Review: Build feature",
      "Fix: Build feature",
      "Review: Build feature",
      "Final report",
    ]);
    expect(tasks.every((t) => t.status === "done")).toBe(true);
    const build = byTitle(tasks, "Build feature");
    const test_ = byTitle(tasks, "Test feature");
    expect(test_.deps).toEqual([build.id]);
    expect(build.resultSummary).toContain("Review passed (round 2)");
    const fix = byTitle(tasks, "Fix: Build feature");
    expect(fix.assigneeId).toBe(build.assigneeId);
    expect(fix.spec).toContain("Missing tests");
    const icon = byTitle(tasks, "Make icon");
    expect(icon.parentId).toBe(build.id);
    expect(icon.role).toBe("designer");

    // agents: one per role, the lead is Kopi
    expect(snap.agents.map((a) => a.role).sort()).toEqual(["designer", "engineer", "lead", "qa", "reviewer"]);
    expect(snap.agents.find((a) => a.role === "lead")!.name).toBe("Kopi");
    expect(new Set(snap.agents.map((a) => a.name)).size).toBe(snap.agents.length);
    expect(snap.agents.every((a) => a.status === "done")).toBe(true);

    // handoff persisted with its target agent
    expect(snap.handoffs).toHaveLength(1);
    const designer = snap.agents.find((a) => a.role === "designer")!;
    expect(snap.handoffs[0]!.toAgentId).toBe(designer.id);
    expect(snap.handoffs[0]!.summary).toBe("Need an icon for the feature");

    // usage totals and progress: 10 chat calls x (100 in, 10 out)
    expect(h.llm.calls).toHaveLength(10);
    expect(snap.run.usage.inputTokens).toBe(1000);
    expect(snap.run.usage.outputTokens).toBe(100);
    expect(snap.run.usage.calls).toBe(10);
    expect(snap.run.usage.costUsd).toBeCloseTo(0.0012, 10);
    expect(snap.run.progress).toBe(1);
    const agentSum = snap.agents.reduce((s, a) => s + a.usage.inputTokens, 0);
    expect(agentSum).toBe(1000);
    const lastUsage = h.events.ofType("run.usage").at(-1)!;
    expect(lastUsage.data.progress).toBe(1);
    expect(lastUsage.data.usage.calls).toBe(10);

    // events order
    const ev = h.events.events;
    expect(ev.slice(0, 3).map((e) => e.type)).toEqual(["run.created", "agent.spawned", "task.created"]);
    const handoffAt = idx(ev, (e) => e.type === "handoff");
    const designerSpawn = idx(ev, (e) => e.type === "agent.spawned" && (e as MengaiEvent<"agent.spawned">).data.agent.role === "designer");
    expect(handoffAt).toBeGreaterThan(0);
    expect(designerSpawn).toBeGreaterThan(handoffAt);
    const toReview = idx(ev, (e) => e.type === "task.updated" && (e as MengaiEvent<"task.updated">).data.task.id === build.id && (e as MengaiEvent<"task.updated">).data.task.status === "review");
    const reviewCreated = idx(ev, (e) => e.type === "task.created" && (e as MengaiEvent<"task.created">).data.task.title === "Review: Build feature");
    const fixCreated = idx(ev, (e) => e.type === "task.created" && (e as MengaiEvent<"task.created">).data.task.title === "Fix: Build feature");
    const testReady = idx(ev, (e) => e.type === "task.updated" && (e as MengaiEvent<"task.updated">).data.task.id === test_.id && (e as MengaiEvent<"task.updated">).data.task.status === "ready");
    const buildDone = idx(ev, (e) => e.type === "task.updated" && (e as MengaiEvent<"task.updated">).data.task.id === build.id && (e as MengaiEvent<"task.updated">).data.task.status === "done");
    expect(toReview).toBeGreaterThan(handoffAt);
    expect(reviewCreated).toBeGreaterThan(toReview);
    expect(fixCreated).toBeGreaterThan(reviewCreated);
    expect(buildDone).toBeGreaterThan(fixCreated);
    expect(testReady).toBeGreaterThan(buildDone);
    expect(ev.at(-1)!.type).toBe("run.status");
    expect((ev.at(-1) as MengaiEvent<"run.status">).data.status).toBe("done");

    // tool calls: activity on tool.call, details persisted for toolCall()
    const writeCall = h.events.ofType("tool.call").find((e) => e.data.tool === "fs_write")!;
    expect(writeCall.data.activity).toBe("code");
    const detail = await h.svc.toolCall(run.id, writeCall.data.callId);
    expect(detail.tool).toBe("fs_write");
    expect(detail.args).toEqual({ path: "a.ts", content: "export const a = 1;" });
    expect(detail.output).toBe("ok fs_write");
    expect(h.tools.executed.map((x) => x.call.name)).toEqual(["fs_write"]);
    expect(h.tools.executed[0]!.ctx.root).toBe("/tmp/ws-p1");

    // x-ray snapshot per agent
    const lead = snap.agents.find((a) => a.role === "lead")!;
    const xray = await h.svc.xray(run.id, lead.id);
    expect(xray.agentId).toBe(lead.id);
    expect(xray.layers.length).toBeGreaterThan(0);

    // mood: the engineer turned proud after the review passed
    const engineer = snap.agents.find((a) => a.role === "engineer")!;
    const moods = h.events.ofType("agent.status").filter((e) => e.agentId === engineer.id).map((e) => e.data.mood);
    expect(moods).toContain("proud");

    // context got the dependency summary and the handoff summary
    const qaBuild = h.context.builds.find((b) => b.role === "qa")!;
    expect(qaBuild.task!.depSummaries[0]).toContain("Build feature [done]");
    const designerBuild = h.context.builds.find((b) => b.role === "designer")!;
    expect(designerBuild.task!.handoff).toBe("Need an icon for the feature");
    expect(qaBuild.brief.workspaceDigest).toBe("src/ (2 files)");

    // learning on done
    expect(h.memory.log.digests).toHaveLength(1);
    expect(h.memory.log.digests[0]!.text).toContain("Final: feature built");
    expect(h.memory.log.outcomes).toHaveLength(8);
    expect(h.memory.log.reflections.map((r) => r.taskTitle)).toEqual(["Build feature"]);
    expect(h.memory.log.reflections[0]!.notes).toContain("Missing tests");
    expect(h.memory.log.promoted).toBe(1);
    expect(h.projects.touched).toEqual([run.id]);
    expect(h.decisions.log.modelTier).toBe(5);
  });
});

describe("runs engine: guards", () => {
  const oneTask = (extra: Record<string, unknown> = {}) => ({
    calls: [{ name: "create_tasks", args: { tasks: [{ title: "Do it", spec: "work", role: "engineer", ...extra }] } }, { name: "finish", args: { summary: "planned" } }],
  });

  test("step cap fails the task after 24 steps", async () => {
    const h = await harness({
      script: (info) => {
        if (info.role === "lead") return info.n === 0 ? oneTask() : { calls: [{ name: "finish", args: { summary: "report" } }] };
        return { calls: [{ name: "fs_read", args: { path: `f${info.n}.ts` } }] };
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Loop forever please" });
    await h.untilStatus(run.id, "done");
    const snap = await h.svc.snapshot(run.id);
    const t = byTitle(snap.tasks, "Do it");
    expect(t.status).toBe("failed");
    expect(t.resultSummary).toContain("step limit reached (24 steps)");
    expect(h.llm.calls.filter((c) => c.role === "engineer")).toHaveLength(24);
    expect(snap.run.statusReason).toBe("1 task failed or blocked");
    expect(h.memory.log.reflections.map((r) => r.taskTitle)).toEqual(["Do it"]);
  });

  test("the same tool call 3 times trips the guard before the third runs", async () => {
    const h = await harness({
      script: (info) => {
        if (info.role === "lead") return info.n === 0 ? oneTask() : { calls: [{ name: "finish", args: { summary: "report" } }] };
        return { calls: [{ name: "fs_read", args: { path: "same.ts" } }] };
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Read the same file" });
    await h.untilStatus(run.id, "done");
    const t = byTitle((await h.svc.snapshot(run.id)).tasks, "Do it");
    expect(t.status).toBe("failed");
    expect(t.resultSummary).toContain("repeated 3 times");
    expect(h.tools.executed.filter((x) => x.call.name === "fs_read")).toHaveLength(2);
  });

  test("the same error 3 times trips the guard", async () => {
    const tools = fakeTools((call) => ({ output: "ENOENT: no such file", ok: false, durationMs: 1 }));
    const h = await harness({
      tools,
      script: (info) => {
        if (info.role === "lead") return info.n === 0 ? oneTask() : { calls: [{ name: "finish", args: { summary: "report" } }] };
        return { calls: [{ name: "shell_run", args: { command: `cat f${info.n}` } }] };
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Fail the same way" });
    await h.untilStatus(run.id, "done");
    const t = byTitle((await h.svc.snapshot(run.id)).tasks, "Do it");
    expect(t.status).toBe("failed");
    expect(t.resultSummary).toContain("the same shell_run error happened 3 times");
    expect(tools.executed).toHaveLength(3);
  });

  test("three replies without a tool call fail the task", async () => {
    const h = await harness({
      script: (info) => {
        if (info.role === "lead") return info.n === 0 ? oneTask() : { calls: [{ name: "finish", args: { summary: "report" } }] };
        return { text: "I am thinking about it." };
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Chat without tools" });
    await h.untilStatus(run.id, "done");
    const t = byTitle((await h.svc.snapshot(run.id)).tasks, "Do it");
    expect(t.resultSummary).toContain("no progress");
    const engineerBuilds = h.context.builds.filter((b) => b.role === "engineer");
    expect(engineerBuilds[1]!.task!.notes.some((n) => n.startsWith("System: reply with a tool call"))).toBe(true);
    expect(h.events.ofType("agent.say").some((e) => e.data.text === "I am thinking about it.")).toBe(true);
  });

  test("15 minutes of work on one task fails it", async () => {
    const clock = fakeClock();
    const h = await harness({
      clock,
      script: (info) => {
        if (info.role === "lead") return info.n === 0 ? oneTask() : { calls: [{ name: "finish", args: { summary: "report" } }] };
        return { calls: [{ name: "fs_read", args: { path: `slow${info.n}.ts` } }], before: () => clock.advance(16 * 60_000) };
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Take too long" });
    await h.untilStatus(run.id, "done");
    const t = byTitle((await h.svc.snapshot(run.id)).tasks, "Do it");
    expect(t.resultSummary).toContain("time limit reached");
    expect(h.llm.calls.filter((c) => c.role === "engineer")).toHaveLength(1);
  });

  test("token budget pauses with reason budget; resume needs a higher budget", async () => {
    const h = await harness({
      script: {
        lead: [
          { calls: [{ name: "note", args: { text: "counting" } }], usage: { inputTokens: 1100, outputTokens: 50 } },
          { calls: [{ name: "finish", args: { summary: "done within the new budget" } }] },
        ],
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Spend tokens", budgetTokens: 1000 });
    await h.untilStatus(run.id, "paused");
    let snap = await h.svc.snapshot(run.id);
    expect(snap.run.statusReason).toBe("budget");
    // the in-flight step finished (the note ran), then the loop parked at the checkpoint
    expect(h.events.ofType("tool.result").map((e) => e.data.tool)).toEqual(["note"]);
    await h.until(() => h.events.ofType("agent.status").some((e) => e.data.statusText === "Paused"), "agent parked");
    expect(h.llm.calls).toHaveLength(1);
    await expect(h.svc.resume(run.id)).rejects.toMatchObject({ status: 409, code: "budget_exhausted" });
    const raised = await h.svc.setBudget(run.id, { budgetTokens: 50_000 });
    expect(raised.budgetTokens).toBe(50_000);
    await h.svc.resume(run.id);
    await h.untilStatus(run.id, "done");
    snap = await h.svc.snapshot(run.id);
    expect(h.llm.calls).toHaveLength(2);
    expect(snap.run.usage.inputTokens).toBe(1200);
  });

  test("USD budget pauses too", async () => {
    const h = await harness({
      script: { lead: [{ calls: [{ name: "note", args: { text: "x" } }], usage: { inputTokens: 20_000, outputTokens: 0 } }] },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Spend dollars", budgetUsd: 0.01 });
    await h.untilStatus(run.id, "paused");
    expect((await h.svc.snapshot(run.id)).run.statusReason).toBe("budget");
    await h.svc.stop(run.id);
  });

  test("an auth error from the provider stops the run with a clear reason", async () => {
    const h = await harness({ script: { lead: [{ error: new LlmError("auth", "invalid api key", 401) }] } });
    const run = await h.svc.create({ projectId: "p1", goal: "Use a bad key" });
    await h.untilStatus(run.id, "stopped");
    const snap = await h.svc.snapshot(run.id);
    expect(snap.run.statusReason).toContain("auth");
    expect(snap.run.statusReason).toContain("invalid api key");
    expect(snap.agents.every((a) => a.status === "stopped")).toBe(true);
    expect(snap.tasks.every((t) => t.status === "cancelled")).toBe(true);
    expect(h.usage.calls.some((c) => !c.ok)).toBe(true);
  });

  test("a transient provider error pauses the run and the step retries on resume", async () => {
    const h = await harness({
      script: {
        lead: [{ error: new LlmError("overloaded", "busy", 529) }, { calls: [{ name: "finish", args: { summary: "ok now" } }] }],
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Survive an outage" });
    await h.untilStatus(run.id, "paused");
    expect((await h.svc.snapshot(run.id)).run.statusReason).toContain("provider: overloaded 529");
    await h.svc.resume(run.id);
    await h.untilStatus(run.id, "done");
    expect(h.llm.calls).toHaveLength(2);
  });
});

describe("runs engine: control", () => {
  test("pause lets the in-flight step finish, then resume continues", async () => {
    const gate = deferred();
    const h = await harness({
      script: {
        lead: [{ calls: [{ name: "note", args: { text: "halfway" } }], wait: gate.promise }, { calls: [{ name: "finish", args: { summary: "resumed and done" } }] }],
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Pause me in the middle" });
    await h.until(() => h.llm.calls.length === 1, "first call in flight");
    const paused = await h.svc.pause(run.id);
    expect(paused.status).toBe("paused");
    await expect(h.svc.pause(run.id)).rejects.toMatchObject({ status: 409 });
    gate.resolve();
    await h.until(() => h.events.ofType("agent.status").some((e) => e.data.statusText === "Paused"), "agent parked");
    expect(h.events.ofType("tool.result").map((e) => e.data.tool)).toEqual(["note"]);
    expect(h.llm.calls).toHaveLength(1);
    const resumed = await h.svc.resume(run.id);
    expect(resumed.status).toBe("running");
    await h.untilStatus(run.id, "done");
    expect(h.llm.calls).toHaveLength(2);
    const statuses = h.events.ofType("run.status").map((e) => e.data.status);
    expect(statuses).toEqual(["paused", "running", "done"]);
    await expect(h.svc.resume(run.id)).rejects.toMatchObject({ status: 409 });
  });

  test("stop aborts in-flight calls and marks agents stopped", async () => {
    const h = await harness({ script: { lead: [{ hang: true }] } });
    const run = await h.svc.create({ projectId: "p1", goal: "Hang until stopped" });
    await h.until(() => h.llm.calls.length === 1, "call in flight");
    const stopped = await h.svc.stop(run.id);
    expect(stopped.status).toBe("stopped");
    expect(stopped.statusReason).toBe("user");
    expect(h.llm.signals[0]!.aborted).toBe(true);
    const snap = await h.svc.snapshot(run.id);
    expect(snap.agents.map((a) => a.status)).toEqual(["stopped"]);
    expect(snap.tasks.map((t) => t.status)).toEqual(["cancelled"]);
    expect(h.events.ofType("run.status").map((e) => e.data.status)).toEqual(["stopping", "stopped"]);
    // idempotent, and later control calls conflict
    expect((await h.svc.stop(run.id)).status).toBe("stopped");
    await expect(h.svc.message(run.id, { text: "hello" })).rejects.toMatchObject({ status: 409 });
  });

  test("the kill switch stops every live run", async () => {
    const h = await harness({ script: { lead: [{ hang: true }, { hang: true }] } });
    const a = await h.svc.create({ projectId: "p1", goal: "First hanging run" });
    const b = await h.svc.create({ projectId: "p2", goal: "Second hanging run" });
    await h.until(() => h.llm.calls.length === 2, "both in flight");
    const res = await h.killswitch.trigger("user");
    expect(res.stoppedRuns).toBe(2);
    expect((await h.svc.snapshot(a.id)).run.status).toBe("stopped");
    expect((await h.svc.snapshot(b.id)).run.statusReason).toBe("killswitch");
  });

  test("ask_human waits for message() and gets the reply as the tool result", async () => {
    const h = await harness({
      script: {
        lead: [
          { calls: [{ name: "ask_human", args: { question: "Which color?" } }] },
          { calls: [{ name: "finish", args: { summary: "Using blue" } }] },
        ],
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Ask the human" });
    await h.until(() => h.events.ofType("agent.status").some((e) => e.data.status === "approval"), "approval");
    const say = h.events.ofType("agent.say").find((e) => e.data.to === "human")!;
    expect(say.data.text).toBe("Which color?");
    const waiting = (await h.svc.snapshot(run.id)).tasks[0]!;
    expect(waiting.status).toBe("waiting");
    await h.svc.message(run.id, { text: "Blue please" });
    await h.untilStatus(run.id, "done");
    const second = h.context.builds.filter((b) => b.role === "lead")[1]!;
    expect(second.steps[0]!.results[0]!.output).toBe("The human replied: Blue please");
  });

  test("message() adds a human note to the lead's current task", async () => {
    const gate = deferred();
    const h = await harness({
      script: {
        lead: [{ calls: [{ name: "note", args: { text: "working" } }], wait: gate.promise }, { calls: [{ name: "finish", args: { summary: "noted" } }] }],
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Take a note" });
    await h.until(() => h.llm.calls.length === 1, "in flight");
    await h.svc.message(run.id, { text: "Please also add docs" });
    gate.resolve();
    await h.untilStatus(run.id, "done");
    const second = h.context.builds.filter((b) => b.role === "lead")[1]!;
    expect(second.task!.notes).toContain("Human: Please also add docs");
  });

  test("patchTask cancels a queued task and its dependents stay unblocked", async () => {
    const gate = deferred();
    const h = await harness({
      script: (info) => {
        if (info.role === "lead") {
          if (info.n === 0)
            return {
              calls: [
                {
                  name: "create_tasks",
                  args: {
                    tasks: [
                      { key: "a", title: "Slow work", spec: "x", role: "engineer" },
                      { key: "b", title: "After slow", spec: "y", role: "qa", deps: ["a"] },
                    ],
                  },
                },
                { name: "finish", args: { summary: "planned" } },
              ],
            };
          return { calls: [{ name: "finish", args: { summary: "report" } }] };
        }
        if (info.role === "engineer") return { wait: gate.promise, calls: [{ name: "finish", args: { summary: "never" } }] };
        return { calls: [{ name: "finish", args: { summary: "qa done" } }] };
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Cancel the slow task" });
    await h.until(() => h.llm.calls.some((c) => c.role === "engineer"), "engineer running");
    const slow = byTitle((await h.svc.snapshot(run.id)).tasks, "Slow work");
    const cancelled = await h.svc.patchTask(run.id, slow.id, { status: "cancelled" });
    expect(cancelled.status).toBe("cancelled");
    expect(h.llm.signals.at(-1)!.aborted).toBe(true);
    await h.untilStatus(run.id, "done");
    const tasks = (await h.svc.snapshot(run.id)).tasks;
    expect(byTitle(tasks, "Slow work").status).toBe("cancelled");
    expect(byTitle(tasks, "After slow").status).toBe("done");
    await expect(h.svc.patchTask(run.id, slow.id, { priority: 3 })).rejects.toMatchObject({ status: 409 });
  });

  test("stopAgent aborts the agent and requeues its task for a new agent", async () => {
    const h = await harness({
      script: (info) => {
        if (info.role === "lead") {
          if (info.n === 0) return { calls: [{ name: "create_tasks", args: { tasks: [{ title: "Work", spec: "x", role: "engineer" }] } }, { name: "finish", args: { summary: "planned" } }] };
          return { calls: [{ name: "finish", args: { summary: "report" } }] };
        }
        return info.n === 0 ? { hang: true } : { calls: [{ name: "finish", args: { summary: "second engineer did it" } }] };
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Replace a cat" });
    await h.until(() => h.llm.calls.some((c) => c.role === "engineer"), "engineer running");
    const first = (await h.svc.snapshot(run.id)).agents.find((a) => a.role === "engineer")!;
    const stopped = await h.svc.stopAgent(run.id, first.id);
    expect(stopped.status).toBe("stopped");
    await h.untilStatus(run.id, "done");
    const snap = await h.svc.snapshot(run.id);
    const engineers = snap.agents.filter((a) => a.role === "engineer");
    expect(engineers).toHaveLength(2);
    expect(byTitle(snap.tasks, "Work").assigneeId).toBe(engineers[1]!.id);
    expect(byTitle(snap.tasks, "Work").status).toBe("done");
  });

  test("boot recovery pauses running runs with reason restart; resume rebuilds and finishes", async () => {
    const db = await createTestDb();
    const first = await harness({ db, script: { lead: [{ hang: true }] } });
    const run = await first.svc.create({ projectId: "p1", goal: "Survive a restart" });
    await first.until(() => first.llm.calls.length === 1, "in flight");
    await first.mod.close!();

    const second = await harness({ db, script: { lead: [{ calls: [{ name: "finish", args: { summary: "finished after restart" } }] }] } });
    let snap = await second.svc.snapshot(run.id);
    expect(snap.run.status).toBe("paused");
    expect(snap.run.statusReason).toBe("restart");
    await second.svc.resume(run.id);
    await second.untilStatus(run.id, "done");
    snap = await second.svc.snapshot(run.id);
    expect(snap.tasks[0]!.status).toBe("done");
    expect(snap.tasks[0]!.attempts).toBe(2);
    expect(snap.agents).toHaveLength(1);
  });
});

describe("runs engine: more control paths", () => {
  test("a message while the lead is idle becomes a lead task", async () => {
    const gate = deferred();
    const h = await harness({
      script: (info) => {
        if (info.role === "lead") {
          if (info.n === 0) return { calls: [{ name: "create_tasks", args: { tasks: [{ title: "Long work", spec: "x", role: "engineer" }] } }, { name: "finish", args: { summary: "planned" } }] };
          return { calls: [{ name: "finish", args: { summary: `lead reply ${info.title}` } }] };
        }
        return { wait: gate.promise, calls: [{ name: "finish", args: { summary: "long work done" } }] };
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Talk to an idle lead" });
    await h.until(async () => (await h.svc.snapshot(run.id)).tasks[0]!.status === "done", "plan done");
    await h.until(() => h.llm.calls.some((c) => c.role === "engineer"), "engineer busy");
    await h.svc.message(run.id, { text: "Also update the README" });
    await h.until(async () => (await h.svc.snapshot(run.id)).tasks.some((t) => t.title === "Human message" && t.status === "done"), "human task done");
    const humanTask = (await h.svc.snapshot(run.id)).tasks.find((t) => t.title === "Human message")!;
    expect(humanTask.role).toBe("lead");
    expect(humanTask.spec).toContain("Also update the README");
    gate.resolve();
    await h.untilStatus(run.id, "done");
    const titles = (await h.svc.snapshot(run.id)).tasks.map((t) => t.title);
    expect(titles).toEqual(["Plan the work", "Long work", "Human message", "Final report"]);
  });

  test("patchTask requeues a failed task and its blocked dependents come back", async () => {
    let fail = true;
    const h = await harness({
      script: (info) => {
        if (info.role === "lead") {
          if (info.n === 0)
            return {
              calls: [
                { name: "create_tasks", args: { tasks: [{ key: "a", title: "Flaky", spec: "x", role: "engineer" }, { key: "b", title: "Next", spec: "y", role: "qa", deps: ["a"] }] } },
                { name: "finish", args: { summary: "planned" } },
              ],
            };
          return { calls: [{ name: "ask_human", args: { question: `report ${info.n}?` } }] };
        }
        if (info.role === "engineer") return fail ? { text: "hmm" } : { calls: [{ name: "finish", args: { summary: "fixed" } }] };
        return { calls: [{ name: "finish", args: { summary: "next done" } }] };
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Retry a failed task" });
    // the final report waits on the human, so the run stays open while we requeue
    await h.until(async () => (await h.svc.snapshot(run.id)).tasks.some((t) => t.title === "Final report" && t.status === "waiting"), "final report waiting");
    let tasks = (await h.svc.snapshot(run.id)).tasks;
    expect(byTitle(tasks, "Flaky").status).toBe("failed");
    expect(byTitle(tasks, "Next").status).toBe("blocked");
    fail = false;
    const requeued = await h.svc.patchTask(run.id, byTitle(tasks, "Flaky").id, { status: "queued", priority: 5 });
    expect(requeued.status).toBe("queued");
    expect(requeued.priority).toBe(5);
    await h.until(async () => byTitle((await h.svc.snapshot(run.id)).tasks, "Next").status === "done", "dependent done");
    tasks = (await h.svc.snapshot(run.id)).tasks;
    expect(byTitle(tasks, "Flaky").status).toBe("done");
    expect(byTitle(tasks, "Flaky").attempts).toBe(2);
    await h.svc.stop(run.id);
  });

  test("the kill switch also stops a paused run that is not live, closing its rows", async () => {
    const db = await createTestDb();
    const first = await harness({ db, script: { lead: [{ hang: true }] } });
    const run = await first.svc.create({ projectId: "p1", goal: "Pause by restart" });
    await first.until(() => first.llm.calls.length === 1, "in flight");
    await first.mod.close!();
    const second = await harness({ db, script: {} });
    let snap = await second.svc.snapshot(run.id);
    expect(snap.run.status).toBe("paused");
    expect(snap.agents[0]!.status).toBe("idle");
    expect(snap.tasks[0]!.status).toBe("queued");
    expect((await second.killswitch.trigger("tray")).stoppedRuns).toBe(1);
    snap = await second.svc.snapshot(run.id);
    expect(snap.run.status).toBe("stopped");
    expect(snap.run.statusReason).toBe("killswitch");
    expect(snap.agents[0]!.status).toBe("stopped");
    expect(snap.tasks[0]!.status).toBe("cancelled");
  });
});

describe("runs engine: review loop exit and mood", () => {
  const plan = {
    calls: [
      { name: "create_tasks", args: { tasks: [{ key: "w", title: "Risky change", spec: "change", role: "engineer", review: true }] } },
      { name: "finish", args: { summary: "planned" } },
    ],
  };

  test("after 3 failed rounds loopExit decides; escalate blocks the task and pauses the run", async () => {
    const decisions = fakeDecisions({ loopExit: "escalate" });
    const h = await harness({
      decisions,
      script: (info) => {
        if (info.role === "lead") return info.n === 0 ? plan : { calls: [{ name: "finish", args: { summary: "report" } }] };
        if (info.role === "reviewer") return { calls: [{ name: "submit_review", args: { verdict: "fail", notes: [`still broken ${info.n}`] } }] };
        return { calls: [{ name: "finish", args: { summary: `attempt ${info.n}` } }] };
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Never pass review" });
    await h.untilStatus(run.id, "paused");
    const snap = await h.svc.snapshot(run.id);
    expect(decisions.log.loopExit).toBe(1);
    expect(snap.run.statusReason).toContain('review: "Risky change" did not pass after 3 rounds');
    expect(byTitle(snap.tasks, "Risky change").status).toBe("blocked");
    expect(snap.tasks.filter((t) => t.title === "Review: Risky change")).toHaveLength(3);
    expect(snap.tasks.filter((t) => t.title === "Fix: Risky change")).toHaveLength(2);
    const engineer = snap.agents.find((a) => a.role === "engineer")!;
    expect(engineer.mood).toBe("frustrated");
    await h.svc.stop(run.id);
  });

  test("loopExit exit_done accepts the task and the run finishes", async () => {
    const h = await harness({
      decisions: fakeDecisions({ loopExit: "exit_done" }),
      script: (info) => {
        if (info.role === "lead") return info.n === 0 ? plan : { calls: [{ name: "finish", args: { summary: "report" } }] };
        if (info.role === "reviewer") return { calls: [{ name: "submit_review", args: { verdict: "fail", notes: ["nit"] } }] };
        return { calls: [{ name: "finish", args: { summary: `attempt ${info.n}` } }] };
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Accept with notes" });
    await h.untilStatus(run.id, "done");
    const t = byTitle((await h.svc.snapshot(run.id)).tasks, "Risky change");
    expect(t.status).toBe("done");
    expect(t.resultSummary).toContain("Accepted after 3 review rounds");
  });

  test("focused after 6 clean steps, then proud when the task passes", async () => {
    const h = await harness({
      script: (info) => {
        if (info.role !== "lead") return { calls: [{ name: "finish", args: { summary: "x" } }] };
        if (info.n < 6) return { calls: [{ name: "fs_read", args: { path: `f${info.n}` } }] };
        return { calls: [{ name: "finish", args: { summary: "done" } }] };
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Read many files" });
    await h.untilStatus(run.id, "done");
    const moods = h.events.ofType("agent.status").map((e) => e.data.mood);
    const focused = moods.indexOf("focused");
    expect(focused).toBeGreaterThan(-1);
    expect(moods.slice(0, focused).every((m) => m === "calm")).toBe(true);
    expect(moods.slice(focused)).toContain("proud");
  });

  test("tired once the run passed 45 minutes (time waiting on the human does not count for the task)", async () => {
    const clock = fakeClock();
    const h = await harness({
      clock,
      script: {
        lead: [
          { calls: [{ name: "ask_human", args: { question: "Go on?" } }] },
          { calls: [{ name: "fs_read", args: { path: "a" } }] },
          { calls: [{ name: "finish", args: { summary: "done late" } }] },
        ],
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Take a long lunch" });
    await h.until(() => h.events.ofType("agent.status").some((e) => e.data.status === "approval"), "approval");
    clock.advance(46 * 60_000);
    await h.svc.message(run.id, { text: "yes" });
    await h.untilStatus(run.id, "done");
    const moods = h.events.ofType("agent.status").map((e) => e.data.mood);
    expect(moods).toContain("tired");
    expect(moods.at(-1)).toBe("proud");
    const t = (await h.svc.snapshot(run.id)).tasks[0]!;
    expect(t.status).toBe("done");
  });
});
