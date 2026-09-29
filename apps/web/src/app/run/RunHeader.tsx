// Run header (JEV ui.component_recipe core.page_header, plain spacing): the
// goal as the page title, one meta line (status icon plus word, the
// stream, tasks done, crew size), the budget as a meter with its tabular
// figure, and the run controls. Stop asks first; Pause never does.
import type { ProjectDTO } from "@mengai/shared";
import { Meter, ProductIcon, Sheet, StatusPill } from "@mengai/ui/src/product";
import { useState } from "react";
import type { Connection, RunState } from "../../store/runStore";
import { tokensUsed } from "../../store/runStore";
import { fmtClock, fmtInt, fmtUsd } from "../format";
import { useAction } from "../hooks";
import { RUN_STATUS, isFinished } from "../status";
import { taskCounts } from "./derive";

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
  const counts = taskCounts(state);
  const used = tokensUsed(run.usage);
  const share = run.budgetTokens > 0 ? used / run.budgetTokens : 0;
  const conn = CONNECTION[state.connection];
  const act = useAction();
  const [confirm, setConfirm] = useState(false);
  const finished = isFinished(run.status);
  const crew = state.agentOrder.length;

  return (
    <header className="run-head">
      <div className="run-head-text">
        <h1 className="app-title run-goal" title={run.goal}>
          {run.goal}
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
          {project ? <span className="run-meta-item">{project.name}</span> : null}
          <span className="run-meta-item">
            <span className="tnum">{counts.done} of {counts.total}</span>&nbsp;tasks done
          </span>
          <span className="run-meta-item">
            <span className="tnum">{crew}</span>&nbsp;{crew === 1 ? "cat" : "cats"}
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
        <Meter
          label="Budget used"
          value={share}
          valueText={`${fmtInt(used)} of ${fmtInt(run.budgetTokens)} tokens`}
          tone={share >= 0.9 ? "danger" : share >= 0.75 ? "warning" : "ink"}
        />
        <p className="run-cost">
          <span className="tnum">{fmtUsd(run.usage.costUsd)}</span> of <span className="tnum">{fmtUsd(run.budgetUsd)}</span> spent
        </p>
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
