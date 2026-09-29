// Tabs (JAL Core): 44 tall, selected = layer-2 fill + weight 600 + ink,
// one full-width hairline under the list, never an underline or a stripe.
// One tab stop; Left and Right move focus, Home and End jump, Enter or
// Space selects (manual activation, a panel may load data). Overflowing
// tabs scroll inside the list with a hard edge.
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  label: string;
  items: TabItem[];
  selected: string;
  onSelect: (id: string) => void;
  idPrefix: string;
}

export function tabId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

export function panelId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}

export function Tabs({ label, items, selected, onSelect, idPrefix }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const focusAt = (index: number) => {
    const tabs = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    if (!tabs || tabs.length === 0) return;
    const i = (index + tabs.length) % tabs.length;
    tabs[i]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = typeof document !== "undefined" && document.dir === "rtl";
    const next = rtl ? "ArrowLeft" : "ArrowRight";
    const prev = rtl ? "ArrowRight" : "ArrowLeft";
    if (e.key === next) focusAt(index + 1);
    else if (e.key === prev) focusAt(index - 1);
    else if (e.key === "Home") focusAt(0);
    else if (e.key === "End") focusAt(items.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div className="p-tabs" role="tablist" aria-label={label} ref={listRef}>
      {items.map((item, index) => {
        const on = item.id === selected;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="p-tab"
            id={tabId(idPrefix, item.id)}
            aria-selected={on}
            aria-controls={panelId(idPrefix, item.id)}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(item.id)}
            onKeyDown={(e) => onKey(e, index)}
          >
            <span className="p-tab-label">{item.label}</span>
            {item.count !== undefined ? <span className="p-tab-count">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idPrefix, id, selected, children }: { idPrefix: string; id: string; selected: boolean; children: ReactNode }) {
  return (
    <div
      className="p-tabpanel"
      role="tabpanel"
      id={panelId(idPrefix, id)}
      aria-labelledby={tabId(idPrefix, id)}
      hidden={!selected}
    >
      {selected ? children : null}
    </div>
  );
}
