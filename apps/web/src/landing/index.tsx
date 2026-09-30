// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// MengAI landing at "/": a professional SaaS page that sells an autonomous
// AI agent company where every agent is a living cat. Composed from the
// JAL Core kit. The direction contract for this surface is direction.md in
// this folder (the new-hire handbook form on D5 knobs).
//
// Ledger (composition.variant, in page order), validatePageRecipe gives []:
//   masthead.left        the claim over the product frame: the app's run
//                        view with the living office at work inside it;
//                        Open the app, then the Mac and Windows betas and
//                        one platform line (Android coming soon)
//   logo-row.row         runs on your own key, the providers (attached)
//   custom.lifecycle     one goal grows a whole company, studio or fund
//   bento.lead-left      the editor, the timeline, decisions and minutes
//   split.inset          bring your own API key: one line per claim beside
//                        the app's key, tier, connector and trading view
//   stat-row.chart       the measured token numbers beside the chart
//   bento.lead-right     the safety controls, as the app shows them
//   faq.split            questions, answered plainly
//   custom.close         the close, centered (round C, the owner's call; no
//                        kit CTABand variant centers), with the crew strip
//   footer.inline        logo, product links, the credit and the license
//                        (source available, free for noncommercial use),
//                        on the page's center axis under the close
//
// Motion (motion/): the hero is tier 3 (JEV motion.intensity 2.85), the
// rest of the page tier 2 or lower; Lenis, KitMotion and the frame's scrub
// load as one lazy chunk on this route only.
import { useEffect } from "react";
import { AppShell, Masthead, Page, type AppShellDestination, type RecipeEntry } from "@mengai/ui";
import { Brand } from "./brand";
import { HeroFrame } from "./hero/HeroFrame";
import { DownloadButtons, DownloadLine } from "./DownloadRow";
import { CodeIcon, KeyIcon, PlayIcon, ShieldIcon, UsersIcon } from "./icons";
import { WEB_APP_URL } from "./links";
import { CloseSection } from "./sections/Close";
import { KeysSection } from "./sections/Keys";
import { LifecycleSection } from "./sections/Lifecycle";
import { LogosSection } from "./sections/Logos";
import { LandingMotion } from "./motion/Motion";
import { QuestionsSection } from "./sections/Questions";
import { SecuritySection } from "./sections/Security";
import { SiteFooter } from "./sections/SiteFooter";
import { TokensSection } from "./sections/Tokens";
import { WorkbenchSection } from "./sections/Workbench";
import "./landing.css";

export const LANDING_LEDGER: RecipeEntry[] = [
  "masthead.left",
  "logo-row.row",
  "custom.lifecycle",
  "bento.lead-left",
  "split.inset",
  "stat-row.chart",
  "bento.lead-right",
  "faq.split",
  "custom.close",
  "footer.inline",
];

/** JEV ui.tagline h1 (0.49, low confidence, the top pick kept). */
export const TAGLINE = "Hire a whole company of AI cats.";

export const LEAD = "Give Oyen, the CEO cat, one goal. Oyen plans it, hires the cats it needs, and the crew builds, reviews and ships it while you watch.";

const DESTINATIONS: AppShellDestination[] = [
  { id: "company", label: "Company", href: "#company", icon: <UsersIcon size={24} color="currentColor" /> },
  { id: "workbench", label: "The app", href: "#workbench", icon: <CodeIcon size={24} color="currentColor" /> },
  { id: "keys", label: "Keys", href: "#keys", icon: <KeyIcon size={24} color="currentColor" /> },
  { id: "security", label: "Security", href: "#security", icon: <ShieldIcon size={24} color="currentColor" /> },
];

const TITLE = "MengAI: hire a whole company of AI cats";

export function Landing({ motion = true }: { motion?: boolean }) {
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
          <LandingMotion engine={motion} />
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
                <DownloadButtons />
                <DownloadLine />
              </>
            }
            proof={<HeroFrame />}
          />
          <LogosSection />
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
