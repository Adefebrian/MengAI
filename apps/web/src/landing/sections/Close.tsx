// The close (custom.close, round C: the owner asked for a centered,
// professional SaaS close with the buttons under the text). No kit CTABand
// variant centers (split, form and band all start align), so the close is
// hand-written on the kit grid inside <Section>, recorded in direction.md.
// It still carries the page's own world under the buttons.
//
// JEV decisions (verified, round C): ui.region_gate close_text kept (0.55,
// relevance 2.08), close_actions kept (0.79, relevance 2.94), close_proof
// kept (0.68, relevance 1.64) as a divided_section (0.44, low, the primary:
// it matches neither neighbour); ui.component_recipe close_strip
// core.strip_line_then_crew (0.30, low, the top pick; the runner-up is not
// the JAL Core spec). Carried from round 2: motion.intensity 1.82, tier 2;
// motion.choreography stagger_sequence (0.84): the text, then the actions,
// then the strip rise in order, and the crew celebrates one cat after
// another. The credit and the license live in the footer under it.
import { useId } from "react";
import { Section, staggerStyle } from "@mengai/ui";
import { DownloadIcon } from "../icons";
import { DOWNLOAD_URL, WEB_APP_URL } from "../links";
import { ShippedView } from "../views/shipped";

export const CLOSE_TITLE = "Open the office. The crew is ready.";

export function CloseSection() {
  const headingId = useId();
  return (
    <Section id="get" tone="layer" composition="custom" variant="close" labelledBy={headingId} className="lp-close">
      <div className="lp-close-head">
        <div className="lp-close-text" data-motion="rise">
          <h2 id={headingId} className="kit-heading">
            {CLOSE_TITLE}
          </h2>
          <p className="kit-lead">
            MengAI is open source under <span className="lp-nowrap">Apache-2.0</span>. Run the web app on your own server, or get the Mac app and keep
            everything on your machine. Every cat runs on the models you pick, on your own key.
          </p>
        </div>
        <div className="kit-actions lp-close-actions" data-motion="rise" style={staggerStyle(1)}>
          <a className="btn" href={WEB_APP_URL}>
            Open the app
          </a>
          <a className="btn btn-secondary" href={DOWNLOAD_URL}>
            <DownloadIcon size={20} color="currentColor" />
            <span>Download for Mac</span>
          </a>
        </div>
      </div>
      <div className="lp-close-proof" data-motion="rise" style={staggerStyle(2)}>
        <ShippedView />
      </div>
    </Section>
  );
}
