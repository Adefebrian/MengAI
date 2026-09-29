// How the company runs itself (custom.steps, JEV ui.component_recipe
// frame.poster_steps, motion.choreography pinned_sequence, motion.pin 0.8).
// Five ordered steps beside one stage of live views. At 1024 and up the
// section holds in place while the scroll advances the steps (a hidden
// track of markers, one per step; the marker crossing the middle of the
// scroller makes its step active), and each step is also a button that
// jumps to it. The stage crossfades between views; inactive views are
// hidden and inert, never stacked visibly. Below 1024 there is no pin:
// every step shows its view in flow, at full ink.
import type React from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { MediaFrame, Section, SectionHead, getScroller, prefersReducedMotion, scrollerRoot } from "@mengai/ui";
import { AskIcon, CheckCircleIcon, CodeIcon, PlanIcon, UsersIcon } from "../icons";
import { AskView, DesksView, MeetView, PlanView, ReviewView } from "../views/steps";

interface CompanyStep {
  title: string;
  body: string;
  icon: ReactNode;
  view: ReactNode;
}

export const COMPANY_STEPS: CompanyStep[] = [
  {
    title: "Kopi plans",
    body: "The CEO cat reads your goal and writes up to 12 tasks, each with an owner and what it waits on.",
    icon: <PlanIcon size={20} color="currentColor" />,
    view: <PlanView />,
  },
  {
    title: "The crew works at their desks",
    body: "Each cat takes a task for its role and works it at its own desk, in your project. Up to four work at once.",
    icon: <CodeIcon size={20} color="currentColor" />,
    view: <DesksView />,
  },
  {
    title: "They meet when it matters",
    body: "A kickoff after the plan, a sync when a review fails and a wrap-up before the report, all minuted.",
    icon: <UsersIcon size={20} color="currentColor" />,
    view: <MeetView />,
  },
  {
    title: "Kopi decides",
    body: "Crew questions go to the CEO cat, who approves them on the spot. Only what needs you comes to you.",
    icon: <AskIcon size={20} color="currentColor" />,
    view: <AskView />,
  },
  {
    title: "Nothing ships unreviewed",
    body: "A reviewer cat passes each flagged change or sends it back with notes, three rounds at most.",
    icon: <CheckCircleIcon size={20} color="currentColor" />,
    view: <ReviewView />,
  },
];

/** The marker nearest the scroller's middle line is the active step. */
function usePinnedSteps(count: number) {
  const [active, setActive] = useState(0);
  const markers = useRef<(HTMLElement | null)[]>([]);
  const refs = useMemo(
    () => Array.from({ length: count }, (_, i) => (el: HTMLElement | null) => {
      markers.current[i] = el;
    }),
    [count],
  );
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const first = markers.current.find(Boolean);
    if (!first) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = Number((e.target as HTMLElement).dataset.index);
          if (Number.isFinite(i)) setActive(i);
        }
      },
      { root: scrollerRoot(getScroller(first)), rootMargin: "-48% 0px -48% 0px", threshold: 0 },
    );
    for (const m of markers.current) if (m) io.observe(m);
    return () => io.disconnect();
  }, [count]);
  const select = useCallback((i: number) => {
    setActive(i);
    const m = markers.current[i];
    if (m && m.getClientRects().length > 0) m.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, []);
  return { active, refs, select };
}

/** The tonal thumb behind the active step (an.R13): it slides with
 *  transform; its height follows the active step without animating. */
function useThumb(list: React.RefObject<HTMLOListElement | null>, active: number) {
  const [box, setBox] = useState<{ y: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const measure = () => {
      const item = el.children[active] as HTMLElement | undefined;
      if (!item || item.offsetHeight === 0) return setBox(null);
      setBox({ y: item.offsetTop, h: item.offsetHeight });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [list, active]);
  return box;
}

export function CompanySection() {
  const headId = useId();
  const listId = useId();
  const { active, refs, select } = usePinnedSteps(COMPANY_STEPS.length);
  const list = useRef<HTMLOListElement>(null);
  const thumb = useThumb(list, active);
  const style = { "--lp-steps": String(COMPANY_STEPS.length) } as CSSProperties;
  return (
    <Section id="company" tone="layer" composition="custom" variant="steps" labelledBy={headId}>
      <SectionHead
        id={headId}
        title="Kopi runs the company. You set the goal."
        lead="One goal becomes a working day: a plan on the whiteboard, cats at their desks, meetings, a CEO who decides, and a review before anything comes back to you."
      />
      <div className="lp-steps" style={style} data-active={active}>
        <div className="lp-steps-track" aria-hidden="true">
          {COMPANY_STEPS.map((_, i) => (
            <div key={i} ref={refs[i]} className="lp-steps-marker" data-index={i} />
          ))}
        </div>
        <div className="lp-steps-pin">
          <div
            className="lp-steps-nav"
            style={thumb ? ({ "--lp-thumb-y": `${thumb.y}px`, "--lp-thumb-h": `${thumb.h}px` } as CSSProperties) : undefined}
            data-thumb={thumb ? "" : undefined}
          >
            <span className="lp-steps-thumb" aria-hidden="true" />
            <ol ref={list} className="lp-steps-list" id={listId} aria-label="How a run works">
              {COMPANY_STEPS.map((s, i) => (
                <li key={s.title} className="lp-step" data-active={i === active ? "" : undefined}>
                  <button type="button" className="lp-step-button" aria-current={i === active ? "step" : undefined} onClick={() => select(i)}>
                    <span className="lp-step-title">
                      <span className="lp-step-icon">{s.icon}</span>
                      <span className="kit-title">{s.title}</span>
                    </span>
                    <span className="kit-body">{s.body}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="lp-steps-stage">
            {COMPANY_STEPS.map((s, i) => (
              <div key={s.title} className="lp-steps-frame" data-active={i === active ? "" : undefined} aria-hidden={i === active ? undefined : "true"} inert={i !== active}>
                <MediaFrame kind="view" ratio="3/2" tone="surface">
                  {s.view}
                </MediaFrame>
              </div>
            ))}
          </div>
        </div>
        <ol className="lp-steps-flow">
          {COMPANY_STEPS.map((s) => (
            <li key={s.title} className="lp-flow-step">
              <h3 className="lp-step-title">
                <span className="lp-step-icon">{s.icon}</span>
                <span className="kit-title">{s.title}</span>
              </h3>
              <p className="kit-body">{s.body}</p>
              <MediaFrame kind="view" ratio="3/2" tone="surface">
                {s.view}
              </MediaFrame>
            </li>
          ))}
        </ol>
        <p className="kit-meta lp-steps-note">Sample views from the same scripted morning as the office above.</p>
      </div>
    </Section>
  );
}
