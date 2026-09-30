// The footer (kit.footer.inline). JEV ui.region_gate footer kept (0.95,
// relevance 1.92, plain_spacing 0.94); ui.component_recipe
// kit.footer.inline (0.85), on the page's center axis since round C
// (kit.footer.inline_centered 0.97, under the centered close; the layout
// lives in landing.css). The logo and the wordmark, one line of product
// links, and the legal line: open source, the credit, the license. The two
// actions live in the close right above it, so the footer does not repeat
// them (round C: six links, one line from 640, three centered rows of two
// on a phone, never a lone link on its own line).
import { Footer, type FooterLink } from "@mengai/ui";
import { Brand } from "../brand";
import { AUTHOR_URL, LICENSE_URL, REPO_URL } from "../links";

export const FOOTER_LINKS: FooterLink[] = [
  { label: "The company", href: "#company" },
  { label: "The app", href: "#workbench" },
  { label: "Keys", href: "#keys" },
  { label: "Security", href: "#security" },
  { label: "Questions", href: "#faq" },
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
