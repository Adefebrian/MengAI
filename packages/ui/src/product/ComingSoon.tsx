// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Coming soon, shown in place of a feature this platform cannot run yet:
// a small tag (an hourglass plus the words, on the info surface with a full
// hairline, never a side stripe) and one plain line on why. The tag also
// sits inside an option on its own (ComingSoonTag). Static, never a control:
// the control it explains carries disabled and points here with
// aria-describedby.
import type { ReactNode } from "react";
import { ProductIcon } from "./icons";

export interface ComingSoonProps {
  /** the words on the tag, for example "Coming soon on Windows" */
  label: string;
  /** one plain line on why it is off */
  children?: ReactNode;
  /** for aria-describedby on the disabled control */
  id?: string;
  /** span inside inline content such as a row or a button, p on its own (the default) */
  as?: "p" | "span";
  /** false leaves the tag out, for the line under a group whose options carry their own tags */
  tag?: boolean;
}

export function ComingSoonTag({ label }: { label: string }) {
  return (
    <span className="p-soon-tag">
      <span className="p-soon-icon">
        <ProductIcon name="hourglass" size={16} />
      </span>
      <span className="p-soon-label">{label}</span>
    </span>
  );
}

export function ComingSoon({ label, children, id, as: Tag = "p", tag = true }: ComingSoonProps) {
  return (
    <Tag className="p-soon" id={id} data-soon="">
      {tag ? <ComingSoonTag label={label} /> : null}
      {children ? <span className="p-soon-why">{children}</span> : null}
    </Tag>
  );
}
