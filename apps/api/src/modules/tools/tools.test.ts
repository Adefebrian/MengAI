// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_ROLES,
  ROLE_TOOLS,
  TOOL_ACTIVITY,
  TOOL_NAMES,
  type AgentRole,
  type AssetDTO,
  type FindingDTO,
  type LessonDTO,
  type OwnerSettings,
  type ScanDTO,
  type SkillDTO,
} from "@mengai/shared";
import { createPlainRunner } from "../../core/adapters/runner-plain";
import type { ModuleContext } from "../../core/module";
import type { Db } from "../../core/ports/db";
import type { ExecRequest, ExecResult, Runner } from "../../core/ports/runner";
import {
  ApprovalDeniedError,
  type AssetsService,
  type AutomationService,
  type MemoryService,
  type SecurityService,
  type SettingsService,
  type ToolContext,
} from "../../core/services";
import { num } from "../../lib/sql";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { createProjectsModule } from "../projects";
import { createWorkspaceModule } from "../workspace";
import { createToolsModule, type ToolsDeps, type ToolsServiceImpl } from "./index";
import { CONTROL_TOOLS, READ_ONLY_TOOLS, TOOL_SPECS } from "./specs";
import { validateArgs, type JsonSchema } from "./validate";
import { assertPublicUrl, htmlToText, isPublicAddress } from "./web";

const made: string[] = [];
afterAll(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
});

const settingsValue: OwnerSettings = {
  defaultBudgetTokens: 400_000,
  defaultBudgetUsd: 5,
  maxConcurrentAgents: 4,
  allowNetworkTools: false,
  motion: "full",
  prices: {},
};

function fakeSettings(over: Partial<OwnerSettings> = {}): SettingsService {
  let v = { ...settingsValue, ...over };
  return {
    get: async () => v,
    patch: async (p) => (v = { ...v, ...p }),
  };
}

function fakeMemory() {
  const calls: Record<string, unknown[]> = { retrieve: [], markUsed: [], record: [], saveSkill: [] };
  const lesson = (id: string, text: string): LessonDTO => ({ id, scope: "project", role: "engineer", projectId: "p", text, tags: [], status: "candidate", uses: 0, wins: 0, losses: 0, score: 0.5, createdAt: 1, lastUsedAt: null });
  const memory: MemoryService = {
    async retrieve(q) {
      calls.retrieve!.push(q);
      return [lesson("l1", "Run bun test before finishing.")];
    },
    async markUsed(ids, c) {
      calls.markUsed!.push({ ids, ...c });
    },
    async recordOutcome() {},
    async record(input) {
      calls.record!.push(input);
      return lesson("l2", input.text);
    },
    async reflect() {
      return null;
    },
    async saveSkill(input) {
      calls.saveSkill!.push(input);
      return { id: "s1", name: input.name, description: input.description, role: input.role, steps: input.steps, uses: 0, wins: 0, createdAt: 1 } satisfies SkillDTO;
    },
    async findSkills() {
      return [];
    },
    async runDigest() {
      return null;
    },
    async saveRunDigest() {},
  };
  return { memory, calls };
}

function fakeAssets(): AssetsService & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async generate(input) {
      calls.push(input);
      const a: AssetDTO = { id: "asset-1", runId: input.runId ?? null, kind: input.kind, status: input.kind === "image" ? "done" : "queued", providerId: "p", model: "m", prompt: input.prompt, url: input.kind === "image" ? "/api/assets/asset-1/file" : null, mime: null, width: null, height: null, durationMs: null, costUsd: 0, error: null, createdAt: 1 };
      return a;
    },
  };
}

function fakeSecurity(): SecurityService & { calls: Array<Parameters<SecurityService["scan"]>[0]> } {
  const calls: Array<Parameters<SecurityService["scan"]>[0]> = [];
  return {
    calls,
    async scan(input) {
      calls.push(input);
      const scan: ScanDTO = { id: "scan-1", projectId: input.projectId, kinds: input.kinds, status: "done", counts: { critical: 0, high: 1, medium: 0, low: 0, info: 0 }, error: null, createdAt: 1, finishedAt: 2 };
      const finding: FindingDTO = { id: "f1", scanId: "scan-1", kind: input.kinds[0]!, severity: "high", rule: "aws-key", title: "AWS key committed", file: ".env", line: 3, detail: "AKIA****", fix: null, status: "open" };
      return { scan, findings: [finding] };
    },
  };
}

function fakeAutomation(deny = false): AutomationService & { performed: Array<{ method: string; params: unknown }> } {
  const performed: Array<{ method: string; params: unknown }> = [];
  return {
    performed,
    async status() {
      return { available: true, reason: null, permissions: { accessibility: true, screen: true }, active: false };
    },
    async authorize() {
      return { approvalId: null, risk: "read" };
    },
    async perform(input) {
      if (deny) throw new ApprovalDeniedError("owner said no", "ap-1");
      performed.push({ method: input.method, params: input.params });
      const results: Record<string, unknown> = {
        "input.click": { ok: true },
        "input.move": { ok: true },
        "input.scroll": { ok: true },
        "input.type": { ok: true, chars: 5 },
        "input.key": { ok: true },
        "app.open": { ok: true, bundleId: "com.apple.Safari" },
        "screen.capture": { pngBase64: "AAAA", width: 1440, height: 900, scale: 2 },
        "ax.tree": { root: { role: "AXWindow", title: "Main", frame: { x: 0, y: 0, w: 100, h: 50 }, children: [{ role: "AXSecureTextField", secure: true, value: "hunter2" }] }, truncated: false },
      };
      return results[input.method] as never;
    },
    async audit() {
      throw new Error("unused");
    },
  };
}

function recordingRunner(): Runner & { reqs: ExecRequest[] } {
  const reqs: ExecRequest[] = [];
  return {
    reqs,
    async exec(req): Promise<ExecResult> {
      reqs.push(req);
      return { exitCode: 0, signal: null, stdout: "ok\n", stderr: "", truncated: false, timedOut: false, killed: false, durationMs: 5 };
    },
    async killAll() {
      return 0;
    },
    running: () => 0,
  };
}

let db: Db;
let ctx: ModuleContext;
let events: ReturnType<typeof captureEvents>;
let root: string;
let projectId: string;

async function build(over: Partial<ToolsDeps> = {}, opts: Parameters<typeof createToolsModule>[2] = {}): Promise<{ tools: ToolsServiceImpl; deps: ToolsDeps }> {
  const workspace = createWorkspaceModule(ctx, {}).service;
  const projects = createProjectsModule(ctx, { workspace }).service;
  const project = await projects.create({ name: "Tool Test" });
  projectId = project.id;
  root = project.workspacePath;
  const deps: ToolsDeps = {
    workspace,
    runner: recordingRunner(),
    memory: fakeMemory().memory,
    assets: fakeAssets(),
    security: fakeSecurity(),
    automation: null,
    settings: fakeSettings(),
    projects,
    ...over,
  };
  return { tools: createToolsModule(ctx, deps, opts).service, deps };
}

const tc = (role: AgentRole = "engineer", over: Partial<ToolContext> = {}): ToolContext => ({ runId: "run-1", agentId: "agent-1", taskId: "task-1", projectId, root, role, ...over });
let n = 0;
const call = (name: string, args: unknown) => ({ id: `call_${++n}`, name, arguments: typeof args === "string" ? args : JSON.stringify(args) });

beforeEach(async () => {
  db = await createTestDb();
  const base = await realpath(await mkdtemp(join(tmpdir(), "mengai-tools-")));
  made.push(base);
  events = captureEvents();
  ctx = {
    config: { mode: "local", version: "test", dataDir: join(base, "data"), workspacesDir: join(base, "ws"), webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null },
    db,
    kv: memoryKv(),
    blob: null as never,
    vault: memoryVault(),
    clock: fakeClock(),
    logger: silentLogger,
    events,
  };
});

describe("registry", () => {
  const TYPES = new Set(["object", "string", "integer", "number", "boolean", "array"]);
  function checkSchema(schema: Record<string, unknown>, where: string) {
    expect(TYPES.has(schema.type as string)).toBe(true);
    if (schema.type === "object" && schema.properties) {
      const props = schema.properties as Record<string, Record<string, unknown>>;
      for (const r of (schema.required as string[] | undefined) ?? []) expect(Object.keys(props)).toContain(r);
      for (const [k, v] of Object.entries(props)) checkSchema(v, `${where}.${k}`);
    }
    if (schema.type === "array") checkSchema(schema.items as Record<string, unknown>, `${where}[]`);
    if (schema.enum) expect(Array.isArray(schema.enum)).toBe(true);
  }

  test("every TOOL_NAMES entry has a valid object schema and a short description", () => {
    for (const name of TOOL_NAMES) {
      const spec = TOOL_SPECS[name];
      expect(spec.name).toBe(name);
      expect(spec.parameters.type).toBe("object");
      expect(typeof spec.parameters.properties).toBe("object");
      checkSchema(spec.parameters, name);
      expect(JSON.parse(JSON.stringify(spec.parameters))).toEqual(spec.parameters);
      expect(spec.description.split(/\s+/).length).toBeLessThan(60);
      expect(spec.description).not.toContain(String.fromCharCode(0x2014));
      expect(TOOL_ACTIVITY[name]).toBeDefined();
    }
  });

  test("specsFor follows ROLE_TOOLS and omits what cannot run", async () => {
    const { tools } = await build();
    for (const role of AGENT_ROLES) {
      const names = tools.specsFor(role).map((s) => s.name);
      for (const nm of names) expect(ROLE_TOOLS[role]).toContain(nm as never);
      expect(names).not.toContain("web_search");
      expect(names.some((nm) => ["screen_capture", "ui_tree", "pointer", "keyboard", "app_open", "browser_open"].includes(nm))).toBe(false);
      expect(tools.specsFor(role)).toBe(tools.specsFor(role));
    }
    expect(tools.specsFor("engineer").map((s) => s.name)).toContain("shell_run");
    expect(tools.specsFor("researcher").map((s) => s.name)).toEqual(["finish", "note", "recall", "record_lesson", "web_fetch", "fs_write"]);
    const withHands = (await build({ automation: fakeAutomation() })).tools;
    expect(withHands.specsFor("operator").map((s) => s.name)).toEqual(["finish", "note", "recall", "record_lesson", "ask_human", "save_skill", "screen_capture", "ui_tree", "pointer", "keyboard", "app_open", "fs_list", "fs_read"]);
    const noShell = (await build({ runner: null })).tools;
    expect(noShell.specsFor("engineer").map((s) => s.name)).not.toContain("shell_run");
  });

  test("control and read-only detection", async () => {
    const { tools } = await build();
    const control = ["finish", "note", "ask_human", "handoff", "create_tasks", "update_task", "list_tasks", "crew_status", "submit_review", "report_issue"];
    for (const t of TOOL_NAMES) expect(tools.isControl(t)).toBe(control.includes(t));
    const ro = ["fs_list", "fs_read", "fs_search", "recall", "list_tasks", "crew_status"];
    for (const t of TOOL_NAMES) expect(tools.isReadOnly(t)).toBe(ro.includes(t));
    expect([...CONTROL_TOOLS].sort()).toEqual([...control].sort());
    expect([...READ_ONLY_TOOLS].sort()).toEqual([...ro].sort());
  });

  test("validator enforces the subset and strips unknown keys", () => {
    const schema = TOOL_SPECS.create_tasks.parameters as JsonSchema;
    const task = { key: "a", title: "t", spec: "s", acceptance: ["x"], role: "engineer", extra: 1 };
    const ok = validateArgs(schema, { tasks: [task] });
    expect(ok.ok).toBe(true);
    expect(ok.ok && (ok.value as { tasks: Array<Record<string, unknown>> }).tasks[0]!.extra).toBeUndefined();
    expect(validateArgs(schema, { tasks: [{ ...task, role: "wizard" }] })).toEqual({ ok: false, error: "arguments.tasks[0].role must be one of lead, engineer, designer, reviewer, qa, security, researcher, operator" });
    expect(validateArgs(schema, { tasks: Array.from({ length: 13 }, () => task) }).ok).toBe(false);
    expect(validateArgs(TOOL_SPECS.fs_read.parameters as JsonSchema, { path: "a", from: "3" })).toEqual({ ok: true, value: { path: "a", from: 3 } });
    expect(validateArgs(TOOL_SPECS.fs_read.parameters as JsonSchema, { from: 1 }).ok).toBe(false);
    expect(validateArgs(TOOL_SPECS.shell_run.parameters as JsonSchema, { command: "x", timeout_s: 500 }).ok).toBe(false);
  });
});

describe("execute", () => {
  test("fs_write and fs_read persist redacted tool_calls and publish events", async () => {
    const { tools } = await build();
    const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
    const w = await tools.execute(call("fs_write", { path: "src/config.ts", content: `export const key = "${secret}";\n` }), tc());
    expect(w.ok).toBe(true);
    expect(w.output).toBe("created src/config.ts (63 bytes)");
    const r = await tools.execute(call("fs_read", { path: "src/config.ts" }), tc());
    expect(r.ok).toBe(true);
    expect(r.output).toStartWith("src/config.ts lines 1-1 of 1\n");
    expect(r.output).not.toContain(secret);
    const rows = await db.query<{ id: string; tool: string; args: string; output: string; ok: unknown; run_id: string; agent_id: string; task_id: string }>`select * from tool_calls order by created_at, id`;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.tool).toBe("fs_write");
    expect(rows[0]!.args).not.toContain(secret);
    expect(rows[0]!.args).toContain("[REDACTED]");
    expect(rows[1]!.output).not.toContain(secret);
    expect(num(rows[0]!.ok)).toBe(1);
    expect([rows[0]!.run_id, rows[0]!.agent_id, rows[0]!.task_id]).toEqual(["run-1", "agent-1", "task-1"]);
    expect(rows[0]!.id).toBe(w.callId);
    const detail = await tools.detail("run-1", w.callId);
    expect(detail?.tool).toBe("fs_write");
    expect(await tools.detail("run-other", w.callId)).toBeNull();

    const calls = events.ofType("tool.call");
    const results = events.ofType("tool.result");
    expect(calls.map((e) => [e.data.tool, e.data.activity])).toEqual([
      ["fs_write", "code"],
      ["fs_read", "read"],
    ]);
    expect(calls[0]!.data.callId).toBe(w.callId);
    expect(calls[0]!.data.argsPreview).not.toContain(secret);
    expect(calls[0]!.runId).toBe("run-1");
    expect(results.map((e) => [e.data.tool, e.data.ok])).toEqual([
      ["fs_write", true],
      ["fs_read", true],
    ]);
    expect(results[0]!.data.summary).toBe("created src/config.ts (63 bytes)");
    const changed = events.ofType("file.changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]!.runId).toBe("run-1");
    expect(changed[0]!.agentId).toBe("agent-1");
    expect(changed[0]!.data.path).toBe("src/config.ts");
  });

  test("fs_edit, fs_search, fs_list and fs_delete", async () => {
    const { tools } = await build();
    await writeFile(join(root, "a.txt"), "hello world\nhello again\n");
    expect((await tools.execute(call("fs_edit", { path: "a.txt", find: "hello", replace: "bye" }), tc())).output).toContain("matches 2 times");
    expect((await tools.execute(call("fs_edit", { path: "a.txt", find: "hello", replace: "bye", all: true }), tc())).output).toBe("replaced 2 occurrences in a.txt");
    const s = await tools.execute(call("fs_search", { pattern: "bye", limit: 1 }), tc());
    expect(s.output).toBe("a.txt:1: bye world\n[limit 1 reached; narrow the pattern or glob]");
    expect((await tools.execute(call("fs_list", {}), tc())).output).toBe("a.txt 20B");
    expect((await tools.execute(call("fs_delete", { path: "a.txt" }), tc())).output).toBe("deleted a.txt");
    const esc = await tools.execute(call("fs_read", { path: "../../../../etc/passwd" }), tc());
    expect(esc.ok).toBe(false);
    expect(esc.output).toStartWith("error: path escapes the workspace");
  });

  test("role filtering, bad JSON, validation errors and unknown tools", async () => {
    const { tools } = await build();
    const denied = await tools.execute(call("fs_write", { path: "x", content: "y" }), tc("reviewer"));
    expect(denied).toMatchObject({ ok: false, output: "error: fs_write is not available to the reviewer role" });
    expect(await Bun.file(join(root, "x")).exists()).toBe(false);
    expect((await tools.execute(call("fs_read", "{not json"), tc())).output).toBe("error: arguments are not valid JSON");
    expect((await tools.execute(call("fs_read", {}), tc())).output).toBe("error: arguments.path is required");
    expect((await tools.execute(call("rm_rf", {}), tc())).output).toBe("error: unknown tool rm_rf");
    const rows = await db.query<{ ok: unknown }>`select ok from tool_calls`;
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => num(r.ok) === 0)).toBe(true);
  });

  test("control tools are refused and not persisted", async () => {
    const { tools } = await build();
    const r = await tools.execute(call("finish", { summary: "done" }), tc());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("control tool");
    expect(await db.query`select id from tool_calls`).toHaveLength(0);
    expect(events.events).toHaveLength(0);
  });

  test("a root that does not match the project is refused", async () => {
    const { tools } = await build();
    const other = await realpath(await mkdtemp(join(tmpdir(), "mengai-other-")));
    made.push(other);
    const r = await tools.execute(call("fs_list", {}), tc("engineer", { root: other }));
    expect(r).toMatchObject({ ok: false, output: "error: workspace root does not match the project" });
  });

  test("shell_run passes caps, timeout, jail and the network setting to the runner", async () => {
    const runner = recordingRunner();
    const { tools } = await build({ runner, settings: fakeSettings({ allowNetworkTools: true }) });
    const r = await tools.execute(call("shell_run", { command: "bun test", timeout_s: 30 }), tc());
    expect(r.ok).toBe(true);
    expect(r.output).toBe("exit 0 in 0.0s\nstdout:\nok");
    expect(runner.reqs[0]).toMatchObject({ command: "bun test", cwd: root, timeoutMs: 30_000, maxOutputBytes: 200 * 1024, network: true, writablePaths: [root] });
    await tools.execute(call("shell_run", { command: "ls" }), tc());
    expect(runner.reqs[1]!.timeoutMs).toBe(120_000);
    const off = await build({ runner: recordingRunner() });
    await off.tools.execute(call("shell_run", { command: "ls" }), tc());
    expect((off.deps.runner as ReturnType<typeof recordingRunner>).reqs[0]!.network).toBe(false);
    expect((await off.tools.execute(call("shell_run", { command: "ls", cwd: "../.." }), tc())).ok).toBe(false);
  });

  test("shell_run tells the runner to deny the engine's own port, read live from the Host allowlist", async () => {
    const runner = recordingRunner();
    const { tools } = await build({ runner, settings: fakeSettings({ allowNetworkTools: true }) });
    await tools.execute(call("shell_run", { command: "ls" }), tc());
    expect(runner.reqs[0]!.denyTcpPorts).toEqual([]);
    // the engine fills the allowlist once it listens; the next command picks it up
    ctx.config.allowedHosts.push("127.0.0.1:4190", "localhost:4190");
    await tools.execute(call("shell_run", { command: "curl http://127.0.0.1:4190/api/settings" }), tc());
    expect(runner.reqs[1]!.denyTcpPorts).toEqual([4190]);
  });

  test("shell_run end to end with the plain runner redacts output", async () => {
    const { tools } = await build({ runner: createPlainRunner() });
    const r = await tools.execute(call("shell_run", { command: "echo AKIAABCDEFGHIJKLMNOP; echo oops >&2; exit 3" }), tc());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("exit 3");
    expect(r.output).toContain("[REDACTED]");
    expect(r.output).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(r.output).toContain("stderr:\noops");
  });

  test("web_search and web_fetch gating", async () => {
    const { tools } = await build();
    expect((await tools.execute(call("web_search", { query: "x" }), tc("researcher"))).output).toBe("error: search provider not configured");
    expect((await tools.execute(call("web_fetch", { url: "https://example.com" }), tc("researcher"))).output).toBe("error: network tools are off; the owner can allow them in Settings");
  });

  test("web_fetch reduces HTML and blocks private targets and redirects", async () => {
    const fetched: string[] = [];
    const fakeFetch = (async (url: string | URL | Request) => {
      const u = String(url);
      fetched.push(u);
      if (u.startsWith("https://docs.example.com/redirect")) return new Response(null, { status: 302, headers: { location: "http://10.0.0.5/admin" } });
      return new Response("<html><head><title>Docs</title><script>alert(1)</script></head><body><h1>Guide</h1><p>Use &amp; enjoy <a href=\"/next\">next</a></p></body></html>", { headers: { "content-type": "text/html; charset=utf-8" } });
    }) as typeof fetch;
    const lookup = async (host: string) => (host === "evil.example.com" ? ["192.168.1.10"] : ["93.184.216.34"]);
    const { tools } = await build({ settings: fakeSettings({ allowNetworkTools: true }) }, { fetch: fakeFetch, lookup });
    const ok = await tools.execute(call("web_fetch", { url: "https://docs.example.com/guide" }), tc("researcher"));
    expect(ok.ok).toBe(true);
    expect(ok.output).toBe("https://docs.example.com/guide 200 text/html\n\nDocs\n\n# Guide\n\nUse & enjoy next (https://docs.example.com/next)");
    for (const url of ["http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "https://evil.example.com/", "http://localhost:3000/", "file:///etc/passwd", "https://docs.example.com/redirect"]) {
      const r = await tools.execute(call("web_fetch", { url }), tc("researcher"));
      expect(r.ok).toBe(false);
    }
    expect(fetched).toEqual(["https://docs.example.com/guide", "https://docs.example.com/redirect"]);
  });

  test("memory, assets and security tools delegate", async () => {
    const mem = fakeMemory();
    const assets = fakeAssets();
    const security = fakeSecurity();
    const { tools } = await build({ memory: mem.memory, assets, security });
    const rec = await tools.execute(call("recall", { query: "tests" }), tc());
    expect(rec.output).toBe("lessons:\n- Run bun test before finishing.");
    expect(mem.calls.markUsed).toEqual([{ ids: ["l1"], runId: "run-1", taskId: "task-1" }]);
    expect((await tools.execute(call("record_lesson", { text: "Prefer fs_edit", tags: ["fs"] }), tc())).output).toBe("saved lesson l2 (candidate)");
    const skill = await tools.execute(call("save_skill", { name: "run-tests", description: "run the suite", steps: [{ tool: "shell_run", args: { command: "export TOKEN=abcdefghijkl && bun test" } }] }), tc());
    expect(skill.output).toBe("saved skill run-tests (1 steps)");
    expect(JSON.stringify(mem.calls.saveSkill)).not.toContain("abcdefghijkl");
    const img = await tools.execute(call("generate_image", { prompt: "a cat" }), tc("designer"));
    expect(img.output).toBe("image asset-1 done /api/assets/asset-1/file");
    expect(assets.calls[0]).toMatchObject({ kind: "image", prompt: "a cat", runId: "run-1", workspaceRoot: root });
    const scan = await tools.execute(call("scan_secrets", {}), tc("security"));
    expect(scan.output).toBe("scan scan-1 (secrets) done: 1 findings (1 high)\n[high] aws-key .env:3 AWS key committed");
    expect(security.calls[0]).toMatchObject({ projectId, root, kinds: ["secrets"], runId: "run-1", network: false });
    const deps = await tools.execute(call("scan_deps", {}), tc("security"));
    expect(deps.output).toContain("OSV lookups skipped");
  });

  test("operator tools need automation and go through perform()", async () => {
    const none = await build();
    expect((await none.tools.execute(call("pointer", { action: "click", x: 1, y: 2 }), tc("operator"))).output).toBe("error: local automation is not available: operator tools need the desktop app");
    const hands = fakeAutomation();
    const { tools } = await build({ automation: hands });
    expect((await tools.execute(call("pointer", { action: "double_click", x: 10, y: 20 }), tc("operator"))).output).toBe("double click at 10,20");
    expect((await tools.execute(call("keyboard", { combo: "cmd+s" }), tc("operator"))).output).toBe("pressed cmd+s");
    expect((await tools.execute(call("keyboard", {}), tc("operator"))).ok).toBe(false);
    const tree = await tools.execute(call("ui_tree", {}), tc("operator"));
    expect(tree.output).toBe('AXWindow "Main" [0,0,100,50]\n  AXSecureTextField secure');
    expect((await tools.execute(call("browser_open", { url: "https://x.y" }), tc("operator"))).ok).toBe(false);
    expect(hands.performed.map((p) => p.method)).toEqual(["input.click", "input.key", "ax.tree"]);
    expect(hands.performed[0]!.params).toEqual({ x: 10, y: 20, button: "left", count: 2 });
    const denied = (await build({ automation: fakeAutomation(true) })).tools;
    expect((await denied.execute(call("app_open", { name: "Safari" }), tc("operator"))).output).toBe("error: denied by the owner: owner said no");
    expect(events.ofType("tool.call").some((e) => e.data.activity === "automate")).toBe(true);
  });
});

describe("ssrf guard", () => {
  test("address classification", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2002:c0a8:0101::1"]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicAddress(ip)).toBe(true);
  });

  test("URL checks", async () => {
    const lookup = async () => ["93.184.216.34"];
    await expect(assertPublicUrl("https://user:pw@example.com/", lookup)).rejects.toThrow("credentials");
    await expect(assertPublicUrl("http://example.com:6379/", lookup)).rejects.toThrow("port");
    await expect(assertPublicUrl("http://2130706433/", lookup)).rejects.toThrow("blocked");
    await expect(assertPublicUrl("http://intranet/", lookup)).rejects.toThrow("local host");
    expect((await assertPublicUrl("https://example.com/a?b=1", lookup)).href).toBe("https://example.com/a?b=1");
  });

  test("htmlToText drops scripts and decodes entities", () => {
    expect(htmlToText("<p>a &lt;b&gt; &#39;c&#x27;</p><style>x{}</style><ul><li>one<li>two</ul>")).toBe("a <b> 'c'\n\n- one\n- two");
  });
});
