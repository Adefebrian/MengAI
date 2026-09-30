// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The proof strip under the hero (kit.logo-row.row, attached). JEV
// ui.region_gate hero_logos kept (relevance 1.75; divided_section 0.34 low,
// it matches the lifecycle band below, so the runner-up plain_spacing, the
// kit row's own); motion.intensity 0.88, tier 1; ui.component_recipe
// kit.logo_row_rise (0.47, low, the top pick kept). Real platforms only:
// six of the provider presets in @mengai/shared as text marks in one ink,
// and the count of every preset a cat can run on.
import { LogoRow, type Logo } from "@mengai/ui";
import { NAMED_PROVIDERS } from "./Keys";

/** The preset id and the name its mark shows (the vendor's own short name). */
export const PROVIDER_MARKS: { id: string; name: string }[] = [
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic" },
  { id: "gemini", name: "Gemini" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "mistral", name: "Mistral" },
  { id: "ollama", name: "Ollama" },
];

export const LOGOS_LABEL = `Runs on your own key, from ${NAMED_PROVIDERS.length} providers or any compatible endpoint`;

export function LogosSection() {
  const logos: Logo[] = PROVIDER_MARKS.map((p) => ({ name: p.name }));
  return <LogoRow id="providers" label={LOGOS_LABEL} logos={logos} />;
}
