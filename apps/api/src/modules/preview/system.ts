// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The real ports behind the preview service: Bun.spawn in its own process
// group (under the engine port guard, lib/engine-guard.ts), a transient
// listen to test a port, and the OS file manager. The file manager gets an
// argv array (no shell) and a small env: PATH, HOME, LANG plus the desktop
// session variables xdg-open needs on Linux. Windows has no process groups:
// kill() ends the tree with taskkill /T /F (script previews stay off there
// until a Windows sandbox exists, lib/platform.ts).
import { createServer } from "node:net";
import { win32 } from "node:path";
import { killTreeWindows } from "../../lib/platform";
import type { FolderOpener, PortFree, PreviewSpawner } from "./ports";

export interface GroupOptions {
  /** default process.platform */
  platform?: NodeJS.Platform;
  /** Windows: ends a process and its children (default taskkill /PID <pid> /T /F) */
  killTree?: (pid: number) => void;
}

/**
 * Bun.spawn with setsid, so kill() reaches every child the dev server starts.
 * wrap turns the argv into the sandboxed one (sandbox-exec execs the target,
 * so the pid and the process group stay the same). On Windows kill() ends
 * the process tree instead.
 */
export function createBunSpawner(wrap: (argv: string[]) => string[] = (argv) => argv, group: GroupOptions = {}): PreviewSpawner {
  const platform = group.platform ?? process.platform;
  const killTree = group.killTree ?? killTreeWindows;
  return (argv, opts) => spawnGroup(wrap(argv), opts, platform, killTree);
}

/** Unguarded: only for callers that apply their own sandbox. */
export const bunSpawner: PreviewSpawner = createBunSpawner();

function spawnGroup(argv: string[], opts: { cwd: string; env: Record<string, string> }, platform: NodeJS.Platform, killTree: (pid: number) => void): ReturnType<PreviewSpawner> {
  const windows = platform === "win32";
  // setsid on macOS and Linux; Windows has no process groups (taskkill /T walks the tree)
  const proc = Bun.spawn(argv, { cwd: opts.cwd, env: opts.env, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: !windows });
  const pid = proc.pid;
  return {
    pid,
    stdout: proc.stdout,
    stderr: proc.stderr,
    exited: proc.exited.then(
      (code) => (proc.signalCode ? null : code),
      () => null,
    ),
    kill(signal) {
      if (windows) killTree(pid);
      else {
        try {
          process.kill(-pid, signal);
        } catch {
          // the group is gone
        }
      }
      try {
        proc.kill(signal);
      } catch {
        // the leader is gone
      }
    },
  };
}

export const portFree: PortFree = (port) =>
  new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => server.close(() => resolve(true)));
  });

/**
 * open on macOS, explorer on Windows, xdg-open elsewhere; the path is always
 * the last argv entry. Windows takes explorer.exe from SystemRoot when it is
 * known, so no explorer.exe on PATH or in the working folder is picked.
 */
export function revealArgv(platform: NodeJS.Platform, path: string, systemRoot: string | undefined = process.env.SystemRoot ?? process.env.SYSTEMROOT): string[] {
  if (platform === "darwin") return ["/usr/bin/open", path];
  if (platform === "win32") return [systemRoot && win32.isAbsolute(systemRoot) ? win32.join(systemRoot, "explorer.exe") : "explorer.exe", path];
  return ["xdg-open", path];
}

const OPENER_ENV = ["PATH", "HOME", "LANG", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XDG_CURRENT_DESKTOP", "XDG_SESSION_TYPE", "DBUS_SESSION_BUS_ADDRESS", "SYSTEMROOT", "WINDIR"];

export function openerEnv(source: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of OPENER_ENV) {
    const value = source[key];
    if (value && !value.includes("\0")) env[key] = value;
  }
  return env;
}

export function createOpener(source: Record<string, string | undefined> = process.env, timeoutMs = 10_000): FolderOpener {
  return async (argv) => {
    const proc = Bun.spawn(argv, { env: openerEnv(source), stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve(null);
      }, timeoutMs);
    });
    try {
      return await Promise.race([proc.exited, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}
