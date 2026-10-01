// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The island's moment hints: the pure payload (level, sentence, cap, budget
// line) and every engine emit point through the real engine with scripted
// cats, one `moment` each, with the right kind, cat and task.
import { describe, expect, test } from "bun:test";
import { MOMENT_BUDGET_LOW_SHARE, MOMENT_KINDS, MOMENT_TEXT_MAX, type MengaiEvent, type TaskDTO } from "@mengai/shared";
import { budgetLow, momentFor } from "./moments";
import type { ToolExtras } from "./ports";
import { fakeTools, harness, type CallInfo, type HarnessOptions, type Reply } from "./testkit";

/** The em and en dash or a line break, written as char codes so the source stays plain. */
const LONG_DASH_OR_BREAK = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}\\n]`);

const byTitle = (tasks: TaskDTO[], title: string) => tasks.find((t) => t.title === title)!;
const plan = (tasks: unknown[]): Reply => ({ calls: [{ name: "create_tasks", args: { tasks } }, { name: "finish", args: { summary: "planned" } }] });
const finish = (summary: string, extra: Record<string, unknown> = {}): Reply => ({ calls: [{ name: "finish", args: { summary, ...extra } }] });
const call = (name: string, args: Record<string, unknown> = {}): Reply => ({ calls: [{ name, args }] });
const revise = (critique: string) => ({ text: JSON.stringify({ verdict: "revise", critique }) });
const pass = { text: JSON.stringify({ verdict: "pass", critique: "ok" }) };
const oneTask = (info: CallInfo): Reply | null =>
  info.role === "lead" ? (info.n === 0 ? plan([{ title: "Do it", spec: "work", role: "engineer" }]) : finish("report")) : null;
/** the moment events, with the envelope checked against the payload */
function moments(events: MengaiEvent<"moment">[]) {
  for (const e of events) {
    expect(e.agentId).toBe(e.data.agentId);
    expect(e.taskId).toBe(e.data.taskId);
  }
  return events.map((e) => e.data);
}

describe("moments: the payload", () => {
  const kopi = { id: "a1", name: "Kopi" };
  const form = { id: "t1", title: "Login form" };

  test("every kind has its level and one plain sentence about the cat and the task", () => {
    expect(momentFor("review_pass", { cat: kopi, task: form })).toEqual({ kind: "review_pass", agentId: "a1", taskId: "t1", level: "good", text: "Kopi passed Login form in review." });
    expect(momentFor("review_fail", { cat: kopi, task: form })).toMatchObject({ level: "bad", text: "Kopi sent Login form back after review." });
    expect(momentFor("ceo_approved", { cat: { id: "a0", name: "Oyen" }, task: form, asker: "Kopi" })).toMatchObject({ agentId: "a0", level: "good", text: "Oyen approved Kopi's request." });
    expect(momentFor("ceo_denied", { cat: { id: "a0", name: "Oyen" }, task: form, asker: "Kopi" })).toMatchObject({ level: "bad", text: "Oyen turned down Kopi's request." });
    expect(momentFor("rethink", { cat: kopi, task: form })).toMatchObject({ level: "info", text: "Kopi is taking another look at Login form." });
    expect(momentFor("stuck", { cat: kopi, task: form })).toMatchObject({ level: "bad", text: "Kopi is stuck on Login form." });
    expect(momentFor("budget_low", { cat: { id: "a0", name: "Oyen" } })).toEqual({ kind: "budget_low", agentId: "a0", taskId: null, level: "bad", text: "The run has used 80% of its budget." });
    for (const kind of MOMENT_KINDS) {
      const m = momentFor(kind, { cat: kopi, task: form, asker: "Mochi" });
      expect(["info", "good", "bad"]).toContain(m.level);
      expect(m.text).not.toMatch(LONG_DASH_OR_BREAK);
    }
  });

  test("a long title is shortened so the sentence keeps its end; the whole stays within the cap, redacted, one line", () => {
    const long = { id: "t2", title: `Build the complete sign up and login flow with\nemail checks, ${"x".repeat(200)}` };
    for (const kind of MOMENT_KINDS) expect(momentFor(kind, { cat: kopi, task: long, asker: "Mochi" }).text.length).toBeLessThanOrEqual(MOMENT_TEXT_MAX);
    const fail = momentFor("review_fail", { cat: kopi, task: long }).text;
    expect(fail.endsWith("... back after review.")).toBe(true);
    expect(fail).not.toContain("\n");
    const secret = momentFor("stuck", { cat: kopi, task: { id: "t3", title: "Use sk-proj-abcdefghijklmnopqrstuv" } }).text;
    expect(secret).toBe("Kopi is stuck on Use [REDACTED].");
  });

  test("no cat or task still reads as a sentence", () => {
    expect(momentFor("budget_low", { cat: undefined })).toMatchObject({ agentId: null, taskId: null });
    expect(momentFor("stuck", { cat: null }).text).toBe("The crew is stuck on the task.");
    expect(momentFor("ceo_denied", { cat: { id: "a0", name: "Oyen" } }).text).toBe("Oyen turned down a cat's request.");
  });

  test("the budget runs low at 80% of either budget; a 0 budget never does", () => {
    expect(MOMENT_BUDGET_LOW_SHARE).toBe(0.8);
    expect(budgetLow({ budgetTokens: 1000, usedTokens: 799, budgetUsd: 0, usedUsd: 5 })).toBe(false);
    expect(budgetLow({ budgetTokens: 1000, usedTokens: 800, budgetUsd: 0, usedUsd: 0 })).toBe(true);
    expect(budgetLow({ budgetTokens: 0, usedTokens: 9_999_999, budgetUsd: 1, usedUsd: 0.79 })).toBe(false);
    expect(budgetLow({ budgetTokens: 0, usedTokens: 0, budgetUsd: 1, usedUsd: 0.8 })).toBe(true);
    expect(budgetLow({ budgetTokens: 0, usedTokens: 1e9, budgetUsd: 0, usedUsd: 1e9 })).toBe(false);
  });
});

describe("moments: the engine emit points", () => {
  test("a review verdict: one review_fail then one review_pass from the reviewer, about the reviewed task", async () => {
    const h = await harness({
      script: {
        lead: [plan([{ key: "b", title: "Build feature", spec: "Implement it", acceptance: ["works"], role: "engineer", review: true }]), finish("Final: built")],
        engineer: [finish("Feature built"), finish("Added the missing tests")],
        reviewer: [call("submit_review", { verdict: "fail", notes: ["Missing tests"] }), call("submit_review", { verdict: "pass", notes: ["Looks good"] })],
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Ship the feature" });
    await h.untilStatus(run.id, "done");
    const snap = await h.svc.snapshot(run.id);
    const reviewer = snap.agents.find((a) => a.role === "reviewer")!;
    const build = byTitle(snap.tasks, "Build feature");
    const m = moments(h.events.ofType("moment"));
    expect(m.map((x) => [x.kind, x.agentId, x.taskId])).toEqual([
      ["review_fail", reviewer.id, build.id],
      ["review_pass", reviewer.id, build.id],
    ]);
    expect(m[1]!.text).toBe(`${reviewer.name} passed Build feature in review.`);
  });

  describe("the CEO answers a crew request itself", () => {
    const askScript = (question: string): HarnessOptions["script"] => ({
      lead: [plan([{ key: "copy", title: "Draft copy", spec: "Write it", role: "designer" }]), finish("Final: copy drafted")],
      designer: [call("ask_human", { question }), finish("copy.md written")],
    });

    for (const [decision, kind] of [
      ["approve", "ceo_approved"],
      ["deny", "ceo_denied"],
    ] as const) {
      test(`ask_human, ${decision}: one ${kind} from the CEO`, async () => {
        const h = await harness({ script: askScript("Can I lead with the tagline Slow coffee?"), ceo: () => ({ text: JSON.stringify({ decision, answer: "Decided." }) }) });
        const run = await h.svc.create({ projectId: "p1", goal: "Write the copy" });
        await h.untilStatus(run.id, "done");
        const snap = await h.svc.snapshot(run.id);
        const lead = snap.agents.find((a) => a.role === "lead")!;
        const designer = snap.agents.find((a) => a.role === "designer")!;
        const m = moments(h.events.ofType("moment"));
        expect(m.map((x) => [x.kind, x.agentId, x.taskId])).toEqual([[kind, lead.id, byTitle(snap.tasks, "Draft copy").id]]);
        expect(m[0]!.text).toContain(`${designer.name}'s request`);
      });
    }

    test("a sensitive tool the CEO denies: one ceo_denied from the CEO", async () => {
      const tools = fakeTools(async (c, ctx) => {
        if (c.name !== "fs_write") return { output: "ok", ok: true, durationMs: 1 };
        const v = await (ctx as ToolExtras).approve!({ tool: "chat.post_message", risk: "sensitive", summary: "Post a message to the team channel." });
        return { output: v.approved ? "done" : `not approved: ${v.answer}`, ok: v.approved, durationMs: 1 };
      });
      const h = await harness({
        tools,
        ceo: () => ({ text: JSON.stringify({ decision: "deny", answer: "Put it in the notes instead." }) }),
        script: {
          lead: [plan([{ key: "w", title: "Wipe the notes", spec: "s", acceptance: ["a"], role: "engineer" }]), finish("report")],
          engineer: [call("fs_write", { path: "a", content: "b" }), finish("done")],
        },
      });
      const run = await h.svc.create({ projectId: "p1", goal: "Tidy the notes" });
      await h.untilStatus(run.id, "done");
      const snap = await h.svc.snapshot(run.id);
      const lead = snap.agents.find((a) => a.role === "lead")!;
      expect(moments(h.events.ofType("moment")).map((x) => [x.kind, x.agentId, x.taskId])).toEqual([["ceo_denied", lead.id, byTitle(snap.tasks, "Wipe the notes").id]]);
    });

    test("a question the CEO sends on to the owner is no CEO moment", async () => {
      const h = await harness({ script: askScript("Which of your two brand colors is primary?"), ceo: () => ({ text: JSON.stringify({ decision: "owner", answer: "" }) }) });
      const run = await h.svc.create({ projectId: "p1", goal: "Write the copy" });
      await h.until(() => h.events.ofType("request.raised").length === 2, "escalated");
      const designer = (await h.svc.snapshot(run.id)).agents.find((a) => a.role === "designer")!;
      await h.svc.message(run.id, { text: "Blue", agentId: designer.id });
      await h.untilStatus(run.id, "done");
      expect(h.events.ofType("moment")).toHaveLength(0);
    });
  });

  test("a self-check revise that sends the cat into another round: one rethink from that cat", async () => {
    const h = await harness({
      brain: { reflexion: true },
      side: { reflexion: (_packet, n) => (n === 1 ? revise("No check covers the email validation. Run the tests.") : pass) },
      script: (info) =>
        oneTask(info) ??
        [call("fs_write", { path: "form.ts", content: "x" }), finish("Built the form", { files: ["form.ts"] }), call("shell_run", { command: "bun test" }), finish("Built the form, bun test exit 0")][info.n] ??
        finish("again"),
    });
    const run = await h.svc.create({ projectId: "p1", goal: "A login form" });
    await h.untilStatus(run.id, "done");
    const snap = await h.svc.snapshot(run.id);
    const engineer = snap.agents.find((a) => a.role === "engineer")!;
    expect(h.events.ofType("agent.reflexion").map((e) => e.data.verdict)).toEqual(["revise", "pass"]);
    expect(moments(h.events.ofType("moment")).map((x) => [x.kind, x.agentId, x.taskId])).toEqual([["rethink", engineer.id, byTitle(snap.tasks, "Do it").id]]);
  });

  test("the last revise is accepted with the open point: no rethink for it", async () => {
    const h = await harness({
      brain: { reflexion: true },
      side: { reflexion: () => revise("The spacing is still off on mobile.") },
      script: (info) => oneTask(info) ?? ([call("fs_write", { path: "a.css", content: "a" }), finish("Tidied"), call("fs_read", { path: "a.css" }), finish("Tidied again"), call("fs_list"), finish("Tidied a third time")][info.n] ?? finish("x")),
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Tidy" });
    await h.untilStatus(run.id, "done");
    expect(h.events.ofType("agent.reflexion").map((e) => e.data.verdict)).toEqual(["revise", "revise", "revise"]);
    expect(moments(h.events.ofType("moment")).map((x) => x.kind)).toEqual(["rethink", "rethink"]);
  });

  describe("a loop guard trips: one stuck from the stuck cat", () => {
    async function stuckRun(script: (info: CallInfo) => Reply, tools?: ReturnType<typeof fakeTools>) {
      const h = await harness({ ...(tools ? { tools } : {}), script: (info) => oneTask(info) ?? script(info) });
      const run = await h.svc.create({ projectId: "p1", goal: "Get stuck" });
      await h.untilStatus(run.id, "done");
      const snap = await h.svc.snapshot(run.id);
      const engineer = snap.agents.find((a) => a.role === "engineer")!;
      const t = byTitle(snap.tasks, "Do it");
      expect(t.status).toBe("failed");
      expect(moments(h.events.ofType("moment")).map((x) => [x.kind, x.agentId, x.taskId])).toEqual([["stuck", engineer.id, t.id]]);
      return t;
    }

    test("the same call 3 times", async () => {
      const t = await stuckRun(() => call("fs_read", { path: "same.ts" }));
      expect(t.resultSummary).toContain("repeated 3 times");
    });

    test("the same error 3 times", async () => {
      const tools = fakeTools(() => ({ output: "ENOENT: no such file", ok: false, durationMs: 1 }));
      const t = await stuckRun((info) => call("shell_run", { command: `cat f${info.n}` }), tools);
      expect(t.resultSummary).toContain("the same shell_run error happened 3 times");
    });

    test("3 replies without a tool call", async () => {
      const t = await stuckRun(() => ({ text: "I am thinking about it." }));
      expect(t.resultSummary).toContain("no progress");
    });
  });

  test("tokens cross 80%, then the budget, then 80% of a raised budget: one budget_low from the CEO", async () => {
    const h = await harness({
      script: {
        lead: [
          { calls: [{ name: "note", args: { text: "a" } }], usage: { inputTokens: 800, outputTokens: 10 } },
          { calls: [{ name: "note", args: { text: "b" } }], usage: { inputTokens: 300, outputTokens: 0 } },
          finish("done within the new budget"),
        ],
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Spend tokens", budgetTokens: 1000 });
    await h.untilStatus(run.id, "paused");
    await h.svc.setBudget(run.id, { budgetTokens: 1500 });
    await h.svc.resume(run.id);
    await h.untilStatus(run.id, "done");
    const lead = (await h.svc.snapshot(run.id)).agents.find((a) => a.role === "lead")!;
    const m = moments(h.events.ofType("moment"));
    expect(m.map((x) => [x.kind, x.agentId, x.taskId])).toEqual([["budget_low", lead.id, null]]);
    // the moment comes with the usage that crossed the line, before the run pauses
    const ev = h.events.events;
    const at = ev.findIndex((e) => e.type === "moment");
    expect(ev[at - 1]!.type).toBe("run.usage");
    expect(at).toBeLessThan(ev.findIndex((e) => e.type === "run.status" && (e as MengaiEvent<"run.status">).data.status === "paused"));
  });

  test("USD crosses 80% without running out: one budget_low", async () => {
    // fake cost: input tokens x 1 + output tokens x 2, per million
    const h = await harness({ script: { lead: [{ calls: [{ name: "note", args: { text: "x" } }], usage: { inputTokens: 8_500, outputTokens: 0 } }] } });
    const run = await h.svc.create({ projectId: "p1", goal: "Spend dollars", budgetUsd: 0.01 });
    await h.untilStatus(run.id, "done");
    expect(moments(h.events.ofType("moment")).map((x) => x.kind)).toEqual(["budget_low"]);
  });

  test("a run under 80% of its budget sends no moment", async () => {
    const h = await harness({ script: { lead: [finish("planned nothing"), finish("report")] } });
    const run = await h.svc.create({ projectId: "p1", goal: "Stay cheap", budgetTokens: 1000 });
    await h.untilStatus(run.id, "done");
    expect(h.events.ofType("moment")).toHaveLength(0);
  });
});
