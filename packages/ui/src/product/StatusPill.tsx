// Status as an icon plus a word, never color alone and never a dot. The
// pill variant sits on a status-tinted fill (Badge spec); the plain variant
// is the icon in the status tone beside an ink word, for dense rows.
import type { ReactNode } from "react";
import { ProductIcon, type GlyphName } from "./icons";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface StatusPillProps {
  tone: StatusTone;
  icon: GlyphName;
  children: ReactNode;
  variant?: "pill" | "plain";
  /** full text when the word is shortened */
  title?: string;
}

export function StatusPill({ tone, icon, children, variant = "plain", title }: StatusPillProps) {
  return (
    <span className="p-status" data-tone={tone} data-variant={variant} title={title}>
      <span className="p-status-icon">
        <ProductIcon name={icon} size={16} />
      </span>
      <span className="p-status-word">{children}</span>
    </span>
  );
}
