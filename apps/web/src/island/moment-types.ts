// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The island's moments, shared by the deriver (moments.ts), the director
// (director.ts) and the stage (Stage.tsx). A moment is one short scene on
// the stage under the island: who it is about, what that cat does and holds,
// and how long it plays. See docs/superpowers/specs/2026-10-01-island-moments-design.md.
import type { Pose, PropId } from "@mengai/cats/src/poses";
import type { Quirk } from "@mengai/cats/src/motion";
import type { MiniCat } from "./live";

export const MOMENT_TYPES = [
  "ask_approval",
  "ask_order",
  "ask_question",
  "hire",
  "let_go",
  "handoff",
  "review_pass",
  "review_fail",
  "ceo_approved",
  "ceo_denied",
  "rethink",
  "stuck",
  "budget_low",
  "stage_done",
  "shipped",
  "failed",
  "quirk",
  "tap",
] as const;
export type MomentType = (typeof MOMENT_TYPES)[number];

/** How a cat moves on the stage, on top of what its rig beat does. */
export type StageMove =
  /** slides down out of the island and stays */
  | "emerge"
  /** emerges, plays, goes back up */
  | "visit"
  /** emerges and hops once (a nudge, a cheer) */
  | "hop"
  /** leaves to the side */
  | "leave";

export interface StageCat {
  cat: MiniCat;
  /** the rig pose the cat plays (an Activity or "stopped") */
  pose: Pose;
  /** what it holds; null leaves the rig's own choice */
  prop: PropId | null;
  /** a one-shot quirk to play once it is out, null for none */
  quirk: Quirk | null;
  move: StageMove;
  /** offset of its entrance after the moment starts, for a row of cats */
  delayMs: number;
}

export interface Moment {
  /** stable: the same fact always yields the same id, so a replay never plays twice */
  id: string;
  type: MomentType;
  runId: string | null;
  /** the cats on the stage, first is the actor; one to three */
  cats: StageCat[];
  /** how long it plays; null stays until resolved (an ask, a failure) */
  ms: number | null;
  /** higher cuts in; see PRIORITY in director.ts */
  priority: number;
  /** one plain sentence for the island body and the accessible name */
  text: string;
  /** where Open or a click takes the owner, under /app */
  path: string;
  /** island clock (ms) when it was derived */
  at: number;
  /** the ask this moment stands for, so an answer can end it */
  askId?: string;
}
