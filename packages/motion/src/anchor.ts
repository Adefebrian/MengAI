// In-page anchors through Lenis. A same-page "#id" link scrolls with Lenis
// (the page's one scroll owner) to the target minus the sticky header, on
// the standard curve, instantly under reduced motion, then moves focus to
// the target so keyboard and screen reader users land where they asked.
// ScrollToPlugin is never used on window while Lenis runs.

export interface ScrollToLike {
  scrollTo(
    target: HTMLElement | number | string,
    options?: { offset?: number; duration?: number; easing?: (t: number) => number; immediate?: boolean; onComplete?: () => void },
  ): void;
}

/**
 * The room a target needs above it: the sticky header's layout height on a
 * document shell (--shell-header-h plus the safe area; offsetHeight, so the
 * hide-on-scroll transform never changes it), else 0. A contained shell's
 * header sits outside the scroller, so it never covers a target. `explicit`
 * wins when the page passes its own offset.
 */
export function headerOffset(doc: Document, contained: boolean, explicit?: number): number {
  if (explicit !== undefined) return explicit;
  if (contained) return 0;
  const header = doc.querySelector<HTMLElement>(".shell-header, [data-jal-header]");
  if (!header) return 0;
  const view = doc.defaultView;
  const position = view ? view.getComputedStyle(header).position : "";
  if (position !== "sticky" && position !== "fixed") return 0;
  return Math.round(header.offsetHeight);
}

/** A scroll container's scroll-padding-top in px (0 when unset). */
export function scrollPaddingTop(el: Element | null, view: Pick<Window, "getComputedStyle"> | null): number {
  if (!el || !view) return 0;
  const v = parseFloat(view.getComputedStyle(el).scrollPaddingTop);
  return Number.isFinite(v) ? v : 0;
}

/**
 * The offset to hand lenis.scrollTo. Lenis already subtracts the container's
 * scroll-padding-top (ui.css sets it on html to the header height on a
 * document shell) and the target's scroll-margin-top, so only the room the
 * padding does not cover is added. Passing the full header height on top
 * of the padding would land the target a header's height too low.
 */
export function lenisOffset(room: number, containerPadding: number): number {
  return Math.max(0, Math.round(room - containerPadding));
}

/** The same-page target of a link, or null (other pages, "#", missing ids). */
export function anchorTarget(link: HTMLAnchorElement, doc: Document): HTMLElement | null {
  const href = link.getAttribute("href") ?? "";
  if (!href.startsWith("#") || href.length < 2) return null;
  let id = href.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    return null;
  }
  return doc.getElementById(id);
}

export interface AnchorOptions {
  /** Extra px above the target, beyond the container's scroll-padding (lenisOffset). */
  offset: number;
  /** Seconds. */
  duration: number;
  easing: (t: number) => number;
  reduced: boolean;
}

/** Scroll to target through Lenis, then focus it without a second scroll. */
export function scrollToAnchor(lenis: ScrollToLike, target: HTMLElement, opts: AnchorOptions): void {
  lenis.scrollTo(target, {
    offset: -opts.offset,
    duration: opts.duration,
    easing: opts.easing,
    immediate: opts.reduced,
    onComplete: () => {
      if (!target.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    },
  });
}

/** A click on an in-page link, handled; returns true when it took the click. */
export function handleAnchorClick(event: MouseEvent, lenis: ScrollToLike, doc: Document, opts: AnchorOptions): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const origin = event.target as Element | null;
  const link = origin?.closest?.("a[href^='#']") as HTMLAnchorElement | null;
  if (!link || link.hasAttribute("data-lenis-prevent") || link.target === "_blank") return false;
  const target = anchorTarget(link, doc);
  if (!target) return false;
  event.preventDefault();
  const view = doc.defaultView;
  if (view && view.location.hash !== link.hash) view.history.pushState(null, "", link.hash);
  scrollToAnchor(lenis, target, opts);
  return true;
}

/** Listen for in-page link clicks on the document; returns the unbind. */
export function bindAnchors(doc: Document, lenis: ScrollToLike, opts: () => AnchorOptions): () => void {
  const onClick = (e: MouseEvent) => {
    handleAnchorClick(e, lenis, doc, opts());
  };
  doc.addEventListener("click", onClick);
  return () => doc.removeEventListener("click", onClick);
}
