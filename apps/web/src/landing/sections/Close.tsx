// The close (kit.cta-band.split; critic fix round 2: the close carries the
// page's own world). JEV ui.region_gate close_crew kept (relevance 2.18,
// card 0.14 low, the primary: it matches neither neighbour);
// motion.intensity 1.82, tier 2; motion.choreography stagger_sequence
// (0.84); ui.component_recipe kit.cta_split_sequence (1.00): the heading,
// the lead and the actions rise in order, then the shipped card, then the
// crew celebrates one cat after another. The credit and the license live
// in the footer under it.
import { CTABand } from "@mengai/ui";
import { DownloadIcon } from "../icons";
import { DOWNLOAD_URL, WEB_APP_URL } from "../links";
import { ShippedView } from "../views/shipped";

export const CLOSE_TITLE = "Open the office. The crew is ready.";

export function CloseSection() {
  return (
    <CTABand
      id="get"
      variant="split"
      title={CLOSE_TITLE}
      lead={
        <>
          MengAI is open source under <span className="lp-nowrap">Apache-2.0</span>. Run the web app on your own server, or get the Mac app and keep
          everything on your machine. Every cat runs on the models you pick, on your own key.
        </>
      }
      actions={
        <>
          <a className="btn" href={WEB_APP_URL}>
            Open the app
          </a>
          <a className="btn btn-secondary" href={DOWNLOAD_URL}>
            <DownloadIcon size={20} color="currentColor" />
            <span>Download for Mac</span>
          </a>
        </>
      }
      proof={<ShippedView />}
    />
  );
}
