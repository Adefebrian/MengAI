// The two preview pages' ledgers (composition.variant in section order),
// kept apart from the pages so tests can check them without loading the
// motion module. Each page renders exactly this order (kit.test.tsx).
import type { RecipeEntry } from "../recipe";

export const LANDING_LEDGER: RecipeEntry[] = [
  "masthead.split",
  "logo-row.row",
  "split.inset",
  "stat-row.lead",
  "sticky-story.stage-end",
  "bento.lead-right",
  "feature-grid.rows",
  "quote.results",
  "spec-table.grouped",
  "pricing.cells-compare",
  "faq.open",
  "cta-band.form",
  "footer.inline",
];

export const MOTION_LEDGER: RecipeEntry[] = [
  "masthead.left",
  "split.bleed",
  "stat-row.chart",
  "feature-grid.lead",
  "sticky-story.stage-end",
  "spec-table.rail",
  "quote.pull",
  "feature-grid.detail",
  "bento.lead-left",
  "faq.split",
  "cta-band.band",
  "footer.statement",
];
