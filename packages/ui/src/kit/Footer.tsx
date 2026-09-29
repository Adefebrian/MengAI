// Footer: one archetype from the directions.md chrome table, named in the
// direction contract. Never the default four-column Product, Company,
// Resources, Legal block with a social row.
//   inline     brand, one line of links, legal (most product sites)
//   statement  one closing sentence at the heading step, links, legal
//   masthead   a full-width authored wordmark, then links and legal
//   letter     a short signed note, then legal
//   index      link groups for hubs and docs only (a real index)
// Links are 44px targets with the state layer; there is one top hairline.
import type { CSSProperties, ReactNode } from "react";

export type FooterVariant = "inline" | "statement" | "masthead" | "letter" | "index";

export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterProps {
  variant?: FooterVariant;
  /** Product name (inline, index, letter signature) or an SVG wordmark (masthead). */
  brand: ReactNode;
  /** The closing sentence (statement) or the note (letter). */
  statement?: ReactNode;
  links?: FooterLink[];
  groups?: { title: string; links: FooterLink[] }[];
  legal: ReactNode;
}

function Links({ links, label }: { links: FooterLink[]; label: string }) {
  return (
    <ul className="kit-footer-links" aria-label={label}>
      {links.map((l) => (
        <li key={l.href + l.label}>
          <a href={l.href}>{l.label}</a>
        </li>
      ))}
    </ul>
  );
}

export function Footer({ variant = "inline", brand, statement, links = [], groups = [], legal }: FooterProps) {
  if (variant === "index" && groups.length === 0) throw new Error("Footer: the index variant needs groups");
  const style = { "--kit-footer-groups": String(Math.max(groups.length, 1)) } as CSSProperties;
  return (
    <footer className="kit-footer" data-kit-composition="footer" data-variant={variant}>
      <div className="kit-grid">
        {variant === "statement" ? (
          <div className="kit-footer-brand">
            <p className="kit-footer-statement">{statement}</p>
          </div>
        ) : null}
        {variant === "masthead" ? <div className="kit-footer-brand">{brand}</div> : null}
        {variant === "inline" || variant === "index" ? (
          <div className="kit-footer-brand">
            <p className="kit-footer-name">{brand}</p>
          </div>
        ) : null}
        {variant === "letter" ? (
          <div className="kit-footer-brand">
            <p className="kit-body">{statement}</p>
            <p className="kit-footer-name">{brand}</p>
          </div>
        ) : null}
        {variant === "index" ? (
          <div className="kit-footer-groups" style={style}>
            {groups.map((g) => (
              <nav key={g.title} className="kit-footer-group" aria-label={g.title}>
                <h2 className="kit-meta">{g.title}</h2>
                <Links links={g.links} label={g.title} />
              </nav>
            ))}
          </div>
        ) : links.length ? (
          <Links links={links} label="Footer" />
        ) : null}
        <div className="kit-footer-legal">
          <p className="kit-meta">{legal}</p>
        </div>
      </div>
    </footer>
  );
}
