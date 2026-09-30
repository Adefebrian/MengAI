// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A fake MCP server over stdio for the connector tests (bun fake-mcp.ts).
// Newline-delimited JSON-RPC: initialize, tools/list (two pages), tools/call.
// Tools: get_price (read), place_order (money), delete_note (destructive),
// env_keys (which env vars it can see), echo, slow (never answers in time),
// crash (exits). It pings the client once after initialize.
const TOOLS = [
  { name: "get_price", description: "Get the last price of a symbol.", inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] }, annotations: { readOnlyHint: true } },
  { name: "place_order", description: "Place an order on the exchange.", inputSchema: { type: "object", properties: { symbol: { type: "string" }, side: { type: "string" }, qty: { type: "number" }, type: { type: "string" }, price: { type: "number" } } } },
  { name: "delete_note", description: "Delete a note.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "env_keys", description: "List the env var names this server sees.", inputSchema: { type: "object" } },
  { name: "echo", description: "Echo the text back.", inputSchema: { type: "object", properties: { text: { type: "string", maxLength: 100 } }, required: ["text"] } },
  { name: "slow", description: "Never answers in time.", inputSchema: { type: "object" } },
  { name: "crash", description: "Exit the process.", inputSchema: { type: "object" } },
];

const send = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

function handle(msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown }) {
  if (msg.method === undefined) return; // a response to our ping
  if (msg.id === undefined) return; // a notification
  switch (msg.method) {
    case "initialize":
      send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-mcp", version: "1" } } });
      send({ jsonrpc: "2.0", id: 9001, method: "ping" });
      return;
    case "tools/list": {
      const page = msg.params?.cursor === "p2" ? TOOLS.slice(4) : TOOLS.slice(0, 4);
      send({ jsonrpc: "2.0", id: msg.id, result: { tools: page, ...(msg.params?.cursor === "p2" ? {} : { nextCursor: "p2" }) } });
      return;
    }
    case "tools/call": {
      const name = String(msg.params?.name);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (name === "get_price") return send({ jsonrpc: "2.0", id: msg.id, result: text(JSON.stringify({ symbol: args.symbol, price: 101.25 })) });
      if (name === "place_order") return send({ jsonrpc: "2.0", id: msg.id, result: text(JSON.stringify({ status: "filled", avgPrice: 100.5, got: args })) });
      if (name === "delete_note") return send({ jsonrpc: "2.0", id: msg.id, result: text(`deleted ${args.id}`) });
      if (name === "env_keys") return send({ jsonrpc: "2.0", id: msg.id, result: text(Object.keys(process.env).sort().join(",") + `|token=${process.env.FAKE_TOKEN ?? ""}`) });
      if (name === "echo") return send({ jsonrpc: "2.0", id: msg.id, result: text(`echo: ${args.text} ${process.env.FAKE_TOKEN ?? ""}`) });
      if (name === "slow") return;
      if (name === "crash") process.exit(3);
      return send({ jsonrpc: "2.0", id: msg.id, result: text(`no tool ${name}`, true) });
    }
    default:
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `no method ${msg.method}` } });
  }
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
