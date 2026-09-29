// Key value rows: a description list, label in ink-muted over or beside
// the value, one hairline between pairs. Numbers read in tabular mono.
import type { ReactNode } from "react";

export interface KeyValueItem {
  label: string;
  value: ReactNode;
  /** tabular mono for counts, clocks, ids and paths */
  mono?: boolean;
}

export interface KeyValueProps {
  items: KeyValueItem[];
  /** stack label over value at every width */
  stacked?: boolean;
  label?: string;
}

export function KeyValue({ items, stacked = false, label }: KeyValueProps) {
  return (
    <dl className="p-kv" data-stacked={stacked ? "" : undefined} aria-label={label}>
      {items.map((item) => (
        <div className="p-kv-row" key={item.label}>
          <dt className="p-kv-label">{item.label}</dt>
          <dd className="p-kv-value" data-mono={item.mono ? "" : undefined}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
