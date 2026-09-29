// The board replay stage: one frame of the sample run, drawn from the fold
// of its events up to that moment. The rows, entries, clock and the
// handoff card come from the frame clock (useCurrentFrame); each cat plays
// its own live beat for its role, activity and mood (@mengai/cats) while
// the replay runs, and holds its still pose when the replay is paused.
//
// Anatomy (the app's crew board, docs/design/landing-sections.md):
//   run line     goal (one line), status as icon plus word, elapsed clock
//   crew sheet   four rows: cat, name and role, behaviour and mood (or the
//                review verdict), tool target in mono (from 640), the task
//                card, energy used (from 1024); fixed row slots
//   timeline     the latest three entries (two below 1024), fixed slots
//   run footer   the run's token total against its budget, static
import { useMemo, type CSSProperties } from "react";
import { Cat } from "@mengai/cats";
import { ACTIVITY_LABEL, ROLE_LABEL, type Mood } from "@mengai/shared";
import { Easing, useCurrentFrame } from "@mengai/ui";
import { ActivityIcon, CheckCircleIcon, CheckIcon, UndoIcon } from "../icons";
import { SAMPLE_CREW_TOKENS, type ReplayFixture } from "./fixture";
import { eventCountAt, finalTokens, foldEvents, type ReplayAgent, type ReplayState, type TimelineEntry } from "./reduce";
import { clock, frameToMs, replayMsToTs, tsToReplayMs } from "./timemap";

/** The mood word after the behaviour, as the crew board writes it. */
const MOOD_WORD: Record<Mood, string> = {
  calm: "calm",
  focused: "focused",
  proud: "proud",
  frustrated: "frustrated",
  tired: "tired",
};

const TRAVEL_MS = 600; // --dur-600
const ENTER_MS = 200; // --dur-200
const TIMELINE_SLOTS = 3;

export interface StageProps {
  fixture: ReplayFixture;
  catSize: 48 | 64;
  reduced: boolean;
  label: string;
  /** Freeze the cats in their still poses (a paused replay, or a still). */
  still: boolean;
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

function lowerFirst(s: string): string {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}

function entryText(e: TimelineEntry): string {
  return e.target ? `${e.action} ${e.target}` : e.action;
}

function TaskCard({ state, taskId, style }: { state: ReplayState; taskId: string | null; style?: CSSProperties }) {
  const task = taskId ? state.tasks[taskId] : undefined;
  if (!task) return null;
  const done = task.status === "done";
  return (
    <span className="lp-card" data-done={done ? "" : undefined} title={task.title} style={style}>
      {done ? (
        <span className="lp-card-icon">
          <CheckIcon size={16} color="currentColor" />
        </span>
      ) : null}
      <span className="lp-card-text">{task.title}</span>
    </span>
  );
}

export function Stage({ fixture, catSize, reduced, label, still }: StageProps) {
  const frame = useCurrentFrame();
  const ms = frameToMs(frame);
  const ts = replayMsToTs(fixture.stages, ms);
  const count = eventCountAt(fixture.events, ts);
  const state = useMemo(() => foldEvents(fixture.events, count), [fixture, count]);
  const totals = useMemo(() => finalTokens(fixture.events), [fixture]);
  const progress = totals.tokens > 0 ? state.tokens / totals.tokens : 0;
  const replayMsOf = (eventTs: number) => tsToReplayMs(fixture.stages, eventTs);

  const elapsed = Math.min(ts, state.endedAt ?? ts) - state.startedAt;
  const done = state.runStatus === "done";

  // The latest handoff: its card travels from the sender's row to the
  // receiver's row once, over --dur-600, on the frame clock.
  const handoff = state.handoffs[state.handoffs.length - 1];
  const travel = handoff ? clamp01((ms - replayMsOf(handoff.ts)) / TRAVEL_MS) : 1;
  const travelling = handoff !== undefined && travel < 1;
  const rowOf = (id: string) => fixture.crew.indexOf(id);

  const entries: (TimelineEntry | null)[] = state.timeline.slice(-TIMELINE_SLOTS);
  while (entries.length < TIMELINE_SLOTS) entries.unshift(null);
  const newest = state.timeline[state.timeline.length - 1];

  const row = (agent: ReplayAgent) => {
    const incoming = agent.incomingTaskId;
    const receiving = travelling && handoff?.toAgentId === agent.id;
    // The receiver shows the handed task once the card lands; under reduced
    // motion it fades in place instead of travelling.
    let cardTask = incoming ?? agent.taskId;
    let cardStyle: CSSProperties | undefined;
    if (receiving && incoming) {
      if (reduced) cardStyle = { opacity: travel };
      else cardTask = agent.taskId;
    }
    const sending = travelling && !reduced && handoff?.fromAgentId === agent.id;
    const distance = handoff ? rowOf(handoff.toAgentId) - rowOf(handoff.fromAgentId) : 0;
    const eased = Easing.jal(travel);
    const judged = agent.activity === "review" ? agent.verdict : null;
    const behaviour = ACTIVITY_LABEL[agent.activity];
    const doing = judged === "passed" ? "Review passed" : judged === "changes" ? "Changes requested" : behaviour;
    const catLabel = `${agent.name}, ${ROLE_LABEL[agent.role]}, ${lowerFirst(doing)}`;
    const energy = ((SAMPLE_CREW_TOKENS[agent.id] ?? 0) / Math.max(state.budgetTokens, 1)) * progress;
    const mood = MOOD_WORD[agent.mood];
    return (
      <li key={agent.id} className="lp-crow">
        <span className="lp-cat">
          <Cat
            look={agent.look}
            role={agent.role}
            status={agent.status}
            activity={agent.activity}
            mood={judged === "changes" ? "frustrated" : agent.mood}
            label={catLabel}
            size={catSize}
            still={still}
          />
        </span>
        <span className="lp-who">
          <span className="lp-name">{agent.name}</span>
          <span className="lp-role">{ROLE_LABEL[agent.role]}</span>
        </span>
        <span className="lp-doing">
          {judged ? (
            <span className="lp-act lp-verdict" data-verdict={judged}>
              {judged === "passed" ? <CheckCircleIcon size={16} color="currentColor" /> : <UndoIcon size={16} color="currentColor" />}
              <span>{doing}</span>
            </span>
          ) : (
            <span className="lp-act">{`${behaviour}, ${mood}`}</span>
          )}
          <span className="lp-tool lp-mono" title={agent.tool ?? undefined}>
            {agent.tool ?? ""}
          </span>
        </span>
        <span className="lp-task">
          <TaskCard state={state} taskId={cardTask} style={cardStyle} />
          {sending && handoff ? (
            <span className="lp-ghost" data-overlay="" aria-hidden="true">
              <TaskCard
                state={state}
                taskId={handoff.taskId}
                style={{ transform: `translateY(calc(var(--lp-row-h) * ${(eased * distance).toFixed(4)}))` }}
              />
            </span>
          ) : null}
        </span>
        <span className="lp-energy">
          <span className="lp-energy-bar" aria-hidden="true">
            <span className="lp-energy-fill" style={{ transform: `scaleX(${Math.min(Math.max(energy, 0), 1).toFixed(4)})` }} />
          </span>
          <span className="lp-energy-value">
            <span className="kit-num">{Math.round(energy * 100)}%</span> energy used
          </span>
        </span>
      </li>
    );
  };

  return (
    <div className="lp-stage" data-cat={catSize} role="group" aria-label={label}>
      <div className="lp-runline">
        <p className="lp-goal" title={state.goal}>
          {state.goal}
        </p>
        <p className="lp-runstatus">
          {done ? <CheckCircleIcon size={16} color="currentColor" /> : <ActivityIcon size={16} color="currentColor" />}
          <span>{done ? "Done" : "Running"}</span>
        </p>
        <p className="lp-clock kit-num" aria-label={`Elapsed ${clock(elapsed)}`}>
          {clock(elapsed)}
        </p>
      </div>
      <ul className="lp-sheet" aria-label="Crew">
        {fixture.crew.map((id) => {
          const agent = state.agents[id];
          return agent ? row(agent) : <li key={id} className="lp-crow" aria-hidden="true" />;
        })}
      </ul>
      <ol className="lp-log" aria-label="Latest steps">
        {entries.map((entry, i) => {
          if (!entry) return <li key={`empty-${i}`} className="lp-entry" aria-hidden="true" />;
          const isNewest = entry === newest;
          const age = isNewest ? ms - replayMsOf(entry.ts) : ENTER_MS;
          const p = clamp01(age / ENTER_MS);
          const style: CSSProperties | undefined =
            p < 1 ? { opacity: reduced ? p : Easing.jal(p) } : undefined;
          const who = entry.agentId ? state.agents[entry.agentId]?.name ?? "" : "Run";
          return (
            <li key={entry.seq} className="lp-entry" style={style} title={`${clock(entry.ts - state.startedAt)} ${who} ${entryText(entry)}`}>
              <span className="lp-time kit-num">{clock(entry.ts - state.startedAt)}</span>
              <span className="lp-entry-who">{who}</span>
              <span className="lp-entry-text">
                <span>{entry.action}</span>
                {entry.target ? <span className={entry.mono ? "lp-mono" : undefined}>{entry.target}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="lp-foot">
        <span className="lp-foot-label">Run total</span>
        <span>
          <span className="kit-num">{totals.tokens.toLocaleString("en-US")}</span> of{" "}
          <span className="kit-num">{totals.budgetTokens.toLocaleString("en-US")}</span> tokens
        </span>
      </p>
    </div>
  );
}
