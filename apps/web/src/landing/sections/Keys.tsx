// Bring your own API key (kit.split.inset; critic fix round 2: the feature
// list whose only visuals were icon glyphs and mono labels became one app
// view on labelled sample data, as the security bento does). JEV
// ui.region_gate keys kept (relevance 2.98); motion.intensity 0.89, tier 1.
// The text column keeps one line per claim beside the view: where the key
// lives, which providers, how models map, which tools, and the two trading
// safety defaults. The provider count is the real preset list from
// @mengai/shared. The view names no model as a default: the tier map shows
// sample ids on the owner's own gateway.
import { PROVIDER_PRESETS } from "@mengai/shared";
import { Split } from "@mengai/ui";
import { KeysView } from "../views/keys";

/** Chat providers a cat can run on (media and judge presets excluded). */
export const CHAT_PROVIDERS = PROVIDER_PRESETS.filter((p) => p.caps.includes("chat") && p.protocol !== "jev").map((p) => p.label);
/** The named presets, without the two custom compatible endpoints. */
export const NAMED_PROVIDERS = PROVIDER_PRESETS.filter((p) => p.caps.includes("chat") && p.protocol !== "jev" && !p.id.startsWith("custom")).map((p) => p.label);

/** One line per claim, beside the app view. */
export const KEY_PROMISES: string[] = [
  "Keys live in the macOS Keychain, or sealed with AES-256-GCM on your server, and never reach a log.",
  `${NAMED_PROVIDERS.length} presets, or any OpenAI or Anthropic compatible endpoint, local models included.`,
  "No house model: fast, balanced and deep map to any model id you add.",
  "Your own tools over MCP servers and APIs, their keys in the same keychain.",
  "A fund trades on paper until you switch live trading on yourself.",
  "Each live order waits for your approval, unless you set hard limits per order and per day.",
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
        {KEY_PROMISES.map((line) => (
          <li key={line} className="lp-keys-claim">
            {line}
          </li>
        ))}
      </ul>
    </Split>
  );
}
