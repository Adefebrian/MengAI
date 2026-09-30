// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Small helpers shared by the security scanners: hashing, entropy, masking,
// placeholder detection and severity ordering.
import type { FindingStatus, ScanKind, Severity } from "@mengai/shared";

export interface RawFinding {
  kind: ScanKind;
  rule: string;
  title: string;
  /** workspace-relative */
  file: string | null;
  line: number | null;
  /** must never contain a raw secret: mask before building it */
  detail: string;
  fix: string | null;
  severity: Severity;
  /** stable identity input (no secret material); hashed into the fingerprint */
  key: string;
  /** set when the scanner closes the finding itself, with the evidence in detail */
  status?: FindingStatus;
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function sha256Hex(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

export function fingerprint(f: Pick<RawFinding, "kind" | "rule" | "file" | "key">): string {
  return sha256Hex(`${f.kind}|${f.rule}|${f.file ?? ""}|${f.key}`).slice(0, 32);
}

/**
 * Keyed tag of a raw secret value for fingerprint keys: a status set on one
 * value (accepted, false_positive) never carries over to a different value
 * on the same line. The key is per install, so the tag cannot be checked
 * against guessed values without it.
 */
export type ValueTag = (value: string) => string;

export function hmacTag(key: string): ValueTag {
  return (value) => new Bun.CryptoHasher("sha256", key).update(value).digest("hex").slice(0, 16);
}

export function randomKeyHex(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("hex");
}

/** Process-local key for callers that pass no tag (pure scanner use, tests): stable per process only. */
export const ephemeralTag: ValueTag = hmacTag(randomKeyHex());

/** Shannon entropy in bits per character. */
export function entropy(s: string): number {
  if (!s) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Masked form for findings: at most 4 leading characters survive, never the tail. */
export function maskSecret(value: string): string {
  const shown = value.length >= 20 ? 4 : value.length >= 12 ? 2 : 0;
  return `${value.slice(0, shown)}${"*".repeat(8)} (${value.length} chars)`;
}

const PLACEHOLDER_WORDS = /(example|changeme|change_me|change-me|placeholder|dummy|sample|redacted|your[_-]?|xxxx|<[^>]*>|fake|replace|insert|todo|foobar)/i;

const DEFAULT_PASSWORDS = new Set(["password", "passwd", "postgres", "root", "admin", "secret", "changeme", "pass", "user", "test", "example", "mysql", "redis", "guest"]);

function alnumClass(code: number): number {
  if (code >= 48 && code <= 57) return 1;
  if (code >= 65 && code <= 90) return 2;
  if (code >= 97 && code <= 122) return 3;
  return 0;
}

/** Longest run of consecutive ascending or descending letters or digits (ABCDEFGH, 87654321). */
export function longestSequentialRun(v: string): number {
  let best = v ? 1 : 0;
  let up = 1;
  let down = 1;
  for (let i = 1; i < v.length; i++) {
    const a = v.charCodeAt(i - 1);
    const b = v.charCodeAt(i);
    const same = alnumClass(a) !== 0 && alnumClass(a) === alnumClass(b);
    up = same && b === a + 1 ? up + 1 : 1;
    down = same && b === a - 1 ? down + 1 : 1;
    best = Math.max(best, up, down);
  }
  return best;
}

/** True when a candidate secret value is obviously a placeholder or a reference. */
export function isPlaceholder(value: string): boolean {
  const v = value.trim();
  if (DEFAULT_PASSWORDS.has(v.toLowerCase())) return true;
  if (v.length < 8) return true;
  // hand-typed fixtures (sk-proj-ABCDEFGHIJKLMNOPQRST, 12345678...): a real key almost never holds such a run
  if (longestSequentialRun(v) >= 8) return true;
  if (/^(.)\1+$/.test(v)) return true;
  if (/^[*.x#-]+$/i.test(v)) return true;
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(v)) return true;
  if (/\$\{[^}]*\}|\{\{[^}]*\}\}|%[A-Z_]+%/.test(v)) return true;
  return PLACEHOLDER_WORDS.test(v);
}

/** True when an assigned value is code, not a literal (a call, a member path, env lookup, regex, constant). */
export function isCodeReference(value: string): boolean {
  const v = value.trim();
  if (/[()[\]]/.test(v)) return true;
  if (v.startsWith("/") && /\/[dgimsuy]*$/.test(v.slice(1))) return true;
  if (/^\$\{?[A-Za-z_]/.test(v)) return true;
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(v)) return true;
  if (/^(process\.env|import\.meta|os\.environ|os\.getenv|env\.|config\.|settings\.|Deno\.env|Bun\.env)/.test(v)) return true;
  if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(v)) return true;
  if (/^(true|false|null|undefined|none|nil|string|number)$/i.test(v)) return true;
  return false;
}

const SECRET_NAME = /(pass(word|wd)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?key|credential|signing[_-]?key|encryption[_-]?key)/i;

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name) && !/(_file|_path|_url|_endpoint|_name|_id|_ttl|_length|_header|_type)$/i.test(name);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function extName(path: string): string {
  const b = baseName(path);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
}

/** Normalized line text used in fingerprints: secret removed, whitespace folded, clipped. */
export function normalizeLine(line: string, secret?: string): string {
  let t = secret ? line.split(secret).join("<secret>") : line;
  t = t.replace(/\s+/g, " ").trim();
  return t.slice(0, 200);
}

/**
 * Random-looking enough to be a credential: letters and digits mixed, or a
 * long mixed-case string. Plain words, kebab identifiers and header names
 * ("x-mengai-control") do not qualify.
 */
export function looksRandom(value: string): boolean {
  const e = entropy(value);
  const letters = /[A-Za-z]/.test(value);
  const digits = /\d/.test(value);
  if (letters && digits && e >= 3.5) return true;
  return value.length >= 20 && /[a-z]/.test(value) && /[A-Z]/.test(value) && e >= 4;
}

const LOOPBACK_HOST = /@(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)(?::\d+)?(?:[/?]|$)/i;

export function isLoopbackUrl(text: string): boolean {
  return LOOPBACK_HOST.test(text);
}

/** Test and fixture paths: secrets there default to low (JEV sec.false_positive policy), code rules are skipped. */
export function isTestPath(path: string): boolean {
  if (/(^|\/)(__tests__|__mocks__|__fixtures__|tests?|spec|specs|fixtures?|testdata|test-data)\//i.test(path)) return true;
  const name = baseName(path);
  return /\.(test|spec)\.[A-Za-z0-9]+$/.test(name) || /_test\.(go|py|rs)$/.test(name) || /^test_.+\.py$/.test(name);
}
