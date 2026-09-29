// CTABand: the page's close. Start aligned on the grid, carrying proof from
// the page's own world (a price, a delivery promise, a SpecRail). Never a
// centered heading and one button on plain ground with nothing from the
// product.
//
// Variants (structure, not colour):
//   split   heading and lead on 1 to 6, actions and proof on 8 to 12 (the
//           default)
//   form    heading and lead on 1 to 5, a real form (email, a size, a date)
//           with its submit on 7 to 12, proof under the form; for a close
//           that asks for one field
//   band    a full-bleed tone band (tone "band", --kit-band, one flat tint
//           of the direction's accent) with the page rhythm's padding on
//           both sides: heading on 1 to 8, lead and actions below, proof as
//           a SpecRail strip on the grid's columns; for the one close a brand
//           wants remembered
import { useId, type ReactNode } from "react";
import { Section, staggerStyle, type SectionFrame } from "./Page";

export type CTABandVariant = "split" | "form" | "band";

export interface CTABandProps extends SectionFrame {
  variant?: CTABandVariant;
  title: ReactNode;
  lead?: ReactNode;
  /** The actions; for form, the submit sits inside `form`. */
  actions?: ReactNode;
  /** Proof beside the actions: a SpecRail, a price line. */
  proof?: ReactNode;
  /** form: the <form> element with its fields and submit. */
  form?: ReactNode;
}

export function CTABand({ variant = "split", title, lead, actions, proof, form, id, tone = "layer", attached }: CTABandProps) {
  const headingId = useId();
  if (variant === "form" && !form) throw new Error("CTABand form: needs a form");
  if (variant !== "form" && !actions) throw new Error(`CTABand ${variant}: needs actions`);
  return (
    <Section
      id={id}
      tone={variant === "band" ? "band" : tone}
      attached={attached}
      labelledBy={headingId}
      composition="cta-band"
      variant={variant}
    >
      <div className="kit-cta" data-variant={variant}>
        <div className="kit-cta-text" data-motion="rise">
          <h2 id={headingId} className="kit-heading">
            {title}
          </h2>
          {lead ? <p className="kit-lead">{lead}</p> : null}
          {variant === "band" ? <div className="kit-actions">{actions}</div> : null}
        </div>
        {variant === "band" ? (
          proof ? (
            <div className="kit-cta-proof" data-motion="rise" style={staggerStyle(1)}>
              {proof}
            </div>
          ) : null
        ) : (
          <div className="kit-cta-side" data-motion="rise" style={staggerStyle(1)}>
            {variant === "form" ? form : <div className="kit-actions">{actions}</div>}
            {proof ? <div className="kit-cta-proof">{proof}</div> : null}
          </div>
        )}
      </div>
    </Section>
  );
}
