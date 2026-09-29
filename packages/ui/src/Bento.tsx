// Gap-consistent bento grid primitive. One gap value per breakpoint, every
// card in a grid shares the same corner radius, padding, and border weight;
// visual weight varies only by span, never by inconsistent chrome.
import type { ReactNode } from "react";

export type BentoSpan = "sm" | "wide" | "tall" | "lg";

const spanClass: Record<BentoSpan, string> = {
  sm: "bento-sm",
  wide: "bento-wide",
  tall: "bento-tall",
  lg: "bento-lg",
};

export interface BentoProps {
  children: ReactNode;
  className?: string;
  id?: string;
}

export function Bento({ children, className, id }: BentoProps) {
  const classes = ["bento", className].filter(Boolean).join(" ");
  return <div id={id} className={classes}>{children}</div>;
}

export interface BentoItemProps {
  span?: BentoSpan;
  children: ReactNode;
  className?: string;
}

export function BentoItem({ span = "sm", children, className }: BentoItemProps) {
  const classes = ["bento-item", spanClass[span], className].filter(Boolean).join(" ");
  return <div className={classes}>{children}</div>;
}

/**
 * Inline styles matching the base recipe from jal-frontend-rules, kept here
 * so consuming apps get a working grid without having to hand-copy CSS.
 * Import once (e.g. from the app's root styles.css):
 *
 *   @import "@mengai/ui/src/Bento.css";
 */
export const bentoStyles = `
.bento {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-auto-rows: auto;
  gap: var(--space-4);
}
.bento-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  border-radius: var(--radius-md);
  border: var(--border-weight) solid var(--color-border);
  background: var(--color-surface);
  padding: var(--space-4);
}

@media (min-width: 640px) {
  .bento { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .bento-lg, .bento-wide { grid-column: span 2; }
}

@media (min-width: 1024px) {
  .bento { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .bento-lg { grid-column: span 2; grid-row: span 2; }
  .bento-wide { grid-column: span 2; grid-row: span 1; }
  .bento-tall { grid-column: span 1; grid-row: span 2; }
  .bento-sm { grid-column: span 1; grid-row: span 1; }
}
`;
