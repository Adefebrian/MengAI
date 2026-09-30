// The run tracker model, like a delivery tracker: the company kind's stages
// in order (COMPANY_STAGES), where the run is now, which stages are done,
// and every time a failed check sent the run back (a run.stage move to an
// earlier stage). The stage comes from run.stage events, or the snapshot's
// stage; a run from an older server without either is placed from its
// tasks and crew, so the tracker never shows an empty track. Pure, so the
// live page, the replay scrubber and the tests read the same model. The
// DeliveryTracker props come from it too: the stops with the reason of the
// move into each, the open loop, and the short token estimate.
import { COMPANY_STAGE_LABEL, COMPANY_STAGES, type CompanyKind, type RunDTO } from "@mengai/shared";
import type { RunState, StageMove } from "../../store/runStore";
import { crewOrder, tokensUsed } from "../../store/runStore";
import { fmtInt } from "../format";
import { isFinished } from "../status";
import { clip, companyNow, leadOf } from "./office";

export type StageState = "done" | "active" | "todo" | "returned";

export interface TrackerStage {
  key: string;
  label: string;
  state: StageState;
}

export type TrackerOutcome = "running" | "queued" | "paused" | "stopping" | "done" | "failed" | "stopped";

export interface TrackerModel {
  company: CompanyKind;
  stages: TrackerStage[];
  /** 0-based index of the stage the run is on */
  index: number;
  /** times a check sent the run back to an earlier stage */
  loops: number;
  /** the latest move back, while the run has not passed that stage again */
  sentBack: StageMove | null;
  /** the latest move back, open or closed */
  lastBack: StageMove | null;
  outcome: TrackerOutcome;
}

export const COMPANY_WORD: Record<CompanyKind, string> = { studio: "Software studio", fund: "Hedge fund" };

export function companyOf(run: RunDTO | null | undefined): CompanyKind {
  return run?.company === "fund" ? "fund" : "studio";
}

/** A stage label with the CEO's real name in place of the default one. */
export function stageLabel(key: string, ceo: string): string {
  const label = COMPANY_STAGE_LABEL[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return ceo && ceo !== "Oyen" ? label.replace(/\bOyen\b/, ceo) : label;
}

/**
 * Where a run without tracker events is, from its tasks and crew. Studio
 * indexes map one to one onto the fund stages (thesis for goal, research
 * for planning, and so on), so both kinds read the same way.
 */
export function derivedIndex(s: RunState): number {
  const run = s.run;
  if (!run) return 0;
  if (run.status === "done") return 6;
  const tasks = s.taskOrder.map((id) => s.tasks[id]).filter((t) => !!t && t.status !== "cancelled");
  if (tasks.length === 0) return 0;
  const crew = s.agentOrder.map((id) => s.agents[id]).filter((a) => !!a && a.role !== "lead");
  if (crew.length === 0) return 1;
  const running = tasks.filter((t) => t!.status === "running");
  if (tasks.some((t) => t!.status === "review") || running.some((t) => t!.role === "reviewer")) return 4;
  if (running.some((t) => t!.role === "qa")) return 5;
  if (running.length > 0 || tasks.some((t) => t!.status === "done")) return 3;
  return 2;
}

function outcomeOf(run: RunDTO | null): TrackerOutcome {
  return (run?.status ?? "queued") as TrackerOutcome;
}

export function trackerModel(s: RunState): TrackerModel {
  const company = companyOf(s.run);
  const keys = COMPANY_STAGES[company];
  const ceo = leadOf(s)?.name ?? "Oyen";
  const outcome = outcomeOf(s.run);
  let index = s.stage ? keys.indexOf(s.stage) : -1;
  if (index < 0) index = derivedIndex(s);
  if (outcome === "done") index = keys.length - 1;
  index = Math.max(0, Math.min(keys.length - 1, index));

  let loops = 0;
  let sentBack: StageMove | null = null;
  let lastBack: StageMove | null = null;
  for (const m of s.stageMoves) {
    const from = m.previous ? keys.indexOf(m.previous) : -1;
    const to = keys.indexOf(m.stage);
    if (from >= 0 && to >= 0 && to < from) {
      loops += 1;
      sentBack = m;
      lastBack = m;
    } else if (sentBack && to >= keys.indexOf(sentBack.previous ?? "")) {
      // the run passed the stage that sent it back: the loop is closed
      sentBack = null;
    }
  }
  // An older server sends no moves: a review round that bounced a task is the same loop.
  if (s.stageMoves.length === 0) {
    const rounds = Object.values(s.rounds);
    loops = rounds.length ? Math.max(0, Math.max(...rounds) - 1) : 0;
  }
  const backFrom = sentBack?.previous ? keys.indexOf(sentBack.previous) : -1;

  const stages: TrackerStage[] = keys.map((key, i) => {
    let state: StageState = i < index ? "done" : i === index ? "active" : "todo";
    if (outcome === "done") state = "done";
    if (state === "todo" && i === backFrom) state = "returned";
    return { key, label: stageLabel(key, ceo), state };
  });
  return { company, stages, index, loops, sentBack, lastBack, outcome };
}

/** The label of the stage the run is on, with its round when a check sent it back. */
export function activeLabel(m: TrackerModel): string {
  const stage = m.stages[m.index]!;
  if (m.outcome === "done") return stage.label;
  if (m.outcome === "failed") return `${stage.label}, failed`;
  if (m.outcome === "stopped") return `${stage.label}, stopped`;
  if (m.outcome === "paused") return `${stage.label}, paused`;
  const inLoop = m.loops > 0 && (m.sentBack !== null || stage.key === m.lastBack?.previous);
  return inLoop ? `${stage.label}, round ${m.loops + 1}` : stage.label;
}

/** The one cat-voice line beside the tracker: a fresh loop back names its reason, else what the company is doing. */
export function trackerLine(s: RunState, m: TrackerModel, now: number): string {
  const back = m.sentBack;
  if (back && !isFinished(s.run?.status) && now - back.ts <= 20_000 && back.reason) {
    const from = m.stages.find((st) => st.key === back.previous)?.label ?? "The check";
    return `${from} sent the work back: ${clip(back.reason, 90)}`;
  }
  return companyNow(s);
}

export interface TokensToGo {
  /** the figure, "42,000" */
  value: string | null;
  /** the same figure as a number, for the short form */
  amount: number | null;
  /** true when the figure is an estimate (a live run), false for the final count */
  estimate: boolean;
  /** the words after it */
  text: string;
  /** the budget picture for the tooltip and assistive tech */
  detail: string;
}

/**
 * The tokens a live run still needs, from what it spent for the share of
 * tasks done (rounded to the nearest thousand, capped by the budget left),
 * and the budget left beside it.
 */
export function tokensToGo(run: RunDTO): TokensToGo {
  const used = tokensUsed(run.usage);
  const budget = run.budgetTokens;
  const left = budget > 0 ? Math.max(0, budget - used) : null;
  const detail = left === null ? `${fmtInt(used)} tokens used, no token cap on this run` : `${fmtInt(used)} of ${fmtInt(budget)} tokens used, ${fmtInt(left)} left in the budget`;
  if (isFinished(run.status)) return { value: fmtInt(used), amount: used, estimate: false, text: "tokens used", detail };
  const p = run.progress;
  if (!(p >= 0.05) || used <= 0) return { value: null, amount: null, estimate: true, text: "Estimating tokens to go", detail };
  let rest = (used * (1 - p)) / p;
  if (left !== null) rest = Math.min(rest, left);
  rest = Math.round(rest / 1000) * 1000;
  if (rest <= 0) return { value: null, amount: null, estimate: true, text: "Almost there", detail };
  return { value: fmtInt(rest), amount: rest, estimate: true, text: "tokens to go", detail };
}

/** A token count in a few characters: 950, 42k, 1.3M. */
export function compactTokens(n: number): string {
  const v = Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${Math.round(v / 1000)}k`;
  const m = v / 1_000_000;
  return `${m < 10 ? Math.round(m * 10) / 10 : Math.round(m)}M`;
}

/** The courier's estimate, short enough for the driver line: "82k tokens to go", "184k tokens used", "Estimating". */
export function etaShort(run: RunDTO): string {
  const t = tokensToGo(run);
  if (t.amount === null) return t.text === "Almost there" ? t.text : "Estimating";
  return `${compactTokens(t.amount)} ${t.text}`;
}

/**
 * The stops of the DeliveryTracker: one per stage of the company kind,
 * each with the real reason of the latest run.stage move into it (what the
 * courier reads when the stop is tapped). The stop the run is at carries
 * no detail while its own line is the status.
 */
export function deliveryStages(s: RunState, m: TrackerModel): Array<{ id: string; label: string; detail: string | null }> {
  const reason: Record<string, string> = {};
  for (const mv of s.stageMoves) if (mv.reason) reason[mv.stage] = clip(mv.reason, 120);
  return m.stages.map((st) => ({ id: st.key, label: st.label, detail: reason[st.key] ?? null }));
}

/** True while a check has sent the run back and it has not passed that stage again. */
export function deliveryLooping(m: TrackerModel): boolean {
  return m.sentBack !== null && m.outcome === "running";
}

/** How many cats are on the crew right now (departed cats excluded). */
export function crewSize(s: RunState): number {
  return crewOrder(s).length;
}
