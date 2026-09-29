// MengAI landing at "/". Composed from the JAL Core kit under direction D1
// research_notebook (the ethogram form: JEV ui.direction_screen re-screened
// for this brief, the seeded draw kept D1). Every section below passed JEV
// ui.region_gate; each recipe and layer is JEV's ui.component_recipe pick;
// motion per section is JEV motion.intensity (hero, board and loop tier 2
// through their own recipes, every other section tier 1, the kit's quiet
// entrance). The headline is JEV ui.tagline t5.
//
// Ledger (composition.variant, in order), validatePageRecipe returns []:
//   masthead.split, custom.card, custom.plain, custom.list, custom.table,
//   stat-row.chart, spec-rail, feature-grid.cells, custom.plain, faq.open,
//   custom.close
// The footer region was dropped by ui.region_gate (relevance 1.31), so the
// credit and license line closes the last section instead.
import { useEffect } from "react";
import { AppShell, Masthead, Page, type AppShellDestination, type RecipeEntry } from "@mengai/ui";
import { Headline } from "./hero/Headline";
import { Relay } from "./hero/Relay";
import { ActivityIcon, ChartBarIcon, DownloadIcon, KeyIcon, RefreshIcon, ShieldIcon } from "./icons";
import { DOWNLOAD_URL, WEB_APP_URL } from "./links";
import {
  BoardSection,
  CloseSection,
  CrewSection,
  DecisionsSection,
  KeysSection,
  LoopSection,
  QuestionsSection,
  SecuritySection,
  SourceSection,
  TokensSection,
} from "./sections/sections";
import "./landing.css";

export const LANDING_LEDGER: RecipeEntry[] = [
  "masthead.split",
  "custom.card",
  "custom.plain",
  "custom.list",
  "custom.table",
  "stat-row.chart",
  "spec-rail",
  "feature-grid.cells",
  "custom.plain",
  "faq.open",
  "custom.close",
];

export const TAGLINE = "Give the cats a goal. Watch them ship it.";

export const LEAD = "Every agent in MengAI is a living cat. Kopi plans your goal into tasks, and the crew builds, reviews and hands the work back to you.";

const DESTINATIONS: AppShellDestination[] = [
  { id: "board", label: "The app", href: "#board", icon: <ActivityIcon size={24} color="currentColor" /> },
  { id: "loop", label: "Workflow", href: "#loop", icon: <RefreshIcon size={24} color="currentColor" /> },
  { id: "tokens", label: "Tokens", href: "#tokens", icon: <ChartBarIcon size={24} color="currentColor" /> },
  { id: "security", label: "Security", href: "#security", icon: <ShieldIcon size={24} color="currentColor" /> },
];

const TITLE = "MengAI: give the cats a goal, watch them ship it";

export function Landing() {
  useEffect(() => {
    const previous = document.title;
    document.title = TITLE;
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="lp">
      <Page direction="D1" rhythm="default" motion="quiet">
        <AppShell
          title="MengAI"
          brand={<span className="lp-mark">MengAI</span>}
          brandHref="#top"
          destinations={DESTINATIONS}
          current=""
          primaryAction={{ label: "Download for Mac", href: DOWNLOAD_URL, icon: <DownloadIcon size={20} color="currentColor" /> }}
          archetype={{ header: "island", bar: "split" }}
          scroll="document"
        >
          <Masthead
            id="top"
            variant="split"
            title={<Headline text={TAGLINE} />}
            lead={LEAD}
            actions={
              <>
                <a className="btn" href={DOWNLOAD_URL}>
                  Download for Mac
                </a>
                <a className="btn btn-secondary" href={WEB_APP_URL}>
                  Open the app
                </a>
                <p className="lp-byok">
                  <KeyIcon size={20} color="currentColor" />
                  <span>
                    <strong>Bring your own API key.</strong> It stays in your keychain. Any provider, any model, gpt-4o-mini by default.
                  </span>
                </p>
              </>
            }
            media={<Relay />}
          />
          <BoardSection />
          <LoopSection />
          <CrewSection />
          <DecisionsSection />
          <TokensSection />
          <KeysSection />
          <SecuritySection />
          <SourceSection />
          <QuestionsSection />
          <CloseSection />
        </AppShell>
      </Page>
    </div>
  );
}
