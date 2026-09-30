// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Path jail for every workspace operation. A relative or absolute path is
// resolved lexically inside the real root first, then the nearest existing
// ancestor is realpath'd and must still be inside the root, so `..`
// segments, absolute paths elsewhere and symlinks that point out (dangling
// or not) are all rejected before any byte is read or written.
import { lstat, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { badRequest, HttpError, notFound } from "../../lib/http";

/** folders never listed, searched or counted */
export const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "target"]);

export function isInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  const p = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(p);
}

export const escapeError = (why = "path escapes the workspace") => new HttpError(403, "path_outside_workspace", why);

/** posix-style path relative to root ("." for the root itself) */
export function toRel(root: string, abs: string): string {
  const r = relative(root, abs);
  return r === "" ? "." : r.split(sep).join("/");
}

export async function realRoot(root: string): Promise<string> {
  if (typeof root !== "string" || !isAbsolute(root) || root.includes("\0")) {
    throw badRequest("workspace root must be an absolute path", "invalid_root");
  }
  let real: string;
  try {
    real = await realpath(root);
  } catch {
    throw notFound("workspace");
  }
  const st = await stat(real);
  if (!st.isDirectory()) throw badRequest("workspace root is not a directory", "invalid_root");
  return real;
}

export interface Jailed {
  /** real root */
  root: string;
  /** realpath of the target, or realpath of its nearest existing ancestor plus the missing tail */
  abs: string;
  /** posix path relative to root */
  rel: string;
  exists: boolean;
}

/** Lexical resolution inside rootReal; throws on any escape. */
export function lexicalInside(rootReal: string, rootGiven: string, rel: string): string {
  if (typeof rel !== "string" || rel.includes("\0")) throw badRequest("invalid path", "invalid_path");
  const input = rel.trim() === "" ? "." : rel;
  if (isAbsolute(input)) {
    const norm = resolve(input);
    if (isInside(norm, rootReal)) return norm;
    const given = resolve(rootGiven);
    if (isInside(norm, given)) return join(rootReal, relative(given, norm));
    throw escapeError();
  }
  const lexical = resolve(rootReal, input);
  if (!isInside(lexical, rootReal)) throw escapeError();
  return lexical;
}

export async function resolveJailed(root: string, rel: string): Promise<Jailed> {
  const rootReal = await realRoot(root);
  const lexical = lexicalInside(rootReal, root, rel);
  let probe = lexical;
  const tail: string[] = [];
  for (;;) {
    let real: string | null = null;
    let code: string | undefined;
    try {
      real = await realpath(probe);
    } catch (e) {
      code = (e as NodeJS.ErrnoException).code;
    }
    if (real !== null) {
      if (!isInside(real, rootReal)) throw escapeError("path resolves outside the workspace through a symlink");
      const abs = tail.length > 0 ? join(real, ...tail.reverse()) : real;
      return { root: rootReal, abs, rel: toRel(rootReal, abs), exists: tail.length === 0 };
    }
    if (code !== "ENOENT" && code !== "ENOTDIR") throw badRequest(`cannot access path (${code ?? "error"})`, "invalid_path");
    const link = await lstat(probe).catch(() => null);
    if (link?.isSymbolicLink()) throw escapeError("path goes through a dangling symlink");
    if (probe === rootReal) throw notFound("workspace");
    tail.push(basename(probe));
    probe = dirname(probe);
    if (!isInside(probe, rootReal)) throw escapeError();
  }
}

/** true when any segment of a workspace-relative path is .git */
export function touchesGit(rel: string): boolean {
  return rel.split("/").includes(".git");
}
