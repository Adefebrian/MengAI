// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Loop engineering for one task: work, verify, self-critique, fix. Pure, no
// I/O, so every rule is unit-testable on its own.
//   EvidenceLog   what the task really did, collected step by step (compaction
//                 never loses it): files changed, checks run and their exit codes
//   precheck      rule verdicts when the evidence is conclusive (no model call)
//   packet        the evidence-first input of the fast-tier critic when it is not
//   StepBudget    the per-task step budget: sized from the task, grows while the
//                 cat makes progress, shrinks when it stops making progress
import type { StepRecord } from "../../core/services";
import { clip, redact } from "../../lib/redact";
import { LIMITS, stableArgs } from "./policy";

export const REFLEXION = {
  /** revise verdicts per task; the finish after the last one is accepted with the open point noted */
  maxExtraRounds: 2,
  /** output cap of the critic call */
  outputTokens: 150,
  /** steps granted for each extra round */
  roundSteps: 3,
  files: 12,
  checks: 6,
  errors: 4,
  acceptance: 5,
  acceptanceChars: 140,
  summaryChars: 400,
  commandChars: 100,
  critiqueChars: 280,
  packetChars: 1800,
} as const;

/** System prompt of the critic call (the demo crew answers it by exact match). */
export const REFLEXION_SYSTEM = [
  "You are the self-critic of an AI crew member that is about to finish a task. Judge only from the evidence: the files it changed, the checks it ran with their exit codes, and its own summary.",
  "pass: the evidence shows every acceptance criterion is met, or the task needs no check.",
  "revise: a criterion is not shown by the evidence, a change that needs a check was never checked, or the summary claims something the evidence does not show. Name the single most important gap as one concrete next step.",
  'Reply with JSON only: {"verdict":"pass"|"revise","critique":"at most 40 words"}',
].join("\n");

const CHANGE_TOOLS: ReadonlySet<string> = new Set(["fs_write", "fs_edit", "fs_delete", "generate_image", "generate_video"]);

export interface CheckRun {
  command: string;
  /** "exit 0", "exit 1", "timed out", "stopped", "killed by SIGTERM" */
  status: string;
  exit: number | null;
  ok: boolean;
  /** ran after the last successful file change */
  afterChange: boolean;
}

export interface Evidence {
  files: string[];
  checks: CheckRun[];
  /** failed writes or checks never followed by a success of the same target */
  openErrors: string[];
  changed: boolean;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
/** multi-line cap that keeps line breaks (clip collapses them) */
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text);
const firstLine = (text: string, max = 120) => clip((text.split("\n", 1)[0] ?? "").trim(), max);

/** "exit 3 in 0.4s ..." -> exit 3; the tools service writes the status first. */
export function shellStatus(output: string, ok: boolean): { status: string; exit: number | null } {
  const head = output.trimStart();
  const exit = /^exit (-?\d+)/.exec(head);
  if (exit) return { status: `exit ${exit[1]}`, exit: Number(exit[1]) };
  if (/^timed out/.test(head)) return { status: "timed out", exit: null };
  if (/^stopped/.test(head)) return { status: "stopped", exit: null };
  const killed = /^killed by (\S+)/.exec(head);
  if (killed) return { status: `killed by ${killed[1]}`, exit: null };
  return { status: ok ? "exit 0" : "failed", exit: ok ? 0 : null };
}

/** Evidence of one task, recorded as each step lands. */
export class EvidenceLog {
  private readonly files: string[] = [];
  private readonly checks: Array<Omit<CheckRun, "afterChange"> & { at: number }> = [];
  private readonly errors = new Map<string, string>();
  private lastChangeAt = -1;
  private n = 0;

  private addFile(path: string): void {
    const p = clip(path, 160);
    if (!this.files.includes(p)) this.files.push(p);
  }

  record(step: StepRecord): void {
    for (const call of step.assistant.toolCalls) {
      const r = step.results.find((x) => x.callId === call.id);
      if (!r) continue;
      const at = this.n++;
      const args = parseArgs(call.arguments);
      if (CHANGE_TOOLS.has(call.name)) {
        const target = str(args.path) ?? str(args.out) ?? call.name;
        const key = `write:${target}`;
        if (r.ok) {
          this.addFile(call.name === "fs_delete" ? `${target} (deleted)` : target);
          this.lastChangeAt = at;
          this.errors.delete(key);
        } else this.errors.set(key, `${call.name} ${clip(target, 80)}: ${firstLine(r.output)}`);
      } else if (call.name === "shell_run") {
        const command = str(args.command) ?? "";
        const { status, exit } = shellStatus(r.output, r.ok);
        this.checks.push({ command: clip(command, REFLEXION.commandChars), status, exit, ok: r.ok, at });
        const key = `shell:${command}`;
        if (r.ok) this.errors.delete(key);
        else this.errors.set(key, `${clip(command, 80)}: ${status}`);
      }
    }
  }

  /** files the cat names in its finish call */
  declare(files: readonly string[]): void {
    for (const f of files) if (typeof f === "string" && f.trim()) this.addFile(f.trim());
  }

  snapshot(): Evidence {
    return {
      files: this.files.slice(0, REFLEXION.files),
      checks: this.checks.slice(-REFLEXION.checks).map(({ at, ...c }) => ({ ...c, afterChange: at > this.lastChangeAt })),
      openErrors: [...this.errors.values()].slice(-REFLEXION.errors),
      changed: this.lastChangeAt >= 0,
    };
  }
}

export interface Verdict {
  verdict: "pass" | "revise";
  critique: string;
}

/**
 * Rule verdicts on conclusive evidence (JEV be.reflexion_gating):
 *   the last check after the last change failed          -> revise
 *   checks ran after the last change and all passed,
 *   with no open error                                     -> pass
 * Anything else is ambiguous and goes to the critic (null).
 */
export function precheck(ev: Evidence): Verdict | null {
  const relevant = ev.changed ? ev.checks.filter((c) => c.afterChange) : ev.checks;
  const last = relevant[relevant.length - 1];
  if (last && !last.ok) {
    return {
      verdict: "revise",
      critique: `The last check failed: ${clip(last.command, 80)} (${last.status}). Fix the cause and run it again, or finish with blocked true and the reason.`,
    };
  }
  if (relevant.length > 0 && ev.openErrors.length === 0) {
    return { verdict: "pass", critique: `${relevant.length} check${relevant.length === 1 ? "" : "s"} passed${ev.changed ? " after the last change" : ""}.` };
  }
  return null;
}

/** Evidence first, then the claim: the critic's whole input, capped near 450 tokens. */
export function reflexionPacket(i: { title: string; acceptance: readonly string[]; summary: string; evidence: Evidence; check: number }): string {
  const ev = i.evidence;
  const lines = [`Task: ${clip(i.title, 160)}`];
  const acc = i.acceptance.slice(0, REFLEXION.acceptance).map((a) => `- ${clip(a, REFLEXION.acceptanceChars)}`);
  lines.push(acc.length ? `Acceptance:\n${acc.join("\n")}` : "Acceptance: none given");
  lines.push(ev.files.length ? `Files changed (${ev.files.length}): ${ev.files.join(", ")}` : "Files changed: none");
  lines.push(
    ev.checks.length
      ? `Checks run, oldest first:\n${ev.checks.map((c) => `- ${c.command || "(no command)"} -> ${c.status}${ev.changed ? (c.afterChange ? ", after the last change" : ", before the last change") : ""}`).join("\n")}`
      : "Checks run: none",
  );
  if (ev.openErrors.length) lines.push(`Unresolved errors:\n${ev.openErrors.map((e) => `- ${e}`).join("\n")}`);
  lines.push(`Its finish summary: ${clip(i.summary.replace(/\s+/g, " "), REFLEXION.summaryChars)}`);
  lines.push(`Self-check ${i.check} of ${REFLEXION.maxExtraRounds + 1}.`);
  return cut(redact(lines.join("\n")), REFLEXION.packetChars);
}

/** The critic's reply; null when it is not a usable verdict (JEV failure_policy: the finish passes). */
export function parseReflexion(text: string): Verdict | null {
  const raw = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as { verdict?: unknown; critique?: unknown };
  const verdict = typeof o.verdict === "string" ? o.verdict.trim().toLowerCase() : "";
  if (verdict !== "pass" && verdict !== "revise") return null;
  const critique = typeof o.critique === "string" ? clip(o.critique.replace(/\s+/g, " ").trim(), REFLEXION.critiqueChars) : "";
  if (verdict === "revise" && critique.length < 4) return null;
  return { verdict, critique };
}

// ----------------------------------------------------------- step budget
export const STEPS = {
  /** the hard ceiling of any task, however it grows */
  hardCap: LIMITS.maxStepsPerTask,
  min: 6,
  base: 8,
  perAcceptance: 2,
  acceptanceCounted: 4,
  plan: 10,
  final: 6,
  review: 10,
  /** growth when the budget is reached while the cat is making progress */
  grow: 4,
  /** the last `window` steps decide growth: at least `growNeed` of them made progress */
  window: 3,
  growNeed: 2,
  /** this many steps in a row without progress shrink the budget to the steps used + `slack` */
  shrinkAfter: 2,
  slack: 3,
} as const;

export type BudgetKind = "plan" | "final" | "work" | "review" | "fix" | "handoff";

/** Initial budget from the task's size: kind, acceptance criteria and spec length. */
export function initialSteps(kind: BudgetKind, acceptance: number, specChars: number): number {
  let n: number;
  if (kind === "plan") n = STEPS.plan;
  else if (kind === "final") n = STEPS.final;
  else if (kind === "review") n = STEPS.review;
  else n = STEPS.base + STEPS.perAcceptance * Math.min(acceptance, STEPS.acceptanceCounted) + (specChars > 600 ? 4 : specChars > 200 ? 2 : 0);
  return Math.max(STEPS.min, Math.min(STEPS.hardCap, n));
}

/**
 * A step makes progress when at least one call succeeded with arguments
 * this task has not used yet, or with an output that differs from the last
 * time (a rerun test that now says something new). Text-only steps, failed
 * steps and exact repeats do not.
 */
export class StepBudget {
  limit: number;
  private readonly last = new Map<string, string>();
  private readonly history: boolean[] = [];
  private dry = 0;

  constructor(initial: number, readonly hardCap: number = STEPS.hardCap) {
    this.limit = Math.max(1, Math.min(hardCap, Math.floor(initial)));
  }

  get used(): number {
    return this.history.length;
  }

  /** Records one step, adapts the budget, returns whether the step made progress. */
  record(step: StepRecord): boolean {
    let progress = false;
    for (const call of step.assistant.toolCalls) {
      const r = step.results.find((x) => x.callId === call.id);
      if (!r || !r.ok) continue;
      const key = `${call.name}\u0000${stableArgs(call.arguments)}`;
      const out = r.output.trim().slice(0, 2000);
      if (this.last.get(key) !== out) progress = true;
      this.last.set(key, out);
    }
    this.history.push(progress);
    if (progress) this.dry = 0;
    else if (++this.dry >= STEPS.shrinkAfter) {
      // shrink once to a few steps past now; later dry steps never raise it again
      const cap = this.used + STEPS.slack;
      if (cap < this.limit) this.limit = Math.max(this.used + 1, cap);
    }
    return progress;
  }

  /** extra steps for a reflexion round, never past the hard cap */
  extend(n: number): void {
    this.limit = Math.min(this.hardCap, Math.max(this.limit, this.used + n));
  }

  /** true when the task may take another step; grows at the limit while the cat makes progress */
  allows(): boolean {
    if (this.used < this.limit) return true;
    if (this.limit >= this.hardCap) return false;
    const recent = this.history.slice(-STEPS.window).filter(Boolean).length;
    if (recent < STEPS.growNeed) return false;
    this.limit = Math.min(this.hardCap, this.limit + STEPS.grow);
    return this.used < this.limit;
  }

  /** the reason a task stops at its budget */
  reason(): string {
    return this.limit >= this.hardCap ? `step limit reached (${this.hardCap} steps)` : `step budget reached (${this.limit} steps without enough progress)`;
  }
}
