// MengAI landing at "/": a professional SaaS page that sells an autonomous
// AI agent company where every agent is a living cat. Composed from the
// JAL Core kit. The direction contract for this surface is direction.md in
// this folder (the new-hire handbook form on D5 knobs, JEV
// ui.direction_screen re-roll 1, pool of one, key abaae16c).
//
// Ledger (composition.variant, in page order), validatePageRecipe gives []:
//   masthead.split     the claim beside the live office (Opening move)
//   custom.steps       how the company runs itself, pinned from 1024
//   bento.lead-left    the editor, the timeline, decisions and minutes
//   custom.divided     bring your own API key
//   bento.lead-right   the measured token numbers around the chart
//   feature-grid.cells privacy and security
//   faq.open           plain answers
//   cta-band.split     the close, with the credit and the license
// JEV ui.region_gate dropped the footer region (relevance 1.01), so the
// credit and license live in the close.
import { useEffect } from "react";
import { AppShell, Masthead, Page, type AppShellDestination, type RecipeEntry } from "@mengai/ui";
import { HeroOffice } from "./hero/HeroOffice";
import { CodeIcon, DownloadIcon, KeyIcon, PlayIcon, ShieldIcon, UsersIcon } from "./icons";
import { DOWNLOAD_URL, WEB_APP_URL } from "./links";
import { CloseSection } from "./sections/Close";
import { CompanySection } from "./sections/Company";
import { KeysSection } from "./sections/Keys";
import { QuestionsSection } from "./sections/Questions";
import { SecuritySection } from "./sections/Security";
import { TokensSection } from "./sections/Tokens";
import { WorkbenchSection } from "./sections/Workbench";
import "./landing.css";

export const LANDING_LEDGER: RecipeEntry[] = [
  "masthead.split",
  "custom.steps",
  "bento.lead-left",
  "custom.divided",
  "bento.lead-right",
  "feature-grid.cells",
  "faq.open",
  "cta-band.split",
];

/** JEV ui.tagline t5 (0.68). */
export const TAGLINE = "A company of cats that ships your code.";

export const LEAD = "Kopi, the CEO cat, plans your goal. The crew builds at their own desks, meets and reviews every change before it reaches you.";

export const BYOK = {
  title: "Bring your own API key.",
  body: "It stays in your keychain. Any provider, any model, gpt-4o-mini by default.",
};

const DESTINATIONS: AppShellDestination[] = [
  { id: "company", label: "Company", href: "#company", icon: <UsersIcon size={24} color="currentColor" /> },
  { id: "workbench", label: "The app", href: "#workbench", icon: <CodeIcon size={24} color="currentColor" /> },
  { id: "keys", label: "Keys", href: "#keys", icon: <KeyIcon size={24} color="currentColor" /> },
  { id: "security", label: "Security", href: "#security", icon: <ShieldIcon size={24} color="currentColor" /> },
];

const TITLE = "MengAI: a company of cats that ships your code";

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
      <Page direction="D5" rhythm="default" motion="quiet">
        <AppShell
          title="MengAI"
          brand={<span className="lp-mark">MengAI</span>}
          brandHref="#top"
          destinations={DESTINATIONS}
          current=""
          primaryAction={{ label: "Open the app", href: WEB_APP_URL, icon: <PlayIcon size={20} color="currentColor" /> }}
          archetype={{ header: "rail", bar: "split" }}
          scroll="document"
        >
          <Masthead
            id="top"
            variant="split"
            title={TAGLINE}
            lead={LEAD}
            actions={
              <>
                <a className="btn" href={WEB_APP_URL}>
                  Open the app
                </a>
                <a className="btn btn-secondary" href={DOWNLOAD_URL}>
                  <DownloadIcon size={20} color="currentColor" />
                  <span>Download for Mac</span>
                </a>
                <p className="lp-byok">
                  <KeyIcon size={20} color="currentColor" />
                  <span>
                    <strong>{BYOK.title}</strong> {BYOK.body}
                  </span>
                </p>
              </>
            }
            media={<HeroOffice />}
          />
          <CompanySection />
          <WorkbenchSection />
          <KeysSection />
          <TokensSection />
          <SecuritySection />
          <QuestionsSection />
          <CloseSection />
        </AppShell>
      </Page>
    </div>
  );
}
