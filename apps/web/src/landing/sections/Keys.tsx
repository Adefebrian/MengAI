// Bring your own API key (kit.feature-grid.rows). JEV ui.region_gate keys
// kept (relevance 2.98, container rows 0.54); ui.component_recipe
// kit.feature-grid.rows (0.29, low confidence, the top pick kept: the
// runner-up is not the JAL Core component spec); motion.intensity 0.89,
// tier 1. Six promises, one per row, each with the value it comes down to:
// where the key lives, which providers, how models map, which tools, and the
// two trading safety defaults. The provider count is the real preset list
// from @mengai/shared.
import { PROVIDER_PRESETS } from "@mengai/shared";
import { FeatureGrid, type Feature } from "@mengai/ui";
import { ActivityIcon, ChartBarIcon, CodeIcon, KeyIcon, RefreshIcon, UserCheckIcon } from "../icons";

/** Chat providers a cat can run on (media and judge presets excluded). */
export const CHAT_PROVIDERS = PROVIDER_PRESETS.filter((p) => p.caps.includes("chat") && p.protocol !== "jev").map((p) => p.label);
/** The named presets, without the two custom compatible endpoints. */
export const NAMED_PROVIDERS = PROVIDER_PRESETS.filter((p) => p.caps.includes("chat") && p.protocol !== "jev" && !p.id.startsWith("custom")).map((p) => p.label);

export const KEY_PROMISES: Feature[] = [
  {
    title: "Your keys stay in your keychain",
    body: "On the Mac a key lives in the macOS Keychain, on your server it is sealed with AES-256-GCM. A cat borrows it for one request and never sees it in a log.",
    icon: <KeyIcon size={20} color="currentColor" />,
    meta: "Keychain",
  },
  {
    title: "Any provider you already pay",
    body: `${NAMED_PROVIDERS.slice(0, 6).join(", ")} and ${NAMED_PROVIDERS.length - 6} more presets, or any OpenAI or Anthropic compatible endpoint, local models included. MengAI never resells a token.`,
    icon: <RefreshIcon size={20} color="currentColor" />,
    meta: `${NAMED_PROVIDERS.length} presets`,
  },
  {
    title: "Any model, your pick per desk",
    body: "No house model and no lock-in. Give Oyen a deep thinker and a busy desk a quick one: fast, balanced and deep tiers map to any model id from any provider you added.",
    icon: <ActivityIcon size={20} color="currentColor" />,
    meta: "Fast, balanced, deep",
  },
  {
    title: "Your own tools, over MCP and APIs",
    body: "Connect external MCP servers and the APIs your company already uses. Their keys sit in the same keychain, never in a prompt.",
    icon: <CodeIcon size={20} color="currentColor" />,
    meta: "MCP and APIs",
  },
  {
    title: "Paper trading until you say live",
    body: "A fund starts on paper: every order is simulated, with no real money, until you switch live trading on. Only you can flip that switch.",
    icon: <ChartBarIcon size={20} color="currentColor" />,
    meta: "Paper first",
  },
  {
    title: "Live orders wait for your yes",
    body: "Each live order asks for your approval, unless you set hard limits: a cap per order and per day that no cat can cross.",
    icon: <UserCheckIcon size={20} color="currentColor" />,
    meta: "Your approval",
  },
];

export function KeysSection() {
  return (
    <FeatureGrid
      id="keys"
      tone="layer"
      variant="rows"
      title="Bring your own API key"
      lead="The cats work on your keys, your models and your tools. Nothing is resold, and nothing leaves the vault except the call itself."
      items={KEY_PROMISES}
    />
  );
}
