// FAQ: real questions answered plainly.
//
// Variants (structure, not colour):
//   split  native details and summary rows in one bordered container (the
//          Rows recipe), the heading and lead on columns 1 to 4, the rows on
//          6 to 12 (the default). Keyboard and screen reader behavior come
//          from the platform: Enter or Space toggles, the open state is
//          announced. Each summary is a 44px target with the JAL state layer
//          and the focus outline; the chevron turns with transform only and
//          stops under reduced motion.
//   open   every answer visible, question and answer pairs in two columns
//          under a stacked head; for four to six short answers a reader
//          should not have to open (shipping, warranty, returns)
import { useId, type ReactNode } from "react";
import { ChevronGlyph } from "./glyphs";
import { Section, SectionHead, staggerStyle, type SectionFrame } from "./Page";

export interface FAQItem {
  q: ReactNode;
  a: ReactNode;
}

export type FAQVariant = "split" | "open";

export interface FAQProps extends SectionFrame {
  variant?: FAQVariant;
  title: ReactNode;
  lead?: ReactNode;
  items: FAQItem[];
  /** Replacement chevron from koboyo or reicon. */
  chevron?: ReactNode;
}

export function FAQ({ variant = "split", title, lead, items, chevron, id, tone, attached }: FAQProps) {
  const headingId = useId();
  if (variant === "open" && items.length % 2 !== 0) throw new Error(`FAQ open: ${items.length} items leave a dead cell; use an even count`);
  return (
    <Section id={id} tone={tone} attached={attached} labelledBy={headingId} composition="faq" variant={variant}>
      {variant === "open" ? (
        <>
          <SectionHead id={headingId} title={title} lead={lead} />
          <dl className="kit-faq-open" data-motion="rise">
            {items.map((item, i) => (
              <div key={i} className="kit-faq-pair" data-motion="item" style={staggerStyle(i)}>
                <dt className="kit-title">{item.q}</dt>
                <dd className="kit-body">{item.a}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <div className="kit-faq">
          <SectionHead id={headingId} title={title} lead={lead} layout="stack" />
          <div className="kit-faq-list" data-motion="rise" style={staggerStyle(1)}>
            {items.map((item, i) => (
              <details key={i} className="kit-faq-item">
                <summary>
                  <span className="kit-title">{item.q}</span>
                  <span className="kit-faq-chevron" aria-hidden="true">
                    {chevron ?? <ChevronGlyph />}
                  </span>
                </summary>
                <div className="kit-faq-answer">
                  <p className="kit-body">{item.a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}
