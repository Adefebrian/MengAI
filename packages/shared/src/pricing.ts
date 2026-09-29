// Default USD prices per 1M tokens, used to show cost and enforce USD budgets.
// Vendors change prices: these are defaults the owner can override in
// Settings (stored server side). Unknown models cost 0 and are flagged.

export interface ModelPrice {
  input: number;
  cachedInput: number;
  /** Anthropic-style cache writes; defaults to input when absent */
  cacheWrite?: number;
  output: number;
}

/** Keys are matched as exact model id first, then longest prefix. */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1": { input: 2, cachedInput: 0.5, output: 8 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },
  "claude-haiku-4-5": { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
  "claude-sonnet": { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  "claude-opus": { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  "deepseek-chat": { input: 0.27, cachedInput: 0.07, output: 1.1 },
  "deepseek-reasoner": { input: 0.55, cachedInput: 0.14, output: 2.19 },
  "gemini-2.5-flash": { input: 0.3, cachedInput: 0.075, output: 2.5 },
  "gemini-2.5-pro": { input: 1.25, cachedInput: 0.31, output: 10 },
};

export function priceFor(model: string, overrides: Record<string, ModelPrice> = {}): { price: ModelPrice; known: boolean } {
  const table = { ...DEFAULT_PRICES, ...overrides };
  const bare = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  if (table[bare]) return { price: table[bare]!, known: true };
  let best: string | null = null;
  for (const key of Object.keys(table)) {
    if (bare.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  if (best) return { price: table[best]!, known: true };
  return { price: { input: 0, cachedInput: 0, output: 0 }, known: false };
}

/**
 * Cost of one call. inputTokens is the full prompt size as the vendor
 * reports it; cachedTokens is the part of it read from cache.
 */
export function costUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens: number },
  overrides: Record<string, ModelPrice> = {},
): number {
  const { price } = priceFor(model, overrides);
  const uncached = Math.max(0, usage.inputTokens - usage.cachedTokens - usage.cacheWriteTokens);
  const cents =
    uncached * price.input +
    usage.cachedTokens * price.cachedInput +
    usage.cacheWriteTokens * (price.cacheWrite ?? price.input) +
    usage.outputTokens * price.output;
  return cents / 1_000_000;
}
