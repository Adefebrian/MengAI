// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Lockfile parsers: text in, (name, version) pairs out. Pure functions, no
// IO, tolerant of malformed input (a broken lockfile yields fewer packages,
// never a thrown scan). Only exact resolved versions are returned; workspace,
// link, file, git and range-only entries are skipped because OSV can only
// match concrete versions.

export type Ecosystem = "npm" | "PyPI" | "Go" | "crates.io";

export interface ParsedPackage {
  name: string;
  version: string;
}

export interface PackageRef extends ParsedPackage {
  ecosystem: Ecosystem;
  /** workspace-relative lockfile path */
  file: string;
}

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;
const PEP440 = /^\d+(?:\.\d+)*(?:[._-]?(?:a|b|rc|alpha|beta|c|pre|preview|post|dev)\.?\d*)*(?:\+[A-Za-z0-9.]+)?$/i;

function isSemver(v: string): boolean {
  return SEMVER.test(v);
}

// ------------------------------------------------------------------ JSONC
/** Strips // and block comments and trailing commas outside strings. */
export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < n && /\s/.test(text[j]!)) j++;
      if (text[j] === "}" || text[j] === "]") {
        i++;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

function splitNameAt(spec: string): ParsedPackage | null {
  // "@scope/name@1.2.3" or "name@1.2.3": the separator is the first "@" after the name
  const at = spec.startsWith("@") ? spec.indexOf("@", 1) : spec.indexOf("@");
  if (at <= 0) return null;
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

// -------------------------------------------------------------- bun.lock
export function parseBunLock(text: string): ParsedPackage[] {
  let data: { packages?: Record<string, unknown> };
  try {
    data = JSON.parse(stripJsonc(text));
  } catch {
    return [];
  }
  const out: ParsedPackage[] = [];
  for (const entry of Object.values(data.packages ?? {})) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    const pkg = splitNameAt(entry[0]);
    if (pkg && isSemver(pkg.version)) out.push(pkg);
  }
  return out;
}

// ----------------------------------------------------- package-lock.json
interface NpmLockV1Dep {
  version?: string;
  dependencies?: Record<string, NpmLockV1Dep>;
}

export function parsePackageLock(text: string): ParsedPackage[] {
  let data: { packages?: Record<string, { version?: string; name?: string; link?: boolean }>; dependencies?: Record<string, NpmLockV1Dep> };
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const out: ParsedPackage[] = [];
  if (data.packages && typeof data.packages === "object") {
    for (const [key, v] of Object.entries(data.packages)) {
      if (!key || !v || typeof v !== "object" || v.link) continue;
      const idx = key.lastIndexOf("node_modules/");
      if (idx < 0) continue;
      const name = typeof v.name === "string" ? v.name : key.slice(idx + "node_modules/".length);
      if (typeof v.version === "string" && isSemver(v.version)) out.push({ name, version: v.version });
    }
    return out;
  }
  const walk = (deps: Record<string, NpmLockV1Dep> | undefined, depth: number) => {
    if (!deps || depth > 64) return;
    for (const [name, v] of Object.entries(deps)) {
      if (v && typeof v.version === "string" && isSemver(v.version)) out.push({ name, version: v.version });
      walk(v?.dependencies, depth + 1);
    }
  };
  walk(data.dependencies, 0);
  return out;
}

// -------------------------------------------------------- pnpm-lock.yaml
const PNPM_V5 = /^((?:@[^/]+\/)?[^/@]+)\/(\d+\.\d+\.\d+[^_/()]*)(?:_.+)?$/;

export function parsePnpmLock(text: string): ParsedPackage[] {
  const out: ParsedPackage[] = [];
  let inPackages = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      inPackages = line.startsWith("packages:");
      continue;
    }
    if (!inPackages) continue;
    const m = /^ {2}(\S.*):\s*$/.exec(line);
    if (!m) continue;
    let key = m[1]!.trim();
    if ((key.startsWith("'") && key.endsWith("'")) || (key.startsWith('"') && key.endsWith('"'))) key = key.slice(1, -1);
    let pkg: ParsedPackage | null = null;
    if (key.startsWith("/")) {
      key = key.slice(1);
      const v5 = PNPM_V5.exec(key);
      if (v5) pkg = { name: v5[1]!, version: v5[2]! };
    }
    if (!pkg) pkg = splitNameAt(key.replace(/\(.*$/, ""));
    if (pkg && isSemver(pkg.version)) out.push(pkg);
  }
  return out;
}

// -------------------------------------------------------------- yarn.lock
export function parseYarnLock(text: string): ParsedPackage[] {
  const out: ParsedPackage[] = [];
  let current: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || line.startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = null;
      if (!line.endsWith(":")) continue;
      const first = line.slice(0, -1).split(",")[0]!.trim().replace(/^"|"$/g, "");
      if (first === "__metadata" || /@(?:workspace|link|file|portal|patch):/.test(first)) continue;
      current = splitNameAt(first)?.name ?? null;
      continue;
    }
    if (!current) continue;
    const m = /^ {2}version:?\s+"?([^"\s]+)"?\s*$/.exec(line);
    if (m) {
      if (isSemver(m[1]!)) out.push({ name: current, version: m[1]! });
      current = null;
    }
  }
  return out;
}

// -------------------------------------------------------- requirements.txt
export function normalizePyName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

export function parseRequirements(text: string): ParsedPackage[] {
  const out: ParsedPackage[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line || line.startsWith("-")) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*===?\s*([A-Za-z0-9.+!_-]+)/.exec(line);
    if (!m) continue;
    const version = m[2]!;
    if (!PEP440.test(version)) continue;
    out.push({ name: normalizePyName(m[1]!), version });
  }
  return out;
}

// ------------------------------------------------ poetry.lock, Cargo.lock
function parseTomlPackages(text: string): Array<Record<string, string>> {
  const blocks: Array<Record<string, string>> = [];
  let cur: Record<string, string> | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "[[package]]") {
      cur = {};
      blocks.push(cur);
      continue;
    }
    if (line.startsWith("[")) {
      cur = null;
      continue;
    }
    if (!cur) continue;
    const m = /^([A-Za-z_-]+)\s*=\s*"([^"]*)"\s*$/.exec(line);
    if (m && !(m[1]! in cur)) cur[m[1]!] = m[2]!;
  }
  return blocks;
}

export function parsePoetryLock(text: string): ParsedPackage[] {
  return parseTomlPackages(text)
    .filter((b) => b.name && b.version && PEP440.test(b.version))
    .map((b) => ({ name: normalizePyName(b.name!), version: b.version! }));
}

export function parseCargoLock(text: string): ParsedPackage[] {
  // only registry crates: path crates (no source) and git crates are not on crates.io
  return parseTomlPackages(text)
    .filter((b) => b.name && b.version && isSemver(b.version) && (b.source ?? "").match(/^(?:registry|sparse)\+/))
    .map((b) => ({ name: b.name!, version: b.version! }));
}

// ----------------------------------------------------------------- go.sum
export function parseGoSum(text: string): ParsedPackage[] {
  const out: ParsedPackage[] = [];
  for (const raw of text.split("\n")) {
    const parts = raw.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const version = parts[1]!.replace(/\/go\.mod$/, "");
    if (!/^v\d+\.\d+\.\d+/.test(version)) continue;
    // OSV Go entries use versions without the leading "v"
    out.push({ name: parts[0]!, version: version.slice(1) });
  }
  return out;
}

// --------------------------------------------------------------- registry
interface LockfileKind {
  ecosystem: Ecosystem;
  parse(text: string): ParsedPackage[];
}

export const LOCKFILES: Record<string, LockfileKind> = {
  "bun.lock": { ecosystem: "npm", parse: parseBunLock },
  "package-lock.json": { ecosystem: "npm", parse: parsePackageLock },
  "npm-shrinkwrap.json": { ecosystem: "npm", parse: parsePackageLock },
  "pnpm-lock.yaml": { ecosystem: "npm", parse: parsePnpmLock },
  "yarn.lock": { ecosystem: "npm", parse: parseYarnLock },
  "requirements.txt": { ecosystem: "PyPI", parse: parseRequirements },
  "poetry.lock": { ecosystem: "PyPI", parse: parsePoetryLock },
  "go.sum": { ecosystem: "Go", parse: parseGoSum },
  "Cargo.lock": { ecosystem: "crates.io", parse: parseCargoLock },
};

export function lockfileKind(fileName: string): LockfileKind | null {
  return LOCKFILES[fileName] ?? null;
}

export function isLockfile(fileName: string): boolean {
  return fileName in LOCKFILES || fileName === "bun.lockb";
}

/** Parses one lockfile and returns unique package refs. */
export function parseLockfile(path: string, text: string): PackageRef[] {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const kind = lockfileKind(name);
  if (!kind) return [];
  const seen = new Set<string>();
  const out: PackageRef[] = [];
  for (const p of kind.parse(text)) {
    const key = `${p.name}@${p.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...p, ecosystem: kind.ecosystem, file: path });
  }
  return out;
}
