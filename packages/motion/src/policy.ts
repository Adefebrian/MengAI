// When smooth scroll runs, and on which element. Pure functions over the
// signals, so the choice is tested without a browser.
//
// Lenis is the default smooth scroll for marketing and immersive pages, and
// never runs:
//   - under prefers-reduced-motion: reduce (native scroll, no rAF loop);
//   - on a touch-first device (coarse pointer and no hover) unless the page
//     opts in with touch="smooth". Native touch scrolling already has the
//     platform's momentum; replacing it costs a rAF loop and battery and
//     fights the browser's own gestures (pull to refresh, the address bar).
//     Opt in only for a page whose scroll choreography needs the same
//     easing on touch (a pinned story that must not overshoot), and then
//     Lenis runs with syncTouch.

export interface SmoothSignals {
  reducedMotion: boolean;
  /** (pointer: coarse) */
  coarsePointer: boolean;
  /** (hover: none) */
  noHover: boolean;
}

export type TouchPolicy = "native" | "smooth";

export const QUERIES = {
  reduce: "(prefers-reduced-motion: reduce)",
  coarse: "(pointer: coarse)",
  noHover: "(hover: none)",
} as const;

export function isTouchFirst(s: SmoothSignals): boolean {
  return s.coarsePointer && s.noHover;
}

export function smoothScrollEnabled(s: SmoothSignals, touch: TouchPolicy = "native"): boolean {
  if (s.reducedMotion) return false;
  if (isTouchFirst(s) && touch !== "smooth") return false;
  return true;
}

/** Live signals; the server and a missing matchMedia read as motion off. */
export function readSignals(match: ((q: string) => { matches: boolean }) | undefined = typeof matchMedia === "function" ? matchMedia : undefined): SmoothSignals {
  if (!match) return { reducedMotion: true, coarsePointer: false, noHover: false };
  return {
    reducedMotion: match(QUERIES.reduce).matches,
    coarsePointer: match(QUERIES.coarse).matches,
    noHover: match(QUERIES.noHover).matches,
  };
}

export interface ScrollTarget {
  /** window on a document shell, main.shell-main on a contained one. */
  wrapper: Window | HTMLElement;
  /** The element whose height is the scroll length. */
  content: HTMLElement;
  contained: boolean;
}

/**
 * Lenis's wrapper and content for the scroller getScroller() returned after
 * mount. A contained shell needs content = the scroller's single child (the
 * one wrapper element AppShell holds), or Lenis measures the document root,
 * which never grows, and clamps at the wrong limit.
 */
export function resolveScrollTarget(scroller: Element | Window, doc: Document): ScrollTarget {
  const isWindow = typeof Window !== "undefined" ? scroller instanceof Window : !(scroller as Element).nodeType;
  if (isWindow) return { wrapper: scroller as Window, content: doc.documentElement, contained: false };
  const wrapper = scroller as HTMLElement;
  const content = wrapper.firstElementChild as HTMLElement | null;
  if (!content || wrapper.childElementCount !== 1) {
    throw new Error("SmoothScroll: a contained shell must hold exactly one wrapper element inside main (SmoothScroll renders it)");
  }
  return { wrapper, content, contained: true };
}
