// The landing's motion engine, loaded on "/" only (a lazy chunk, so the app
// screens never pay for it): the JAL motion module on one clock.
//   SmoothScroll  Lenis as the page's one smooth scroll (off under reduced
//                 motion and on touch-first devices), in-page links clear
//                 of the sticky header
//   KitMotion 2   the kit's entrances on ScrollTrigger (tier 2, staged:
//                 blocks and items staggered, section headings rising line
//                 by line out of their masks, figures counting up); the
//                 first viewport paints finished
//   FrameScrub    the hero's one scroll-linked element (JEV
//                 motion.choreography hero scrub 0.63, target frame_scale
//                 0.17, low): one flat parent transform on the product
//                 frame. Law over JEV: growing from 0.96 at rest would leave
//                 the frame off the page's content line in the first view
//                 (stacked regions share one left and one right edge), so
//                 the same scale runs on the way out instead: the frame
//                 rests aligned at full size and recedes to 0.96 as it
//                 moves into the next section
// Everything sits in gsap.matchMedia branches that never match under
// reduced motion, so nothing is created and no ticker work starts there.
import { KitMotion, ScrollTrigger, SmoothScroll, gsap, registerMotion, useScrollRefresh } from "@mengai/motion";
import { useLayoutEffect } from "react";

const MOTION = "(prefers-reduced-motion: no-preference)";

/** The frame's scale and opacity once it has left the view. */
export const FRAME_TO = 0.96;
export const FRAME_FADE = 0.75;

function FrameScrub() {
  useLayoutEffect(() => {
    if (typeof matchMedia !== "function" || !matchMedia(MOTION).matches) return;
    registerMotion();
    const mm = gsap.matchMedia();
    mm.add(MOTION, () => {
      const el = document.querySelector<HTMLElement>("[data-lp-frame-depth]");
      if (!el) return;
      // At rest the frame sits on the page's content line at full size; as
      // it rises out of view toward the next section it recedes: a little
      // smaller and lighter, from its bottom edge, never past its own box.
      gsap.fromTo(
        el,
        { scale: 1, opacity: 1 },
        {
          scale: FRAME_TO,
          opacity: FRAME_FADE,
          ease: "none",
          scrollTrigger: { trigger: el, start: "clamp(top 12%)", end: "bottom top", scrub: true, invalidateOnRefresh: true },
        },
      );
    });
    return () => mm.revert();
  }, []);
  return null;
}

function Refresh() {
  useScrollRefresh();
  return null;
}

export default function LandingMotion() {
  return (
    <SmoothScroll>
      <KitMotion tier={2} />
      <FrameScrub />
      <Refresh />
    </SmoothScroll>
  );
}

export { ScrollTrigger };
