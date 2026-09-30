// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Hono } from "hono";
import type { FileContent, FileNodeDTO, PreviewDTO, ProjectDTO } from "@mengai/shared";
import type { AppConfig, ModuleContext } from "../../core/module";
import type { Db } from "../../core/ports/db";
import type { WorkspaceService } from "../../core/services";
import { errorBody, HttpError } from "../../lib/http";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { createPreviewModule, type PreviewService } from "../preview";
import { createWorkspaceModule } from "../workspace";
import { createProjectsModule } from "./index";
import { denyLists, id8, slugify } from "./service";

const made: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const d = await realpath(await mkdtemp(join(tmpdir(), `mengai-${prefix}-`)));
  made.push(d);
  return d;
}
afterAll(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
});

let db: Db;
let base: string;
let config: AppConfig;
let ctx: ModuleContext;
let workspace: WorkspaceService;

let opened: string[][] = [];
let stoppedServers = 0;

function fakePreview(): PreviewService {
  opened = [];
  stoppedServers = 0;
  return createPreviewModule(ctx, {}, {
    open: async (argv) => {
      opened.push(argv);
      return 0;
    },
    portFree: async () => true,
    serveStatic: (_dir, port) => ({
      port,
      stop: async () => {
        stoppedServers++;
      },
    }),
    spawn: () => {
      throw new Error("no process in these tests");
    },
  }).service;
}

function setup(mode: "local" | "server", withPreview = false) {
  config = {
    mode,
    version: "test",
    dataDir: join(base, "appdata"),
    workspacesDir: join(base, "workspaces"),
    webDir: null,
    allowedOrigins: [],
    allowedHosts: [],
    controlToken: null,
  };
  ctx = { config, db, kv: memoryKv(), blob: null as never, vault: memoryVault(), clock: fakeClock(), logger: silentLogger, events: captureEvents() };
  workspace = createWorkspaceModule(ctx, {}).service;
  return createProjectsModule(ctx, { workspace, preview: withPreview ? fakePreview() : undefined });
}

async function rejectsWith(p: Promise<unknown>, status: HttpError["status"], code?: string) {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  if (code) expect((err as HttpError).code).toBe(code);
}

beforeEach(async () => {
  db = await createTestDb();
  base = await tmp("projects");
  await mkdir(join(base, "appdata"), { recursive: true });
});

describe("projects service", () => {
  test("default workspace is <slug>-<id8> under workspacesDir", async () => {
    const { service } = setup("local");
    const p = await service.create({ name: "  My Cool App!  " });
    expect(p.name).toBe("My Cool App!");
    expect(basename(p.workspacePath)).toBe(`my-cool-app-${id8(p.id)}`);
    expect(dirname(p.workspacePath)).toBe(await realpath(config.workspacesDir));
    expect(await service.root(p.id)).toBe(p.workspacePath);
    expect(p.lastRunId).toBeNull();
    expect(slugify("***")).toBe("project");
    expect(id8("0192f0aa-0000-7000-8000-00000000abcd")).toBe("0000abcd");
  });

  test("list, get, touchRun and remove (files stay on disk)", async () => {
    const { service } = setup("local");
    const a = await service.create({ name: "A" });
    (ctx.clock as ReturnType<typeof fakeClock>).advance(10);
    const b = await service.create({ name: "B" });
    expect((await service.list()).map((p) => p.id)).toEqual([b.id, a.id]);
    (ctx.clock as ReturnType<typeof fakeClock>).advance(10);
    await service.touchRun(a.id, "run-9");
    const got = await service.get(a.id);
    expect(got.lastRunId).toBe("run-9");
    expect(got.updatedAt).toBeGreaterThan(got.createdAt);
    expect((await service.list())[0]!.id).toBe(a.id);
    await writeFile(join(a.workspacePath, "keep.txt"), "mine");
    await service.remove(a.id);
    await rejectsWith(service.get(a.id), 404);
    await rejectsWith(service.remove(a.id), 404);
    await rejectsWith(service.touchRun(a.id, "r"), 404);
    expect(await Bun.file(join(a.workspacePath, "keep.txt")).text()).toBe("mine");
  });

  test("a chosen folder is realpath-resolved in local mode", async () => {
    const { service } = setup("local");
    const folder = join(base, "code", "site");
    await mkdir(folder, { recursive: true });
    await symlink(folder, join(base, "shortcut"));
    const p = await service.create({ name: "Site", workspacePath: join(base, "shortcut") });
    expect(p.workspacePath).toBe(folder);
    expect(await service.root(p.id)).toBe(folder);
  });

  test("unsafe chosen folders are refused", async () => {
    const { service } = setup("local");
    await writeFile(join(base, "file.txt"), "x");
    const bad = ["/", homedir(), dirname(homedir()), config.dataDir, join(config.dataDir, "inner"), base, join(base, "missing"), join(base, "file.txt"), join(homedir(), ".ssh")];
    await mkdir(join(config.dataDir, "inner"), { recursive: true });
    for (const path of bad) await rejectsWith(service.create({ name: "x", workspacePath: path }), 422, "invalid_workspace");
    expect(await service.list()).toHaveLength(0);
  });

  test("server mode never binds a chosen folder", async () => {
    const { service } = setup("server");
    await mkdir(join(base, "srv"));
    await rejectsWith(service.create({ name: "x", workspacePath: join(base, "srv") }), 403);
    const p = await service.create({ name: "Server Project" });
    expect(p.workspacePath.startsWith(await realpath(config.workspacesDir))).toBe(true);
  });

  test("root() recreates a deleted default workspace but never a chosen one", async () => {
    const { service } = setup("local");
    const p = await service.create({ name: "gone" });
    await rm(p.workspacePath, { recursive: true });
    expect(await service.root(p.id)).toBe(p.workspacePath);
    const chosen = join(base, "chosen");
    await mkdir(chosen);
    const q = await service.create({ name: "chosen", workspacePath: chosen });
    await rm(chosen, { recursive: true });
    await rejectsWith(service.root(q.id), 404);
  });
});

describe("projects routes", () => {
  function app(mode: "local" | "server" = "local", withPreview = false) {
    const mod = setup(mode, withPreview);
    expect(mod.name).toBe("projects");
    expect(mod.mountPath).toBe("projects");
    const a = new Hono();
    a.onError((err, c) => {
      if (err instanceof HttpError) return c.json(errorBody(err.code, err.message), err.status);
      return c.json(errorBody("internal", "internal error"), 500);
    });
    a.route(`/api/${mod.mountPath}`, mod.routes!);
    return a;
  }
  const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  test("CRUD over HTTP with validation", async () => {
    const a = app();
    const bad = await a.request("/api/projects", json({ name: "" }));
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("invalid_body");
    const extra = await a.request("/api/projects", json({ name: "x", owner: "someone" }));
    expect(extra.status).toBe(422);
    const rel = await a.request("/api/projects", json({ name: "x", workspacePath: "relative/path" }));
    expect(rel.status).toBe(422);
    const created = await a.request("/api/projects", json({ name: "Web" }));
    expect(created.status).toBe(200);
    const p = (await created.json()) as ProjectDTO;
    expect((await (await a.request("/api/projects")).json()) as ProjectDTO[]).toHaveLength(1);
    expect(((await (await a.request(`/api/projects/${p.id}`)).json()) as ProjectDTO).name).toBe("Web");
    expect((await a.request("/api/projects/not-a-uuid")).status).toBe(404);
    expect((await a.request("/api/projects/0192f0aa-0000-7000-8000-0000000000ff")).status).toBe(404);
    const del = await a.request(`/api/projects/${p.id}`, { method: "DELETE" });
    expect(await del.json()).toEqual({ ok: true });
  });

  test("files and file delegate to the jailed workspace", async () => {
    const a = app();
    const p = (await (await a.request("/api/projects", json({ name: "Files" }))).json()) as ProjectDTO;
    await mkdir(join(p.workspacePath, "src"));
    await writeFile(join(p.workspacePath, "src", "main.ts"), "one\ntwo\nthree\n");
    const tree = (await (await a.request(`/api/projects/${p.id}/files?depth=2`)).json()) as FileNodeDTO[];
    expect(tree[0]!.path).toBe("src");
    expect(tree[0]!.children![0]!.path).toBe("src/main.ts");
    const file = (await (await a.request(`/api/projects/${p.id}/file?path=src/main.ts&from=2&to=3`)).json()) as FileContent;
    expect(file).toEqual({ path: "src/main.ts", content: "two\nthree", truncated: false, size: 14, binary: false });
    const escape = await a.request(`/api/projects/${p.id}/file?path=${encodeURIComponent("../../etc/passwd")}`);
    expect(escape.status).toBe(403);
    expect((await a.request(`/api/projects/${p.id}/file`)).status).toBe(422);
    expect((await a.request(`/api/projects/${p.id}/files?depth=99`)).status).toBe(422);
    expect((await a.request(`/api/projects/${p.id}/file?path=nope.txt`)).status).toBe(404);
  });

  test("live preview: idle detection, start, stop; the workspace root only", async () => {
    const a = app("local", true);
    const p = (await (await a.request("/api/projects", json({ name: "Site" }))).json()) as ProjectDTO;
    const idle = (await (await a.request(`/api/projects/${p.id}/preview`)).json()) as PreviewDTO;
    expect(idle).toMatchObject({ projectId: p.id, status: "idle", kind: null, url: null });
    expect(idle.error).toContain("Nothing to preview yet");
    await writeFile(join(p.workspacePath, "index.html"), "<h1>site</h1>");
    expect(((await (await a.request(`/api/projects/${p.id}/preview`)).json()) as PreviewDTO)).toMatchObject({ status: "idle", kind: "static", command: "static index.html", error: null });
    const started = (await (await a.request(`/api/projects/${p.id}/preview`, { method: "POST" })).json()) as PreviewDTO;
    expect(started).toMatchObject({ status: "ready", kind: "static", url: "http://127.0.0.1:4300/" });
    const again = await a.request(`/api/projects/${p.id}/preview`, json({ restart: true }));
    expect(((await again.json()) as PreviewDTO).status).toBe("ready");
    expect(stoppedServers).toBe(1);
    expect((await a.request(`/api/projects/${p.id}/preview`, json({ restart: "yes" }))).status).toBe(422);
    expect((await a.request(`/api/projects/${p.id}/preview`, json([]))).status).toBe(422);
    expect((await a.request(`/api/projects/${p.id}/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" })).status).toBe(400);
    const stopped = (await (await a.request(`/api/projects/${p.id}/preview`, { method: "DELETE" })).json()) as PreviewDTO;
    expect(stopped).toMatchObject({ status: "stopped", url: null });
    expect(stoppedServers).toBe(2);
    expect((await a.request("/api/projects/not-a-uuid/preview")).status).toBe(404);
    expect((await a.request("/api/projects/0192f0aa-0000-7000-8000-0000000000ff/preview", { method: "POST" })).status).toBe(404);
    // deleting the project stops its preview
    await a.request(`/api/projects/${p.id}/preview`, { method: "POST" });
    await a.request(`/api/projects/${p.id}`, { method: "DELETE" });
    expect(stoppedServers).toBe(3);
  });

  test("reveal opens the workspace root and takes no path", async () => {
    const a = app("local", true);
    const p = (await (await a.request("/api/projects", json({ name: "Reveal" }))).json()) as ProjectDTO;
    const res = await a.request(`/api/projects/${p.id}/reveal`, { method: "POST" });
    expect(await res.json()).toEqual({ ok: true });
    expect(opened).toEqual([[process.platform === "darwin" ? "/usr/bin/open" : process.platform === "win32" ? "explorer.exe" : "xdg-open", p.workspacePath]]);
    expect((await a.request(`/api/projects/${p.id}/reveal`, json({}))).status).toBe(200);
    expect((await a.request(`/api/projects/${p.id}/reveal`, json({ path: "/etc" }))).status).toBe(422);
    expect((await a.request(`/api/projects/${p.id}/reveal`, json([]))).status).toBe(422);
    expect((await a.request("/api/projects/0192f0aa-0000-7000-8000-0000000000ff/reveal", { method: "POST" })).status).toBe(404);
    expect(opened).toHaveLength(2);
    expect(opened.every((argv) => argv.at(-1) === p.workspacePath)).toBe(true);
  });

  test("preview and reveal are rate limited per ip", async () => {
    const a = app("local", true);
    const p = (await (await a.request("/api/projects", json({ name: "Busy" }))).json()) as ProjectDTO;
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await a.request(`/api/projects/${p.id}/reveal`, { method: "POST" })).status);
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
    expect(codes[20]).toBe(429);
  });

  test("server mode and a missing preview module answer 404 and open nothing", async () => {
    for (const [mode, withPreview] of [
      ["server", true],
      ["local", false],
    ] as const) {
      const a = app(mode, withPreview);
      const p = (await (await a.request("/api/projects", json({ name: `x-${mode}` }))).json()) as ProjectDTO;
      for (const [method, path] of [
        ["GET", "preview"],
        ["POST", "preview"],
        ["DELETE", "preview"],
        ["POST", "reveal"],
      ] as const) {
        const res = await a.request(`/api/projects/${p.id}/${path}`, { method });
        expect(`${mode} ${method} ${path} ${res.status}`).toBe(`${mode} ${method} ${path} 404`);
      }
      expect(opened).toHaveLength(0);
    }
  });
});

describe("workspace folder deny lists per platform", () => {
  test("Windows denies its system folders and AppData; macOS keeps its lists", () => {
    const win = denyLists("win32", { SystemRoot: "C:\\Windows", ProgramFiles: "C:\\Program Files", ProgramData: "C:\\ProgramData" });
    expect(win.system).toEqual(["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)", "C:\\ProgramData"]);
    expect(win.home).toContain("AppData");
    expect(win.system.some((p) => p.startsWith("/"))).toBe(false);
    const mac = denyLists("darwin", {});
    expect(mac.system).toContain("/System");
    expect(mac.home).toContain("Library");
  });
});
