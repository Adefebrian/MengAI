// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A text chip (JAL Core Token): a short label in a full hairline box, for
// dependencies, scopes and tags. Static, never a control, never a dot. An
// optional icon carries the state so the word never relies on color.
import type { ReactNode } from "react";
import { ProductIcon, type GlyphName } from "./icons";

export interface ChipProps {
  children: ReactNode;
  icon?: GlyphName;
  /** full text when the chip ellipsizes */
  title?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}

export function Chip({ children, icon, title, tone = "neutral" }: ChipProps) {
  return (
    <span className="p-chip" data-tone={tone} title={title}>
      {icon ? (
        <span className="p-chip-icon">
          <ProductIcon name={icon} size={16} />
        </span>
      ) : null}
      <span className="p-chip-text">{children}</span>
    </span>
  );
}
