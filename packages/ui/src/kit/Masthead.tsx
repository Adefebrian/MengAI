// Masthead: the hero, and the only place the display role appears (one
// display element per page). Display headline (the page h1), one lead line,
// a primary action and at most one secondary, then the variant's proof or
// media. Nothing above the headline: no eyebrow, kicker, pill, or number,
// and the headline never sits in a card or a panel.
//
// Variants:
//   left      type-led, start aligned, headline on columns 1 to 10.
//   centered  for a Marquee or wordmark opening where the headline is the
//             whole composition; pair it with a centered Quote.
//   split     text on 5 columns beside media on 7 (mediaSide flips it);
//             below 1024 the text leads and the media follows. The media is
//             a MediaFrame: a real image or poster, a live data view, or an
//             honest placeholder, never a drawn product.
// The hero fills 70 to 90% of the first viewport, never 100, with bottom
// padding at least 1.3 times the top.
//
// Measure: the display size is capped by the headline's own length and its
// column (--kit-display-chars, written here from a text title), so a
// headline takes at most two lines at 640 and up and three below, balanced,
// and never grows past the direction's display step.
import { useId, type CSSProperties, type ReactNode } from "react";
import { staggerStyle, type SectionTone } from "./Page";

export type MastheadVariant = "left" | "centered" | "split";

export interface MastheadProps {
  variant?: MastheadVariant;
  /** The page h1. Text, or an authored SVG wordmark with an accessible name. */
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  /** Required for split. */
  media?: ReactNode;
  mediaSide?: "start" | "end";
  /** Real proof below the actions: a SpecRail, a StatRow-sized fact, a live input. */
  proof?: ReactNode;
  id?: string;
  tone?: SectionTone;
}

/** The headline's length in characters, when it is plain text. */
function textLength(node: ReactNode): number | null {
  if (typeof node === "string" || typeof node === "number") return String(node).length;
  return null;
}

export function Masthead({
  variant = "left",
  title,
  lead,
  actions,
  media,
  mediaSide = "end",
  proof,
  id,
  tone = "base",
}: MastheadProps) {
  const headingId = useId();
  if (variant === "split" && !media) throw new Error("Masthead: the split variant needs media");
  const chars = textLength(title);
  const measure = chars ? ({ "--kit-display-chars": String(Math.max(chars, 12)) } as CSSProperties) : undefined;

  const text = (
    <>
      <h1 id={headingId} className="kit-display" data-measure={chars !== null && chars <= 22 ? "short" : undefined} style={measure}>
        {title}
      </h1>
      {lead ? <p className="kit-lead">{lead}</p> : null}
      {actions ? <div className="kit-actions">{actions}</div> : null}
    </>
  );

  return (
    <section
      id={id}
      className="kit-masthead kit-section"
      data-kit-composition="masthead"
      data-variant={variant}
      data-media-side={variant === "split" ? mediaSide : undefined}
      data-tone={tone}
      aria-labelledby={headingId}
    >
      <div className="kit-grid">
        <div className="kit-masthead-text" data-motion="rise">
          {text}
        </div>
        {variant === "split" ? (
          <div className="kit-masthead-media" data-motion="rise" style={staggerStyle(1)}>
            {media}
          </div>
        ) : null}
        {proof ? (
          <div className="kit-masthead-proof" data-motion="rise" style={staggerStyle(2)}>
            {proof}
          </div>
        ) : null}
      </div>
    </section>
  );
}
