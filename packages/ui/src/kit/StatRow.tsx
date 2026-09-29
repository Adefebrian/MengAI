// StatRow: real figures read together. Each is a value in tabular figures
// at the heading step (never a giant display numeral, never a hero), its
// unit at meta size, and one short caption; the value counts up once on
// entry when it is a plain number (motion.ts, width locked). Never the
// page's first section: a big-number hero is banned.
//
// Variants (structure, not colour):
//   row     2 to 4 figures across the grid, a structural rule above each,
//           an optional SectionHead above (the default)
//   lead    the heading and one lead sentence on columns 1 to 5, the
//           figures as a 2 by 2 block on 7 to 12; for a claim the numbers
//           then prove
//   chart   the heading and 2 to 4 figures on 1 to 5, one short chart
//           (a MediaFrame view) on 7 to 12; for numbers that have a shape
//           over time
import { useId, type ReactNode } from "react";
import { Figure, Section, SectionHead, staggerStyle, type SectionFrame } from "./Page";

export interface Stat {
  value: ReactNode;
  unit?: string;
  caption: ReactNode;
  /** Marks the one key figure (the direction's signal role). */
  signal?: boolean;
}

export type StatRowVariant = "row" | "lead" | "chart";

export interface StatRowProps extends SectionFrame {
  variant?: StatRowVariant;
  /** Required for lead and chart; optional for row. */
  title?: ReactNode;
  lead?: ReactNode;
  /** Accessible name when there is no title. */
  label?: string;
  stats: Stat[];
  /** chart: the short chart beside the figures. */
  chart?: ReactNode;
}

function StatItem({ s, i }: { s: Stat; i: number }) {
  return (
    <li className="kit-stat" data-signal={s.signal ? "" : undefined} data-motion="item" style={staggerStyle(i)}>
      <p className="kit-stat-value">
        <Figure value={s.value} unit={s.unit} count />
      </p>
      <p className="kit-body">{s.caption}</p>
    </li>
  );
}

export function StatRow({ variant = "row", title, lead, label, stats, chart, id, tone, attached }: StatRowProps) {
  const headingId = useId();
  if (stats.length < 2 || stats.length > 4) throw new Error(`StatRow: ${stats.length} stats; use 2 to 4`);
  if (variant !== "row" && !title) throw new Error(`StatRow ${variant}: needs a title`);
  if (variant === "chart" && !chart) throw new Error("StatRow chart: needs a chart");
  const frame = { id, tone, attached, composition: "stat-row", variant };
  const labelled = title ? { labelledBy: headingId } : { label };

  if (variant === "row") {
    return (
      <Section {...frame} {...labelled}>
        {title ? <SectionHead id={headingId} title={title} lead={lead} /> : null}
        <ul className="kit-stats" data-count={stats.length} data-motion="rise">
          {stats.map((s, i) => (
            <StatItem key={i} s={s} i={i} />
          ))}
        </ul>
      </Section>
    );
  }

  return (
    <Section {...frame} {...labelled}>
      <div className="kit-statrow" data-variant={variant}>
        <div className="kit-statrow-intro" data-motion="rise">
          <h2 id={headingId} className="kit-heading">
            {title}
          </h2>
          {lead ? <p className="kit-lead">{lead}</p> : null}
        </div>
        <ul className="kit-stats" data-count={stats.length} data-motion="rise">
          {stats.map((s, i) => (
            <StatItem key={i} s={s} i={i} />
          ))}
        </ul>
        {variant === "chart" ? (
          <div className="kit-statrow-chart" data-motion="rise" style={staggerStyle(1)}>
            {chart}
          </div>
        ) : null}
      </div>
    </Section>
  );
}
