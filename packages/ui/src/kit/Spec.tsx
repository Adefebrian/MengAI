// SpecRail and SpecTable: Carbon-style label and value rows, the data
// identity of every JAL page.
//
// SpecRail   a compact definition list (label in meta ink-muted, value in
//            ink, numbers in tabular mono, units at meta size). Sits inside
//            another composition: a Masthead proof slot, a Split, a CTABand.
//            layout "strip" sets the rows as up to 4 columns side by side
//            (label above value), for a spec strip under a full-width media.
// SpecTable  a full section, one heading and lead, in one of two variants
//            (structure, not colour):
//   grouped  each group name, with an optional one-line note, on columns 1
//            to 4 and its table on 5 to 12, rows at the product density (the
//            default); for a datasheet read top to bottom
//   rail     prose or media on 1 to 6 scrolls past a sticky spec rail on 8
//            to 12 that holds every group; for a spec a reader checks while
//            reading the story beside it
// The grouped tables are real <table>s with row headers, so they read as
// data to assistive tech; the rail is a definition list per group. Plan
// comparisons belong in PricingTable's compare table.
import { useId, type ReactNode } from "react";
import { Figure, Section, SectionHead, type SectionFrame } from "./Page";

export interface SpecRow {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  /** A short qualifier under the value, meta size. */
  note?: ReactNode;
  /** Set the value in tabular mono. Default: true when a unit is given or the value is a number. */
  numeric?: boolean;
  /** Marks the one key figure (the direction's signal role). */
  signal?: boolean;
}

function SpecValue({ row }: { row: SpecRow }) {
  const numeric = row.numeric ?? (row.unit !== undefined || typeof row.value === "number");
  return (
    <>
      {numeric ? <Figure value={row.value} unit={row.unit} /> : row.value}
      {row.note ? <span className="kit-spec-note">{row.note}</span> : null}
    </>
  );
}

export interface SpecRailProps {
  rows: SpecRow[];
  /** Accessible name for the list. */
  label?: string;
  /** rows (default) or strip: up to 4 columns side by side. */
  layout?: "rows" | "strip";
}

export function SpecRail({ rows, label, layout = "rows" }: SpecRailProps) {
  return (
    <dl className="kit-spec-rail" data-layout={layout} data-count={Math.min(rows.length, 4)} aria-label={label}>
      {rows.map((row, i) => (
        <div key={i} className="kit-spec-row" data-signal={row.signal ? "" : undefined}>
          <dt>{row.label}</dt>
          <dd>
            <SpecValue row={row} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface SpecGroup {
  name: ReactNode;
  /** grouped: one line under the group name. */
  note?: ReactNode;
  rows: SpecRow[];
}

export type SpecTableVariant = "grouped" | "rail";

export interface SpecTableProps extends SectionFrame {
  variant?: SpecTableVariant;
  title: ReactNode;
  lead?: ReactNode;
  groups: SpecGroup[];
  /** rail: the prose or media that scrolls beside the sticky rail. */
  prose?: ReactNode;
}

function Grouped({ groups, groupId }: { groups: SpecGroup[]; groupId: string }) {
  return (
    <div className="kit-spec-table" data-motion="rise">
      {groups.map((g, gi) => (
        <div key={gi} className="kit-spec-group">
          <div className="kit-spec-group-head">
            <h3 id={`${groupId}-${gi}`} className="kit-title">
              {g.name}
            </h3>
            {g.note ? <p className="kit-body">{g.note}</p> : null}
          </div>
          <table className="kit-spec-grid" aria-labelledby={`${groupId}-${gi}`}>
            <tbody>
              {g.rows.map((row, ri) => (
                <tr key={ri} data-signal={row.signal ? "" : undefined}>
                  <th scope="row">{row.label}</th>
                  <td>
                    <SpecValue row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function SpecTable({ variant = "grouped", title, lead, groups, prose, id, tone, attached }: SpecTableProps) {
  const headingId = useId();
  const groupId = useId();
  if (variant === "rail" && !prose) throw new Error("SpecTable rail: needs prose beside the rail");
  const frame = { id, tone, attached, labelledBy: headingId, composition: "spec-table", variant };

  let body: ReactNode;
  if (variant === "grouped") body = <Grouped groups={groups} groupId={groupId} />;
  else if (variant === "rail") {
    body = (
      <div className="kit-spec-railset">
        <div className="kit-spec-prose" data-motion="rise">
          {prose}
        </div>
        <div className="kit-spec-sticky" data-motion="rise">
          {groups.map((g, gi) => (
            <div key={gi} className="kit-spec-railgroup">
              <h3 id={`${groupId}-${gi}`} className="kit-title">
                {g.name}
              </h3>
              <SpecRail rows={g.rows} label={typeof g.name === "string" ? g.name : undefined} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Section {...frame}>
      <SectionHead id={headingId} title={title} lead={lead} layout={variant === "rail" ? "stack" : "split"} />
      {body}
    </Section>
  );
}
