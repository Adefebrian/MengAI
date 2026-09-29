// Plain process runner (Linux containers, server mode) and the shared exec
// core the Seatbelt runner builds on. Every command gets an env built from
// scratch (PATH, HOME = workspace, TMPDIR inside the workspace, LANG, TERM;
// nothing inherited from the server, nothing whose name contains KEY, TOKEN,
// SECRET or PASSWORD), its own process group (setsid), a hard timeout that
// SIGKILLs the whole group, stdout and stderr caps with a truncation flag,
// and killAll() for the kill switch. The workspace root is checked right
// before spawn and right after exit, and .mengai is never created or written
// through a symlink.
//
// The plain runner is NOT a sandbox. It has no filesystem, network or
// process jail of its own: `network` and `writablePaths` are validated but
// only the Seatbelt runner enforces them at the OS level. Residual risk:
//
//   - without a uid drop a command can read every file the server can (data dir,
//     vault, database files), reach any network the container can, and read
//     /proc/<server pid>/environ, which still holds the server's original
//     environment (provider keys, DATABASE_URL). The clean child env does not
//     hide that: it only keeps secrets out of the command's own environ.
//   - with MENGAI_RUNNER_UID (and optionally MENGAI_RUNNER_GID) set and the
//     server running as root, every command runs as that unprivileged uid
//     with no supplementary groups (a one-time probe proves it, otherwise
//     exec fails closed), so /proc/<server pid>/environ and
//     root-only files are closed to it. It can still read world-readable
//     files, use the network, see other processes' command lines, and write
//     anything that uid owns. The workspaces dir must be writable by that uid.
//
// Use it only inside a disposable container whose data dir is root-only.
import { existsSync } from "node:fs";
import { lchown, lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import type { ExecRequest, ExecResult, Runner } from "../ports/runner";

/** unsafe_workspace: a root, .mengai or .mengai/tmp is a symlink, or the root changed during a command */
export type RunnerErrorCode = "bad_request" | "sandbox_unavailable" | "spawn_failed" | "unsafe_workspace";

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

/** unprivileged identity every command runs as (plain runner, root server only) */
export interface RunAs {
  uid: number;
  gid: number;
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
  /** set when the command must drop to an unprivileged uid */
  runAs?: RunAs | null;
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

const unsafe = (why: string) => new RunnerError("unsafe_workspace", `${why}; command not run`);

/** The root entry itself must be a real folder: a symlinked root could point anywhere. */
async function assertRootEntry(given: string): Promise<void> {
  const st = await lstat(given).catch(() => null);
  if (st?.isSymbolicLink()) throw unsafe(`writable path ${given} is a symlink`);
}

/**
 * Creates dir (one level) if missing and proves it is a real folder, never a
 * symlink. mkdir without `recursive` does not follow a symlink at dir, and the
 * lstat afterwards catches one planted in between.
 */
async function ensureRealDir(dir: string, label: string): Promise<void> {
  const before = await lstat(dir).catch(() => null);
  if (!before) {
    try {
      await mkdir(dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  const st = await lstat(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw unsafe(`${label} must be a real folder inside the workspace, not a symlink`);
}

/** Validates the request and creates <workspace>/.mengai/tmp (git-ignored) without following symlinks. */
export async function prepareExec(req: ExecRequest, opts: { home?: string; path?: string; runAs?: RunAs | null } = {}): Promise<PreparedExec> {
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
    await assertRootEntry(w);
    writable.push(real);
  }
  const workspace = writable.find((w) => inside(cwd, w));
  if (!workspace) throw new RunnerError("bad_request", "cwd must be inside a writable path");
  const mengai = join(workspace, ".mengai");
  const tmpDir = join(mengai, "tmp");
  await ensureRealDir(mengai, ".mengai");
  await ensureRealDir(tmpDir, ".mengai/tmp");
  // a concurrent command could swap .mengai between the checks: both must still resolve in place
  if ((await realpath(mengai)) !== mengai || (await realpath(tmpDir)) !== tmpDir) throw unsafe(".mengai resolves outside the workspace");
  const ignore = join(mengai, ".gitignore");
  const ignoreSt = await lstat(ignore).catch(() => null);
  if (ignoreSt?.isSymbolicLink()) throw unsafe(".mengai/.gitignore is a symlink");
  // wx is O_CREAT|O_EXCL: it never follows a symlink planted after the lstat
  if (!ignoreSt) await writeFile(ignore, "*\n", { flag: "wx" }).catch(() => undefined);
  const runAs = opts.runAs ?? null;
  if (runAs) {
    // TMPDIR must be usable by the unprivileged uid; lchown never follows a link
    await lchown(mengai, runAs.uid, runAs.gid);
    await lchown(tmpDir, runAs.uid, runAs.gid);
  }
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(req.timeoutMs || 0) || MIN_TIMEOUT_MS));
  const maxOutputBytes = Math.min(MAX_OUTPUT_CAP, Math.max(1024, Math.floor(req.maxOutputBytes || 0) || 1024));
  const env = scrubEnv({ home: workspace, tmpDir, path: opts.path ?? defaultPath(home), extra: req.env });
  return { cwd, writable, workspace, tmpDir, env, timeoutMs, maxOutputBytes, runAs };
}

/**
 * Re-validates every writable root: still a real folder (not a symlink) whose
 * realpath is unchanged. Runs right before spawn and right after exit, so a
 * command that swapped the root for a symlink is caught before the server
 * touches the workspace again.
 */
export async function verifyRoots(prep: Pick<PreparedExec, "writable">, when: "before" | "after"): Promise<void> {
  for (const root of prep.writable) {
    const st = await lstat(root).catch(() => null);
    const real = st && !st.isSymbolicLink() && st.isDirectory() ? await realpath(root).catch(() => null) : null;
    if (real === root) continue;
    if (when === "before") throw unsafe(`workspace root ${root} is no longer a real folder at the same path`);
    throw new RunnerError("unsafe_workspace", `the command removed, moved or replaced the workspace root ${root}; its output was discarded and the workspace needs a check`);
  }
}

// ------------------------------------------------------------ uid drop
const MAX_ID = 2 ** 31 - 1;

function parseId(raw: string | undefined, name: string): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const t = raw.trim();
  const n = /^\d+$/.test(t) ? Number(t) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0 || n > MAX_ID) throw new Error(`${name} must be a positive integer uid or gid other than 0, got "${t.slice(0, 20)}"`);
  return n;
}

/** Reads MENGAI_RUNNER_UID and MENGAI_RUNNER_GID (gid defaults to the uid). Throws on invalid values. */
export function runAsFromEnv(env: Record<string, string | undefined> = process.env): RunAs | null {
  const uid = parseId(env.MENGAI_RUNNER_UID, "MENGAI_RUNNER_UID");
  const gid = parseId(env.MENGAI_RUNNER_GID, "MENGAI_RUNNER_GID");
  if (uid === null) {
    if (gid !== null) throw new Error("MENGAI_RUNNER_GID is set without MENGAI_RUNNER_UID");
    return null;
  }
  return { uid, gid: gid ?? uid };
}

/**
 * Decides the identity for commands. null means run as the server. A drop
 * that cannot happen (configured, but the server is not root) fails closed.
 */
export function resolveRunAs(configured: RunAs | null, currentUid: number | null): RunAs | null {
  if (!configured) return null;
  if (currentUid === configured.uid) return null;
  if (currentUid === 0) return configured;
  throw new RunnerError("sandbox_unavailable", `MENGAI_RUNNER_UID is ${configured.uid} but the server runs as uid ${currentUid ?? "unknown"} and cannot switch users; command not run`);
}

/** Checks `id -u` then `id -G` output of a dropped probe: null when the drop held, otherwise the reason. */
export function checkDropProbe(output: string, runAs: RunAs): string | null {
  const [uidLine = "", groupsLine = ""] = output.trim().split("\n");
  const uid = Number(uidLine.trim());
  if (uid !== runAs.uid) return `the probe ran as uid ${uidLine.trim() || "unknown"}, expected ${runAs.uid}`;
  const groups = groupsLine.trim().split(/\s+/).filter(Boolean).map(Number);
  if (groups.length === 0) return "the probe reported no groups";
  if (groups.includes(0)) return "the probe kept group 0 (root) after the drop";
  if (groups.some((g) => g !== runAs.gid)) return `the probe kept supplementary groups ${groups.filter((g) => g !== runAs.gid).join(",")}`;
  return null;
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
    await verifyRoots(prep, "before");
    const started = performance.now();
    let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
    try {
      // env is the complete child environment: nothing from the server is inherited
      proc = Bun.spawn(argv, {
        cwd: prep.cwd,
        env: prep.env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        detached: true,
        ...(prep.runAs ? { uid: prep.runAs.uid, gid: prep.runAs.gid } : {}),
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
      await verifyRoots(prep, "after");
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
  /**
   * unprivileged identity for commands when the server runs as root. Omitted:
   * read from MENGAI_RUNNER_UID / MENGAI_RUNNER_GID. null: never drop.
   */
  runAs?: RunAs | null;
  /** current uid, for tests; default process.getuid() */
  currentUid?: number | null;
}

/** Linux container runner: same env scrubbing, process group, timeout and caps, no OS profile. */
export function createPlainRunner(opts: PlainRunnerOptions = {}): Runner {
  const pool = new ProcessGroupPool();
  const shell = opts.shell ?? "/bin/sh";
  const configured = opts.runAs === undefined ? runAsFromEnv() : opts.runAs;
  const currentUid = opts.currentUid !== undefined ? opts.currentUid : (process.getuid?.() ?? null);
  let probe: Promise<RunAs | null> | null = null;

  /** one-time proof that the drop really happens (uid switched, no root or extra groups left) */
  const identity = () =>
    (probe ??= (async () => {
      const runAs = resolveRunAs(configured, currentUid);
      if (!runAs) return null;
      let out = "";
      try {
        const p = Bun.spawnSync(["/bin/sh", "-c", "id -u; id -G"], { env: { PATH: "/usr/bin:/bin" }, stdin: "ignore", stdout: "pipe", stderr: "pipe", uid: runAs.uid, gid: runAs.gid });
        out = p.stdout.toString();
      } catch (e) {
        throw new RunnerError("sandbox_unavailable", `could not start a command as uid ${runAs.uid}: ${e instanceof Error ? e.message : String(e)}; command not run`);
      }
      const why = checkDropProbe(out, runAs);
      if (why) throw new RunnerError("sandbox_unavailable", `dropping to uid ${runAs.uid} did not hold (${why}); command not run`);
      return runAs;
    })());

  return {
    async exec(req: ExecRequest): Promise<ExecResult> {
      const runAs = await identity().catch((e: unknown) => {
        probe = null;
        throw e;
      });
      const prep = await prepareExec(req, { home: opts.home, path: opts.path, runAs });
      return pool.run([shell, "-c", req.command], prep, req.signal);
    },
    async killAll() {
      return pool.killAll();
    },
    running: () => pool.running(),
  };
}
