// Status notice: an icon with its own shape per tone, a title that names
// the state, a tonal surface and one full hairline on all four sides.
// Never a side stripe, never a bar, never a shadow.
import type { ReactNode } from "react";
import { ProductIcon, type GlyphName } from "./icons";

export type NoticeTone = "info" | "success" | "warning" | "danger";

const TONE_ICON: Record<NoticeTone, GlyphName> = {
  info: "infoCircle",
  success: "checkCircle",
  warning: "alertTriangle",
  danger: "alertCircle",
};

export interface NoticeProps {
  tone: NoticeTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
}

export function Notice({ tone, title, children, action, onDismiss }: NoticeProps) {
  return (
    <div className="p-notice" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <span className="p-notice-icon">
        <ProductIcon name={TONE_ICON[tone]} size={20} />
      </span>
      <div className="p-notice-body">
        <p className="p-notice-title">{title}</p>
        {children ? <div className="p-notice-text">{children}</div> : null}
        {action ? <div className="p-notice-action">{action}</div> : null}
      </div>
      {onDismiss ? (
        <button type="button" className="p-icon-btn" aria-label="Dismiss" onClick={onDismiss}>
          <ProductIcon name="close" size={20} />
        </button>
      ) : null}
    </div>
  );
}
