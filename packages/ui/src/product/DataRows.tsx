// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Records as rows (JAL Core List and Item): one container, rows flush
// inside it, one hairline between rows, one left content line. A row is
// one of three item types and a list uses one type: static text, a link
// that navigates, or a button that acts in place. Groups get a header row.
// Never space-between or flex-grow to fill height.
import type { MouseEvent, ReactNode } from "react";

export interface DataRowsProps {
  label: string;
  children: ReactNode;
  /** boxed: surface, hairline and radius; plain: dividers only, for a divided section */
  variant?: "boxed" | "plain";
  id?: string;
}

export function DataRows({ label, children, variant = "boxed", id }: DataRowsProps) {
  return (
    <ul className="p-rows" data-variant={variant} aria-label={label} id={id}>
      {children}
    </ul>
  );
}

export interface DataRowProps {
  title: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** link item type */
  href?: string;
  onNavigate?: (href: string, e: MouseEvent<HTMLAnchorElement>) => void;
  /** button item type */
  onPress?: () => void;
  selected?: boolean;
  /** extra content under the meta line, for example actions or a preview */
  children?: ReactNode;
  titleAttr?: string;
  ariaLabel?: string;
  /** key for data attributes in tests and the audit */
  kind?: string;
}

function RowInner({ title, meta, leading, trailing, children, titleAttr }: DataRowProps) {
  return (
    <>
      {leading !== undefined ? <span className="p-row-leading">{leading}</span> : null}
      <span className="p-row-text">
        <span className="p-row-title" title={titleAttr}>
          {title}
        </span>
        {meta !== undefined ? <span className="p-row-meta">{meta}</span> : null}
        {children}
      </span>
      {trailing !== undefined ? <span className="p-row-trailing">{trailing}</span> : null}
    </>
  );
}

export function DataRow(props: DataRowProps) {
  const { href, onPress, selected, onNavigate, ariaLabel, kind } = props;
  if (href !== undefined) {
    return (
      <li className="p-rows-item" data-kind={kind}>
        <a
          className="p-row"
          data-type="link"
          href={href}
          aria-label={ariaLabel}
          aria-current={selected ? "page" : undefined}
          data-selected={selected ? "" : undefined}
          onClick={onNavigate ? (e) => onNavigate(href, e) : undefined}
        >
          <RowInner {...props} />
        </a>
      </li>
    );
  }
  if (onPress !== undefined) {
    return (
      <li className="p-rows-item" data-kind={kind}>
        <button
          type="button"
          className="p-row"
          data-type="button"
          aria-label={ariaLabel}
          aria-pressed={selected === undefined ? undefined : selected}
          data-selected={selected ? "" : undefined}
          onClick={onPress}
        >
          <RowInner {...props} />
        </button>
      </li>
    );
  }
  return (
    <li className="p-rows-item" data-kind={kind}>
      <div className="p-row" data-type="static" data-selected={selected ? "" : undefined}>
        <RowInner {...props} />
      </div>
    </li>
  );
}

/** A group header inside a DataRows list: a label and a count, never a kicker. */
export function DataRowsGroup({ label, count }: { label: string; count?: number }) {
  return (
    <li className="p-rows-group">
      <span className="p-rows-group-label">{label}</span>
      {count !== undefined ? <span className="p-rows-group-count">{count}</span> : null}
    </li>
  );
}
