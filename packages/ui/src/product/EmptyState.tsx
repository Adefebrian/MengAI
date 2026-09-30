// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// EmptyState (Astryx): icon, a title, one sentence, at most one action. It
// fills its region, so an empty list never collapses to nothing.
import type { ReactNode } from "react";
import { ProductIcon, type GlyphName } from "./icons";

export interface EmptyStateProps {
  icon: GlyphName;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "danger";
}

export function EmptyState({ icon, title, children, action, tone = "neutral" }: EmptyStateProps) {
  return (
    <div className="p-empty" data-tone={tone} role={tone === "danger" ? "alert" : undefined}>
      <span className="p-empty-icon">
        <ProductIcon name={icon} size={24} />
      </span>
      <p className="p-empty-title">{title}</p>
      <p className="p-empty-text">{children}</p>
      {action ? <div className="p-empty-action">{action}</div> : null}
    </div>
  );
}
