// JAL Core app-shell. Every screen renders inside it, so mobile is always a
// real app-shell and never a shrunk desktop page:
//   below 640px   pinned header (compact wordmark plus one action), content,
//                 bottom bar of 3 to 5 destinations (44px+ targets)
//   640px and up  the destinations move into the header
// There is one Primary nav, so every destination is one link in the DOM: it
// sits in the header bar and is position: fixed at the bottom edge below
// 640px. Nothing above it may carry a transform below 640px (a transformed
// ancestor would capture the fixed bar), so the header condenses by moving
// its children, never the header or the bar.
//
// Chrome archetypes (skills/jal-design-system/references/chrome.md):
//   header  "island"    one floating object: an inset bar below 640px, a
//                       centred island that hugs its content from 640px,
//                       holding the wordmark, a segmented track with one
//                       sliding thumb, and the primary action
//           "rail"      edge to edge on the kit margin, transparent at the
//                       top; after 24px it steps down to a 56px surface bar
//                       with a hairline (optional hideOnScroll)
//           "masthead"  a centred nameplate over a destinations row, folding
//                       into one compact bar on scroll
//   bar     "dock"      floating inset dock, one sliding pill behind the
//                       active icon; compacts on scroll down, restores on up
//           "bar"       full-width edge bar, Material 3 navigation bar
//                       anatomy (64 by 32 pill behind the icon, label below)
//           "split"     the dock with a filled primary action segment at
//                       its end (3 or 4 destinations plus the action)
// Unset, each follows the page direction (data-direction D1 to D13 on or
// above the shell, ui.css); pass `archetype` to override. The DOM is the same
// for every archetype, so a direction default never needs JS and never shifts
// layout after hydration.
//
// Two scroll modes, picked with the `scroll` prop:
//   "document"   (default) the document scrolls. The header is sticky at top
//                0 and keeps one fixed height (--shell-header-h), so
//                condensing only moves transforms and opacity. Below 640px
//                the bottom bar is fixed at bottom 0 and the shell reserves
//                its height (--shell-nav-h plus the safe area), so no content
//                hides under it. Use it for marketing, landing, and immersive
//                pages: GSAP ScrollTrigger, Lenis, pins, iOS address-bar
//                collapse, scroll restoration, and anchor links all assume
//                document scroll and work here with zero wiring.
//   "contained"  a grid sized to the viewport; the document never scrolls and
//                main.shell-main is the scroller (marked data-jal-scroller).
//                The header keeps its condensed geometry and only changes
//                tone on scroll. Motion code on a contained shell must target
//                that scroller: call ScrollTrigger.defaults({ scroller:
//                getScroller() }) once before creating any trigger, and pass
//                the same element as the IntersectionObserver root.
//
// Behaviour (one small effect each, all SSR-safe, all cleaned up):
//   scroll state   rAF-throttled passive listener on the real scroller sets
//                  data-scrolled, data-dir, data-compact, data-hidden on the
//                  shell. Transitions live under .shell-motion, which is set
//                  only when prefers-reduced-motion is not reduce.
//   indicator      the sliding thumb or pill reads the active item's box
//                  into --shell-ind-x and --shell-ind-w on its track.
//   scrollspy      when destinations are in-page anchors, an
//                  IntersectionObserver rooted on the scroller marks the
//                  section in view as current.
//
// Styles live in ui.css (.shell*). Icons come from koboyo through <Icon>; a
// destination may be label-only.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronGlyph } from "./kit/glyphs";

export type AppShellScroll = "document" | "contained";
export type AppShellHeader = "rail" | "island" | "masthead";
export type AppShellBar = "bar" | "dock" | "split";
export type AppShellLabels = "all" | "active";

export interface AppShellArchetype {
  /** Desktop and mobile header. Unset: the direction default. */
  header?: AppShellHeader;
  /** Mobile bottom bar. Unset: the direction default. */
  bar?: AppShellBar;
  /** Bottom bar labels: on every item, or on the active item only. */
  labels?: AppShellLabels;
}

export interface AppShellDestination {
  id: string;
  label: string;
  href: string;
  icon?: ReactNode;
  /** A count, or true for a dot. Flat, never a glow. */
  badge?: number | boolean;
}

export interface AppShellAction {
  label: string;
  href: string;
  icon?: ReactNode;
}

export interface AppShellProps {
  title: string;
  destinations: AppShellDestination[];
  current: string;
  actions?: ReactNode;
  /** The one main action: a header button, and the end segment of the split bar. */
  primaryAction?: AppShellAction;
  /** A wordmark (SVG) in place of the title text; the title stays its accessible name. */
  brand?: ReactNode;
  /** Makes the wordmark a link, usually "/" or "#top". */
  brandHref?: string;
  archetype?: AppShellArchetype;
  /** Hide the header on scroll down and reveal it on scroll up (640px and up, long pages). */
  hideOnScroll?: boolean;
  /** Scrollspy for in-page anchor destinations (default on). */
  spy?: boolean;
  /** Icon for the More item when there are more than 5 destinations. */
  moreIcon?: ReactNode;
  /** Id of the main region, the skip link target. */
  mainId?: string;
  /** Who scrolls: the document (default) or the shell's main region. */
  scroll?: AppShellScroll;
  children: ReactNode;
}

/** Destinations the header and the bottom bar hold before the rest move to More. */
export const SHELL_MAX_DESTINATIONS = 5;
/** Past this many scrolled pixels the header condenses. */
export const SHELL_CONDENSE_AT = 24;

export interface ShellScrollState {
  y: number;
  /** Last scroll position a direction change was measured from. */
  anchor: number;
  dir: "up" | "down";
  scrolled: boolean;
  compact: boolean;
  hidden: boolean;
}

/**
 * The next scroll state, pure so it can be tested without a browser.
 * Direction flips only after 6px of travel, so a trackpad's jitter never
 * toggles the dock; the top of the page always reads as scrolling up.
 */
export function nextShellScroll(prev: ShellScrollState, y: number, reduced: boolean): ShellScrollState {
  let { anchor, dir } = prev;
  if (y <= 0) {
    dir = "up";
    anchor = 0;
  } else if (Math.abs(y - anchor) >= 6) {
    dir = y > anchor ? "down" : "up";
    anchor = y;
  }
  const down = dir === "down";
  return {
    y,
    anchor,
    dir,
    scrolled: y > SHELL_CONDENSE_AT,
    compact: !reduced && down && y > 64,
    hidden: !reduced && down && y > 160,
  };
}

function isDev(): boolean {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return false;
  }
}

function badgeText(badge: AppShellDestination["badge"]): string {
  if (typeof badge === "number" && badge > 0) return `, ${badge} new`;
  if (badge === true) return ", new";
  return "";
}

function Badge({ value }: { value: AppShellDestination["badge"] }) {
  if (value === true) return <span className="shell-badge" data-kind="dot" aria-hidden="true" />;
  if (typeof value === "number" && value > 0) {
    return (
      <span className="shell-badge" aria-hidden="true">
        {value > 9 ? "9+" : value}
      </span>
    );
  }
  return null;
}

/** Scroll state on the shell's data attributes, and .shell-motion when motion is allowed. */
function useShellScroll(shellRef: RefObject<HTMLDivElement | null>, contained: boolean) {
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const main = shell.querySelector<HTMLElement>(".shell-main");
    const target: HTMLElement | Window = contained && main ? main : window;
    const read = () => (target === window ? window.scrollY : (target as HTMLElement).scrollTop);
    const mql = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    let reduced = !!mql?.matches;
    let state: ShellScrollState = { y: 0, anchor: 0, dir: "up", scrolled: false, compact: false, hidden: false };
    let frame = 0;

    const flag = (name: string, on: boolean) => {
      if (shell.hasAttribute(name) !== on) shell.toggleAttribute(name, on);
    };
    const apply = () => {
      state = nextShellScroll(state, Math.max(0, read()), reduced);
      flag("data-scrolled", state.scrolled);
      flag("data-compact", state.compact);
      flag("data-hidden", state.hidden);
      if (shell.getAttribute("data-dir") !== state.dir) shell.setAttribute("data-dir", state.dir);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        apply();
      });
    };
    const setMotion = () => shell.classList.toggle("shell-motion", !reduced);
    const onMotion = (e: MediaQueryListEvent) => {
      reduced = e.matches;
      setMotion();
      apply();
    };

    apply();
    // Transitions switch on one frame after the first state is painted, so a
    // restored scroll position never animates in.
    const arm = reduced ? 0 : requestAnimationFrame(setMotion);
    target.addEventListener("scroll", onScroll, { passive: true });
    mql?.addEventListener?.("change", onMotion);
    return () => {
      target.removeEventListener("scroll", onScroll);
      mql?.removeEventListener?.("change", onMotion);
      if (frame) cancelAnimationFrame(frame);
      if (arm) cancelAnimationFrame(arm);
      shell.classList.remove("shell-motion");
    };
  }, [shellRef, contained]);
}

/** Moves a track's indicator under its visible [data-active] item. */
function useIndicator(trackRef: RefObject<HTMLElement | null>, key: string) {
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const active = Array.from(track.querySelectorAll<HTMLElement>("[data-active]")).find((el) => el.offsetWidth > 0);
      if (!active) {
        track.removeAttribute("data-ind");
        return;
      }
      track.style.setProperty("--shell-ind-x", `${active.offsetLeft}px`);
      track.style.setProperty("--shell-ind-w", `${active.offsetWidth}px`);
      track.setAttribute("data-ind", "");
    };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(track);
    return () => ro?.disconnect();
  }, [trackRef, key]);
}

/** The in-page section in view, when every spied destination is an anchor. */
function useScrollspy(shellRef: RefObject<HTMLDivElement | null>, ids: string[], enabled: boolean, contained: boolean) {
  const [spy, setSpy] = useState<string | null>(null);
  const key = ids.join("|");
  useEffect(() => {
    if (!enabled || ids.length < 2 || typeof IntersectionObserver !== "function") return;
    const shell = shellRef.current;
    if (!shell) return;
    const targets = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (targets.length < 2) return;
    const main = shell.querySelector<HTMLElement>(".shell-main");
    const root = scrollerRoot(getScroller(main));
    const header = shell.querySelector<HTMLElement>(".shell-header");
    const top = !contained && header ? header.offsetHeight : 0;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const hit = ids.find((id) => seen.get(id));
        if (hit) setSpy(hit);
      },
      { root, rootMargin: `-${top}px 0px -55% 0px`, threshold: 0 },
    );
    for (const t of targets) io.observe(t);
    return () => io.disconnect();
    // ids is keyed by `key`, so a new array with the same ids never re-observes.
  }, [shellRef, key, enabled, contained]);
  return enabled ? spy : null;
}

function closeSheet(e: { currentTarget: Element }) {
  const sheet = e.currentTarget.closest("[popover]") as (HTMLElement & { hidePopover?: () => void }) | null;
  sheet?.hidePopover?.();
}

export function AppShell({
  title,
  destinations,
  current,
  actions,
  primaryAction,
  brand,
  brandHref,
  archetype,
  hideOnScroll = false,
  spy: spyOn = true,
  moreIcon,
  mainId = "main",
  scroll = "document",
  children,
}: AppShellProps) {
  const contained = scroll === "contained";
  const shellRef = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const sheetId = `${useId()}more`;

  const anchorIds = destinations.map((d) => (d.href.startsWith("#") && d.href.length > 1 ? d.href.slice(1) : null));
  const spyIds = anchorIds.every((id) => id !== null) ? (anchorIds as string[]) : [];
  const spied = useScrollspy(shellRef, spyIds, spyOn, contained);
  const activeId = spied !== null ? destinations[spyIds.indexOf(spied)]?.id ?? current : current;
  const ci = destinations.findIndex((d) => d.id === activeId);

  const n = destinations.length;
  const max = SHELL_MAX_DESTINATIONS;
  const hasAction = primaryAction !== undefined;
  // Header and bar/dock: up to 5, or 4 plus More.
  const shown = n > max ? max - 1 : n;
  const moreBar = n > max;
  // Split with an action: up to 4 destinations, or 3 plus More, plus the action.
  const moreSplit = hasAction && n > max - 1;
  const splitShown = moreSplit ? max - 2 : shown;
  const overflowFrom = moreSplit ? max - 2 : max - 1;
  const overflow = moreBar || moreSplit ? destinations.slice(overflowFrom) : [];

  useShellScroll(shellRef, contained);
  const indKey = `${activeId}|${n}|${hasAction}`;
  useIndicator(track, indKey);

  useEffect(() => {
    if (!isDev()) return;
    if (n > max) {
      console.warn(
        `AppShell: ${n} destinations. The bottom bar law is 3 to ${max}, so the mobile bar rejects the rest: destinations ${max} and up moved to More (the header shows More too). Cut the list to ${max}.`,
      );
    } else if (n < 3) {
      console.warn(`AppShell: ${n} destinations. The bottom bar needs 3 to ${max}.`);
    }
  }, [n, max]);

  const current_ = (d: AppShellDestination) => d.id === activeId;
  const anyIcon = destinations.some((d) => d.icon !== undefined);
  const name = (d: AppShellDestination) => `${d.label}${badgeText(d.badge)}`;

  const brandInner = brand ?? title;
  const brandEl = brandHref ? (
    <a className="shell-title shell-brand" href={brandHref} aria-label={brand ? title : undefined}>
      {brandInner}
    </a>
  ) : (
    <p className="shell-title" aria-label={brand ? title : undefined}>
      {brandInner}
    </p>
  );
  // The masthead's compact mark on the condensed bar (CSS shows it only
  // there). The nameplate above stays the one named brand, so the mark is
  // hidden from assistive tech and out of the tab order.
  const markEl = brandHref ? (
    <a className="shell-mark" href={brandHref} aria-hidden="true" tabIndex={-1}>
      {brandInner}
    </a>
  ) : (
    <span className="shell-mark" aria-hidden="true">
      {brandInner}
    </span>
  );

  const moreButton = (where: "bar" | "split", active: boolean) => (
    <button
      type="button"
      className="shell-nav-item shell-more"
      data-more={where}
      data-active={active ? "" : undefined}
      popoverTarget={sheetId}
    >
      {moreIcon || anyIcon ? (
        <span className="shell-nav-icon">{moreIcon ?? <ChevronGlyph className="shell-more-glyph" />}</span>
      ) : null}
      <span className="shell-nav-label">
        <span className="shell-nav-text" data-label="More">
          More
        </span>
        <ChevronGlyph className="shell-more-glyph" />
      </span>
    </button>
  );

  return (
    <div
      ref={shellRef}
      className="shell"
      data-scroll={scroll}
      data-header={archetype?.header}
      data-bar={archetype?.bar}
      data-labels={archetype?.labels}
      data-hide={hideOnScroll ? "" : undefined}
      data-has-action={hasAction ? "" : undefined}
      data-icons={anyIcon ? "" : undefined}
    >
      <a className="shell-skip" href={`#${mainId}`}>
        Skip to content
      </a>
      <header className="shell-header">
        <div className="shell-bar">
          {brandEl}
          {markEl}
          {/* One Primary nav: the bottom bar below 640px, the header nav from 640px. */}
          <nav className="shell-nav" aria-label="Primary">
            <div className="shell-dock">
              <div className="shell-nav-track" ref={track}>
                <span className="shell-ind" aria-hidden="true" />
                {destinations.slice(0, shown).map((d, i) => (
                  <a
                    key={d.id}
                    href={d.href}
                    className="shell-nav-item"
                    aria-current={current_(d) ? "page" : undefined}
                    data-active={current_(d) ? "" : undefined}
                    data-split-overflow={hasAction && i >= splitShown ? "" : undefined}
                    aria-label={name(d)}
                  >
                    {d.icon ? (
                      <span className="shell-nav-icon">
                        {d.icon}
                        <Badge value={d.badge} />
                      </span>
                    ) : null}
                    <span className="shell-nav-label">
                      <span className="shell-nav-text" data-label={d.label}>
                        {d.label}
                      </span>
                      <Badge value={d.badge} />
                    </span>
                  </a>
                ))}
                {moreBar ? moreButton("bar", ci >= max - 1) : null}
                {moreSplit ? moreButton("split", ci >= splitShown) : null}
              </div>
              {primaryAction ? (
                <a className="shell-nav-action" href={primaryAction.href} aria-label={primaryAction.label}>
                  {primaryAction.icon ? <span className="shell-nav-action-icon">{primaryAction.icon}</span> : null}
                  <span>{primaryAction.label}</span>
                </a>
              ) : null}
            </div>
          </nav>
          <div className="shell-actions">
            {actions}
            {primaryAction ? (
              <a className="btn shell-cta" href={primaryAction.href}>
                {primaryAction.label}
              </a>
            ) : null}
          </div>
        </div>
      </header>
      <main id={mainId} className="shell-main" data-jal-scroller={contained ? "" : undefined}>
        {children}
      </main>
      {overflow.length > 0 ? (
        <div id={sheetId} className="shell-sheet" popover="auto">
          <nav aria-label="More destinations">
            {overflow.map((d, i) => (
              <a
                key={d.id}
                href={d.href}
                className="shell-nav-item shell-sheet-item"
                aria-current={current_(d) ? "page" : undefined}
                data-split-only={overflowFrom + i < max - 1 ? "" : undefined}
                aria-label={d.badge ? name(d) : undefined}
                onClick={closeSheet}
              >
                {d.icon ? <span className="shell-nav-icon">{d.icon}</span> : null}
                <span className="shell-nav-label">{d.label}</span>
                <Badge value={d.badge} />
              </a>
            ))}
          </nav>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The element that scrolls `el`, for ScrollTrigger's `scroller` and an
 * IntersectionObserver `root`. Walks up from `el` (inclusive) and returns
 * the first element that is a declared scroller (a contained shell's main, which
 * counts even before its content overflows) or that has overflow-y auto or
 * scroll and scrollHeight > clientHeight. A horizontal carousel (overflow-x
 * auto or scroll) with under 2px of vertical spill is skipped. Falls back to window, which is the
 * answer for a document-mode shell. Without `el` it returns the page's
 * declared scroller, else window. Browser only: call it in an effect.
 *
 * On a contained shell, call once after mount (inside useGSAP or
 * useLayoutEffect, never at module top level) before creating any trigger:
 *   ScrollTrigger.defaults({ scroller: getScroller() });
 *   new IntersectionObserver(cb, { root: scrollerRoot(getScroller()) });
 */
export function getScroller(el?: Element | null): Element | Window {
  if (!el) {
    const declared = document.querySelector("[data-jal-scroller]");
    return declared ?? window;
  }
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node === document.body || node === document.documentElement) break;
    if (node.hasAttribute("data-jal-scroller")) return node;
    const { overflowX, overflowY } = getComputedStyle(node);
    const spill = node.scrollHeight - node.clientHeight;
    // A horizontal carousel (overflow-x auto or scroll) computes overflow-y to
    // auto too, and often spills a pixel of rounding vertically. That is not a
    // vertical scroller; skip it unless it truly overflows by 2px or more.
    if ((overflowX === "auto" || overflowX === "scroll") && spill < 2) continue;
    if ((overflowY === "auto" || overflowY === "scroll") && spill > 0) return node;
  }
  return window;
}

/** IntersectionObserver wants null for the viewport, not window. */
export function scrollerRoot(scroller: Element | Window): Element | null {
  return scroller instanceof Element ? scroller : null;
}
