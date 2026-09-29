// Bring your own API key (custom.divided: JEV ui.component_recipe picked
// kit.feature-grid.rows at 0.50 with low confidence and the JAL Core
// divided-section spec as runner-up, so the spec). Three groups between
// hairline dividers: where the key lives, which providers, which model.
// The provider list is the real preset list from @mengai/shared.
import { useId } from "react";
import { DEFAULT_CHAT_MODEL, PROVIDER_PRESETS } from "@mengai/shared";
import { Section, SectionHead } from "@mengai/ui";

/** Chat providers a cat can run on (media and judge presets excluded). */
export const CHAT_PROVIDERS = PROVIDER_PRESETS.filter((p) => p.caps.includes("chat") && p.protocol !== "jev").map((p) => p.label);

export function KeysSection() {
  const headId = useId();
  const groups = [
    {
      title: "Your key stays in your keychain",
      body: (
        <>
          On the Mac, keys live in the macOS Keychain. On your own server they are sealed with <span className="lp-nowrap">AES-256-GCM</span>. A key leaves
          only inside the request to your provider, and it is scrubbed from every log and tool output.
        </>
      ),
      value: "macOS Keychain",
      extra: null,
    },
    {
      title: "Any provider",
      body: "Pick a preset, or point MengAI at any OpenAI or Anthropic compatible endpoint, local models included.",
      value: `${CHAT_PROVIDERS.length} presets`,
      extra: (
        <ul className="lp-providers" aria-label="Provider presets">
          {CHAT_PROVIDERS.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      ),
    },
    {
      title: `Any model, ${DEFAULT_CHAT_MODEL} by default`,
      body: `Every cat starts on ${DEFAULT_CHAT_MODEL}. Map the fast, balanced and deep tiers to any model id you like, and give a role its own model when it needs one.`,
      value: DEFAULT_CHAT_MODEL,
      extra: null,
    },
  ];
  return (
    <Section id="keys" tone="layer" composition="custom" variant="divided" labelledBy={headId}>
      <SectionHead
        id={headId}
        title="Bring your own API key"
        lead="MengAI never resells tokens. You plug in a key from the provider you already pay, and it stays yours."
      />
      <ul className="lp-divided">
        {groups.map((g) => (
          <li key={g.title} className="lp-divided-row" data-motion="rise">
            <h3 className="kit-title">{g.title}</h3>
            <div className="lp-divided-body">
              <p className="kit-body">{g.body}</p>
              {g.extra}
            </div>
            <p className="lp-divided-value">
              <span className="kit-num">{g.value}</span>
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
