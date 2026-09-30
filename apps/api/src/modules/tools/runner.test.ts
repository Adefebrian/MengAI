// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Runner adapter tests (core/adapters/runner-plain.ts and runner-seatbelt.ts).
// They live here because the tools module is the runner's only caller.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlainRunner, RunnerError, scrubEnv } from "../../core/adapters/runner-plain";
import { buildSeatbeltProfile, createSeatbeltRunner } from "../../core/adapters/runner-seatbelt";
import type { ExecRequest } from "../../core/ports/runner";

const made: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const d = await realpath(await mkdtemp(join(tmpdir(), `mengai-${prefix}-`)));
  made.push(d);
  return d;
}
afterAll(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let ws: string;
const req = (command: string, extra: Partial<ExecRequest> = {}): ExecRequest => ({
  command,
  cwd: ws,
  timeoutMs: 10_000,
  maxOutputBytes: 64 * 1024,
  network: false,
  writablePaths: [ws],
  ...extra,
});

beforeEach(async () => {
  ws = await tmp("run");
});

describe("env scrubbing", () => {
  test("scrubEnv drops secret-looking and injection names", () => {
    const env = scrubEnv({ home: "/w", tmpDir: "/w/.mengai/tmp", path: "/usr/bin:/bin", extra: { GOOD: "1", MY_API_KEY: "x", github_token: "x", DB_PASSWORD: "x", CLIENT_SECRET: "x", DYLD_INSERT_LIBRARIES: "/w/x.dylib", HOME: "/Users/owner", "BAD NAME": "x" } });
    expect(env).toEqual({ PATH: "/usr/bin:/bin", HOME: "/w", TMPDIR: "/w/.mengai/tmp", LANG: "en_US.UTF-8", TERM: "dumb", NO_COLOR: "1", CI: "1", GOOD: "1" });
  });

  test("the child sees only the scrubbed env", async () => {
    process.env.MENGAI_TEST_API_KEY = "sk-test-should-not-leak";
    process.env.MENGAI_TEST_TOKEN = "tok";
    try {
      const r = await createPlainRunner().exec(req("env", { env: { EXTRA_OK: "yes", EXTRA_SECRET: "no" } }));
      expect(r.exitCode).toBe(0);
      const names = r.stdout
        .trim()
        .split("\n")
        .map((l) => l.split("=")[0]!);
      for (const name of names) expect(/KEY|TOKEN|SECRET|PASSWORD/i.test(name)).toBe(false);
      expect(r.stdout).not.toContain("sk-test-should-not-leak");
      expect(r.stdout).toContain(`HOME=${ws}\n`);
      expect(r.stdout).toContain(`TMPDIR=${join(ws, ".mengai", "tmp")}\n`);
      expect(r.stdout).toContain("EXTRA_OK=yes");
      expect(names).toContain("PATH");
      expect(await Bun.file(join(ws, ".mengai", ".gitignore")).text()).toBe("*\n");
    } finally {
      delete process.env.MENGAI_TEST_API_KEY;
      delete process.env.MENGAI_TEST_TOKEN;
    }
  });
});

describe("limits", () => {
  test("hard timeout kills the whole process group", async () => {
    const r = await createPlainRunner().exec(req("sleep 30 & echo $! > bg.pid; sleep 30", { timeoutMs: 300 }));
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull();
    expect(r.durationMs).toBeLessThan(5000);
    const bg = Number((await Bun.file(join(ws, "bg.pid")).text()).trim());
    await Bun.sleep(50);
    expect(alive(bg)).toBe(false);
  });

  test("background children cannot outlive a finished command", async () => {
    const r = await createPlainRunner().exec(req("sleep 30 & echo $! > bg.pid; echo started"));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("started\n");
    const bg = Number((await Bun.file(join(ws, "bg.pid")).text()).trim());
    await Bun.sleep(50);
    expect(alive(bg)).toBe(false);
  });

  test("a daemonized grandchild holding the pipes cannot hang the runner", async () => {
    // the grandchild calls setsid(), leaves the process group and keeps stdout open
    await writeFile(join(ws, "esc.pl"), 'use POSIX; my $p = fork(); if ($p == 0) { POSIX::setsid(); sleep 30; exit 0 } open(my $f, ">", "esc.pid"); print $f $p; close $f; print "parent done\\n";\n');
    const started = performance.now();
    const r = await createPlainRunner().exec(req("perl esc.pl"));
    const elapsed = performance.now() - started;
    const esc = Number((await Bun.file(join(ws, "esc.pid")).text()).trim());
    if (esc > 0 && alive(esc)) process.kill(esc, "SIGKILL");
    expect(elapsed).toBeLessThan(6000);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("parent done");
  });

  test("stdout and stderr are capped with a truncation flag", async () => {
    const r = await createPlainRunner().exec(req("head -c 100000 /dev/zero | tr '\\0' 'a'; echo err >&2", { maxOutputBytes: 2048 }));
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBe(2048);
    expect(r.stderr).toBe("err\n");
  });

  test("killAll stops live commands and abort signals work", async () => {
    const runner = createPlainRunner();
    const p = runner.exec(req("sleep 30"));
    await Bun.sleep(100);
    expect(runner.running()).toBe(1);
    expect(await runner.killAll()).toBe(1);
    const r = await p;
    expect(r.killed).toBe(true);
    expect(runner.running()).toBe(0);
    const ac = new AbortController();
    const q = runner.exec(req("sleep 30", { signal: ac.signal }));
    setTimeout(() => ac.abort(), 50);
    expect((await q).killed).toBe(true);
  });

  test("cwd must be inside a writable path", async () => {
    const other = await tmp("other");
    await expect(createPlainRunner().exec(req("true", { cwd: other }))).rejects.toBeInstanceOf(RunnerError);
    await expect(createPlainRunner().exec(req("true", { writablePaths: ["/"] }))).rejects.toThrow("too broad");
  });
});

describe("seatbelt", () => {
  test("profile passes paths as parameters and gates network", () => {
    const p = buildSeatbeltProfile({ writable: ["/w/proj \")(allow default)"], network: false, dataDir: "/data", home: "/Users/o" });
    expect(p.profile).not.toContain("/w/proj");
    expect(p.profile).not.toContain("(allow network");
    expect(p.profile.startsWith("(version 1)\n(deny default)")).toBe(true);
    expect(Object.values(p.params)).toContain('/w/proj ")(allow default)');
    expect(Object.values(p.params)).toContain("/Users/o/.ssh");
    expect(Object.values(p.params)).toContain("/data");
    const withNet = buildSeatbeltProfile({ writable: ["/w"], network: true, dataDir: "/data", home: "/Users/o" });
    expect(withNet.profile).toContain("(allow network*)");
    expect(withNet.profile).not.toContain("remote tcp");
  });

  test("profile denies the engine port last, after any network allow, on every address", () => {
    for (const network of [true, false]) {
      const p = buildSeatbeltProfile({ writable: ["/w"], network, dataDir: "/data", home: "/Users/o", denyTcpPorts: [4190, 0, 70000] });
      const lines = p.profile.split("\n");
      expect(lines.at(-1)).toBe('(deny network-outbound (remote tcp "*:4190"))');
      expect(lines.filter((l) => l.includes("remote tcp"))).toHaveLength(1);
      if (network) expect(lines.indexOf("(allow network*)")).toBeLessThan(lines.length - 1);
    }
  });

  test("fails closed when sandbox-exec cannot start", async () => {
    const runner = createSeatbeltRunner({ dataDir: ws, sandboxExec: "/nonexistent/sandbox-exec" });
    let err: unknown = null;
    try {
      await runner.exec(req("echo should-not-run > ran.txt"));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RunnerError);
    expect((err as RunnerError).code).toBe("sandbox_unavailable");
    expect(await Bun.file(join(ws, "ran.txt")).exists()).toBe(false);
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

  test.skipIf(!sandboxWorks)("jails writes and reads on macOS", async () => {
    const data = await tmp("data");
    const outside = await tmp("outside");
    await writeFile(join(data, "app.db"), "vault");
    await mkdir(join(ws, ".git", "hooks"), { recursive: true });
    const runner = createSeatbeltRunner({ dataDir: data });
    const inside = await runner.exec(req("echo hi > in.txt && cat in.txt && echo $HOME"));
    expect(inside.exitCode).toBe(0);
    expect(inside.stdout).toBe(`hi\n${ws}\n`);
    const escape = await runner.exec(req(`echo x > ${outside}/escape.txt`));
    expect(escape.exitCode).not.toBe(0);
    expect(await Bun.file(join(outside, "escape.txt")).exists()).toBe(false);
    const readData = await runner.exec(req(`cat ${data}/app.db`));
    expect(readData.exitCode).not.toBe(0);
    expect(readData.stdout).not.toContain("vault");
    const hook = await runner.exec(req("echo evil > .git/hooks/pre-commit"));
    expect(hook.exitCode).not.toBe(0);
    const tmpWrite = await runner.exec(req('echo t > "$TMPDIR/t.txt" && cat "$TMPDIR/t.txt"'));
    expect(tmpWrite.stdout).toBe("t\n");
    const timed = await runner.exec(req("sleep 30", { timeoutMs: 200 }));
    expect(timed.timedOut).toBe(true);
  });

  test.skipIf(!sandboxWorks)("a crew command cannot reach the engine port, network on or off; other loopback ports and the internet still work", async () => {
    const { Response: NativeResponse } = (await import(String("undici"))) as { Response: typeof Response };
    const hits: string[] = [];
    const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (r) => (hits.push(new URL(r.url).pathname), new NativeResponse("engine")) });
    const other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new NativeResponse("other") });
    try {
      const data = await tmp("data");
      const runner = createSeatbeltRunner({ dataDir: data });
      const P = engine.port!;
      const net = { network: true, denyTcpPorts: [P] };
      for (const url of [`http://127.0.0.1:${P}/api/settings`, `http://localhost:${P}/x`, `http://[::ffff:127.0.0.1]:${P}/x`, `http://0.0.0.0:${P}/x`]) {
        const r = await runner.exec(req(`curl -sS -g -m 5 -X PATCH -H 'Origin: http://127.0.0.1:${P}' '${url}'`, net));
        expect(`${url} ${r.exitCode}`).toBe(`${url} 7`);
      }
      const viaBun = await runner.exec(req(`"${process.execPath}" -e 'fetch("http://127.0.0.1:${P}/b").then(() => console.log("reached"), () => console.log("blocked"))'`, net));
      expect(viaBun.stdout.trim()).toBe("blocked");
      const offline = await runner.exec(req(`curl -sS -m 5 http://127.0.0.1:${P}/off`, { network: false, denyTcpPorts: [P] }));
      expect(offline.exitCode).not.toBe(0);
      expect(hits).toEqual([]);
      const loopback = await runner.exec(req(`curl -sS -m 5 http://127.0.0.1:${other.port}/`, net));
      expect(loopback.stdout).toBe("other");
      const external = Bun.spawnSync(["/usr/bin/curl", "-sS", "-m", "8", "-o", "/dev/null", "https://example.com/"]).exitCode === 0;
      if (external) expect((await runner.exec(req("curl -sS -m 8 -o /dev/null -w '%{http_code}' https://example.com/", net))).stdout).toBe("200");
      else console.warn("seatbelt engine port test: no external network, external host check skipped");
    } finally {
      engine.stop(true);
      other.stop(true);
    }
  }, 60_000);
});
