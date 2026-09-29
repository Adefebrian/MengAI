// Page, Section, SectionHead, Figure: the frame every kit composition sits in.
//
// Page      the root. Carries data-direction (D1 to D13, or a project's own
//           derived identity), the page's one section rhythm (data-rhythm),
//           and the default motion level (data-motion-level), and paints the
//           canvas. Wrap the AppShell with it, or put data-direction on
//           <html> and skip it.
// Section   one band of the page: a tone (base or layer) around the 4/8/12
//           column grid. Its block padding comes from the page rhythm
//           (--kit-gap-section), never from the section, so a page has one
//           rhythm. `attached` marks a band that belongs to its neighbour
//           (LogoRow, a short proof band): it takes the group gap instead.
//           Every top-level section writes data-kit-composition and
//           data-variant, so audits can check rhythm and repetition.
// SectionHead  one heading plus one lead, split across the grid or stacked.
//           Never two stacked headings, never a kicker above the heading.
// Figure    a number with its unit: tabular mono value, meta-size unit,
//           joined by a no-break space.
import { useRef, type CSSProperties, type ReactNode } from "react";
import { useKitMotion, type MotionLevel } from "./motion";

export type DirectionId =
  | "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7"
  | "D8" | "D9" | "D10" | "D11" | "D12" | "D13";

/** The 13 JAL Core directions, by id (directions.md section 7). */
export const DIRECTIONS: Record<DirectionId, string> = {
  D1: "research_notebook",
  D2: "single_signal_ledger",
  D3: "blueprint_hairline",
  D4: "bone_white_gallery",
  D5: "calm_productivity",
  D6: "clean_docs",
  D7: "warm_paper_editorial",
  D8: "quiet_care",
  D9: "cinematic_hardware",
  D10: "industrial_catalogue",
  D11: "oversized_masthead",
  D12: "friendly_consumer",
  D13: "precision_dark",
};

/** base: the page canvas; layer: the tonal band; band: the CTABand tint
 *  (--kit-band). A band never collapses into a neighbour. */
export type SectionTone = "base" | "layer" | "band";
/** The page's one section rhythm (identity.md section 1.1). */
export type SectionRhythm = "tight" | "default" | "generous";

/** Props every section-level composition accepts. */
export interface SectionFrame {
  id?: string;
  tone?: SectionTone;
  /** A band attached to its neighbour takes the group gap, not the section gap. */
  attached?: boolean;
}

export interface PageProps {
  /** A direction id, or a project's derived identity name keyed in its own CSS. */
  direction?: DirectionId | (string & {});
  /** "dark" only for an explicit dark mode (D13). Never set from the OS. */
  theme?: "dark";
  /** The one section rhythm for the whole page. Default "default". */
  rhythm?: SectionRhythm;
  /** Default entrance motion (motion.ts): none, quiet (one entrance per
   *  section, T1), or staged (items stagger, T2). Default quiet. Reduced
   *  motion and no JavaScript always render the finished page. */
  motion?: MotionLevel;
  children: ReactNode;
}

export function Page({ direction, theme, rhythm = "default", motion = "quiet", children }: PageProps) {
  const ref = useRef<HTMLDivElement>(null);
  useKitMotion(ref, motion);
  return (
    <div ref={ref} className="kit-page" data-direction={direction} data-theme={theme} data-rhythm={rhythm} data-motion-level={motion}>
      {children}
    </div>
  );
}

export interface SectionProps extends SectionFrame {
  /** Accessible name when the section has no visible heading. */
  label?: string;
  /** Id of the visible heading that names the section. */
  labelledBy?: string;
  /** The kit composition id this band renders (recipe.ts), for audits. */
  composition?: string;
  /** The composition's structural variant, for audits. */
  variant?: string;
  /** Extra class on the section element (a composition hook). */
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function Section({
  id,
  tone = "base",
  attached,
  label,
  labelledBy,
  composition = "custom",
  variant = "default",
  className,
  style,
  children,
}: SectionProps) {
  return (
    <section
      id={id}
      className={className ? `kit-section ${className}` : "kit-section"}
      data-tone={tone}
      data-attached={attached ? "" : undefined}
      data-kit-composition={composition}
      data-variant={variant}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      style={style}
    >
      <div className="kit-grid">{children}</div>
    </section>
  );
}

export interface SectionHeadProps {
  /** Heading id, so the enclosing Section can be labelled by it. */
  id: string;
  title: ReactNode;
  lead?: ReactNode;
  action?: ReactNode;
  /** split: heading columns 1 to 5, lead 7 to 12. stack: both on 1 to 8. */
  layout?: "split" | "stack";
  /** Semantic level. Visual size stays the heading role. */
  level?: 2 | 3;
}

export function SectionHead({ id, title, lead, action, layout = "split", level = 2 }: SectionHeadProps) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <div className="kit-head" data-layout={layout} data-motion="rise">
      <Heading id={id} className="kit-heading">
        {title}
      </Heading>
      {lead ? <p className="kit-lead">{lead}</p> : null}
      {action ? <div className="kit-head-action">{action}</div> : null}
    </div>
  );
}

export interface FigureProps {
  value: ReactNode;
  unit?: string;
  /** Count up once on entry (StatRow). Only a plain number counts. */
  count?: boolean;
}

/** A value and its unit. The unit is optional; the value is always tabular mono.
 *  A no-break space (U+00A0) joins them so a unit never wraps from its value. */
export function Figure({ value, unit, count }: FigureProps) {
  return (
    <>
      <span className="kit-num" data-motion={count && (typeof value === "string" || typeof value === "number") ? "count" : undefined}>
        {value}
      </span>
      {unit ? <span className="kit-unit">{" " + unit}</span> : null}
    </>
  );
}

/** Index a list item for the capped stagger (min(i, 6) x --stagger-item). */
export function staggerStyle(i: number): CSSProperties {
  return { "--kit-i": String(Math.min(i, 6)) } as CSSProperties;
}

