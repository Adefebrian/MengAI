// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// MCP stdio servers (local mode only). The command line is split without a
// shell (no pipes, globs or expansion), the child gets an environment built
// from scratch (PATH, HOME, LANG, TMPDIR, TERM) plus the owner's connector
// secret, runs in its own process group under the data dir, and is killed
// as a group on close and by the kill switch.
//
// Not a full jail: an MCP server the owner adds runs with the owner's user
// rights, like any program they start. On macOS it runs under sandbox-exec
// with the engine port guard (lib/engine-guard.ts): it can never connect to
// the engine's own port (the no-auth local API) and cannot start apps
// through LaunchServices; network, files and Apple events work as before.
//
// Windows has no process groups: kill() ends the tree with taskkill /T /F
// and no Unix system folder lands on PATH. Stdio servers stay off there
// until a Windows sandbox exists (lib/platform.ts); these branches keep the
// kill paths correct for when they turn on.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { win32 } from "node:path";
import { killTreeWindows } from "../../lib/platform";
import type { SpawnedProcess, Spawner } from "./ports";

const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
/** names a secret line may never set: loader and interpreter hooks, and the base env */
const BLOCKED_ENV = /^(PATH|HOME|TMPDIR|PWD|SHELL|USER|LOGNAME|IFS|ENV|BASH_ENV|PROMPT_COMMAND|SHELLOPTS|PS4|NODE_OPTIONS|BUN_OPTIONS|PYTHONSTARTUP|PYTHONPATH|PERL5OPT|RUBYOPT|LD_.*|DYLD_.*)$/;

const SYSTEM_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
const HOME_BINS = [".bun/bin", ".local/bin", ".cargo/bin", ".volta/bin", ".deno/bin"];

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

/** Splits a command line like a shell would for plain words and quotes, without running a shell. */
export function parseCommand(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < line.length && /["\\$`]/.test(line[i + 1]!)) cur += line[++i];
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === "\\" && i + 1 < line.length) {
      cur += line[++i];
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
      continue;
    }
    if (/[|&;<>`$(){}]/.test(ch)) throw new CommandError(`the command may not contain shell syntax (${ch}); give the program and its arguments`);
    cur += ch;
    has = true;
  }
  if (quote) throw new CommandError("the command has an unclosed quote");
  if (has || cur) out.push(cur);
  if (out.length === 0 || !out[0]) throw new CommandError("the command is empty");
  if (out.some((a) => a.includes("\0"))) throw new CommandError("the command contains a NUL byte");
  return out;
}

/**
 * The owner's connector secret as env vars: a JSON object ({"API_KEY": "..."}),
 * KEY=value lines, or one bare value exposed as API_KEY.
 */
export function secretEnv(secret: string | null | undefined): Record<string, string> {
  const s = (secret ?? "").trim();
  if (!s) return {};
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    const name = k.trim();
    if (!ENV_NAME.test(name)) throw new CommandError(`${name.slice(0, 40)} is not a valid env var name (A-Z, 0-9 and _)`);
    if (BLOCKED_ENV.test(name)) throw new CommandError(`${name} cannot be set through a connector secret`);
    out[name] = String(v ?? "");
  };
  if (s.startsWith("{")) {
    let obj: unknown;
    try {
      obj = JSON.parse(s);
    } catch {
      throw new CommandError("the secret looks like JSON but does not parse");
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new CommandError("the secret JSON must be an object of env vars");
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) put(k, v);
    return out;
  }
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (lines.every((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l))) {
    for (const l of lines) {
      const at = l.indexOf("=");
      put(l.slice(0, at), l.slice(at + 1).replace(/^(["'])(.*)\1$/, "$2"));
    }
    return out;
  }
  if (lines.length === 1) return { API_KEY: s };
  throw new CommandError("give the secret as KEY=value lines, a JSON object, or one value (API_KEY)");
}

/** Values in a secret that the redactor must learn (each env value). */
export function secretValues(secret: string | null | undefined): string[] {
  try {
    return Object.values(secretEnv(secret)).filter((v) => v.length >= 8);
  } catch {
    return secret ? [secret] : [];
  }
}

/** Windows PATH and base env: the system folders under SystemRoot and the home toolchains, ";" separated. */
function windowsEnv(home: string, systemRoot: string | undefined, exists: (p: string) => boolean): Record<string, string> {
  const root = systemRoot && win32.isAbsolute(systemRoot) ? systemRoot : "C:\\Windows";
  const system = [win32.join(root, "System32"), root, win32.join(root, "System32", "Wbem")];
  const path = [...system, ...HOME_BINS.map((b) => win32.join(home, b)).filter((p) => exists(p))];
  return { PATH: [...new Set(path)].join(";"), SystemRoot: root, USERPROFILE: home };
}

/** The child environment: built from scratch, nothing inherited but PATH-like basics. */
export function scrubbedEnv(opts: {
  tmpdir: string;
  extra: Record<string, string>;
  home?: string;
  exists?: (p: string) => boolean;
  platform?: NodeJS.Platform;
  /** Windows: the SystemRoot folder (default process.env.SystemRoot) */
  systemRoot?: string;
}): Record<string, string> {
  const home = opts.home ?? homedir();
  const exists = opts.exists ?? existsSync;
  if ((opts.platform ?? process.platform) === "win32") {
    return { ...opts.extra, ...windowsEnv(home, opts.systemRoot ?? process.env.SystemRoot ?? process.env.SYSTEMROOT, exists), HOME: home, TMPDIR: opts.tmpdir, TEMP: opts.tmpdir, TMP: opts.tmpdir, LANG: "en_US.UTF-8", TERM: "dumb" };
  }
  const path = [...SYSTEM_PATH, ...HOME_BINS.map((b) => `${home}/${b}`).filter((p) => exists(p))];
  return {
    ...opts.extra,
    PATH: [...new Set(path)].join(":"),
    HOME: home,
    TMPDIR: opts.tmpdir,
    LANG: "en_US.UTF-8",
    TERM: "dumb",
  };
}

export interface GroupOptions {
  /** default process.platform */
  platform?: NodeJS.Platform;
  /** Windows: ends a process and its children (default taskkill /PID <pid> /T /F) */
  killTree?: (pid: number) => void;
}

/**
 * Bun.spawn in its own process group; kill() signals the whole group. wrap
 * turns the argv into the sandboxed one (sandbox-exec execs the server, so
 * the pid and the group stay the same; it resolves the program on env.PATH).
 * On Windows kill() ends the process tree instead.
 */
export function createStdioSpawner(wrap: (argv: string[]) => string[] = (argv) => argv, group: GroupOptions = {}): Spawner {
  const platform = group.platform ?? process.platform;
  const killTree = group.killTree ?? killTreeWindows;
  return (argv, opts) => spawnGroup(argv, wrap(argv), opts, platform, killTree);
}

/** Unguarded: only for callers that apply their own sandbox. */
export const bunSpawner: Spawner = createStdioSpawner();

function spawnGroup(
  original: string[],
  argv: string[],
  opts: { env: Record<string, string>; cwd: string },
  platform: NodeJS.Platform,
  killTree: (pid: number) => void,
): SpawnedProcess {
  const windows = platform === "win32";
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    // setsid on macOS and Linux; Windows has no process groups (taskkill /T walks the tree)
    proc = Bun.spawn(argv, { cwd: opts.cwd, env: opts.env, stdin: "pipe", stdout: "pipe", stderr: "pipe", detached: !windows });
  } catch (e) {
    throw new CommandError(`could not start ${original[0]}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const pid = proc.pid;
  const handle: SpawnedProcess = {
    pid,
    write(data: string) {
      proc.stdin.write(data);
      void proc.stdin.flush();
    },
    stdout: proc.stdout,
    stderr: proc.stderr,
    exited: proc.exited.then(
      (code) => (proc.signalCode ? null : code),
      () => null,
    ),
    kill() {
      if (windows) killTree(pid);
      else {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // the group is gone
        }
      }
      try {
        proc.kill("SIGKILL");
      } catch {
        // the leader is gone
      }
    },
  };
  return handle;
}
