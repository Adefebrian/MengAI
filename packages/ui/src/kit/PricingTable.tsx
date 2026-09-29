// PricingTable: Carbon-structured pricing. Two to four plans in the
// hairline cell grid, one anatomy each: name (the plan's heading), price in
// tabular mono with its unit and period, one summary line, the included
// list, then the action pinned to one baseline across the row. The
// recommended plan is marked by its filled primary action and a surface
// cell (the others sit on layer-1), never by a colored edge or a badge;
// assistive tech hears it as visually hidden text in the plan heading.
// An optional comparison follows as a real table with row and column
// headers; included and not included are words, not color. From 768 the
// table shows every plan column. Below 768 it shows one plan at a time
// (Feature and that plan, so nothing scrolls or clips at 375), switched by
// a segmented control above the table; the recommended plan shows first.
import { useId, useState, type ReactNode } from "react";
import { CheckGlyph } from "./glyphs";
import { Figure, Section, SectionHead, staggerStyle, type SectionFrame } from "./Page";

export interface Plan {
  name: ReactNode;
  price: ReactNode;
  /** Currency or unit, set small beside the price, for example "IDR". */
  unit?: string;
  period?: ReactNode;
  summary: ReactNode;
  features: ReactNode[];
  action: ReactNode;
  recommended?: boolean;
}

export interface CompareRow {
  label: ReactNode;
  /** One value per plan, in plan order. true and false read as Included and Not included. */
  values: (ReactNode | boolean)[];
}

export interface PricingTableProps extends SectionFrame {
  title: ReactNode;
  lead?: ReactNode;
  plans: Plan[];
  compare?: { caption: ReactNode; rows: CompareRow[] };
  /** Replacement check glyph from koboyo or reicon. */
  check?: ReactNode;
}

function CompareCell({ value, check }: { value: ReactNode | boolean; check: ReactNode }) {
  if (value === true) {
    return (
      <>
        <span className="kit-check" role="img" aria-label="Included">
          {check}
        </span>
      </>
    );
  }
  if (value === false) return <span className="kit-meta">Not included</span>;
  return <>{value}</>;
}

export function PricingTable({ title, lead, plans, compare, check, id, tone, attached }: PricingTableProps) {
  const headingId = useId();
  const compareId = useId();
  const recommended = plans.findIndex((p) => p.recommended);
  const [shown, setShown] = useState(recommended < 0 ? 0 : recommended);
  if (plans.length < 2 || plans.length > 4) throw new Error(`PricingTable: ${plans.length} plans; use 2 to 4`);
  if (compare) {
    compare.rows.forEach((r, i) => {
      if (r.values.length !== plans.length) {
        throw new Error(`PricingTable: compare row ${i + 1} has ${r.values.length} values for ${plans.length} plans`);
      }
    });
  }
  const glyph = check ?? <CheckGlyph />;
  const md = plans.length % 2 === 0 ? 2 : 1;
  return (
    <Section id={id} tone={tone} attached={attached} labelledBy={headingId} composition="pricing" variant={compare ? "cells-compare" : "cells"}>
      <SectionHead id={headingId} title={title} lead={lead} />
      <ul className="kit-cells" data-plans="" data-lg={plans.length} data-md={md} data-motion="rise">
        {plans.map((p, i) => (
          <li key={i} className="kit-cell kit-plan" data-recommended={p.recommended ? "" : undefined} data-motion="item" style={staggerStyle(i)}>
            <h3 className="kit-title">
              {p.name}
              {p.recommended ? <span className="kit-visually-hidden"> (recommended)</span> : null}
            </h3>
            <p className="kit-plan-price">
              <Figure value={p.price} unit={p.unit} />
              {p.period ? <span className="kit-unit">{"\u00a0"}{p.period}</span> : null}
            </p>
            <p className="kit-body">{p.summary}</p>
            <ul className="kit-plan-features">
              {p.features.map((f, fi) => (
                <li key={fi}>
                  <span className="kit-check" aria-hidden="true">
                    {glyph}
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="kit-plan-action">{p.action}</div>
          </li>
        ))}
      </ul>
      {compare ? (
        <div className="kit-compare" data-motion="rise">
          <h3 className="kit-title" id={`${compareId}-title`}>
            {compare.caption}
          </h3>
          <div className="jal-segmented kit-compare-switch" role="group" aria-label="Plan to compare">
            {plans.map((p, i) => (
              <button
                key={i}
                type="button"
                aria-pressed={i === shown}
                aria-controls={`${compareId}-table`}
                onClick={() => setShown(i)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="scroll-x">
            <table className="kit-compare-table" id={`${compareId}-table`} aria-labelledby={`${compareId}-title`}>
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  {plans.map((p, i) => (
                    <th key={i} scope="col" data-off={i === shown ? undefined : ""}>
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compare.rows.map((r, ri) => (
                  <tr key={ri}>
                    <th scope="row">{r.label}</th>
                    {r.values.map((v, vi) => (
                      <td key={vi} data-off={vi === shown ? undefined : ""}>
                        <CompareCell value={v} check={glyph} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
