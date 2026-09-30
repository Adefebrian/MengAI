// What a project workspace can preview, in order: a package.json script
// (dev, then start, then preview) run with the project's own package
// manager, else a static index.html in the root, dist, build, public or out.
// Only reads files; never runs anything.
import { readFile, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";

export const PREVIEW_SCRIPTS = ["dev", "start", "preview"] as const;
export const STATIC_DIRS = [".", "dist", "build", "public", "out"] as const;
export type PackageTool = "bun" | "npm" | "pnpm" | "yarn";

/** lockfile to tool; bun wins when several are present */
const LOCKFILES: ReadonlyArray<readonly [string, PackageTool]> = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
];

const MAX_PACKAGE_JSON = 1024 * 1024;

export type Detection =
  | {
      kind: "script";
      script: (typeof PREVIEW_SCRIPTS)[number];
      tool: PackageTool;
      /** argv with the bare tool name first; the service resolves it on PATH */
      argv: string[];
      command: string;
      install: { argv: string[]; command: string } | null;
    }
  | { kind: "static"; dir: string; command: string }
  | { kind: "none"; reason: string };

export const NOTHING_TO_PREVIEW = "Nothing to preview yet: no dev, start or preview script in package.json and no index.html in the project root, dist, build, public or out.";

function inside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

type Pkg = { scripts?: unknown; packageManager?: unknown; dependencies?: unknown; devDependencies?: unknown };

async function readPackage(root: string): Promise<{ pkg: Pkg | null; present: boolean }> {
  const path = join(root, "package.json");
  if (!(await isFile(path))) return { pkg: null, present: false };
  try {
    if ((await stat(path)).size > MAX_PACKAGE_JSON) return { pkg: null, present: true };
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return { pkg: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Pkg) : null, present: true };
  } catch {
    return { pkg: null, present: true };
  }
}

async function packageTool(root: string, pkg: Pkg): Promise<PackageTool> {
  for (const [file, tool] of LOCKFILES) if (await exists(join(root, file))) return tool;
  const pm = typeof pkg.packageManager === "string" ? /^(bun|npm|pnpm|yarn)@/.exec(pkg.packageManager)?.[1] : undefined;
  return (pm as PackageTool | undefined) ?? "bun";
}

const hasDeps = (pkg: Pkg) =>
  [pkg.dependencies, pkg.devDependencies].some((d) => d !== null && typeof d === "object" && Object.keys(d as object).length > 0);

/** root must be the realpath of the workspace; every candidate stays inside it */
export async function detectPreview(root: string): Promise<Detection> {
  const { pkg, present } = await readPackage(root);
  if (pkg) {
    const scripts = pkg.scripts && typeof pkg.scripts === "object" ? (pkg.scripts as Record<string, unknown>) : {};
    const script = PREVIEW_SCRIPTS.find((name) => typeof scripts[name] === "string" && (scripts[name] as string).trim() !== "");
    if (script) {
      const tool = await packageTool(root, pkg);
      const needsInstall = hasDeps(pkg) && !(await exists(join(root, "node_modules")));
      return {
        kind: "script",
        script,
        tool,
        argv: [tool, "run", script],
        command: `${tool} run ${script}`,
        install: needsInstall ? { argv: [tool, "install"], command: `${tool} install` } : null,
      };
    }
  }
  for (const rel of STATIC_DIRS) {
    const dir = rel === "." ? root : join(root, rel);
    if (!(await isFile(join(dir, "index.html")))) continue;
    // a dist that is a symlink out of the workspace is never served
    const real = await realpath(dir).catch(() => null);
    if (!real || !inside(real, root)) continue;
    return { kind: "static", dir: real, command: rel === "." ? "static index.html" : `static ${rel}/index.html` };
  }
  if (present && !pkg) return { kind: "none", reason: `package.json could not be read. ${NOTHING_TO_PREVIEW}` };
  return { kind: "none", reason: NOTHING_TO_PREVIEW };
}
