// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// KitMotion: GSAP upgrades of the kit's own motion, as one leaf component.
// It takes over from the kit's IntersectionObserver layer (it sets
// data-motion-engine="gsap" on .kit-page before the kit arms), so there is
// exactly one owner of every entrance. Render it inside <SmoothScroll>, before
// the sections.
//
// Tiers follow JEV motion.intensity for the page's showcase sections
// (skills/jal-immersive/references/scroll-choreography.md section 10):
//   1 quiet     the kit entrances on ScrollTrigger.batch, played once
//               (R01 reveal on view, no blur), and StatRow count-up (R07)
//   2 staged    plus items staggered at --stagger-item (capped at 6), and
//               SplitText line reveals on section headings that scroll in
//               (R03 line mask reveal, mask: "lines"); the first viewport,
//               the Masthead h1 included, paints finished for LCP
//   3 cinematic plus, at 1024 and up only: the StickyStory frames on a
//               scrubbed crossfade (R23 pinned crossfade stage, the kit's
//               pin), a scroll-mapped drift on bleed image or canvas media
//               (the scrub pattern on a parent transform), and the
//               SpecTable rail rows arriving in order, with a GSAP pin as the
//               fallback when an ancestor's overflow breaks CSS sticky
// Everything sits in one gsap.matchMedia branch that only matches without
// reduced motion: under reduced motion nothing is created, nothing is
// hidden, and no ticker work starts. Hidden start states are set with
// gsap.set inside that branch, never in a stylesheet, so no-JS and a failed
// bundle render the finished page.
import { useGSAP } from "@gsap/react";
import { useSyncExternalStore } from "react";
import { formatLike, getScroller, motionTargets, onScreen, parseCountable, type MotionLevel } from "@mengai/ui";
import { countTo, type CountEngine } from "./count";
import { gsap, registerMotion, ScrollTrigger, SplitText, tokPx, tokSeconds } from "./gsap";
import { SPLIT_VARS, splitReveal, type SplitEngine } from "./split";

export type MotionTier = 1 | 2 | 3;

export interface KitMotionProps {
  tier?: MotionTier;
}

type Undo = (() => void)[];

// Every start is wrapped in clamp(): a target in the last few percent of
// the page, which the viewport line can never reach, still fires at the
// bottom of the scroll instead of waiting hidden forever (stuck-reveal).
const START_BLOCK = "clamp(top 92%)";
const START_HEAD = "clamp(top 90%)";
const START_RAIL = "clamp(top 85%)";

function staggerEach(): number {
  return tokSeconds("--stagger-item", 60);
}

const splitEngine: SplitEngine = {
  set: (target, vars) => void gsap.set(target, vars),
  trigger: (vars) => ScrollTrigger.create(vars),
  split: (el) => SplitText.create(el, { ...SPLIT_VARS }),
  rise: (lines, vars) =>
    gsap.fromTo(lines, { yPercent: 100 }, { yPercent: 0, ease: "jal-standard", duration: vars.duration, stagger: vars.stagger, onComplete: vars.onComplete }),
};

const countEngine: CountEngine = {
  tween: (state, vars) => gsap.to(state, { ...vars, ease: "jal-standard" }),
};

/** SplitText line reveals on display headlines and section headings that
 *  scroll in (tier 2 and up); split.ts holds the reveal itself. Headings on
 *  screen at load paint finished (the Masthead h1 is usually the LCP
 *  element), and a heading holding an SVG is left whole. */
function splitHeadlines(root: HTMLElement, undo: Undo): HTMLElement[] {
  const scroller = getScroller(root);
  const heads = Array.from(root.querySelectorAll<HTMLElement>(".kit-display, .kit-head > .kit-heading, .kit-split-text > .kit-heading, .kit-cta-text > .kit-heading")).filter(
    (el) => !el.querySelector("svg") && !onScreen(el, scroller),
  );
  const fontsReady: Promise<unknown> = document.fonts?.ready ?? Promise.resolve();
  for (const el of heads) {
    undo.push(
      splitReveal(el, splitEngine, {
        start: START_HEAD,
        duration: tokSeconds("--dur-600", 600),
        stagger: tokSeconds("--stagger-line", 80),
        fontsReady,
      }),
    );
  }
  return heads;
}

/** Entrances on ScrollTrigger.batch. A block that holds a split heading
 *  hands its entrance to its other children, so nothing moves twice. */
function reveal(root: HTMLElement, level: MotionLevel, split: HTMLElement[], skip: (el: HTMLElement) => boolean, undo: Undo) {
  const els: HTMLElement[] = [];
  const scroller = getScroller(root);
  for (const el of motionTargets(root, level)) {
    if (el.dataset.motion === "count" || skip(el) || onScreen(el, scroller)) continue;
    const inner = split.find((h) => el.contains(h));
    if (inner) {
      for (const child of Array.from(el.children) as HTMLElement[]) if (child !== inner && !child.contains(inner)) els.push(child);
    } else els.push(el);
  }
  if (els.length === 0) return;
  const rise = tokPx("--kit-rise", 12);
  const each = staggerEach();
  // Pending is opacity only (never visibility, so assistive tech still reads
  // it, and never a transform, so the box stays on the grid); the rise is
  // part of the entrance.
  gsap.set(els, { opacity: 0 });
  const live = new Set<gsap.core.Tween>();
  ScrollTrigger.batch(els, {
    start: START_BLOCK,
    once: true,
    onEnter: (batch) => {
      const t = gsap.fromTo(
        batch,
        { opacity: 0, y: rise },
        {
          opacity: 1,
          y: 0,
          duration: tokSeconds("--dur-400", 400),
          ease: "jal-standard",
          stagger: (i: number) => Math.min(i, 6) * each,
          overwrite: true,
          clearProps: "transform",
          onComplete: () => void live.delete(t),
        },
      );
      live.add(t);
    },
  });
  // Tweens started by a callback live outside the matchMedia context, so a
  // revert mid-entrance (reduced motion switched on) stops them here.
  undo.push(() => {
    for (const t of live) t.kill();
    live.clear();
    gsap.set(els, { clearProps: "opacity,transform" });
  });
}

/** StatRow, Bento, and quote figures count up once on entry (count.ts),
 *  on the GSAP ticker. */
function counts(root: HTMLElement, undo: Undo) {
  const duration = tokSeconds("--dur-600", 600);
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-motion="count"]'))) {
    ScrollTrigger.create({
      trigger: el,
      start: START_BLOCK,
      once: true,
      onEnter: () => {
        const stop = countTo(el, parseCountable, formatLike, countEngine, duration);
        if (stop) undo.push(stop);
      },
    });
  }
}

/** Tier 3: the story's stage frames crossfade on scroll, scrubbed across the
 *  kit's own pin (the track of markers sets the scroll length). */
function scrubStories(root: HTMLElement, undo: Undo) {
  for (const story of Array.from(root.querySelectorAll<HTMLElement>(".kit-story"))) {
    const track = story.querySelector<HTMLElement>(".kit-story-track");
    const pin = story.querySelector<HTMLElement>(".kit-story-pin");
    const frames = Array.from(story.querySelectorAll<HTMLElement>(".kit-story-frame"));
    if (!track || !pin || frames.length < 2) continue;
    story.dataset.scrub = "";
    const top = () => parseFloat(getComputedStyle(pin).top) || 0;
    gsap.set(frames, { autoAlpha: 0 });
    gsap.set(frames[0], { autoAlpha: 1 });
    const travel = tokPx("--space-16px", 16);
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: track,
        start: () => `top ${top()}px`,
        end: () => `bottom ${top() + pin.offsetHeight}px`,
        scrub: 0.6,
        invalidateOnRefresh: true,
      },
    });
    frames.forEach((frame, i) => {
      if (i === 0) return;
      // The outgoing frame is a plain .to (a fromTo would render its visible
      // start state at creation and show two frames at once); the incoming
      // one starts hidden, so its fromTo may render immediately.
      tl.to(frames[i - 1], { autoAlpha: 0, y: -travel, duration: 0.3, ease: "jal-standard" }, i - 0.15);
      tl.fromTo(frame, { autoAlpha: 0, y: travel }, { autoAlpha: 1, y: 0, duration: 0.3, ease: "jal-standard" }, i - 0.15);
    });
    tl.set({}, {}, frames.length); // equal scroll per step, a dwell on the last
    undo.push(() => {
      delete story.dataset.scrub;
      gsap.set(frames, { clearProps: "opacity,visibility,transform" });
    });
  }
}

/** Tier 3: a scroll-mapped drift on bleed image, video, or canvas media
 *  (never a live DOM view, whose content stays on the grid). Linear is
 *  lawful here: the scroll itself is the easing. */
function drift(root: HTMLElement) {
  const frames = root.querySelectorAll<HTMLElement>(
    '.kit-split[data-variant="bleed"] .kit-media:is([data-kind="image"], [data-kind="video"], [data-kind="canvas"]) .kit-media-frame',
  );
  for (const frame of Array.from(frames)) {
    const inner = frame.firstElementChild as HTMLElement | null;
    if (!inner) continue;
    gsap.fromTo(
      inner,
      { yPercent: -4, scale: 1.08 },
      { yPercent: 4, scale: 1.08, ease: "none", scrollTrigger: { trigger: frame, start: "top bottom", end: "bottom top", scrub: true } },
    );
  }
}

/** True when an ancestor between el and the scroller clips overflow in a
 *  way that disables position: sticky (hidden, auto, or scroll). */
export function stickyBroken(el: HTMLElement, scroller: Element | Window): boolean {
  for (let node = el.parentElement; node && node !== scroller && node !== document.body; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if ([overflowX, overflowY].some((v) => v === "hidden" || v === "auto" || v === "scroll")) return true;
  }
  return false;
}

/** Tier 3: SpecTable rail rows arrive in order as the rail enters; the rail
 *  stays pinned by CSS sticky, or by a GSAP pin when sticky is broken.
 *  Pending is opacity only (never visibility, so assistive tech still reads
 *  the rows), and a rail already on screen at setup paints finished. */
function rails(root: HTMLElement, undo: Undo) {
  for (const rail of Array.from(root.querySelectorAll<HTMLElement>(".kit-spec-sticky"))) {
    const rows = Array.from(rail.querySelectorAll<HTMLElement>(".kit-spec-row, .kit-spec-railgroup > .kit-title"));
    const scroller = getScroller(rail);
    const pending = rows.filter((row) => !onScreen(row, scroller));
    if (pending.length > 0) {
      gsap.set(pending, { opacity: 0 });
      const live = new Set<gsap.core.Tween>();
      ScrollTrigger.create({
        trigger: rail,
        start: START_RAIL,
        once: true,
        onEnter: () => {
          const t = gsap.fromTo(
            pending,
            { opacity: 0, y: tokPx("--space-8px", 8) },
            {
              opacity: 1,
              y: 0,
              duration: tokSeconds("--dur-400", 400),
              ease: "jal-standard",
              stagger: (i: number) => Math.min(i, 6) * staggerEach(),
              overwrite: true,
              clearProps: "transform",
              onComplete: () => void live.delete(t),
            },
          );
          live.add(t);
        },
      });
      undo.push(() => {
        for (const t of live) t.kill();
        live.clear();
        gsap.set(pending, { clearProps: "opacity,transform" });
      });
    }
    const set = rail.closest<HTMLElement>(".kit-spec-railset");
    if (set && stickyBroken(rail, getScroller(rail))) {
      // The rail shares one grid row with the taller prose, so its pin ends
      // where its own grid area ends and nothing follows it inside the row:
      // pinSpacing stays off only because the row already holds the space.
      ScrollTrigger.create({ trigger: rail, pin: true, pinSpacing: false, start: () => `top ${parseFloat(getComputedStyle(rail).top) || 0}px`, endTrigger: set, end: () => `bottom ${rail.offsetHeight + (parseFloat(getComputedStyle(rail).top) || 0)}px`, invalidateOnRefresh: true });
    }
  }
}

const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribeReduce = (cb: () => void) => {
  const m = matchMedia(REDUCE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/** Live reduced motion; the server snapshot reads as reduced (finished page). */
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduce, () => matchMedia(REDUCE).matches, () => true);
}

export function KitMotion({ tier = 2 }: KitMotionProps) {
  const reduced = useReducedMotion();
  useGSAP(
    () => {
      const root = document.querySelector<HTMLElement>(".kit-page");
      if (!root) return;
      // One owner either way: the kit never arms under a page that has KitMotion.
      root.dataset.motionEngine = "gsap";
      if (reduced) return () => void delete root.dataset.motionEngine;
      registerMotion();
      const mm = gsap.matchMedia();
      mm.add({ motion: "(prefers-reduced-motion: no-preference)", desktop: "(min-width: 1024px)" }, (ctx) => {
        const { motion, desktop } = ctx.conditions as { motion: boolean; desktop: boolean };
        if (!motion) return;
        const undo: Undo = [];
        const split = tier >= 2 ? splitHeadlines(root, undo) : [];
        const cinematic = tier >= 3 && desktop;
        reveal(root, tier >= 2 ? "staged" : "quiet", split, (el) => cinematic && el.classList.contains("kit-spec-sticky"), undo);
        counts(root, undo);
        if (cinematic) {
          scrubStories(root, undo);
          drift(root);
          rails(root, undo);
        }
        return () => {
          for (const f of undo.reverse()) f();
        };
      });
      return () => {
        mm.revert();
        delete root.dataset.motionEngine;
      };
    },
    { dependencies: [tier, reduced], revertOnUpdate: true },
  );
  return null;
}
