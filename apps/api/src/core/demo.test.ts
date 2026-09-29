// Scenario coverage of the scripted demo crew: one run through the real
// container (orchestrator, tools, workspace) must show every beat the office
// scene choreographs, in a believable order. Pace and meetings run in ms.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "@mengai/config";
import { AGENT_ROLES, type AgentRole, type EventType, type MengaiEvent } from "@mengai/shared";
import { CEO_SYSTEM } from "../modules/runs";
import { createDb } from "./adapters/db-bunsql";
import { buildConfig } from "./config";
import { createContainer } from "./container";
import { DEMO_CSS, DEMO_MEETING_MS, DEMO_PACE_MS, DEMO_QUESTION, DEMO_SMOKE, createDemoRouter, demoMeetingMs, demoTurn } from "./demo";
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
  test("kickoff, dealing, code growth, research, CEO approval, handoff, review fail, sync, fix, tests, coffee, wrap-up, report", async () => {
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
      const [lead, engineer, designer, researcher, reviewer, qa] = (["lead", "engineer", "designer", "researcher", "reviewer", "qa"] as const).map(agent);
      const task = (title: string) => snap.tasks.find((t) => t.title === title)!;
      const created = (title: string) => of("task.created").find((e) => e.data.task.title === title)!;

      // kickoff after the plan: the lead plus every planned role, agenda = the task titles
      const meetings = of("meeting.started");
      expect(meetings.map((m) => m.data.kind)).toEqual(["kickoff", "sync", "wrapup"]);
      const [kickoff, sync, wrapup] = meetings;
      expect(kickoff!.data.agenda).toEqual(["Scaffold the landing page", "Draft the landing copy", "Wire the copy into the page", "Smoke check the page", "Write the project README"]);
      expect(new Set(kickoff!.data.agentIds)).toEqual(new Set([lead!.id, engineer!.id, designer!.id, qa!.id]));
      const endOf = (m: Ev<"meeting.started">) => of("meeting.ended").find((e) => e.data.meetingId === m.data.meetingId)!;
      const kickoffEnd = endOf(kickoff!);
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

      // the designer hands research off, the researcher reads and writes, the designer drafts in two steps
      expect(snap.handoffs).toHaveLength(1);
      expect(snap.handoffs[0]).toMatchObject({ fromAgentId: designer!.id, toAgentId: researcher!.id, toRole: "researcher" });
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

      // QA runs two tests: a placeholder search and the one smoke check
      const qaTools = of("tool.call").filter((e) => e.agentId === qa!.id).map((e) => e.data.tool);
      expect(qaTools).toEqual(expect.arrayContaining(["fs_search", "shell_run"]));
      expect(runner.seen.map((r) => r.command)).toEqual([DEMO_SMOKE]);
      expect(of("agent.status").some((e) => e.agentId === qa!.id && e.data.activity === "run")).toBe(true);

      // an idle cat with nothing queued takes a coffee break
      expect(of("agent.status").some((e) => e.data.activity === "rest" && e.data.statusText === "Coffee break in the pantry")).toBe(true);

      // everyone meets for the wrap-up, then the lead writes the report
      expect(wrapup!.data.agentIds).toHaveLength(snap.agents.length);
      const wrapEnd = endOf(wrapup!);
      expect(wrapEnd.data.notes).toHaveLength(6);
      expect(wrapEnd.data.notes.every((n) => n.includes(": done by "))).toBe(true);
      expect(pos(created("Report to the owner"))).toBeGreaterThan(pos(wrapEnd));
      expect(task("Report to the owner").resultSummary).toContain("Whisker Cafe landing page is ready");

      // the snapshot keeps the meetings for a reload
      expect((snap.meetings ?? []).map((m) => m.kind)).toEqual(["kickoff", "sync", "wrapup"]);
      expect(snap.meetings!.every((m) => m.endedAt !== null)).toBe(true);

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
  const roles = new Map<string, AgentRole>(AGENT_ROLES.map((r) => [charter(r), r] as const));
  const req = (role: AgentRole, task: string, steps: number, spec = ""): ChatRequest => ({
    model: "m",
    system: charter(role),
    messages: [
      { role: "user", content: `Your task: ${task}\n${spec}` },
      ...Array.from({ length: steps }, () => ({ role: "assistant" as const, content: "" })),
    ],
  });

  test("the security scan is opt in: planned, then two scan steps", () => {
    const planning = req("lead", "Plan the work", 1, "Call create_tasks once");
    const tasksOf = (opts?: { securityScan?: boolean }) =>
      (demoTurn(planning, roles, opts).toolCalls![0]!.arguments as { tasks: Array<{ role: string }> }).tasks.map((t) => t.role);
    expect(tasksOf()).not.toContain("security");
    expect(tasksOf({ securityScan: true })).toContain("security");
    const scan = (step: number) => demoTurn(req("security", "Scan the page for secrets", step), roles, { securityScan: true }).toolCalls![0]!.name;
    expect([scan(0), scan(1), scan(2)]).toEqual(["scan_secrets", "scan_config", "finish"]);
  });

  test("the CEO call gets a scripted approval as JSON", () => {
    const out = demoTurn({ model: "m", system: CEO_SYSTEM, messages: [{ role: "user", content: `Goal: g\nCrew member: Mochi (Designer), task: t\nQuestion: ${DEMO_QUESTION}` }] }, roles);
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
