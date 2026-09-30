// Live preview and Open folder: detection order, the minimal env, URL
// parsing, the ring buffer, the process lifecycle with a fake spawner and a
// fake probe fetch (ready, fallback port, exit, timeout, install), the cap
// of three, stop and shutdown killing the process group, the static server
// (traversal, dotfiles, symlinks, Host check) and reveal. On macOS a real dev
// server runs under the engine port guard: it cannot reach the engine port
// or start an app through open(1), and still serves and reaches other ports.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { PreviewDTO } from "@mengai/shared";
import type { AppConfig, ModuleContext } from "../../core/module";
import { sandboxUnavailable } from "../../lib/engine-guard";
import { HttpError } from "../../lib/http";
import { captureEvents, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { detectPreview, NOTHING_TO_PREVIEW } from "./detect";
import { PREVIEW_ENV_KEYS, previewEnv, previewPath } from "./env";
import { createPreviewModule } from "./index";
import { LOG_LINES, LogRing, parseLocalUrl, stripAnsi } from "./output";
import type { PreviewFetch, PreviewOptions, PreviewProcess, PreviewService, StaticServer } from "./ports";
import { createStaticHandler, serveStatic } from "./static";
import { openerEnv, portFree, revealArgv } from "./system";

// the root bunfig preloads happy-dom; Bun.serve and fetch need the native classes
const native = (await import(String("undici"))) as { Request: typeof Request; Response: typeof Response; Headers: typeof Headers; fetch: typeof fetch };
const saved = { Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers };
beforeAll(() => {
  Object.assign(globalThis, { Request: native.Request, Response: native.Response, Headers: native.Headers });
});

const made: string[] = [];
afterAll(async () => {
  Object.assign(globalThis, saved);
  for (const d of made) await rm(d, { recursive: true, force: true });
});

async function tmp(prefix = "ws"): Promise<string> {
  const d = await realpath(await mkdtemp(join(tmpdir(), `mengai-preview-${prefix}-`)));
  made.push(d);
  return d;
}

async function files(root: string, map: Record<string, string>): Promise<string> {
  for (const [rel, content] of Object.entries(map)) {
    await mkdir(join(root, rel, ".."), { recursive: true });
    await writeFile(join(root, rel), content);
  }
  return root;
}

const pkg = (scripts: Record<string, string>, extra: Record<string, unknown> = {}) => JSON.stringify({ name: "x", scripts, ...extra });

function context(mode: "local" | "server" = "local", allowedHosts: string[] = ["127.0.0.1:4190", "localhost:4190"]): ModuleContext {
  const config: AppConfig = {
    mode,
    version: "test",
    dataDir: "/nonexistent",
    workspacesDir: "/nonexistent",
    webDir: null,
    allowedOrigins: [],
    allowedHosts,
    controlToken: null,
  };
  return { config, db: null as never, kv: memoryKv(), blob: null as never, vault: memoryVault(), clock: fakeClock(), logger: silentLogger, events: captureEvents() };
}

// ------------------------------------------------------------------ fakes
const enc = new TextEncoder();

interface FakeProc extends PreviewProcess {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  signals: string[];
  print(text: string, stream?: "stdout" | "stderr"): void;
  exit(code: number | null): void;
}

function fakeSpawner(behavior: (argv: string[]) => { exitOnTerm?: boolean; exitCode?: number; lines?: string[] } = () => ({})) {
  const procs: FakeProc[] = [];
  const spawn = (argv: string[], opts: { cwd: string; env: Record<string, string> }): PreviewProcess => {
    const b = behavior(argv);
    let out!: ReadableStreamDefaultController<Uint8Array>;
    let err!: ReadableStreamDefaultController<Uint8Array>;
    let done = false;
    let resolveExit!: (code: number | null) => void;
    const exited = new Promise<number | null>((r) => (resolveExit = r));
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      try {
        out.close();
        err.close();
      } catch {
        // already closed
      }
      resolveExit(code);
    };
    const proc: FakeProc = {
      pid: 5000 + procs.length,
      argv,
      cwd: opts.cwd,
      env: opts.env,
      signals: [],
      stdout: new ReadableStream<Uint8Array>({ start: (c) => void (out = c) }),
      stderr: new ReadableStream<Uint8Array>({ start: (c) => void (err = c) }),
      exited,
      kill(signal) {
        proc.signals.push(signal);
        if (signal === "SIGKILL" || b.exitOnTerm !== false) finish(null);
      },
      print(text, stream = "stdout") {
        if (!done) (stream === "stdout" ? out : err).enqueue(enc.encode(text));
      },
      exit: finish,
    };
    procs.push(proc);
    for (const line of b.lines ?? []) queueMicrotask(() => proc.print(`${line}\n`));
    if (b.exitCode !== undefined) setTimeout(() => finish(b.exitCode!), 5);
    return proc;
  };
  return { spawn, procs };
}

function fakeFetch() {
  const up = new Set<string>();
  const seen: string[] = [];
  const fetch: PreviewFetch = async (url) => {
    seen.push(url);
    if (!up.has(url)) throw new Error("ECONNREFUSED");
    return { status: 200, body: null };
  };
  return { fetch, up, seen };
}

const SECRETS = {
  OPENAI_API_KEY: "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
  ANTHROPIC_API_KEY: "sk-ant-abcdefghijklmnop",
  MENGAI_VAULT_KEK: "kek-value-that-must-stay",
  MENGAI_DATA_DIR: "/Users/me/Library/Application Support/MengAI",
  AWS_SECRET_ACCESS_KEY: "aws-secret-value-123",
  GITHUB_TOKEN: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  DATABASE_URL: "postgres://user:pass@db/x",
  NODE_OPTIONS: "--require /tmp/evil.js",
};
const SOURCE_ENV = { PATH: "/Users/me/.nvm/versions/node/v22/bin:relative/bin:/usr/bin", LANG: "id_ID.UTF-8", ...SECRETS };

function service(o: PreviewOptions & { mode?: "local" | "server"; hosts?: string[] } = {}) {
  const sp = fakeSpawner();
  const ff = fakeFetch();
  const opened: string[][] = [];
  const opts: PreviewOptions = {
    spawn: o.spawn ?? sp.spawn,
    fetch: o.fetch ?? ff.fetch,
    portFree: o.portFree ?? (async () => true),
    serveStatic: o.serveStatic,
    open:
      o.open ??
      (async (argv) => {
        opened.push(argv);
        return 0;
      }),
    platform: o.platform ?? "darwin",
    which: o.which ?? ((cmd) => `/usr/local/bin/${cmd}`),
    env: o.env ?? SOURCE_ENV,
    home: o.home ?? "/Users/me",
    limits: { pollMs: 5, startTimeoutMs: 300, installTimeoutMs: 500, stopGraceMs: 20, ...o.limits },
  };
  const mod = createPreviewModule(context(o.mode, o.hosts), {}, opts);
  return { svc: mod.service, mod, sp, ff, opened };
}

async function until(svc: PreviewService, id: string, root: string, ok: (d: PreviewDTO) => boolean, ms = 2000): Promise<PreviewDTO> {
  const end = Date.now() + ms;
  for (;;) {
    const d = await svc.status(id, root);
    if (ok(d)) return d;
    if (Date.now() > end) throw new Error(`timed out waiting, last status ${d.status}: ${d.error ?? ""}`);
    await Bun.sleep(5);
  }
}

async function rejectsHttp(p: Promise<unknown>, status: number): Promise<HttpError> {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status as HttpError["status"]);
  return err as HttpError;
}

// -------------------------------------------------------------- detection
describe("detection", () => {
  test("scripts in order dev, start, preview; bun by default", async () => {
    const root = await tmp();
    await files(root, { "package.json": pkg({ preview: "vite preview", start: "node server.js", dev: "vite" }), "index.html": "<p>x</p>" });
    expect(await detectPreview(root)).toMatchObject({ kind: "script", script: "dev", tool: "bun", argv: ["bun", "run", "dev"], command: "bun run dev", install: null });
    await files(root, { "package.json": pkg({ preview: "vite preview", start: "node server.js" }) });
    expect(await detectPreview(root)).toMatchObject({ script: "start", command: "bun run start" });
    await files(root, { "package.json": pkg({ preview: "vite preview", build: "vite build" }) });
    expect(await detectPreview(root)).toMatchObject({ script: "preview" });
    // a blank script does not count
    await files(root, { "package.json": pkg({ dev: "  ", test: "bun test" }) });
    expect(await detectPreview(root)).toEqual({ kind: "static", dir: root, command: "static index.html" });
  });

  test("the lockfile picks the tool; bun wins; packageManager is the fallback", async () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ "pnpm-lock.yaml": "" }, "pnpm"],
      [{ "yarn.lock": "" }, "yarn"],
      [{ "package-lock.json": "{}" }, "npm"],
      [{ "bun.lock": "", "package-lock.json": "{}" }, "bun"],
      [{ "bun.lockb": "" }, "bun"],
    ];
    for (const [locks, tool] of cases) {
      const root = await files(await tmp(), { "package.json": pkg({ dev: "vite" }), ...locks });
      expect(await detectPreview(root)).toMatchObject({ tool, command: `${tool} run dev` });
    }
    const pm = await files(await tmp(), { "package.json": pkg({ dev: "next dev" }, { packageManager: "pnpm@9.1.0" }) });
    expect(await detectPreview(pm)).toMatchObject({ tool: "pnpm" });
  });

  test("dependencies without node_modules install first", async () => {
    const root = await files(await tmp(), { "package.json": pkg({ dev: "vite" }, { devDependencies: { vite: "^6" } }), "yarn.lock": "" });
    expect(await detectPreview(root)).toMatchObject({ install: { argv: ["yarn", "install"], command: "yarn install" } });
    await mkdir(join(root, "node_modules"));
    expect(await detectPreview(root)).toMatchObject({ install: null });
  });

  test("static index.html in root, then dist, build, public, out", async () => {
    const root = await tmp();
    await files(root, { "out/index.html": "o", "public/index.html": "p", "build/index.html": "b" });
    expect(await detectPreview(root)).toEqual({ kind: "static", dir: join(root, "build"), command: "static build/index.html" });
    await files(root, { "dist/index.html": "d" });
    expect(await detectPreview(root)).toMatchObject({ dir: join(root, "dist"), command: "static dist/index.html" });
    await files(root, { "index.html": "r" });
    expect(await detectPreview(root)).toMatchObject({ dir: root, command: "static index.html" });
  });

  test("a dist symlinked out of the workspace is never served", async () => {
    const outside = await files(await tmp("outside"), { "index.html": "secret page" });
    const root = await tmp();
    await symlink(outside, join(root, "dist"));
    expect(await detectPreview(root)).toEqual({ kind: "none", reason: NOTHING_TO_PREVIEW });
  });

  test("nothing previewable has a plain reason", async () => {
    expect(await detectPreview(await tmp())).toEqual({ kind: "none", reason: NOTHING_TO_PREVIEW });
    const broken = await files(await tmp(), { "package.json": "{ not json" });
    const d = await detectPreview(broken);
    expect(d.kind).toBe("none");
    expect(d.kind === "none" && d.reason.startsWith("package.json could not be read.")).toBe(true);
  });
});

// -------------------------------------------------------------------- env
describe("env", () => {
  test("only the seven keys, no secret, no MENGAI_* variable, absolute PATH entries", () => {
    const env = previewEnv({ port: 4301, home: "/Users/me", source: SOURCE_ENV, exists: () => false });
    expect(Object.keys(env).sort()).toEqual([...PREVIEW_ENV_KEYS].sort());
    expect(env).toMatchObject({ HOME: "/Users/me", LANG: "id_ID.UTF-8", PORT: "4301", HOST: "127.0.0.1", BROWSER: "none", NODE_ENV: "development" });
    const all = JSON.stringify(env);
    for (const value of Object.values(SECRETS)) expect(all).not.toContain(value);
    expect(all).not.toContain("MENGAI");
    expect(env.PATH.split(":").every((p) => p.startsWith("/"))).toBe(true);
    expect(env.PATH.split(":")[0]).toBe("/Users/me/.nvm/versions/node/v22/bin");
    expect(previewPath("", "/h", (p) => p === "/h/.bun/bin")).toContain("/h/.bun/bin");
    expect(previewEnv({ port: 1, home: "/h", source: { LANG: "x; rm -rf /" } }).LANG).toBe("en_US.UTF-8");
  });

  test("the file manager env keeps the desktop session only", () => {
    const env = openerEnv({ ...SOURCE_ENV, HOME: "/Users/me", DISPLAY: ":0" });
    expect(Object.keys(env).sort()).toEqual(["DISPLAY", "HOME", "LANG", "PATH"]);
  });
});

// ----------------------------------------------------------------- output
describe("output", () => {
  test("local URLs from dev server lines; LAN, low and engine ports ignored", () => {
    const blocked = new Set([4190]);
    expect(parseLocalUrl("  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m", blocked)).toBe("http://localhost:5173/");
    expect(parseLocalUrl("- Local:        http://localhost:3000", blocked)).toBe("http://localhost:3000/");
    expect(parseLocalUrl("ready - started server on 0.0.0.0:3000, url: http://127.0.0.1:3000.", blocked)).toBe("http://127.0.0.1:3000/");
    expect(parseLocalUrl("Local: http://localhost:5173/app/", blocked)).toBe("http://localhost:5173/app/");
    expect(parseLocalUrl("Network: http://192.168.1.20:5173/", blocked)).toBeNull();
    expect(parseLocalUrl("see http://localhost:80/ or http://evil.test:5173/", blocked)).toBeNull();
    expect(parseLocalUrl("Local: http://127.0.0.1:4190/api/killswitch", blocked)).toBeNull();
    expect(parseLocalUrl("Local: http://localhost.evil.test:5173/", blocked)).toBeNull();
    expect(stripAnsi("\u001b]8;;http://x\u0007link\u001b]8;;\u0007")).toBe("link");
  });

  test("the ring keeps the last 40 redacted lines, per stream, progress redraws collapsed", () => {
    const seen: string[] = [];
    const ring = new LogRing(undefined, (l) => seen.push(l));
    for (let i = 0; i < 50; i++) ring.push("stdout", `line ${i}\n`);
    expect(ring.tail()).toHaveLength(LOG_LINES);
    expect(ring.tail()[0]).toBe("line 10");
    ring.push("stdout", "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456 lo");
    ring.push("stderr", "warn: half\n");
    ring.push("stdout", "aded\n");
    ring.push("stdout", "10%\r50%\r100% done\n");
    const tail = ring.tail();
    expect(tail.at(-3)).toBe("warn: half");
    expect(tail.at(-2)).toBe("OPENAI_API_KEY=[REDACTED] loaded");
    expect(tail.at(-1)).toBe("100% done");
    expect(tail.join("\n")).not.toContain("sk-proj");
    ring.push("stdout", "no newline yet");
    ring.flush();
    expect(ring.tail().at(-1)).toBe("no newline yet");
    expect(seen.length).toBe(54);
  });
});

// ------------------------------------------------------------- lifecycle
describe("script previews with a fake spawner", () => {
  test("spawns bun run dev in the workspace with the minimal env, reads the printed URL, ready on 127.0.0.1", async () => {
    const root = await files(await tmp(), { "package.json": pkg({ dev: "vite" }) });
    const { svc, sp, ff } = service();
    ff.up.add("http://127.0.0.1:5173/");
    const first = await svc.start("p1", root);
    expect(first).toMatchObject({ status: "starting", kind: "script", command: "bun run dev", url: null });
    await Bun.sleep(1);
    sp.procs[0]!.print("\n  VITE v6.0.0  ready in 120 ms\n\n  ➜  Local:   http://localhost:5173/\n  ➜  Network: use --host to expose\n");
    const ready = await until(svc, "p1", root, (d) => d.status === "ready");
    expect(ready.url).toBe("http://127.0.0.1:5173/");
    expect(ready.logTail).toContain("  ➜  Local:   http://localhost:5173/");
    const proc = sp.procs[0]!;
    expect(proc.argv).toEqual(["/usr/local/bin/bun", "run", "dev"]);
    expect(proc.cwd).toBe(root);
    expect(Object.keys(proc.env).sort()).toEqual([...PREVIEW_ENV_KEYS].sort());
    expect(proc.env.PORT).toBe("4300");
    for (const value of Object.values(SECRETS)) expect(JSON.stringify(proc.env)).not.toContain(value);
    // the same start again is a no-op; restart true spawns a fresh process
    expect((await svc.start("p1", root)).status).toBe("ready");
    expect(sp.procs).toHaveLength(1);
    await svc.start("p1", root, { restart: true });
    expect(sp.procs).toHaveLength(2);
    expect(proc.signals).toEqual(["SIGTERM", "SIGKILL"]);
    await svc.close();
  });

  test("without a printed URL it probes the assigned port", async () => {
    const root = await files(await tmp(), { "package.json": pkg({ start: "node server.js" }), "package-lock.json": "{}" });
    const { svc, sp, ff } = service({ portFree: async (p) => p !== 4300 });
    ff.up.add("http://127.0.0.1:4301/");
    await svc.start("p1", root);
    const ready = await until(svc, "p1", root, (d) => d.status === "ready");
    expect(ready).toMatchObject({ url: "http://127.0.0.1:4301/", command: "npm run start" });
    expect(sp.procs[0]!.argv[0]).toBe("/usr/local/bin/npm");
    expect(sp.procs[0]!.env.PORT).toBe("4301");
    await svc.close();
  });

  test("a URL on the engine's own port is ignored", async () => {
    const root = await files(await tmp(), { "package.json": pkg({ dev: "x" }) });
    const { svc, sp, ff } = service();
    ff.up.add("http://127.0.0.1:4190/");
    ff.up.add("http://127.0.0.1:4300/");
    await svc.start("p1", root);
    await Bun.sleep(1);
    sp.procs[0]!.print("Local: http://127.0.0.1:4190/\n");
    expect((await until(svc, "p1", root, (d) => d.status === "ready")).url).toBe("http://127.0.0.1:4300/");
    expect(ff.seen).not.toContain("http://127.0.0.1:4190/");
    await svc.close();
  });

  test("an exit before the first answer fails with the log tail", async () => {
    const root = await files(await tmp(), { "package.json": pkg({ dev: "vite" }) });
    const sp = fakeSpawner(() => ({ lines: ["error: Cannot find module 'vite'"], exitCode: 1 }));
    const { svc } = service({ spawn: sp.spawn });
    await svc.start("p1", root);
    const failed = await until(svc, "p1", root, (d) => d.status === "failed");
    expect(failed.error).toBe("bun run dev exited with code 1 before the preview answered. The log shows its last lines.");
    expect(failed.logTail).toEqual(["$ bun run dev", "error: Cannot find module 'vite'"]);
    expect(failed.url).toBeNull();
    await svc.close();
  });

  test("no answer within the start timeout kills the group and fails", async () => {
    const root = await files(await tmp(), { "package.json": pkg({ dev: "sleep 999" }) });
    const { svc, sp } = service({ limits: { startTimeoutMs: 60 } });
    await svc.start("p1", root);
    const failed = await until(svc, "p1", root, (d) => d.status === "failed");
    expect(failed.error).toBe("The dev server did not answer within 0 s. The log shows its last lines.");
    expect(sp.procs[0]!.signals).toEqual(["SIGTERM", "SIGKILL"]);
    await svc.close();
  });

  test("dependencies install first; a failed install stops there", async () => {
    const root = await files(await tmp(), { "package.json": pkg({ dev: "vite" }, { dependencies: { vite: "^6" } }), "pnpm-lock.yaml": "" });
    const sp = fakeSpawner((argv) => (argv[1] === "install" ? { lines: ["Packages: +42"], exitCode: 0 } : {}));
    const { svc, ff } = service({ spawn: sp.spawn });
    ff.up.add("http://127.0.0.1:4300/");
    expect((await svc.start("p1", root)).status).toBe("installing");
    const ready = await until(svc, "p1", root, (d) => d.status === "ready");
    expect(sp.procs.map((p) => p.argv)).toEqual([
      ["/usr/local/bin/pnpm", "install"],
      ["/usr/local/bin/pnpm", "run", "dev"],
    ]);
    expect(ready.logTail.slice(0, 3)).toEqual(["$ pnpm install", "Packages: +42", "$ pnpm run dev"]);
    await svc.close();

    const bad = fakeSpawner((argv) => (argv[1] === "install" ? { lines: ["ERR_PNPM_FETCH_404"], exitCode: 1 } : {}));
    const second = service({ spawn: bad.spawn });
    await second.svc.start("p2", root);
    const failed = await until(second.svc, "p2", root, (d) => d.status === "failed");
    expect(failed.error).toBe("pnpm install failed with exit code 1. The log shows its last lines.");
    expect(bad.procs).toHaveLength(1);
    await second.svc.close();
  });

  test("a missing tool fails with a plain reason; nothing previewable fails without spawning", async () => {
    const root = await files(await tmp(), { "package.json": pkg({ dev: "vite" }) });
    const { svc, sp } = service({ which: () => null });
    await svc.start("p1", root);
    expect((await until(svc, "p1", root, (d) => d.status === "failed")).error).toContain("Could not find bun on this computer");
    const empty = await tmp();
    const idle = await svc.status("p2", empty);
    expect(idle).toMatchObject({ status: "idle", kind: null, command: null, error: NOTHING_TO_PREVIEW });
    const failed = await svc.start("p2", empty);
    expect(failed).toMatchObject({ status: "failed", error: NOTHING_TO_PREVIEW });
    expect(sp.procs).toHaveLength(0);
    await svc.close();
  });

  test("at most three at once: the oldest stops to make room", async () => {
    const { svc, sp, ff } = service();
    const roots: string[] = [];
    for (let i = 0; i < 4; i++) roots.push(await files(await tmp(), { "package.json": pkg({ dev: "vite" }) }));
    for (let i = 0; i < 4; i++) ff.up.add(`http://127.0.0.1:${4300 + i}/`);
    for (let i = 0; i < 3; i++) {
      await svc.start(`p${i}`, roots[i]!);
      await until(svc, `p${i}`, roots[i]!, (d) => d.status === "ready");
    }
    await svc.start("p3", roots[3]!);
    const first = await svc.status("p0", roots[0]!);
    expect(first.status).toBe("stopped");
    expect(first.logTail.join("\n")).toContain("at most 3 previews run at once");
    expect(sp.procs[0]!.signals).toEqual(["SIGTERM", "SIGKILL"]);
    // p3 took the freed port
    expect(sp.procs[3]!.env.PORT).toBe("4300");
    const states = await Promise.all([1, 2].map((i) => svc.status(`p${i}`, roots[i]!)));
    expect(states.map((s) => s.status)).toEqual(["ready", "ready"]);
    await svc.close();
  });

  test("stop, the kill switch and shutdown kill every process group", async () => {
    const { svc, sp, ff, mod } = service();
    const a = await files(await tmp(), { "package.json": pkg({ dev: "a" }) });
    const b = await files(await tmp(), { "package.json": pkg({ dev: "b" }) });
    ff.up.add("http://127.0.0.1:4300/");
    ff.up.add("http://127.0.0.1:4301/");
    await svc.start("a", a);
    await svc.start("b", b);
    await until(svc, "b", b, (d) => d.status === "ready");
    const stopped = await svc.stop("a");
    expect(stopped).toMatchObject({ status: "stopped", url: null, error: null });
    expect(sp.procs[0]!.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(await svc.stop("never-started")).toMatchObject({ status: "idle" });
    // a group that ignores SIGTERM still gets SIGKILL after the grace period
    const stubborn = fakeSpawner(() => ({ exitOnTerm: false }));
    const s2 = service({ spawn: stubborn.spawn });
    s2.ff.up.add("http://127.0.0.1:4300/");
    await s2.svc.start("x", a);
    await until(s2.svc, "x", a, (d) => d.status === "ready");
    expect(await s2.svc.stopAll()).toBe(1);
    expect(stubborn.procs[0]!.signals).toEqual(["SIGTERM", "SIGKILL"]);
    // shutdown (module close) stops b and refuses new starts
    await mod.close!();
    expect(sp.procs[1]!.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect((await svc.status("b", b)).status).toBe("stopped");
    await rejectsHttp(svc.start("b", b), 503);
  });

  test("forget stops the preview of a deleted project", async () => {
    const { svc, sp, ff } = service();
    const a = await files(await tmp(), { "package.json": pkg({ dev: "a" }) });
    ff.up.add("http://127.0.0.1:4300/");
    await svc.start("a", a);
    await until(svc, "a", a, (d) => d.status === "ready");
    await svc.forget("a");
    expect(sp.procs[0]!.signals[0]).toBe("SIGTERM");
    expect((await svc.status("a", a)).status).toBe("idle");
  });

  test("server mode refuses every call with 404", async () => {
    const root = await files(await tmp(), { "index.html": "x" });
    const { svc, sp, opened } = service({ mode: "server" });
    await rejectsHttp(svc.status("p", root), 404);
    await rejectsHttp(svc.start("p", root), 404);
    await rejectsHttp(svc.stop("p"), 404);
    await rejectsHttp(svc.reveal(root), 404);
    expect(sp.procs).toHaveLength(0);
    expect(opened).toHaveLength(0);
  });
});

describe("a real dev server", () => {
  test("bun run dev is spawned for real, answers, and stop kills its whole process group", async () => {
    const root = await files(await tmp(), {
      "package.json": pkg({ dev: "bun server.ts" }),
      "server.ts": [
        'const child = Bun.spawn(["sleep", "30"]);',
        'const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.PORT), fetch: () => new Response(`live ${process.env.OPENAI_API_KEY ?? "no key"}`) });',
        "console.log(`child ${child.pid}`);",
        "console.log(`  Local:   http://localhost:${server.port}/`);",
      ].join("\n"),
    });
    const svc = createPreviewModule(context(), {}, { fetch: (url, init) => native.fetch(url, init), env: { ...process.env, ...SECRETS }, limits: { pollMs: 50, stopGraceMs: 500 } }).service;
    try {
      await svc.start("real", root);
      const ready = await until(svc, "real", root, (d) => d.status === "ready" || d.status === "failed", 20_000);
      expect(ready.error).toBeNull();
      expect(ready.url).toMatch(/^http:\/\/127\.0\.0\.1:43\d\d\/$/);
      expect(await (await native.fetch(ready.url!)).text()).toBe("live no key");
      const childPid = Number(/child (\d+)/.exec(ready.logTail.join("\n"))?.[1]);
      expect(childPid).toBeGreaterThan(0);
      expect(() => process.kill(childPid, 0)).not.toThrow();
      expect((await svc.stop("real")).status).toBe("stopped");
      await Bun.sleep(100);
      expect(() => process.kill(childPid, 0)).toThrow();
      expect(await portFree(Number(new URL(ready.url!).port))).toBe(true);
    } finally {
      await svc.close();
    }
  }, 30_000);

  test.skipIf(sandboxUnavailable() !== null)("under the engine port guard: the engine port and open(1) are closed, its own port and other ports work", async () => {
    const hits: string[] = [];
    const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (r) => (hits.push(new URL(r.url).pathname), new native.Response("engine")) });
    const other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new native.Response("other") });
    const root = await files(await tmp(), {
      "package.json": pkg({ dev: "bun server.ts" }),
      "server.ts": [
        "const probe = (url: string, init?: RequestInit) => fetch(url, init).then((r) => String(r.status), () => \"blocked\");",
        `const e = await probe("http://127.0.0.1:${engine.port}/api/settings", { method: "PATCH", headers: { origin: "http://127.0.0.1:${engine.port}", "content-type": "application/json" }, body: "{}" });`,
        `const m = await probe("http://[::ffff:127.0.0.1]:${engine.port}/m");`,
        `const o = await probe("http://127.0.0.1:${other.port}/");`,
        'const opened = Bun.spawnSync(["/usr/bin/open", "-g", "-j", "-n", "Probe.app"]).exitCode;',
        "console.log(`probe engine=${e} mapped=${m} other=${o} open=${opened === 0 ? \"ran\" : \"refused\"}`);",
        'Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.PORT), fetch: () => new Response("guarded") });',
      ].join("\n"),
      // a hidden agent app the dev script tries to start through LaunchServices; it would call the engine
      "Probe.app/Contents/Info.plist": `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>probe</string><key>CFBundleIdentifier</key><string>id.mengai.test.preview-probe</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`,
      "Probe.app/Contents/MacOS/probe": `#!/bin/sh\n/usr/bin/curl -s http://127.0.0.1:${engine.port}/escaped\n`,
    });
    await chmod(join(root, "Probe.app/Contents/MacOS/probe"), 0o755);
    const svc = createPreviewModule(context("local", [`127.0.0.1:${engine.port}`, `localhost:${engine.port}`]), {}, { fetch: (url, init) => native.fetch(url, init), limits: { pollMs: 50, stopGraceMs: 500 } }).service;
    try {
      await svc.start("guarded", root);
      const ready = await until(svc, "guarded", root, (d) => d.status === "ready" || d.status === "failed", 20_000);
      expect(ready.error).toBeNull();
      expect(await (await native.fetch(ready.url!)).text()).toBe("guarded");
      expect(ready.logTail.join("\n")).toContain("probe engine=blocked mapped=blocked other=200 open=refused");
      await Bun.sleep(1000);
      expect(hits).toEqual([]);
    } finally {
      await svc.close();
      engine.stop(true);
      other.stop(true);
    }
  }, 30_000);
});

// ------------------------------------------------------------------ static
describe("static previews", () => {
  test("served on 127.0.0.1 in the preview range, stopped on stop", async () => {
    const root = await files(await tmp(), { "index.html": "<h1>hello cat</h1>", "about/index.html": "about" });
    let port = 4300;
    while (!(await portFree(port))) port++;
    const servers: StaticServer[] = [];
    const { svc } = service({
      portFree,
      limits: { ports: [port, 4399] },
      serveStatic: (dir, p) => {
        const s = serveStatic(dir, p);
        servers.push(s);
        return s;
      },
    });
    const ready = await svc.start("p1", root);
    expect(ready).toMatchObject({ status: "ready", kind: "static", command: "static index.html", url: `http://127.0.0.1:${port}/` });
    const res = await native.fetch(ready.url!);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>hello cat</h1>");
    expect(await (await native.fetch(`${ready.url}about/`)).text()).toBe("about");
    expect((await svc.stop("p1")).status).toBe("stopped");
    expect(servers).toHaveLength(1);
    expect(await portFree(port)).toBe(true);
  });

  test("traversal, dotfiles, encoded separators and symlinks out are 404; Host must be local", async () => {
    const outside = await files(await tmp("outside"), { "secret.txt": "top secret" });
    const root = await files(await tmp(), { "index.html": "home", ".env": "KEY=1", "app.js": "js", ".git/config": "git" });
    await symlink(join(outside, "secret.txt"), join(root, "leak.txt"));
    await symlink(outside, join(root, "linked"));
    const handler = createStaticHandler(root, 4321);
    const get = (path: string, host = "127.0.0.1:4321", method = "GET") => handler(new native.Request(`http://127.0.0.1:4321${path}`, { method, headers: { host } }));
    expect(await (await get("/")).text()).toBe("home");
    expect((await get("/app.js")).headers.get("content-type")).toContain("javascript");
    const escape = `/..%2f${basename(outside)}%2fsecret.txt`;
    for (const path of [escape, "/..%2f..%2fetc%2fpasswd", "/.env", "/.git/config", "/leak.txt", "/linked/secret.txt", "/a%5c..%5c..%5csecret", "/%00", "/missing.css"]) {
      const res = await get(path);
      expect(`${path} ${res.status}`).toBe(`${path} 404`);
      expect(await res.text()).not.toContain("top secret");
    }
    // extensionless misses fall back to index.html (built SPAs); dot segments the URL parser resolves stay inside
    expect(await (await get("/some/route")).text()).toBe("home");
    expect(await (await get("/%2e%2e/%2e%2e/etc/passwd")).text()).toBe("home");
    expect((await get("/", "attacker.test:4321")).status).toBe(403);
    expect((await get("/", "127.0.0.1:9999")).status).toBe(403);
    expect((await get("/", "localhost:4321", "POST")).status).toBe(405);
    expect((await get("/", "localhost:4321", "HEAD")).status).toBe(200);
  });
});

// ------------------------------------------------------------------ reveal
describe("reveal", () => {
  test("opens only the given folder with an argv array per platform", async () => {
    const root = await tmp();
    const { svc, opened } = service();
    await svc.reveal(root);
    expect(opened).toEqual([["/usr/bin/open", root]]);
    expect(revealArgv("linux", root)).toEqual(["xdg-open", root]);
    expect(revealArgv("win32", root)).toEqual(["explorer.exe", root]);
    await rejectsHttp(svc.reveal("relative/path"), 404);
    await rejectsHttp(svc.reveal(join(root, "missing")), 404);
    await writeFile(join(root, "file.txt"), "x");
    await rejectsHttp(svc.reveal(join(root, "file.txt")), 404);
    expect(opened).toHaveLength(1);
  });

  test("a failing file manager answers 503; explorer's exit 1 is not a failure", async () => {
    const root = await tmp();
    await rejectsHttp(service({ open: async () => 3, platform: "linux" }).svc.reveal(root), 503);
    await rejectsHttp(
      service({
        open: async () => {
          throw new Error("ENOENT xdg-open");
        },
        platform: "linux",
      }).svc.reveal(root),
      503,
    );
    await service({ open: async () => 1, platform: "win32" }).svc.reveal(root);
  });
});
