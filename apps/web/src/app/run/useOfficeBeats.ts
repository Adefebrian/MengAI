// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The beat queue behind the Office scene. Every new event in the shown
// state (the live stream, or the replay stepping forward) is folded from the
// state before it, so a beat sees the transition that started it. The first
// paint plays nothing (the crew is already where the snapshot put it), a
// replay that jumps back clears the queue, and the scene drains the queue
// through onBeatDone.
import type { OfficeBeat } from "@mengai/cats";
import { useCallback, useEffect, useRef, useState } from "react";
import { reduceRun, type RunState } from "../../store/runStore";
import { beatsForEvent, trimBeats } from "./office";

/** Past this many new events at once (a scrub across the run) nothing is choreographed. */
const JUMP_LIMIT = 80;

/** New beats for the events between two states, or null when the two are not one timeline. */
export function beatsBetween(prev: RunState, next: RunState): OfficeBeat[] | null {
  if (next.runId !== prev.runId) return null;
  if (next.lastSeq < prev.lastSeq || next.log.length < prev.log.length) return null;
  if (next.lastSeq === prev.lastSeq) return [];
  // A snapshot (no log behind it) followed by a whole folded log is a new
  // picture of the same run, not news: nothing walks.
  if (prev.log.length === 0 && prev.lastSeq > 0 && next.log.length > 0 && next.log[0]!.seq <= prev.lastSeq) return null;
  const fresh: typeof next.log = [];
  for (let i = next.log.length - 1; i >= 0; i--) {
    const e = next.log[i]!;
    if (e.seq <= prev.lastSeq) break;
    fresh.push(e);
  }
  if (fresh.length > JUMP_LIMIT) return [];
  fresh.reverse();
  const out: OfficeBeat[] = [];
  let before = prev;
  for (const e of fresh) {
    const after = reduceRun(before, e);
    out.push(...beatsForEvent(e, before, after));
    before = after;
  }
  return out;
}

export function useOfficeBeats(state: RunState): { beats: OfficeBeat[]; done: (beatId: string) => void } {
  const [queue, setQueue] = useState<OfficeBeat[]>([]);
  const last = useRef<RunState | null>(null);

  useEffect(() => {
    const prev = last.current;
    last.current = state;
    if (!prev) return;
    const fresh = beatsBetween(prev, state);
    if (fresh === null) setQueue((q) => (q.length ? [] : q));
    else if (fresh.length > 0) setQueue((q) => trimBeats([...q, ...fresh]));
  }, [state]);

  const done = useCallback((beatId: string) => setQueue((q) => q.filter((b) => b.id !== beatId)), []);
  return { beats: queue, done };
}
