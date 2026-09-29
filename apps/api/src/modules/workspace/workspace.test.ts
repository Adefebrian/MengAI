import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModuleContext } from "../../core/module";
import type { WorkspaceService } from "../../core/services";
import { HttpError } from "../../lib/http";
import { captureEvents, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { createWorkspaceModule, runWithFileOrigin, type SearchHits } from "./index";
import { compileMatcher, regexSafety } from "./pattern";
import { SEARCH_LIMITS } from "./service";

const made: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const d = await realpath(await mkdtemp(join(tmpdir(), `mengai-${prefix}-`)));
  made.push(d);
  return d;
}
afterAll(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
});

function context(events = captureEvents()): ModuleContext {
  return {
    config: { mode: "local", version: "test", dataDir: "/nonexistent-data", workspacesDir: "/nonexistent-ws", webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null },
    db: null as never,
    kv: memoryKv(),
    blob: null as never,
    vault: memoryVault(),
    clock: fakeClock(),
    logger: silentLogger,
    events,
  };
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

let root: string;
let outside: string;
let ws: WorkspaceService;
let events: ReturnType<typeof captureEvents>;

beforeEach(async () => {
  root = await tmp("ws");
  outside = await tmp("outside");
  await writeFile(join(outside, "secret.txt"), "top secret");
  events = captureEvents();
  ws = createWorkspaceModule(context(events), {}).service;
});

describe("jail", () => {
  test("dot segments cannot climb out", async () => {
    await rejectsWith(ws.resolveInside(root, "../x"), 403, "path_outside_workspace");
    await rejectsWith(ws.resolveInside(root, "a/../../x"), 403);
    await rejectsWith(ws.read(root, "../" + outside.split("/").pop() + "/secret.txt"), 403);
    await rejectsWith(ws.write(root, "sub/../../escape.txt", "x"), 403);
    expect(await ws.resolveInside(root, "a/../b.txt")).toBe(join(root, "b.txt"));
  });

  test("absolute paths only when inside the root", async () => {
    await rejectsWith(ws.read(root, "/etc/passwd"), 403);
    await rejectsWith(ws.write(root, join(outside, "new.txt"), "x"), 403);
    await writeFile(join(root, "in.txt"), "inside");
    expect((await ws.read(root, join(root, "in.txt"))).content).toBe("inside");
  });

  test("symlinks that point outside are rejected, even dangling ones", async () => {
    await symlink(outside, join(root, "out"));
    await symlink(join(outside, "secret.txt"), join(root, "leak.txt"));
    await symlink(join(outside, "missing", "file.txt"), join(root, "dangling.txt"));
    await rejectsWith(ws.read(root, "out/secret.txt"), 403);
    await rejectsWith(ws.read(root, "leak.txt"), 403);
    await rejectsWith(ws.write(root, "out/planted.txt", "x"), 403);
    await rejectsWith(ws.write(root, "dangling.txt", "x"), 403);
    await rejectsWith(ws.edit(root, "leak.txt", "top", "bottom"), 403);
    expect(await Bun.file(join(outside, "secret.txt")).text()).toBe("top secret");
    expect(await Bun.file(join(outside, "planted.txt")).exists()).toBe(false);
    const names = (await ws.list(root, ".", 2)).map((n) => n.name);
    expect(names).not.toContain("out");
    expect(names).not.toContain("leak.txt");
  });

  test("symlinks inside the root keep working", async () => {
    await mkdir(join(root, "real"));
    await writeFile(join(root, "real", "a.txt"), "hello");
    await symlink(join(root, "real"), join(root, "alias"));
    expect((await ws.read(root, "alias/a.txt")).content).toBe("hello");
  });

  test("NUL bytes and a missing root are refused", async () => {
    await rejectsWith(ws.read(root, "a\0b"), 400);
    await rejectsWith(ws.list(join(root, "nope")), 404);
    await rejectsWith(ws.list("relative/root"), 400);
  });

  test(".git is protected from writes, edits and deletes", async () => {
    await mkdir(join(root, ".git", "hooks"), { recursive: true });
    await writeFile(join(root, ".git", "config"), "[core]\n");
    await rejectsWith(ws.write(root, ".git/hooks/pre-commit", "#!/bin/sh\n"), 403, "git_metadata_protected");
    await rejectsWith(ws.edit(root, ".git/config", "[core]", "[core]\n  fsmonitor = evil"), 403);
    await rejectsWith(ws.remove(root, ".git"), 403);
    await rejectsWith(ws.remove(root, "."), 400);
  });
});

describe("read", () => {
  test("line ranges, totals and whole-file hash", async () => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    await writeFile(join(root, "ten.txt"), text);
    const r = await ws.read(root, "ten.txt", { from: 3, to: 5 });
    expect(r.content).toBe("line 3\nline 4\nline 5");
    expect(r.totalLines).toBe(10);
    expect(r.truncated).toBe(false);
    expect(r.binary).toBe(false);
    expect(r.hash).toBe(new Bun.CryptoHasher("sha256").update(text).digest("hex"));
    expect((await ws.read(root, "ten.txt", { from: 9 })).content).toBe("line 9\nline 10");
    expect((await ws.read(root, "ten.txt", { from: 20 })).content).toBe("");
  });

  test("64 KB cap marks truncated", async () => {
    const line = "x".repeat(99);
    await writeFile(join(root, "big.txt"), Array.from({ length: 2000 }, () => line).join("\n"));
    const r = await ws.read(root, "big.txt");
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.content)).toBeLessThanOrEqual(64 * 1024);
    expect(r.totalLines).toBe(2000);
    expect(r.content.endsWith(line)).toBe(true);
  });

  test("huge files are hashed and counted by streaming, ranges come from the head", async () => {
    const line = "y".repeat(1023);
    const body = Array.from({ length: 9000 }, () => line).join("\n") + "\n";
    await writeFile(join(root, "huge.log"), body);
    const r = await ws.read(root, "huge.log", { from: 1, to: 3 });
    expect(r.totalLines).toBe(9000);
    expect(r.content).toBe([line, line, line].join("\n"));
    expect(r.hash).toBe(new Bun.CryptoHasher("sha256").update(body).digest("hex"));
    await rejectsWith(ws.read(root, "huge.log", { from: 8000 }), 413, "too_large");
  });

  test("binary files are detected and not returned", async () => {
    await writeFile(join(root, "img.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13, 1, 2, 3]));
    const r = await ws.read(root, "img.png");
    expect(r.binary).toBe(true);
    expect(r.content).toBe("");
    expect(r.size).toBe(11);
  });

  test("directories are not files", async () => {
    await mkdir(join(root, "d"));
    await rejectsWith(ws.read(root, "d"), 400, "is_directory");
    await rejectsWith(ws.read(root, "missing.txt"), 404);
  });
});

describe("write, edit, remove", () => {
  test("write creates parents and publishes attributed file.changed", async () => {
    const first = await runWithFileOrigin({ runId: "run-1", agentId: "agent-1", taskId: "task-1" }, () => ws.write(root, "src/deep/a.ts", "export const a = 1;\n"));
    expect(first).toEqual({ bytes: 20, created: true });
    const second = await ws.write(root, "src/deep/a.ts", "export const a = 2;\n");
    expect(second.created).toBe(false);
    const changed = events.ofType("file.changed");
    expect(changed).toHaveLength(2);
    expect(changed[0]!.runId).toBe("run-1");
    expect(changed[0]!.agentId).toBe("agent-1");
    expect(changed[0]!.taskId).toBe("task-1");
    expect(changed[0]!.data).toEqual({ path: "src/deep/a.ts", op: "create", bytes: 20 });
    expect(changed[1]!.runId).toBeNull();
    expect(changed[1]!.data.op).toBe("update");
  });

  test("write under an existing file path is a clean error", async () => {
    await writeFile(join(root, "plain.txt"), "x");
    await rejectsWith(ws.write(root, "plain.txt/child.txt", "y"), 400, "invalid_path");
  });

  test("edit counts, uniqueness and the all flag", async () => {
    await writeFile(join(root, "e.txt"), "a b a b a");
    await rejectsWith(ws.edit(root, "e.txt", "a", "x"), 400, "ambiguous_match");
    await rejectsWith(ws.edit(root, "e.txt", "zzz", "x"), 400, "no_match");
    await rejectsWith(ws.edit(root, "e.txt", "", "x"), 400);
    expect(await ws.edit(root, "e.txt", "a", "x", true)).toEqual({ replacements: 3 });
    expect(await Bun.file(join(root, "e.txt")).text()).toBe("x b x b x");
    expect(await ws.edit(root, "e.txt", "x b x b", "$& $1 y")).toEqual({ replacements: 1 });
    expect(await Bun.file(join(root, "e.txt")).text()).toBe("$& $1 y x");
    expect(events.ofType("file.changed").map((e) => e.data.op)).toEqual(["update", "update"]);
  });

  test("remove deletes files and folders, never a symlink target", async () => {
    await writeFile(join(root, "f.txt"), "12345");
    await mkdir(join(root, "dir", "sub"), { recursive: true });
    await writeFile(join(root, "dir", "sub", "x.txt"), "x");
    await writeFile(join(root, "target.txt"), "keep me");
    await symlink(join(root, "target.txt"), join(root, "link.txt"));
    expect(await ws.remove(root, "f.txt")).toEqual({ removed: true });
    expect(await ws.remove(root, "f.txt")).toEqual({ removed: false });
    expect(await ws.remove(root, "dir")).toEqual({ removed: true });
    expect(await ws.remove(root, "link.txt")).toEqual({ removed: true });
    expect(await Bun.file(join(root, "target.txt")).text()).toBe("keep me");
    await symlink(outside, join(root, "outlink"));
    expect(await ws.remove(root, "outlink")).toEqual({ removed: true });
    expect(await Bun.file(join(outside, "secret.txt")).exists()).toBe(true);
    await rejectsWith(ws.remove(root, "../" + outside.split("/").pop()), 403);
    const deletes = events.ofType("file.changed").filter((e) => e.data.op === "delete");
    expect(deletes[0]!.data).toEqual({ path: "f.txt", op: "delete", bytes: 5 });
    expect(deletes).toHaveLength(4);
    await expect(readlink(join(root, "outlink"))).rejects.toThrow();
  });
});

describe("list, search, digest", () => {
  beforeEach(async () => {
    await mkdir(join(root, "src", "lib"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "const token = 1;\nfunction foo() {}\nfoo();\n");
    await writeFile(join(root, "src", "lib", "b.ts"), "foo();\nfoo();\nfoo();\n");
    await writeFile(join(root, "src", "notes.md"), "foo( in prose\n");
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "foo();\n");
    await writeFile(join(root, "dist", "out.js"), "foo();\n");
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "demo-app", scripts: { dev: "x", test: "y" }, dependencies: { hono: "1", zod: "1" } }));
  });

  test("list honors depth and ignore rules", async () => {
    const top = await ws.list(root, ".", 1);
    expect(top.map((n) => n.name)).toEqual(["src", "package.json"]);
    expect(top[0]!.children).toBeUndefined();
    const deep = await ws.list(root, ".", 3);
    const src = deep.find((n) => n.name === "src")!;
    expect(src.dir).toBe(true);
    expect(src.children!.map((n) => n.path)).toEqual(["src/lib", "src/a.ts", "src/notes.md"]);
    expect(src.children![0]!.children![0]!.path).toBe("src/lib/b.ts");
  });

  test("search respects limit, glob, ignores and literal fallback", async () => {
    const all = await ws.search(root, "foo\\(\\)", undefined, 50);
    expect(all.map((h) => h.path).every((p) => p.startsWith("src/"))).toBe(true);
    expect(all).toHaveLength(5);
    const limited = await ws.search(root, "foo", undefined, 2);
    expect(limited).toHaveLength(2);
    const ts = await ws.search(root, "foo", "src/lib/**");
    expect(new Set(ts.map((h) => h.path))).toEqual(new Set(["src/lib/b.ts"]));
    const byExt = await ws.search(root, "prose", "*.md");
    expect(byExt).toEqual([{ path: "src/notes.md", line: 1, text: "foo( in prose" }]);
    const literal = await ws.search(root, "foo(", "*.md");
    expect(literal).toHaveLength(1);
    await rejectsWith(ws.search(root, "x", "../**"), 403);
  });

  test("digest stays under about 300 tokens", async () => {
    for (let i = 0; i < 60; i++) {
      await mkdir(join(root, `module-with-a-long-name-${i}`));
      await writeFile(join(root, `module-with-a-long-name-${i}`, "f.txt"), "x");
      await writeFile(join(root, `top-level-file-number-${i}.txt`), "x");
    }
    const d = await ws.digest(root);
    expect(d.length).toBeLessThanOrEqual(1200);
    expect(d).toContain("package.json: name demo-app");
    expect(d).toContain("ignored: .git, dist, node_modules");
    expect(d).not.toContain("index.js");
    const empty = await tmp("empty");
    expect(await ws.digest(empty)).toBe("Empty workspace.");
  });
});

describe("search pattern safety", () => {
  test("regex only when the safety check passes, literal otherwise", () => {
    for (const bad of ["(a+)+b", "(a*)*", "(a|aa)*c", "(?:x*y){2,}", "(\\w+\\s?)+$", "(a)\\1", "(?<n>a)\\k<n>", "a{1,5000}", "\\s*\\s*\\s*\\s*x", "x".repeat(201)]) {
      expect(regexSafety(bad).ok).toBe(false);
    }
    expect(regexSafety("foo\\(\\)")).toEqual({ ok: true, variable: 0 });
    expect(regexSafety("colou?r")).toEqual({ ok: true, variable: 1 });
    expect(regexSafety("function\\s+\\w+")).toEqual({ ok: true, variable: 2 });
    expect(regexSafety("[a-z(+*]+\\d{2}(ab)+")).toEqual({ ok: true, variable: 2 });
    expect(regexSafety("(?<=x)(?:ab)+(?=y)")).toEqual({ ok: true, variable: 1 });
    // invalid regex is literal
    expect(compileMatcher("foo(").regex).toBe(false);
    expect(compileMatcher("foo(").test("call foo( here")).toBe(true);
    // literal text always matches, even when the regex reading would not
    const m = compileMatcher("a.b");
    expect(m.regex).toBe(true);
    expect(m.test("a.b")).toBe(true);
    expect(m.test("axb")).toBe(true);
    // a regex with 3 variable quantifiers is not tried on long lines
    const three = compileMatcher("\\w+\\s*\\w+\\(");
    expect(three.test("call foo(x)")).toBe(true);
    expect(three.test(`${" ".repeat(200)}call foo(x)`)).toBe(false);
  });

  test("catastrophic patterns cannot hold the event loop", async () => {
    await writeFile(join(root, "a.txt"), `${"a".repeat(1999)}\n`.repeat(50));
    await writeFile(join(root, "s.txt"), `${" ".repeat(1900)}\n`.repeat(50));
    const started = performance.now();
    expect(await ws.search(root, "(a+)+b")).toEqual([]);
    expect(await ws.search(root, "\\s*\\s*\\s*x")).toEqual([]);
    expect(await ws.search(root, "\\s*\\s*x")).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1500);
    // the safe regex path still works
    await writeFile(join(root, "c.txt"), "color\ncolour\ncolr\n");
    expect((await ws.search(root, "colou?r", "c.txt")).map((h) => h.line)).toEqual([1, 2]);
  });

  test("the scan stops at its time budget and yields while matching", async () => {
    const saved = { ...SEARCH_LIMITS };
    SEARCH_LIMITS.timeBudgetMs = 150;
    try {
      // two variable quantifiers: tried on lines up to 500 chars, each such line costs milliseconds
      // 1500 lines stay under the 1 MB per-file cap; unbounded they would take about 25 s
      await writeFile(join(root, "slow.txt"), `${" ".repeat(499)}\n`.repeat(1500));
      let ticks = 0;
      const timer = setInterval(() => ticks++, 5);
      const started = performance.now();
      const hits: SearchHits = await ws.search(root, "\\s*\\s*x");
      const elapsed = performance.now() - started;
      clearInterval(timer);
      expect(hits).toEqual([]);
      expect(hits.stopped).toBe("time_budget");
      expect(elapsed).toBeLessThan(1500);
      expect(ticks).toBeGreaterThan(2);
      // a finished scan has no stop marker
      const done: SearchHits = await ws.search(root, "nothing-here", "*.md");
      expect(done.stopped).toBeUndefined();
    } finally {
      Object.assign(SEARCH_LIMITS, saved);
    }
  });
});
