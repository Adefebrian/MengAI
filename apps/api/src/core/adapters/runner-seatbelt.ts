// macOS runner: every agent command runs under sandbox-exec with a profile
// generated per call. The profile denies by default, allows reading the OS
// and toolchains, allows writes only strictly inside writablePaths (the
// workspace, whose .mengai/tmp is TMPDIR): the root entry itself is never
// writable, so it cannot be removed, renamed or swapped for a symlink. It
// denies the owner's credential directories and the app data dir, protects
// git metadata that runs code outside the sandbox (hooks and config under
// any .git folder at any depth, including submodule and worktree gitdirs)
// and denies creating, removing or renaming any .git entry, so hooks cannot
// be staged under another name and swapped in. Network is allowed only when
// the request says so, and outbound TCP to the engine's own port is denied
// either way (ExecRequest.denyTcpPorts, rules from lib/engine-guard.ts), so a
// command cannot drive the no-auth local API. Paths reach the profile as -D
// parameters, never as interpolated text, so a path can never inject profile
// rules; the git rules are fixed regexes with no path in them, and ports are
// validated integers.
//
// The shared exec core (runner-plain.ts) also refuses a symlinked root and
// re-checks every root's realpath right before spawn and right after exit.
//
// Fail closed: when sandbox-exec is missing or cannot apply a profile (for
// example when the host process is already sandboxed), exec() throws a
// RunnerError("sandbox_unavailable") and nothing runs unjailed.
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { engineDenyRules } from "../../lib/engine-guard";
import type { ExecRequest, ExecResult, Runner } from "../ports/runner";
import { HOME_TOOL_BINS, prepareExec, ProcessGroupPool, RunnerError, type PreparedExec } from "./runner-plain";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/** read-only system locations commands need (binaries, libraries, config, dyld caches, devices) */
const SYSTEM_READ = [
  "/usr",
  "/bin",
  "/sbin",
  "/System",
  "/Library",
  "/opt",
  "/private/etc",
  "/private/var/db",
  "/private/var/select",
  "/Applications/Xcode.app",
  "/Applications/Xcode-beta.app",
  "/dev",
];

/** read-only toolchain homes under the real home dir (compilers, runtimes, version managers) */
const HOME_TOOLCHAINS = [".bun", ".cargo", ".rustup", ".nvm", ".volta", ".pyenv", ".rbenv", ".deno", "go", ".local/bin", ".local/share/fnm", ".asdf", ".sdkman"];

/** credential stores under the real home dir, always denied even inside an allowed toolchain dir */
const HOME_CREDENTIALS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".azure",
  ".kube",
  ".docker",
  ".config",
  ".password-store",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  ".gitconfig",
  ".vault-token",
  ".terraform.d",
  ".cargo/credentials",
  ".cargo/credentials.toml",
  "Library/Keychains",
  "Library/Cookies",
  "Library/Application Support/com.apple.TCC",
];

const SYSTEM_DENY = ["/Library/Keychains", "/private/var/db/sudo"];

/** launchd services a jailed command may reach. No LaunchServices (open), pasteboard,
 * Apple Events or keychain (SecurityServer): those would reach outside the jail. */
const MACH_BASE = [
  "com.apple.system.opendirectoryd.libinfo",
  "com.apple.system.opendirectoryd.membership",
  "com.apple.bsd.dirhelper",
  "com.apple.cfprefsd.daemon",
  "com.apple.cfprefsd.agent",
  "com.apple.system.notification_center",
  "com.apple.system.logger",
  "com.apple.logd",
  "com.apple.PowerManagement.control",
];
/** extra services for DNS, routing and certificate checks when network is allowed */
const MACH_NETWORK = [
  "com.apple.networkd",
  "com.apple.ocspd",
  "com.apple.trustd.agent",
  "com.apple.SystemConfiguration.DNSConfiguration",
  "com.apple.SystemConfiguration.configd",
  "com.apple.dnssd.service",
];

const mach = (names: string[]) => `(allow mach-lookup ${names.map((n) => `(global-name "${n}")`).join(" ")})`;

export interface SeatbeltRunnerOptions {
  /** app data dir (db, vault, blobs): never readable or writable by commands */
  dataDir: string;
  /** real home of the owner; default os.homedir() */
  home?: string;
  /** extra read-only paths (for example a custom toolchain location) */
  extraReadPaths?: string[];
  path?: string;
  sandboxExec?: string;
  shell?: string;
}

export interface SeatbeltProfile {
  profile: string;
  /** -D NAME=VALUE parameters referenced by the profile */
  params: Record<string, string>;
}

const list = (names: string[]) => names.map((n) => `(subpath (param "${n}"))`).join(" ");
const literals = (names: string[]) => names.map((n) => `(literal (param "${n}"))`).join(" ");

/**
 * Git metadata that later runs code outside the sandbox, matched at any depth
 * so renaming or nesting a .git folder never escapes the rule: hooks and
 * config (config.worktree too) in any gitdir, including .git/modules/<name>
 * and .git/worktrees/<name>. .git itself (folder or gitdir file) cannot be
 * created, removed or renamed, which also blocks staging a fake gitdir under
 * another name and moving it into place.
 */
const GIT_DIR = String.raw`/\.git/((modules|worktrees)/[^/]+/)*`;
export const GIT_RULES = [
  String.raw`(deny file-write* (regex #"${GIT_DIR}hooks(/|$)") (regex #"${GIT_DIR}config(\.worktree)?$"))`,
  String.raw`(deny file-write* (regex #"/\.git$"))`,
];

/** Builds the SBPL profile plus its parameters. Later rules win in SBPL, so order matters. */
export function buildSeatbeltProfile(input: {
  writable: string[];
  network: boolean;
  dataDir: string;
  home: string;
  readPaths?: string[];
  /** engine ports: outbound TCP to them is denied on every address, after any network allow */
  denyTcpPorts?: number[];
}): SeatbeltProfile {
  const params: Record<string, string> = {};
  const add = (prefix: string, values: string[]) =>
    values.map((v, i) => {
      const name = `${prefix}_${i}`;
      params[name] = v;
      return name;
    });
  const sysRead = add("SYS_READ", SYSTEM_READ);
  const toolRead = add("TOOL_READ", [...HOME_TOOLCHAINS.map((t) => join(input.home, t)), ...(input.readPaths ?? [])]);
  const creds = add("CRED", [...HOME_CREDENTIALS.map((c) => join(input.home, c)), ...SYSTEM_DENY]);
  const data = add("DATA", [input.dataDir]);
  const ws = add("WS", input.writable);

  const lines = [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    "(allow process-exec)",
    "(allow signal (target same-sandbox))",
    "(allow process-info* (target same-sandbox))",
    "(allow sysctl-read)",
    mach(MACH_BASE),
    "(allow ipc-posix-shm)",
    "(allow ipc-posix-sem)",
    "(allow user-preference-read)",
    "(allow file-read-metadata)",
    '(allow file-read* (literal "/"))',
    `(allow file-read* ${list(sysRead)})`,
    `(allow file-read* ${list(toolRead)})`,
    // the app data dir is closed before the workspace opens, so a workspace
    // that lives under the data dir still works while the db and vault do not
    `(deny file-read* file-write* ${list(data)})`,
    `(allow file-read* file-write* ${list(ws)})`,
    // strictly inside: the root entry itself cannot be unlinked, renamed, replaced or re-moded
    `(deny file-write* ${literals(ws)})`,
    ...GIT_RULES,
    // credentials last: nothing above can reopen them
    `(deny file-read* file-write* ${list(creds)})`,
    '(allow file-read* file-write-data (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper") (literal "/dev/urandom") (literal "/dev/random"))',
    '(allow file-ioctl (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper"))',
    // xcrun (git, clang shims) caches its lookup db in the per-user temp dir
    '(allow file-read* file-write* (regex #"^/private/var/folders/[^/]+/[^/]+/T/xcrun_db"))',
  ];
  if (input.network) lines.push("(allow network*)", "(allow system-socket)", mach(MACH_NETWORK));
  // last: nothing above can reopen the engine port
  lines.push(...engineDenyRules(input.denyTcpPorts ?? []));
  return { profile: lines.join("\n"), params };
}

/** Exit codes sandbox-exec itself uses when it cannot apply a profile (EX_DATAERR, EX_OSERR). */
const SANDBOX_FAIL_CODES = new Set([65, 71]);

export function createSeatbeltRunner(opts: SeatbeltRunnerOptions): Runner {
  const pool = new ProcessGroupPool();
  const home = opts.home ?? homedir();
  const sandboxExec = opts.sandboxExec ?? SANDBOX_EXEC;
  const shell = opts.shell ?? "/bin/sh";
  let probe: Promise<string | null> | null = null;

  const realOrSelf = (p: string) => realpath(p).catch(() => p);

  /** one-time self test: null when the sandbox works, otherwise the reason */
  const checkSandbox = () =>
    (probe ??= (async () => {
      if (process.platform !== "darwin") return "sandbox-exec is only available on macOS";
      if (!existsSync(sandboxExec)) return `${sandboxExec} not found`;
      try {
        const p = Bun.spawnSync([sandboxExec, "-p", "(version 1)(deny default)(allow process-exec)(allow file-read*)", "/usr/bin/true"], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "pipe",
          env: {},
        });
        if (p.exitCode === 0) return null;
        return `sandbox-exec self test failed (exit ${p.exitCode}): ${p.stderr.toString().trim().slice(0, 200)}`;
      } catch (e) {
        return `sandbox-exec could not start: ${e instanceof Error ? e.message : String(e)}`;
      }
    })());

  async function argvFor(req: ExecRequest, prep: PreparedExec): Promise<string[]> {
    const realHome = await realOrSelf(home);
    const dataDir = await realOrSelf(opts.dataDir);
    const readPaths = await Promise.all((opts.extraReadPaths ?? []).map(realOrSelf));
    const { profile, params } = buildSeatbeltProfile({ writable: prep.writable, network: req.network === true, dataDir, home: realHome, readPaths, denyTcpPorts: req.denyTcpPorts });
    const argv = [sandboxExec, "-p", profile];
    for (const [k, v] of Object.entries(params)) argv.push("-D", `${k}=${v}`);
    argv.push("--", shell, "-c", req.command);
    return argv;
  }

  return {
    async exec(req: ExecRequest): Promise<ExecResult> {
      const reason = await checkSandbox();
      if (reason) throw new RunnerError("sandbox_unavailable", `macOS sandbox unavailable, command not run: ${reason}`);
      const prep = await prepareExec(req, { home, path: opts.path });
      const argv = await argvFor(req, prep);
      const res = await pool.run(argv, prep, req.signal);
      if (res.exitCode !== null && SANDBOX_FAIL_CODES.has(res.exitCode) && /^sandbox-exec: /m.test(res.stderr)) {
        throw new RunnerError("sandbox_unavailable", `macOS sandbox could not apply the profile, command not run: ${res.stderr.trim().slice(0, 200)}`);
      }
      return res;
    },
    async killAll() {
      return pool.killAll();
    },
    running: () => pool.running(),
  };
}

/** exported for tests: HOME_TOOL_BINS are the PATH side of HOME_TOOLCHAINS */
export const SEATBELT_LISTS = { SYSTEM_READ, HOME_TOOLCHAINS, HOME_CREDENTIALS, HOME_TOOL_BINS, MACH_BASE, MACH_NETWORK };
