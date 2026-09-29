// Scenario coverage of the scripted demo crew: one run through the real
// container (orchestrator, tools, workspace) must show every beat the office
// scene choreographs, in a believable order. Pace and meetings run in ms.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "@mengai/config";
import { CAT_NAMES, type AgentRole, type EventType, type MengaiEvent } from "@mengai/shared";
import { STRATEGY_SYSTEM } from "../modules/evals";
import { CEO_SYSTEM, REFLEXION_SYSTEM, ROLE_SYSTEM } from "../modules/runs";
import { createDb } from "./adapters/db-bunsql";
import { buildConfig } from "./config";
import { createContainer } from "./container";
import {
  DEMO_CRITIQUE,
  DEMO_CSS,
  DEMO_MEETING_MS,
  DEMO_PACE_MS,
  DEMO_QUESTION,
  DEMO_ROLE_TITLE,
  DEMO_SMOKE,
  createDemoJudge,
  createDemoRouter,
  demoCharters,
  demoMeetingMs,
  demoTurn,
} from "./demo";
import type { ChatRequest } from "./ports";
import type { ExecRequest, ExecResult, Runner } from "./ports/runner";
import { memoryKv, memoryVault, silentLogger } from "../testing";

const temps: string[] = [];
afterAll(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mengai-demo-"));
  temps.push(dir);
  return dir;
}

function fakeRunner(): Runner & { seen: ExecRequest[] } {
  const seen: ExecRequest[] = [];
  return {
    seen,
    async exec(req: ExecRequest): Promise<ExecResult> {
      seen.push(req);
      const stdout = /^echo '([^']*)'$/.exec(req.command)?.[1] ?? "";
      return { exitCode: 0, signal: null, stdout: `${stdout}\n`, stderr: "", truncated: false, timedOut: false, killed: false, durationMs: 3 };
    },
    killAll: async () => 0,
    running: () => 0,
  };
}

type Ev<T extends EventType> = MengaiEvent<T>;

describe("demo crew: one run shows every scenario", () => {
  test("Oyen alone, hiring with a dynamic role, kickoff, code growth, research, CEO approval, review fail, sync, fix, a reflexion round, adopted playbooks, a cat let go and replaced, every tracker stage, wrap-up, report", async () => {
    const dataDir = await tempDir();
    const workspaces = await tempDir();
    const boot = buildConfig(parseEnv({ MENGAI_MODE: "local", MENGAI_DATA_DIR: dataDir, MENGAI_WORKSPACES_DIR: workspaces }));
    const runner = fakeRunner();
    const container = await createContainer({
      boot,
      logger: silentLogger,
      overrides: { db: createDb({ url: ":memory:" }), kv: memoryKv(), vault: memoryVault(), runner },
      demo: { paceMs: [1, 3] },
    });
    try {
      const { runId, projectId } = container.demo!.seed!;
      const bus = container.modules.events.service;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("demo run did not finish in 30 s")), 30_000);
        const off = bus.subscribe((e: MengaiEvent) => {
          if (e.type !== "run.status" || e.runId !== runId) return;
          const s = (e as Ev<"run.status">).data.status;
          if (s === "done" || s === "failed" || s === "stopped") {
            clearTimeout(timer);
            off();
            resolve();
          }
        });
      });
      const ev = await bus.after(0, runId, 10_000);
      const of = <T extends EventType>(t: T) => ev.filter((e): e is Ev<T> => e.type === t);
      const pos = (e: MengaiEvent) => ev.indexOf(e);
      const snap = await container.modules.runs.service.snapshot(runId);
      expect(snap.run.status).toBe("done");
      const agent = (role: AgentRole) => snap.agents.find((a) => a.role === role)!;
      const [lead, engineer, designer, researcher, reviewer, tester, security] = (["lead", "engineer", "designer", "researcher", "reviewer", "qa", "security"] as const).map(agent);
      const task = (title: string) => snap.tasks.find((t) => t.title === title)!;
      const created = (title: string) => of("task.created").find((e) => e.data.task.title === title)!;
      const decisions = (id: string) => of("decision").filter((e) => e.data.decision.decisionId === id).map((e) => e.data.decision);

      // Oyen starts alone with the goal: the first cat, and the only one until the plan is on the board
      const spawned = of("agent.spawned");
      expect(spawned[0]!.data.agent).toMatchObject({ name: "Oyen", role: "lead", parentId: null });
      expect(spawned[0]!.data.reason).toBe("Runs the company for this goal");
      const stages = of("run.stage").map((e) => e.data.stage);
      expect(stages).toEqual(["goal", "planned", "hired", "working", "review", "working", "review", "testing", "shipped"]);
      const stage = (s: string, nth = 0) => of("run.stage").filter((e) => e.data.stage === s)[nth]!;
      expect(pos(stage("planned"))).toBeLessThan(pos(spawned[1]!));
      expect(of("run.stage").find((e) => e.data.previous === "review" && e.data.stage === "working")!.data.reason).toBe("Review of Scaffold the landing page failed: back to work");
      expect(snap.stage).toBe("shipped");

      // hiring includes one dynamic role: runtime JEV defined the Launch tester on the qa archetype
      const roleCreated = of("role.created");
      expect(roleCreated).toHaveLength(1);
      const role = roleCreated[0]!.data.role;
      expect(role).toMatchObject({ title: DEMO_ROLE_TITLE, key: "launch-tester", archetype: "qa", charterVersion: 1, createdBy: lead!.id });
      expect(role.charter.startsWith("You are the Launch tester cat on a MengAI crew, a QA specialist.")).toBe(true);
      expect(role.tools).toEqual(expect.arrayContaining(["finish", "fs_search", "shell_run"]));
      expect(role.tools).not.toContain("fs_write");
      expect(decisions("orch.role")).toHaveLength(1);
      expect(decisions("orch.role")[0]).toMatchObject({ verified: true, stamp: null, action: "define the Launch tester role (qa)" });
      expect(tester).toMatchObject({ roleTitle: DEMO_ROLE_TITLE, roleId: role.id, archetype: "qa" });
      expect(task("Smoke check the page")).toMatchObject({ role: "qa", roleId: role.id, status: "done" });
      expect(snap.roles!.map((r) => r.key)).toEqual(["launch-tester"]);
      const kickoffHires = spawned.filter((e) => pos(e) < pos(stage("hired"))).slice(1);
      expect(kickoffHires.map((e) => e.data.agent.roleTitle)).toEqual(["Engineer", "Designer", DEMO_ROLE_TITLE, "Security"]);
      expect(kickoffHires.every((e) => e.data.hiredBy === lead!.id && e.data.agent.parentId === lead!.id)).toBe(true);
      expect(kickoffHires.map((e) => e.data.reason)).toEqual([
        "The plan needs an engineer: Scaffold the landing page",
        "The plan needs a designer: Draft the landing copy",
        "The plan needs a launch tester: Smoke check the page",
        "The plan needs a security cat: Scan the page for secrets",
      ]);

      // names: Oyen leads, everyone else has a cute name of their own
      const everyone = [...snap.agents, ...(snap.departed ?? [])];
      expect(new Set(everyone.map((a) => a.name)).size).toBe(everyone.length);
      for (const a of everyone) if (a.role !== "lead") expect(CAT_NAMES as readonly string[]).toContain(a.name);

      // kickoff after the plan: the lead plus every planned role, agenda = the task titles
      const meetings = of("meeting.started");
      expect(meetings.map((m) => m.data.kind)).toEqual(["kickoff", "sync", "wrapup"]);
      const [kickoff, sync, wrapup] = meetings;
      expect(kickoff!.data.agenda).toEqual([
        "Scaffold the landing page",
        "Draft the landing copy",
        "Wire the copy into the page",
        "Smoke check the page",
        "Write the project README",
        "Scan the page for secrets",
        "Check the page config",
        "Check the page dependencies",
      ]);
      const firstSecurity = snap.departed![0]!;
      expect(new Set(kickoff!.data.agentIds)).toEqual(new Set([lead!.id, engineer!.id, designer!.id, tester!.id, firstSecurity.id]));
      const endOf = (m: Ev<"meeting.started">) => of("meeting.ended").find((e) => e.data.meetingId === m.data.meetingId)!;
      const kickoffEnd = endOf(kickoff!);
      expect(kickoffEnd.data.notes).toContain("Smoke check the page: Launch tester, after Wire the copy into the page");
      const firstWork = of("task.updated").find((e) => e.data.task.role !== "lead" && e.data.task.status === "running")!;
      expect(pos(firstWork)).toBeGreaterThan(pos(kickoffEnd));

      // the lead deals the tasks
      expect(of("agent.say").some((e) => e.agentId === lead!.id && e.data.to === engineer!.id && e.data.text === `${engineer!.name}, Scaffold the landing page is yours.`)).toBe(true);
      expect(of("agent.say").some((e) => e.agentId === lead!.id && e.data.to === designer!.id && e.data.text.endsWith("Draft the landing copy is yours."))).toBe(true);

      // the engineer grows index.html over three steps and styles.css over two before the review
      const reviewStart = pos(created("Review: Scaffold the landing page"));
      const grow = (path: string) => of("file.changed").filter((e) => e.agentId === engineer!.id && e.data.path === path && pos(e) < reviewStart).map((e) => e.data.bytes);
      const html = grow("index.html");
      const css = grow("styles.css");
      expect(html).toHaveLength(3);
      expect(css).toHaveLength(2);
      for (const sizes of [html, css]) for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeGreaterThan(sizes[i - 1]!);
      expect(of("agent.status").some((e) => e.agentId === engineer!.id && e.data.activity === "code")).toBe(true);

      // the designer hands research off (runtime JEV approves the hire), the researcher reads and writes, the designer drafts in two steps
      expect(snap.handoffs).toHaveLength(1);
      expect(snap.handoffs[0]).toMatchObject({ fromAgentId: designer!.id, toAgentId: researcher!.id, toRole: "researcher" });
      const hires = decisions("orch.hire");
      expect(hires[0]).toMatchObject({ verified: true, action: "hire a researcher" });
      expect(researcher).toMatchObject({ hiredBy: designer!.id, parentId: designer!.id, hireReason: `${designer!.name} needs a researcher: Collect tagline references` });
      expect(hires.slice(1).every((d) => d.action === "the Security queue waits")).toBe(true);
      expect(of("tool.call").some((e) => e.agentId === researcher!.id && e.data.tool === "recall" && e.data.activity === "read")).toBe(true);
      expect(of("file.changed").filter((e) => e.agentId === designer!.id && e.data.path === "copy.md")).toHaveLength(2);

      // a crew cat asks the CEO, the CEO approves, the owner is never asked
      const raised = of("request.raised");
      expect(raised).toHaveLength(1);
      expect(raised[0]!.data).toMatchObject({ fromAgentId: designer!.id, toAgentId: lead!.id, question: DEMO_QUESTION, toOwner: false });
      const decided = of("request.decided");
      expect(decided).toHaveLength(1);
      expect(decided[0]!.data).toMatchObject({ requestId: raised[0]!.data.requestId, byAgentId: lead!.id, byOwner: false, approved: true });
      expect(decided[0]!.data.answer).toStartWith("Approved.");
      expect(of("agent.status").some((e) => e.agentId === designer!.id && e.data.activity === "ask")).toBe(true);
      expect(of("agent.say").some((e) => e.data.to === "human")).toBe(false);
      expect(pos(decided[0]!)).toBeLessThan(pos(of("file.changed").find((e) => e.data.path === "copy.md")!));

      // review fails, the crew syncs on the notes, the owner fixes, the review passes, the CEO signs off
      expect(new Set(sync!.data.agentIds)).toEqual(new Set([reviewer!.id, engineer!.id, lead!.id]));
      expect(sync!.data.agenda).toEqual(["The hero image has no alt text", "The page has no meta description for search and link previews"]);
      const syncEnd = endOf(sync!);
      expect(syncEnd.data.decisions).toEqual([`${engineer!.name} fixes Scaffold the landing page (round 2)`]);
      expect(pos(created("Fix: Scaffold the landing page"))).toBeGreaterThan(pos(syncEnd));
      expect(task("Fix: Scaffold the landing page").status).toBe("done");
      expect(task("Scaffold the landing page").resultSummary).toContain("Review passed (round 2)");
      expect(of("agent.say").some((e) => e.agentId === lead!.id && e.data.text === `Approved: Scaffold the landing page. Nice work, ${engineer!.name}.`)).toBe(true);

      // a reflexion round: the wire task's self-check finds an unchecked change, the engineer searches, the second check passes
      const wire = task("Wire the copy into the page");
      const checks = of("agent.reflexion").filter((e) => e.data.taskId === wire.id);
      expect(checks.map((e) => [e.data.check, e.data.verdict, e.data.by])).toEqual([
        [1, "revise", "critic"],
        [2, "pass", "critic"],
      ]);
      expect(checks[0]!.data.critique).toBe(DEMO_CRITIQUE);
      expect(checks[0]!.data.evidence).toEqual({ files: 1, checks: 0, failedChecks: 0 });
      const search = of("tool.call").find((e) => e.taskId === wire.id && e.data.tool === "fs_search")!;
      expect(pos(search)).toBeGreaterThan(pos(checks[0]!));
      expect(pos(search)).toBeLessThan(pos(checks[1]!));
      expect(wire.resultSummary).toContain("A search for 'goes here' finds nothing");
      // the tester's evidence is conclusive: the rule passes it without a critic call
      expect(of("agent.reflexion").filter((e) => e.agentId === tester!.id).map((e) => e.data.by)).toEqual(["rule"]);
      // reviews and the CEO's own tasks take no self-check
      expect(of("agent.reflexion").some((e) => e.agentId === lead!.id || e.agentId === reviewer!.id)).toBe(false);

      // playbooks: the engineer role (a failed review and a revise) and the security role (three blocks) are tuned; JEV adopts both
      const adopted = decisions("prompt.adopt");
      expect(adopted.map((d) => [d.action, d.verified])).toEqual([
        ["adopt strategy v1 for the Engineer role", true],
        ["adopt strategy v1 for the Security role", true],
      ]);
      const updates = of("strategy.updated");
      expect(updates.map((e) => [e.data.subject, e.data.subjectKey, e.data.version, e.data.choice])).toEqual([
        ["role", "engineer", 1, "adopt"],
        ["role", "security", 1, "adopt"],
      ]);
      expect(updates[0]!.data.text).toContain("prove each acceptance item");
      expect(updates[0]!.data.scores.candidate).toBeGreaterThan(updates[0]!.data.scores.current);
      expect(pos(updates[0]!)).toBeGreaterThan(pos(checks[0]!));

      // a cat let go and a replacement hired: the first security cat blocks three checks, JEV lets it go, its checks go back on the board
      const left = of("agent.left");
      expect(left).toHaveLength(1);
      expect(left[0]!.agentId).toBe(firstSecurity.id);
      expect(left[0]!.data.byAgentId).toBe(lead!.id);
      const securityTitles = ["Scan the page for secrets", "Check the page config", "Check the page dependencies"];
      expect(new Set(left[0]!.data.requeued)).toEqual(new Set(securityTitles.map((t) => task(t).id)));
      expect(left[0]!.data.reason).toStartWith("Let go after 3 failures in a row.");
      expect(firstSecurity.leftReason).toBe(left[0]!.data.reason);
      expect(decisions("orch.let_go")).toHaveLength(1);
      expect(decisions("orch.let_go")[0]).toMatchObject({ verified: true, action: `let ${firstSecurity.name} go` });
      const blocked = of("task.updated").filter((e) => e.data.task.status === "blocked" && e.data.task.assigneeId === firstSecurity.id);
      expect(blocked).toHaveLength(3);
      expect(security!.id).not.toBe(firstSecurity.id);
      expect(security!.hireReason).toBe(`Replaces ${firstSecurity.name}: Scan the page for secrets`);
      const replaced = spawned.find((e) => e.data.agent.id === security!.id)!;
      expect(pos(replaced)).toBeGreaterThan(pos(left[0]!));
      expect(pos(replaced)).toBeGreaterThan(pos(updates[1]!));
      for (const t of securityTitles) expect(task(t)).toMatchObject({ status: "done", assigneeId: security!.id });
      expect(snap.agents.filter((a) => a.role === "security")).toHaveLength(1);

      // the Launch tester runs two tests: a placeholder search and the one smoke check
      const qaTools = of("tool.call").filter((e) => e.agentId === tester!.id).map((e) => e.data.tool);
      expect(qaTools).toEqual(expect.arrayContaining(["fs_search", "shell_run"]));
      expect(runner.seen.map((r) => r.command)).toEqual([DEMO_SMOKE]);
      expect(of("agent.status").some((e) => e.agentId === tester!.id && e.data.activity === "run")).toBe(true);
      expect(stage("testing").data.reason).toBe(`${tester!.name} is testing: Smoke check the page`);

      // an idle cat with nothing queued takes a coffee break
      expect(of("agent.status").some((e) => e.data.activity === "rest" && e.data.statusText === "Coffee break in the pantry")).toBe(true);

      // everyone still at the company meets for the wrap-up, then the lead writes the report
      expect(wrapup!.data.agentIds).toHaveLength(snap.agents.length);
      expect(wrapup!.data.agentIds).not.toContain(firstSecurity.id);
      const wrapEnd = endOf(wrapup!);
      expect(wrapEnd.data.notes).toHaveLength(9);
      expect(wrapEnd.data.notes.every((n) => n.includes(": done by "))).toBe(true);
      expect(pos(created("Report to the owner"))).toBeGreaterThan(pos(wrapEnd));
      expect(task("Report to the owner").resultSummary).toContain("Whisker Cafe landing page is ready");
      expect(pos(stage("shipped"))).toBeLessThan(pos(of("run.status").find((e) => e.data.status === "done")!));

      // the snapshot keeps the meetings for a reload, and the brain decisions with the catalog ones
      expect((snap.meetings ?? []).map((m) => m.kind)).toEqual(["kickoff", "sync", "wrapup"]);
      expect(snap.meetings!.every((m) => m.endedAt !== null)).toBe(true);
      const ids = new Set(snap.decisions.map((d) => d.decisionId));
      for (const id of ["orch.role", "orch.hire", "orch.let_go", "prompt.adopt"]) expect(ids.has(id)).toBe(true);

      // what is in their heads: the tester's own charter, the engineer's adopted playbook
      const testerMind = await container.modules.runs.service.mind(runId, tester!.id);
      expect(testerMind.charter).toMatchObject({ dynamic: true, title: DEMO_ROLE_TITLE, version: 1 });
      expect(testerMind.charter.text.startsWith("You are the Launch tester cat")).toBe(true);
      expect(testerMind.decisions.map((d) => d.decisionId)).toContain("orch.role");
      const engineerMind = await container.modules.runs.service.mind(runId, engineer!.id);
      expect(engineerMind.layerVersion).toBe("c1.r1");
      expect(engineerMind.addenda.map((x) => [x.subject, x.subjectKey, x.version, x.choice])).toEqual([["role", "engineer", 1, "adopt"]]);
      expect(engineerMind.addenda[0]!.decision).toMatchObject({ verified: true, stamp: null });
      expect(engineerMind.addenda[0]!.evidence!.billableInputTokens.candidate).toBeLessThan(engineerMind.addenda[0]!.evidence!.billableInputTokens.legacy);
      expect(engineerMind.history[0]!.version).toBe(1);
      const gone = await container.modules.runs.service.mind(runId, firstSecurity.id);
      expect(gone.decisions.map((d) => d.decisionId)).toContain("orch.let_go");

      // the files on disk: the grown stylesheet is exactly the scripted one
      const root = await container.modules.projects.service.root(projectId);
      expect(await readFile(join(root, "styles.css"), "utf8")).toBe(DEMO_CSS);
      const page = await readFile(join(root, "index.html"), "utf8");
      expect(page).not.toContain("<!--");
      expect(page).toContain("Slow coffee. Soft paws.");
    } finally {
      await container.close();
    }
  }, 40_000);
});

describe("demo crew: script units", () => {
  const charter = (r: AgentRole) => `charter:${r}`;
  const roles = demoCharters(charter);
  const req = (role: AgentRole, task: string, steps: number, spec = "", system = charter(role)): ChatRequest => ({
    model: "m",
    system,
    messages: [
      { role: "user", content: `Your task: ${task}\n${spec}` },
      ...Array.from({ length: steps }, () => ({ role: "assistant" as const, content: "" })),
    ],
  });
  const side = (system: string, content: string): ChatRequest => ({ model: "m", system, messages: [{ role: "user", content }] });

  test("the security checks are opt in: three planned, the first cat blocks, the coached one scans", () => {
    const planning = req("lead", "Plan the work", 1, "Call create_tasks once");
    const tasksOf = (opts?: { securityScan?: boolean }) =>
      (demoTurn(planning, roles, opts).toolCalls![0]!.arguments as { tasks: Array<{ role: string; role_title?: string }> }).tasks;
    expect(tasksOf().map((t) => t.role)).not.toContain("security");
    expect(tasksOf({ securityScan: true }).filter((t) => t.role === "security")).toHaveLength(3);
    expect(tasksOf().find((t) => t.role_title)).toMatchObject({ role: "qa", role_title: DEMO_ROLE_TITLE });
    const stuck = (step: number) => demoTurn(req("security", "Scan the page for secrets", step), roles, { securityScan: true }).toolCalls![0]!;
    expect(stuck(0).name).toBe("scan_deps");
    expect(stuck(1)).toMatchObject({ name: "finish", arguments: { outcome: "blocked" } });
    const coached = `${charter("security")}\n\nRole strategy v1 (learned from this crew's recent outcomes, apply it):\n- rule`;
    const scan = (title: string, step: number) => demoTurn(req("security", title, step, "", coached), roles, { securityScan: true }).toolCalls![0]!.name;
    expect([scan("Scan the page for secrets", 0), scan("Check the page config", 0), scan("Check the page dependencies", 0), scan("Check the page config", 1)]).toEqual([
      "scan_secrets",
      "scan_config",
      "fs_list",
      "finish",
    ]);
  });

  test("a dynamic role is read from its charter header; the wire task has a round after the self-check", () => {
    const tester = `You are the ${DEMO_ROLE_TITLE} cat on a MengAI crew, a QA specialist.\n- Test the page.`;
    expect(demoTurn(req("qa", "Smoke check the page", 2, "", tester), roles).toolCalls![0]!.name).toBe("shell_run");
    const wire = (step: number) => demoTurn(req("engineer", "Wire the copy into the page", step), roles).toolCalls![0]!.name;
    expect([wire(0), wire(1), wire(2), wire(3), wire(4)]).toEqual(["fs_read", "fs_edit", "finish", "fs_search", "finish"]);
  });

  test("the brain's side calls get scripted JSON: critic, playbook candidate, role charter", () => {
    const critic = (task: string, check: number) => JSON.parse(demoTurn(side(REFLEXION_SYSTEM, `Task: ${task}\nAcceptance: none given\nSelf-check ${check} of 3.`), roles).text!);
    expect(critic("Wire the copy into the page", 1)).toEqual({ verdict: "revise", critique: DEMO_CRITIQUE });
    expect(critic("Wire the copy into the page", 2).verdict).toBe("pass");
    expect(critic("Draft the landing copy", 1).verdict).toBe("pass");
    const rules = (role: string) => JSON.parse(demoTurn(side(STRATEGY_SYSTEM, `Role: ${role} (X)\nCurrent strategy: none`), roles).text!).rules as string[];
    expect(rules("security")[0]).toContain("no lockfile");
    expect(rules("engineer")[0]).toContain("prove each acceptance item");
    const charterReply = JSON.parse(demoTurn(side(ROLE_SYSTEM, `New role: ${DEMO_ROLE_TITLE}`), roles).text!);
    expect(charterReply.charter.length).toBeGreaterThanOrEqual(3);
    expect(charterReply.tools).toContain("shell_run");
  });

  test("the demo judge: a new qa role, handoffs hire, queues wait, the stuck cat goes, playbooks are adopted", async () => {
    const judge = createDemoJudge();
    const ask = async (decisionId: string, questions: Record<string, unknown> = {}) => {
      const r = await judge.decide({ decisionId, state: {}, questions: questions as never });
      return r.verified ? Object.fromEntries(Object.entries(r.answers).map(([k, v]) => [k, v.type === "choice" ? v.choice : null])) : null;
    };
    expect(await ask("orch.role")).toEqual({ need: "new_role", archetype: "qa" });
    expect(await ask("orch.hire", { hire: { type: "choice", instructions: "", criteria: { hire: "", self: "" } } })).toEqual({ hire: "hire" });
    expect(await ask("orch.hire", { hire: { type: "choice", instructions: "", criteria: { hire: "", wait: "" } } })).toEqual({ hire: "wait" });
    expect(await ask("orch.let_go")).toEqual({ decision: "let_go" });
    expect(await ask("prompt.adopt")).toEqual({ adopt: "adopt" });
    expect(await ask("orch.unknown")).toBeNull();
    expect(createDemoRouter({ charter }).judge).toBeDefined();
  });

  test("the CEO call gets a scripted approval as JSON", () => {
    const out = demoTurn({ model: "m", system: CEO_SYSTEM, messages: [{ role: "user", content: `Goal: g\nCrew member: Moci (Designer), task: t\nQuestion: ${DEMO_QUESTION}` }] }, roles);
    expect(JSON.parse(out.text!)).toEqual({ decision: "approve", answer: "Approved. Two short beats sound like the room. Keep the hero line under twelve words." });
    expect(out.toolCalls).toBeUndefined();
  });

  test("meetings hold 6 to 10 s at the default pace and scale with a custom pace", () => {
    expect(DEMO_PACE_MS).toEqual([2200, 4200]);
    expect(DEMO_MEETING_MS).toEqual([6000, 10_000]);
    expect(demoMeetingMs()).toEqual([6000, 10_000]);
    expect(demoMeetingMs([2200, 4200])).toEqual([6000, 10_000]);
    expect(demoMeetingMs([1, 3])).toEqual([3, 7]);
    expect(createDemoRouter({ charter }).company).toEqual({ meetingMs: [6000, 10_000] });
    expect(createDemoRouter({ charter, meetingMs: [5, 5] }).company).toEqual({ meetingMs: [5, 5] });
  });
});
