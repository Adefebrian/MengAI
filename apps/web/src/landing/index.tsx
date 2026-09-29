// MengAI landing at "/": a professional SaaS page that sells an autonomous
// AI agent company where every agent is a living cat. Composed from the
// JAL Core kit. The direction contract for this surface is direction.md in
// this folder (the new-hire handbook form on D5 knobs).
//
// Ledger (composition.variant, in page order), validatePageRecipe gives []:
//   masthead.left        the claim over the living office (JEV 0.33, measured)
//   custom.lifecycle     one goal grows a whole company, studio or fund
//   bento.lead-left      the editor, the timeline, decisions and minutes
//   feature-grid.rows    bring your own API key, tools and trading safety
//   bento.lead-right     the measured token numbers around the chart
//   feature-grid.cells   privacy and security
//   faq.split            questions, answered plainly
//   cta-band.split       the close
//   footer.inline        logo, product links, open source, credit, license
import { useEffect } from "react";
import { AppShell, Masthead, Page, type AppShellDestination, type RecipeEntry } from "@mengai/ui";
import { Brand } from "./brand";
import { HeroOffice } from "./hero/HeroOffice";
import { CodeIcon, DownloadIcon, KeyIcon, PlayIcon, ShieldIcon, UsersIcon } from "./icons";
import { DOWNLOAD_URL, WEB_APP_URL } from "./links";
import { CloseSection } from "./sections/Close";
import { KeysSection } from "./sections/Keys";
import { LifecycleSection } from "./sections/Lifecycle";
import { QuestionsSection } from "./sections/Questions";
import { SecuritySection } from "./sections/Security";
import { SiteFooter } from "./sections/SiteFooter";
import { TokensSection } from "./sections/Tokens";
import { WorkbenchSection } from "./sections/Workbench";
import "./landing.css";

export const LANDING_LEDGER: RecipeEntry[] = [
  "masthead.left",
  "custom.lifecycle",
  "bento.lead-left",
  "feature-grid.rows",
  "bento.lead-right",
  "feature-grid.cells",
  "faq.split",
  "cta-band.split",
  "footer.inline",
];

/** JEV ui.tagline h1 (0.49, low confidence, the top pick kept). */
export const TAGLINE = "Hire a whole company of AI cats.";

export const LEAD = "Give Oyen, the CEO cat, one goal. Oyen plans it, hires the cats it needs, and the crew builds, reviews and ships it while you watch.";

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

const TITLE = "MengAI: hire a whole company of AI cats";

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
          brand={<Brand />}
          brandHref="#top"
          destinations={DESTINATIONS}
          current=""
          primaryAction={{ label: "Open the app", href: WEB_APP_URL, icon: <PlayIcon size={20} color="currentColor" /> }}
          archetype={{ header: "rail", bar: "split" }}
          scroll="document"
        >
          <Masthead
            id="top"
            variant="left"
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
            proof={<HeroOffice />}
          />
          <LifecycleSection />
          <WorkbenchSection />
          <KeysSection />
          <TokensSection />
          <SecuritySection />
          <QuestionsSection />
          <CloseSection />
          <SiteFooter />
        </AppShell>
      </Page>
    </div>
  );
}
