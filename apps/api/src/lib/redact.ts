// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Secret redaction for logs, events, tool outputs, errors and JEV state.
// Two layers: exact values of every key the vault handed out this process
// (registerSecret), then pattern rules for common key shapes. Redaction is a
// safety net: code must still never log or return a secret on purpose.

const exact = new Set<string>();

/** Remember a live secret value so any exact occurrence is scrubbed. */
export function registerSecret(value: string | null | undefined): void {
  if (value && value.length >= 8) exact.add(value);
}

export function forgetSecret(value: string | null | undefined): void {
  if (value) exact.delete(value);
}

const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9\-._~+/]{12,}=*/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{10,}\b/g,
  /\bsk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g,
  /\bapikey_[A-Za-z0-9_-]{6,}\b/g,
  /\br8_[A-Za-z0-9]{20,}\b/g,
];

const ASSIGNMENT = /\b([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|password|passwd|credential)[A-Za-z0-9_.-]*)(\s*[=:]\s*)("(?:[^"\\]|\\.){6,}"|'(?:[^'\\]|\\.){6,}'|[^\s,;'"}{]{6,})/gi;

export const REDACTED = "[REDACTED]";

export function redact(text: string): string {
  if (!text) return text;
  let out = text;
  for (const value of exact) {
    if (out.includes(value)) out = out.split(value).join(REDACTED);
  }
  for (const re of PATTERNS) out = out.replace(re, REDACTED);
  out = out.replace(ASSIGNMENT, (_m, name: string, sep: string) => `${name}${sep}${REDACTED}`);
  return out;
}

/** Deep-clone redaction for objects headed to logs, events or JEV. */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = /(api[_-]?key|secret|token|password|authorization)/i.test(k) && typeof v === "string" ? REDACTED : redactDeep(v);
    }
    return out as T;
  }
  return value;
}

/** Mask for display: keeps the last 4 characters only. */
export function keyHint(secret: string): string {
  return secret.length <= 4 ? "" : secret.slice(-4);
}

/** Truncate for events and status lines (no secrets, no giant blobs). */
export function clip(text: string, max = 280): string {
  const clean = redact(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}
