// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Regression tests for runner hardening: the workspace root cannot be
// swapped for a symlink, git hooks and config stay protected when .git is
// renamed or nested, .mengai is never created or written through a symlink,
// commands start from a clean env, and the optional uid drop fails closed.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecRequest } from "../ports/runner";
import { checkDropProbe, createPlainRunner, resolveRunAs, runAsFromEnv, RunnerError, verifyRoots } from "./runner-plain";
import { buildSeatbeltProfile, createSeatbeltRunner, GIT_RULES } from "./runner-seatbelt";

const made: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const d = await realpath(await mkdtemp(join(tmpdir(), `mengai-${prefix}-`)));
  made.push(d);
  return d;
}
afterAll(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
});

let ws: string;
let outside: string;
const req = (command: string, extra: Partial<ExecRequest> = {}): ExecRequest => ({
  command,
  cwd: ws,
  timeoutMs: 10_000,
  maxOutputBytes: 64 * 1024,
  network: false,
  writablePaths: [ws],
  ...extra,
});

async function runnerError(p: Promise<unknown>): Promise<RunnerError> {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(RunnerError);
  return err as RunnerError;
}

beforeEach(async () => {
  ws = await tmp("ws");
  outside = await tmp("outside");
});

describe("workspace root checks (shared exec core)", () => {
  test("a symlinked root is refused before anything is created", async () => {
    const link = join(await tmp("links"), "ws-link");
    await symlink(ws, link);
    const err = await runnerError(createPlainRunner({ runAs: null }).exec(req("echo ran > ran.txt", { cwd: link, writablePaths: [link] })));
    expect(err.code).toBe("unsafe_workspace");
    expect(await readdir(ws)).toEqual([]);
  });

  test("a command that swaps the root for a symlink is caught right after exit", async () => {
    const moved = `${ws}-moved`;
    made.push(moved);
    const err = await runnerError(createPlainRunner({ runAs: null }).exec(req(`cd / && mv "${ws}" "${moved}" && ln -s "${outside}" "${ws}" && echo swapped`)));
    expect(err.code).toBe("unsafe_workspace");
    expect(err.message).toContain("replaced the workspace root");
    // the next command refuses to start on the swapped root, and so does the direct check
    const next = await runnerError(createPlainRunner({ runAs: null }).exec(req("echo ran > ran.txt")));
    expect(next.code).toBe("unsafe_workspace");
    expect((await runnerError(verifyRoots({ writable: [ws] }, "before"))).code).toBe("unsafe_workspace");
    expect(await readdir(outside)).toEqual([]);
    await rm(ws, { force: true });
    await rename(moved, ws);
  });
});

describe(".mengai is never followed through a symlink", () => {
  test("a symlinked .mengai is refused and nothing is written outside", async () => {
    await symlink(outside, join(ws, ".mengai"));
    const err = await runnerError(createPlainRunner({ runAs: null }).exec(req("echo ran > ran.txt")));
    expect(err.code).toBe("unsafe_workspace");
    expect(await readdir(outside)).toEqual([]);
    expect(await Bun.file(join(ws, "ran.txt")).exists()).toBe(false);
  });

  test("a symlinked .mengai/tmp is refused", async () => {
    await mkdir(join(ws, ".mengai"));
    await symlink(outside, join(ws, ".mengai", "tmp"));
    const err = await runnerError(createPlainRunner({ runAs: null }).exec(req("true")));
    expect(err.code).toBe("unsafe_workspace");
    expect(await readdir(outside)).toEqual([]);
  });

  test("a symlinked .mengai/.gitignore is refused and its target untouched", async () => {
    await mkdir(join(ws, ".mengai", "tmp"), { recursive: true });
    const target = join(outside, "victim");
    await writeFile(target, "keep\n");
    await symlink(target, join(ws, ".mengai", ".gitignore"));
    const err = await runnerError(createPlainRunner({ runAs: null }).exec(req("true")));
    expect(err.code).toBe("unsafe_workspace");
    expect(await readFile(target, "utf8")).toBe("keep\n");
    // a dangling link is refused too (writeFile would have created its target)
    await rm(join(ws, ".mengai", ".gitignore"));
    await symlink(join(outside, "created"), join(ws, ".mengai", ".gitignore"));
    expect((await runnerError(createPlainRunner({ runAs: null }).exec(req("true")))).code).toBe("unsafe_workspace");
    expect(await Bun.file(join(outside, "created")).exists()).toBe(false);
  });

  test("a normal workspace still gets a real .mengai/tmp and .gitignore", async () => {
    const r = await createPlainRunner({ runAs: null }).exec(req('echo t > "$TMPDIR/t" && cat "$TMPDIR/t"'));
    expect(r.stdout).toBe("t\n");
    expect((await lstat(join(ws, ".mengai"))).isDirectory()).toBe(true);
    expect((await lstat(join(ws, ".mengai", "tmp"))).isDirectory()).toBe(true);
    expect(await readFile(join(ws, ".mengai", ".gitignore"), "utf8")).toBe("*\n");
  });
});

describe("clean env and uid drop", () => {
  test("commands start from a clean env: nothing from the server is inherited", async () => {
    process.env.MENGAI_TEST_PARENT_ONLY = "server-side-value";
    try {
      const r = await createPlainRunner({ runAs: null }).exec(req("env"));
      const names = r.stdout
        .trim()
        .split("\n")
        .map((l) => l.slice(0, l.indexOf("=")))
        .filter((n) => n !== "PWD" && n !== "SHLVL" && n !== "_" && n !== "OLDPWD");
      expect(names.sort()).toEqual(["CI", "HOME", "LANG", "NO_COLOR", "PATH", "TERM", "TMPDIR"]);
      expect(r.stdout).not.toContain("server-side-value");
    } finally {
      delete process.env.MENGAI_TEST_PARENT_ONLY;
    }
  });

  test("MENGAI_RUNNER_UID parsing", () => {
    expect(runAsFromEnv({})).toBeNull();
    expect(runAsFromEnv({ MENGAI_RUNNER_UID: "1000" })).toEqual({ uid: 1000, gid: 1000 });
    expect(runAsFromEnv({ MENGAI_RUNNER_UID: " 1001 ", MENGAI_RUNNER_GID: "1002" })).toEqual({ uid: 1001, gid: 1002 });
    for (const bad of ["0", "-1", "abc", "1.5", "99999999999"]) expect(() => runAsFromEnv({ MENGAI_RUNNER_UID: bad })).toThrow("MENGAI_RUNNER_UID");
    expect(() => runAsFromEnv({ MENGAI_RUNNER_GID: "1000" })).toThrow("without MENGAI_RUNNER_UID");
  });

  test("the drop applies to a root server only and fails closed otherwise", () => {
    const target = { uid: 1000, gid: 1000 };
    expect(resolveRunAs(null, 0)).toBeNull();
    expect(resolveRunAs(target, 0)).toEqual(target);
    expect(resolveRunAs(target, 1000)).toBeNull();
    expect(() => resolveRunAs(target, 501)).toThrow("cannot switch users");
    expect(() => resolveRunAs(target, null)).toThrow("cannot switch users");
  });

  test("the drop probe rejects a kept root group or a wrong uid", () => {
    const target = { uid: 1000, gid: 1000 };
    expect(checkDropProbe("1000\n1000\n", target)).toBeNull();
    expect(checkDropProbe("0\n0\n", target)).toContain("uid 0");
    expect(checkDropProbe("1000\n1000 0\n", target)).toContain("group 0");
    expect(checkDropProbe("1000\n1000 27\n", target)).toContain("supplementary groups 27");
    expect(checkDropProbe("1000\n", target)).toContain("no groups");
  });

  test("a configured drop the server cannot perform never runs the command", async () => {
    const runner = createPlainRunner({ runAs: { uid: 424242, gid: 424242 }, currentUid: 501 });
    const err = await runnerError(runner.exec(req("echo ran > ran.txt")));
    expect(err.code).toBe("sandbox_unavailable");
    expect(await Bun.file(join(ws, "ran.txt")).exists()).toBe(false);
  });
});

describe("seatbelt profile", () => {
  test("the root entry is write-denied as a literal and git rules are path-free regexes", () => {
    const p = buildSeatbeltProfile({ writable: ["/w/proj"], network: false, dataDir: "/data", home: "/Users/o" });
    const lines = p.profile.split("\n");
    const allow = lines.findIndex((l) => l.startsWith("(allow file-read* file-write* (subpath (param \"WS_0\")"));
    const denyRoot = lines.indexOf('(deny file-write* (literal (param "WS_0")))');
    expect(allow).toBeGreaterThan(-1);
    expect(denyRoot).toBeGreaterThan(allow);
    for (const rule of GIT_RULES) {
      expect(lines.indexOf(rule)).toBeGreaterThan(denyRoot);
      expect(rule).not.toContain("param");
    }
    expect(p.profile).not.toContain("GIT_HOOKS");
    expect(p.profile).not.toContain("/w/proj");
  });

  const sandboxWorks =
    process.platform === "darwin" &&
    (() => {
      try {
        return Bun.spawnSync(["/usr/bin/sandbox-exec", "-p", "(version 1)(allow default)", "/usr/bin/true"]).exitCode === 0;
      } catch {
        return false;
      }
    })();

  test.skipIf(!sandboxWorks)("the root cannot be removed, renamed or replaced by a symlink", async () => {
    const data = await tmp("data");
    const runner = createSeatbeltRunner({ dataDir: data });
    await writeFile(join(ws, "keep.txt"), "keep\n");
    const moved = `${ws}-moved`;
    made.push(moved);
    const mv = await runner.exec(req(`cd / && mv "${ws}" "${moved}"`));
    expect(mv.exitCode).not.toBe(0);
    const rmdir = await runner.exec(req(`cd / && rmdir "${ws}" || rm -d "${ws}"`));
    expect(rmdir.exitCode).not.toBe(0);
    // the root entry's own metadata is not writable either (only its contents are)
    const touch = await runner.exec(req(`touch "${ws}"`));
    expect(touch.exitCode).not.toBe(0);
    expect((await lstat(ws)).isDirectory()).toBe(true);
    expect(await Bun.file(moved).exists()).toBe(false);
    // writes strictly inside the root still work
    const inside = await runner.exec(req("mkdir -p a/b && echo x > a/b/c && cat a/b/c keep.txt"));
    expect(inside.exitCode).toBe(0);
    expect(inside.stdout).toBe("x\nkeep\n");
  });

  test.skipIf(!sandboxWorks)("git hooks and config stay protected when .git is renamed, nested or staged", async () => {
    const data = await tmp("data");
    expect(Bun.spawnSync(["git", "init", "-q", ws]).exitCode).toBe(0);
    const runner = createSeatbeltRunner({ dataDir: data });
    const attempts = [
      "mv .git g && echo evil > g/hooks/pre-commit",
      "echo evil > .git/hooks/pre-commit",
      "echo '[core] hooksPath = /tmp' >> .git/config",
      "mkdir -p .git/modules/m/hooks && echo evil > .git/modules/m/hooks/post-checkout",
      "mkdir -p .git/modules/m && echo evil > .git/modules/m/config",
      "mkdir -p vendor/x && mkdir vendor/x/.git",
      "mv .git/hooks .git/hooks-old",
      "ln .git/config linked && echo evil >> linked",
    ];
    for (const cmd of attempts) {
      const r = await runner.exec(req(cmd));
      expect({ cmd, exit: r.exitCode === 0 }).toEqual({ cmd, exit: false });
    }
    expect(await Bun.file(join(ws, ".git", "hooks", "pre-commit")).exists()).toBe(false);
    expect(await readFile(join(ws, ".git", "config"), "utf8")).not.toContain("hooksPath");
    // ordinary git work inside the repository still runs in the sandbox
    Bun.spawnSync(["git", "-C", ws, "config", "user.email", "t@example.invalid"]);
    Bun.spawnSync(["git", "-C", ws, "config", "user.name", "t"]);
    const commit = await runner.exec(req("echo a > a.txt && git add a.txt && git commit -qm one && git log --oneline | wc -l"));
    expect(commit.exitCode).toBe(0);
    expect(commit.stdout.trim()).toBe("1");
  });

  test.skipIf(!sandboxWorks)("a gitdir staged under another name cannot be moved into place", async () => {
    const data = await tmp("data");
    const runner = createSeatbeltRunner({ dataDir: data });
    const staged = await runner.exec(req("mkdir -p staged/hooks && echo evil > staged/hooks/pre-commit && mv staged .git"));
    expect(staged.exitCode).not.toBe(0);
    const file = await runner.exec(req("echo 'gitdir: /tmp/evil' > .git"));
    expect(file.exitCode).not.toBe(0);
    expect(await Bun.file(join(ws, ".git")).exists()).toBe(false);
    expect((await lstat(join(ws, ".git")).catch(() => null)) === null).toBe(true);
  });
});
