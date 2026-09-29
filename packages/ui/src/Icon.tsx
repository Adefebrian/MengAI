// Shared icon wrapper. Every icon in the product renders through this
// component so size, stroke width, and color token are enforced centrally,
// never per usage.
//
// Sourcing order (see jal-frontend-rules):
//   1. Query the koboyo MCP first for the glyph. Pass the resulting SVG
//      markup (or a React component it returns) as `children`.
//   2. Only if koboyo has no match, fall back to https://reicon.dev/ and
//      paste that glyph's SVG as `children` instead.
//   3. Never hand-draw or pick a third icon source.
import type { CSSProperties, ReactNode } from "react";

export interface IconProps {
  children: ReactNode;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
}

export function Icon({ children, size = 20, strokeWidth = 1.75, color, label }: IconProps) {
  const style: CSSProperties = {
    width: size,
    height: size,
    color: color ?? "var(--color-text)",
    strokeWidth,
    display: "inline-flex",
    flex: "0 0 auto",
  };

  return (
    <span
      className="icon"
      role={label ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={style}
    >
      {children}
    </span>
  );
}
