// Bring your own API key (kit.split.inset; critic fix round 2: the feature
// list whose only visuals were icon glyphs and mono labels became one app
// view on labelled sample data, as the security bento does). JEV
// ui.region_gate keys kept (relevance 2.98); motion.intensity 0.89, tier 1.
// Release round: the owner asked for more fun in the page's own voice. Each
// claim is two tiers, a short cat line over the plain fact (JEV
// ui.component_recipe claim_style two_tier_cat_line 0.94), and Garong, the
// security cat, guards a flat keychain vault above the view
// (guard_placement guard_panel_above_view 0.90, views/keys.tsx). The
// provider count is the real preset list from @mengai/shared. Nothing here
// names a model as a default: the tier map shows sample ids on the owner's
// own gateway.
import { PROVIDER_PRESETS } from "@mengai/shared";
import { Split } from "@mengai/ui";
import { KeysView } from "../views/keys";

/** Chat providers a cat can run on (media and judge presets excluded). */
export const CHAT_PROVIDERS = PROVIDER_PRESETS.filter((p) => p.caps.includes("chat") && p.protocol !== "jev").map((p) => p.label);
/** The named presets, without the two custom compatible endpoints. */
export const NAMED_PROVIDERS = PROVIDER_PRESETS.filter((p) => p.caps.includes("chat") && p.protocol !== "jev" && !p.id.startsWith("custom")).map((p) => p.label);

export interface KeyPromise {
  /** the cat's own short line */
  say: string;
  /** the plain fact under it */
  fact: string;
}

/** One claim per item, a cat line over the fact, beside the app view. */
export const KEY_PROMISES: KeyPromise[] = [
  { say: "Your keys stay home.", fact: "Keys live in the macOS Keychain, or sealed with AES-256-GCM on your server, and never reach a log." },
  { say: "Any bowl will do.", fact: `${NAMED_PROVIDERS.length} presets, or any OpenAI or Anthropic compatible endpoint, local models included.` },
  { say: "We eat what you serve.", fact: "No house model: fast, balanced and deep map to any model id you add." },
  { say: "Your tools, our paws.", fact: "Your own tools over MCP servers and APIs, their keys in the same keychain." },
  { say: "Paper first, always.", fact: "A fund trades on paper until you switch live trading on yourself." },
  { say: "We ask before we pounce.", fact: "Each live order waits for your approval, unless you set hard limits per order and per day." },
];

export function KeysSection() {
  return (
    <Split
      id="keys"
      tone="layer"
      variant="inset"
      ratio="5/7"
      title="Bring your own API key"
      lead="The cats work on your keys, your models and your tools. Nothing is resold, and nothing leaves the vault except the call itself."
      media={<KeysView />}
    >
      <ul className="lp-keys-claims">
        {KEY_PROMISES.map((c) => (
          <li key={c.say} className="lp-keys-claim">
            <span className="lp-keys-say">{c.say}</span>{" "}
            <span className="lp-keys-fact">{c.fact}</span>
          </li>
        ))}
      </ul>
    </Split>
  );
}
