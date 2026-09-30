// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Deterministic ContextService double that follows the v2 prompt layout in
// docs/architecture.md section 7. The evals tests replay through it because the
// real context module is built in parallel; in production the evals module
// always receives the real ContextService through deps.context, and the
// integration wave re-runs the benchmark against it.
//
// Layout, stable to volatile:
//   system  = role charter (250 to 400 tokens) + tool-use rules
//   tools   = the role's tools only                        [breakpoint 1: cacheSystem]
//   msg 1   = run brief (workspace digest capped 300) + memory (lessons capped 400) [breakpoint 2]
//   msg 2   = task packet (capped 800) + rolling summary   [breakpoint 3]
//   msg 3+  = recent steps verbatim (tool outputs already head+tail truncated)
import type { AgentRole, ContextLayer } from "@mengai/shared";
import type { ChatMessage } from "../../core/ports/llm";
import type { ContextBuild, ContextInput, ContextService, StepRecord } from "../../core/services";
import { charEstimate, messageTokens, toolsTokens, MESSAGE_OVERHEAD, REPLY_PRIMING } from "./meter";

const RULES = [
  "Work only inside the project workspace. Read before you edit, and edit with fs_edit find and replace instead of rewriting whole files.",
  "Read files by line range when you only need part of them. Tool outputs are truncated head and tail; ask for a range when you need the middle.",
  "Run the project's tests after every change that can break them, and report failures with the exact command and the first failing assertion.",
  "Never print, store or send secrets, keys or tokens. If you see one, stop and report it.",
  "Keep messages short. Call finish with a two line summary and the files you changed when the acceptance criteria are met.",
  "If the task needs another role, hand off with a precise spec instead of doing it badly. Ask the human only when blocked on a decision you cannot make.",
].join("\n");

const MISSION: Record<AgentRole, string> = {
  lead: "You are the lead cat. Turn the goal into a small task plan with clear acceptance criteria, assign each task to the right role, watch progress and unblock the crew. You do not write feature code.",
  engineer: "You are an engineer cat. Implement the task in the workspace with small, tested changes that follow the project's existing patterns and conventions.",
  designer: "You are a designer cat. Produce the visual assets and styling the task asks for, keep them consistent with the project's look, and save them under assets/.",
  reviewer: "You are a reviewer cat. Review the change for correctness, clarity and boundaries. Approve it or request fixes with concrete, located notes.",
  qa: "You are a QA cat. Reproduce the problem, write or fix the tests, and verify every acceptance criterion with a real test run.",
  security: "You are a security cat. Scan dependencies, secrets and configuration, confirm findings with evidence, and report them graded by impact.",
  researcher: "You are a researcher cat. Find current, sourced information for the task and write a short, cited summary into the workspace.",
  operator: "You are an operator cat. Operate apps on the owner's Mac only through the automation tools, one visible step at a time, within the granted permissions.",
};

function capChars(text: string, maxTokens: number): string {
  const max = maxTokens * 4;
  return text.length <= max ? text : `${text.slice(0, max - 20)}\n[capped at ${maxTokens} tokens]`;
}

function stepMessages(steps: StepRecord[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const s of steps) {
    out.push({ role: "assistant", content: s.assistant.text, toolCalls: s.assistant.toolCalls });
    for (const r of s.results) out.push({ role: "tool", toolCallId: r.callId, content: r.output });
  }
  return out;
}

function serializeSteps(steps: StepRecord[]): string {
  return steps
    .map((s) => [s.assistant.text, ...s.assistant.toolCalls.map((c) => `${c.name} ${c.arguments}`), ...s.results.map((r) => r.output)].join("\n"))
    .join("\n");
}

function firstLine(text: string, max: number): string {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > max ? `${line.slice(0, max)}...` : line;
}

export const SUMMARY_MAX_CHARS = 2400;

export function referenceContext(): ContextService {
  const est = charEstimate;

  const charter = (role: AgentRole) => `${MISSION[role]}\n\nRules:\n${RULES}`;

  const truncateOutput = (text: string, maxChars = 3000): string => {
    if (text.length <= maxChars) return text;
    const head = Math.floor((maxChars * 2) / 3);
    const tail = maxChars - head;
    const omitted = text.length - head - tail;
    const headLines = text.slice(0, head).split("\n").length;
    return `${text.slice(0, head)}\n[${omitted} chars omitted after line ${headLines}; read a line range to see them]\n${text.slice(text.length - tail)}`;
  };

  const build = (input: ContextInput): ContextBuild => {
    const system = charter(input.role);
    const brief = [
      `Goal: ${input.brief.goal}`,
      `Project: ${input.brief.projectName}`,
      `Workspace:\n${capChars(input.brief.workspaceDigest, 300)}`,
      input.brief.history ? `Earlier runs:\n${capChars(input.brief.history, 300)}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const memory = input.lessons.length > 0 ? `Lessons:\n${capChars(input.lessons.map((l) => `- ${l.text}`).join("\n"), 400)}` : "";
    const t = input.task;
    const taskText = t
      ? capChars(
          [
            `Task: ${t.title}`,
            t.spec,
            t.acceptance.length > 0 ? `Acceptance:\n${t.acceptance.map((a) => `- ${a}`).join("\n")}` : "",
            t.depSummaries.length > 0 ? `Done before this task:\n${t.depSummaries.map((d) => `- ${d}`).join("\n")}` : "",
            t.handoff ? `Handoff:\n${t.handoff}` : "",
            t.notes.length > 0 ? `Notes:\n${t.notes.map((n) => `- ${n}`).join("\n")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          800,
        )
      : "No task assigned yet.";
    const summary = input.summary ? `\n\nSummary of earlier steps:\n${input.summary}` : "";

    const messages: ChatMessage[] = [
      { role: "user", content: memory ? `${brief}\n\n${memory}` : brief, cacheBreakpoint: true },
      { role: "user", content: `${taskText}${summary}`, cacheBreakpoint: true },
      ...stepMessages(input.steps),
    ];

    const tokens = {
      charter: MESSAGE_OVERHEAD + est(system),
      tools: toolsTokens(input.tools, est),
      brief: est(brief),
      memory: est(memory),
      task: est(taskText),
      summary: est(summary),
      recent: messages.slice(2).reduce((n, m) => n + messageTokens(m, est), 0),
    };
    const estimatedTokens = messages.reduce((n, m) => n + messageTokens(m, est), 0) + tokens.charter + tokens.tools + REPLY_PRIMING;
    const layers: Array<{ layer: ContextLayer; tokens: number; cached: boolean }> = [
      { layer: "charter", tokens: tokens.charter, cached: true },
      { layer: "tools", tokens: tokens.tools, cached: true },
      { layer: "brief", tokens: tokens.brief, cached: true },
      { layer: "memory", tokens: tokens.memory, cached: true },
      { layer: "task", tokens: tokens.task, cached: true },
      { layer: "summary", tokens: tokens.summary, cached: true },
      { layer: "recent", tokens: tokens.recent, cached: false },
    ];
    const cacheKey = new Bun.CryptoHasher("sha256").update(`${input.role}:${input.runId}`).digest("hex").slice(0, 32);
    return {
      request: { system, messages, tools: input.tools, cacheSystem: true, cacheKey },
      xray: {
        agentId: input.agentId,
        taskId: input.taskId,
        model: input.model,
        budget: input.budgetTokens,
        layers,
        totalTokens: estimatedTokens,
        compactions: 0,
        lastCachedTokens: 0,
        createdAt: 0,
      },
      estimatedTokens,
      needsCompaction: estimatedTokens > input.budgetTokens && input.steps.length > 2,
    };
  };

  return {
    charter,
    build,
    async compact(input) {
      const foldCount = Math.max(0, input.steps.length - Math.max(0, input.keepRecent));
      const folded = input.steps.slice(0, foldCount);
      const kept = input.steps.slice(foldCount);
      const tokensBefore = est(serializeSteps(input.steps)) + est(input.summary ?? "");
      const lines = folded.map((s) => {
        const tools = s.results.map((r) => `${r.tool} ${r.ok ? "ok" : "failed"}: ${firstLine(r.output, 80)}`).join("; ");
        return `- ${firstLine(s.assistant.text, 120)}${tools ? ` | ${tools}` : ""}`;
      });
      let extractive = [input.summary, ...lines].filter(Boolean).join("\n");
      if (extractive.length > SUMMARY_MAX_CHARS) extractive = extractive.slice(extractive.length - SUMMARY_MAX_CHARS);
      let summary = extractive;
      if (input.summarize) {
        try {
          summary = (await input.summarize(serializeSteps(folded))) || extractive;
        } catch {
          summary = extractive;
        }
      }
      const tokensAfter = est(serializeSteps(kept)) + est(summary);
      return { summary, steps: kept, tokensBefore, tokensAfter };
    },
    estimateTokens: (text) => est(text),
    calibrate() {},
    truncateOutput,
  };
}
