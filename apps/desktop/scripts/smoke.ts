// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Smoke test for the built macOS app. Bun only, no user interaction, and no
// macOS permission prompt (no AppleScript, no Apple Events, loopback only).
//
//   bun run smoke                     the dmg in dist/, mounted read-only and detached after
//   bun run smoke -- --app <path>     a MengAI.app instead of the dmg
//   bun run smoke -- --open           also launch the app with `open -g`, confirm its sidecar
//                                     answers, then quit it (SIGTERM to the shell; the sidecar
//                                     exits on stdin close, the documented contract)
//
// Sidecar checks run the bundled Contents/MacOS/mengai-api the way the shell does
// (cleared env, stdin held open), each on a fresh temp data dir:
//   1 embedded: no MENGAI_MIGRATIONS_DIR, so the SQL compiled into the binary is used
//   2 shell:    MENGAI_MIGRATIONS_DIR = Contents/Resources/migrations, stopped by closing stdin
//   3 restart:  the data dir of 1 again, nothing left to apply
// Each one: ready line within 30 s (valid port; controlToken valid when present, local
// mode has no auth), GET /api/health 200, GET / and GET /app (what the window loads)
// serve the bundled web app, schema_migrations holds every bundled version, clean exit
// within 5 s.
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, rmdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { capture, distDir, dmgName, readSidecarScript, readTauriConf, SIDECAR_NAME } from "./lib";

const READY_MS = 30_000;
const EXIT_MS = 5_000;
const HTTP_MS = 3_000;
/** Same rule as the shell's token_ok (src-tauri/src/sidecar.rs). */
const TOKEN = /^[A-Za-z0-9._~-]{16,512}$/;
/** Parent vars the shell passes through (sidecar.rs ENV_ALLOWLIST). */
const ENV_ALLOWLIST = ["HOME", "USER", "LOGNAME", "TMPDIR", "PATH", "LANG", "SHELL", "TZ"];

export interface SidecarCheck {
  label: string;
  bin: string;
  webDir: string;
  /** Folder passed as MENGAI_MIGRATIONS_DIR, or null to use the migrations embedded in the binary. */
  migrationsDir: string | null;
  /** Versions schema_migrations must hold afterwards. */
  expect: string[];
  /** Reuse a data dir (restart check); default a fresh temp dir. */
  dataDir?: string;
  stop: "sigterm" | "stdin";
}

export interface SidecarResult {
  label: string;
  dataDir: string;
  port: number;
  readyMs: number;
  health: string;
  versions: string[];
  exitCode: number | null;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: no result within ${ms} ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

function lines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  return (async () => {
    const dec = new TextDecoder();
    const reader = stream.getReader();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    }
    if (buf) onLine(buf);
  })();
}

function sidecarEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && (ENV_ALLOWLIST.includes(k) || k.startsWith("LC_"))) env[k] = v;
  }
  return { ...env, ...extra };
}

/** Boots the sidecar once and checks the contract end to end. Throws with the sidecar's stderr tail on failure. */
export async function checkSidecar(c: SidecarCheck): Promise<SidecarResult> {
  const dataDir = c.dataDir ?? (await mkdtemp(join(tmpdir(), "mengai-smoke-")));
  const env = sidecarEnv({
    MENGAI_MODE: "local",
    MENGAI_DATA_DIR: dataDir,
    MENGAI_WORKSPACES_DIR: join(dataDir, "workspaces"),
    MENGAI_WEB_DIR: c.webDir,
    MENGAI_HANDS_BIN: join(c.webDir, "..", "hands", "mengai-hands"),
    ...(c.migrationsDir ? { MENGAI_MIGRATIONS_DIR: c.migrationsDir } : {}),
  });
  const started = performance.now();
  const proc = Bun.spawn({ cmd: [c.bin], env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const stderr: string[] = [];
  const errDone = lines(proc.stderr, (l) => {
    stderr.push(l);
    if (stderr.length > 200) stderr.shift();
  });
  let resolveReady!: (line: string) => void;
  const readyLine = new Promise<string>((r) => (resolveReady = r));
  const outDone = lines(proc.stdout, (l) => {
    if (l.trim().startsWith("{") && l.includes('"ready"')) resolveReady(l.trim());
  });
  const fail = (msg: string): never => {
    const tail = stderr.slice(-20).join("\n");
    throw new Error(`[${c.label}] ${msg}\n--- sidecar stderr (tail) ---\n${tail}`);
  };

  try {
    const line = await withTimeout(
      Promise.race([
        readyLine,
        proc.exited.then((code): never => {
          throw new Error(`sidecar exited with ${code} before the ready line`);
        }),
      ]),
      READY_MS,
      "ready line",
    ).catch((e: Error) => fail(e.message));
    const readyMs = Math.round(performance.now() - started);
    const ready = JSON.parse(line) as { event: string; port: number; controlToken?: string | null };
    if (ready.event !== "ready" || !Number.isInteger(ready.port) || ready.port < 1 || ready.port > 65535) fail("ready line has no valid port");
    if (ready.controlToken != null && !TOKEN.test(ready.controlToken)) fail("ready line controlToken breaks the contract");

    const base = `http://127.0.0.1:${ready.port}`;
    const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(HTTP_MS) });
    const healthBody = (await health.text()).slice(0, 300);
    if (health.status !== 200) fail(`GET /api/health answered ${health.status}: ${healthBody}`);
    for (const path of ["/", "/app"]) {
      const page = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(HTTP_MS) });
      const body = await page.text();
      if (page.status !== 200 || !/<html/i.test(body)) fail(`GET ${path} did not serve the bundled web app (status ${page.status})`);
    }

    if (c.stop === "sigterm") proc.kill("SIGTERM");
    else proc.stdin.end();
    const exitCode = await withTimeout(proc.exited, EXIT_MS, "clean exit").catch((e: Error) => fail(e.message));
    if (exitCode !== 0) fail(`sidecar exited with ${exitCode} after ${c.stop}`);
    await Promise.all([outDone, errDone]);

    const db = new Database(join(dataDir, "app.db"), { readonly: true });
    let versions: string[];
    try {
      versions = db.query<{ version: string }, []>("select version from schema_migrations order by version").all().map((r) => r.version);
    } finally {
      db.close();
    }
    const missing = c.expect.filter((v) => !versions.includes(v));
    if (missing.length > 0) fail(`schema_migrations is missing ${missing.join(", ")} (has ${versions.join(", ")})`);
    return { label: c.label, dataDir, port: ready.port, readyMs, health: healthBody, versions, exitCode };
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill("SIGKILL");
      await proc.exited;
    }
  }
}

/** Contents/Resources/migrations/sqlite/*.sql inside the app: what both the embedded set and the folder must cover. */
async function bundledVersions(app: string): Promise<string[]> {
  const dir = join(app, "Contents", "Resources", "migrations", "sqlite");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`no bundled migrations in ${dir}`);
  return files;
}

/** The three sidecar checks against a built MengAI.app. Temp data dirs are removed afterwards. */
export async function smokeApp(app: string): Promise<SidecarResult[]> {
  const bin = join(app, "Contents", "MacOS", SIDECAR_NAME);
  const resources = join(app, "Contents", "Resources");
  const webDir = join(resources, "web");
  if (!existsSync(bin)) throw new Error(`sidecar missing at ${bin}`);
  if (!existsSync(join(webDir, "index.html"))) throw new Error(`bundled web app missing at ${webDir}`);
  const expect = await bundledVersions(app);
  const results: SidecarResult[] = [];
  const dirs: string[] = [];
  try {
    const embedded = await checkSidecar({ label: "embedded", bin, webDir, migrationsDir: null, expect, stop: "sigterm" });
    dirs.push(embedded.dataDir);
    results.push(embedded);
    const shell = await checkSidecar({ label: "shell", bin, webDir, migrationsDir: join(resources, "migrations"), expect, stop: "stdin" });
    dirs.push(shell.dataDir);
    results.push(shell);
    results.push(await checkSidecar({ label: "restart", bin, webDir, migrationsDir: null, expect, dataDir: embedded.dataDir, stop: "sigterm" }));
  } finally {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  }
  return results;
}

interface Proc {
  pid: number;
  ppid: number;
  command: string;
}

async function processes(): Promise<Proc[]> {
  const { out } = await capture(["ps", "-axo", "pid=,ppid=,command="]);
  return out
    .split("\n")
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3]! }));
}

async function waitFor<T>(what: string, ms: number, probe: () => Promise<T | null>): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await probe();
    if (v !== null) return v;
    await Bun.sleep(250);
  }
  throw new Error(`${what}: not seen within ${ms} ms`);
}

export interface OpenResult {
  shellPid: number;
  sidecarPid: number;
  port: number;
  health: number;
  quitMs: number;
}

/**
 * Launches the app in the background, confirms the shell spawned its sidecar and
 * the sidecar answers, then quits. Removes the app's data, cache and WebKit
 * folders afterwards when this run created them (the log folder is kept).
 */
export async function smokeOpen(app: string, productName: string, identifier: string): Promise<OpenResult> {
  const shellBin = join(app, "Contents", "MacOS", productName);
  const sidecarBin = join(app, "Contents", "MacOS", SIDECAR_NAME);
  if ((await processes()).some((p) => p.command.startsWith(shellBin))) throw new Error(`${productName} is already running from ${app}; quit it first`);
  const lib = join(homedir(), "Library");
  const owned = [join(lib, "Application Support", identifier), join(lib, "Caches", identifier), join(lib, "WebKit", identifier)];
  const fresh = owned.filter((p) => !existsSync(p));
  const workspaces = await mkdtemp(join(tmpdir(), "mengai-smoke-ws-"));
  let shellPid = 0;
  let sidecarPid = 0;
  try {
    const opened = await capture(["open", "-g", "-n", "--env", `MENGAI_WORKSPACES_DIR=${workspaces}`, app]);
    if (opened.code !== 0) throw new Error(`open failed: ${opened.out.trim()}`);
    const found = await waitFor("shell and sidecar processes", 30_000, async () => {
      const ps = await processes();
      const shell = ps.find((p) => p.command.startsWith(shellBin));
      const sidecar = shell && ps.find((p) => p.command.startsWith(sidecarBin) && p.ppid === shell.pid);
      return shell && sidecar ? { shell: shell.pid, sidecar: sidecar.pid } : null;
    });
    shellPid = found.shell;
    sidecarPid = found.sidecar;
    const port = await waitFor("sidecar listening on loopback", 30_000, async () => {
      const { out } = await capture(["lsof", "-nP", "-a", "-p", String(sidecarPid), "-iTCP", "-sTCP:LISTEN", "-Fn"]);
      const m = /^n127\.0\.0\.1:(\d+)$/m.exec(out);
      return m ? Number(m[1]) : null;
    });
    const health = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(HTTP_MS) });
    await health.text();
    if (health.status !== 200) throw new Error(`GET /api/health on the app's sidecar answered ${health.status}`);

    const quitStart = Date.now();
    process.kill(shellPid, "SIGTERM");
    await waitFor("shell and sidecar exit", 10_000, async () => {
      const ps = await processes();
      return ps.some((p) => p.pid === shellPid || p.pid === sidecarPid) ? null : true;
    });
    return { shellPid, sidecarPid, port, health: health.status, quitMs: Date.now() - quitStart };
  } finally {
    const ps = await processes();
    for (const pid of [sidecarPid, shellPid]) {
      if (pid > 1 && ps.some((p) => p.pid === pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
    await rm(workspaces, { recursive: true, force: true });
    for (const p of fresh) await rm(p, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const conf = await readTauriConf();
  const { triple } = await readSidecarScript();
  const appArg = args.includes("--app") ? args[args.indexOf("--app") + 1] : undefined;
  const open = args.includes("--open");
  let mount: string | null = null;
  let app: string;
  if (appArg) {
    app = appArg;
  } else {
    const dmg = join(distDir, dmgName(conf.productName, conf.version, triple));
    if (!existsSync(dmg)) throw new Error(`${dmg} not found; run \`bun run build\` first or pass --app <path>`);
    mount = await mkdtemp(join(tmpdir(), "mengai-dmg-"));
    const attach = await capture(["hdiutil", "attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount, dmg]);
    if (attach.code !== 0) throw new Error(`hdiutil attach failed: ${attach.out.trim()}`);
    app = join(mount, `${conf.productName}.app`);
    console.log(`mounted ${basename(dmg)} at ${mount}`);
  }
  try {
    for (const r of await smokeApp(app)) {
      console.log(`ok sidecar ${r.label}: ready in ${r.readyMs} ms on 127.0.0.1:${r.port}, health ${r.health}, migrations ${r.versions.join(" ")}, exit ${r.exitCode}`);
    }
    if (open) {
      const r = await smokeOpen(app, conf.productName, conf.identifier);
      console.log(`ok open -g: shell pid ${r.shellPid} spawned sidecar pid ${r.sidecarPid} on 127.0.0.1:${r.port}, health ${r.health}, both exited ${r.quitMs} ms after SIGTERM to the shell`);
    }
    console.log("smoke passed");
  } finally {
    if (mount) {
      const detach = await capture(["hdiutil", "detach", mount]);
      if (detach.code !== 0) await capture(["hdiutil", "detach", "-force", mount]);
      // rmdir only removes an empty folder, so a mount that failed to detach is never touched.
      await rmdir(mount).catch(() => console.warn(`could not remove ${mount}; check \`hdiutil info\``));
    }
  }
}

if (import.meta.main) {
  await main();
}
