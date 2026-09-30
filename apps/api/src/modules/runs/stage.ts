// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The run tracker: goal, planned, hired, working, review, testing, shipped.
// The engine publishes run.stage whenever the run moves forward on it, and
// loops back to working when a review fails. Pure, no I/O.
import { RUN_STAGES, type AgentRole, type RunStage, type RunStatus, type TaskStatus } from "@mengai/shared";

export const STAGE_RANK: Record<RunStage, number> = Object.fromEntries(RUN_STAGES.map((s, i) => [s, i])) as Record<RunStage, number>;

/** Whether the tracker moves from `current` to `next`: forward only, or back to working after a failed review. */
export function stageMoves(current: RunStage | null, next: RunStage, loopBack = false): boolean {
  if (current === next) return false;
  if (current === null) return true;
  if (current === "shipped") return false;
  if (loopBack) return next === "working" && STAGE_RANK[current] > STAGE_RANK.working;
  return STAGE_RANK[next] > STAGE_RANK[current];
}

export interface BoardTask {
  role: AgentRole;
  status: TaskStatus;
  /** plan, final, work, review, fix or handoff */
  kind: string;
}

/** The stage a board shows (a restart, or a run that is not live): the furthest point it reached. */
export function stageFromBoard(tasks: readonly BoardTask[], status: RunStatus, crew: number): RunStage {
  if (status === "done") return "shipped";
  const crewWork = tasks.filter((t) => t.role !== "lead" && t.kind !== "review");
  const started = (t: BoardTask) => t.status !== "queued" && t.status !== "ready" && t.status !== "cancelled";
  if (crewWork.some((t) => t.role === "qa" && started(t))) return "testing";
  if (tasks.some((t) => t.kind === "review") || crewWork.some((t) => t.status === "review")) return "review";
  if (crewWork.some(started)) return "working";
  if (crew > 1) return "hired";
  if (crewWork.length > 0) return "planned";
  return "goal";
}
