import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Hono } from "hono";
import type { FileContent, FileNodeDTO, ProjectDTO } from "@mengai/shared";
import type { AppConfig, ModuleContext } from "../../core/module";
import type { Db } from "../../core/ports/db";
import type { WorkspaceService } from "../../core/services";
import { errorBody, HttpError } from "../../lib/http";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { createWorkspaceModule } from "../workspace";
import { createProjectsModule } from "./index";
import { id8, slugify } from "./service";

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

function setup(mode: "local" | "server") {
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
  return createProjectsModule(ctx, { workspace });
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
  function app() {
    const mod = setup("local");
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
});
