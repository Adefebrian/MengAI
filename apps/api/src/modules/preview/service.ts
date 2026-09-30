// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// PreviewService: runs what the crew built so the owner can look at it.
// Local engine only. One preview per project, at most three at once (the
// oldest stops to make room). A script preview installs dependencies when
// node_modules is missing, spawns `<tool> run <script>` in the workspace
// with the minimal env from env.ts, keeps a redacted 40 line log, takes the
// URL the dev server prints (127.0.0.1 or localhost) or probes its assigned
// port, and is ready once an HTTP GET answers; 90 s without an answer fails
// with the log tail. A static preview is a tiny Bun.serve on 127.0.0.1.
// Stop kills the whole process group (SIGTERM, then SIGKILL); the kill
// switch and engine shutdown stop every preview. Installs and dev servers run
// under sandbox-exec with the engine port guard (lib/engine-guard.ts): no
// outbound TCP to the engine's own port, no LaunchServices, no Apple events;
// everything else (network, their files, their own port) works as before.
import type { PreviewDTO, PreviewStatus } from "@mengai/shared";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute } from "node:path";
import type { ModuleContext } from "../../core/module";
import { createEngineSandbox, enginePorts as hostPorts, PREVIEW_RULES } from "../../lib/engine-guard";
import { HttpError, notFound, unavailable } from "../../lib/http";
import { redact } from "../../lib/redact";
import { detectPreview, type Detection, type PackageTool } from "./detect";
import { previewEnv, previewPath } from "./env";
import { LogRing, parseLocalUrl } from "./output";
import type { FolderOpener, PortFree, PreviewFetch, PreviewLimits, PreviewOptions, PreviewProcess, PreviewService, PreviewSpawner, StaticServe, StaticServer } from "./ports";
import { serveStatic } from "./static";
import { createBunSpawner, createOpener, portFree, revealArgv } from "./system";

export const PREVIEW_LIMITS: PreviewLimits = {
  maxActive: 3,
  startTimeoutMs: 90_000,
  installTimeoutMs: 5 * 60_000,
  pollMs: 500,
  stopGraceMs: 2000,
  ports: [4300, 4399],
};

export const LOCAL_ONLY = "Live preview and Open folder run only in the MengAI app on your computer";

const ACTIVE: ReadonlySet<PreviewStatus> = new Set(["installing", "starting", "ready"]);
const PROBE_TIMEOUT_MS = 1500;

const MISSING_TOOL: Record<PackageTool, string> = {
  bun: "Could not find bun on this computer. Install it from bun.sh, then start the preview again.",
  npm: "Could not find npm on this computer. Install Node.js, then start the preview again.",
  pnpm: "Could not find pnpm on this computer. Install it with npm install -g pnpm, then start the preview again.",
  yarn: "Could not find yarn on this computer. Install it with npm install -g yarn, then start the preview again.",
};

interface Entry {
  projectId: string;
  status: PreviewStatus;
  kind: "script" | "static" | null;
  command: string | null;
  url: string | null;
  error: string | null;
  startedAt: number | null;
  log: LogRing;
  /** the first local URL the dev server printed */
  detected: string | null;
  proc: PreviewProcess | null;
  server: StaticServer | null;
  port: number | null;
  /** aborted by stop, eviction and shutdown: the start task bails at its next step */
  cancel: AbortController;
  task: Promise<void> | null;
}

const errText = (e: unknown) => redact(e instanceof Error ? e.message : String(e));

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

async function readInto(stream: ReadableStream<Uint8Array>, name: string, log: LogRing): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      log.push(name, decoder.decode(value, { stream: true }));
    }
  } catch {
    // stream torn down by a kill
  } finally {
    log.flush(name);
  }
}

const defaultFetch: PreviewFetch = (url, init) =>
  // localhost dev servers with a self-signed certificate still count as up
  fetch(url, { ...init, tls: { rejectUnauthorized: false } } as RequestInit);

export function createPreviewService(ctx: ModuleContext, opts: PreviewOptions = {}): PreviewService {
  const limits: PreviewLimits = { ...PREVIEW_LIMITS, ...opts.limits };
  const log = ctx.logger.child({ module: "preview" });
  const guard = createEngineSandbox({ label: "live preview", ports: () => hostPorts(ctx.config.allowedHosts), extraRules: PREVIEW_RULES, logger: log });
  const spawn: PreviewSpawner = opts.spawn ?? createBunSpawner((argv) => guard.wrap(argv));
  const probeFetch: PreviewFetch = opts.fetch ?? defaultFetch;
  const isFree: PortFree = opts.portFree ?? portFree;
  const serve: StaticServe = opts.serveStatic ?? serveStatic;
  const platform = opts.platform ?? process.platform;
  const open: FolderOpener = opts.open ?? createOpener();
  const source = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const which =
    opts.which ??
    ((command: string, path: string) => Bun.which(command, { PATH: path }) ?? (command === "bun" && basename(process.execPath) === "bun" ? process.execPath : null));

  const entries = new Map<string, Entry>();
  const reserved = new Set<number>();
  const locks = new Map<string, Promise<unknown>>();
  let closed = false;

  function guardLocal(): void {
    if (ctx.config.mode !== "local") throw new HttpError(404, "not_found", LOCAL_ONLY);
  }

  /** the engine's own ports (from the Host allowlist): a printed URL pointing there is ignored */
  function enginePorts(): Set<number> {
    return new Set(hostPorts(ctx.config.allowedHosts));
  }

  /** one start or stop at a time per project */
  function serial<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const next = (locks.get(projectId) ?? Promise.resolve()).catch(() => undefined).then(fn);
    locks.set(projectId, next);
    void next
      .finally(() => {
        if (locks.get(projectId) === next) locks.delete(projectId);
      })
      .catch(() => undefined);
    return next;
  }

  function fresh(projectId: string): Entry {
    const entry: Entry = {
      projectId,
      status: "idle",
      kind: null,
      command: null,
      url: null,
      error: null,
      startedAt: null,
      detected: null,
      log: new LogRing(undefined, (line) => {
        if (entry.detected || entry.kind !== "script") return;
        entry.detected = parseLocalUrl(line, enginePorts());
      }),
      proc: null,
      server: null,
      port: null,
      cancel: new AbortController(),
      task: null,
    };
    return entry;
  }

  const idle = (projectId: string): PreviewDTO => ({ projectId, status: "idle", url: null, command: null, kind: null, logTail: [], error: null, startedAt: null });

  const dto = (e: Entry): PreviewDTO => ({
    projectId: e.projectId,
    status: e.status,
    url: e.status === "ready" ? e.url : null,
    command: e.command,
    kind: e.kind,
    logTail: e.log.tail(),
    error: e.error,
    startedAt: e.startedAt,
  });

  function fail(e: Entry, message: string): void {
    e.status = "failed";
    e.error = message;
    e.url = null;
    log.log("warn", "preview failed", { projectId: e.projectId, error: message });
  }

  function release(e: Entry): void {
    if (e.port !== null) reserved.delete(e.port);
    e.port = null;
  }

  /** reserves the first free port in the range; null when every port is taken */
  async function pickPort(): Promise<number | null> {
    const [lo, hi] = limits.ports;
    for (let port = lo; port <= hi; port++) {
      if (reserved.has(port)) continue;
      reserved.add(port);
      if (await isFree(port).catch(() => false)) return port;
      reserved.delete(port);
    }
    return null;
  }

  const noPort = () => `No free port between ${limits.ports[0]} and ${limits.ports[1]} for the preview. Stop another preview or app, then try again.`;

  /** SIGTERM the group, give it the grace period, then SIGKILL whatever is left of it */
  async function killGroup(proc: PreviewProcess): Promise<void> {
    proc.kill("SIGTERM");
    const exited = await Promise.race([proc.exited.then(() => true), sleep(limits.stopGraceMs).then(() => false)]);
    proc.kill("SIGKILL");
    if (!exited) await Promise.race([proc.exited, sleep(1000)]);
  }

  /** stops whatever runs for this entry; returns 1 when something was running */
  async function halt(e: Entry): Promise<number> {
    const wasActive = ACTIVE.has(e.status) || e.proc !== null || e.server !== null;
    e.cancel.abort();
    const proc = e.proc;
    const server = e.server;
    e.proc = null;
    e.server = null;
    if (proc) await killGroup(proc).catch((err) => log.log("warn", "preview kill failed", { projectId: e.projectId, error: errText(err) }));
    if (server) await server.stop().catch((err) => log.log("warn", "preview server stop failed", { projectId: e.projectId, error: errText(err) }));
    release(e);
    if (e.task) await e.task.catch(() => undefined);
    e.log.flush();
    e.url = null;
    if (ACTIVE.has(e.status)) e.status = "stopped";
    return wasActive ? 1 : 0;
  }

  /** marks the oldest active previews stopped (synchronously) until this one fits */
  function evict(projectId: string): Entry[] {
    const active = [...entries.values()]
      .filter((e) => e.projectId !== projectId && ACTIVE.has(e.status))
      .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    const victims: Entry[] = [];
    while (active.length + 1 > limits.maxActive) {
      const victim = active.shift()!;
      victim.status = "stopped";
      victim.log.note(`Stopped to make room: at most ${limits.maxActive} previews run at once.`);
      victims.push(victim);
    }
    return victims;
  }

  async function answers(url: string, signal: AbortSignal): Promise<boolean> {
    try {
      const res = await probeFetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]) });
      await res.body?.cancel().catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  function candidates(e: Entry): string[] {
    if (e.detected) {
      const url = new URL(e.detected);
      if (url.hostname !== "localhost") return [e.detected];
      url.hostname = "127.0.0.1";
      return [url.href, e.detected];
    }
    return e.port === null ? [] : [`http://127.0.0.1:${e.port}/`];
  }

  async function startStatic(e: Entry, dir: string): Promise<void> {
    const tried: number[] = [];
    try {
      for (;;) {
        const port = await pickPort();
        if (port === null) return fail(e, noPort());
        try {
          e.server = serve(dir, port);
          e.port = port;
          break;
        } catch {
          // taken by something that raced us: keep it reserved until the loop ends
          tried.push(port);
        }
      }
    } finally {
      for (const port of tried) reserved.delete(port);
    }
    e.url = `http://127.0.0.1:${e.port}/`;
    e.status = "ready";
    e.log.note(`Serving ${e.command?.replace(/^static /, "")} on ${e.url}`);
  }

  /** runs an install to completion inside the entry (stop kills it); null when it timed out */
  async function runToExit(e: Entry, argv: string[], cwd: string, env: Record<string, string>): Promise<number | null> {
    const proc = spawn(argv, { cwd, env });
    e.proc = proc;
    const reading = Promise.all([readInto(proc.stdout, "stdout", e.log), readInto(proc.stderr, "stderr", e.log)]);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void killGroup(proc);
    }, limits.installTimeoutMs);
    try {
      const code = await proc.exited;
      await Promise.race([reading, sleep(500)]);
      return timedOut ? null : code;
    } finally {
      clearTimeout(timer);
      if (e.proc === proc) e.proc = null;
    }
  }

  async function runScript(e: Entry, root: string, d: Extract<Detection, { kind: "script" }>): Promise<void> {
    const signal = e.cancel.signal;
    const path = previewPath(source.PATH, home);
    const bin = which(d.tool, path);
    if (!bin) return fail(e, MISSING_TOOL[d.tool]);
    try {
      if (d.install) {
        e.status = "installing";
        e.log.note(`$ ${d.install.command}`);
        const code = await runToExit(e, [bin, ...d.install.argv.slice(1)], root, previewEnv({ port: limits.ports[0], home, source }));
        if (signal.aborted) return;
        if (code !== 0) {
          return fail(e, code === null ? `${d.install.command} did not finish in ${Math.round(limits.installTimeoutMs / 1000)} s.` : `${d.install.command} failed with exit code ${code}. The log shows its last lines.`);
        }
      }
      e.status = "starting";
      const port = await pickPort();
      if (signal.aborted) {
        if (port !== null) reserved.delete(port);
        return;
      }
      if (port === null) return fail(e, noPort());
      e.port = port;
      e.log.note(`$ ${d.command}`);
      const proc = spawn([bin, ...d.argv.slice(1)], { cwd: root, env: previewEnv({ port, home, source }) });
      e.proc = proc;
      void readInto(proc.stdout, "stdout", e.log);
      void readInto(proc.stderr, "stderr", e.log);
      let exit: { code: number | null } | null = null;
      void proc.exited.then((code) => {
        exit = { code };
        if (e.proc !== proc) return;
        e.proc = null;
        release(e);
        if (signal.aborted) return;
        e.log.flush();
        if (e.status === "ready" && code === 0) {
          e.status = "stopped";
          e.url = null;
          e.log.note("The dev server exited.");
        } else if (e.status === "ready") {
          fail(e, `The dev server stopped with exit code ${code ?? "signal"}.`);
        } else {
          fail(e, `${d.command} exited${code === null ? "" : ` with code ${code}`} before the preview answered. The log shows its last lines.`);
        }
      });
      const deadline = Date.now() + limits.startTimeoutMs;
      for (;;) {
        if (signal.aborted || exit) return;
        for (const url of candidates(e)) {
          if (!(await answers(url, signal))) continue;
          if (signal.aborted || exit || e.proc !== proc) return;
          e.url = url;
          e.status = "ready";
          e.log.note(`Ready on ${url}`);
          log.log("info", "preview ready", { projectId: e.projectId, command: d.command, url });
          return;
        }
        if (Date.now() >= deadline) {
          e.cancel.abort();
          e.proc = null;
          await killGroup(proc);
          release(e);
          e.log.flush();
          return fail(e, `The dev server did not answer within ${Math.round(limits.startTimeoutMs / 1000)} s. The log shows its last lines.`);
        }
        await sleep(limits.pollMs, signal);
      }
    } catch (err) {
      if (!signal.aborted) fail(e, `Could not start ${d.command}: ${errText(err)}`);
    }
  }

  const service: PreviewService = {
    async status(projectId, root) {
      guardLocal();
      const e = entries.get(projectId);
      if (e) return dto(e);
      const d = await detectPreview(root);
      if (d.kind === "none") return { ...idle(projectId), error: d.reason };
      return { ...idle(projectId), kind: d.kind, command: d.command };
    },

    async start(projectId, root, opts = {}) {
      guardLocal();
      if (closed) throw unavailable("MengAI is shutting down");
      return serial(projectId, async () => {
        const current = entries.get(projectId);
        if (current && ACTIVE.has(current.status) && !opts.restart) return dto(current);
        if (current) await halt(current);
        const d = await detectPreview(root);
        const e = fresh(projectId);
        // re-insert so the map keeps start order
        entries.delete(projectId);
        entries.set(projectId, e);
        if (d.kind === "none") {
          fail(e, d.reason);
          return dto(e);
        }
        e.kind = d.kind;
        e.command = d.command;
        e.startedAt = ctx.clock.now();
        e.status = d.kind === "script" && d.install ? "installing" : "starting";
        const victims = evict(projectId);
        await Promise.all(victims.map((v) => halt(v)));
        log.log("info", "preview starting", { projectId, kind: d.kind, command: d.command, evicted: victims.length });
        if (d.kind === "static") await startStatic(e, d.dir);
        else e.task = runScript(e, root, d);
        return dto(e);
      });
    },

    async stop(projectId) {
      guardLocal();
      return serial(projectId, async () => {
        const e = entries.get(projectId);
        if (!e) return idle(projectId);
        await halt(e);
        e.status = "stopped";
        e.error = null;
        return dto(e);
      });
    },

    async forget(projectId) {
      await serial(projectId, async () => {
        const e = entries.get(projectId);
        if (!e) return;
        entries.delete(projectId);
        await halt(e);
      });
    },

    async reveal(root) {
      guardLocal();
      if (typeof root !== "string" || !isAbsolute(root) || root.includes("\0")) throw notFound("workspace folder");
      const s = await stat(root).catch(() => null);
      if (!s?.isDirectory()) throw notFound("workspace folder");
      let code: number | null;
      try {
        code = await open(revealArgv(platform, root));
      } catch (err) {
        log.log("warn", "open folder failed", { error: errText(err) });
        throw unavailable("Could not open the folder in the file manager");
      }
      // explorer.exe answers 1 even when the window opened
      if (platform !== "win32" && code !== 0) throw unavailable("Could not open the folder in the file manager");
    },

    async stopAll() {
      const all = [...entries.values()];
      const counts = await Promise.all(
        all.map(async (e) => {
          const n = await halt(e);
          if (n) e.log.note("Stopped by the kill switch or shutdown.");
          return n;
        }),
      );
      return counts.reduce((a, b) => a + b, 0);
    },

    async close() {
      closed = true;
      await service.stopAll();
    },
  };
  return service;
}
