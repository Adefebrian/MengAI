// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The island's dynamic progress, pure: the ring, the ear's rotation and
// the tuck. See docs/superpowers/specs/2026-10-01-island-moments-design.md
// sections 6 and 7.
//
//   ring      two adjacent arcs on one circle, never stacked: the done share
//             (solid) from the top, then the in-flight share (the tasks a cat
//             is on now, drawn at 45% ink) right after it; together never
//             past the whole. The tone says the state at a glance; at the
//             end of a run the ring closes, green at a ship and red at a
//             failure, so neither ever reads as an empty track on black.
//   ear       while collapsed the ear cycles every EAR_CYCLE_MS through what
//             is true now: the stage ("Review 5 of 7"), who works ("Kopi
//             coding"), what is left ("3 tasks left"). Each item names the
//             cat the band's mini cat switches to, or null for the lead.
//   tuck      a live run with no news for TUCK_MS folds into the notch; any
//             news brings it out, and once out it stays at least
//             UNTUCK_MIN_MS. newsKey is what counts as news.
import type { Activity } from "@mengai/shared";
import type { IslandModel, MiniCat } from "./live";

export type RingTone = "run" | "wait" | "paused" | "low" | "failed" | "shipped";

export interface Ring {
  /** 0..1, the done share, drawn from the top */
  done: number;
  /** 0..1, the running tasks' share, drawn right after `done`; done + inFlight <= 1 */
  inFlight: number;
  tone: RingTone;
}

/** The ear rotates this often while collapsed. */
export const EAR_CYCLE_MS = 6000;
/** Cats the ear names before it moves on to what is left. */
export const EAR_WHO_MAX = 3;
/** A live run with no news this long tucks into the notch. */
export const TUCK_MS = 20_000;
/** Once out of the tuck, the island stays out at least this long. */
export const UNTUCK_MIN_MS = 8000;

function unit(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

/**
 * The ring for the model. Precedence: a failure, a ship, an ask that waits
 * on you, a paused or stopping run, a low budget, else running. A finished
 * run closes the ring in its tone (--island-danger at a failure,
 * --island-success at a ship): a failure drawn as an empty track would be
 * dark on black next to "Failed".
 */
export function ringOf(model: IslandModel): Ring {
  const f = model.finish;
  if (f?.kind === "failed") return { done: 1, inFlight: 0, tone: "failed" };
  if (f?.kind === "shipped") return { done: 1, inFlight: 0, tone: "shipped" };
  const a = model.active;
  if (!a) return { done: 0, inFlight: 0, tone: "paused" };
  const done = unit(a.progress);
  const share = a.taskCount > 0 ? a.runningCount / a.taskCount : 0;
  const inFlight = Math.min(1 - done, unit(share));
  let tone: RingTone = "run";
  if (model.asks.length > 0) tone = "wait";
  else if (a.status === "paused" || a.status === "stopping") tone = "paused";
  else if (a.budgetLow) tone = "low";
  return { done, inFlight, tone };
}

export interface EarItem {
  kind: "stage" | "who" | "left";
  /** the longest form; `texts` holds it and the shorter ones, longest first, for machine.fitText */
  text: string;
  texts: string[];
  /** the cat the band shows while this item is up; null keeps the lead */
  cat: MiniCat | null;
}

/** A few words for what a cat does, after its name in the ear. */
const EAR_VERB: Record<Activity, string> = {
  rest: "resting",
  think: "thinking",
  plan: "planning",
  code: "coding",
  run: "running",
  read: "reading",
  review: "reviewing",
  research: "researching",
  design: "designing",
  scan: "scanning",
  automate: "on a runbook",
  handoff: "handing off",
  ask: "needs you",
  wait: "waiting",
  celebrate: "done",
};

function item(kind: EarItem["kind"], texts: string[], cat: MiniCat | null): EarItem {
  return { kind, text: texts[0]!, texts, cat };
}

/**
 * What the ear cycles through, in order: the stage, each cat at work (up to
 * EAR_WHO_MAX), the tasks left. Empty when nothing rotates (no run, a run
 * that is not running, or an ask waiting): the ear keeps machine.earTexts.
 */
export function earCycle(model: IslandModel): EarItem[] {
  const a = model.active;
  if (!a || a.status !== "running" || model.asks.length > 0) return [];
  const count = `${a.stageIndex + 1} of ${a.stageCount}`;
  const out: EarItem[] = [item("stage", [`${a.stageLabel} ${count}`, a.stageLabel, count], null)];
  for (const c of a.crew.filter((x) => x.atWork).slice(0, EAR_WHO_MAX)) {
    const cat: MiniCat = { id: c.id, name: c.name, look: c.look, role: c.role, status: c.status, activity: c.activity, mood: c.mood };
    out.push(item("who", [`${c.name} ${EAR_VERB[c.activity] ?? "working"}`, c.name], cat));
  }
  const left = a.taskCount - a.doneCount;
  if (a.taskCount > 0 && left > 0) out.push(item("left", [`${left} ${left === 1 ? "task" : "tasks"} left`, `${left} left`], null));
  return out;
}

/** Which item of a cycle of `count` shows at `now`, when the rotation began at `since`. */
export function earIndex(count: number, since: number, now: number): number {
  if (count <= 1) return 0;
  const steps = Math.floor(Math.max(0, now - since) / EAR_CYCLE_MS);
  return steps % count;
}

export interface Tuck {
  tucked: boolean;
  /** when the answer flips on its own (the tuck time), null while tucked: only news brings it out */
  nextAt: number | null;
}

/**
 * Tucked when no news came for TUCK_MS and the island has been out at
 * least UNTUCK_MIN_MS (`untuckedAt`: when it last came out, by news or by
 * the pointer on the notch).
 */
export function tuckState(lastNewsAt: number, now: number, untuckedAt = Number.NEGATIVE_INFINITY): Tuck {
  const at = Math.max(lastNewsAt + TUCK_MS, untuckedAt + UNTUCK_MIN_MS);
  return now >= at ? { tucked: true, nextAt: null } : { tucked: false, nextAt: at };
}

/**
 * Changes whenever there is news: a stage change, a task started or done,
 * an ask, an engine moment, a finish, or (passed in) the moment the
 * director shows. The same key means nothing new happened.
 */
export function newsKey(model: IslandModel, momentId: string | null = null): string {
  const a = model.active;
  const run = a ? [a.runId, a.status, a.stageIndex, a.startedCount, a.doneCount, a.lastMoment].join(":") : "none";
  const asks = model.asks.map((x) => x.id).join(",");
  const finish = model.finish ? `${model.finish.kind}:${model.finish.runId}` : "";
  return [run, asks, finish, momentId ?? ""].join("|");
}
