// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Tracker stages per company kind. The engine reports its studio beats (goal,
// planned, hired, working with the task that started, review, testing,
// shipped); a template maps them onto its own stages. The fund tracker moves
// forward only: thesis, research, backtest, risk_review, paper_trade,
// live_trade, report. Pure, no I/O.
import { COMPANY_STAGES, type AgentRole, type CompanyKind, type RunStage, type RunStatus, type TaskStatus } from "@mengai/shared";

export interface StageTask {
  title: string;
  /** the dynamic role key, or the base role */
  roleKey: string;
  archetype: AgentRole;
  /** plan, final, work, review, fix or handoff */
  kind: string;
}

export interface StageBoardTask extends StageTask {
  status: TaskStatus;
}

const rank = (kind: CompanyKind, stage: string): number => COMPANY_STAGES[kind].indexOf(stage);

/** The fund stage a task works on, from its role and title; null when it does not move the tracker (compliance, reviews). */
export function fundStageForTask(t: StageTask): string | null {
  if (t.kind === "final") return "report";
  if (t.kind === "plan") return "thesis";
  const text = `${t.title} ${t.roleKey}`.toLowerCase();
  if (/\blive\b/.test(text)) return "live_trade";
  if (/\bpaper\b/.test(text) || t.roleKey === "trader") return "paper_trade";
  if (/backtest/.test(text)) return "backtest";
  if (t.roleKey === "risk-manager" || /\brisk\b/.test(text)) return "risk_review";
  if (/\bthesis\b/.test(text)) return "thesis";
  if (t.roleKey === "compliance-officer" || /compliance/.test(text)) return null;
  if (t.roleKey === "data-engineer" || t.roleKey === "quant-researcher" || /\b(data|research|prices?|history)\b/.test(text)) return "research";
  return null;
}

/** The stage an engine beat moves a run of this kind to; null keeps the tracker where it is. */
export function mapStage(kind: CompanyKind, beat: RunStage, task: StageTask | null): string | null {
  if (kind === "studio") return beat;
  switch (beat) {
    case "goal":
      return "thesis";
    case "working":
      return task ? fundStageForTask(task) : null;
    case "shipped":
      return "report";
    default:
      return null;
  }
}

/** Studio: forward, or back to working after a failed review. Fund: forward only. The last stage is final. */
export function stageMoves(kind: CompanyKind, current: string | null, next: string, loopBack = false): boolean {
  const stages = COMPANY_STAGES[kind];
  const to = rank(kind, next);
  if (to < 0 || current === next) return false;
  if (current === null) return true;
  const from = rank(kind, current);
  if (from === stages.length - 1) return false;
  if (loopBack) return kind === "studio" && next === "working" && from > rank(kind, "working");
  return to > from;
}

/** The furthest fund stage a board reached (a restart, or a run that is not live). */
export function fundBoardStage(tasks: readonly StageBoardTask[], status: RunStatus): string {
  if (status === "done") return "report";
  let best = 0;
  for (const t of tasks) {
    if (t.status === "queued" || t.status === "ready" || t.status === "cancelled") continue;
    const s = fundStageForTask(t);
    if (s) best = Math.max(best, rank("fund", s));
  }
  return COMPANY_STAGES.fund[best]!;
}
