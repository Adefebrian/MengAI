// The capability tools on top of the static registry, kept out of every
// prompt until they matter (token efficiency):
// - find_tools: one small tool that searches the owner's connector tools;
//   the matches join the cat's tool list for the rest of the task, so a task
//   carries only the connector schemas it actually uses
// - trading tools (get_quote, propose_order, review_order, positions): only
//   for the cats a company template grants them to
// Pure: specs, names and the search.
import type { ToolSpec } from "../../core/ports";
import type { BridgeTool } from "./ports";

export const FIND_TOOLS = "find_tools";

export const FIND_TOOLS_SPEC: ToolSpec = {
  name: FIND_TOOLS,
  description: "Search the owner's connector tools (MCP servers and HTTP APIs) for what you need. The matches join your tool list from your next step.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", maxLength: 200 }, limit: { type: "integer", minimum: 1, maximum: 8 } },
    required: ["query"],
  },
};

export const TRADING_ORDER = ["get_quote", "propose_order", "review_order", "positions"] as const;
export type TradingToolName = (typeof TRADING_ORDER)[number];

const SYMBOL = { type: "string", description: "Ticker, e.g. BTC-USD or AAPL", maxLength: 24 };

export const TRADING_SPECS: Record<TradingToolName, ToolSpec> = {
  get_quote: {
    name: "get_quote",
    description: "Last price of a symbol from the owner's connector price tool.",
    parameters: { type: "object", properties: { symbol: SYMBOL }, required: ["symbol"] },
  },
  propose_order: {
    name: "propose_order",
    description:
      "Propose an order. Paper by default; live only proposes it for the risk manager and then the owner's gate. Give the quote you read and a one line reason. Facts, never advice.",
    parameters: {
      type: "object",
      properties: {
        symbol: SYMBOL,
        side: { type: "string", enum: ["buy", "sell"] },
        qty: { type: "number", minimum: 0 },
        type: { type: "string", enum: ["market", "limit"] },
        limit_price: { type: "number", minimum: 0 },
        quote: { type: "number", minimum: 0, description: "the last price you read" },
        live: { type: "boolean" },
        venue: { type: "string", maxLength: 100, description: "live only: the connector tool that places orders" },
        reason: { type: "string", maxLength: 300 },
      },
      required: ["symbol", "side", "qty", "reason"],
    },
  },
  review_order: {
    name: "review_order",
    description: "Risk review of a proposed order: approve or reject with a note. Without order_id it takes the oldest order waiting for review. Never your own order.",
    parameters: {
      type: "object",
      properties: {
        order_id: { type: "string", maxLength: 64 },
        verdict: { type: "string", enum: ["approve", "reject"] },
        note: { type: "string", maxLength: 400 },
      },
      required: ["verdict", "note"],
    },
  },
  positions: {
    name: "positions",
    description: "Positions with realized and unrealized P&L, and the orders of this run waiting for a risk review.",
    parameters: { type: "object", properties: {} },
  },
};

export function isTradingTool(name: string): name is TradingToolName {
  return (TRADING_ORDER as readonly string[]).includes(name);
}

/** "binance__get_ticker" or "binance.get_ticker" to the namespaced name; null for a registry tool name. */
export function dotted(name: string): string | null {
  if (name.indexOf(".") > 0) return name;
  const at = name.indexOf("__");
  return at > 0 ? `${name.slice(0, at)}.${name.slice(at + 2)}` : null;
}

/** The spec a loaded connector tool adds: its alias, a short description with the connector and risk, its schema. */
export function connectorSpec(t: BridgeTool): ToolSpec {
  return { name: t.alias, description: `${t.description} (${t.connectorLabel}, ${t.risk})`.slice(0, 300), parameters: t.schema };
}

const words = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

/** Connector tools ranked by word overlap with the query (name words count double); ties keep their order. */
export function searchTools(tools: readonly BridgeTool[], query: string, limit: number): BridgeTool[] {
  const q = new Set(words(query));
  if (q.size === 0) return tools.slice(0, limit);
  const scored = tools.map((t, i) => {
    const name = words(`${t.connectorLabel} ${t.name.slice(t.name.indexOf(".") + 1)}`);
    const desc = words(t.description);
    let score = 0;
    for (const w of q) {
      if (name.includes(w)) score += 2;
      else if (desc.includes(w)) score += 1;
    }
    return { t, i, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.t);
}

/** "symbol*, interval" for a schema's arguments (required ones starred). */
export function argsLine(schema: Record<string, unknown>): string {
  const props = (schema.properties ?? {}) as Record<string, unknown>;
  const req = new Set((schema.required as string[] | undefined) ?? []);
  const names = Object.keys(props);
  if (!names.length) return "no arguments";
  const shown = names.slice(0, 12).map((n) => `${n}${req.has(n) ? "*" : ""}`);
  return `${shown.join(", ")}${names.length > 12 ? `, +${names.length - 12} more` : ""}`;
}
