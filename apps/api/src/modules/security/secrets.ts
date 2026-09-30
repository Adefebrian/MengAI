// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Committed credential detection: provider-shaped rules first, then a
// generic "secret-looking name = high-entropy literal" rule. Every finding
// carries only a masked value; the raw match never leaves this function.
import type { Severity } from "@mengai/shared";
import { redact } from "../../lib/redact";
import {
  baseName,
  entropy,
  ephemeralTag,
  extName,
  isCodeReference,
  isLoopbackUrl,
  isPlaceholder,
  isTestPath,
  looksRandom,
  maskSecret,
  normalizeLine,
  type RawFinding,
  type ValueTag,
} from "./util";

interface SecretRule {
  id: string;
  title: string;
  re: RegExp;
  /** capture group holding the secret (0 = whole match) */
  group: number;
  severity: Severity;
  /** minimum Shannon entropy of the captured value */
  minEntropy?: number;
}

export const SECRET_RULES: SecretRule[] = [
  { id: "secret.private_key", title: "Private key committed", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g, group: 0, severity: "critical" },
  { id: "secret.aws_secret_key", title: "AWS secret access key", re: /aws_?secret_?access_?key["']?\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi, group: 1, severity: "critical", minEntropy: 3.5 },
  { id: "secret.aws_access_key_id", title: "AWS access key id", re: /\b((?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16})\b/g, group: 1, severity: "high" },
  { id: "secret.github_token", title: "GitHub token", re: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g, group: 1, severity: "critical" },
  { id: "secret.gitlab_token", title: "GitLab token", re: /\b(glpat-[A-Za-z0-9_-]{20,})\b/g, group: 1, severity: "critical" },
  { id: "secret.slack_token", title: "Slack token", re: /\b(xox[abprs]-[A-Za-z0-9-]{10,})\b/g, group: 1, severity: "critical" },
  { id: "secret.slack_webhook", title: "Slack webhook URL", re: /(https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_]+\/B[A-Za-z0-9_]+\/[A-Za-z0-9_]{12,})/g, group: 1, severity: "high" },
  { id: "secret.stripe_live_key", title: "Stripe live key", re: /\b((?:sk|rk)_live_[A-Za-z0-9]{16,})\b/g, group: 1, severity: "critical" },
  { id: "secret.anthropic_key", title: "Anthropic API key", re: /\b(sk-ant-[A-Za-z0-9_-]{20,})/g, group: 1, severity: "critical" },
  { id: "secret.openai_key", title: "OpenAI API key", re: /\b(sk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,})/g, group: 1, severity: "critical", minEntropy: 3.5 },
  { id: "secret.google_api_key", title: "Google API key", re: /\b(AIza[0-9A-Za-z_-]{35})(?![0-9A-Za-z_-])/g, group: 1, severity: "high" },
  { id: "secret.sendgrid_key", title: "SendGrid API key", re: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g, group: 1, severity: "critical" },
  { id: "secret.npm_token", title: "npm access token", re: /\b(npm_[A-Za-z0-9]{36})\b/g, group: 1, severity: "critical" },
  { id: "secret.pypi_token", title: "PyPI upload token", re: /\b(pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,})/g, group: 1, severity: "critical" },
  { id: "secret.huggingface_token", title: "Hugging Face token", re: /\b(hf_[A-Za-z0-9]{34,})\b/g, group: 1, severity: "high" },
  { id: "secret.replicate_token", title: "Replicate API token", re: /\b(r8_[A-Za-z0-9]{20,})\b/g, group: 1, severity: "high" },
  { id: "secret.telegram_bot_token", title: "Telegram bot token", re: /\b(\d{8,10}:AA[A-Za-z0-9_-]{33})(?![A-Za-z0-9_-])/g, group: 1, severity: "high" },
  { id: "secret.discord_webhook", title: "Discord webhook URL", re: /(https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,})/g, group: 1, severity: "medium" },
  { id: "secret.jwt", title: "JSON Web Token", re: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, group: 1, severity: "medium" },
  {
    id: "secret.connection_string",
    title: "Password in a connection string",
    re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver):\/\/[^\s:@/'"`]+:([^\s@/'"`]{6,})@[^\s'"`]+/gi,
    group: 1,
    severity: "high",
  },
];

const GENERIC = /\b([A-Za-z0-9_.-]{0,40}(?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?key)[A-Za-z0-9_.-]{0,40})["']?\s*(?::=|=>|[=:])\s*(["'`]?)([^\s"'`,;]{12,})\2/gi;

const SKIP_EXT = new Set([
  "lock", "sum", "map", "svg", "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tgz", "woff", "woff2", "ttf", "eot", "mp4", "mov", "webm", "mp3", "wasm", "snap",
]);
const SKIP_NAMES = new Set(["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "poetry.lock", "Cargo.lock", "go.sum", "composer.lock", "Gemfile.lock"]);

const MAX_LINE = 4000;
const MAX_PER_FILE = 20;

export function shouldScanForSecrets(path: string): boolean {
  const name = baseName(path);
  if (SKIP_NAMES.has(name)) return false;
  if (/\.min\.(js|css)$/.test(name)) return false;
  return !SKIP_EXT.has(extName(path));
}

const PEM_BLOCK_LINES = 200;

/** A PEM header is the same for every key: identify the key by its whole block. */
function pemBlock(lines: string[], start: number): string {
  const end = Math.min(lines.length, start + PEM_BLOCK_LINES);
  const out: string[] = [];
  for (let k = start; k < end; k++) {
    out.push(lines[k]!.trim());
    if (k > start && /-----END [A-Z0-9 ]*PRIVATE KEY/.test(lines[k]!)) break;
  }
  return out.join("\n");
}

function finding(rule: { id: string; title: string; severity: Severity; closed?: string }, file: string, lineNo: number, line: string, value: string, tag: string): RawFinding {
  // test and fixture paths usually hold fabricated keys: still reported, at a low default
  const inTest = isTestPath(file);
  const closed = rule.closed ? `. Closed as a false positive: ${rule.closed}` : "";
  return {
    kind: "secrets",
    rule: rule.id,
    title: inTest ? `${rule.title} (test path)` : rule.title,
    file,
    line: lineNo,
    detail: redact(`${rule.title} at ${file}:${lineNo}, value ${maskSecret(value)}${inTest ? ". Found in a test path, likely a fixture: confirm it is not a live credential" : ""}${closed}`),
    fix: "Revoke and rotate this credential at the provider, remove it from the file and from git history, then load it from the environment or the vault.",
    severity: inTest ? "low" : rule.severity,
    // the keyed value tag makes a suppression apply to this exact value only
    key: `${redact(normalizeLine(line, value))}|${tag}`,
    ...(rule.closed ? { status: "false_positive" as const } : {}),
  };
}

/** Scans one text file; returns masked findings. `tag` keys the value into the fingerprint. */
export function scanSecrets(path: string, text: string, opts: { tag?: ValueTag } = {}): RawFinding[] {
  const tag = opts.tag ?? ephemeralTag;
  const out: RawFinding[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length && out.length < MAX_PER_FILE; i++) {
    const line = lines[i]!;
    if (line.length > MAX_LINE || line.length < 8) continue;
    const taken: string[] = [];
    for (const rule of SECRET_RULES) {
      rule.re.lastIndex = 0;
      for (let m = rule.re.exec(line); m; m = rule.re.exec(line)) {
        const value = m[rule.group] ?? m[0];
        if (!value || taken.some((t) => t.includes(value) || value.includes(t))) continue;
        if (rule.id !== "secret.private_key" && isPlaceholder(value)) continue;
        if (rule.minEntropy && entropy(value) < rule.minEntropy) continue;
        taken.push(value);
        // a password to a loopback database is a local dev default, not a leak of a reachable
        // service: reported low and closed with that evidence (JEV sec.false_positive, real 0.22)
        const loopback = rule.id === "secret.connection_string" && isLoopbackUrl(m[0]);
        const severity = loopback ? "low" : rule.severity;
        const closed = loopback ? "the host is loopback, so this is a local development default" : undefined;
        const tagged = rule.id === "secret.private_key" ? pemBlock(lines, i) : value;
        out.push(finding({ ...rule, severity, closed }, path, i + 1, line, value, tag(tagged)));
      }
    }
    GENERIC.lastIndex = 0;
    for (let m = GENERIC.exec(line); m; m = GENERIC.exec(line)) {
      const value = m[3]!;
      if (taken.some((t) => t.includes(value) || value.includes(t))) continue;
      if (isPlaceholder(value) || isCodeReference(value)) continue;
      if (/^https?:\/\//i.test(value) && !/:[^/@]+@/.test(value)) continue;
      if (!looksRandom(value)) continue;
      taken.push(value);
      out.push(finding({ id: "secret.generic_assignment", title: "Hardcoded secret value", severity: "high" }, path, i + 1, line, value, tag(value)));
    }
  }
  return out;
}
