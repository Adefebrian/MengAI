// The smooth-scroll lifecycle as plain logic: when Lenis exists, what it is
// given, and what is torn down. SmoothScroll feeds it the real Lenis, gsap
// ticker, and ScrollTrigger; the tests feed it fakes. No React, no browser.
//
//   sync()     read the signals and converge: reduced motion means no Lenis
//              and no GSAP at all; touch-first without opt-in means no Lenis
//              (triggers still get the contained scroller); otherwise exactly
//              one Lenis on the one clock. Idempotent, so it is the handler
//              for every media query change.
//   destroy()  stop Lenis, remove the ticker callback, restore the default
//              scroller. Safe to call twice.
import { wireClock, type LenisLike, type TickerLike, type TriggerUpdater } from "./clock";
import { smoothScrollEnabled, type ScrollTarget, type SmoothSignals, type TouchPolicy } from "./policy";

export interface SmoothLenis extends LenisLike {
  destroy(): void;
}

export interface LenisInit {
  wrapper: Window | HTMLElement;
  content: HTMLElement;
  autoRaf: false;
  /** Off: SmoothScroll routes in-page links itself (header offset, focus). */
  anchors: false;
  syncTouch: boolean;
  lerp: number;
  prevent: (node: HTMLElement) => boolean;
}

/**
 * Nodes Lenis never smooths through, on top of its own data-lenis-prevent
 * attributes: an open dialog or modal sheet and a text area scroll natively.
 * Code blocks, maps, carousels, and tables that scroll on their own opt out
 * with data-lenis-prevent (a plain pre that never scrolls should not).
 */
export const PREVENT_SELECTOR = 'dialog, [role="dialog"], [aria-modal="true"], textarea';

export function preventNode(node: HTMLElement): boolean {
  return typeof node.matches === "function" && node.matches(PREVENT_SELECTOR);
}

export interface ControllerDeps<L extends SmoothLenis> {
  target: ScrollTarget;
  signals: () => SmoothSignals;
  touch: TouchPolicy;
  lerp: number;
  createLenis: (init: LenisInit) => L;
  ticker: TickerLike;
  triggers: TriggerUpdater;
  /** registerMotion: plugins and the curve, once. Never called under reduced motion. */
  register: () => void;
  /** ScrollTrigger.defaults({ scroller }); null restores window. */
  setScroller: (scroller: HTMLElement | null) => void;
  /** In-page anchor routing for a running Lenis; returns the unbind. */
  bindAnchors?: (lenis: L) => () => void;
  onChange: (lenis: L | null) => void;
}

export interface SmoothController<L> {
  sync(): void;
  destroy(): void;
  readonly lenis: L | null;
}

export function createSmoothController<L extends SmoothLenis>(deps: ControllerDeps<L>): SmoothController<L> {
  let running: { lenis: L; teardown: () => void } | null = null;
  let scrollerSet = false;

  const stop = () => {
    if (!running) return;
    const { teardown } = running;
    running = null;
    teardown();
    deps.onChange(null);
  };

  const sync = () => {
    const signals = deps.signals();
    // Reduced motion: GSAP is never touched, no listener, no ticker frame.
    if (signals.reducedMotion) return stop();
    deps.register();
    if (deps.target.contained && !scrollerSet) {
      deps.setScroller(deps.target.wrapper as HTMLElement);
      scrollerSet = true;
    }
    if (!smoothScrollEnabled(signals, deps.touch)) return stop();
    if (running) return;
    const lenis = deps.createLenis({
      wrapper: deps.target.wrapper,
      content: deps.target.content,
      autoRaf: false,
      anchors: false,
      syncTouch: deps.touch === "smooth",
      lerp: deps.lerp,
      prevent: preventNode,
    });
    const unwire = wireClock(deps.ticker, lenis, deps.triggers);
    const unbind = deps.bindAnchors ? deps.bindAnchors(lenis) : () => {};
    running = {
      lenis,
      teardown: () => {
        unbind();
        unwire();
        lenis.destroy();
      },
    };
    deps.onChange(lenis);
  };

  return {
    sync,
    destroy() {
      stop();
      if (scrollerSet) {
        scrollerSet = false;
        deps.setScroller(null);
      }
    },
    get lenis() {
      return running?.lenis ?? null;
    },
  };
}
