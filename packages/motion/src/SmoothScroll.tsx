// SmoothScroll: Lenis as the page's one smooth scroll, on the one clock.
//
//   <Page direction="D9">
//     <AppShell ...>                      scroll="document" (window) or "contained"
//       <SmoothScroll>                    renders the single wrapper inside main
//         <KitMotion />                   optional: GSAP upgrades of kit motion
//         ...kit sections
//       </SmoothScroll>
//     </AppShell>
//   </Page>
//
// What it does, after mount (a leaf rendered before the sections, so its
// layout effect runs before theirs and every trigger sees the right scroller):
//   1. getScroller(): window on a document shell, main.shell-main on a
//      contained one; Lenis's wrapper and content come from
//      resolveScrollTarget (a contained shell's content is SmoothScroll's own
//      single wrapper). A contained shell also sets
//      ScrollTrigger.defaults({ scroller }), even when Lenis stays off on
//      touch, so triggers never watch the wrong element.
//   2. createSmoothController (controller.ts) decides: never under reduced
//      motion (GSAP untouched), not on touch-first devices unless
//      touch="smooth", else one Lenis with autoRaf off.
//   3. wireClock (clock.ts): gsap.ticker drives lenis.raf(time * 1000),
//      lagSmoothing(0), lenis.on("scroll", ScrollTrigger.update). One rAF.
//   4. In-page "#id" links go through lenis.scrollTo clear of the sticky
//      header (anchor.ts), then focus the target.
//   5. Any change to reduced motion, pointer, or hover re-syncs: reduced
//      motion switched on mid-session destroys Lenis at once, off again
//      starts it. Unmount destroys it and removes the ticker callback.
//   6. Fonts ready (and any later font load), a resize of the scroller, and
//      any change in the content's height refresh Lenis and ScrollTrigger in
//      one batched frame (refresh.ts).
// Never ScrollSmoother, never a second smoother, never scrollerProxy.
//
// Server rendering: nothing here runs on the server (effects only); the
// markup is the one wrapper div, so the server and client trees match.
//
// Inner scrollers (a code block, a map, a horizontal carousel, a table's
// .scroll-x) carry data-lenis-prevent so they keep native scrolling; open
// dialogs and text areas are exempt on their own (PREVENT_SELECTOR). Call
// useLenisStop(open) while a modal dialog is open.
import Lenis from "lenis";
import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { getScroller, standardCurve } from "@mengai/ui";
import { bindAnchors, headerOffset, lenisOffset, scrollPaddingTop } from "./anchor";
import { createSmoothController } from "./controller";
import { gsap, isRegistered, registerMotion, ScrollTrigger, tokSeconds } from "./gsap";
import { QUERIES, readSignals, resolveScrollTarget, type TouchPolicy } from "./policy";
import { createRefresher, watchRefresh, type Refresher } from "./refresh";

const LenisContext = createContext<Lenis | null>(null);

/** The running Lenis instance, or null (reduced motion, touch-first, server). */
export function useLenis(): Lenis | null {
  return useContext(LenisContext);
}

export interface SmoothScrollProps {
  children: ReactNode;
  /** "native" (default) keeps touch-first devices on native scroll. */
  touch?: TouchPolicy;
  /** Route in-page "#id" links through Lenis. Default true. */
  anchors?: boolean;
  /** Room above an anchor target in px; default the sticky header's height. */
  headerOffset?: number;
  /** Lenis lerp, 0 to 1. Default 0.1 (Lenis's own default). */
  lerp?: number;
}

// One refresher per page: SmoothScroll's own sources and useScrollRefresh
// calls coalesce into a single frame.
let pageLenis: Lenis | null = null;
let refresher: Refresher | null = null;
function pageRefresher(): Refresher {
  refresher ??= createRefresher(() => {
    pageLenis?.resize();
    if (isRegistered()) ScrollTrigger.refresh();
  });
  return refresher;
}

function Wiring({
  touch,
  anchors,
  offset,
  lerp,
  onLenis,
}: {
  touch: TouchPolicy;
  anchors: boolean;
  offset?: number;
  lerp: number;
  onLenis: (l: Lenis | null) => void;
}) {
  useLayoutEffect(() => {
    const target = resolveScrollTarget(getScroller(), document);
    const controller = createSmoothController<Lenis>({
      target,
      signals: () => readSignals(),
      touch,
      lerp,
      createLenis: (init) => new Lenis(init),
      ticker: gsap.ticker,
      triggers: ScrollTrigger,
      register: registerMotion,
      setScroller: (scroller) => ScrollTrigger.defaults({ scroller: scroller ?? window }),
      bindAnchors: anchors
        ? (lenis) =>
            bindAnchors(document, lenis, () => ({
              offset: lenisOffset(headerOffset(document, target.contained, offset), scrollPaddingTop(lenis.rootElement, window)),
              duration: tokSeconds("--dur-600", 600),
              easing: standardCurve,
              reduced: false,
            }))
        : undefined,
      onChange: (lenis) => {
        pageLenis = lenis;
        onLenis(lenis);
      },
    });
    controller.sync();
    const queries = Object.values(QUERIES).map((q) => matchMedia(q));
    for (const m of queries) m.addEventListener("change", controller.sync);
    const unwatch = watchRefresh({
      fonts: document.fonts,
      observe: target.contained ? [target.wrapper as HTMLElement, target.content] : [target.content],
      createObserver: typeof ResizeObserver === "undefined" ? null : (cb) => new ResizeObserver(cb),
      refresher: pageRefresher(),
    });
    return () => {
      unwatch();
      for (const m of queries) m.removeEventListener("change", controller.sync);
      controller.destroy();
    };
  }, [touch, anchors, offset, lerp, onLenis]);
  return null;
}

export function SmoothScroll({ children, touch = "native", anchors = true, headerOffset: offset, lerp = 0.1 }: SmoothScrollProps) {
  const [lenis, setLenis] = useState<Lenis | null>(null);
  return (
    <LenisContext.Provider value={lenis}>
      <div className="motion-root">
        <Wiring touch={touch} anchors={anchors} offset={offset} lerp={lerp} onLenis={setLenis} />
        {children}
      </div>
    </LenisContext.Provider>
  );
}

/**
 * Ask for one more refresh after content that SmoothScroll cannot see
 * settles: late images inside `scope` (default the document). Height changes
 * of the page are already caught by SmoothScroll; this is for a section that
 * swaps media of the same height, or mounts late. Coalesces with
 * SmoothScroll's own refreshes into one frame.
 */
export function useScrollRefresh(scope?: RefObject<HTMLElement | null>): void {
  const lenis = useLenis();
  useEffect(() => {
    const root: ParentNode = scope?.current ?? document;
    const r = pageRefresher();
    const late = Array.from(root.querySelectorAll("img")).filter((img) => !img.complete);
    for (const img of late) img.addEventListener("load", r.request, { once: true });
    r.request();
    return () => {
      for (const img of late) img.removeEventListener("load", r.request);
    };
  }, [lenis, scope]);
}

/** Stop smooth scroll while a modal is open (the dialog body scrolls natively). */
export function useLenisStop(active: boolean): void {
  const lenis = useLenis();
  useEffect(() => {
    if (!lenis || !active) return;
    lenis.stop();
    return () => lenis.start();
  }, [lenis, active]);
}
