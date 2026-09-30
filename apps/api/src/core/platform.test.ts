// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Platform features end to end: the container booted as win32 and as linux
// (on any host, the platform is injected) refuses every sandbox-dependent
// feature with the "Coming soon" reason while its safe neighbour keeps
// working, and darwin with a working sandbox keeps every feature on.
//   shell         shell_run dropped from every role, a call is a tool error, the Windows runner refuses
//   liveTrading   live settings, live proposals, the owner's approval, auto trade and live venues refused; paper works
//   mcpStdio      stdio connectors and stdio venue presets refused, an existing one never starts; remote MCP and HTTP work
//   scriptPreview dev scripts answer failed and never spawn; static sites preview
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "@mengai/config";
import { ROLE_TOOLS, type AgentRole, type HealthDTO, type PreviewDTO } from "@mengai/shared";
import type { Hono } from "hono";
import type { ModuleContext } from "./module";
import { createDb } from "./adapters/db-bunsql";
import { RunnerError } from "./adapters/runner-plain";
import { createWindowsRunner } from "./adapters/runner-windows";
import { buildConfig, defaultLocalDataDir } from "./config";
import { createContainer, runnerKind, type Container } from "./container";
import type { ExecRequest, ExecResult, Runner } from "./ports/runner";
import { createConnectorsModule } from "../modules/connectors";
import { createTradingModule } from "../modules/trading";
import { HttpError } from "../lib/http";
import type { PlatformInfo } from "../lib/platform";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger, testPlatform } from "../testing";

// the root bunfig preloads happy-dom, whose Request drops Origin: use Bun's native classes
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
  const dir = await mkdtemp(join(tmpdir(), "mengai-platform-"));
  temps.push(dir);
  return dir;
}

const HOST = "127.0.0.1:4282";
const BASE = `http://${HOST}`;
const LABEL = { win32: "Windows", linux: "Linux" } as const;
const OFF = { shell: false, liveTrading: false, mcpStdio: false, scriptPreview: false };
const ON = { shell: true, liveTrading: true, mcpStdio: true, scriptPreview: true };
const EM_DASH = String.fromCharCode(0x2014);

function fakeRunner(): Runner & { seen: ExecRequest[] } {
  const seen: ExecRequest[] = [];
  return {
    seen,
    async exec(req: ExecRequest): Promise<ExecResult> {
      seen.push(req);
      return { exitCode: 0, signal: null, stdout: "ok\n", stderr: "", truncated: false, timedOut: false, killed: false, durationMs: 1 };
    },
    killAll: async () => 0,
    running: () => 0,
  };
}

interface Booted {
  c: Container;
  runner: ReturnType<typeof fakeRunner>;
  spawned: string[][];
  served: string[];
}

async function boot(os: PlatformInfo, opts: { runner?: boolean } = {}): Promise<Booted> {
  const dataDir = await tempDir();
  const workspaces = await tempDir();
  const cfg = buildConfig(parseEnv({ MENGAI_MODE: "local", MENGAI_DATA_DIR: dataDir, MENGAI_WORKSPACES_DIR: workspaces }));
  cfg.app.allowedHosts.push(HOST, "localhost:4282");
  const runner = fakeRunner();
  const spawned: string[][] = [];
  const served: string[] = [];
  const c = await createContainer({
    boot: cfg,
    logger: silentLogger,
    overrides: { db: createDb({ url: ":memory:" }), kv: memoryKv(), vault: memoryVault(), ...(opts.runner === false ? {} : { runner }) },
    os,
    connectors: { fetch: (async () => new native.Response("ok", { status: 200 })) as unknown as typeof fetch },
    preview: {
      spawn: (argv) => {
        spawned.push(argv);
        throw new Error("a preview process must not start here");
      },
      portFree: async () => true,
      serveStatic: (dir, port) => {
        served.push(dir);
        return { port, stop: async () => undefined };
      },
      which: (cmd) => `/usr/local/bin/${cmd}`,
    },
  });
  return { c, runner, spawned, served };
}

function send(app: Hono, path: string, method = "GET", body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  let text: string | undefined;
  if (method !== "GET") {
    headers.origin = BASE;
    headers["content-type"] = "application/json";
    text = JSON.stringify(body ?? {});
  }
  return Promise.resolve(app.fetch(new native.Request(`${BASE}${path}`, { method, headers, body: text })));
}

async function comingSoon(res: Response, platform: "win32" | "linux", feature: string): Promise<void> {
  expect(res.status).toBe(422);
  const body = (await res.json()) as { error: { code: string; message: string } };
  expect(body.error.code).toBe("coming_soon");
  expect(body.error.message.startsWith(`Coming soon on ${LABEL[platform]}: ${feature}.`)).toBe(true);
  expect(body.error.message).not.toContain(EM_DASH);
}

async function project(c: Container, files: Record<string, string>): Promise<{ id: string; root: string }> {
  const p = await c.modules.projects.service.create({ name: "Platform" });
  const root = await c.modules.projects.service.root(p.id);
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
  return { id: p.id, root };
}

const SHELL_ROLES: AgentRole[] = (Object.keys(ROLE_TOOLS) as AgentRole[]).filter((r) => ROLE_TOOLS[r].includes("shell_run"));

describe.each(["win32", "linux"] as const)("platform %s", (platform) => {
  const os = testPlatform(platform);
  const label = LABEL[platform];

  test("health reports the platform with every sandbox feature off", async () => {
    const { c } = await boot(os);
    try {
      expect(c.os).toBe(os);
      const res = await send(c.app, "/api/health");
      expect(res.status).toBe(200);
      const dto = (await res.json()) as HealthDTO;
      expect(dto.platform).toBe(platform);
      expect(dto.features).toEqual(OFF);
    } finally {
      await c.close();
    }
  });

  test("shell: shell_run leaves every role and a call answers the coming soon reason without running", async () => {
    const { c, runner } = await boot(os);
    try {
      const tools = c.modules.tools.service;
      expect(SHELL_ROLES.length).toBeGreaterThan(0);
      for (const role of SHELL_ROLES) expect(tools.specsFor(role).map((s) => s.name)).not.toContain("shell_run");
      expect([...tools.platformOff()]).toEqual(["shell_run"]);
      const { id, root } = await project(c, { "a.txt": "hi" });
      const res = await tools.execute({ id: "s1", name: "shell_run", arguments: '{"command":"echo hi"}' }, { runId: "r1", agentId: "a1", taskId: "t1", projectId: id, root, role: "engineer" });
      expect(res.ok).toBe(false);
      expect(res.output).toStartWith(`error: Coming soon on ${label}: crew shell commands.`);
      expect(runner.seen).toHaveLength(0);
      // file tools still work
      const read = await tools.execute({ id: "s2", name: "fs_read", arguments: '{"path":"a.txt"}' }, { runId: "r1", agentId: "a1", taskId: "t1", projectId: id, root, role: "engineer" });
      expect(read.ok).toBe(true);
    } finally {
      await c.close();
    }
  });

  test("live trading: live settings, live proposals and live venues are refused; paper works", async () => {
    const { c } = await boot(os);
    try {
      const live = { mode: "live", autoTrade: false, maxOrderUsd: 100, dailyLossLimitUsd: 50, allowedSymbols: ["ABC"] };
      await comingSoon(await send(c.app, "/api/trading/settings", "PUT", live), platform, "live trading");
      expect((await (await send(c.app, "/api/trading/settings")).json()).mode).toBe("paper");
      const paper = await send(c.app, "/api/trading/settings", "PUT", { ...live, mode: "paper" });
      expect(paper.status).toBe(200);

      await comingSoon(await send(c.app, "/api/trading/venues", "POST", { preset: "custom-http", mode: "live", target: "https://api.example.com" }), platform, "live trading");
      const venue = await send(c.app, "/api/trading/venues", "POST", { preset: "custom-http", mode: "paper", target: "https://api.example.com" });
      expect(venue.status).toBe(201);
      const venueId = ((await venue.json()) as { id: string }).id;
      await comingSoon(await send(c.app, `/api/trading/venues/${venueId}`, "PATCH", { mode: "live" }), platform, "live trading");
      expect((await send(c.app, `/api/trading/venues/${venueId}`, "PATCH", { label: "Paper desk" })).status).toBe(200);

      const { id, root } = await project(c, {});
      const tc = { runId: "r1", agentId: "a1", taskId: "t1", projectId: id, root, role: "engineer" as const, grants: ["propose_order"] };
      const liveOrder = await c.modules.tools.service.execute(
        { id: "o1", name: "propose_order", arguments: JSON.stringify({ symbol: "ABC", side: "buy", qty: 1, quote: 10, live: true, reason: "breakout test" }) },
        tc,
      );
      expect(liveOrder.ok).toBe(false);
      expect(liveOrder.output).toContain(`Coming soon on ${label}: live trading.`);
      const paperOrder = await c.modules.tools.service.execute(
        { id: "o2", name: "propose_order", arguments: JSON.stringify({ symbol: "ABC", side: "buy", qty: 1, quote: 10, reason: "breakout test" }) },
        tc,
      );
      expect(paperOrder.ok).toBe(true);
      const orders = await c.modules.trading.service.orders();
      expect(orders.map((o) => o.mode)).toEqual(["paper"]);
    } finally {
      await c.close();
    }
  });

  test("stdio MCP: stdio connectors and stdio venue presets are refused; remote MCP and HTTP connectors work", async () => {
    const { c } = await boot(os);
    try {
      await comingSoon(await send(c.app, "/api/connectors", "POST", { kind: "mcp_stdio", label: "local", target: "npx -y some-server" }), platform, "local MCP servers");
      await comingSoon(await send(c.app, "/api/trading/venues", "POST", { preset: "ccxt-mcp", mode: "paper", secrets: { CCXT_MCP_EXCHANGE: "binance" } }), platform, "local MCP servers");
      expect(await c.modules.connectors.service.list()).toHaveLength(0);
      const remote = await send(c.app, "/api/connectors", "POST", { kind: "mcp_http", label: "remote", target: "https://mcp.example.com/mcp" });
      expect(remote.status).toBe(201);
      const http = await send(c.app, "/api/connectors", "POST", { kind: "http_api", label: "api", target: "https://api.example.com" });
      expect(http.status).toBe(201);
      expect(((await http.json()) as { status: string }).status).toBe("connected");
    } finally {
      await c.close();
    }
  });

  test("script preview: a dev script answers failed with the reason and never spawns; a static site previews", async () => {
    const { c, spawned, served } = await boot(os);
    try {
      const script = await project(c, { "package.json": JSON.stringify({ scripts: { dev: "vite" } }) });
      const before = (await (await send(c.app, `/api/projects/${script.id}/preview`)).json()) as PreviewDTO;
      expect(before.status).toBe("failed");
      expect(before.error).toStartWith(`Coming soon on ${label}: live preview of dev scripts.`);
      const res = await send(c.app, `/api/projects/${script.id}/preview`, "POST", {});
      expect(res.status).toBe(200);
      const dto = (await res.json()) as PreviewDTO;
      expect(dto.status).toBe("failed");
      expect(dto.kind).toBe("script");
      expect(dto.error).toStartWith(`Coming soon on ${label}: live preview of dev scripts.`);
      expect(spawned).toHaveLength(0);

      const site = await project(c, { "index.html": "<!doctype html><title>x</title>" });
      const ready = (await (await send(c.app, `/api/projects/${site.id}/preview`, "POST", {})).json()) as PreviewDTO;
      expect(ready.status).toBe("ready");
      expect(ready.kind).toBe("static");
      expect(served).toEqual([site.root]);
    } finally {
      await c.close();
    }
  });
});

describe("platform win32 runner", () => {
  test("the runner selection has a Windows kind and the container builds a runner that refuses, never /bin/sh", async () => {
    expect(runnerKind("win32")).toBe("windows");
    expect(runnerKind("darwin")).toBe("seatbelt");
    expect(runnerKind("linux")).toBe("plain");
    const { c } = await boot(testPlatform("win32"), { runner: false });
    try {
      const err = await c.runner.exec({ command: "echo hi", cwd: "C:\\ws", timeoutMs: 1000, maxOutputBytes: 1024, network: false, writablePaths: ["C:\\ws"] }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(RunnerError);
      expect((err as RunnerError).code).toBe("sandbox_unavailable");
      expect((err as RunnerError).message).toStartWith("Coming soon on Windows: crew shell commands.");
      expect(c.runner.running()).toBe(0);
      expect(await c.runner.killAll()).toBe(0);
    } finally {
      await c.close();
    }
    expect(createWindowsRunner().running()).toBe(0);
  });
});

describe("platform darwin", () => {
  test("with a working sandbox every feature stays on", async () => {
    const { c, runner } = await boot(testPlatform("darwin"));
    try {
      const dto = (await (await send(c.app, "/api/health")).json()) as HealthDTO;
      expect(dto.platform).toBe("darwin");
      expect(dto.features).toEqual(ON);
      const tools = c.modules.tools.service;
      for (const role of SHELL_ROLES) expect(tools.specsFor(role).map((s) => s.name)).toContain("shell_run");
      expect(tools.platformOff().size).toBe(0);
      const { id, root } = await project(c, {});
      const res = await tools.execute({ id: "s1", name: "shell_run", arguments: '{"command":"echo hi"}' }, { runId: "r1", agentId: "a1", taskId: "t1", projectId: id, root, role: "qa" });
      expect(res.ok).toBe(true);
      expect(runner.seen).toHaveLength(1);
      const live = await send(c.app, "/api/trading/settings", "PUT", { mode: "live", autoTrade: false, maxOrderUsd: 100, dailyLossLimitUsd: 50, allowedSymbols: ["ABC"] });
      expect(live.status).toBe(200);
      expect((await live.json()).mode).toBe("live");
    } finally {
      await c.close();
    }
  });

  test("a Mac whose sandbox cannot start turns every feature off with its own reason", async () => {
    const os = testPlatform("darwin", "sandbox-exec self test failed");
    expect(os.features).toEqual(OFF);
    const { c } = await boot(os);
    try {
      const res = await send(c.app, "/api/trading/settings", "PUT", { mode: "live", autoTrade: false, maxOrderUsd: 100, dailyLossLimitUsd: 50, allowedSymbols: ["ABC"] });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("coming_soon");
      expect(body.error.message).toStartWith("Not available on this Mac right now (live trading)");
    } finally {
      await c.close();
    }
  });
});

// ------------------------------------------------ rows made on a Mac, opened elsewhere
function moduleCtx(db: ModuleContext["db"]): ModuleContext {
  return {
    config: { mode: "local", version: "0.0.0-test", dataDir: "/tmp", workspacesDir: "/tmp", webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null },
    db,
    kv: memoryKv(),
    blob: {} as ModuleContext["blob"],
    vault: memoryVault(),
    clock: fakeClock(Date.UTC(2026, 8, 30, 10)),
    logger: silentLogger,
    events: captureEvents(),
  };
}

function fakeVenue() {
  const calls: string[] = [];
  return {
    calls,
    tools: async () => [
      { name: "exch.place_order", connectorId: "conn-1", alias: "exch__place_order", description: "place", risk: "sensitive", money: true, schema: { type: "object", properties: { symbol: {}, side: {}, quantity: {} } } },
    ],
    async call(name: string) {
      calls.push(name);
      return { ok: true, output: '{"status":"filled","avgPrice":10}' };
    },
  };
}

async function rejects(p: Promise<unknown>): Promise<Error> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(Error);
  return e as Error;
}

describe.each(["win32", "linux"] as const)("platform %s with rows a Mac created", (platform) => {
  const label = LABEL[platform];

  test("live trading: the owner's approval, auto trade and a simulated live venue never reach an order tool", async () => {
    const db = await createTestDb();
    const ctx = moduleCtx(db);
    const venue = fakeVenue();
    const mac = createTradingModule(ctx, { venue, platform: testPlatform("darwin") }).service;
    await mac.saveSettings({ mode: "live", autoTrade: false, maxOrderUsd: 1000, dailyLossLimitUsd: 50, allowedSymbols: ["ABC"] });
    const a = await mac.propose({ runId: "r1", agentId: "trader", symbol: "ABC", side: "buy", qty: 1, type: "market", quote: 10, live: true, venue: "exch.place_order", reason: "test order" });
    await mac.review({ runId: "r1", agentId: "risk", orderId: a.id, verdict: "approve", note: "fits the limits" });
    const b = await mac.propose({ runId: "r1", agentId: "trader", symbol: "ABC", side: "sell", qty: 1, type: "market", quote: 10, live: true, venue: "exch.place_order", reason: "test order two" });

    const here = createTradingModule(ctx, { venue, platform: testPlatform(platform) }).service;
    const err = await rejects(here.decide(a.id, "approve"));
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(422);
    expect((err as HttpError).code).toBe("coming_soon");
    expect(err.message).toStartWith(`Coming soon on ${label}: live trading.`);
    // rejecting still works
    expect((await here.decide(a.id, "reject")).status).toBe("rejected");
    // auto trade on: the risk approval keeps the order waiting (the gate answers the reason), nothing is sent
    await here.saveSettings({ mode: "paper", autoTrade: true, maxOrderUsd: 1000, dailyLossLimitUsd: 50, allowedSymbols: ["ABC"] });
    const reviewed = await here.review({ runId: "r1", agentId: "risk", orderId: b.id, verdict: "approve", note: "fits the limits" });
    expect(reviewed.status).toBe("proposed");
    expect(((await rejects(here.decide(b.id, "approve"))) as HttpError).code).toBe("coming_soon");
    expect(venue.calls).toHaveLength(0);
    // a simulated venue asked for live mode comes up in paper
    const sim = await here.connectSimulator({ label: "sim", title: "Sim", tools: [], call: async () => ({ ok: true, output: "{}" }) }, { mode: "live" });
    expect(sim.mode).toBe("paper");
    await here.idle();
  });

  test("stdio MCP: an existing stdio connector is not offered, never starts and cannot be enabled; disabling works", async () => {
    const db = await createTestDb();
    const ctx = moduleCtx(db);
    const spawned: string[][] = [];
    const spawn = (argv: string[]) => {
      spawned.push(argv);
      throw new Error("must not spawn");
    };
    // a Mac made the row: its spawner fails, so the row is saved; mark it connected with a tool as a Mac would have
    const mac = createConnectorsModule(ctx, {}, { spawn, platform: testPlatform("darwin") }).service;
    const made = await mac.create({ kind: "mcp_stdio", label: "local", target: "npx -y some-server" });
    await db.query`update connectors set status = ${"connected"}, error = ${null}, tools = ${JSON.stringify([{ name: "local.echo", local: "echo", remote: "echo", description: "echo", risk: "read", money: false, schema: { type: "object" } }])} where id = ${made.id}`;
    spawned.length = 0;

    const here = createConnectorsModule(ctx, {}, { spawn, platform: testPlatform(platform) }).service;
    expect(await here.tools({})).toHaveLength(0);
    const call = await here.call("local.echo", {});
    expect(call.ok).toBe(false);
    expect(call.output).toContain(`Coming soon on ${label}: local MCP servers.`);
    const tested = await here.test(made.id);
    expect(tested.status).toBe("error");
    expect(tested.error).toStartWith(`Coming soon on ${label}: local MCP servers.`);
    expect(spawned).toHaveLength(0);
    const disabled = await here.update(made.id, { enabled: false });
    expect(disabled.status).toBe("disabled");
    const err = await rejects(here.update(made.id, { enabled: true }));
    expect((err as HttpError).status).toBe(422);
    expect((err as HttpError).code).toBe("coming_soon");
    expect(spawned).toHaveLength(0);
  });
});

describe("Windows basics", () => {
  test("the default data dir is under %LOCALAPPDATA% on Windows and unchanged on macOS", () => {
    expect(defaultLocalDataDir("C:\\Users\\cat", "win32", { LOCALAPPDATA: "C:\\Users\\cat\\AppData\\Local" })).toBe("C:\\Users\\cat\\AppData\\Local\\MengAI");
    expect(defaultLocalDataDir("C:\\Users\\cat", "win32", {})).toBe("C:\\Users\\cat\\AppData\\Local\\MengAI");
    expect(defaultLocalDataDir("/Users/cat", "darwin", {})).toBe("/Users/cat/Library/Application Support/MengAI");
  });
});
