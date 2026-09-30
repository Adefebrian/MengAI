// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The run report and its replay (JEV ui.region_gate divided section 0.68,
// ui.component_recipe core.slider 0.97, motion tier 0): it sits right under
// the office like a player. The outcome in a title that names it, the
// CEO's closing line, the figures in tabular numerals, then play or pause
// and a range over the event sequence. The office, the feed, the queue and
// the tabs all follow the position, so playing forward walks the crew to
// the kickoff table again, carries every handoff, and replays the review.
// Playing steps the position; it is data, not an animation.
import type { MengaiEvent, RunStatus } from "@mengai/shared";
import { ProductIcon } from "@mengai/ui/src/product";
import { useEffect, useId } from "react";
import type { RunState } from "../../store/runStore";
import { tokensUsed } from "../../store/runStore";
import { fmtClock, fmtDuration, fmtInt, fmtUsd } from "../format";
import { RegionHead } from "../ui";
import { taskCounts } from "./derive";

const OUTCOME: Partial<Record<RunStatus, string>> = {
  done: "Run complete",
  failed: "Run failed",
  stopped: "Run stopped",
};

function Report({ state }: { state: RunState }) {
  const run = state.run;
  if (!run) return null;
  const c = taskCounts(state);
  const rounds = Object.values(state.rounds).reduce((n, r) => n + Math.max(0, r - 1), 0);
  const answered = state.approvalOrder.filter((id) => state.approvals[id] && state.approvals[id]!.status !== "pending").length;
  const calls = state.requestOrder.filter((id) => state.requests[id]?.decision && !state.requests[id]?.decision?.byOwner).length;
  const time = run.startedAt && run.endedAt ? fmtDuration(run.endedAt - run.startedAt) : null;
  const items: Array<{ label: string; value: string }> = [
    { label: "Tasks done", value: `${fmtInt(c.done)} of ${fmtInt(c.total)}` },
    { label: "Sent back in review", value: fmtInt(rounds) },
    { label: "Meetings", value: fmtInt(state.meetingOrder.length) },
    { label: "CEO calls", value: fmtInt(calls) },
    { label: "Your answers", value: fmtInt(answered) },
    { label: "Tokens", value: fmtInt(tokensUsed(run.usage)) },
    { label: "Cost", value: fmtUsd(run.usage.costUsd) },
    { label: "Time", value: time ?? "Not timed" },
  ];
  return (
    <dl className="report-figures" aria-label="Run figures">
      {items.map((i) => (
        <div className="report-figure" key={i.label}>
          <dt>{i.label}</dt>
          <dd className="tnum">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Replay({
  state,
  log,
  at,
  playing,
  onSeek,
  onPlay,
  onExit,
}: {
  state: RunState;
  log: readonly MengaiEvent[] | null;
  at: number | null;
  playing: boolean;
  onSeek: (at: number) => void;
  onPlay: (on: boolean) => void;
  onExit: () => void;
}) {
  const id = useId();
  const total = log?.length ?? 0;
  const pos = at ?? total;

  useEffect(() => {
    if (!playing || !log) return;
    if (pos >= total) {
      onPlay(false);
      return;
    }
    const t = setTimeout(() => onSeek(pos + 1), 360);
    return () => clearTimeout(t);
  }, [playing, pos, total, log, onSeek, onPlay]);

  const ts = log && pos > 0 ? log[Math.min(pos, total) - 1]!.ts : log?.[0]?.ts ?? null;
  return (
    <section className="app-region replay" data-container="divided" aria-labelledby={`${id}-h`}>
      <RegionHead
        title={state.run ? (OUTCOME[state.run.status] ?? "Run ended") : "Run ended"}
        id={`${id}-h`}
        meta={closing(state)}
        actions={
          at !== null ? (
            <button type="button" className="btn-ghost" onClick={onExit}>
              Back to the end
            </button>
          ) : undefined
        }
      />
      <Report state={state} />
      {!log ? (
        <p className="app-empty-line">Fetching the run's log.</p>
      ) : total === 0 ? (
        <p className="app-empty-line">This run left no log to replay.</p>
      ) : (
        <div className="replay-controls">
          <button
            type="button"
            className="btn-secondary replay-play"
            aria-pressed={playing}
            onClick={() => {
              if (!playing && pos >= total) onSeek(0);
              onPlay(!playing);
            }}
          >
            <ProductIcon name={playing ? "pause" : "play"} size={20} />
            <span>{playing ? "Pause" : pos >= total ? "Play from the start" : "Play"}</span>
          </button>
          <div className="replay-scrub">
            <input
              aria-label="Replay position"
              id={`${id}-range`}
              type="range"
              className="replay-range"
              min={0}
              max={total}
              step={1}
              value={pos}
              onChange={(e) => {
                onPlay(false);
                onSeek(Number(e.target.value));
              }}
              aria-valuetext={`Event ${pos} of ${total}${ts ? `, ${fmtClock(ts)}` : ""}`}
            />
            <p className="replay-readout">
              <span>
                Event <span className="num">{fmtInt(pos)}</span> of <span className="num">{fmtInt(total)}</span>
              </span>
              {ts ? <span className="num">{fmtClock(ts)}</span> : null}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

/** The lead's closing words, else the reason the run ended. */
function closing(state: RunState): string {
  const lead = state.agentOrder.map((id) => state.agents[id]).find((a) => a?.role === "lead");
  const said = lead ? state.says[lead.id] : undefined;
  if (state.run?.status === "done" && said) return `${lead!.name}: ${said.text}`;
  if (state.run?.statusReason) return state.run.statusReason;
  return "Scrub or play to watch the crew again, from the first plan to the last paw print.";
}
