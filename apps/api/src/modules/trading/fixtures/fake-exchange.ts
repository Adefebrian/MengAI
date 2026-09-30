// A fake exchange MCP server over stdio for the venue tests (bun fake-exchange.ts).
// Newline-delimited JSON-RPC: initialize, tools/list, tools/call. It checks
// what a real exchange server would: the exchange id from its env, symbols in
// BASE/QUOTE form, the API key for account reads, and a size cap on orders.
// get_status reports the mode flags the desk put on the command line.
const EXCHANGE = process.env.CCXT_MCP_EXCHANGE ?? "";
const KEY = process.env.CCXT_MCP_APIKEY ?? "";
const TOOLS = [
  { name: "search_markets", description: "Search the markets of an exchange.", inputSchema: { type: "object", properties: { exchange: { type: "string" }, query: { type: "string" } }, required: ["exchange"] }, annotations: { readOnlyHint: true } },
  { name: "get_ticker", description: "Last price of one market.", inputSchema: { type: "object", properties: { exchange: { type: "string" }, symbol: { type: "string" } }, required: ["exchange", "symbol"] }, annotations: { readOnlyHint: true } },
  { name: "get_balance", description: "Balances of the configured account.", inputSchema: { type: "object", properties: { exchange: { type: "string" } }, required: ["exchange"] }, annotations: { readOnlyHint: true } },
  { name: "get_safety_status", description: "Tiers and limits.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  {
    name: "create_order",
    description: "Create an order.",
    inputSchema: {
      type: "object",
      properties: { exchange: { type: "string" }, symbol: { type: "string" }, side: { type: "string" }, amount: { type: "number", description: "amount of the base currency" }, type: { type: "string" }, price: { type: "number" }, clientOrderId: { type: "string" } },
      required: ["exchange", "symbol", "side", "amount", "type"],
    },
  },
  { name: "cancel_order", description: "Cancel an order.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
];

const send = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
const PRICES: Record<string, number> = { "BTC/USDT": 50000.5, "ETH/USDT": 2500.25 };

function tool(name: string, a: Record<string, unknown>) {
  if (name === "get_safety_status") return text(`rate limit: 20 requests per second. trading=${process.env.CCXT_MCP_TRADING ?? "off"} sandbox=${process.env.CCXT_MCP_SANDBOX ?? "false"} cap=${process.env.CCXT_MCP_MAX_ORDER_VALUE ?? "none"}`);
  if (a.exchange !== EXCHANGE) return text(`exchange ${String(a.exchange)} is not configured`, true);
  if (name === "search_markets") return text(JSON.stringify(Object.keys(PRICES).map((symbol) => ({ symbol, active: true }))));
  if (name === "get_ticker") {
    const s = String(a.symbol);
    if (!(s in PRICES)) return text(`bad symbol ${s}: markets look like BTC/USDT`, true);
    return text(JSON.stringify({ symbol: s, last: PRICES[s], bid: PRICES[s]! - 1 }));
  }
  if (name === "get_balance") return KEY ? text(JSON.stringify({ USDT: { free: 1000 } })) : text("401 Unauthorized: invalid api key", true);
  if (name === "create_order") {
    if (!process.env.CCXT_MCP_TRADING) return text("trading is not enabled for this account", true);
    if (Number(a.amount) > 1) return text("insufficient balance for 2 BTC", true);
    return text(JSON.stringify({ status: "closed", average: 50010, got: a }));
  }
  return text(`no tool ${name}`, true);
}

function handle(msg: { id?: number; method?: string; params?: Record<string, unknown> }) {
  if (msg.method === undefined || msg.id === undefined) return;
  if (msg.method === "initialize") return send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-exchange", version: "1" } } });
  if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
  if (msg.method === "tools/call") return send({ jsonrpc: "2.0", id: msg.id, result: tool(String(msg.params?.name), (msg.params?.arguments ?? {}) as Record<string, unknown>) });
  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `no method ${msg.method}` } });
}

let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString();
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      // ignore garbage
    }
  }
});
process.stdin.on("end", () => process.exit(0));
