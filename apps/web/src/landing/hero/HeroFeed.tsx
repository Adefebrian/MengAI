// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The frame's company feed: the app's notices on sample data (JEV
// ui.region_gate hero_chips kept, relevance 2.02, container plain_spacing
// as the runner-up to the frame's own card; ui.component_recipe
// an.R21_flip_feed 0.67). A CEO approval, a meeting, tokens saved: when the
// frame settles the three latest notices of the morning arrive one after
// another, newest on top, and the story adds more as it plays. The others
// make room by a FLIP transform (Framer Motion layout); a new notice fades
// into its own slot (round C: the 12 px drop from above left the list's
// box mid-entrance, ui_audit overflow-parent at 320); nothing animates
// height or margin. Under reduced motion the notices are simply there.
//
// How many show depends on the room the frame gives the feed: a column of
// three beside the office on a wide frame, three or two across under it,
// and one on a phone, where the newest replaces the last one (it waits for
// the old one to leave, so the two never overlap).
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { ProductIcon, type GlyphName } from "@mengai/ui/src/product";
import { OPENING_NOTES, type FeedNote, type NoteKind } from "../story/script";

/** --ease-standard */
const EASE = [0.24, 1, 0.4, 1] as const;
/** --dur-400 in, --dur-400-exit out (showcase tokens, hero tier 3) */
const IN = { duration: 0.4, ease: EASE };
const OUT = { duration: 0.28, ease: EASE };
const INSTANT = { duration: 0 };
/** The opening notices arrive one per beat, after the frame settles. */
export const OPENING_DELAY_MS = 700;
export const OPENING_STEP_MS = 420;

const ICON: Record<NoteKind, GlyphName> = {
  approve: "chatCheck",
  ask: "message",
  meeting: "users",
  cache: "layers",
  handoff: "task",
  review: "checkCircle",
  tests: "checkCircle",
  ship: "checkCircle",
};

function iconOf(n: FeedNote): GlyphName {
  if (n.kind === "review" && n.tone === "warning") return "alertTriangle";
  return ICON[n.kind];
}

/**
 * The opening deal: the feed starts empty and the opening notices arrive
 * oldest first, so each new one lands on top. With `skip` (reduced motion,
 * or a phone's single slot, where a deal would only replace one notice with
 * the next) they are all there at once. Nothing starts before the frame
 * knows its layout. Returns how many have arrived.
 */
function useOpening(skip: boolean, ready: boolean): number {
  const [n, setN] = useState(0);
  const done = n >= OPENING_NOTES.length;
  useEffect(() => {
    if (!ready || done) return;
    if (skip) {
      setN(OPENING_NOTES.length);
      return;
    }
    const timer = setTimeout(() => setN((v) => v + 1), n === 0 ? OPENING_DELAY_MS : OPENING_STEP_MS);
    return () => clearTimeout(timer);
  }, [n, skip, ready, done]);
  return n;
}

/** The feed as shown: while the opening deal runs, only the notices that have arrived. */
export function visibleFeed(feed: FeedNote[], arrived: number, count: number): FeedNote[] {
  const opening = new Set(OPENING_NOTES.map((o) => o.id));
  // the opening notices are dealt oldest first: the last `arrived` of them are in
  const dealt = new Set(OPENING_NOTES.slice(OPENING_NOTES.length - arrived).map((o) => o.id));
  return feed.filter((n) => !opening.has(n.id) || dealt.has(n.id)).slice(0, count);
}

export function HeroFeed({ feed, count, reduced, ready = true }: { feed: FeedNote[]; count: number; reduced: boolean; ready?: boolean }) {
  // one slot (a phone): the newest simply arrives, nothing is dealt over it
  const arrived = useOpening(reduced || count === 1, ready);
  const shown = visibleFeed(feed, arrived, count);
  const one = count === 1;
  return (
    <ol className="lp-feed" aria-label="Company feed" data-count={count}>
      {/* popLayout injects a style element, which the engine's style-src 'self' refuses; sync keeps it CSP clean */}
      <AnimatePresence initial={false} mode={one ? "wait" : "sync"}>
        {shown.map((n) => (
          <motion.li
            key={n.id}
            layout={reduced ? false : "position"}
            className="lp-note"
            data-tone={n.tone}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1, transition: reduced ? INSTANT : IN }}
            exit={{ opacity: 0, transition: reduced ? INSTANT : OUT }}
            transition={{ layout: reduced ? INSTANT : IN }}
          >
            <span className="lp-note-icon">
              <ProductIcon name={iconOf(n)} size={20} />
            </span>
            <span className="lp-note-body">
              <span className="lp-note-head">
                <span className="lp-note-title">{n.title}</span>
                <span className="kit-num lp-note-clock">{n.clock}</span>
              </span>
              <span className="lp-note-text">{n.text}</span>
            </span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}
