// The footer (kit.footer.inline). JEV ui.region_gate footer kept (0.95,
// relevance 1.92, plain_spacing 0.94); ui.component_recipe
// kit.footer.inline (0.85). The logo and the wordmark, one line of product
// links, and the legal line: open source, the credit, the license.
import { Footer, type FooterLink } from "@mengai/ui";
import { Brand } from "../brand";
import { AUTHOR_URL, DOWNLOAD_URL, LICENSE_URL, REPO_URL, WEB_APP_URL } from "../links";

export const FOOTER_LINKS: FooterLink[] = [
  { label: "The company", href: "#company" },
  { label: "The app", href: "#workbench" },
  { label: "Keys", href: "#keys" },
  { label: "Security", href: "#security" },
  { label: "Questions", href: "#faq" },
  { label: "Open the app", href: WEB_APP_URL },
  { label: "Download for Mac", href: DOWNLOAD_URL },
  { label: "Source on GitHub", href: REPO_URL },
];

export function SiteFooter() {
  return (
    <Footer
      variant="inline"
      brand={<Brand />}
      links={FOOTER_LINKS}
      legal={
        <>
          Open source under <a href={LICENSE_URL}>Apache-2.0</a>. Built by <a href={AUTHOR_URL}>Adefebrian</a>.
        </>
      }
    />
  );
}
