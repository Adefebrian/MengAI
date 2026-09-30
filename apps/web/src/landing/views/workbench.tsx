// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The workbench views (sections/Workbench.tsx): what the app shows while
// the company works. The code editor types Cemong's real change line by line
// when it scrolls into view (under 5 s, once per visit, every line shown at
// once under reduced motion); the timeline fills in step with it. Beside
// them, Oyen's decision log and the minutes of the last sync. Sample data.
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Cat, rosterCrew } from "@mengai/cats";
import { ROLE_LABEL } from "@mengai/shared";
import { usePrefersReducedMotion } from "@mengai/ui";
import { AskIcon, CheckIcon } from "../icons";
import { CrewCat, crew } from "./crew";

export const EXPORT_FILE = "src/report/export.ts";

export const EXPORT_CODE = [
  'import type { Sale } from "./types";',
  "",
  'const HEADER = ["date", "item", "qty", "total"];',
  "",
  "/** One CSV row per sale, quoting any field with a comma. */",
  "export function toCsv(sales: Sale[]): string {",
  "  const rows = sales.map((s) => [",
  "    s.date,",
  "    s.item,",
  "    String(s.qty),",
  "    s.total.toFixed(2),",
  "  ]);",
  "  return [HEADER, ...rows]",
  '    .map((r) => r.map(quote).join(","))',
  '    .join("\\n");',
  "}",
  "",
  "function quote(field: string): string {",
  "  return /[\",\\n]/.test(field)",
  '    ? `"${field.replaceAll(\'"\', \'""\')}"`',
  "    : field;",
  "}",
  "",
  "/** The file name for one day of sales. */",
  "export function fileName(day: string): string {",
  "  return `sales-${day}.csv`;",
  "}",
];

/** One line per LINE_MS while typing: the new function lands in about 1 s. */
const LINE_MS = 200;
/** The file already holds the export and its quoting when the tile opens;
 *  Cemong is adding the last function, so the editor is never an empty pane. */
export const START_LINES = 22;

/** Lines typed so far: 0 until the editor is in view, then up to the whole file. */
export function useTyping(ref: RefObject<HTMLElement | null>, total = EXPORT_CODE.length): number {
  const reduced = usePrefersReducedMotion();
  const [typed, setTyped] = useState(total);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (reduced || !el || typeof IntersectionObserver === "undefined") return;
    setTyped(Math.min(START_LINES, total));
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setStarted(true);
          io.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, reduced]);
  useEffect(() => {
    if (!started || reduced) return;
    if (typed >= total) return;
    const timer = setTimeout(() => setTyped((n) => Math.min(total, n + 1)), LINE_MS);
    return () => clearTimeout(timer);
  }, [started, reduced, typed, total]);
  return reduced ? total : typed;
}

const KEYWORDS = /\b(import|type|from|const|export|function|return)\b/g;

function CodeLine({ text }: { text: string }) {
  if (text.trim().startsWith("/**")) return <span className="lp-code-comment">{text}</span>;
  const parts: { t: string; k: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(KEYWORDS)) {
    if (m.index! > last) parts.push({ t: text.slice(last, m.index), k: false });
    parts.push({ t: m[0], k: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ t: text.slice(last), k: false });
  return (
    <>
      {parts.map((p, i) =>
        p.k ? (
          <span key={i} className="lp-code-key">
            {p.t}
          </span>
        ) : (
          p.t
        ),
      )}
    </>
  );
}

export function EditorView({ typed }: { typed: number }) {
  const total = EXPORT_CODE.length;
  const done = typed >= total;
  return (
    <div className="lp-editor">
      <div className="lp-editor-head">
        <CrewCat id="cemong" activity={done ? "run" : "code"} />
        <span className="lp-row-text">
          <span className="lp-view-strong">{done ? "Cemong saved the file" : "Cemong is writing"}</span>
          <span className="kit-num lp-view-muted lp-clip" title={EXPORT_FILE}>
            {EXPORT_FILE}
          </span>
        </span>
        <span className="lp-view-muted lp-row-end">
          <span className="kit-num">+{typed}</span> lines
        </span>
      </div>
      <pre className="lp-code" tabIndex={0} aria-label={`${EXPORT_FILE}, ${typed} of ${total} lines`} style={{ "--lp-lines": String(total) } as CSSProperties}>
        <code>
          {EXPORT_CODE.slice(0, typed).map((line, i) => (
            <span key={i} className="lp-code-line" data-caret={i === typed - 1 && !done ? "" : undefined}>
              <span className="lp-code-no" aria-hidden="true">
                {i + 1}
              </span>
              <span className="lp-code-text">
                <CodeLine text={line} />
              </span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/** The live log: every event of the morning, in order; `at` is the typed line it lands on. */
export const EVENTS = [
  { at: 0, time: "10:08", who: "oyen", what: "planned 6 tasks" },
  { at: 0, time: "10:09", who: "klepon", what: "handed Cemong the button sketch" },
  { at: 0, time: "10:12", who: "cemong", what: "opened export.ts" },
  { at: 0, time: "10:13", who: "cemong", what: "edited export.ts" },
  { at: 12, time: "10:14", who: "tempe", what: "asked Oyen to review first" },
  { at: 16, time: "10:15", who: "oyen", what: "approved Tempe's request" },
  { at: 22, time: "10:16", who: "cemong", what: "ran bun test, 12 passed" },
  { at: 25, time: "10:17", who: "cemong", what: "added fileName to export.ts" },
  { at: 27, time: "10:18", who: "cemong", what: "handed the export to Tempe" },
];

/** The log shows its newest rows: the same count as the decision log beside it, so both tiles end on one line. */
export const LOG_ROWS = 5;

export function TimelineView({ typed }: { typed: number }) {
  const shown = EVENTS.filter((e) => e.at <= typed).slice(-LOG_ROWS);
  return (
    <ol className="lp-rows lp-timeline" aria-label="Timeline" style={{ "--lp-rows": String(LOG_ROWS) } as CSSProperties}>
      {shown.map((e) => (
        <li key={e.time + e.what} className="lp-row lp-row-time">
          <span className="kit-num lp-view-muted">{e.time}</span>
          <span className="lp-row-text">
            <span className="lp-view-strong">{crew(e.who).name}</span>
            <span className="lp-view-muted lp-clip" title={e.what}>
              {e.what}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

const DECISIONS = [
  { who: "onde", ask: "Add a CSV fixture?", ok: true },
  { who: "klepon", ask: "Label it Export CSV?", ok: true },
  { who: "tempe", ask: "Review before tests?", ok: true },
  { who: "cilok", ask: "Scan the new route?", ok: true },
  { who: "cemong", ask: "Add a new package?", ok: false },
];

export function DecisionsView() {
  return (
    <ol className="lp-rows" aria-label="Oyen's decisions">
      {DECISIONS.map((d) => (
        <li key={d.ask} className="lp-row">
          <span className="lp-row-text">
            <span className="lp-view-strong lp-clip" title={d.ask}>
              {d.ask}
            </span>
            <span className="lp-state" data-state={d.ok ? "ok" : "wait"}>
              {d.ok ? <CheckIcon size={16} color="currentColor" /> : <AskIcon size={16} color="currentColor" />}
              {d.ok ? `Approved for ${crew(d.who).name}` : "Sent to you"}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The eight cats at the sync (round C: the owner asked for eight, two rows
 * of four, a name under each), from the shared crew roster so every cat
 * wears the coat it wears everywhere else. From 640 the seat grid stretches
 * to the minutes list beside it, so the two blocks end on one line.
 */
export const SYNC_SEATS = rosterCrew(["Oyen", "Cemong", "Klepon", "Tempe", "Onde", "Cilok", "Bakwan", "Serabi"]);

export function MinutesView() {
  return (
    <div className="lp-minutes">
      <ul className="lp-seats" aria-label="At the sync">
        {SYNC_SEATS.map((c) => (
          <li key={c.id}>
            <Cat
              look={{ coat: c.coat, seed: c.seed }}
              role={c.role}
              status="working"
              activity={c.role === "lead" ? "plan" : "think"}
              mood="focused"
              label={`${c.name}, ${c.role === "lead" ? "CEO" : ROLE_LABEL[c.role]}`}
              size={48}
            />
            <span className="lp-view-muted lp-seat-name">{c.name}</span>
          </li>
        ))}
      </ul>
      <ol className="lp-rows" aria-label="Decisions from the sync">
        <li className="lp-row lp-row-icon">
          <CheckIcon size={16} color="currentColor" />
          <span className="lp-view-strong">The button says Export CSV</span>
        </li>
        <li className="lp-row lp-row-icon">
          <CheckIcon size={16} color="currentColor" />
          <span className="lp-view-strong">Onde runs the tests next</span>
        </li>
        <li className="lp-row lp-row-icon">
          <CheckIcon size={16} color="currentColor" />
          <span className="lp-view-strong">Header row: date, item, qty, total</span>
        </li>
        <li className="lp-row lp-row-icon">
          <CheckIcon size={16} color="currentColor" />
          <span className="lp-view-strong">Tempe reviews it once more</span>
        </li>
      </ol>
    </div>
  );
}

/** A ref for the editor tile, shared with the timeline. */
export function useEditorRef() {
  return useRef<HTMLDivElement>(null);
}
