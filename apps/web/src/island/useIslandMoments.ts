// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The island's moments pipeline: one Director (director.ts) per island,
// fed by everything that can bring a moment, and the one it shows now
// (docs/superpowers/specs/2026-10-01-island-moments-design.md, sections 4
// and 4.2). The sources:
//   events   every event the feed reduces goes through deriveMoments(before,
//            event, after): hire, let go, handoff, engine hints, stage done,
//            the ship, a failure, the reaction when the stream answers an ask
//   asks     on every model change, syncAsks(askMoments(model)): the asking
//            cat comes out, and goes back once the ask is answered anywhere
//   answer   Approve or Deny on the island: the cat reacts at once
//            (answerMoment), before the stream confirms; the stream's own
//            reaction has the same id, so it never plays twice
//   failure  Dismiss resolves the failed moment, and so does a finish that
//            leaves on its own
//   tap      a click on a cat: tapMoment; three within TAP_COMBO_MS call a
//            crew cat out to wave
//   quirk    while the island is quiet (collapsed, or tucked under a notch)
//            and motion is on, one timer to director.quirkAt asks quirkDue
//            for a seed and offers that cat's quirkMoment
// The clock is injected (`now`) and the only randomness is the director's
// seeded stream. The current moment is state, set from director.tick after
// every change and read again by one timeout at its expiry: no frame loop,
// and nothing reads the clock while rendering. `epoch` bumps when the
// preview's clock jumps forward, so every timer is set again.
import type { MengaiEvent } from "@mengai/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Director, type Cue } from "./director";
import type { Ask, IslandLive, IslandModel, MiniCat } from "./live";
import { TAP_COMBO_MS, answerMoment, askMoments, deriveMoments, quirkMoment, tapCombo, tapMoment } from "./moments";

export interface IslandMoments {
  /** the moment on the stage now, null for none */
  current: Cue | null;
  /** one event the feed reduced, with the island before and after it */
  onEvent(before: IslandLive, e: MengaiEvent, after: IslandLive): void;
  /** the owner answered an ask on the island */
  answer(ask: Ask, approved: boolean): void;
  /** the owner dismissed the failure */
  dismiss(): void;
  /** the owner clicked a cat (the band's mini cat, or one on the stage) */
  tap(cat: MiniCat): void;
  /** collapsed, or tucked under a notch: a crew cat may fool around */
  setQuiet(quiet: boolean): void;
}

export interface MomentsOptions {
  model: IslandModel;
  /** the island clock */
  now: () => number;
  /** quirks play only with motion on (spec section 8) */
  quirks: boolean;
  /** seeds the quirk gaps and picks; missing: the first clock read, so each island differs */
  seed?: number;
  /** bumps when the preview's clock jumps */
  epoch?: number;
}

interface Shown {
  current: Cue | null;
  /** when it ends on its own; null while it stays until resolved */
  expiresAt: number | null;
}

export function useIslandMoments({ model, now, quirks, seed, epoch = 0 }: MomentsOptions): IslandMoments {
  const nowRef = useRef(now);
  nowRef.current = now;
  const modelRef = useRef(model);
  modelRef.current = model;
  const [director] = useState(() => {
    const t = now();
    return new Director({ now: t, seed: seed ?? Math.floor(Math.abs(t)) % 0x7fffffff });
  });
  const [shown, setShown] = useState<Shown>({ current: null, expiresAt: null });
  const [quiet, setQuiet] = useState(false);
  // bumps after a timer fires, so its effect sets the next one even when nothing showed changed
  const [wake, setWake] = useState(0);
  // The reaction to an answer whose ask waited behind another one: the
  // director calls it stale (that cat never came out), the island still shows it.
  const overlay = useRef<{ cue: Cue; until: number } | null>(null);
  const taps = useRef<number[]>([]);

  const refresh = useCallback(() => {
    const t = nowRef.current();
    const tick = director.tick(t);
    let current = tick.current;
    let expiresAt = tick.expiresAt;
    const o = overlay.current;
    if (o && t < o.until) {
      current = o.cue;
      expiresAt = o.until;
    } else overlay.current = null;
    setShown((s) => (s.current === current && s.expiresAt === expiresAt ? s : { current, expiresAt }));
  }, [director]);

  const onEvent = useCallback(
    (before: IslandLive, e: MengaiEvent, after: IslandLive) => {
      const t = nowRef.current();
      const list = deriveMoments(before, e, after, t);
      if (list.length === 0) return;
      for (const m of list) director.offer(m, t);
      refresh();
    },
    [director, refresh],
  );

  // The asks that wait right now: new ones come out, answered ones go back.
  useEffect(() => {
    const t = nowRef.current();
    director.syncAsks(askMoments(model, t), t);
    refresh();
  }, [director, model, refresh]);

  // A failure that left without a Dismiss (cleared elsewhere, or a newer finish) ends its moment too.
  const failedKey = model.finish?.kind === "failed" ? `failed:${model.finish.runId}` : null;
  const lastFailed = useRef<string | null>(null);
  useEffect(() => {
    const was = lastFailed.current;
    lastFailed.current = failedKey;
    if (was && was !== failedKey) {
      director.resolve(was, nowRef.current());
      refresh();
    }
  }, [director, failedKey, refresh]);

  // One timeout at the expiry of what shows; the director starts the next in line.
  useEffect(() => {
    if (shown.expiresAt === null) return;
    const timer = setTimeout(
      () => {
        refresh();
        setWake((w) => w + 1);
      },
      Math.max(0, shown.expiresAt - nowRef.current()) + 1,
    );
    return () => clearTimeout(timer);
  }, [shown.expiresAt, epoch, wake, refresh]);

  // A crew cat fools around on a quiet island: one timeout to when the director allows it.
  const busy = shown.current !== null;
  useEffect(() => {
    if (!quiet || !quirks || busy) return;
    const timer = setTimeout(
      () => {
        const t = nowRef.current();
        const s = director.quirkDue(t);
        if (s !== null) {
          const m = quirkMoment(modelRef.current, s, t);
          if (m) director.offer(m, t);
        }
        refresh();
        setWake((w) => w + 1);
      },
      Math.max(0, director.quirkAt - nowRef.current()) + 1,
    );
    return () => clearTimeout(timer);
  }, [quiet, quirks, busy, epoch, wake, director, refresh]);

  const answer = useCallback(
    (ask: Ask, approved: boolean) => {
      const t = nowRef.current();
      const cue = askMoments(modelRef.current, t).find((m) => m.askId === ask.id);
      if (!cue) return;
      const reaction = answerMoment(cue, approved, t);
      if (director.offer(reaction, t) === "stale") overlay.current = { cue: reaction, until: t + (reaction.ms ?? 0) };
      refresh();
    },
    [director, refresh],
  );

  const dismiss = useCallback(() => {
    const f = modelRef.current.finish;
    if (f?.kind !== "failed") return;
    director.resolve(`failed:${f.runId}`, nowRef.current());
    refresh();
  }, [director, refresh]);

  const tap = useCallback(
    (cat: MiniCat) => {
      const t = nowRef.current();
      const recent = [...taps.current.filter((x) => t - x <= TAP_COMBO_MS), t];
      const combo = tapCombo(recent, t);
      taps.current = combo ? [] : recent;
      director.offer(tapMoment(modelRef.current, cat, t, combo), t);
      refresh();
    },
    [director, refresh],
  );

  const current = shown.current;
  return useMemo(() => ({ current, onEvent, answer, dismiss, tap, setQuiet }), [current, onEvent, answer, dismiss, tap]);
}
