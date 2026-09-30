// Token efficiency (kit.stat-row.chart; critic fix round 2: the bento's
// stat tiles carried an 80 px empty band between figure and caption, so
// the figures now sit as a stat row sized to their content beside the
// chart). JEV ui.region_gate tokens_stats kept (relevance 1.88; bento 0.22
// low, it matches the security bento after it, so the runner-up card: the
// chart's own frame); motion.intensity 1.64, tier 2; motion.choreography
// reveal (0.34, low, the top pick); ui.component_recipe
// kit.stat_row_chart_count (0.97): the figures count up once and the bars
// grow from the start edge as the section enters. Every number comes from
// docs/reports/token-benchmark.md through data/bench.ts, and the limits of
// the measurement sit in the chart's caption.
import { MediaFrame, StatRow, type Stat } from "@mengai/ui";
import { HEADLINE } from "../data/bench";
import { TokenChart } from "../views/TokenChart";

export const TOKEN_STATS: Stat[] = [
  { value: String(HEADLINE.savingsPct), unit: "%", caption: "fewer billable input tokens for the same work", signal: true },
  { value: String(HEADLINE.promptCutPct), unit: "%", caption: "fewer prompt tokens sent, before any cache" },
  {
    value: String(HEADLINE.cachedSharePct),
    unit: "%",
    caption: `of what v2 sends is read from cache. The largest prompt drops from ${HEADLINE.legacyMaxPrompt.toLocaleString("en-US")} to ${HEADLINE.v2MaxPrompt.toLocaleString("en-US")} tokens.`,
  },
];

export function TokensSection() {
  return (
    <StatRow
      id="tokens"
      tone="base"
      variant="chart"
      title="Same work, far fewer tokens"
      lead={`We replayed the same ${HEADLINE.steps} steps through our old engine and through v2, with no model calls. v2 sends less, and most of what it sends comes from your provider's prompt cache.`}
      stats={TOKEN_STATS}
      chart={
        <MediaFrame
          kind="view"
          tone="surface"
          caption={`${HEADLINE.scenarios} tasks across ${HEADLINE.roles} roles, measured on 29 September 2026. Had the old engine used the same cache, the saving would be ${HEADLINE.savingsIfLegacyCachedPct}%.`}
        >
          <TokenChart />
        </MediaFrame>
      }
    />
  );
}
