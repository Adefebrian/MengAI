// Token efficiency (kit.bento.lead-right, JEV 0.72; tier 2, choreography
// reveal): three measured figures around the per-scenario chart, every
// number from docs/reports/token-benchmark.md through data/bench.ts. The
// figures count up once (kit Figure count); the bars grow when the grid
// enters. The limits of the measurement sit in the chart caption.
import { BentoGrid, BentoTile } from "@mengai/ui";
import { HEADLINE } from "../data/bench";
import { TokenChart } from "../views/TokenChart";

export function TokensSection() {
  return (
    <BentoGrid
      id="tokens"
      tone="base"
      preset="lead-right"
      title="Same work, far fewer tokens"
      lead={`We replayed the same ${HEADLINE.steps} steps through our old engine and through v2, with no model calls. v2 sends less, and most of what it sends is read from your provider's prompt cache.`}
    >
      <BentoTile area="a" kind="stat" value={String(HEADLINE.savingsPct)} unit="%" body="fewer billable input tokens for the same work" signal />
      <BentoTile area="b" kind="stat" value={String(HEADLINE.promptCutPct)} unit="%" body="fewer prompt tokens sent, before any cache" />
      <BentoTile
        area="c"
        kind="media"
        media={
          <div className="lp-tile-view">
            <TokenChart />
          </div>
        }
        title={`${HEADLINE.scenarios} tasks across ${HEADLINE.roles} roles, measured`}
        body={`Measured on 29 September 2026. Had the old engine used the same cache, the saving would be ${HEADLINE.savingsIfLegacyCachedPct}%.`}
      />
      <BentoTile
        area="d"
        kind="stat"
        value={String(HEADLINE.cachedSharePct)}
        unit="%"
        body={`of the prompt tokens v2 sends are cache reads. The largest single prompt drops from ${HEADLINE.legacyMaxPrompt.toLocaleString("en-US")} to ${HEADLINE.v2MaxPrompt.toLocaleString("en-US")} tokens.`}
      />
    </BentoGrid>
  );
}
