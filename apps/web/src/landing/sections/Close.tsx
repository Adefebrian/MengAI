// The close (kit.cta-band.split, JEV 1.0; tier 1): start now, open source.
// JEV ui.region_gate dropped a separate footer (relevance 1.01, it repeats
// the close), so the credit and the license close this section.
import { CTABand, SpecRail } from "@mengai/ui";
import { DownloadIcon } from "../icons";
import { AUTHOR_URL, DOWNLOAD_URL, LICENSE_URL, REPO_URL, WEB_APP_URL } from "../links";

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
        <div className="lp-close-proof">
          <SpecRail
            label="MengAI at a glance"
            rows={[
              { label: "License", value: "Apache-2.0" },
              { label: "Runs on", value: "Your Mac or your own server" },
              { label: "Default model", value: "gpt-4o-mini", numeric: true },
            ]}
          />
          <p className="kit-meta lp-credit">
            Built by <a href={AUTHOR_URL}>Adefebrian</a>. Source on <a href={REPO_URL}>GitHub</a>, licensed under{" "}
            <a href={LICENSE_URL}>Apache-2.0</a>.
          </p>
        </div>
      }
    />
  );
}
