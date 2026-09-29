// Billable input tokens per benchmark scenario, legacy engine against v2,
// from docs/reports/token-benchmark.md (data/bench.ts). Two bars per row on
// one shared scale, labelled in words, no legend swatches. The bars grow
// from the start edge with transform when their bento enters (the kit's
// rise state); under reduced motion they rest at their final length.
import type { CSSProperties } from "react";
import { SCENARIOS } from "../data/bench";

const NAMES: Record<string, string> = {
  "engineer-settings-migration": "Settings migration",
  "engineer-discount": "Discount rule",
  "qa-flaky-checkout": "Flaky checkout test",
  "reviewer-payments": "Payments review",
  "security-audit": "Security audit",
  "researcher-search-index": "Search index research",
  "lead-plan": "Plan a goal",
  "designer-landing-hero": "Landing hero design",
};

export function TokenChart() {
  const max = Math.max(...SCENARIOS.map((s) => s.legacy));
  return (
    <div className="lp-chart">
      <p className="lp-chart-key">
        <span className="lp-view-muted">Billable input tokens per task, lighter bar the old engine, ink bar v2</span>
      </p>
      <ol className="lp-chart-rows" aria-label="Billable input tokens per scenario">
        {SCENARIOS.map((s) => (
          <li key={s.id} className="lp-chart-row">
            <span className="lp-view-strong lp-clip" title={NAMES[s.id] ?? s.id}>
              {NAMES[s.id] ?? s.id}
            </span>
            <span className="lp-view-muted lp-row-end">
              <span className="kit-num">{s.savingsPct}%</span> less
            </span>
            <span className="lp-bars" role="img" aria-label={`${NAMES[s.id] ?? s.id}: ${s.legacy.toLocaleString("en-US")} tokens before, ${s.v2.toLocaleString("en-US")} with v2`}>
              <span className="lp-bar" data-series="legacy" style={{ "--lp-bar": String(s.legacy / max) } as CSSProperties} />
              <span className="lp-bar" data-series="v2" style={{ "--lp-bar": String(s.v2 / max) } as CSSProperties} />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
