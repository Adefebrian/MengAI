// BentoGrid and BentoTile: a fully occupied grid of unequal tiles, each one
// real claim or view. The layout is a declared area map (CSS
// grid-template-areas rows), validated before render:
//   - every row has the same number of cells,
//   - no dead cell ("." or an area with no tile),
//   - every area is one rectangle,
//   - every tile has an area in the map, and no two tiles share one,
//   - only media tiles may span more than one row (a text, stat, or list
//     tile stretched over two rows opens a void inside the card).
// lg applies at 1024 and up (2 to 4 columns), md at 640 to 1023 (1 or 2
// columns, optional); without md the tiles stack in source order below 1024.
//
// Variants: three declared layout maps per tile count (BENTO_PRESETS), so a
// page never hand-draws the same lead-left map twice. A preset names the
// structure (lead-left, lead-right, band, row, lead-center, columns, grid,
// stagger); `layout` still takes a hand-declared map (variant "custom").
//
// Tile kinds share one chrome (surface, full hairline, the direction's card
// radius) and differ only in anatomy:
//   media  a visual that fills the tile, then a title and caption below it
//   stat   a Figure at the heading step, then one caption line
//   text   a title, then one or two sentences
//   list   a title, then label and value rows
import { Children, Fragment, isValidElement, useId, type CSSProperties, type ReactNode } from "react";
import { Figure, Section, SectionHead, type SectionFrame } from "./Page";

export type BentoKind = "media" | "stat" | "text" | "list";

export interface BentoLayout {
  /** 1024 and up: grid-template-areas rows, for example ["a a b", "a a c"]. */
  lg: string[];
  /** 640 to 1023, optional: at most 2 columns. */
  md?: string[];
}

export interface BentoTileProps {
  area: string;
  kind: BentoKind;
  title?: ReactNode;
  body?: ReactNode;
  value?: ReactNode;
  unit?: string;
  items?: { label: ReactNode; value: ReactNode; unit?: string }[];
  media?: ReactNode;
  /** Marks the one key figure (the direction's signal role). */
  signal?: boolean;
}

interface TileRef {
  area: string;
  kind: BentoKind;
}

function parseRows(rows: string[]): string[][] {
  return rows.map((r) => r.trim().split(/\s+/).filter(Boolean));
}

/** Returns every problem with a layout map; an empty list means it is lawful. */
export function validateBentoLayout(rows: string[], tiles: TileRef[], maxCols = 4): string[] {
  const errors: string[] = [];
  if (rows.length === 0) return ["the layout map has no rows"];
  const grid = parseRows(rows);
  const cols = grid[0].length;
  if (cols === 0) errors.push("the first row has no cells");
  if (cols > maxCols) errors.push(`${cols} columns is more than ${maxCols}`);
  grid.forEach((row, i) => {
    if (row.length !== cols) errors.push(`row ${i + 1} has ${row.length} cells, expected ${cols}`);
  });
  const boxes = new Map<string, { r0: number; r1: number; c0: number; c1: number; count: number }>();
  grid.forEach((row, r) =>
    row.forEach((name, c) => {
      if (/^\.+$/.test(name)) {
        errors.push(`dead cell at row ${r + 1}, column ${c + 1}`);
        return;
      }
      const b = boxes.get(name);
      if (!b) boxes.set(name, { r0: r, r1: r, c0: c, c1: c, count: 1 });
      else {
        b.r0 = Math.min(b.r0, r);
        b.r1 = Math.max(b.r1, r);
        b.c0 = Math.min(b.c0, c);
        b.c1 = Math.max(b.c1, c);
        b.count += 1;
      }
    }),
  );
  const byArea = new Map(tiles.map((t) => [t.area, t]));
  for (const [name, b] of boxes) {
    const size = (b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1);
    if (size !== b.count) errors.push(`area "${name}" is not one rectangle`);
    const tile = byArea.get(name);
    if (!tile) errors.push(`dead cells: area "${name}" has no tile`);
    else if (b.r1 > b.r0 && tile.kind !== "media") {
      errors.push(`area "${name}" spans ${b.r1 - b.r0 + 1} rows but is a ${tile.kind} tile; only media tiles may span rows`);
    }
  }
  const seen = new Set<string>();
  for (const t of tiles) {
    if (seen.has(t.area)) errors.push(`area "${t.area}" is used by more than one tile`);
    seen.add(t.area);
    if (!boxes.has(t.area)) errors.push(`tile "${t.area}" is not in the layout map`);
  }
  return errors;
}

/** Children with every Fragment opened, at any depth. Children.toArray does
 *  not descend into a Fragment, so a tile wrapped in <></> would be missed. */
function flatten(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) out.push(...flatten(child.props.children));
    else out.push(child);
  });
  return out;
}

function areasValue(rows: string[]): string {
  return parseRows(rows)
    .map((r) => `"${r.join(" ")}"`)
    .join(" ");
}

/** Three declared maps per tile count. `media` names the areas that span
 *  rows, which must hold media tiles. Areas are named a, b, c, ... in
 *  reading order (the first cell of each area, row by row), so the tiles'
 *  source order is the order a sighted reader meets them at every width. */
export const BENTO_PRESETS: Record<number, Record<string, BentoLayout & { media: string[] }>> = {
  3: {
    "lead-left": { lg: ["a a b", "a a c"], md: ["a a", "b c"], media: ["a"] },
    "lead-right": { lg: ["a b b", "c b b"], md: ["a a", "b b", "c c"], media: ["b"] },
    row: { lg: ["a b c"], md: ["a a", "b c"], media: [] },
  },
  4: {
    "lead-left": { lg: ["a a b c", "a a d d"], md: ["a a", "b c", "d d"], media: ["a"] },
    "lead-right": { lg: ["a b c c", "d d c c"], md: ["a b", "c c", "d d"], media: ["c"] },
    band: { lg: ["a a a b", "c d d d"], md: ["a a", "b c", "d d"], media: [] },
  },
  5: {
    "lead-left": { lg: ["a a b c", "a a d e"], md: ["a a", "b c", "d e"], media: ["a"] },
    "lead-center": { lg: ["a b b c", "d b b e"], md: ["a a", "b b", "c d", "e e"], media: ["b"] },
    columns: { lg: ["a b b c", "a d e c"], md: ["a a", "b b", "c d", "e e"], media: ["a", "c"] },
  },
  6: {
    "lead-left": { lg: ["a a b c", "a a d e", "f f f f"], md: ["a a", "b c", "d e", "f f"], media: ["a"] },
    grid: { lg: ["a b c", "d e f"], md: ["a b", "c d", "e f"], media: [] },
    stagger: { lg: ["a a b c", "d e f f"], md: ["a a", "b c", "d e", "f f"], media: [] },
  },
};

/** The preset map for a tile count, or an error naming the choices. */
export function bentoPreset(count: number, name: string): BentoLayout {
  const byCount = BENTO_PRESETS[count];
  if (!byCount) throw new Error(`BentoGrid: no presets for ${count} tiles; use 3 to 6 or declare a layout`);
  const p = byCount[name];
  if (!p) throw new Error(`BentoGrid: no "${name}" preset for ${count} tiles; use ${Object.keys(byCount).join(", ")}`);
  return { lg: p.lg, md: p.md };
}

export interface BentoGridProps extends SectionFrame {
  title?: ReactNode;
  lead?: ReactNode;
  /** Accessible name when there is no title. */
  label?: string;
  /** A named preset for the tile count (BENTO_PRESETS). */
  preset?: string;
  /** A hand-declared map, when no preset carries the content. */
  layout?: BentoLayout;
  children: ReactNode;
}

export function BentoGrid({ title, lead, label, preset, layout: declared, children, id, tone, attached }: BentoGridProps) {
  const headingId = useId();
  const tiles: TileRef[] = [];
  for (const child of flatten(children)) {
    if (isValidElement<BentoTileProps>(child) && typeof child.props.area === "string") {
      tiles.push({ area: child.props.area, kind: child.props.kind });
    }
  }
  if (!preset && !declared) throw new Error("BentoGrid: pass a preset or a layout");
  const layout = declared ?? bentoPreset(tiles.length, preset!);
  const errors = validateBentoLayout(layout.lg, tiles, 4);
  if (layout.md) {
    for (const e of validateBentoLayout(layout.md, tiles, 2)) errors.push(`md: ${e}`);
  }
  if (errors.length) throw new Error(`BentoGrid layout: ${errors.join("; ")}`);

  const style = {
    "--kit-bento-lg": areasValue(layout.lg),
    "--kit-bento-lg-cols": String(parseRows(layout.lg)[0].length),
    ...(layout.md
      ? { "--kit-bento-md": areasValue(layout.md), "--kit-bento-md-cols": String(parseRows(layout.md)[0].length) }
      : {}),
  } as CSSProperties;

  return (
    <Section
      id={id}
      tone={tone}
      attached={attached}
      labelledBy={title ? headingId : undefined}
      label={title ? undefined : label}
      composition="bento"
      variant={declared ? "custom" : preset}
    >
      {title ? <SectionHead id={headingId} title={title} lead={lead} /> : null}
      <div className="kit-bento" data-has-md={layout.md ? "" : undefined} data-motion="rise" style={style}>
        {children}
      </div>
    </Section>
  );
}

export function BentoTile({ area, kind, title, body, value, unit, items, media, signal }: BentoTileProps) {
  const style = { "--kit-area": area } as CSSProperties;
  return (
    <div className="kit-bento-tile" data-kind={kind} data-signal={signal ? "" : undefined} data-motion="item" style={style}>
      {kind === "media" ? (
        <>
          <div className="kit-bento-visual">{media}</div>
          {title || body ? (
            <div className="kit-bento-caption">
              {title ? <h3 className="kit-title">{title}</h3> : null}
              {body ? <p className="kit-body">{body}</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
      {kind === "stat" ? (
        <>
          <p className="kit-bento-stat">
            <Figure value={value} unit={unit} count />
          </p>
          {body ? <p className="kit-body">{body}</p> : null}
        </>
      ) : null}
      {kind === "text" ? (
        <>
          {title ? <h3 className="kit-title">{title}</h3> : null}
          {body ? <p className="kit-body">{body}</p> : null}
        </>
      ) : null}
      {kind === "list" ? (
        <>
          {title ? <h3 className="kit-title">{title}</h3> : null}
          <ul className="kit-bento-list">
            {(items ?? []).map((it, i) => (
              <li key={i}>
                <span className="kit-body">{it.label}</span>
                <span>
                  <Figure value={it.value} unit={it.unit} />
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
