// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Engine guard: the crew's own processes never reach the engine's port.
//
// The local engine has no login, so any process on the Mac that can open a
// TCP connection to 127.0.0.1:<port> could act as the owner (approve a live
// order, raise limits, change keys). The Origin rules in core/hardening.ts
// stop browsers; a native process can forge any header, so the crew's
// processes are stopped at the socket instead, by the macOS sandbox:
//   - agent shell commands: the Seatbelt runner profile gets the rules from
//     engineDenyRules (core/adapters/runner-seatbelt.ts, ExecRequest.denyTcpPorts)
//   - live preview processes and stdio MCP servers: spawned through
//     sandbox-exec with engineGuardProfile, which allows everything by default
//     (network, their files, listening on their own port) and denies only
//     outbound TCP to the engine's port, plus LaunchServices (lsopen): an app
//     bundle started with open(1) runs outside the sandbox and reached the
//     engine port in a reproduction (JEV sec.severity: preview critical 0.94,
//     MCP medium 0.73). Previews also lose Apple events (BROWSER=none already
//     says they have no business driving other apps).
//
// The rule is "*:<port>", not "localhost:<port>": Seatbelt's localhost filter
// misses IPv4-mapped IPv6 ([::ffff:127.0.0.1]:<port>), which reaches a
// 127.0.0.1 listener. The cost is that these processes also cannot reach
// that one port number on other hosts.
//
// Ports come from the live Host allowlist (filled once the engine listens).
// An empty list means the engine refuses every Host, so there is nothing to
// reach and nothing is wrapped. Without sandbox-exec (not macOS, or the
// self test fails) processes start as before and the gap is logged once.
import { existsSync } from "node:fs";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/** SBPL: LaunchServices opens apps and documents outside the sandbox */
export const DENY_LSOPEN = "(deny lsopen)";
/** SBPL: Apple events can make Terminal or a browser act outside the sandbox */
export const DENY_APPLE_EVENTS = "(deny appleevent-send)";

/** Extra rules for live preview processes (dev scripts and installs the crew wrote). */
export const PREVIEW_RULES: readonly string[] = [DENY_LSOPEN, DENY_APPLE_EVENTS];
/** Extra rules for stdio MCP servers. Apple events stay: automation servers (Notes, Calendar) need them and macOS asks the owner first. */
export const MCP_RULES: readonly string[] = [DENY_LSOPEN];

export interface WarnSink {
  log(level: "debug" | "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>): void;
}

const isPort = (p: unknown): p is number => typeof p === "number" && Number.isInteger(p) && p > 0 && p < 65536;

/** The engine's TCP ports from Host allowlist entries like "127.0.0.1:4280" (no port, no entry). */
export function enginePorts(allowedHosts: readonly string[]): number[] {
  const out = new Set<number>();
  for (const host of allowedHosts) {
    const m = /:(\d{1,5})$/.exec(host);
    const port = m ? Number(m[1]) : NaN;
    if (isPort(port)) out.add(port);
  }
  return [...out];
}

/** SBPL rules that deny outbound TCP to each port on every address. Ports are validated integers, so nothing else reaches the profile text. */
export function engineDenyRules(ports: readonly number[]): string[] {
  return [...new Set(ports.filter(isPort))].map((p) => `(deny network-outbound (remote tcp "*:${p}"))`);
}

/** Allow everything, deny outbound TCP to the engine ports, then the given extra rules. */
export function engineGuardProfile(ports: readonly number[], extra: readonly string[] = []): string {
  return ["(version 1)", "(allow default)", ...engineDenyRules(ports), ...extra].join("\n");
}

const probes = new Map<string, string | null>();

/** null when sandbox-exec can apply a profile here, otherwise the reason. Cached per binary and platform. */
export function sandboxUnavailable(platform: NodeJS.Platform = process.platform, sandboxExec: string = SANDBOX_EXEC): string | null {
  const key = `${platform}\0${sandboxExec}`;
  if (probes.has(key)) return probes.get(key)!;
  let reason: string | null;
  if (platform !== "darwin") reason = "sandbox-exec is only available on macOS";
  else if (!existsSync(sandboxExec)) reason = `${sandboxExec} not found`;
  else {
    try {
      const p = Bun.spawnSync([sandboxExec, "-p", "(version 1)(allow default)", "/usr/bin/true"], { stdin: "ignore", stdout: "ignore", stderr: "pipe", env: {} });
      reason = p.exitCode === 0 ? null : `sandbox-exec self test failed (exit ${p.exitCode}): ${p.stderr.toString().trim().slice(0, 200)}`;
    } catch (e) {
      reason = `sandbox-exec could not start: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  probes.set(key, reason);
  return reason;
}

export interface EngineSandboxOptions {
  /** what these processes are, for the log line ("live preview", "MCP server") */
  label: string;
  /** the engine's ports, read at every spawn */
  ports: () => readonly number[];
  /** fixed extra SBPL rules for this kind of process (PREVIEW_RULES, MCP_RULES) */
  extraRules?: readonly string[];
  logger?: WarnSink;
  platform?: NodeJS.Platform;
  sandboxExec?: string;
}

export interface EngineSandbox {
  /** the argv to spawn: sandbox-exec, the profile and argv; argv unchanged when no port is known or the sandbox is unavailable */
  wrap(argv: readonly string[]): string[];
}

export function createEngineSandbox(opts: EngineSandboxOptions): EngineSandbox {
  const platform = opts.platform ?? process.platform;
  const sandboxExec = opts.sandboxExec ?? SANDBOX_EXEC;
  let warned = false;
  return {
    wrap(argv) {
      const ports = opts.ports().filter(isPort);
      if (!ports.length || !argv.length) return [...argv];
      const reason = sandboxUnavailable(platform, sandboxExec);
      if (reason) {
        if (!warned) {
          warned = true;
          opts.logger?.log("warn", `${opts.label} processes run without the engine port guard`, { reason, platform });
        }
        return [...argv];
      }
      // sandbox-exec applies the profile, then execvp()s argv with the same pid and the caller's env (PATH)
      return [sandboxExec, "-p", engineGuardProfile(ports, opts.extraRules), "--", ...argv];
    },
  };
}
