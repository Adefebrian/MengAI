// The live status strip (JEV ui.region_gate divided section,
// ui.component_recipe core.divided_section 0.96, motion tier 1, the text
// swap layer refused at 0.54): one sentence in cat voice of what the
// company is doing right now, then three figures between hairlines: tasks
// done, cats at work, and the budget, each with a flat meter. Figures sit
// in tabular mono so a live count never jitters.
import { Meter } from "@mengai/ui/src/product";
import type { RunState } from "../../store/runStore";
import { crewOrder, tokensUsed } from "../../store/runStore";
import { fmtInt, fmtUsd } from "../format";
import { taskCounts } from "./derive";
import { companyNow } from "./office";

export function StatusStrip({ state }: { state: RunState }) {
  const run = state.run;
  if (!run) return null;
  const c = taskCounts(state);
  const crew = crewOrder(state);
  const atWork = crew.filter((a) => a.status === "working" || a.status === "thinking" || a.status === "approval").length;
  const used = tokensUsed(run.usage);
  const share = run.budgetTokens > 0 ? used / run.budgetTokens : 0;
  return (
    <section className="app-region status-strip" data-container="divided" aria-label="What the company is doing now">
      <p className="status-now" aria-live="polite">
        {companyNow(state)}
      </p>
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
              {fmtInt(used)} <span className="status-of">of {fmtInt(run.budgetTokens)} tokens, {fmtUsd(run.usage.costUsd)}</span>
            </span>
            <Meter
              label="Budget used"
              value={share}
              valueText={`${fmtInt(used)} of ${fmtInt(run.budgetTokens)} tokens, ${fmtUsd(run.usage.costUsd)} of ${fmtUsd(run.budgetUsd)}`}
              tone={share >= 0.9 ? "danger" : share >= 0.75 ? "warning" : "ink"}
              compact
            />
          </dd>
        </div>
      </dl>
    </section>
  );
}
