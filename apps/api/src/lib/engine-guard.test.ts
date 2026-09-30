// Engine guard (lib/engine-guard.ts): the rules, the wrap, the log-once
// fallback, and on this Mac the real thing: inside each profile curl and a
// Bun fetch to the engine port fail on every loopback spelling, while
// another loopback port and an external host still work, and an app bundle
// started with open(1) cannot reach the engine. The real part skips where
// sandbox-exec is missing.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEngineSandbox,
  engineDenyRules,
  engineGuardProfile,
  enginePorts,
  MCP_RULES,
  PREVIEW_RULES,
  SANDBOX_EXEC,
  sandboxUnavailable,
  type WarnSink,
} from "./engine-guard";

// the root bunfig preloads happy-dom, whose Response Bun.serve does not accept; use Bun's native one
const { Response: NativeResponse } = (await import(String("undici"))) as { Response: typeof Response };

function capture(): WarnSink & { lines: Array<{ level: string; msg: string; fields?: Record<string, unknown> }> } {
  const lines: Array<{ level: string; msg: string; fields?: Record<string, unknown> }> = [];
  return { lines, log: (level, msg, fields) => void lines.push({ level, msg, fields }) };
}

describe("rules", () => {
  test("engine ports come from the Host allowlist, validated", () => {
    expect(enginePorts(["127.0.0.1:4190", "localhost:4190"])).toEqual([4190]);
    expect(enginePorts(["127.0.0.1", "localhost:0", "x:70000", "127.0.0.1:abc", "[::1]:5000"])).toEqual([5000]);
    expect(enginePorts([])).toEqual([]);
  });

  test("deny rules cover every address on the port and nothing but integers reaches the profile", () => {
    expect(engineDenyRules([4190, 4190])).toEqual(['(deny network-outbound (remote tcp "*:4190"))']);
    expect(engineDenyRules([0, -1, 1.5, 65536, Number.NaN, '4190")(allow default' as unknown as number])).toEqual([]);
    const profile = engineGuardProfile([4190], PREVIEW_RULES);
    expect(profile.split("\n")).toEqual(["(version 1)", "(allow default)", '(deny network-outbound (remote tcp "*:4190"))', "(deny lsopen)", "(deny appleevent-send)"]);
    expect(engineGuardProfile([4190], MCP_RULES)).toContain("(deny lsopen)");
    expect(engineGuardProfile([4190], MCP_RULES)).not.toContain("appleevent");
    // never the localhost filter: it misses [::ffff:127.0.0.1]
    expect(profile).not.toContain("localhost");
  });
});

describe("wrap", () => {
  test("no known port: argv unchanged (the engine accepts no Host yet)", () => {
    const sb = createEngineSandbox({ label: "t", ports: () => [], platform: "darwin" });
    expect(sb.wrap(["/bin/echo", "hi"])).toEqual(["/bin/echo", "hi"]);
  });

  test("without sandbox-exec: argv unchanged and the gap is logged once", () => {
    const log = capture();
    const sb = createEngineSandbox({ label: "live preview", ports: () => [4190], platform: "linux", logger: log });
    expect(sb.wrap(["bun", "run", "dev"])).toEqual(["bun", "run", "dev"]);
    expect(sb.wrap(["bun", "run", "dev"])).toEqual(["bun", "run", "dev"]);
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toMatchObject({ level: "warn", msg: "live preview processes run without the engine port guard", fields: { platform: "linux" } });
    const missing = capture();
    const mac = createEngineSandbox({ label: "MCP server", ports: () => [4190], platform: "darwin", sandboxExec: "/nonexistent/sandbox-exec", logger: missing });
    expect(mac.wrap(["npx", "server"])).toEqual(["npx", "server"]);
    mac.wrap(["npx", "server"]);
    expect(missing.lines).toHaveLength(1);
    expect(String(missing.lines[0]!.fields?.reason)).toContain("not found");
  });

  test.skipIf(sandboxUnavailable() !== null)("with sandbox-exec: the profile and argv follow, ports read at every spawn", () => {
    let ports = [4190];
    const sb = createEngineSandbox({ label: "t", ports: () => ports, extraRules: MCP_RULES });
    expect(sb.wrap(["npx", "-y", "server"])).toEqual([SANDBOX_EXEC, "-p", engineGuardProfile([4190], MCP_RULES), "--", "npx", "-y", "server"]);
    ports = [5555];
    expect(sb.wrap(["x"])[2]).toContain('"*:5555"');
  });
});

// ------------------------------------------------------------ real sandbox
const sandboxWorks = sandboxUnavailable() === null;

describe.skipIf(!sandboxWorks)("on this Mac", () => {
  const hits: string[] = [];
  let engine: ReturnType<typeof Bun.serve>;
  let other: ReturnType<typeof Bun.serve>;
  let dir: string;

  beforeAll(async () => {
    engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => (hits.push(new URL(req.url).pathname), new NativeResponse("engine")) });
    other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new NativeResponse("other") });
    dir = await realpath(await mkdtemp(join(tmpdir(), "mengai-guard-")));
  });
  afterAll(async () => {
    engine.stop(true);
    other.stop(true);
    await rm(dir, { recursive: true, force: true });
  });

  async function run(argv: string[]): Promise<{ code: number | null; out: string; err: string }> {
    const p = Bun.spawn(argv, { cwd: dir, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { PATH: "/usr/bin:/bin", HOME: dir } });
    const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code, out: out.trim(), err: err.trim() };
  }
  const curl = (url: string, extra: string[] = []) => ["/usr/bin/curl", "-sS", "-g", "-m", "8", ...extra, url];
  const bunFetch = (url: string) => [process.execPath, "-e", `fetch(${JSON.stringify(url)}).then(async (r) => console.log(await r.text()), (e) => { console.log("blocked " + e.code); process.exit(3); })`];

  let externalReachable: boolean | null = null;
  async function external(): Promise<boolean> {
    externalReachable ??= (await run(curl("https://example.com/", ["-o", "/dev/null"]))).code === 0;
    return externalReachable;
  }

  for (const [name, rules] of [["live preview", PREVIEW_RULES], ["MCP server", MCP_RULES]] as const) {
    test(`${name} profile: engine port refused, other loopback port and external host work`, async () => {
      const sb = createEngineSandbox({ label: name, ports: () => [engine.port!], extraRules: rules });
      const P = engine.port;
      hits.length = 0;
      for (const url of [`http://127.0.0.1:${P}/c`, `http://localhost:${P}/c`, `http://[::ffff:127.0.0.1]:${P}/c`, `http://0.0.0.0:${P}/c`, `http://127.1:${P}/c`]) {
        const r = await run(sb.wrap(curl(url)));
        expect(`${url} ${r.code}`).toBe(`${url} 7`);
      }
      const viaBun = await run(sb.wrap(bunFetch(`http://127.0.0.1:${P}/b`)));
      expect(viaBun.code).toBe(3);
      expect(viaBun.out).toStartWith("blocked");
      expect(hits).toEqual([]);
      // the same commands outside the sandbox do reach it (the refusal is the guard, not the network)
      expect((await run(curl(`http://127.0.0.1:${P}/control`))).out).toBe("engine");
      expect(hits).toEqual(["/control"]);
      expect((await run(sb.wrap(curl(`http://127.0.0.1:${other.port}/`)))).out).toBe("other");
      expect((await run(sb.wrap(bunFetch(`http://localhost:${other.port}/`)))).out).toBe("other");
      if (await external()) expect((await run(sb.wrap(curl("https://example.com/", ["-o", "/dev/null", "-w", "%{http_code}"])))).out).toBe("200");
      else console.warn("engine-guard test: no external network, external host check skipped");
    }, 60_000);
  }

  test("a process under the guard can still listen on its own port", async () => {
    const sb = createEngineSandbox({ label: "live preview", ports: () => [engine.port!], extraRules: PREVIEW_RULES });
    const script = 'const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("own") }); const r = await fetch(`http://127.0.0.1:${s.port}/`); console.log(await r.text()); s.stop(true);';
    const r = await run(sb.wrap([process.execPath, "-e", script]));
    expect(r.out).toBe("own");
    expect(r.code).toBe(0);
  }, 30_000);

  test("an app bundle started with open(1) cannot carry the call out of the sandbox", async () => {
    // a hidden agent app (LSUIElement) whose only job is to call the engine
    const app = join(dir, "Probe.app");
    await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
    await writeFile(
      join(app, "Contents", "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>probe</string><key>CFBundleIdentifier</key><string>id.mengai.test.guard-probe</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`,
    );
    await writeFile(join(app, "Contents", "MacOS", "probe"), `#!/bin/sh\n/usr/bin/curl -s http://127.0.0.1:${engine.port}/escaped\n`);
    await chmod(join(app, "Contents", "MacOS", "probe"), 0o755);
    for (const rules of [PREVIEW_RULES, MCP_RULES]) {
      hits.length = 0;
      const sb = createEngineSandbox({ label: "t", ports: () => [engine.port!], extraRules: rules });
      const r = await run(sb.wrap(["/usr/bin/open", "-g", "-j", "-n", app]));
      expect(r.code).not.toBe(0);
      await Bun.sleep(1500);
      expect(hits).toEqual([]);
    }
  }, 30_000);
});
