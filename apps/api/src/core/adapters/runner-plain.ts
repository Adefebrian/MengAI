// Plain process runner (Linux containers, server mode) and the shared exec
// core the Seatbelt runner builds on. Every command gets a scrubbed env
// (PATH, HOME = workspace, TMPDIR inside the workspace, LANG, TERM; nothing
// whose name contains KEY, TOKEN, SECRET or PASSWORD), its own process group
// (setsid), a hard timeout that SIGKILLs the whole group, stdout and stderr
// caps with a truncation flag, and killAll() for the kill switch.
//
// The plain runner has no filesystem or network jail of its own: it relies
// on the container boundary. `network` and `writablePaths` are validated
// but only the Seatbelt runner enforces them at the OS level.
import { existsSync } from "node:fs";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import type { ExecRequest, ExecResult, Runner } from "../ports/runner";

export type RunnerErrorCode = "bad_request" | "sandbox_unavailable" | "spawn_failed";

export class RunnerError extends Error {
  constructor(
    public readonly code: RunnerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RunnerError";
  }
}

const SYSTEM_PATH = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
/** toolchain bin dirs under the real home, added to PATH when present */
export const HOME_TOOL_BINS = [".bun/bin", ".cargo/bin", ".local/bin", ".deno/bin", ".volta/bin", "go/bin"];

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;
const INJECTION_NAME = /^(DYLD_.*|LD_PRELOAD|LD_LIBRARY_PATH|LD_AUDIT|BASH_ENV|ENV|PROMPT_COMMAND|IFS|SHELLOPTS|PS4)$/;
const RESERVED = new Set(["HOME", "TMPDIR", "PWD"]);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const MIN_TIMEOUT_MS = 100;
export const MAX_TIMEOUT_MS = 15 * 60_000;
export const MAX_OUTPUT_CAP = 10 * 1024 * 1024;

/** true when an env var name must never reach an agent command */
export function isSecretEnvName(name: string): boolean {
  return SECRET_NAME.test(name);
}

/** PATH for agent commands: system dirs plus toolchain bins that exist, deduped, absolute only. */
export function defaultPath(home = homedir(), exists: (p: string) => boolean = existsSync): string {
  const out: string[] = [];
  const add = (p: string) => {
    if (p.startsWith("/") && !p.includes("\0") && !p.includes(":") && !out.includes(p)) out.push(p);
  };
  for (const p of SYSTEM_PATH) add(p);
  for (const rel of HOME_TOOL_BINS) {
    const p = join(home, rel);
    if (exists(p)) add(p);
  }
  return out.join(":");
}

export interface ScrubEnvInput {
  /** workspace root: becomes HOME */
  home: string;
  /** tmp dir inside the workspace */
  tmpDir: string;
  path: string;
  extra?: Record<string, string>;
}

/** Builds the child env from scratch; the parent env is never inherited. */
export function scrubEnv(input: ScrubEnvInput): Record<string, string> {
  const env: Record<string, string> = {
    PATH: input.path,
    HOME: input.home,
    TMPDIR: input.tmpDir,
    LANG: "en_US.UTF-8",
    TERM: "dumb",
    NO_COLOR: "1",
    CI: "1",
  };
  for (const [name, value] of Object.entries(input.extra ?? {})) {
    if (!ENV_NAME.test(name) || RESERVED.has(name) || isSecretEnvName(name) || INJECTION_NAME.test(name)) continue;
    if (typeof value !== "string" || value.includes("\0")) continue;
    env[name] = value;
  }
  return env;
}

function inside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

export interface PreparedExec {
  cwd: string;
  /** realpath of every writable path */
  writable: string[];
  /** the writable path that contains cwd (HOME for the command) */
  workspace: string;
  tmpDir: string;
  env: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
}

async function realDir(p: string, what: string): Promise<string> {
  if (typeof p !== "string" || !p.startsWith("/") || p.includes("\0")) throw new RunnerError("bad_request", `${what} must be an absolute path`);
  let real: string;
  try {
    real = await realpath(p);
  } catch {
    throw new RunnerError("bad_request", `${what} does not exist`);
  }
  const st = await stat(real);
  if (!st.isDirectory()) throw new RunnerError("bad_request", `${what} is not a directory`);
  return real;
}

/** Validates the request and creates <workspace>/.mengai/tmp (git-ignored). */
export async function prepareExec(req: ExecRequest, opts: { home?: string; path?: string } = {}): Promise<PreparedExec> {
  if (typeof req.command !== "string" || req.command.trim() === "") throw new RunnerError("bad_request", "command is empty");
  if (req.command.includes("\0")) throw new RunnerError("bad_request", "command contains a NUL byte");
  if (!Array.isArray(req.writablePaths) || req.writablePaths.length === 0) {
    throw new RunnerError("bad_request", "at least one writable path (the workspace) is required");
  }
  const home = opts.home ?? homedir();
  const realHome = await realpath(home).catch(() => home);
  const cwd = await realDir(req.cwd, "cwd");
  const writable: string[] = [];
  for (const w of req.writablePaths) {
    const real = await realDir(w, "writable path");
    if (real === "/" || inside(realHome, real)) throw new RunnerError("bad_request", `writable path ${real} is too broad`);
    writable.push(real);
  }
  const workspace = writable.find((w) => inside(cwd, w));
  if (!workspace) throw new RunnerError("bad_request", "cwd must be inside a writable path");
  const tmpDir = join(workspace, ".mengai", "tmp");
  await mkdir(tmpDir, { recursive: true });
  const ignore = join(workspace, ".mengai", ".gitignore");
  if (!(await Bun.file(ignore).exists())) await writeFile(ignore, "*\n").catch(() => undefined);
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(req.timeoutMs || 0) || MIN_TIMEOUT_MS));
  const maxOutputBytes = Math.min(MAX_OUTPUT_CAP, Math.max(1024, Math.floor(req.maxOutputBytes || 0) || 1024));
  const env = scrubEnv({ home: workspace, tmpDir, path: opts.path ?? defaultPath(home), extra: req.env });
  return { cwd, writable, workspace, tmpDir, env, timeoutMs, maxOutputBytes };
}

/** grace period for pipes after the group is gone (a daemonized grandchild may still hold them) */
const DRAIN_GRACE_MS = 2000;

async function collect(stream: ReadableStream<Uint8Array>, cap: number, stop: AbortSignal): Promise<{ text: string; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let kept = 0;
  let truncated = false;
  const reader = stream.getReader();
  const onStop = () => {
    truncated = true;
    reader.cancel().catch(() => undefined);
  };
  stop.addEventListener("abort", onStop, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      if (kept < cap) {
        const take = Math.min(value.length, cap - kept);
        chunks.push(take === value.length ? value : value.subarray(0, take));
        kept += take;
        if (take < value.length) truncated = true;
      } else {
        // keep draining so the child never blocks on a full pipe
        truncated = true;
      }
    }
  } catch {
    // stream torn down by a kill; keep what we have
  } finally {
    stop.removeEventListener("abort", onStop);
    reader.releaseLock();
  }
  const buf = new Uint8Array(kept);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(buf), truncated };
}

interface LiveProc {
  kill(): void;
}

/** Spawns argv in its own process group and enforces timeout, abort and caps. */
export class ProcessGroupPool {
  private readonly live = new Map<number, LiveProc>();

  running(): number {
    return this.live.size;
  }

  killAll(): number {
    const n = this.live.size;
    for (const p of this.live.values()) p.kill();
    return n;
  }

  async run(argv: string[], prep: PreparedExec, signal?: AbortSignal): Promise<ExecResult> {
    if (signal?.aborted) {
      return { exitCode: null, signal: null, stdout: "", stderr: "", truncated: false, timedOut: false, killed: true, durationMs: 0 };
    }
    const started = performance.now();
    let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
    try {
      proc = Bun.spawn(argv, {
        cwd: prep.cwd,
        env: prep.env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        detached: true,
      });
    } catch (e) {
      throw new RunnerError("spawn_failed", `could not start the command: ${e instanceof Error ? e.message : String(e)}`);
    }
    const pid = proc.pid;
    let timedOut = false;
    let killed = false;
    const signalGroup = () => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // group already gone
      }
      try {
        proc.kill("SIGKILL");
      } catch {
        // leader already gone
      }
    };
    const entry: LiveProc = {
      kill: () => {
        killed = true;
        signalGroup();
      },
    };
    this.live.set(pid, entry);
    const timer = setTimeout(() => {
      timedOut = true;
      signalGroup();
    }, prep.timeoutMs);
    const onAbort = () => entry.kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    const drain = new AbortController();
    let grace: ReturnType<typeof setTimeout> | undefined;
    try {
      const outP = collect(proc.stdout, prep.maxOutputBytes, drain.signal);
      const errP = collect(proc.stderr, prep.maxOutputBytes, drain.signal);
      await proc.exited;
      // reap background children still holding the pipes open
      signalGroup();
      grace = setTimeout(() => drain.abort(), DRAIN_GRACE_MS);
      const [out, err] = await Promise.all([outP, errP]);
      return {
        exitCode: proc.signalCode ? null : proc.exitCode,
        signal: proc.signalCode ?? null,
        stdout: out.text,
        stderr: err.text,
        truncated: out.truncated || err.truncated,
        timedOut,
        killed: killed && !timedOut,
        durationMs: Math.round(performance.now() - started),
      };
    } finally {
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      signal?.removeEventListener("abort", onAbort);
      this.live.delete(pid);
    }
  }
}

export interface PlainRunnerOptions {
  /** real home of the host user (PATH toolchain lookup); default os.homedir() */
  home?: string;
  /** override PATH for agent commands */
  path?: string;
  shell?: string;
}

/** Linux container runner: same env scrubbing, process group, timeout and caps, no OS profile. */
export function createPlainRunner(opts: PlainRunnerOptions = {}): Runner {
  const pool = new ProcessGroupPool();
  const shell = opts.shell ?? "/bin/sh";
  return {
    async exec(req: ExecRequest): Promise<ExecResult> {
      const prep = await prepareExec(req, { home: opts.home, path: opts.path });
      return pool.run([shell, "-c", req.command], prep, req.signal);
    },
    async killAll() {
      return pool.killAll();
    },
    running: () => pool.running(),
  };
}
