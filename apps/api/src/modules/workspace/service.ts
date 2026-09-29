// WorkspaceService: jailed file operations on a project root. Every call
// resolves through jail.ts first. Mutations publish file.changed events
// attributed to the current tool call (see origin.ts).
import type { FileNodeDTO } from "@mengai/shared";
import { lstat, mkdir, readdir, realpath, rm, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ModuleContext } from "../../core/module";
import type { ReadResult, WorkspaceService } from "../../core/services";
import { badRequest, HttpError, notFound } from "../../lib/http";
import { redact } from "../../lib/redact";
import { currentFileOrigin } from "./origin";
import { escapeError, IGNORED_DIRS, isInside, lexicalInside, realRoot, resolveJailed, toRel, touchesGit } from "./jail";

export const READ_CAP_BYTES = 64 * 1024;
export const WRITE_CAP_BYTES = 5 * 1024 * 1024;
/** files above this are hashed by streaming and only their head is readable */
const READ_ALL_MAX = 8 * 1024 * 1024;
const BINARY_SNIFF = 8000;
const MAX_LIST_NODES = 2000;
const MAX_LIST_DEPTH = 6;
const SEARCH_MAX_FILE = 1024 * 1024;
const SEARCH_MAX_LINE = 2000;
const SEARCH_MAX_FILES = 5000;
const SEARCH_MAX_LIMIT = 200;
const DIGEST_MAX_CHARS = 1200;
const NOISE_FILES = new Set([".DS_Store"]);

const gitError = () => new HttpError(403, "git_metadata_protected", "files inside .git cannot be changed by workspace tools");

export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, BINARY_SNIFF);
  let control = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i]!;
    if (b === 0) return true;
    if (b < 7 || (b > 14 && b < 32 && b !== 27)) control++;
  }
  return n > 0 && control / n > 0.1;
}

function sha256(data: Uint8Array | string): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

/** streams a large file once: sha256 plus its line count */
async function hashStream(path: string): Promise<{ hash: string; lines: number }> {
  const h = new Bun.CryptoHasher("sha256");
  const reader = Bun.file(path).stream().getReader();
  let newlines = 0;
  let last = 10;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.length === 0) continue;
    h.update(value);
    for (let i = 0; i < value.length; i++) if (value[i] === 10) newlines++;
    last = value[value.length - 1]!;
  }
  return { hash: h.digest("hex"), lines: newlines + (last === 10 ? 0 : 1) };
}

function countLines(text: string): number {
  if (text === "") return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return text.endsWith("\n") ? n - 1 : n;
}

function occurrences(text: string, find: string): number {
  let n = 0;
  let at = text.indexOf(find);
  while (at !== -1) {
    n++;
    at = text.indexOf(find, at + find.length);
  }
  return n;
}

const byteLen = (s: string) => Buffer.byteLength(s, "utf8");

/** Takes whole lines until the byte cap; a single oversized line is cut at the cap. */
function capLines(lines: string[], cap: number): { text: string; truncated: boolean } {
  let used = 0;
  const out: string[] = [];
  for (const line of lines) {
    const len = byteLen(line) + (out.length > 0 ? 1 : 0);
    if (used + len > cap) {
      if (out.length === 0) {
        const buf = Buffer.from(line, "utf8").subarray(0, cap);
        return { text: new TextDecoder("utf-8", { fatal: false }).decode(buf), truncated: true };
      }
      return { text: out.join("\n"), truncated: true };
    }
    out.push(line);
    used += len;
  }
  return { text: out.join("\n"), truncated: false };
}

function compileMatcher(pattern: string): (line: string) => boolean {
  try {
    const re = new RegExp(pattern);
    return (line) => re.test(line);
  } catch {
    return (line) => line.includes(pattern);
  }
}

export function createWorkspaceService(ctx: Pick<ModuleContext, "events" | "logger">): WorkspaceService {
  const log = ctx.logger.child({ module: "workspace" });

  async function publish(path: string, op: "create" | "update" | "delete", bytes: number): Promise<void> {
    const origin = currentFileOrigin();
    try {
      await ctx.events.publish({
        type: "file.changed",
        runId: origin?.runId ?? null,
        agentId: origin?.agentId ?? null,
        taskId: origin?.taskId ?? null,
        data: { path: redact(path), op, bytes },
      });
    } catch (e) {
      log.log("warn", "file.changed publish failed", { error: redact(String(e)) });
    }
  }

  async function nodeFor(abs: string, root: string, name: string, isLink: boolean): Promise<FileNodeDTO | null> {
    let st;
    try {
      if (isLink) {
        const target = await realpath(abs);
        if (!isInside(target, root)) return null;
        st = await stat(target);
      } else {
        st = await lstat(abs);
      }
    } catch {
      return null;
    }
    return { path: toRel(root, abs), name, dir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtime: Math.round(st.mtimeMs) };
  }

  async function walk(dirAbs: string, root: string, depth: number, budget: { left: number }): Promise<FileNodeDTO[]> {
    let entries;
    try {
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch {
      return [];
    }
    entries.sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1;
      const bd = b.isDirectory() ? 0 : 1;
      return ad !== bd ? ad - bd : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    const out: FileNodeDTO[] = [];
    for (const e of entries) {
      if (budget.left <= 0) break;
      if (NOISE_FILES.has(e.name)) continue;
      if (e.isDirectory() && IGNORED_DIRS.has(e.name)) continue;
      const abs = join(dirAbs, e.name);
      const node = await nodeFor(abs, root, e.name, e.isSymbolicLink());
      if (!node) continue;
      budget.left--;
      // symlinked folders are shown but never followed (no cycles, no escapes)
      if (node.dir && !e.isSymbolicLink() && depth > 1) node.children = await walk(abs, root, depth - 1, budget);
      out.push(node);
    }
    return out;
  }

  async function countFiles(dirAbs: string, budget: { left: number }): Promise<number> {
    let n = 0;
    let entries;
    try {
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch {
      return 0;
    }
    for (const e of entries) {
      if (budget.left <= 0) break;
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue;
        n += await countFiles(join(dirAbs, e.name), budget);
      } else if (e.isFile()) {
        n++;
        budget.left--;
      }
    }
    return n;
  }

  async function manifestLine(root: string, name: string): Promise<string | null> {
    const file = Bun.file(join(root, name));
    if (!(await file.exists()) || file.size > 256 * 1024) return null;
    const text = await file.text().catch(() => "");
    const take = (xs: string[], n: number) => (xs.length > n ? `${xs.slice(0, n).join(", ")} +${xs.length - n}` : xs.join(", "));
    switch (name) {
      case "package.json": {
        let pkg: Record<string, unknown>;
        try {
          pkg = JSON.parse(text) as Record<string, unknown>;
        } catch {
          return "package.json (unparsable)";
        }
        const parts: string[] = [];
        if (typeof pkg.name === "string") parts.push(`name ${pkg.name}`);
        if (pkg.workspaces) parts.push("workspaces");
        const scripts = Object.keys((pkg.scripts as Record<string, unknown>) ?? {});
        if (scripts.length) parts.push(`scripts ${take(scripts, 6)}`);
        const deps = [...Object.keys((pkg.dependencies as Record<string, unknown>) ?? {}), ...Object.keys((pkg.devDependencies as Record<string, unknown>) ?? {})];
        if (deps.length) parts.push(`deps ${take(deps, 8)}`);
        return `package.json: ${parts.join("; ") || "empty"}`;
      }
      case "Cargo.toml": {
        const m = text.match(/^\s*name\s*=\s*"([^"]+)"/m);
        return `Cargo.toml${m ? `: crate ${m[1]}` : ""}${/^\s*\[workspace\]/m.test(text) ? " (workspace)" : ""}`;
      }
      case "go.mod": {
        const m = text.match(/^module\s+(\S+)/m);
        return `go.mod${m ? `: module ${m[1]}` : ""}`;
      }
      case "pyproject.toml": {
        const m = text.match(/^\s*name\s*=\s*"([^"]+)"/m);
        return `pyproject.toml${m ? `: ${m[1]}` : ""}`;
      }
      case "requirements.txt": {
        const n = text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;
        return `requirements.txt: ${n} packages`;
      }
      default:
        return name;
    }
  }

  const MANIFESTS = ["package.json", "Cargo.toml", "go.mod", "pyproject.toml", "requirements.txt", "Gemfile", "composer.json", "Dockerfile", "docker-compose.yml", "compose.yaml", "Makefile"];

  const service: WorkspaceService = {
    async resolveInside(root, rel) {
      return (await resolveJailed(root, rel)).abs;
    },

    async list(root, rel = ".", depth = 2) {
      const j = await resolveJailed(root, rel);
      if (!j.exists) throw notFound(`path ${j.rel}`);
      const d = Math.max(1, Math.min(MAX_LIST_DEPTH, Math.floor(depth) || 1));
      const st = await stat(j.abs);
      if (!st.isDirectory()) {
        const node = await nodeFor(j.abs, j.root, basename(j.abs), false);
        return node ? [node] : [];
      }
      return walk(j.abs, j.root, d, { left: MAX_LIST_NODES });
    },

    async read(root, rel, range) {
      const j = await resolveJailed(root, rel);
      if (!j.exists) throw notFound(`file ${j.rel}`);
      const st = await stat(j.abs);
      if (st.isDirectory()) throw badRequest(`${j.rel} is a directory`, "is_directory");
      const file = Bun.file(j.abs);
      let bytes: Uint8Array;
      let hash: string;
      let streamedLines: number | null = null;
      if (st.size <= READ_ALL_MAX) {
        bytes = await file.bytes();
        hash = sha256(bytes);
      } else {
        // huge file: hash and count it by streaming, serve ranges from its head only
        const streamed = await hashStream(j.abs);
        hash = streamed.hash;
        streamedLines = streamed.lines;
        bytes = await file.slice(0, READ_CAP_BYTES * 4).bytes();
      }
      if (looksBinary(bytes)) return { content: "", totalLines: 0, truncated: false, hash, binary: true, size: st.size };
      let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      // drop a partial last line of a head-only read
      if (streamedLines !== null && text.includes("\n")) text = text.slice(0, text.lastIndexOf("\n") + 1);
      const lines = text.split("\n");
      const totalLines = streamedLines ?? countLines(text);
      const headOnly = streamedLines !== null;
      if (text.endsWith("\n")) lines.pop();
      const from = Math.max(1, Math.floor(range?.from ?? 1));
      const to = Math.min(totalLines, Math.floor(range?.to ?? totalLines));
      if (from > to) return { content: "", totalLines, truncated: false, hash, binary: false, size: st.size };
      if (headOnly && from > lines.length) {
        throw new HttpError(413, "too_large", `${j.rel} is ${st.size} bytes; only its first ${lines.length} lines can be read`);
      }
      const capped = capLines(lines.slice(from - 1, to), READ_CAP_BYTES);
      const cut = capped.truncated || (headOnly && to > lines.length);
      return { content: capped.text, totalLines, truncated: cut, hash, binary: false, size: st.size };
    },

    async write(root, rel, content) {
      if (typeof content !== "string") throw badRequest("content must be a string");
      const bytes = byteLen(content);
      if (bytes > WRITE_CAP_BYTES) throw new HttpError(413, "too_large", `content is ${bytes} bytes, the limit is ${WRITE_CAP_BYTES}`);
      const j = await resolveJailed(root, rel);
      if (j.rel === ".") throw badRequest("path must name a file", "invalid_path");
      if (touchesGit(j.rel)) throw gitError();
      let created = !j.exists;
      if (j.exists && (await stat(j.abs)).isDirectory()) throw badRequest(`${j.rel} is a directory`, "is_directory");
      const parent = dirname(j.abs);
      try {
        await mkdir(parent, { recursive: true });
      } catch {
        throw badRequest(`cannot create the parent folder of ${j.rel}`, "invalid_path");
      }
      const parentReal = await realpath(parent);
      if (!isInside(parentReal, j.root)) throw escapeError();
      const target = join(parentReal, basename(j.abs));
      const link = await lstat(target).catch(() => null);
      if (link?.isSymbolicLink()) {
        const real = await realpath(target).catch(() => null);
        if (!real || !isInside(real, j.root)) throw escapeError("path resolves outside the workspace through a symlink");
      }
      if (!link) created = true;
      await Bun.write(target, content);
      await publish(toRel(j.root, target), created ? "create" : "update", bytes);
      return { bytes, created };
    },

    async edit(root, rel, find, replace, all = false) {
      if (typeof find !== "string" || find.length === 0) throw badRequest("find must not be empty");
      if (typeof replace !== "string") throw badRequest("replace must be a string");
      const j = await resolveJailed(root, rel);
      if (touchesGit(j.rel)) throw gitError();
      if (!j.exists) throw notFound(`file ${j.rel}`);
      const st = await stat(j.abs);
      if (st.isDirectory()) throw badRequest(`${j.rel} is a directory`, "is_directory");
      if (st.size > WRITE_CAP_BYTES) throw new HttpError(413, "too_large", `${j.rel} is too large to edit`);
      const bytes = await Bun.file(j.abs).bytes();
      if (looksBinary(bytes)) throw badRequest(`${j.rel} is a binary file`, "binary_file");
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      const count = occurrences(text, find);
      if (count === 0) throw badRequest(`find text not found in ${j.rel}`, "no_match");
      if (count > 1 && !all) {
        throw badRequest(`find text matches ${count} times in ${j.rel}; add surrounding lines to make it unique or set all`, "ambiguous_match");
      }
      const next = all ? text.split(find).join(replace) : text.replace(find, () => replace);
      if (byteLen(next) > WRITE_CAP_BYTES) throw new HttpError(413, "too_large", "edited file would exceed the size limit");
      await Bun.write(j.abs, next);
      const replacements = all ? count : 1;
      await publish(j.rel, "update", byteLen(next));
      return { replacements };
    },

    async remove(root, rel) {
      const rootReal = await realRoot(root);
      const lexical = lexicalInside(rootReal, root, rel);
      if (lexical === rootReal) throw badRequest("cannot remove the workspace root", "invalid_path");
      const parent = await resolveJailed(root, dirname(lexical));
      if (!parent.exists) return { removed: false };
      const target = join(parent.abs, basename(lexical));
      const relPath = toRel(rootReal, target);
      if (touchesGit(relPath)) throw gitError();
      const st = await lstat(target).catch(() => null);
      if (!st) return { removed: false };
      // a symlink is removed itself, never its target
      if (st.isDirectory()) await rm(target, { recursive: true, force: true });
      else await unlink(target);
      await publish(relPath, "delete", st.isFile() ? st.size : 0);
      return { removed: true };
    },

    async search(root, pattern, glob, limit = 50) {
      const rootReal = await realRoot(root);
      if (typeof pattern !== "string" || pattern.length === 0) throw badRequest("pattern must not be empty");
      if (pattern.length > 500) throw badRequest("pattern is too long");
      const g = glob && glob.trim() !== "" ? glob.trim() : "**/*";
      if (g.includes("\0") || g.startsWith("/") || g.split("/").includes("..")) throw escapeError("glob must stay inside the workspace");
      const matcherGlob = new Bun.Glob(g);
      const baseOnly = !g.includes("/");
      const max = Math.max(1, Math.min(SEARCH_MAX_LIMIT, Math.floor(limit) || 50));
      const test = compileMatcher(pattern);
      const results: Array<{ path: string; line: number; text: string }> = [];
      let scanned = 0;

      const visit = async (dirAbs: string): Promise<boolean> => {
        let entries;
        try {
          entries = await readdir(dirAbs, { withFileTypes: true });
        } catch {
          return false;
        }
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const e of entries) {
          const abs = join(dirAbs, e.name);
          if (e.isDirectory()) {
            if (IGNORED_DIRS.has(e.name)) continue;
            if (await visit(abs)) return true;
            continue;
          }
          // symlinks are skipped: never followed, never read
          if (!e.isFile()) continue;
          const rel = toRel(rootReal, abs);
          if (!matcherGlob.match(rel) && !(baseOnly && matcherGlob.match(e.name))) continue;
          if (++scanned > SEARCH_MAX_FILES) return true;
          const file = Bun.file(abs);
          if (file.size > SEARCH_MAX_FILE) continue;
          const bytes = await file.bytes().catch(() => null);
          if (!bytes || looksBinary(bytes)) continue;
          const lines = new TextDecoder("utf-8", { fatal: false }).decode(bytes).split("\n");
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            if (line.length > SEARCH_MAX_LINE) continue;
            if (!test(line)) continue;
            results.push({ path: rel, line: i + 1, text: line.trim().slice(0, 200) });
            if (results.length >= max) return true;
          }
        }
        return false;
      };
      await visit(rootReal);
      return results;
    },

    async digest(root) {
      const rootReal = await realRoot(root);
      const entries = await readdir(rootReal, { withFileTypes: true }).catch(() => []);
      const budget = { left: 20_000 };
      const dirs: Array<{ name: string; files: number }> = [];
      const files: string[] = [];
      const skipped: string[] = [];
      for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (NOISE_FILES.has(e.name) || e.name === ".mengai") continue;
        if (e.isDirectory()) {
          if (IGNORED_DIRS.has(e.name)) {
            skipped.push(e.name);
            continue;
          }
          dirs.push({ name: e.name, files: await countFiles(join(rootReal, e.name), budget) });
        } else if (e.isFile()) {
          files.push(e.name);
        }
      }
      const total = files.length + dirs.reduce((n, d) => n + d.files, 0);
      if (total === 0 && dirs.length === 0) return "Empty workspace.";
      const lines: string[] = [];
      const capped = budget.left <= 0 ? "+" : "";
      lines.push(`${total}${capped} files${skipped.length ? ` (ignored: ${skipped.join(", ")})` : ""}`);
      if (dirs.length) {
        const shown = [...dirs].sort((a, b) => b.files - a.files || (a.name < b.name ? -1 : 1));
        const top = shown.slice(0, 12).map((d) => `${d.name}/ ${d.files}`);
        lines.push(`dirs: ${top.join(", ")}${shown.length > 12 ? ` +${shown.length - 12} more` : ""}`);
      }
      if (files.length) lines.push(`files: ${files.slice(0, 12).join(", ")}${files.length > 12 ? ` +${files.length - 12} more` : ""}`);
      for (const m of MANIFESTS) {
        if (!files.includes(m)) continue;
        const line = await manifestLine(rootReal, m);
        if (line && line !== m) lines.push(line);
      }
      let out = redact(lines.join("\n"));
      if (out.length > DIGEST_MAX_CHARS) out = out.slice(0, DIGEST_MAX_CHARS - 4).replace(/[^\n]*$/, "") + "...";
      return out;
    },
  };
  return service;
}
