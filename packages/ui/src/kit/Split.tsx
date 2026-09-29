// Split: one statement beside one piece of proof, on asymmetric spans of
// the 12 columns (text/media: 5/7, 7/5, 4/8, 8/4). The media slot takes a
// MediaFrame, a live product fragment built from JAL components, or a
// SpecRail. Below 1024 the two stack; mobileMedia says which comes first.
//
// Variants (structure, not colour):
//   inset      text and a framed media on the ratio (the default)
//   bleed      the media runs past the grid to the viewport edge on its
//              side, square on that edge, framed on the other; the text
//              stays on the grid. For one hero-grade product view per page.
//   over-spec  text across the top (heading 1 to 5, lead and actions 7 to
//              12), the media full width below, then the extra slot (a
//              SpecRail) as a strip of columns. For a claim whose proof is
//              a handful of measured values.
import { useId, type ReactNode } from "react";
import { Section, staggerStyle, type SectionFrame } from "./Page";

export type SplitRatio = "5/7" | "7/5" | "4/8" | "8/4";
export type SplitVariant = "inset" | "bleed" | "over-spec";

export interface SplitProps extends SectionFrame {
  title: ReactNode;
  lead?: ReactNode;
  /** Extra content under the lead: a SpecRail, a short list, a paragraph. */
  children?: ReactNode;
  actions?: ReactNode;
  media: ReactNode;
  variant?: SplitVariant;
  /** Text span / media span. Default 5/7. Ignored by over-spec. */
  ratio?: SplitRatio;
  /** Which side the media takes at 1024 and up. Default end. */
  mediaSide?: "start" | "end";
  /** Below 1024: media before or after the text. Default after. */
  mobileMedia?: "before" | "after";
}

export function Split({
  title,
  lead,
  children,
  actions,
  media,
  variant = "inset",
  ratio = "5/7",
  mediaSide = "end",
  mobileMedia = "after",
  id,
  tone,
  attached,
}: SplitProps) {
  const headingId = useId();
  const overSpec = variant === "over-spec";
  return (
    <Section id={id} tone={tone} attached={attached} labelledBy={headingId} composition="split" variant={variant}>
      <div
        className="kit-split"
        data-variant={variant}
        data-ratio={overSpec ? undefined : ratio}
        data-media-side={overSpec ? undefined : mediaSide}
        data-mobile-media={mobileMedia}
      >
        <div className="kit-split-text" data-motion="rise">
          <h2 id={headingId} className="kit-heading">
            {title}
          </h2>
          {lead || (overSpec && actions) ? (
            <div className="kit-split-lead">
              {lead ? <p className="kit-lead">{lead}</p> : null}
              {overSpec && actions ? <div className="kit-actions">{actions}</div> : null}
            </div>
          ) : null}
          {!overSpec && children ? <div className="kit-split-extra">{children}</div> : null}
          {!overSpec && actions ? <div className="kit-actions">{actions}</div> : null}
        </div>
        <div className="kit-split-media" data-motion="rise" style={staggerStyle(1)}>
          {media}
        </div>
        {overSpec && children ? (
          <div className="kit-split-spec" data-motion="rise" style={staggerStyle(2)}>
            {children}
          </div>
        ) : null}
      </div>
    </Section>
  );
}
