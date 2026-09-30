// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The close (custom.close, round C: the owner asked for a centered,
// professional SaaS close with the buttons under the text). No kit CTABand
// variant centers (split, form and band all start align), so the close is
// hand-written on the kit grid inside <Section>, recorded in direction.md.
// Release round: the owner took the shipped strip and its crew row out, so
// the close is the headline, the lead and the two actions on the page's
// center axis, with the footer right under it.
//
// JEV decisions (verified, round C): ui.region_gate close_text kept (0.55,
// relevance 2.08), close_actions kept (0.79, relevance 2.94). Carried from
// round 2: motion.intensity 1.82, tier 2; motion.choreography
// stagger_sequence (0.84): the text, then the actions rise in order. The
// lead names the license; the credit and the full terms (commercial use by
// written permission) live in the footer under it.
import { useId } from "react";
import { Section, staggerStyle } from "@mengai/ui";
import { DownloadIcon } from "../icons";
import { DOWNLOAD_URL, LICENSE_NAME, WEB_APP_URL } from "../links";

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
            MengAI is source available under the {LICENSE_NAME}, free for personal and noncommercial use, and runs on your own machine. Get the Mac app, open it, and this
            website is only the window: it keeps no account, no key and no data. Every cat runs on the models you pick, on your own key.
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
    </Section>
  );
}
