// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Crew skills and ui_check in the live loop, through the real engine with
// scripted cats: every step's charter layer carries the skills picked for
// the cat (the real crew-skills module), the mind lists what was read and
// what the cap trimmed, a failing skill source never stops a run, a dynamic
// specialist keeps its archetype's crew tools, and a reviewer's pass on UI
// work goes through ui_check first.
import { describe, expect, test } from "bun:test";
import type { ModuleContext } from "../../core/module";
import type { ToolContext } from "../../core/services";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { createCrewSkillsModule } from "../crew-skills";
import { UI_CHECK_TOOL } from "./engine";
import { choice, fakeJudge, fakeTools, harness, type CallInfo, type Reply } from "./testkit";

const plan = (tasks: unknown[]): Reply => ({ calls: [{ name: "create_tasks", args: { tasks } }, { name: "finish", args: { summary: "planned" } }] });
const finish = (summary: string): Reply => ({ calls: [{ name: "finish", args: { summary } }] });
const call = (name: string, args: Record<string, unknown> = {}): Reply => ({ calls: [{ name, args }] });
const leadThen = (tasks: unknown[]) => (info: CallInfo): Reply | null => (info.role === "lead" ? (info.n === 0 ? plan(tasks) : finish("report")) : null);
type SkillBuild = { role: string; runId: string; crewSkills?: Array<{ id: string; version: number; name: string }> };

async function crewModule(db: Awaited<ReturnType<typeof createTestDb>>, clock: ReturnType<typeof fakeClock>) {
  const ctx: ModuleContext = { config: null as never, db, kv: memoryKv(), blob: null as never, vault: memoryVault(), clock, logger: silentLogger, events: captureEvents(clock) };
  return createCrewSkillsModule(ctx);
}

describe("crew skills in the loop", () => {
  test("every step carries the cat's skills in a fixed order; the mind lists them and the cache tag", async () => {
    const db = await createTestDb();
    const clock = fakeClock();
    const crew = await crewModule(db, clock);
    const mine = await crew.service.create({ name: "House style", body: "- Tabs, not spaces.", roles: ["engineer"] });
    const lead = leadThen([{ title: "Build the page", spec: "Build it", role: "engineer" }]);
    const h = await harness({
      db,
      clock,
      crewSkills: crew.service,
      script: (info) => lead(info) ?? (info.n === 0 ? call("fs_write", { path: "index.html", content: "<p>hi</p>" }) : finish("built")),
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Build a landing page for the cafe" });
    await h.untilStatus(run.id, "done");
    const builds = h.context.builds as unknown as SkillBuild[];
    const eng = builds.filter((x) => x.role === "engineer");
    expect(eng.length).toBe(2);
    for (const x of eng) expect(x.crewSkills!.map((k) => k.id)).toEqual(["builtin-design-law", "builtin-frontend-rules", mine.id]);
    expect(builds.filter((x) => x.role === "lead").every((x) => x.crewSkills!.map((k) => k.id).join() === "builtin-system-design")).toBe(true);
    // the fake context renders them into the system prompt in the same order
    const sys = String(h.llm.calls.find((c) => c.role === "engineer")!.req.system);
    expect(sys.indexOf("skill=builtin-design-law:v1")).toBeLessThan(sys.indexOf(`skill=${mine.id}:v1`));

    const snap = await h.svc.snapshot(run.id);
    const engineer = snap.agents.find((a) => a.role === "engineer")!;
    const mind = await h.svc.mind(run.id, engineer.id);
    expect(mind.crewSkills.map((k) => [k.id, k.source])).toEqual([
      ["builtin-design-law", "builtin"],
      ["builtin-frontend-rules", "builtin"],
      [mine.id, "owner"],
      ["builtin-ui-taste", "builtin"],
      ["builtin-motion-immersive", "builtin"],
      ["builtin-design-system", "builtin"],
    ]);
    const skipped = mind.crewSkills.slice(3) as Array<{ tokens: number; skipped?: boolean }>;
    expect(skipped.every((k) => k.skipped === true && k.tokens === 0)).toBe(true);
    expect(mind.crewSkills.slice(0, 3).every((k) => k.tokens > 0)).toBe(true);
    const pick = await crew.service.forPrompt({ role: "engineer", kind: "studio", goal: run.goal });
    expect(mind.layerVersion).toBe(`c1.${pick.tag}`);
  });

  test("a built-in the owner switched off never reaches the prompt", async () => {
    const db = await createTestDb();
    const clock = fakeClock();
    const crew = await crewModule(db, clock);
    await crew.service.update("builtin-security-qa", { enabled: false });
    const lead = leadThen([{ title: "Move settings", spec: "Move them to SQLite", role: "engineer" }]);
    const h = await harness({ db, clock, crewSkills: crew.service, script: (info) => lead(info) ?? finish("moved") });
    const run = await h.svc.create({ projectId: "p1", goal: "Move user settings from JSON files to SQLite." });
    await h.untilStatus(run.id, "done");
    const eng = (h.context.builds as unknown as SkillBuild[]).find((x) => x.role === "engineer")!;
    expect(eng.crewSkills!.map((k) => k.id)).toEqual(["builtin-system-design"]);
  });

  test("a failing skill source never stops a run: the prompt goes without skills", async () => {
    const lead = leadThen([{ title: "Build", spec: "Build it", role: "engineer" }]);
    const h = await harness({
      crewSkills: { forPrompt: async () => Promise.reject(new Error("db down")) },
      script: (info) => lead(info) ?? finish("built"),
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Build a page" });
    await h.untilStatus(run.id, "done");
    expect((h.context.builds as unknown as SkillBuild[]).every((x) => !x.crewSkills)).toBe(true);
    const snap = await h.svc.snapshot(run.id);
    const mind = await h.svc.mind(run.id, snap.agents.find((a) => a.role === "engineer")!.id);
    expect(mind.crewSkills).toEqual([]);
  });

  test("a dynamic specialist keeps the crew tools its archetype has beyond the shared registry (ui_check)", async () => {
    const tools = fakeTools();
    const base = tools.specsFor;
    tools.specsFor = (role) => (role === "qa" ? [...base(role), { name: UI_CHECK_TOOL, description: "scan", parameters: { type: "object" } }] : base(role));
    const judge = fakeJudge((id) => (id === "orch.role" ? { need: choice("new_role"), archetype: choice("qa") } : id === "orch.hire" ? { hire: choice("hire") } : null));
    const h = await harness({
      brain: { org: true },
      judge,
      tools,
      script: (info) =>
        info.role === "lead"
          ? info.title === "Plan the work"
            ? plan([{ title: "Smoke check the page", spec: "Test it like a visitor", role: "qa", role_title: "Launch tester" }])
            : finish("report")
          : finish(`done by ${info.roleTitle}`),
    });
    const run = await h.svc.create({ projectId: "p1", goal: "Ship a page" });
    await h.untilStatus(run.id, "done");
    const role = h.events.ofType("role.created")[0]!.data.role;
    expect(role.tools).toEqual(["finish", "note", "fs_read", "fs_search", "shell_run"]);
    const build = h.context.builds.find((b) => b.role === "qa")!;
    expect(build.tools.map((t) => t.name)).toEqual([...role.tools, UI_CHECK_TOOL]);
  });
});

describe("ui_check before a reviewer's pass", () => {
  const FINDINGS = "ui_check: 1 finding in 1 of 1 files (emoji 1)\nindex.html:1: [emoji] emoji in the UI: use an SVG icon or words";
  const lead = leadThen([{ title: "Build the page", spec: "Build it", role: "engineer", review: true }]);

  async function reviewRun(reviewer: Reply[], answer: (tc: ToolContext) => Promise<{ ok: boolean; output: string } | null>) {
    const seen: ToolContext[] = [];
    const tools = Object.assign(fakeTools(), {
      reviewCheck: async (tc: ToolContext) => {
        seen.push(tc);
        return answer(tc);
      },
    });
    const h = await harness({ tools, script: (info) => lead(info) ?? (info.role === "reviewer" ? reviewer[info.n]! : finish("built")) });
    const run = await h.svc.create({ projectId: "p1", goal: "Build a landing page" });
    await h.untilStatus(run.id, "done");
    const reviews = await h.db.query<{ output: string }>`select output from tool_calls where run_id = ${run.id} and tool = 'submit_review' order by created_at, id`;
    const snap = await h.svc.snapshot(run.id);
    return { h, seen, reviews: reviews.map((r) => r.output), build: snap.tasks.find((t) => t.title === "Build the page")!, calls: h.llm.calls.filter((c) => c.role === "reviewer").length };
  }
  const pass = call("submit_review", { verdict: "pass", notes: ["Looks good"] });

  test("findings hold the first pass once with the list; a second pass is the reviewer's call", async () => {
    const r = await reviewRun([pass, pass], async () => ({ ok: false, output: FINDINGS }));
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]).toMatchObject({ role: "reviewer", projectId: "p1" });
    expect(r.reviews).toHaveLength(2);
    expect(r.reviews[0]).toStartWith("Not passed yet: this run changed UI files, so ui_check ran before your pass");
    expect(r.reviews[0]).toContain("index.html:1: [emoji]");
    expect(r.reviews[1]).toBe("Review submitted.");
    expect(r.calls).toBe(2);
    expect(r.build.resultSummary).toContain("Review passed");
  });

  test("a clean scan or no UI change lets the first pass through", async () => {
    for (const answer of [async () => ({ ok: true, output: "ui_check: clean, 2 files checked" }), async () => null]) {
      const r = await reviewRun([pass], answer);
      expect(r.seen).toHaveLength(1);
      expect(r.reviews).toEqual(["Review submitted."]);
      expect(r.calls).toBe(1);
    }
  });

  test("a scan that cannot run holds the pass until the reviewer runs ui_check itself", async () => {
    const r = await reviewRun([pass, pass, call(UI_CHECK_TOOL, {}), pass], async () => Promise.reject(new Error("disk gone")));
    expect(r.seen).toHaveLength(2);
    expect(r.reviews).toHaveLength(3);
    expect(r.reviews.slice(0, 2).every((x) => x.startsWith("Not passed yet: ui_check could not run before your pass (disk gone)"))).toBe(true);
    expect(r.reviews[2]).toBe("Review submitted.");
    expect(r.build.resultSummary).toContain("Review passed");
  });

  test("a reviewer who ran ui_check on the task is never held", async () => {
    const r = await reviewRun([call(UI_CHECK_TOOL, {}), pass], async () => ({ ok: false, output: FINDINGS }));
    expect(r.seen).toHaveLength(0);
    expect(r.reviews).toEqual(["Review submitted."]);
    expect(r.h.tools.executed.map((e) => e.call.name)).toContain(UI_CHECK_TOOL);
  });
});
