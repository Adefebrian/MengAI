// The real ports behind the preview service: Bun.spawn in its own process
// group, a transient listen to test a port, and the OS file manager. The
// file manager gets an argv array (no shell) and a small env: PATH, HOME,
// LANG plus the desktop session variables xdg-open needs on Linux.
import { createServer } from "node:net";
import type { FolderOpener, PortFree, PreviewSpawner } from "./ports";

/** Bun.spawn with setsid, so kill() reaches every child the dev server starts. */
export const bunSpawner: PreviewSpawner = (argv, opts) => {
  const proc = Bun.spawn(argv, { cwd: opts.cwd, env: opts.env, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true });
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
      try {
        process.kill(-pid, signal);
      } catch {
        // the group is gone (or no process groups on this OS)
      }
      try {
        proc.kill(signal);
      } catch {
        // the leader is gone
      }
    },
  };
};

export const portFree: PortFree = (port) =>
  new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => server.close(() => resolve(true)));
  });

/** open on macOS, explorer on Windows, xdg-open elsewhere; the path is always the last argv entry */
export function revealArgv(platform: NodeJS.Platform, path: string): string[] {
  if (platform === "darwin") return ["/usr/bin/open", path];
  if (platform === "win32") return ["explorer.exe", path];
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
