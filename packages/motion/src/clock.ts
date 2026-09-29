// The one clock. gsap.ticker owns the page's only requestAnimationFrame;
// Lenis advances from it and ScrollTrigger updates from Lenis's scroll
// event, so tweens, smooth scroll, and every trigger read the same frame
// (skills/jal-immersive/references/scroll-choreography.md section 8).
//
// Pure wiring over small structural types, so it is tested with fakes and
// never needs a browser. The real objects (gsap.ticker, a Lenis instance,
// ScrollTrigger) satisfy these shapes.

export type TickerCallback = (time: number, deltaTime: number, frame: number) => void;

export interface TickerLike {
  add(callback: TickerCallback, once?: boolean, prioritize?: boolean): unknown;
  remove(callback: TickerCallback): unknown;
  lagSmoothing(threshold: number | boolean, adjustedLag?: number): unknown;
}

export interface LenisLike {
  raf(time: number): void;
  on(event: "scroll", callback: () => void): () => void;
}

export interface TriggerUpdater {
  update(): void;
}

/** GSAP's default lag smoothing, restored when the clock is unwired. */
export const DEFAULT_LAG = { threshold: 500, adjusted: 33 } as const;

/**
 * Wire Lenis to the GSAP ticker as one clock:
 *   - lenis.on("scroll", ScrollTrigger.update): triggers read Lenis's scroll
 *   - gsap.ticker.add(time => lenis.raf(time * 1000), false, true): Lenis
 *     advances first in each tick (prioritized), in milliseconds
 *   - gsap.ticker.lagSmoothing(0): a long frame never stalls the scroll
 * Returns the unwire function: it removes both callbacks and restores the
 * default lag smoothing. Calling it twice is safe.
 */
export function wireClock(ticker: TickerLike, lenis: LenisLike, triggers: TriggerUpdater): () => void {
  const update = () => triggers.update();
  const offScroll = lenis.on("scroll", update);
  const raf: TickerCallback = (time) => lenis.raf(time * 1000);
  ticker.add(raf, false, true);
  ticker.lagSmoothing(0);
  let wired = true;
  return () => {
    if (!wired) return;
    wired = false;
    offScroll();
    ticker.remove(raf);
    ticker.lagSmoothing(DEFAULT_LAG.threshold, DEFAULT_LAG.adjusted);
  };
}
