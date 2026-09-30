// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Context builder: the token-efficiency core. Lays every agent prompt out
// stable first so vendor prefix caches hit on almost every call:
//
//   system   charter (static per role, or a dynamic role's) + crew skills + strategy addenda (role, then the cat's own) [cached prefix: cacheSystem]
//   tools    only the role's tools
//   user     brief (goal, project, workspace digest, run history) + memory (lessons)  [breakpoint]
//   user     task packet (spec, acceptance, deps, handoff, notes)           [breakpoint]
//   user     rolling summary of older steps, when compacted                 [breakpoint]
//   ...      recent steps: assistant tool calls + tool results, verbatim
//
// Budget = min(budgetTokens, 40% of the model window), with budgetTokens
// defaulting to 12k when unset (architecture.md section 7). Over budget means
// compact() first; compact() reports tokensBefore and tokensAfter, and a
// caller must stop compacting when tokensAfter >= tokensBefore (keepRecent
// can leave nothing to fold, see compact below). All caps use a fixed chars-per-token ratio so the text
// never shifts between calls; only estimates use the calibrated ratio.
import { CONTEXT_LAYERS, type AgentRole, type ContextLayer, type ContextXrayDTO } from "@mengai/shared";
import type { Clock } from "../../core/ports/clock";
import type { ChatMessage, ToolCall, ToolSpec } from "../../core/ports/llm";
import type { ContextBuild, ContextInput, ContextService, StepRecord } from "../../core/services";
import { redact } from "../../lib/redact";
import { charterFor, charterLayer, layerVersion, usableAddenda, usableCrewSkills, type CharterOverride, type CrewSkillLayer, type StrategyLayer } from "./charters";
import { createEstimator } from "./estimator";
import {
  DEDUPE_MIN_CHARS,
  DEFAULT_TRUNCATE_CHARS,
  SUMMARY_CAP_TOKENS,
  capTokens,
  dedupeSteps,
  extractiveSummary,
  keepTail,
  pointerTo,
  truncateHeadTail,
} from "./text";

export const WINDOW_SHARE = 0.4;
/** per-call input budget when the caller does not set one */
export const DEFAULT_BUDGET_TOKENS = 12_000;
export const CAPS = {
  digest: 300,
  history: 300,
  memory: 400,
  task: 800,
  spec: 300,
  acceptance: 120,
  deps: 140,
  handoff: 120,
  notes: 120,
  summary: SUMMARY_CAP_TOKENS,
} as const;
/** framing tokens per chat message (role markers, separators) */
export const MESSAGE_OVERHEAD = 4;
/** framing tokens per tool schema (function wrapper) */
export const TOOL_OVERHEAD = 8;
/** tool outputs folded into the summarizer input are cut to this size */
const FOLD_OUTPUT_CHARS = 1200;
const FOLD_TEXT_CHARS = 400;
const FOLD_ARGS_CHARS = 200;
export const CONTINUE_NUDGE = "Continue: call a tool, or call finish with evidence.";

export interface ContextServiceDeps {
  clock: Clock;
}

/**
 * The brain layers a caller may add to a ContextInput (the runs engine and
 * the evals replay do). All optional: without them the prompt is byte
 * identical to a build without a brain.
 *   roleKey  the cache key role: a dynamic role key, else the base role
 *   charter  a dynamic role's charter in place of the static base charter
 *   addenda  strategy addenda appended to the charter layer (role, then the cat's own)
 *   crewSkills  written crew skills for the role and company kind, after the charter
 */
export interface BrainContextInput extends ContextInput {
  roleKey?: string | null;
  charter?: CharterOverride | null;
  addenda?: StrategyLayer[] | null;
  crewSkills?: CrewSkillLayer[] | null;
}

function bullet(items: string[]): string {
  return items.map((i) => `- ${i.replace(/\s+/g, " ").trim()}`).join("\n");
}

/** Takes items in order while they fit the fixed token cap. */
function fitList(items: string[], capTokensLimit: number, perItemTokens: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const raw of items) {
    const item = capTokens(raw.trim(), perItemTokens).replace(/\n/g, " ");
    if (!item) continue;
    const cost = Math.ceil((item.length + 3) / 4);
    if (used + cost > capTokensLimit) break;
    out.push(item);
    used += cost;
  }
  return out;
}

function renderBrief(input: ContextInput): string {
  const b = input.brief;
  const parts = [`Goal: ${redact(b.goal.trim())}`, `Project: ${redact(b.projectName.trim())}`];
  const digest = b.workspaceDigest.trim();
  parts.push(`Workspace:\n${digest ? capTokens(redact(digest), CAPS.digest) : "(empty workspace)"}`);
  if (b.history && b.history.trim()) parts.push(`Earlier runs:\n${capTokens(redact(b.history.trim()), CAPS.history)}`);
  return parts.join("\n\n");
}

function renderMemory(input: ContextInput): string {
  if (input.lessons.length === 0) return "";
  const texts = fitList(
    input.lessons.map((l) => redact(l.text)),
    CAPS.memory,
    CAPS.memory,
  );
  if (texts.length === 0) return "";
  return `Lessons from earlier work (apply when relevant):\n${bullet(texts)}`;
}

function renderTask(task: NonNullable<ContextInput["task"]>): string {
  const parts = [`Your task: ${redact(task.title.trim())}`];
  const spec = task.spec.trim();
  if (spec) parts.push(`Spec:\n${capTokens(redact(spec), CAPS.spec)}`);
  const acceptance = fitList(task.acceptance.map(redact), CAPS.acceptance, 60);
  if (acceptance.length) parts.push(`Acceptance:\n${bullet(acceptance)}`);
  const deps = fitList(task.depSummaries.map(redact), CAPS.deps, 80);
  if (deps.length) parts.push(`Results from dependencies:\n${bullet(deps)}`);
  if (task.handoff && task.handoff.trim()) parts.push(`Handoff:\n${capTokens(redact(task.handoff.trim()), CAPS.handoff)}`);
  // newest notes matter most: take from the end, render in order
  const notes = fitList([...task.notes].reverse().map(redact), CAPS.notes, 60).reverse();
  if (notes.length) parts.push(`Notes for you:\n${bullet(notes)}`);
  return capTokens(parts.join("\n\n"), CAPS.task);
}

function renderSummary(summary: string): string {
  return `Summary of your earlier steps:\n${capTokens(redact(summary.trim()), CAPS.summary)}`;
}

function redactCall(call: ToolCall): ToolCall {
  const args = redact(call.arguments);
  return args === call.arguments ? call : { ...call, arguments: args };
}

/**
 * Recent steps as chat messages: one assistant message per step (text and
 * tool calls), then one tool message per call in call order. A call without
 * a recorded result gets a placeholder (vendors reject unanswered calls),
 * results without a matching call are dropped (vendors reject orphans), and
 * an output identical to the previous one becomes a pointer.
 */
export function renderSteps(steps: StepRecord[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let prevContent: string | null = null;
  let prevCall: string | null = null;
  for (const step of steps) {
    const calls = step.assistant.toolCalls.map(redactCall);
    const text = redact(step.assistant.text ?? "");
    if (!text.trim() && calls.length === 0) continue;
    const assistant: ChatMessage = { role: "assistant", content: text };
    if (calls.length) assistant.toolCalls = calls;
    out.push(assistant);
    for (const call of calls) {
      const result = step.results.find((r) => r.callId === call.id);
      let content = result ? redact(result.output) : "(no result recorded)";
      if (result && !result.ok) content = `[error] ${content}`;
      if (prevContent !== null && prevCall !== null && content === prevContent && content.length > DEDUPE_MIN_CHARS) {
        out.push({ role: "tool", toolCallId: call.id, content: pointerTo(prevCall) });
        continue;
      }
      prevContent = content;
      prevCall = call.id;
      out.push({ role: "tool", toolCallId: call.id, content });
    }
  }
  return out;
}

function sha256Hex(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

function messageText(m: ChatMessage): string {
  const body =
    typeof m.content === "string"
      ? m.content
      : m.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
  const calls = m.toolCalls ? m.toolCalls.map((c) => `${c.name}${c.arguments}`).join("\n") : "";
  return calls ? `${body}\n${calls}` : body;
}

export function createContextService(deps: ContextServiceDeps): ContextService {
  const estimator = createEstimator();

  const est = (text: string, model?: string) => estimator.estimate(text, model);
  const msgTokens = (m: ChatMessage, model?: string) => est(messageText(m), model) + MESSAGE_OVERHEAD;
  const toolTokens = (tools: ToolSpec[], model?: string) =>
    tools.reduce((sum, t) => sum + est(`${t.name}\n${t.description}\n${JSON.stringify(t.parameters)}`, model) + TOOL_OVERHEAD, 0);
  const stepsTokens = (summary: string | null, steps: StepRecord[]) =>
    (summary ? est(renderSummary(summary)) + MESSAGE_OVERHEAD : 0) +
    renderSteps(steps).reduce((sum, m) => sum + msgTokens(m), 0);

  function build(input: BrainContextInput): ContextBuild {
    const model = input.model;
    const charter = input.charter && input.charter.text.trim() ? input.charter : null;
    const addenda = usableAddenda(input.addenda);
    const skills = usableCrewSkills(input.crewSkills);
    const version = layerVersion(charter, addenda, skills);
    const system = version ? redact(charterLayer(input.role, charter, addenda, skills)) : charterFor(input.role);
    const tools = input.tools;
    const messages: ChatMessage[] = [];
    const layer: Record<ContextLayer, number> = {
      charter: est(system, model) + MESSAGE_OVERHEAD,
      tools: tools.length ? toolTokens(tools, model) : 0,
      brief: 0,
      memory: 0,
      task: 0,
      summary: 0,
      recent: 0,
    };

    // brief + memory: one user message, breakpoint after the memory block
    const brief = renderBrief(input);
    const memory = renderMemory(input);
    messages.push({ role: "user", content: memory ? `${brief}\n\n${memory}` : brief, cacheBreakpoint: true });
    layer.brief = est(brief, model) + MESSAGE_OVERHEAD;
    layer.memory = memory ? est(memory, model) : 0;
    let lastBreakpoint: ContextLayer = "memory";

    if (input.task) {
      const packet = renderTask(input.task);
      messages.push({ role: "user", content: packet, cacheBreakpoint: true });
      layer.task = est(packet, model) + MESSAGE_OVERHEAD;
      lastBreakpoint = "task";
    }

    if (input.summary && input.summary.trim()) {
      const text = renderSummary(input.summary);
      messages.push({ role: "user", content: text, cacheBreakpoint: true });
      layer.summary = est(text, model) + MESSAGE_OVERHEAD;
      lastBreakpoint = "summary";
    }

    const recent = renderSteps(input.steps);
    const last = recent[recent.length - 1];
    if (last && last.role === "assistant" && !last.toolCalls?.length) {
      recent.push({ role: "user", content: CONTINUE_NUDGE });
    }
    for (const m of recent) {
      messages.push(m);
      layer.recent += msgTokens(m, model);
    }

    const cutoff = CONTEXT_LAYERS.indexOf(lastBreakpoint);
    const layers = CONTEXT_LAYERS.map((name, i) => ({
      layer: name,
      tokens: layer[name],
      cached: layer[name] > 0 && i <= cutoff,
    }));
    const total = layers.reduce((sum, l) => sum + l.tokens, 0);

    const windowCap = input.contextWindow > 0 ? Math.floor(input.contextWindow * WINDOW_SHARE) : Number.POSITIVE_INFINITY;
    const requested = input.budgetTokens > 0 && Number.isFinite(input.budgetTokens) ? input.budgetTokens : DEFAULT_BUDGET_TOKENS;
    const budget = Math.max(1, Math.floor(Math.min(requested, windowCap)));

    const xray: ContextXrayDTO = {
      agentId: input.agentId,
      taskId: input.taskId,
      model,
      budget,
      layers,
      totalTokens: total,
      compactions: 0,
      lastCachedTokens: 0,
      createdAt: deps.clock.now(),
    };

    return {
      request: {
        system,
        messages,
        tools,
        cacheSystem: true,
        cacheKey: cacheKeyFor(input.roleKey || input.role, input.runId, version),
      },
      xray,
      estimatedTokens: total,
      // folding needs at least two steps (the oldest half of one step is
      // nothing). build() does not know the caller's keepRecent: when
      // compact() then folds nothing it returns tokensAfter >= tokensBefore
      // and the caller must stop instead of compacting again.
      needsCompaction: total > budget && input.steps.length >= 2,
    };
  }

  /**
   * Folds the oldest half of `steps` (never more than leaves `keepRecent`)
   * into the rolling summary. When keepRecent leaves nothing to fold the
   * summarizer is not called, the steps come back deduped, and
   * tokensAfter >= tokensBefore signals "no progress": stop compacting.
   */
  async function compact(input: {
    steps: StepRecord[];
    summary: string | null;
    keepRecent: number;
    summarize?: (text: string) => Promise<string>;
  }): Promise<{ summary: string; steps: StepRecord[]; tokensBefore: number; tokensAfter: number }> {
    const { steps } = input;
    const prior = input.summary && input.summary.trim() ? input.summary.trim() : null;
    const tokensBefore = stepsTokens(prior, steps);
    const n = steps.length;
    const keep = Math.max(0, Math.floor(input.keepRecent));
    let fold = Math.floor(n / 2);
    if (n - fold < keep) fold = Math.max(0, n - keep);

    if (fold === 0) {
      const kept = dedupeSteps(steps);
      return { summary: prior ?? "", steps: kept, tokensBefore, tokensAfter: stepsTokens(prior, kept) };
    }

    const folded = steps.slice(0, fold);
    const kept = dedupeSteps(steps.slice(fold), steps);
    const text = foldText(prior, folded);
    let next = "";
    if (input.summarize) {
      try {
        next = (await input.summarize(text)).trim();
      } catch {
        next = "";
      }
    }
    if (next) {
      next = capTokens(redact(next), CAPS.summary);
    } else {
      // extractive fallback: prior summary kept as is, notable lines of the
      // folded steps appended, oldest lines dropped first past the cap
      const fresh = extractiveSummary(foldText(null, folded), fallbackLine(folded));
      next = keepTail(redact(prior ? `${prior}\n${fresh}` : fresh), CAPS.summary);
    }
    return { summary: next, steps: kept, tokensBefore, tokensAfter: stepsTokens(next, kept) };
  }

  return {
    charter: (role: AgentRole) => charterFor(role),
    build,
    compact,
    estimateTokens: (text: string, model?: string) => est(text, model),
    calibrate: (model: string, estimated: number, actual: number) => estimator.calibrate(model, estimated, actual),
    truncateOutput: (text: string, maxChars = DEFAULT_TRUNCATE_CHARS) => truncateHeadTail(redact(text ?? ""), maxChars),
  };
}

/** One cache key per role key, run and charter layer version: a new version starts a new cached prefix. */
export function cacheKeyFor(roleKey: AgentRole | string, runId: string, version = ""): string {
  return sha256Hex(version ? `${roleKey}:${runId}:${version}` : `${roleKey}:${runId}`);
}

/** Summarizer input: prior summary plus the folded steps, redacted and cut. */
function foldText(prior: string | null, folded: StepRecord[]): string {
  const lines: string[] = [];
  if (prior) lines.push("Previous summary:", prior, "");
  lines.push("Steps to fold, oldest first:");
  for (const step of folded) {
    const text = step.assistant.text?.trim();
    if (text) lines.push(`Assistant: ${truncateHeadTail(text, FOLD_TEXT_CHARS)}`);
    for (const call of step.assistant.toolCalls) {
      const result = step.results.find((r) => r.callId === call.id);
      const status = result ? (result.ok ? "ok" : "error") : "no result";
      lines.push(`Call ${call.name} ${truncateHeadTail(call.arguments, FOLD_ARGS_CHARS)}: ${status}`);
      if (result && result.output.trim()) lines.push(truncateHeadTail(result.output, FOLD_OUTPUT_CHARS));
    }
  }
  return redact(lines.join("\n"));
}

function fallbackLine(folded: StepRecord[]): string {
  const tools = [...new Set(folded.flatMap((s) => s.assistant.toolCalls.map((c) => c.name)))];
  return `Folded ${folded.length} earlier steps${tools.length ? ` using ${tools.join(", ")}` : ""}.`;
}
