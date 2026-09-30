// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The company feed (JEV ui.region_gate card, ui.component_recipe core.ai_chat
// with layer an.R21 at 0.78): the meetings the crew held and the requests
// the CEO cat decided, in the order they happened, newest at the foot next
// to the note box, the way a team channel reads. The list scrolls inside
// the card and follows the newest entry unless you scrolled up to read. A
// meeting shows its agenda while the crew is at the table, then its notes
// and what was agreed. A request shows who asked, the question, and the
// CEO's answer with an icon and a word (approved or declined), never color
// alone. New entries enter once; under reduced motion they just appear.
import { ProductIcon } from "@mengai/ui/src/product";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MeetingState, RequestState, RunState } from "../../store/runStore";
import { fmtClock } from "../format";
import { T, useMotionLevel } from "../motion";
import { isFinished } from "../status";
import { RegionHead } from "../ui";
import { MessageBox } from "./MessageBox";
import { leadOf } from "./office";

const MEETING_WORD: Record<MeetingState["kind"], string> = {
  kickoff: "Kickoff",
  sync: "Sync",
  review: "Review meeting",
  wrapup: "Wrap-up",
};

type Entry =
  | { kind: "meeting"; key: string; ts: number; meeting: MeetingState }
  | { kind: "request"; key: string; ts: number; request: RequestState }
  | { kind: "note"; key: string; ts: number; text: string };

export function feedEntries(state: RunState, notes: Array<{ ts: number; text: string }> = []): Entry[] {
  const out: Entry[] = [];
  for (const id of state.meetingOrder) {
    const m = state.meetings[id];
    if (m) out.push({ kind: "meeting", key: `m-${m.id}`, ts: m.startedAt, meeting: m });
  }
  for (const id of state.requestOrder) {
    const r = state.requests[id];
    if (r) out.push({ kind: "request", key: `r-${r.id}`, ts: r.raisedAt, request: r });
  }
  notes.forEach((n, i) => out.push({ kind: "note", key: `n-${i}-${n.ts}`, ts: n.ts, text: n.text }));
  return out.sort((a, b) => a.ts - b.ts);
}

function nameOf(state: RunState, id: string | null | undefined, fallback = "A cat"): string {
  return (id && state.agents[id]?.name) || fallback;
}

function names(state: RunState, ids: string[]): string {
  const list = ids.map((id) => state.agents[id]?.name).filter((n): n is string => !!n);
  if (list.length === 0) return "The crew";
  if (list.length === 1) return list[0]!;
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** "Kickoff, ended: Oyen and Gembul", or "Ended: ..." when the title already says kickoff. */
function meetingMeta(meeting: MeetingState, live: boolean, who: string): string {
  const named = meeting.title.toLowerCase().startsWith(MEETING_WORD[meeting.kind].toLowerCase());
  const state = live ? "at the table now" : "ended";
  const line = named ? `${state}: ${who}` : `${MEETING_WORD[meeting.kind]}, ${state}: ${who}`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function MeetingEntry({ meeting, state }: { meeting: MeetingState; state: RunState }) {
  const live = meeting.endedAt === null;
  return (
    <>
      <p className="feed-head">
        <span className="feed-icon" aria-hidden="true">
          <ProductIcon name="users" size={20} />
        </span>
        <span className="feed-title">{meeting.title}</span>
        <span className="feed-time num">{fmtClock(meeting.startedAt)}</span>
      </p>
      <p className="feed-meta">{meetingMeta(meeting, live, names(state, meeting.agentIds))}</p>
      {live ? (
        meeting.agenda.length > 0 ? (
          <ul className="feed-points" aria-label="Agenda">
            {meeting.agenda.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        ) : null
      ) : (
        <>
          {meeting.notes.length > 0 ? (
            <ul className="feed-points" aria-label="Notes">
              {meeting.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
          {meeting.decisions.length > 0 ? (
            <ul className="feed-agreed" aria-label="Agreed">
              {meeting.decisions.map((d, i) => (
                <li key={i}>
                  <span className="feed-agreed-icon" aria-hidden="true">
                    <ProductIcon name="check" size={16} />
                  </span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </>
  );
}

function RequestEntry({ request, state }: { request: RequestState; state: RunState }) {
  const ceo = leadOf(state);
  const from = nameOf(state, request.fromAgentId);
  const to = request.toAgentId ? nameOf(state, request.toAgentId, ceo?.name ?? "the CEO") : (ceo?.name ?? "the CEO");
  const d = request.decision;
  const by = d ? (d.byOwner ? "You" : nameOf(state, d.byAgentId, ceo?.name ?? "The CEO")) : null;
  return (
    <>
      <p className="feed-head">
        <span className="feed-icon" aria-hidden="true">
          <ProductIcon name="chatCheck" size={20} />
        </span>
        <span className="feed-title">
          {from} asked {request.toOwner && !request.toAgentId ? "you" : to}
        </span>
        <span className="feed-time num">{fmtClock(request.raisedAt)}</span>
      </p>
      <p className="feed-quote">{request.question}</p>
      {d ? (
        <p className="feed-answer" data-tone={d.approved ? "success" : "neutral"}>
          <span className="feed-answer-icon" aria-hidden="true">
            <ProductIcon name={d.approved ? "checkCircle" : "xCircle"} size={16} />
          </span>
          <span>
            <span className="feed-answer-word">
              {by} {d.approved ? "approved" : "declined"}.
            </span>{" "}
            {d.answer}
          </span>
        </p>
      ) : (
        <p className="feed-answer" data-tone="waiting">
          <span className="feed-answer-icon" aria-hidden="true">
            <ProductIcon name="hourglass" size={16} />
          </span>
          <span>{request.toOwner ? `${to} passed this to you. Answer in the note box below.` : `Waiting on ${to}.`}</span>
        </p>
      )}
    </>
  );
}

function NoteEntry({ text, lead }: { text: string; lead: string }) {
  return (
    <>
      <p className="feed-head">
        <span className="feed-icon" aria-hidden="true">
          <ProductIcon name="send" size={20} />
        </span>
        <span className="feed-title">You told {lead}</span>
      </p>
      <p className="feed-quote">{text}</p>
    </>
  );
}

export function CompanyFeed({ state, replaying, onSend }: { state: RunState; replaying: boolean; onSend: (text: string) => Promise<void> }) {
  const level = useMotionLevel();
  const off = level === "off";
  const [notes, setNotes] = useState<Array<{ ts: number; text: string }>>([]);
  const lead = leadOf(state)?.name ?? "Oyen";
  const entries = feedEntries(state, notes);
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const finished = !!state.run && isFinished(state.run.status);
  const meetings = state.meetingOrder.length;
  const decided = state.requestOrder.filter((id) => state.requests[id]?.decision && !state.requests[id]?.decision?.byOwner).length;

  // Follow the newest entry unless the owner scrolled up to read.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries.length, entries.at(-1)?.key]);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const send = async (text: string) => {
    await onSend(text);
    stick.current = true;
    setNotes((n) => [...n, { ts: Date.now(), text }]);
  };

  const enter = off ? { opacity: 0 } : { opacity: 0, y: 8 };
  return (
    <section className="app-region app-card feed" data-container="card" aria-labelledby="feed-h">
      <RegionHead
        title="Meetings and CEO calls"
        id="feed-h"
        meta={meetings + decided > 0 ? `${meetings} ${meetings === 1 ? "meeting" : "meetings"}, ${decided} ${decided === 1 ? "call" : "calls"} by ${lead}` : `${lead} runs the meetings and answers the crew`}
      />
      {entries.length === 0 ? (
        <p className="app-empty-line feed-empty">No meetings or requests yet. {lead} calls a kickoff once the plan is ready.</p>
      ) : (
        <ol className="feed-list" ref={listRef} tabIndex={0} aria-label="Company feed, oldest first">
          <AnimatePresence initial={false}>
            {entries.map((en) => (
              <motion.li
                key={en.key}
                className="feed-item"
                data-kind={en.kind}
                initial={enter}
                animate={{ opacity: 1, y: 0, transition: off ? T.reduced : T.base }}
                exit={{ opacity: 0, transition: off ? T.reduced : T.baseExit }}
              >
                {en.kind === "meeting" ? <MeetingEntry meeting={en.meeting} state={state} /> : null}
                {en.kind === "request" ? <RequestEntry request={en.request} state={state} /> : null}
                {en.kind === "note" ? <NoteEntry text={en.text} lead={lead} /> : null}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
      <div className="feed-foot">
        {finished || replaying ? (
          <p className="app-empty-line">{replaying ? "Replaying the run. Notes to the CEO are closed." : "The run has ended, so notes to the CEO are closed."}</p>
        ) : (
          <MessageBox lead={lead} onSend={send} />
        )}
      </div>
    </section>
  );
}
