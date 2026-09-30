// Run header (JEV ui.component_recipe core.page_header, plain spacing): the
// goal as the page title, one meta line (status icon plus word, the
// stream, the project, crew size, the start clock), and the run controls.
// The budget and progress live in the status strip right under it. Stop
// asks first; Pause never does.
import type { ProjectDTO } from "@mengai/shared";
import { ProductIcon, Sheet, StatusPill } from "@mengai/ui/src/product";
import { useState } from "react";
import type { Connection, RunState } from "../../store/runStore";
import { crewOrder, tokensUsed } from "../../store/runStore";
import { fmtClock, fmtInt, fmtUsd } from "../format";
import { useAction, useMedia } from "../hooks";
import { RUN_STATUS, isFinished } from "../status";
import { clip } from "./office";
import { COMPANY_WORD, companyOf } from "./stages";

const CONNECTION: Record<Connection, { word: string; icon: "refresh" | "checkCircle" | "infoCircle" | "clock" | "alertCircle" } | null> = {
  idle: null,
  connecting: { word: "Connecting", icon: "refresh" },
  live: { word: "Live", icon: "checkCircle" },
  reconnecting: { word: "Reconnecting, the crew keeps working", icon: "refresh" },
  closed: null,
  demo: null,
};

export function RunHeader({
  state,
  project,
  replaying,
  onPause,
  onResume,
  onStop,
}: {
  state: RunState;
  project: ProjectDTO | null;
  replaying: boolean;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const run = state.run!;
  const look = RUN_STATUS[run.status];
  const used = tokensUsed(run.usage);
  const conn = CONNECTION[state.connection];
  const act = useAction();
  const [confirm, setConfirm] = useState(false);
  const finished = isFinished(run.status);
  const crew = crewOrder(state).length;
  const company = companyOf(run);
  // The goal is the page title; a long one is cut at a word so it stays a
  // title (two lines on a desk, three on a phone), whole in its tooltip and
  // for assistive tech.
  const desktop = useMedia("(min-width: 1024px)");
  const phone = !useMedia("(min-width: 640px)");
  const shortGoal = clip(run.goal, phone ? 72 : desktop ? 100 : 84);

  return (
    <header className="run-head">
      <div className="run-head-text">
        <h1 className="app-title run-goal" title={run.goal} aria-label={shortGoal === run.goal ? undefined : run.goal}>
          {shortGoal}
        </h1>
        <p className="run-meta">
          <StatusPill tone={look.tone} icon={look.icon}>
            {replaying ? `Replay, ${look.word.toLowerCase()}` : look.word}
          </StatusPill>
          {conn && !finished ? (
            <span className="run-meta-item">
              <ProductIcon name={conn.icon} size={16} />
              <span>{conn.word}</span>
            </span>
          ) : null}
          <span className="run-meta-item">
            <ProductIcon name={company === "fund" ? "dollar" : "code"} size={16} />
            <span>{COMPANY_WORD[company]}</span>
          </span>
          {project ? (
            <span className="run-meta-item">
              <ProductIcon name="folder" size={16} />
              <span>{project.name}</span>
            </span>
          ) : null}
          <span className="run-meta-item">
            <span className="tnum">{crew}</span>&nbsp;{crew === 1 ? "cat" : "cats"} on the crew
          </span>
          {run.startedAt ? (
            <span className="run-meta-item">
              Started <span className="num">{fmtClock(run.startedAt)}</span>
            </span>
          ) : null}
        </p>
        {run.status === "paused" ? <p className="run-note">Paused. The crew is napping until you resume.</p> : null}
        {run.statusReason && run.status !== "paused" ? <p className="run-note">{run.statusReason}</p> : null}
      </div>
      <div className="run-head-side">
        {!finished && !replaying ? (
          <div className="run-actions">
            {run.status === "paused" ? (
              <button type="button" className="btn-secondary" aria-busy={act.busy || undefined} onClick={() => act.run(onResume)}>
                <ProductIcon name="play" size={20} />
                <span>Resume</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn-secondary"
                aria-busy={act.busy || undefined}
                disabled={run.status !== "running"}
                onClick={() => act.run(onPause)}
              >
                <ProductIcon name="pause" size={20} />
                <span>Pause</span>
              </button>
            )}
            <button type="button" className="btn-secondary app-btn-danger" onClick={() => setConfirm(true)} disabled={run.status === "stopping"}>
              <ProductIcon name="stop" size={20} />
              <span>Stop</span>
            </button>
          </div>
        ) : null}
        {act.error ? (
          <p className="app-form-status" data-tone="danger" role="alert">
            <ProductIcon name="alertCircle" size={16} />
            <span>{act.error}</span>
          </p>
        ) : null}
      </div>
      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Stop this run?"
        alert
        dismissible={false}
        description="Every cat puts its paws down now. Files the crew already wrote stay as they are."
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setConfirm(false)}>
              Keep running
            </button>
            <button
              type="button"
              className="app-btn-destructive"
              aria-busy={act.busy || undefined}
              onClick={async () => {
                await act.run(onStop);
                setConfirm(false);
              }}
            >
              Stop the run
            </button>
          </>
        }
      >
        <p className="app-body-muted">
          <span className="num">{fmtInt(used)}</span> tokens and <span className="num">{fmtUsd(run.usage.costUsd)}</span> spent so far.
        </p>
      </Sheet>
    </header>
  );
}
