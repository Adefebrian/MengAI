// Pure text helpers for the context module: head + tail truncation, fixed
// caps, the extractive summary fallback and the tool output dedupe pointer.
// Everything here is deterministic so rendered prompts stay cache-stable.
import type { StepRecord } from "../../core/services";
import { FIXED_CHARS_PER_TOKEN } from "./estimator";

export const DEFAULT_TRUNCATE_CHARS = 3000;
const HEAD_SHARE = 2 / 3;

export function omittedMarker(n: number): string {
  return `[... ${n} chars omitted ...]`;
}

/**
 * Keeps the head (2/3 of maxChars) and the tail (1/3) with a marker between.
 * The default 3000 keeps the first 2000 and the last 1000 chars.
 */
export function truncateHeadTail(text: string, maxChars = DEFAULT_TRUNCATE_CHARS): string {
  const max = Math.max(3, Math.floor(maxChars));
  if (text.length <= max) return text;
  const head = Math.floor(max * HEAD_SHARE);
  const tail = max - head;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n${omittedMarker(omitted)}\n${text.slice(text.length - tail)}`;
}

/** Head-only cap to a token budget at the fixed ratio (byte-stable across calls). */
export function capTokens(text: string, tokens: number): string {
  const max = Math.max(0, Math.floor(tokens * FIXED_CHARS_PER_TOKEN));
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n${omittedMarker(text.length - max)}`;
}

export function fixedTokens(text: string): number {
  return Math.ceil(text.length / FIXED_CHARS_PER_TOKEN);
}

// ------------------------------------------------------------------ pointers
const POINTER_RE = /^\(same output as call (.+)\)$/;
/** outputs at or below this length are cheaper than the pointer, never deduped */
export const DEDUPE_MIN_CHARS = 80;

export function pointerTo(callId: string): string {
  return `(same output as call ${callId})`;
}

export function pointerTarget(output: string): string | null {
  const m = POINTER_RE.exec(output);
  return m ? m[1]! : null;
}

/**
 * Replaces every tool output identical to the previous tool output with a
 * pointer to the first call of that identical run. Pointers whose target is
 * not inside `steps` are restored from `all` first, so a pointer never
 * dangles after compaction folds its target away.
 */
export function dedupeSteps(steps: StepRecord[], all: StepRecord[] = steps): StepRecord[] {
  const original = new Map<string, string>();
  for (const s of all) {
    for (const r of s.results) {
      const target = pointerTarget(r.output);
      original.set(r.callId, target !== null ? (original.get(target) ?? r.output) : r.output);
    }
  }
  const out: StepRecord[] = [];
  let prevOutput: string | null = null;
  let prevOrigin: string | null = null;
  for (const s of steps) {
    const results = s.results.map((r) => {
      const target = pointerTarget(r.output);
      const output = target !== null ? (original.get(target) ?? r.output) : r.output;
      if (prevOutput !== null && prevOrigin !== null && output === prevOutput && output.length > DEDUPE_MIN_CHARS) {
        return { ...r, output: pointerTo(prevOrigin) };
      }
      prevOutput = output;
      prevOrigin = r.callId;
      return output === r.output ? r : { ...r, output };
    });
    out.push({ assistant: s.assistant, results });
  }
  return out;
}

// ---------------------------------------------------------------- extractive
const PATH_RE =
  /(?:^|[\s"'`(=:])(?:\.{0,2}\/)?[\w@.-]+\/[\w@./-]*[\w-]|\b[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|py|rs|go|java|kt|swift|rb|php|c|h|cpp|cs|sql|css|scss|html|vue|svelte|yml|yaml|toml|lock|sh|txt|env|xml|ini|cfg)\b/i;
const ERROR_RE =
  /\b(?:error|errors|fail|fails|failed|failing|failure|exception|denied|refused|timeout|timed out|cannot|can't|unable|not found|missing|invalid|panic|traceback|warning|broken|crash|crashed|rejected)\b/i;
const NUMBER_RE = /(?:^|[^\w-])\d+(?:[.,:]\d+)*%?(?![\w-])/;
const DECISION_RE =
  /\b(?:decided|decide|decision|chose|chosen|choose|going to|will|plan|planned|instead|because|agreed|approved|must|should|switched|fixed|done|created|added|updated|removed|renamed|passed|verified|resolved)\b/i;

export const SUMMARY_CAP_TOKENS = 600;
const LINE_CAP = 240;

export function isNotable(line: string): boolean {
  return PATH_RE.test(line) || ERROR_RE.test(line) || NUMBER_RE.test(line) || DECISION_RE.test(line);
}

/**
 * Extractive fallback summary: keeps lines with file paths, error words,
 * numbers and decisions, deduped, newest kept first when over the cap.
 */
export function extractiveSummary(text: string, fallback: string, capTokensLimit = SUMMARY_CAP_TOKENS): string {
  const maxChars = capTokensLimit * FIXED_CHARS_PER_TOKEN;
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line || seen.has(line) || !isNotable(line)) continue;
    seen.add(line);
    kept.push(line.length > LINE_CAP ? `${line.slice(0, LINE_CAP - 3)}...` : line);
  }
  if (kept.length === 0) return fallback;
  const picked: string[] = [];
  let size = 0;
  for (let i = kept.length - 1; i >= 0; i--) {
    const line = kept[i]!;
    if (size + line.length + 1 > maxChars) break;
    picked.push(line);
    size += line.length + 1;
  }
  if (picked.length === 0) return kept[kept.length - 1]!.slice(0, maxChars);
  return picked.reverse().join("\n");
}

/** Keeps whole lines from the end (newest) within a fixed token cap. */
export function keepTail(text: string, tokens: number): string {
  const maxChars = tokens * FIXED_CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  const lines = text.split("\n");
  const picked: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (size + line.length + 1 > maxChars) break;
    picked.push(line);
    size += line.length + 1;
  }
  if (picked.length === 0) return text.slice(text.length - maxChars);
  return picked.reverse().join("\n");
}
