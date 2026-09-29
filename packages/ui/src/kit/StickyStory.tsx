// StickyStory: a scroll story. At 1024 and up the whole story pins, the
// viewport less the header: the steps (columns 1 to 5), each sized to its
// content and a group gap apart, center as one dense list beside a sticky
// media stage (7 to 12), so the text column never spreads a title per
// screen. The
// active step reads in ink, the others stay on screen muted (never hidden),
// and the stage shows the active step's media. Scroll length comes from a
// hidden track of markers, one per step, sized so every step gets the same
// pinned scroll; the marker crossing the middle of the real scroller makes
// its step active. Below 1024 there is no pin: each step shows its own
// media in flow, all at full ink.
//
// Variants: stage-end (media on 7 to 12, the default) and stage-start
// (media on 1 to 6, steps on 8 to 12), so two stories on a product never
// rhyme. Prefer stage-end for 3 steps or fewer: the text reads first and
// the short list stays dense at the start of the row.
//
// useStickyStory drives it with an IntersectionObserver rooted on the real
// scroller (getScroller from AppShell, after mount), so it works on a
// document shell and on a contained shell alike. Under reduced motion the
// frames swap with no travel and no fade (CSS), and without
// IntersectionObserver the first step stays active. Step media renders
// twice (stage and in flow, one shown per width), so it must not carry
// element ids. Every frame fills the same stage cell (stretched, one grid
// area), so the active frame fully covers the others during a crossfade,
// and an inactive frame is aria-hidden and inert: never read, focused, or
// counted as stuck content. The motion module (scrubStories in KitMotion, under
// templates/modules/motion) upgrades the swap to a scrubbed crossfade when
// GSAP is on the page.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { getScroller, scrollerRoot } from "../AppShell";
import { Section, SectionHead, type SectionFrame } from "./Page";

export interface StoryStep {
  title: ReactNode;
  body: ReactNode;
  media: ReactNode;
}

export interface StickyStoryState {
  active: number;
  /** Callback ref for the marker of step i. */
  stepRef: (index: number) => (el: HTMLElement | null) => void;
}

/** The marker nearest the scroller's middle line is active. */
export function useStickyStory(count: number): StickyStoryState {
  const [active, setActive] = useState(0);
  const nodes = useRef<(HTMLElement | null)[]>([]);
  const refs = useMemo(
    () => Array.from({ length: count }, (_, i) => (el: HTMLElement | null) => {
      nodes.current[i] = el;
    }),
    [count],
  );
  const stepRef = useCallback((index: number) => refs[index], [refs]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const first = nodes.current.find(Boolean);
    if (!first) return;
    const root = scrollerRoot(getScroller(first));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.index);
          if (Number.isFinite(index)) setActive(index);
        }
      },
      { root, rootMargin: "-48% 0px -48% 0px", threshold: 0 },
    );
    for (const node of nodes.current) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [count]);

  return { active, stepRef };
}

export type StickyStoryVariant = "stage-end" | "stage-start";

export interface StickyStoryProps extends SectionFrame {
  variant?: StickyStoryVariant;
  title: ReactNode;
  lead?: ReactNode;
  steps: StoryStep[];
}

export function StickyStory({ variant = "stage-end", title, lead, steps, id, tone, attached }: StickyStoryProps) {
  const headingId = useId();
  const { active, stepRef } = useStickyStory(steps.length);
  if (steps.length < 2 || steps.length > 5) throw new Error(`StickyStory: ${steps.length} steps; use 2 to 5`);
  const style = { "--kit-story-count": String(steps.length) } as CSSProperties;
  return (
    <Section id={id} tone={tone} attached={attached} labelledBy={headingId} composition="sticky-story" variant={variant}>
      <SectionHead id={headingId} title={title} lead={lead} />
      <div className="kit-story" data-variant={variant} data-active-index={active} style={style}>
        <div className="kit-story-track" aria-hidden="true">
          {steps.map((_, i) => (
            <div key={i} ref={stepRef(i)} className="kit-story-marker" data-index={i} />
          ))}
        </div>
        <div className="kit-story-pin">
          <ol className="kit-story-steps">
            {steps.map((s, i) => (
              <li
                key={i}
                className="kit-story-step"
                data-index={i}
                data-active={i === active ? "" : undefined}
                aria-current={i === active ? "step" : undefined}
              >
                <h3 className="kit-title">{s.title}</h3>
                <p className="kit-body">{s.body}</p>
                <div className="kit-story-step-media">{s.media}</div>
              </li>
            ))}
          </ol>
          <div className="kit-story-stage">
            <div className="kit-story-frames">
              {steps.map((s, i) => (
                <div
                  key={i}
                  className="kit-story-frame"
                  data-index={i}
                  data-active={i === active ? "" : undefined}
                  aria-hidden={i === active ? undefined : "true"}
                  inert={i !== active}
                >
                  {s.media}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
