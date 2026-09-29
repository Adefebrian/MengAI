// Quote: one real, attributed quote, carried by type alone (the heading
// step, the direction's display face). No left rule, no quote-mark glyph
// as ornament, no card. Real people only: never a stock placeholder name.
//
// Variants (structure, not colour):
//   pull     a large pull quote on columns 1 to 9 (or centered 2 to 11)
//            with the name below (the default)
//   results  the quote and name on 1 to 7, the customer's own results (two
//            or three figures, tabular, a structural rule above each) on 9
//            to 12; for a case-study voice that has numbers behind it
import type { ReactNode } from "react";
import { Figure, Section, staggerStyle, type SectionFrame } from "./Page";

export type QuoteVariant = "pull" | "results";

export interface QuoteMetric {
  value: ReactNode;
  unit?: string;
  caption: ReactNode;
}

export interface QuoteProps extends SectionFrame {
  variant?: QuoteVariant;
  quote: ReactNode;
  name: ReactNode;
  role?: ReactNode;
  /** pull: start (default) or center, matching the page's one alignment. */
  align?: "start" | "center";
  /** results: 2 or 3 of the customer's own results. */
  metrics?: QuoteMetric[];
  /** Accessible name for the section. */
  label?: string;
}

export function Quote({
  variant = "pull",
  quote,
  name,
  role,
  align = "start",
  metrics,
  label = "Customer quote",
  id,
  tone,
  attached,
}: QuoteProps) {
  if (variant === "results" && (!metrics || metrics.length < 2 || metrics.length > 3)) {
    throw new Error(`Quote results: ${metrics?.length ?? 0} metrics; use 2 or 3`);
  }
  const figure = (
    <figure className="kit-quote" data-align={variant === "pull" ? align : "start"} data-motion="rise">
      <blockquote>
        <p className="kit-quote-text">{quote}</p>
      </blockquote>
      <figcaption>
        <span className="kit-quote-name">{name}</span>
        {role ? <span className="kit-meta">{role}</span> : null}
      </figcaption>
    </figure>
  );
  return (
    <Section id={id} tone={tone} attached={attached} label={label} composition="quote" variant={variant}>
      {variant === "results" ? (
        <div className="kit-quote-results">
          {figure}
          <ul className="kit-quote-metrics" data-count={metrics!.length} data-motion="rise" style={staggerStyle(1)}>
            {metrics!.map((m, i) => (
              <li key={i}>
                <p className="kit-quote-metric">
                  <Figure value={m.value} unit={m.unit} count />
                </p>
                <p className="kit-meta">{m.caption}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        figure
      )}
    </Section>
  );
}
