// The kit's zero-dependency motion layer (T0 CSS plus T1 IntersectionObserver).
//
// Markup carries intent only: data-motion="rise" on a block (a section head,
// a text column, a media frame), data-motion="item" on each item of a grid
// or list (with --kit-i for the capped stagger), data-motion="count" on a
// StatRow figure. Nothing is hidden by markup or by a stylesheet on its own.
//
// After mount, useKitMotion arms the page: every target it will observe gets
// data-motion-state="pending" (kit.css hides only that state, and only when
// reduced motion is off), and an IntersectionObserver rooted on the real
// scroller (getScroller, after mount, so contained shells work) flips each
// one to "in" once, as it enters. So:
//   - no JavaScript, a failed bundle, or no IntersectionObserver: nothing is
//     ever pending, the page renders finished;
//   - reduced motion: the page never arms, and flipping it on mid-session
//     reveals everything at once;
//   - a target added after arming is never pending, so it can never stick;
//   - a target already on screen when the page arms is left alone, so the
//     first viewport paints finished (the LCP element never waits for a
//     script) and only what scrolls in later makes an entrance;
//   - once the scroller reaches its end, every target still pending is
//     revealed, so nothing near the page end can stay hidden.
//
// Levels (Page motion prop, set per section by JEV motion.intensity):
//   none    state layers only (tier 0)
//   quiet   one entrance per block, played once (tier 1), --dur-400, 12px rise
//   staged  blocks plus items staggered at --stagger-item, capped at 6 (tier 2)
// A module that owns motion (templates/modules/motion) sets
// data-motion-engine on the page root before this runs, and the kit steps
// aside so there is exactly one owner.
import { useLayoutEffect, type RefObject } from "react";
import { getScroller, scrollerRoot } from "../AppShell";

export type MotionLevel = "none" | "quiet" | "staged";

const REDUCE = "(prefers-reduced-motion: reduce)";

/** Read live at every arm, never cached (the user may flip it mid-session). */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia(REDUCE).matches;
}

/** The targets a level animates. A block that holds items is skipped at the
 *  staged level (its items carry the entrance), so nothing animates twice. */
export function motionTargets(root: ParentNode, level: MotionLevel): HTMLElement[] {
  if (level === "none") return [];
  const all = Array.from(root.querySelectorAll<HTMLElement>("[data-motion]"));
  return all.filter((el) => {
    const kind = el.dataset.motion;
    if (kind === "count") return true;
    if (kind === "item") return level === "staged";
    if (kind === "rise") return level === "quiet" || !el.querySelector('[data-motion="item"]');
    return false;
  });
}

/** True when el is laid out and already inside the scroller's visible box. */
export function onScreen(el: Element, scroller: Element | Window): boolean {
  const r = el.getBoundingClientRect();
  if (r.height === 0 && r.width === 0) return false;
  const top = scroller instanceof Element ? scroller.getBoundingClientRect().top : 0;
  const bottom = scroller instanceof Element ? scroller.getBoundingClientRect().bottom : window.innerHeight;
  return r.top < bottom && r.bottom > top;
}

/** Arm the entrances under root. Returns a cleanup that leaves every target
 *  visible and every figure at its final value. */
export function armMotion(root: HTMLElement, level: MotionLevel): () => void {
  if (level === "none" || typeof IntersectionObserver === "undefined" || prefersReducedMotion()) return () => {};
  const all = motionTargets(root, level);
  if (all.length === 0) return () => {};
  const counts = new Set<() => void>();
  const scroller = getScroller(all[0]);
  const targets = all.filter((el) => el.dataset.motion === "count" || !onScreen(el, scroller));
  const pending = new Set<HTMLElement>();
  const reveal = (el: HTMLElement) => {
    if (!pending.delete(el)) return;
    io.unobserve(el);
    el.dataset.motionState = "in";
    if (el.dataset.motion === "count") {
      const stop = countUp(el);
      if (stop) counts.add(stop);
    }
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) reveal(entry.target as HTMLElement);
      }
    },
    { root: scrollerRoot(scroller), rootMargin: "0px 0px -8% 0px", threshold: 0 },
  );
  for (const el of targets) {
    el.dataset.motionState = "pending";
    pending.add(el);
    io.observe(el);
  }
  // The observer's bottom margin trims 8% off the viewport, so a target that
  // sits in that band when the page cannot scroll any further (a closing band
  // with no footer below it) would never intersect. Two checks close that:
  // a pending target already inside the viewport now is revealed now, and
  // once the scroller reaches its end every pending target is revealed.
  for (const el of targets) if (onScreen(el, scroller)) reveal(el);
  const metrics = (): { top: number; height: number; full: number } => {
    const box = scroller instanceof Element ? scroller : (document.scrollingElement ?? document.documentElement);
    return { top: box.scrollTop, height: box.clientHeight, full: box.scrollHeight };
  };
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
  const caf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : (id: number) => clearTimeout(id);
  let frame = 0;
  const atEnd = () => {
    frame = 0;
    const m = metrics();
    if (m.top + m.height < m.full - 1) return;
    for (const el of [...pending]) reveal(el);
    if (pending.size === 0) scroller.removeEventListener("scroll", onScroll);
  };
  const onScroll = () => {
    if (!frame) frame = raf(atEnd);
  };
  if (pending.size > 0) scroller.addEventListener("scroll", onScroll, { passive: true });
  const media = typeof matchMedia === "function" ? matchMedia(REDUCE) : null;
  const finish = () => {
    io.disconnect();
    scroller.removeEventListener("scroll", onScroll);
    if (frame) caf(frame);
    frame = 0;
    pending.clear();
    for (const stop of counts) stop();
    counts.clear();
    for (const el of targets) delete el.dataset.motionState;
  };
  const onChange = () => {
    if (media?.matches) finish();
  };
  media?.addEventListener?.("change", onChange);
  return () => {
    media?.removeEventListener?.("change", onChange);
    finish();
  };
}

/** Arms the page once after mount (before paint, so there is no flash of the
 *  finished page followed by a fade). */
export function useKitMotion(ref: RefObject<HTMLElement | null>, level: MotionLevel): void {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || root.dataset.motionEngine) return;
    return armMotion(root, level);
  }, [ref, level]);
}

// ---------------------------------------------------------------------------
// Count-up (R07, mu.number-ticker): a figure counts from zero once on entry,
// on the standard curve at --dur-600. The box width is locked to the final
// value's measured width first, so the unit beside it never moves, and the
// digits are tabular, so the number never jitters. Only a plain number
// counts ("612", "1.490.000", "±30", "2.9"); a range or a word stays still.
// ---------------------------------------------------------------------------

export interface Countable {
  prefix: string;
  value: number;
  decimals: number;
  group: string;
  decimal: string;
  suffix: string;
}

/** Parse a figure into a countable number, or null when it is not one. */
export function parseCountable(text: string): Countable | null {
  const m = text.trim().match(/^([^\d\s]{0,2})(\d{1,3}(?:([.,])\d{3})+|\d+)(?:([.,])(\d+))?([^\d\s]{0,2})$/);
  if (!m) return null;
  const [, prefix, intPart, group = "", decimalMark = "", decimals = "", suffix] = m;
  if (group && decimalMark && group === decimalMark) return null;
  const whole = Number(intPart.split(group || "\u0000").join(""));
  const value = decimals ? whole + Number(`0.${decimals}`) : whole;
  if (!Number.isFinite(value)) return null;
  return { prefix, value, decimals: decimals.length, group, decimal: decimalMark || (group === "." ? "," : "."), suffix };
}

/** Format n the way the original figure was written. */
export function formatLike(c: Countable, n: number): string {
  const fixed = n.toFixed(c.decimals);
  const [whole, frac] = fixed.split(".");
  const grouped = c.group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, c.group) : whole;
  return `${c.prefix}${grouped}${frac ? c.decimal + frac : ""}${c.suffix}`;
}

// The standard curve cubic-bezier(0.24, 1, 0.4, 1), sampled once.
const LUT: [number, number][] = (() => {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 200; i++) {
    const u = i / 200;
    const a = 3 * (1 - u) ** 2 * u;
    const b = 3 * (1 - u) * u * u;
    const c = u ** 3;
    pts.push([a * 0.24 + b * 0.4 + c, a + b + c]);
  }
  return pts;
})();

export function standardCurve(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let i = 0;
  while (i < LUT.length - 1 && LUT[i + 1][0] < t) i++;
  return LUT[i][1];
}

function tokenMs(name: string, fallback: number): number {
  if (typeof getComputedStyle !== "function" || typeof document === "undefined") return fallback;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Count el's text node from zero to its value. Returns a stop function that
 *  writes the final value and releases the width lock, or null when the
 *  figure is not a plain number. When anything else writes the figure while
 *  it counts (React rendering a new value prop), the count cancels at once:
 *  the lock is released and the new text is left as written, never replaced
 *  by the old value, by the next frame or by stop. */
export function countUp(el: HTMLElement, opts: { duration?: number } = {}): (() => void) | null {
  const node = el.firstChild;
  if (!node || node.nodeType !== 3 || el.childNodes.length !== 1) return null;
  const final = node.nodeValue ?? "";
  const parsed = parseCountable(final);
  if (!parsed || parsed.value === 0) return null;
  const width = el.getBoundingClientRect().width;
  if (width > 0) el.style.inlineSize = `${width}px`;
  const duration = opts.duration ?? tokenMs("--dur-600", 600);
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
  const caf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : (id: number) => clearTimeout(id);
  let frame = 0;
  let start = -1;
  let done = false;
  let written = "";
  const write = (text: string) => {
    written = text;
    node.nodeValue = text;
  };
  // True once the figure holds something this count did not write.
  const overwritten = () => el.firstChild !== node || el.childNodes.length !== 1 || node.nodeValue !== written;
  const release = () => {
    done = true;
    caf(frame);
    el.style.inlineSize = "";
  };
  const stop = () => {
    if (done) return;
    const keep = overwritten();
    release();
    if (!keep) node.nodeValue = final;
  };
  const tick = (now: number) => {
    if (done) return;
    if (overwritten()) return release();
    if (start < 0) start = now;
    const t = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
    write(t >= 1 ? final : formatLike(parsed, parsed.value * standardCurve(t)));
    if (t < 1) frame = raf(tick);
    else stop();
  };
  write(formatLike(parsed, 0));
  frame = raf(tick);
  return stop;
}
