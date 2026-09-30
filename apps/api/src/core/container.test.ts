// Integration tests for the composition root: embedded migrations, runner
// choice, every route in @mengai/shared Routes mounted under a session, and
// the scripted demo crew driving a full run through the real orchestrator,
// tools and workspace. In-memory SQLite, kv and vault; a fake runner.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "@mengai/config";
import { CSRF_HEADER, SESSION_COOKIE, type MengaiEvent, type RouteKey } from "@mengai/shared";
import type { Hono } from "hono";
import { createDb } from "./adapters/db-bunsql";
import { buildConfig } from "./config";
import { AUTOMATION_REASON, createContainer, envFlag, runnerKind, type Container } from "./container";
import { DEMO_GOAL, DEMO_PROJECT_NAME, FUND_DEMO_PROJECT_NAME } from "./demo";
import { EMBEDDED_MIGRATIONS, loadMigrations, MIGRATIONS_ROOT } from "./migrate";
import type { ExecRequest, ExecResult, Runner } from "./ports/runner";
import { memoryKv, memoryVault, silentLogger } from "../testing";

// Same trick as index.test.ts: the root bunfig preloads happy-dom, whose
// Request drops Origin and Cookie. Use Bun's native fetch classes here.
const native = (await import(String("undici"))) as { Request: typeof Request; Response: typeof Response; Headers: typeof Headers };
const saved = { Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers };
beforeAll(() => {
  Object.assign(globalThis, { Request: native.Request, Response: native.Response, Headers: native.Headers });
});

const temps: string[] = [];
afterAll(async () => {
  Object.assign(globalThis, saved);
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mengai-container-"));
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

const HOST = "127.0.0.1:4321";
const BASE = `http://${HOST}`;

async function localContainer(demo: Parameters<typeof createContainer>[0]["demo"] = false) {
  const dataDir = await tempDir();
  const workspaces = await tempDir();
  const boot = buildConfig(parseEnv({ MENGAI_MODE: "local", MENGAI_DATA_DIR: dataDir, MENGAI_WORKSPACES_DIR: workspaces }));
  boot.app.allowedHosts.push(HOST, "localhost:4321");
  const runner = fakeRunner();
  const container = await createContainer({
    boot,
    logger: silentLogger,
    // a bare in-memory db: the container applies the embedded migrations itself
    overrides: { db: createDb({ url: ":memory:" }), kv: memoryKv(), vault: memoryVault(), runner },
    demo,
  });
  return { container, runner, workspaces };
}

function send(app: Hono, path: string, init: { method?: string; body?: string; cookie?: string } = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = {};
  if (method !== "GET" && method !== "HEAD") {
    headers.origin = BASE;
    headers[CSRF_HEADER] = "1";
  }
  if (init.cookie) headers.cookie = `${SESSION_COOKIE}=${init.cookie}`;
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(init.body));
  }
  return Promise.resolve(app.fetch(new native.Request(`${BASE}${path}`, { method, headers, body: init.body })));
}

async function session(c: Container): Promise<string> {
  const res = await send(c.app, "/api/auth/launch", { method: "POST", body: JSON.stringify({ token: c.modules.auth.service.issueLaunchToken() }) });
  expect(res.status).toBe(200);
  return new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(res.headers.getSetCookie().join(", "))?.[1] ?? "";
}

// Every key of Routes. The type check below fails when a route is added to
// @mengai/shared without being listed here.
const ROUTES = [
  "GET /api/health",
  "GET /api/session",
  "POST /api/auth/setup",
  "POST /api/auth/login",
  "POST /api/auth/launch",
  "POST /api/auth/pair",
  "GET /api/providers",
  "GET /api/providers/presets",
  "POST /api/providers",
  "PATCH /api/providers/:id",
  "DELETE /api/providers/:id",
  "POST /api/providers/:id/test",
  "GET /api/routing",
  "PUT /api/routing",
  "GET /api/projects",
  "POST /api/projects",
  "GET /api/projects/:id",
  "DELETE /api/projects/:id",
  "GET /api/projects/:id/files",
  "GET /api/projects/:id/file",
  "GET /api/runs",
  "POST /api/runs",
  "POST /api/runs/estimate",
  "GET /api/runs/:id",
  "POST /api/runs/:id/pause",
  "POST /api/runs/:id/resume",
  "POST /api/runs/:id/stop",
  "POST /api/runs/:id/message",
  "PATCH /api/runs/:id/budget",
  "PATCH /api/runs/:id/tasks/:taskId",
  "POST /api/runs/:id/agents/:agentId/stop",
  "GET /api/runs/:id/calls",
  "GET /api/runs/:id/tools/:callId",
  "GET /api/runs/:id/xray/:agentId",
  "GET /api/events",
  "GET /api/usage",
  "GET /api/decisions",
  "GET /api/memory/lessons",
  "PATCH /api/memory/lessons/:id",
  "DELETE /api/memory/lessons/:id",
  "GET /api/memory/skills",
  "DELETE /api/memory/skills/:id",
  "GET /api/evals",
  "POST /api/evals/run",
  "GET /api/assets",
  "POST /api/assets",
  "GET /api/assets/:id/file",
  "DELETE /api/assets/:id",
  "POST /api/security/scans",
  "GET /api/security/scans",
  "GET /api/security/scans/:id/findings",
  "PATCH /api/security/findings/:id",
  "GET /api/automation/status",
  "POST /api/automation/permissions/request",
  "GET /api/automation/grants",
  "PUT /api/automation/grants/:capability",
  "GET /api/automation/approvals",
  "POST /api/automation/approvals/:id",
  "GET /api/automation/audit",
  "GET /api/automation/audit/verify",
  "GET /api/automation/frames/:id",
  "GET /api/runs/:id/agents/:agentId/mind",
  "GET /api/connectors",
  "POST /api/connectors",
  "PATCH /api/connectors/:id",
  "DELETE /api/connectors/:id",
  "POST /api/connectors/:id/test",
  "GET /api/trading/venues",
  "POST /api/trading/venues",
  "PATCH /api/trading/venues/:id",
  "DELETE /api/trading/venues/:id",
  "POST /api/trading/venues/:id/learn",
  "GET /api/trading/settings",
  "PUT /api/trading/settings",
  "GET /api/trading/orders",
  "GET /api/trading/positions",
  "POST /api/trading/orders/:id/decision",
  "POST /api/killswitch",
  "GET /api/settings",
  "PATCH /api/settings",
  "POST /api/local/pick-folder",
  // last: it ends the session the other probes use
  "POST /api/auth/logout",
] as const satisfies readonly RouteKey[];
type Unlisted = Exclude<RouteKey, (typeof ROUTES)[number]>;
const everyRouteListed: [Unlisted] extends [never] ? true : Unlisted = true;

/**
 * Not served by the API in this build: local computer control (automation)
 * is out of scope, and the folder picker is a native command of the desktop
 * shell. Probed only for a clean JSON answer.
 */
const NOT_IN_BUILD = (route: string) => route.includes(" /api/automation/") || route === "POST /api/local/pick-folder";

describe("migrations", () => {
  test("the embedded set matches migrations/<dialect>/*.sql byte for byte", async () => {
    for (const dialect of ["sqlite", "postgres"] as const) {
      const files = (await readdir(join(MIGRATIONS_ROOT, dialect))).filter((f) => f.endsWith(".sql")).sort();
      expect(EMBEDDED_MIGRATIONS[dialect].map((m) => m.version)).toEqual(files);
      const fromDisk = await loadMigrations(dialect, MIGRATIONS_ROOT);
      const embedded = await loadMigrations(dialect);
      expect(embedded).toEqual(fromDisk);
      for (const m of embedded) expect(m.sql.length).toBeGreaterThan(100);
    }
  });

  test("a bad MENGAI_MIGRATIONS_DIR override fails loudly", async () => {
    const empty = await tempDir();
    await expect(loadMigrations("sqlite", join(empty, "nope"))).rejects.toThrow(/migrations folder not found/);
  });
});

describe("container", () => {
  test("runner by platform and env flags", () => {
    expect(runnerKind("darwin")).toBe("seatbelt");
    expect(runnerKind("linux")).toBe("plain");
    expect(["1", "true", "YES", " 1 "].every(envFlag)).toBe(true);
    expect(["", "0", "false", undefined].some((v) => envFlag(v))).toBe(false);
  });

  test("every route in Routes is mounted and answers under a session", async () => {
    expect(everyRouteListed).toBe(true);
    const { container } = await localContainer();
    try {
      expect(container.killswitch.hooks().sort()).toEqual(["connectors", "runner", "runs.orchestrator", "trading"]);
      const cookie = await session(container);
      const health = await (await send(container.app, "/api/health")).json();
      expect(health).toMatchObject({ ok: true, mode: "local", automation: { available: false } });
      expect(AUTOMATION_REASON).toBe("not included in this build");

      const missing: string[] = [];
      for (const route of ROUTES) {
        const [method, pattern] = route.split(" ") as [string, string];
        const path = pattern.replace(/:[A-Za-z]+/g, "missing-id");
        // an array body is invalid for every JSON route: validation answers without side effects
        const body = method === "GET" || method === "DELETE" ? undefined : "[]";
        const res = await send(container.app, path, { method, body, cookie });
        if (route === "GET /api/events") {
          expect(res.status).toBe(200);
          expect(res.headers.get("content-type")).toContain("text/event-stream");
          await res.body?.cancel();
          continue;
        }
        const type = res.headers.get("content-type") ?? "";
        const json = type.includes("application/json") ? ((await res.json()) as { error?: { message?: string } }) : (await res.body?.cancel(), null);
        expect(res.status).toBeLessThan(500);
        const unrouted = res.status === 404 && json?.error?.message === "No such API route";
        if (NOT_IN_BUILD(route)) continue;
        if (unrouted) missing.push(route);
      }
      expect(missing).toEqual([]);
    } finally {
      await container.close();
    }
  });

  test("capabilities are wired: connector tools reach the bridge and the paper broker, the kill switch stops both", async () => {
    const { container } = await localContainer();
    try {
      const m = container.modules;
      const fixture = join(import.meta.dir, "..", "modules", "connectors", "fixtures", "fake-mcp.ts");
      const dto = await m.connectors.service.create({ kind: "mcp_stdio", label: "fake", target: `${process.execPath} ${fixture}` });
      expect(dto.status).toBe("connected");
      const specs = await m.tools.service.taskSpecs({ role: "engineer", runId: "r1", taskId: "t1", grants: ["get_quote"] });
      expect(specs.map((s) => s.name)).toEqual(["get_quote", "find_tools"]);
      const project = await m.projects.service.create({ name: "Wiring" });
      const root = await m.projects.service.root(project.id);
      const tc = { runId: "r1", agentId: "a1", taskId: "t1", projectId: project.id, root, role: "engineer" as const, grants: ["get_quote"] };
      // get_quote reads the connector's price tool through the trading service
      const q = await m.tools.service.execute({ id: "x1", name: "get_quote", arguments: '{"symbol":"ABC"}' }, tc);
      expect(q.output).toBe("ABC last price 101.25 (source: fake.get_price)");
      const found = await m.tools.service.execute({ id: "x2", name: "find_tools", arguments: '{"query":"echo text"}' }, tc);
      expect(found.output).toContain("fake__echo (write)");
      expect((await m.tools.service.execute({ id: "x3", name: "fake__echo", arguments: '{"text":"wired"}' }, tc)).output).toBe("echo: wired ");
      const result = await container.killswitch.trigger("user");
      expect(result.killedProcesses).toBe(1);
      expect(await m.trading.service.halted()).toBe(true);
      expect((await m.connectors.service.list())[0]!.status).toBe("error");
    } finally {
      await container.close();
    }
  }, 20_000);

  test("demo mode: the seeded crew run plays through to done", async () => {
    const { container, runner, workspaces } = await localContainer({ paceMs: [1, 4] });
    try {
      const seed = container.demo?.seed;
      expect(seed).toBeTruthy();
      const { projectId, runId } = seed!;
      const projects = await container.modules.projects.service.list();
      expect(projects.map((p) => p.name).sort()).toEqual([DEMO_PROJECT_NAME, FUND_DEMO_PROJECT_NAME].sort());
      expect(seed!.fund).toBeTruthy();

      const status = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("demo run did not finish in 30 s")), 30_000);
        const off = container.modules.events.service.subscribe((e: MengaiEvent) => {
          if (e.type !== "run.status" || e.runId !== runId) return;
          const s = (e as MengaiEvent<"run.status">).data.status;
          if (s === "done" || s === "failed" || s === "stopped") {
            clearTimeout(timer);
            off();
            resolve(s);
          }
        });
      });
      const snap = await container.modules.runs.service.snapshot(runId);
      expect(status).toBe("done");
      expect(snap.run.goal).toBe(DEMO_GOAL);

      // seven cats, one per role
      expect(snap.agents.map((a) => a.role).sort()).toEqual(["designer", "engineer", "lead", "qa", "researcher", "reviewer", "security"]);
      const byTitle = new Map(snap.tasks.map((t) => [t.title, t] as const));
      for (const title of ["Plan the work", "Scaffold the landing page", "Draft the landing copy", "Wire the copy into the page", "Smoke check the page", "Write the project README"]) {
        expect(byTitle.get(title)?.status).toBe("done");
      }
      // planned once, reported once
      expect(snap.tasks.filter((t) => t.role === "engineer" && t.title === "Scaffold the landing page")).toHaveLength(1);
      const leadTasks = snap.tasks.filter((t) => t.role === "lead");
      expect(leadTasks).toHaveLength(2);
      const report = leadTasks.find((t) => t.title !== "Plan the work")!;
      expect(report.status).toBe("done");
      expect(report.resultSummary).toContain("Whisker Cafe landing page is ready");
      const wire = byTitle.get("Wire the copy into the page")!;
      expect(wire.deps.sort()).toEqual([byTitle.get("Scaffold the landing page")!.id, byTitle.get("Draft the landing copy")!.id].sort());
      // the reviewer rejected once, the fix landed, then the review passed
      const reviews = snap.tasks.filter((t) => t.role === "reviewer").map((t) => t.resultSummary ?? "");
      expect(reviews.length).toBe(2);
      expect(reviews.some((r) => r.startsWith("fail:"))).toBe(true);
      expect(reviews.some((r) => r.startsWith("pass:"))).toBe(true);
      expect(byTitle.get("Fix: Scaffold the landing page")?.status).toBe("done");
      // one handoff, designer to researcher
      expect(snap.handoffs).toHaveLength(1);
      expect(snap.handoffs[0]!.toRole).toBe("researcher");

      // real files in the jailed workspace
      const root = await container.modules.projects.service.root(projectId);
      expect(root.startsWith(await realpath(workspaces))).toBe(true);
      const html = await readFile(join(root, "index.html"), "utf8");
      expect(html).toContain('alt="A ginger cat asleep next to a latte"');
      expect(html).toContain('<meta name="description"');
      expect(html).toContain("Slow coffee. Soft paws.");
      expect(html).not.toContain("goes here");
      for (const f of ["styles.css", "copy.md", "README.md", "notes/taglines.md"]) expect((await readFile(join(root, f), "utf8")).length).toBeGreaterThan(50);

      // QA ran exactly one harmless echo inside the workspace
      expect(runner.seen.map((r) => r.command)).toEqual(["echo 'smoke check: index.html, styles.css and copy.md are in place'"]);
      expect(runner.seen[0]!.cwd.startsWith(root)).toBe(true);

      // usage moved like a real run, under the scripted demo model
      expect(snap.run.usage.inputTokens).toBeGreaterThan(1000);
      const calls = await container.modules.usage.service.listCalls(runId);
      expect(calls.length).toBeGreaterThan(15);
      expect(new Set(calls.map((c) => c.model))).toEqual(new Set(["mengai-demo-crew"]));
    } finally {
      await container.close();
    }
  }, 40_000);

  test("demo mode seeds only on first boot", async () => {
    const dataDir = await tempDir();
    const workspaces = await tempDir();
    const env = { MENGAI_MODE: "local", MENGAI_DATA_DIR: dataDir, MENGAI_WORKSPACES_DIR: workspaces };
    const db = createDb({ url: ":memory:" });
    const boot = buildConfig(parseEnv(env));
    const overrides = { db, kv: memoryKv(), vault: memoryVault(), runner: fakeRunner() };
    const first = await createContainer({ boot, logger: silentLogger, overrides, demo: { paceMs: [1, 2] } });
    expect(first.demo?.seed).toBeTruthy();
    await first.close();
    const second = await createContainer({ boot: buildConfig(parseEnv(env)), logger: silentLogger, overrides, demo: { paceMs: [1, 2] } });
    try {
      expect(second.demo).toEqual({ seed: null });
      expect(await second.modules.projects.service.list()).toHaveLength(2);
    } finally {
      await second.close();
      await db.close();
    }
  });
});
