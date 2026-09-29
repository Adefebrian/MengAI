// FeatureGrid: capabilities presented side by side. One anatomy per item:
// an optional inline icon on the title row (never a tile above it), the
// title (the item's only heading), one or two sentences, and per variant a
// media or a meta value. Counts are validated so no cell or row is dead.
// Mixed claims belong in a BentoGrid instead.
//
// Proximity: short items (a title and a sentence) always share one grouped
// surface, the hairline cell grid, which on a phone is a single panel with a
// hairline between rows; separate tiles only for items that carry media.
//
// Variants (structure, not colour):
//   cells   truly equivalent capabilities in the hairline cell grid, 2, 3,
//           or 4 columns (the default)
//   rows    spec-led rows: title on 1 to 4, body on 5 to 9, a measured
//           meta value on 10 to 12, hairlines between rows; for
//           capabilities that each carry a number
//   detail  list with detail: the items as a selectable list on 1 to 5,
//           the active item's media on 7 to 12 (a tab pattern, keyboard
//           arrows, the first item active without JavaScript); for 3 to 5
//           capabilities that each need a picture
//   lead    two large media tiles over the other four as one hairline cell
//           group (exactly 6 items); for a pair of headline capabilities and
//           their supporting four
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Section, SectionHead, staggerStyle, type SectionFrame } from "./Page";

export interface Feature {
  title: ReactNode;
  body: ReactNode;
  /** A koboyo or reicon glyph through <Icon>, 20px, on the title row. */
  icon?: ReactNode;
  /** detail and the two large lead tiles: a MediaFrame. */
  media?: ReactNode;
  /** rows: a measured value, set in tabular figures. */
  meta?: ReactNode;
}

export type FeatureGridVariant = "cells" | "rows" | "detail" | "lead";

export interface FeatureGridProps extends SectionFrame {
  variant?: FeatureGridVariant;
  title: ReactNode;
  lead?: ReactNode;
  items: Feature[];
  /** cells: 2, 3, or 4. */
  columns?: 2 | 3 | 4;
}

function ItemTitle({ f }: { f: Feature }) {
  return (
    <h3 className="kit-title kit-feature-title">
      {f.icon ? (
        <span className="icon" aria-hidden="true">
          {f.icon}
        </span>
      ) : null}
      <span>{f.title}</span>
    </h3>
  );
}

function validate(variant: FeatureGridVariant, n: number, columns: number) {
  if (variant === "cells") {
    if (n < columns || n % columns !== 0) {
      throw new Error(`FeatureGrid: ${n} items do not fill ${columns} columns; use a multiple of ${columns}`);
    }
  }
  if (variant === "rows" && n < 2) throw new Error("FeatureGrid rows: use at least 2 items");
  if (variant === "detail" && (n < 3 || n > 5)) throw new Error(`FeatureGrid detail: ${n} items; use 3 to 5`);
  if (variant === "lead" && n !== 6) throw new Error(`FeatureGrid lead: ${n} items; use exactly 6 (2 large, 4 small)`);
}

function Detail({ items, baseId }: { items: Feature[]; baseId: string }) {
  const [active, setActive] = useState(0);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const n = (next + items.length) % items.length;
    setActive(n);
    (document.getElementById(`${baseId}-tab-${n}`) as HTMLButtonElement | null)?.focus();
  };
  return (
    <div className="kit-detail">
      <div className="kit-detail-list" role="tablist" aria-orientation="vertical" data-motion="rise">
        {items.map((f, i) => (
          <button
            key={i}
            id={`${baseId}-tab-${i}`}
            type="button"
            role="tab"
            className="kit-detail-tab"
            aria-selected={i === active}
            aria-controls={`${baseId}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            data-active={i === active ? "" : undefined}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span className="kit-title">{f.title}</span>
            <span className="kit-body">{f.body}</span>
          </button>
        ))}
      </div>
      <div className="kit-detail-stage" data-motion="rise" style={staggerStyle(1)}>
        {items.map((f, i) => (
          <div
            key={i}
            id={`${baseId}-panel-${i}`}
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-${i}`}
            className="kit-detail-panel"
            hidden={i !== active}
          >
            {f.media}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FeatureGrid({ variant = "cells", title, lead, items, columns = 3, id, tone, attached }: FeatureGridProps) {
  const headingId = useId();
  const baseId = "kit" + headingId.replace(/[^a-zA-Z0-9_-]/g, "");
  validate(variant, items.length, columns);
  const md = items.length % 2 === 0 ? 2 : 1;
  const frame = { id, tone, attached, labelledBy: headingId, composition: "feature-grid", variant };

  let body: ReactNode;
  if (variant === "cells") {
    body = (
      <ul className="kit-cells" data-lg={columns} data-md={md} data-motion="rise">
        {items.map((f, i) => (
          <li key={i} className="kit-cell" data-motion="item" style={staggerStyle(i)}>
            <ItemTitle f={f} />
            <p className="kit-body">{f.body}</p>
          </li>
        ))}
      </ul>
    );
  } else if (variant === "rows") {
    body = (
      <ul className="kit-rows" data-motion="rise">
        {items.map((f, i) => (
          <li key={i} className="kit-row" data-motion="item" style={staggerStyle(i)}>
            <ItemTitle f={f} />
            <p className="kit-body">{f.body}</p>
            {f.meta !== undefined ? <p className="kit-row-meta kit-num">{f.meta}</p> : null}
          </li>
        ))}
      </ul>
    );
  } else if (variant === "detail") {
    body = <Detail items={items} baseId={baseId} />;
  } else {
    body = (
      <>
        <ul className="kit-lead-grid" data-motion="rise">
          {items.slice(0, 2).map((f, i) => (
            <li key={i} className="kit-tile" data-motion="item" style={staggerStyle(i)}>
              {f.media ? <div className="kit-tile-media">{f.media}</div> : null}
              <div className="kit-tile-text">
                <ItemTitle f={f} />
                <p className="kit-body">{f.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <ul className="kit-cells" data-lg={4} data-md={2} data-motion="rise">
          {items.slice(2).map((f, i) => (
            <li key={i} className="kit-cell" data-motion="item" style={staggerStyle(i + 2)}>
              <ItemTitle f={f} />
              <p className="kit-body">{f.body}</p>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <Section {...frame}>
      <SectionHead id={headingId} title={title} lead={lead} />
      {body}
    </Section>
  );
}
