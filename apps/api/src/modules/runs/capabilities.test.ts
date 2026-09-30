// The runs side of the capabilities: a fund run through the real engine
// with the real company templates (seeded roles, the CIO, the fund tracker,
// the P&L report spec), the capability context and per-step tool specs every
// tool call gets, the approval path for sensitive connector tools (the CEO
// decides crew requests, the owner the rest), and company on POST /api/runs.
import { describe, expect, test } from "bun:test";
import { COMPANY_STAGES, type MengaiEvent } from "@mengai/shared";
import type { ToolSpec } from "../../core/ports";
import { createCompaniesModule } from "../companies";
import { createRunSchema } from "./routes";
import { fakeTools, harness, type HarnessOptions } from "./testkit";
import type { ToolExtras } from "./ports";

type Ev<T extends MengaiEvent["type"]> = MengaiEvent<T>;
const finish = (summary: string) => ({ calls: [{ name: "finish", args: { summary } }] });

const FUND_PLAN = [
  { key: "thesis", title: "Write the thesis", spec: "s", acceptance: ["a"], role: "researcher", role_title: "Quant researcher" },
  { key: "data", title: "Collect the price history", spec: "s", acceptance: ["a"], role: "engineer", role_title: "Data engineer" },
  { key: "bt", title: "Backtest the rule", spec: "s", acceptance: ["a"], role: "researcher", role_title: "Quant researcher", deps: ["thesis", "data"] },
  { key: "risk", title: "Risk review of the strategy", spec: "s", acceptance: ["a"], role: "reviewer", role_title: "Risk manager", deps: ["bt"] },
  { key: "paper", title: "Paper trade the signal", spec: "s", acceptance: ["a"], role: "engineer", role_title: "Trader", deps: ["risk"] },
  { key: "live", title: "Propose one live order", spec: "s", acceptance: ["a"], role: "engineer", role_title: "Trader", deps: ["paper"] },
];

function fundScript(): HarnessOptions["script"] {
  return (info) => {
    if (info.role === "lead" && info.title === "Plan the work") {
      return info.n === 0 ? { calls: [{ name: "create_tasks", args: { tasks: FUND_PLAN } }, { name: "finish", args: { summary: "planned" } }] } : finish("planned");
    }
    if (info.role === "lead") return finish("P&L report: realized +$0.00. Not investment advice.");
    return finish(`${info.roleTitle ?? info.role} done ${info.title}`);
  };
}

/** fakeTools plus taskSpecs: find_tools for everyone, and one trading spec per grant */
function capabilityTools() {
  const base = fakeTools();
  const asked: Array<{ role: string; taskId: string | null; grants: readonly string[] }> = [];
  const taskSpecs = async (input: { role: string; runId: string; taskId: string | null; grants?: readonly string[] }): Promise<ToolSpec[]> => {
    asked.push({ role: input.role, taskId: input.taskId, grants: input.grants ?? [] });
    return [{ name: "find_tools", description: "search", parameters: { type: "object" } }, ...(input.grants ?? []).map((g) => ({ name: g, description: g, parameters: { type: "object" } }))];
  };
  return { tools: Object.assign(base, { taskSpecs }), asked };
}

describe("fund runs through the engine", () => {
  test("the template seeds its roles, Oyen is the CIO, the tracker walks the fund stages, the report spec is the P&L report", async () => {
    const companies = createCompaniesModule().service;
    const { tools, asked } = capabilityTools();
    const h = await harness({ script: fundScript(), companies, toolsService: tools, brain: { org: true } });
    const run = await h.svc.create({ projectId: "p1", goal: "Run a paper desk on BTC-USD", company: "fund" });
    expect(run.company).toBe("fund");
    await h.untilStatus(run.id, "done");

    const stages = h.events.ofType("run.stage").map((e) => e.data.stage as string);
    expect(stages).toEqual(["thesis", "research", "backtest", "risk_review", "paper_trade", "live_trade", "report"]);
    expect(stages).toEqual([...COMPANY_STAGES.fund].filter((s) => stages.includes(s)));
    const snap = await h.svc.snapshot(run.id);
    expect(snap.stage as string).toBe("report");
    expect(snap.run.company).toBe("fund");
    expect((await h.svc.list()).find((r) => r.id === run.id)!.company).toBe("fund");

    const created = h.events.ofType("role.created") as Ev<"role.created">[];
    expect(created.map((e) => e.data.role.key).sort()).toEqual(["compliance-officer", "data-engineer", "quant-researcher", "risk-manager", "trader"]);
    expect(created.every((e) => e.data.byAgentId === null && e.data.role.charter.startsWith(`You are the ${e.data.role.title} cat on a MengAI crew`))).toBe(true);
    const lead = snap.agents.find((a) => a.role === "lead")!;
    expect(lead.roleTitle).toBe("CIO");
    expect(new Set(snap.agents.map((a) => a.roleTitle))).toEqual(new Set(["CIO", "Quant researcher", "Data engineer", "Risk manager", "Trader"]));

    // the CEO's plan task carries the fund guidance; the report task is the P&L report
    const specs = h.context.builds.map((b) => b.task?.spec ?? "");
    expect(specs.some((s) => s.includes("Company: hedge fund") && s.includes("Never give investment advice"))).toBe(true);
    expect(specs.some((s) => s.includes("P&L report"))).toBe(true);

    // grants per role: the trader proposes, the risk manager reviews, the CIO reads positions
    const grantsOf = (title: string) => {
      const a = snap.agents.find((x) => x.roleTitle === title)!;
      const call = h.llm.calls.find((c) => c.req.tools?.some((t) => t.name === "find_tools") && c.role === a.role && c.roleTitle === (title === "CIO" ? null : title));
      return (call?.req.tools ?? []).map((t) => t.name).filter((n) => ["get_quote", "propose_order", "review_order", "positions"].includes(n));
    };
    expect(grantsOf("Trader")).toEqual(["get_quote", "propose_order", "positions"]);
    expect(grantsOf("Risk manager")).toEqual(["get_quote", "review_order", "positions"]);
    expect(grantsOf("CIO")).toEqual(["positions"]);
    // capability specs are asked for every step of every task, after the registry tools
    expect(asked.length).toBeGreaterThanOrEqual(h.llm.calls.length);
    const anyStep = h.llm.calls[0]!.req.tools!.map((t) => t.name);
    expect(anyStep.indexOf("find_tools")).toBeGreaterThan(anyStep.indexOf("finish"));
  });

  test("a studio run keeps the studio tracker and no capability grants", async () => {
    const companies = createCompaniesModule().service;
    const { tools, asked } = capabilityTools();
    const h = await harness({
      script: { lead: [{ calls: [{ name: "create_tasks", args: { tasks: [{ key: "b", title: "Build", spec: "s", acceptance: ["a"], role: "engineer" }] } }, { name: "finish", args: { summary: "p" } }] }, finish("report")] },
      companies,
      toolsService: tools,
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Build a page" });
    expect(run.company).toBe("studio");
    await h.untilStatus(run.id, "done");
    expect(h.events.ofType("run.stage").map((e) => e.data.stage)).toEqual(["goal", "planned", "hired", "working", "shipped"]);
    expect(asked.every((a) => a.grants.length === 0)).toBe(true);
    expect(h.events.ofType("role.created")).toEqual([]);
  });
});

describe("tool calls carry the capability context and the approval path", () => {
  async function approvalRun(ceo: HarnessOptions["ceo"], onApprove: (ctx: ToolExtras) => Promise<{ approved: boolean; answer: string }>) {
    const seen: Array<{ approved: boolean; answer: string }> = [];
    let extras: ToolExtras | null = null;
    const tools = fakeTools(async (call, ctx) => {
      if (call.name !== "fs_write") return { output: "ok", ok: true, durationMs: 1 };
      extras = ctx as ToolExtras;
      const v = await onApprove(ctx as ToolExtras);
      seen.push(v);
      return { output: v.approved ? "done" : `not approved: ${v.answer}`, ok: v.approved, durationMs: 1 };
    });
    const h = await harness({
      script: {
        lead: [{ calls: [{ name: "create_tasks", args: { tasks: [{ key: "w", title: "Wipe the notes", spec: "s", acceptance: ["a"], role: "engineer" }] } }, { name: "finish", args: { summary: "p" } }] }, finish("report")],
        engineer: [{ calls: [{ name: "fs_write", args: { path: "a", content: "b" } }] }, finish("done")],
      },
      ceo,
      tools,
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Tidy the notes" });
    return { h, run, seen, extras: () => extras };
  }

  test("a crew cat asks the CEO, who decides; request events stream", async () => {
    const { h, run, seen, extras } = await approvalRun(
      () => ({ text: JSON.stringify({ decision: "deny", answer: "Not in the channel, put it in the notes instead." }) }),
      (ctx) => ctx.approve!({ tool: "chat.post_message", risk: "sensitive", summary: "Post a message to the team channel." }),
    );
    await h.untilStatus(run.id, "done");
    expect(seen).toEqual([{ approved: false, answer: expect.stringContaining("Not in the channel, put it in the notes instead.") }]);
    expect(extras()).toMatchObject({ company: "studio", roleKey: "engineer", grants: [] });
    const raised = h.events.ofType("request.raised").at(-1)!.data;
    expect(raised.question).toContain("May I run chat.post_message, a sensitive tool?");
    expect(raised.toOwner).toBe(false);
    expect(h.events.ofType("request.decided").at(-1)!.data).toMatchObject({ approved: false, byOwner: false });
    expect(h.llm.ceoCalls).toHaveLength(1);
  });

  test("an owner-only question goes on to the owner; a yes approves it", async () => {
    const { h, run, seen } = await approvalRun(undefined, (ctx) => ctx.approve!({ tool: "bank.send_payment", risk: "sensitive", summary: "Send a payment." }));
    await h.until(() => h.events.ofType("request.raised").some((e) => e.data.toOwner), "the owner question");
    // payments are owner-only: the CEO model is not asked
    expect(h.llm.ceoCalls).toHaveLength(0);
    const asker = (await h.svc.snapshot(run.id)).agents.find((a) => a.role === "engineer")!;
    await h.svc.message(run.id, { text: "yes, go ahead", agentId: asker.id });
    await h.untilStatus(run.id, "done");
    expect(seen).toEqual([{ approved: true, answer: "yes, go ahead" }]);
  });
});

describe("POST /api/runs", () => {
  test("accepts a company kind and nothing else", () => {
    expect(createRunSchema.safeParse({ projectId: "p1", goal: "Run a desk", company: "fund" }).success).toBe(true);
    expect(createRunSchema.safeParse({ projectId: "p1", goal: "Run a desk" }).success).toBe(true);
    expect(createRunSchema.safeParse({ projectId: "p1", goal: "Run a desk", company: "bank" }).success).toBe(false);
  });
});

describe("venue skills in the memory layer", () => {
  test("every cat whose role may use a ready venue gets its note first in the memory layer on every step; a new skill version reaches the next step", async () => {
    let version = 1;
    const asked: string[] = [];
    const venueNotes = async (role: string) => {
      asked.push(role);
      return role === "designer" ? [] : [{ venueId: "v1", version, text: `Crew skill v${version} for the Paw venue: get_quote reads paw.get_ticker.` }];
    };
    const tools = Object.assign(fakeTools(), { venueNotes });
    const h = await harness({
      toolsService: tools,
      script: (info) => {
        if (info.role === "lead") {
          if (info.n === 0) return { calls: [{ name: "create_tasks", args: { tasks: [{ title: "Price it", spec: "x", role: "engineer" }, { title: "Draw it", spec: "y", role: "designer" }] } }, { name: "finish", args: { summary: "planned" } }] };
          return finish("report");
        }
        if (info.role === "engineer" && info.n === 0) {
          // the data engineer relearns the venue while this cat works: v2 from its next step
          version = 2;
          return { calls: [{ name: "fs_list", args: { path: "." } }] };
        }
        return finish(`${info.role} done`);
      },
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Trade on the venue" });
    await h.untilStatus(run.id, "done");
    const eng = h.context.builds.filter((b) => b.role === "engineer").map((b) => b.lessons[0]);
    expect(eng.map((l) => l?.text)).toEqual(["Crew skill v1 for the Paw venue: get_quote reads paw.get_ticker.", "Crew skill v2 for the Paw venue: get_quote reads paw.get_ticker."]);
    expect(eng[1]).toMatchObject({ id: "venue:v1:v2", scope: "global", role: null, tags: ["venue"] });
    // a role without the venue in scope gets no note
    expect(h.context.builds.filter((b) => b.role === "designer").every((b) => b.lessons.every((l) => !l.id.startsWith("venue:")))).toBe(true);
    expect(new Set(asked)).toEqual(new Set(["lead", "engineer", "designer"]));
    // venue notes are not lessons: never marked used
    expect(h.memory.log.used.some((id) => id.startsWith("venue:"))).toBe(false);
  });
});
