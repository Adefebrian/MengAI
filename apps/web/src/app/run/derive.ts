// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Pure views over a RunState for the run screen: the crew in its groups,
// the floor (each task card in its cat's lane and status column), and
// usage per cat from the call log. No React here, so the replay and the tests
// read the same shapes the board draws.
import type { AgentDTO, AgentRole, LlmCallDTO, TaskDTO, TaskStatus } from "@mengai/shared";
import type { RunState } from "../../store/runStore";
import { crewOrder } from "../../store/runStore";

export type CrewGroupId = "lead" | "makers" | "checkers";

export const CREW_GROUP_LABEL: Record<CrewGroupId, string> = {
  lead: "Lead",
  makers: "Makers",
  checkers: "Checkers",
};

const GROUP_OF: Record<AgentRole, CrewGroupId> = {
  lead: "lead",
  engineer: "makers",
  designer: "makers",
  researcher: "makers",
  operator: "makers",
  reviewer: "checkers",
  qa: "checkers",
  security: "checkers",
};

export interface CrewGroup {
  id: CrewGroupId;
  label: string;
  agents: AgentDTO[];
}

/** The lead first, then the cats that make things, then the cats that check them. */
export function crewGroups(state: RunState): CrewGroup[] {
  const order = crewOrder(state);
  const ids: CrewGroupId[] = ["lead", "makers", "checkers"];
  return ids
    .map((id) => ({ id, label: CREW_GROUP_LABEL[id], agents: order.filter((a) => GROUP_OF[a.role] === id) }))
    .filter((g) => g.agents.length > 0);
}

export function taskCounts(state: RunState): { done: number; total: number; review: number; blocked: number } {
  let done = 0;
  let total = 0;
  let review = 0;
  let blocked = 0;
  for (const id of state.taskOrder) {
    const t = state.tasks[id];
    if (!t || t.status === "cancelled") continue;
    // A review task rides under the task it reviews; the count is the work.
    if (t.role === "reviewer" && t.parentId && state.tasks[t.parentId]) continue;
    total += 1;
    if (t.status === "done") done += 1;
    if (t.status === "review") review += 1;
    if (t.status === "blocked") blocked += 1;
  }
  return { done, total, review, blocked };
}

export interface AgentSpend {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  calls: number;
}

/** Usage per cat, summed from the call log (the stream carries run totals only). */
export function spendByAgent(calls: readonly LlmCallDTO[]): Record<string, AgentSpend> {
  const out: Record<string, AgentSpend> = {};
  for (const c of calls) {
    if (!c.agentId) continue;
    const s = (out[c.agentId] ??= { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, calls: 0 });
    s.inputTokens += c.inputTokens;
    s.outputTokens += c.outputTokens;
    s.cachedTokens += c.cachedTokens;
    s.costUsd += c.costUsd;
    s.calls += 1;
  }
  return out;
}

export interface ModelSpend extends AgentSpend {
  model: string;
}

export function spendByModel(calls: readonly LlmCallDTO[]): ModelSpend[] {
  const map = new Map<string, ModelSpend>();
  for (const c of calls) {
    const s = map.get(c.model) ?? { model: c.model, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, calls: 0 };
    s.inputTokens += c.inputTokens;
    s.outputTokens += c.outputTokens;
    s.cachedTokens += c.cachedTokens;
    s.costUsd += c.costUsd;
    s.calls += 1;
    map.set(c.model, s);
  }
  return [...map.values()].sort((a, b) => b.inputTokens - a.inputTokens);
}

/** Energy is the share of the run budget a cat has used, 0..1. */
export function energyOf(spend: AgentSpend | undefined, budgetTokens: number): number {
  if (!spend || budgetTokens <= 0) return 0;
  return Math.max(0, Math.min(1, (spend.inputTokens + spend.outputTokens) / budgetTokens));
}

/** Pending approvals that belong to this run. */
export function runApprovals(state: RunState) {
  return state.approvalOrder.map((id) => state.approvals[id]).filter((a) => !!a && a.status === "pending");
}

/** Every changed file, newest first. */
export function changedFiles(state: RunState): Array<{ path: string; op: "create" | "update" | "delete"; bytes: number; ts: number }> {
  return Object.entries(state.files)
    .map(([path, f]) => ({ path, ...f }))
    .sort((a, b) => b.ts - a.ts);
}

// ------------------------------------------------------------ the floor

/**
 * The run floor is an ethogram: one lane per cat, and in each lane the task
 * cards it owns sit in the column of their status. A status change moves a
 * card across; a handoff or a review bounce moves it to another cat's lane.
 */
export type LaneColumn = "planned" | "working" | "review" | "done";

export const LANE_COLUMNS: readonly LaneColumn[] = ["planned", "working", "review", "done"];

export const LANE_COLUMN_LABEL: Record<LaneColumn, string> = {
  planned: "Planned",
  working: "Working",
  review: "In review",
  done: "Done",
};

export function columnOf(status: TaskStatus): LaneColumn {
  switch (status) {
    case "running":
      return "working";
    case "review":
      return "review";
    case "done":
    case "failed":
    case "cancelled":
      return "done";
    default:
      return "planned";
  }
}

/** The cat whose lane shows the card: its holder, else its assignee, else its planner, else the lead. */
export function laneOf(state: RunState, task: TaskDTO): string | null {
  const id = state.holders[task.id] ?? task.assigneeId ?? task.createdBy;
  if (id && state.agents[id]) return id;
  const crew = crewOrder(state);
  return (crew.find((a) => a.role === "lead") ?? crew[0])?.id ?? null;
}

export type LaneCells = Record<LaneColumn, TaskDTO[]>;

const emptyCells = (): LaneCells => ({ planned: [], working: [], review: [], done: [] });

export interface Floor {
  lanes: Record<string, LaneCells>;
  counts: Record<LaneColumn, number>;
}

/** Every task card placed in its lane and column, in plan order. */
export function floorOf(state: RunState): Floor {
  const lanes: Record<string, LaneCells> = {};
  const counts: Record<LaneColumn, number> = { planned: 0, working: 0, review: 0, done: 0 };
  for (const id of state.agentOrder) lanes[id] = emptyCells();
  for (const id of state.taskOrder) {
    const t = state.tasks[id];
    if (!t) continue;
    const lane = laneOf(state, t);
    if (!lane) continue;
    const col = columnOf(t.status);
    (lanes[lane] ??= emptyCells())[col].push(t);
    counts[col] += 1;
  }
  return { lanes, counts };
}

/** A short name for a dependency chip: the title up to its first comma or 32 characters. */
export function shortTitle(title: string, max = 32): string {
  const cut = title.split(/[,:]/)[0]!.trim();
  return cut.length <= max ? cut : `${cut.slice(0, max - 1).trimEnd()}…`;
}
