// The run tracker, pinned at the top of the run page like a delivery
// tracker (JEV ui.region_gate divided section, relevance 2.98;
// ui.component_recipe core.progress 0.58, the fill tween layer refused at
// 0.49; motion.intensity tier 0, so only state changes move). One
// segmented track, a segment per stage of the company kind: finished
// segments filled ink with a tick, the stage the run is on runs the
// indeterminate fill, and when a check sends the work back the stage that
// sent it keeps a warning segment with the return glyph until the run
// passes it again. Beside the track: the stage and its step, one line in
// cat voice, and the tokens the run still needs. The replay scrubber folds
// the log up to its position, so it drives the tracker too.
import { ProductIcon, type GlyphName } from "@mengai/ui/src/product";
import type { RunState } from "../../store/runStore";
import { clockOf } from "./office";
import { activeLabel, trackerLine, tokensToGo, trackerModel, type StageState } from "./stages";

const STATE_WORD: Record<StageState, string> = {
  done: "done",
  active: "in progress",
  todo: "not started",
  returned: "sent the work back",
};

function stageIcon(state: StageState): GlyphName | null {
  if (state === "done") return "check";
  if (state === "returned") return "refresh";
  return null;
}

function headIcon(outcome: string, back: boolean): GlyphName {
  switch (outcome) {
    case "done":
      return "checkCircle";
    case "failed":
      return "xCircle";
    case "stopped":
    case "stopping":
      return "stopAll";
    case "paused":
      return "pauseCircle";
    case "queued":
      return "clock";
    default:
      return back ? "refresh" : "runs";
  }
}

export function RunTracker({ state, replaying }: { state: RunState; replaying: boolean }) {
  const run = state.run;
  if (!run) return null;
  const m = trackerModel(state);
  const line = trackerLine(state, m, clockOf(state));
  const togo = tokensToGo(run);
  const step = m.index + 1;
  const total = m.stages.length;
  const back = m.sentBack !== null && m.outcome === "running";
  return (
    <section
      className="app-region run-tracker"
      data-container="divided"
      data-outcome={m.outcome}
      data-back={back ? "" : undefined}
      aria-label={replaying ? "Run progress at the replay position" : "Run progress"}
    >
      <p className="tracker-stage">
        <span className="tracker-stage-icon" data-tone={m.outcome === "failed" ? "danger" : back ? "warning" : m.outcome === "done" ? "success" : undefined}>
          <ProductIcon name={headIcon(m.outcome, back)} size={20} />
        </span>
        <span className="tracker-stage-word">{activeLabel(m)}</span>
        <span className="tracker-step">
          <span className="num">{step}</span> of <span className="num">{total}</span>
        </span>
      </p>
      <p className="tracker-now status-now" title={line} aria-live="polite">
        {line}
      </p>
      <p className="tracker-togo" title={togo.detail} aria-label={`${togo.value ? `${togo.value} ${togo.text}` : togo.text}. ${togo.detail}.`}>
        {togo.value ? (
          <>
            {togo.estimate ? <span className="tracker-about">About </span> : null}
            <span className="num">{togo.value}</span> {togo.text}
          </>
        ) : (
          togo.text
        )}
      </p>
      <ol className="tracker-track" aria-label={`${total} stages, on stage ${step}`}>
        {m.stages.map((s) => {
          const icon = stageIcon(s.state);
          return (
            <li key={s.key} className="tracker-item" data-state={s.state} aria-current={s.state === "active" ? "step" : undefined}>
              <span className="tracker-seg" aria-hidden="true">
                <span className="tracker-fill" />
              </span>
              <span className="tracker-label" aria-hidden="true">
                {icon ? (
                  <span className="tracker-label-icon">
                    <ProductIcon name={icon} size={16} />
                  </span>
                ) : null}
                <span className="tracker-label-text" title={s.label}>
                  {s.label}
                </span>
              </span>
              <span className="p-sr-wrap">
                <span className="p-sr-only">
                  {s.label}, {STATE_WORD[s.state]}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
