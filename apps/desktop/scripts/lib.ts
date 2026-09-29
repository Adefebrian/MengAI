// Shared helpers for the desktop build and dev scripts. Bun only.
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

export const desktopDir = resolve(import.meta.dir, "..");
export const repoRoot = resolve(desktopDir, "..", "..");
export const tauriDir = join(desktopDir, "src-tauri");
export const webDir = join(repoRoot, "apps", "web");
export const apiDir = join(repoRoot, "apps", "api");
export const handsDir = join(repoRoot, "services", "hands");
/** SQLite migrations the app bundles (tauri.conf.json bundle.resources maps this folder). */
export const sqliteMigrationsDir = join(repoRoot, "migrations", "sqlite");

/** bundle.resources entry for the migrations: source relative to src-tauri, target inside Contents/Resources. */
export const MIGRATIONS_RESOURCE = { from: "../../../migrations/sqlite/", to: "migrations/sqlite/" } as const;

/** Name the shell resolves through tauri-plugin-shell (externalBin without the triple). */
export const SIDECAR_NAME = "mengai-api";
/** File name the hands helper must have inside resources/hands. */
export const HANDS_BIN_NAME = "mengai-hands";
/** Marker the Rust build script writes into its placeholder sidecar. */
export const SIDECAR_PLACEHOLDER_MARKER = "MENGAI_SIDECAR_PLACEHOLDER";

/** Bun compile targets mapped to the Rust target triple Tauri expects as the externalBin suffix. */
export const BUN_TO_RUST_TRIPLE: Record<string, string> = {
  "bun-darwin-arm64": "aarch64-apple-darwin",
  "bun-darwin-x64": "x86_64-apple-darwin",
};

export const tauriCli = join(repoRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");

export interface SidecarScript {
  bunTarget: string;
  triple: string;
  outfile: string;
}

/** Parses apps/api build:sidecar so the scripts and the test agree on one source of truth. */
export function parseSidecarScript(script: string): SidecarScript {
  const target = /--target=(\S+)/.exec(script)?.[1];
  const outfile = /--outfile\s+(\S+)/.exec(script)?.[1];
  if (!target || !outfile) throw new Error(`build:sidecar script is missing --target or --outfile: ${script}`);
  const triple = BUN_TO_RUST_TRIPLE[target];
  if (!triple) throw new Error(`unsupported bun compile target ${target}`);
  return { bunTarget: target, triple, outfile: resolve(apiDir, outfile) };
}

export async function readSidecarScript(): Promise<SidecarScript> {
  const pkg = (await Bun.file(join(apiDir, "package.json")).json()) as { scripts?: Record<string, string> };
  const script = pkg.scripts?.["build:sidecar"];
  if (!script) throw new Error("apps/api/package.json has no build:sidecar script");
  return parseSidecarScript(script);
}

export function sidecarPath(triple: string): string {
  return join(tauriDir, "binaries", `${SIDECAR_NAME}-${triple}`);
}

/** Mach-O 64-bit magic (little endian) or a fat binary; anything else is not a real sidecar. */
export function isMachO(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const le = (bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>> 0;
  const be = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return le === 0xfeedfacf || be === 0xcafebabe;
}

export async function assertRealSidecar(path: string): Promise<void> {
  if (!existsSync(path)) throw new Error(`sidecar missing at ${path}`);
  const head = new Uint8Array(await Bun.file(path).slice(0, 4096).arrayBuffer());
  if (new TextDecoder().decode(head).includes(SIDECAR_PLACEHOLDER_MARKER)) {
    throw new Error(`sidecar at ${path} is the build placeholder, the api build did not replace it`);
  }
  if (!isMachO(head)) throw new Error(`sidecar at ${path} is not a Mach-O executable`);
}

/** The sidecar embeds these migrations; the bundle also carries the folder, passed as the MENGAI_MIGRATIONS_DIR override. */
export function assertMigrations(dir: string = sqliteMigrationsDir): string[] {
  if (!existsSync(dir)) throw new Error(`sqlite migrations missing at ${dir}; the app cannot create its database without them`);
  const files = [...new Bun.Glob("*.sql").scanSync({ cwd: dir, onlyFiles: true })].sort();
  if (files.length === 0) throw new Error(`no .sql files in ${dir}; the app cannot create its database without them`);
  return files;
}

export async function run(cmd: string[], cwd: string, env: Record<string, string> = {}): Promise<void> {
  console.log(`$ ${cmd.join(" ")}  (in ${cwd})`);
  const proc = Bun.spawn({
    cmd,
    cwd,
    env: { ...process.env, ...env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`command failed with exit code ${code}: ${cmd.join(" ")}`);
}

/** Runs the Tauri CLI under Bun (no node). */
export function tauri(args: string[], env: Record<string, string> = {}): Promise<void> {
  return run([process.execPath, "--bun", tauriCli, ...args], desktopDir, env);
}

/** Replaces `dest` with a copy of `src`, keeping the committed placeholder files in `keep`. */
export async function syncDir(src: string, dest: string, opts: { keep?: string[]; skip?: (rel: string) => boolean } = {}): Promise<number> {
  const keep = new Set(opts.keep ?? []);
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(dest)) {
    if (!keep.has(entry)) await rm(join(dest, entry), { recursive: true, force: true });
  }
  let copied = 0;
  for await (const rel of new Bun.Glob("**/*").scan({ cwd: src, onlyFiles: true, dot: false })) {
    if (opts.skip?.(rel)) continue;
    const to = join(dest, rel);
    await mkdir(join(to, ".."), { recursive: true });
    await copyFile(join(src, rel), to);
    copied++;
  }
  return copied;
}

/** Copies services/hands output into resources/hands when it exists. Optional in this wave. */
export async function stageHands(triple: string, sign: boolean): Promise<string | null> {
  const candidates = [
    join(handsDir, "target", triple, "release", HANDS_BIN_NAME),
    join(handsDir, "target", "release", HANDS_BIN_NAME),
  ];
  const found = candidates.find((p) => existsSync(p));
  const dest = join(tauriDir, "resources", "hands", HANDS_BIN_NAME);
  if (!found) {
    console.warn(`hands helper not built (looked in ${candidates.join(", ")}); the app ships without automation`);
    return null;
  }
  await copyFile(found, dest);
  await chmod(dest, 0o755);
  const identity = process.env.APPLE_SIGNING_IDENTITY;
  if (sign && identity) {
    // Resources are not signed by the Tauri bundler; notarization rejects an unsigned Mach-O.
    await run(["codesign", "--force", "--options", "runtime", "--timestamp", "--sign", identity, dest], tauriDir);
  }
  return dest;
}
