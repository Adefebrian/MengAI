// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The legacy Briworkers prompt policy, ported from the Go engine so the
// benchmark replays what legacy actually sent:
//   - a fixed 2,076-token system prompt and 20 tool schemas (~1,800 tokens) on every call
//   - tool results capped at 4,000 chars, head 2/3 + tail 1/3 (config ToolOutputMax,
//     internal/compact/compact.go ToolOutput), after the file read (64 KiB) and shell (16 KiB) caps
//   - history grows unbounded inside a wake (runTurns, up to 50 turns for a worker);
//     between wakes the conversation is trimmed to the system prompt, a salient-lines
//     digest of the middle and the last 39 messages (compact.Conversation(convo, 39))
//   - the first wake adds the planning nudge before the first call
//   - no prompt cache in the headline (the measured baseline reports 0% cache; the
//     legacy client never set a cache key and never read cached token counts)
// Legacy literal strings are kept verbatim except that their long dash is
// written as "-" here (same character count, so the token estimate is unchanged).
export const LEGACY = {
  systemTokens: 2076,
  toolTokens: 1800,
  toolCount: 20,
  toolOutputMax: 4000,
  keepRecent: 39,
  /** iteration.Budget for a worker (depth >= 2): base AgentMaxTurns 50 */
  wakeTurns: 50,
  fileReadMaxBytes: 64 * 1024,
  shellMaxBytes: 16 * 1024,
} as const;

/** engine.go planningNudge, sent once on the first wake */
export const LEGACY_PLANNING_NUDGE =
  "[system] PLAN FIRST: restate your mission in ONE line, then list 2-5 EXPLICIT, TESTABLE acceptance criteria - each phrased so it can be proven by a real run_shell exit_code or a concrete artifact/file path (no vague 'works well'). For EACH criterion, note the exact command or path you will use as evidence. Then SELF-CRITIQUE your plan in 1-2 lines: what is the riskiest assumption and how will you falsify it? Finally list the ordered tool steps. Check ORG & PEERS - reuse an existing teammate before hiring. Then begin executing.";

export interface LegacyMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  toolCallId?: string;
}

/** Raw per-tool caps applied by the legacy workspace before ToolOutput. */
export function legacyRawCap(tool: string, output: string): string {
  if (tool === "fs_read" && output.length > LEGACY.fileReadMaxBytes) return output.slice(0, LEGACY.fileReadMaxBytes) + "\n…[truncated]";
  if (tool === "shell_run" && output.length > LEGACY.shellMaxBytes) return output.slice(0, LEGACY.shellMaxBytes) + "\n…[output truncated]";
  return output;
}

/** compact.ToolOutput: unchanged within max runes, else head 2/3 + tail 1/3 with an elision marker. */
export function legacyToolOutput(s: string, max: number = LEGACY.toolOutputMax): string {
  const limit = max <= 0 ? 4000 : max;
  const r = Array.from(s);
  if (r.length <= limit) return s;
  const head = Math.floor((limit * 2) / 3);
  const tail = limit - head;
  const elided = r.length - head - tail;
  return r.slice(0, head).join("") + `\n…[${elided} chars elided to fit context - head+tail kept]…\n` + r.slice(r.length - tail).join("");
}

const SALIENT = [
  "acceptance criteria", "criteria:", "decision", "decided", "must ", "bug", "error", "fail", "exit_code", "exit code",
  "blocker", "blocked", "finish", "verdict", "pass", "goal", "mission", "hired", "fired", "deadline", "constraint",
  "todo", "risk", "acceptance", "wrote ", "edited ", "created ", "open blocker",
];
const FILE_PATH = /[\w./-]+\.(?:go|ts|tsx|js|jsx|py|rs|java|md|json|yaml|yml|toml|sh|sql|css|html)\b(?::\d+)?/;

function isSalient(line: string): boolean {
  const low = line.toLowerCase();
  return SALIENT.some((m) => low.includes(m)) || FILE_PATH.test(line);
}

function digestMiddle(middle: LegacyMessage[]): string {
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const m of middle) {
    const content = m.content.trim();
    if (content === "") {
      if (m.toolCalls && m.toolCalls.length > 0) {
        const line = `${m.role} called: ${m.toolCalls.map((t) => t.name).join(", ")}`;
        if (!seen.has(line)) {
          seen.add(line);
          bullets.push(`- ${line}`);
        }
      }
      continue;
    }
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (line.length < 8 || line.length > 240 || !isSalient(line)) continue;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      bullets.push(`- ${line}`);
      if (bullets.length >= 40) break;
    }
    if (bullets.length >= 40) break;
  }
  if (bullets.length === 0) return `(${middle.length} earlier messages contained no flagged decisions/bugs/errors)`;
  return bullets.join("\n");
}

const DIGEST_PREAMBLE =
  "[context-compaction] The earlier conversation was compressed to save context/tokens. The bullets below are the load-bearing facts extracted from it - decisions made, open blockers, acceptance criteria, bugs, exit_codes, and file paths you touched. Treat them as authoritative memory and DO NOT re-litigate or re-ask what they already settle:\n";

/** compact.Conversation: keep convo[0] (system), digest the middle, keep the last keepRecent messages. */
export function legacyConversation(convo: LegacyMessage[], keepRecent: number = LEGACY.keepRecent): LegacyMessage[] {
  const keep = Math.max(2, keepRecent);
  if (convo.length <= keep + 2) return convo;
  const head = convo[0]!;
  const middle = convo.slice(1, convo.length - keep);
  const recent = convo.slice(convo.length - keep);
  const digest = digestMiddle(middle);
  const out: LegacyMessage[] = [head];
  if (digest !== "") out.push({ role: "user", content: DIGEST_PREAMBLE + digest });
  return out.concat(recent);
}
