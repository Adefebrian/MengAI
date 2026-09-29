// The boards on the walls: the CEO's plan whiteboard, where each plan card
// is a note that slides to its new column when its status changes (a CSS
// transform transition on the note, keyed by card id), and the meeting
// room's agenda board, where agenda items tick off as the talk moves round
// and the notes are written up line by line when the meeting ends.
import type { CSSProperties } from "react";
import type { OfficeMeeting, OfficeProps } from "../office-contract";
import type { Rect } from "./geometry";
import { Glyph, MICRO } from "./art";
import { fit, measure, type TextStyle } from "./text";

type PlanCard = NonNullable<OfficeProps["plan"]>[number];

const COLUMNS: Array<{ key: PlanCard["status"]; word: string }> = [
  { key: "todo", word: "To do" },
  { key: "doing", word: "Doing" },
  { key: "review", word: "Review" },
  { key: "done", word: "Done" },
];

const MICRO_MED: TextStyle = { size: 11, weight: 500 };

function latestMove(cards: PlanCard[]): PlanCard | null {
  return [...cards].reverse().find((c) => c.status !== "todo") ?? cards[0] ?? null;
}

/** A plan card's owner, as a tiny cat head in its coat. */
export type Owners = Map<string, { coat: string }>;

function Token({ x, y, coat, s = 1 }: { x: number; y: number; coat: string | null; s?: number }) {
  return (
    <g className={coat ? "cat of-token" : "of-token"} data-coat={coat ?? undefined} transform={`translate(${x} ${y}) scale(${s})`}>
      <path className="of-token-head" d="M1.2 4.2 L2 0.4 L4.6 2.6 L7.4 2.6 L10 0.4 L10.8 4.2 C 11.6 8.6 9 10 6 10 C 3 10 0.4 8.6 1.2 4.2 Z" />
    </g>
  );
}

/**
 * The CEO's plan board (JEV imm.concept c4, the signature): four columns,
 * each plan card a note with its owner's coat on it. When a task moves, its
 * note slides to the new column; a delivered one pops as it is pinned. A
 * wide board writes each title on its card; a small one shows the notes as
 * coat tokens and names the latest move underneath.
 */
export function Whiteboard({ r, cards, flash, owners, title = "Plan" }: { r: Rect; cards: PlanCard[]; flash: number; owners: Owners; title?: string }) {
  const pad = 8;
  const gap = 6;
  const colW = (r.w - pad * 2 - gap * 3) / 4;
  const titled = colW >= 88 && r.h >= 90;
  const done = cards.filter((c) => c.status === "done").length;
  const latest = latestMove(cards);
  const lastDone = [...cards].reverse().find((c) => c.status === "done")?.id ?? null;
  // titled: the column heads are the top row and the count of done names the progress
  const headY = titled ? r.y + pad + 11 : r.y + pad + 11;
  const colY = titled ? headY : headY + 17;
  const notesTop = colY + (titled ? 7 : 6);
  const captionY = r.y + r.h - pad + 1;
  const noteH = titled ? 17 : 11;
  const noteGap = 3;
  const noteW = titled ? colW : 13;
  const perRow = titled ? 1 : Math.max(1, Math.floor((colW + noteGap) / (noteW + noteGap)));
  const floor = titled ? r.y + r.h - pad : captionY - 12;
  const rows = Math.max(1, Math.floor((floor - notesTop + noteGap) / (noteH + noteGap)));
  const cap = rows * perRow;
  const place = new Map<string, { x: number; y: number; hidden: boolean }>();
  const overflow: Array<{ x: number; y: number; n: number }> = [];
  COLUMNS.forEach((col, ci) => {
    const x0 = r.x + pad + ci * (colW + gap);
    const list = cards.filter((c) => c.status === col.key);
    const shown = list.length > cap ? cap - 1 : list.length;
    list.forEach((c, i) => {
      const k = Math.min(i, shown);
      place.set(c.id, { x: titled ? x0 : x0 + (k % perRow) * (noteW + noteGap), y: notesTop + Math.floor(k / perRow) * (noteH + noteGap), hidden: i >= shown });
    });
    if (list.length > shown) overflow.push({ x: titled ? x0 + 4 : x0 + (shown % perRow) * (noteW + noteGap), y: notesTop + Math.floor(shown / perRow) * (noteH + noteGap), n: list.length - shown });
  });
  return (
    <g className="of-whiteboard">
      <rect className="of-board" x={r.x} y={r.y} width={r.w} height={r.h} rx={5} />
      <rect className="of-tray" x={r.x + r.w * 0.3} y={r.y + r.h - 1} width={r.w * 0.4} height={5} rx={2} />
      <rect className="of-marker" x={r.x + r.w * 0.34} y={r.y + r.h - 1} width={14} height={3} rx={1.5} />
      {titled ? null : (
        <>
          <text className="of-t of-t-n1 of-ink of-medium" x={r.x + pad} y={headY}>
            {title}
          </text>
          <text className="of-t of-t-n2 of-muted of-num" x={r.x + r.w - pad} y={headY} textAnchor="end">
            {fit(`${done} of ${cards.length} done`, r.w / 2 - pad, MICRO)}
          </text>
        </>
      )}
      {COLUMNS.map((col, ci) => {
        const x = r.x + pad + ci * (colW + gap);
        const count = cards.filter((c) => c.status === col.key).length;
        const countText = titled && col.key === "done" ? `${count} of ${cards.length}` : String(count);
        const head = fit(col.word, colW - measure(countText, MICRO) - 8, MICRO_MED);
        return (
          <g key={col.key}>
            {ci > 0 ? <rect className="of-board-rule" x={x - gap / 2 - 0.5} y={colY - 10} width={1} height={floor - colY + 10} /> : null}
            <text className="of-t of-t-n2 of-muted of-medium" x={x} y={colY}>
              {head}
            </text>
            <text className="of-t of-t-n2 of-subtle of-num" x={x + colW} y={colY} textAnchor="end">
              {countText}
            </text>
          </g>
        );
      })}
      {cards.map((c) => {
        const at = place.get(c.id);
        if (!at) return null;
        const pinned = flash > 0 && c.id === lastDone;
        const coat = c.ownerId ? owners.get(c.ownerId)?.coat ?? null : null;
        return (
          <g key={c.id} className="of-plan-card" data-hidden={at.hidden ? "" : undefined} style={{ transform: `translate(${at.x}px, ${at.y}px)` } as CSSProperties}>
            <g key={pinned ? `pin-${flash}` : "rest"} className={pinned ? "of-pinned" : undefined}>
              <rect className={`of-note of-note-${c.status}`} x={0} y={0} width={noteW} height={noteH} rx={2} />
              {titled ? (
                <>
                  <Token x={4} y={3.5} coat={coat} />
                  <text className="of-t of-t-n2 of-ink" x={20} y={12.5}>
                    {fit(c.title, noteW - 24, MICRO)}
                  </text>
                </>
              ) : (
                <Token x={1} y={0.6} coat={coat} s={0.92} />
              )}
            </g>
          </g>
        );
      })}
      {overflow.map((o, i) => (
        <text key={i} className="of-t of-t-n2 of-subtle of-num" x={o.x} y={o.y + (titled ? 12.5 : 9.5)}>
          +{o.n}
        </text>
      ))}
      {cards.length === 0 ? (
        <text className="of-t of-t-n2 of-subtle" x={r.x + pad} y={notesTop + 11}>
          {fit("No plan yet", r.w - pad * 2, MICRO)}
        </text>
      ) : null}
      {latest && !titled ? (
        <text className="of-t of-t-n2 of-muted" x={r.x + pad} y={captionY}>
          {fit(`${COLUMNS.find((c) => c.key === latest.status)?.word ?? ""}: ${latest.title}`, r.w - pad * 2, MICRO)}
        </text>
      ) : null}
    </g>
  );
}

/**
 * The meeting room's board: the title and whether it is in session; while
 * it runs, the agenda with each discussed item ticked and the current one
 * marked; after it, the notes, written up one line after another.
 */
export function AgendaBoard({ r, meeting, running, title, agenda, notes, discussed, freeTitle }: { r: Rect; meeting: OfficeMeeting | null; running: boolean; title: string; agenda: string[]; notes: string[]; discussed: number; freeTitle: string }) {
  const pad = 9;
  const titleStyle: TextStyle = { size: 13, weight: 500 };
  const status = running ? "In session" : meeting ? "Notes" : "Free";
  const statusW = measure(status, MICRO) + 12;
  const stacked = r.w < 230;
  const heading = fit(running || meeting ? title : freeTitle, r.w - pad * 2 - (stacked ? 0 : statusW + 8), titleStyle);
  const headY = r.y + pad + 11;
  const first = headY + (stacked ? 32 : 18);
  const pitch = 15;
  const fitRows = Math.max(0, Math.floor((r.y + r.h - pad - first + pitch - 2) / pitch));
  const list = running ? agenda : notes;
  const lines = list.slice(0, fitRows);
  const statusX = stacked ? r.x + pad : r.x + r.w - pad;
  return (
    <g className="of-agenda" data-running={running ? "" : undefined}>
      <rect className="of-board" x={r.x} y={r.y} width={r.w} height={r.h} rx={5} />
      <text className="of-t of-t-n1 of-ink of-medium" x={r.x + pad} y={headY}>
        {heading}
      </text>
      {running ? <circle className="of-live-dot" cx={stacked ? statusX + 3 : statusX - measure(status, MICRO) - 8} cy={(stacked ? headY + 16 : headY) - 4} r={3} /> : null}
      <text className={`of-t of-t-n2 ${running ? "of-tone-success" : "of-muted"}`} x={stacked ? statusX + 10 : statusX} y={stacked ? headY + 16 : headY} textAnchor={stacked ? "start" : "end"}>
        {status}
      </text>
      {lines.map((line, i) => {
        const y = first + i * pitch;
        const ticked = running && i < discussed;
        const now = running && i === discussed;
        return (
          <g key={`${running ? "a" : "n"}${i}`} className={running ? undefined : "of-line-in"} style={running ? undefined : ({ ["--of-i" as string]: String(i) } as CSSProperties)}>
            {running ? (
              ticked ? (
                <Glyph name="check" x={r.x + pad - 1} y={y - 10} size={11} className="of-glyph of-tone-success" />
              ) : (
                <circle className={now ? "of-agenda-now" : "of-agenda-dot"} cx={r.x + pad + 4.5} cy={y - 4} r={now ? 3 : 2} />
              )
            ) : (
              <rect className="of-note-bullet" x={r.x + pad + 1} y={y - 6} width={6} height={2} rx={1} />
            )}
            <text className={`of-t of-t-n2 ${ticked ? "of-subtle" : "of-muted"}`} x={r.x + pad + 15} y={y}>
              {fit(line, r.w - pad * 2 - 15, MICRO)}
            </text>
          </g>
        );
      })}
      {!running && !meeting && lines.length === 0 ? (
        <text className="of-t of-t-n2 of-subtle" x={r.x + pad} y={first}>
          {fit("The crew meets here", r.w - pad * 2, MICRO)}
        </text>
      ) : null}
    </g>
  );
}
