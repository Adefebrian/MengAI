// Motion module (opt-in): Lenis smooth scroll on the GSAP clock, plus GSAP
// upgrades of the kit's own motion. Copy into packages/motion; see README.md.
export { SmoothScroll, useLenis, useScrollRefresh, useLenisStop } from "./SmoothScroll";
export type { SmoothScrollProps } from "./SmoothScroll";
export { KitMotion, stickyBroken } from "./KitMotion";
export type { KitMotionProps, MotionTier } from "./KitMotion";
export { wireClock, DEFAULT_LAG } from "./clock";
export type { TickerLike, LenisLike, TriggerUpdater, TickerCallback } from "./clock";
export { createSmoothController, preventNode, PREVENT_SELECTOR } from "./controller";
export type { ControllerDeps, LenisInit, SmoothController, SmoothLenis } from "./controller";
export { smoothScrollEnabled, isTouchFirst, readSignals, resolveScrollTarget, QUERIES } from "./policy";
export type { SmoothSignals, TouchPolicy, ScrollTarget } from "./policy";
export { headerOffset, scrollPaddingTop, lenisOffset, anchorTarget, scrollToAnchor, handleAnchorClick, bindAnchors } from "./anchor";
export type { ScrollToLike, AnchorOptions } from "./anchor";
export { createRefresher, watchRefresh } from "./refresh";
export type { Refresher, WatchDeps } from "./refresh";
export { splitReveal, SPLIT_VARS } from "./split";
export type { SplitEngine, SplitOptions } from "./split";
export { countTo } from "./count";
export type { CountEngine } from "./count";
export { registerMotion, isRegistered, tokSeconds, tokPx, gsap, ScrollTrigger, SplitText } from "./gsap";
