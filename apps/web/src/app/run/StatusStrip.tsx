// The live figures (JEV ui.region_gate kept at relevance 1.85 once the
// tracker took over the cat-voice line; container card at low confidence,
// the primary since neither neighbour is a card): tasks done, cats at
// work, and the budget, each with a flat meter. Figures sit in tabular
// mono so a live count never jitters. A budget of 0 is no cap, and says so.
import { Meter } from "@mengai/ui/src/product";
import type { RunState } from "../../store/runStore";
import { crewOrder, tokensUsed } from "../../store/runStore";
import { fmtInt, fmtUsd } from "../format";
import { taskCounts } from "./derive";

export function StatusStrip({ state }: { state: RunState }) {
  const run = state.run;
  if (!run) return null;
  const c = taskCounts(state);
  const crew = crewOrder(state);
  const atWork = crew.filter((a) => a.status === "working" || a.status === "thinking" || a.status === "approval").length;
  const used = tokensUsed(run.usage);
  const share = run.budgetTokens > 0 ? used / run.budgetTokens : 0;
  return (
    <section className="app-region app-card status-strip" data-container="card" aria-label="Live figures">
      <dl className="status-figures">
        <div className="status-figure">
          <dt>Tasks done</dt>
          <dd>
            <span className="status-value tnum">
              {fmtInt(c.done)} <span className="status-of">of {fmtInt(c.total)}</span>
            </span>
            <Meter label="Tasks done" value={c.total ? c.done / c.total : 0} valueText={`${c.done} of ${c.total} tasks done`} compact />
          </dd>
        </div>
        <div className="status-figure">
          <dt>Cats at work</dt>
          <dd>
            <span className="status-value tnum">
              {fmtInt(atWork)} <span className="status-of">of {fmtInt(crew.length)}</span>
            </span>
            <Meter label="Cats at work" value={crew.length ? atWork / crew.length : 0} valueText={`${atWork} of ${crew.length} cats at work`} compact />
          </dd>
        </div>
        <div className="status-figure">
          <dt>Budget used</dt>
          <dd>
            <span className="status-value tnum">
              {fmtInt(used)}{" "}
              <span className="status-of">{run.budgetTokens > 0 ? `of ${fmtInt(run.budgetTokens)} tokens, ${fmtUsd(run.usage.costUsd)}` : `tokens, ${fmtUsd(run.usage.costUsd)}, no cap`}</span>
            </span>
            <Meter
              label="Budget used"
              value={share}
              valueText={run.budgetTokens > 0 ? `${fmtInt(used)} of ${fmtInt(run.budgetTokens)} tokens, ${fmtUsd(run.usage.costUsd)} of ${run.budgetUsd > 0 ? fmtUsd(run.budgetUsd) : "no cost cap"}` : `${fmtInt(used)} tokens, no token cap`}
              tone={share >= 0.9 ? "danger" : share >= 0.75 ? "warning" : "ink"}
              compact
            />
          </dd>
        </div>
      </dl>
    </section>
  );
}
