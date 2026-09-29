// The close (kit.cta-band.split). JEV ui.region_gate close kept (0.66,
// relevance 2.75, plain_spacing 0.88); ui.component_recipe
// kit.cta-band.split (0.34, low confidence, the top pick kept);
// motion.intensity 1.01, tier 1. The credit and the license live in the
// footer under it.
import { CTABand, SpecRail } from "@mengai/ui";
import { DownloadIcon } from "../icons";
import { DOWNLOAD_URL, WEB_APP_URL } from "../links";

export function CloseSection() {
  return (
    <CTABand
      id="get"
      variant="split"
      title="Open the office. The crew is ready."
      lead={
        <>
          MengAI is open source under <span className="lp-nowrap">Apache-2.0</span>. Run the web app on your own server, or get the Mac app and keep
          everything on your machine.
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
      proof={
        <SpecRail
          label="MengAI at a glance"
          rows={[
            { label: "License", value: "Apache-2.0" },
            { label: "Runs on", value: "Your Mac or your own server" },
            { label: "Default model", value: "gpt-4o-mini", numeric: true },
          ]}
        />
      }
    />
  );
}
