// Workspace access for scans. Every listing and read goes through the
// injected WorkspaceService, which jails paths to the project root (realpath
// checked, no symlink escape). This module never touches the filesystem.
import type { WorkspaceService } from "../../core/services";
import { HttpError } from "../../lib/http";
import { baseName } from "./util";

export const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target", "vendor", ".venv", "venv", "__pycache__",
  ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", "coverage", ".gradle", "Pods", "DerivedData", ".terraform", ".idea", ".jal",
]);

/** Root-level dotfiles probed directly in case the workspace listing hides dotfiles. */
const ROOT_PROBES = [".gitignore", ".env", ".env.local", ".env.development", ".env.production", ".env.staging", ".env.test"];

export interface ScanFile {
  path: string;
  size: number;
}

export interface WalkResult {
  files: ScanFile[];
  truncated: boolean;
}

const PAGE_LINES = 2000;
const MAX_PAGES = 4000;
/** symlinked folders inside the root can form cycles; stop descending past this */
const MAX_DEPTH = 24;

function clean(path: string): string {
  return path.replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
}

export async function walkWorkspace(
  ws: WorkspaceService,
  root: string,
  opts: { signal?: AbortSignal; maxFiles?: number; maxDirs?: number } = {},
): Promise<WalkResult> {
  const maxFiles = opts.maxFiles ?? 20_000;
  const maxDirs = opts.maxDirs ?? 5_000;
  const files = new Map<string, ScanFile>();
  const queue: string[] = [""];
  const visited = new Set<string>();
  let truncated = false;
  while (queue.length) {
    throwIfAborted(opts.signal);
    const dir = queue.shift()!;
    if (visited.has(dir)) continue;
    visited.add(dir);
    if (visited.size > maxDirs) {
      truncated = true;
      break;
    }
    let nodes;
    try {
      nodes = await ws.list(root, dir || undefined, 1);
    } catch {
      continue;
    }
    for (const node of nodes) {
      const path = clean(node.path || (dir ? `${dir}/${node.name}` : node.name));
      if (!path) continue;
      if (node.dir) {
        if (!IGNORED_DIRS.has(node.name || baseName(path)) && path.split("/").length <= MAX_DEPTH) queue.push(path);
        continue;
      }
      if (files.size >= maxFiles) {
        truncated = true;
        break;
      }
      files.set(path, { path, size: node.size });
    }
  }
  for (const probe of ROOT_PROBES) {
    if (files.has(probe)) continue;
    try {
      const r = await ws.read(root, probe, { from: 1, to: 1 });
      files.set(probe, { path: probe, size: r.size });
    } catch {
      // absent
    }
  }
  return { files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), truncated };
}

export interface TextRead {
  text: string;
  /** true when the workspace could only serve part of the file */
  partial: boolean;
  /** set (with empty text) when the file is over maxBytes and oversize is "partial" */
  tooLarge?: true;
}

function lineCount(text: string): number {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** The workspace serves only the head of a very large file and answers 413 past it. */
function isTooLarge(err: unknown): boolean {
  return err instanceof HttpError && err.status === 413;
}

/**
 * Full text of one workspace file. Truncated reads are completed page by
 * page with 1-based line ranges, advancing by the lines each page actually
 * returned (the workspace caps every read by bytes). Returns null for binary
 * files. A file over maxBytes returns null, or an empty partial read marked
 * tooLarge when `oversize` is "partial" (the caller must report the gap). A
 * head-only file (the workspace answers 413 past its head) returns what could
 * be read, marked partial.
 */
export async function readWorkspaceText(
  ws: WorkspaceService,
  root: string,
  path: string,
  maxBytes: number,
  signal?: AbortSignal,
  opts: { oversize?: "skip" | "partial" } = {},
): Promise<TextRead | null> {
  const first = await ws.read(root, path);
  if (first.binary) return null;
  if (first.size > maxBytes) return opts.oversize === "partial" ? { text: "", partial: true, tooLarge: true } : null;
  if (!first.truncated) return { text: first.content, partial: false };
  const parts: string[] = [];
  let bytes = 0;
  let from = 1;
  let cut = false;
  for (let pages = 0; from <= first.totalLines && pages < MAX_PAGES; pages++) {
    throwIfAborted(signal);
    let page;
    try {
      page = await ws.read(root, path, { from, to: Math.min(first.totalLines, from + PAGE_LINES - 1) });
    } catch (err) {
      if (!isTooLarge(err)) throw err;
      cut = true;
      break;
    }
    if (page.binary) return null;
    const content = page.content.endsWith("\n") ? page.content.slice(0, -1) : page.content;
    const got = lineCount(content);
    if (got === 0) break;
    parts.push(content);
    bytes += Buffer.byteLength(content, "utf8") + 1;
    from += got;
  }
  // a head-only read (very large file) reports totalLines for the head alone
  const partial = cut || from <= first.totalLines || bytes < first.size * 0.9;
  return { text: parts.join("\n"), partial };
}

export interface GitMeta {
  /** a .git folder (HEAD readable) or a .git worktree file sits at the root */
  isRepo: boolean;
  /** .git/info/exclude text, when present */
  exclude: string | null;
}

/** Probes the root for git metadata through the jail (reads only, .git is never listed). */
export async function readGitMeta(ws: WorkspaceService, root: string): Promise<GitMeta> {
  let isRepo = false;
  try {
    const head = await ws.read(root, ".git/HEAD", { from: 1, to: 1 });
    isRepo = !head.binary;
  } catch {
    try {
      // worktrees and submodules: .git is a file holding "gitdir: <path>"
      const file = await ws.read(root, ".git", { from: 1, to: 1 });
      isRepo = !file.binary && file.content.trimStart().startsWith("gitdir:");
    } catch {
      isRepo = false;
    }
  }
  if (!isRepo) return { isRepo, exclude: null };
  try {
    const ex = await readWorkspaceText(ws, root, ".git/info/exclude", 256_000);
    return { isRepo, exclude: ex?.text ?? null };
  } catch {
    return { isRepo, exclude: null };
  }
}
