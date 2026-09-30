// The capability tools: find_tools and lazy loading of connector tools per
// task, role scoping, the approval path for destructive and sensitive tools,
// the refusal of direct order placement, trading grants, and the audit in
// tool_calls plus the timeline events. Fake connectors and trading bridges.
import { beforeEach, describe, expect, test } from "bun:test";
import type { AgentRole, OrderDTO } from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import type { ToolContext } from "../../core/services";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { FIND_TOOLS, searchTools } from "./capabilities";
import { createToolsModule, type ToolsServiceImpl } from "./index";
import type { BridgeTool, CapabilityContext, ConnectorsBridge, TradingBridge } from "./ports";

const TOOLS: BridgeTool[] = [
  { name: "exch.get_price", alias: "exch__get_price", description: "Get the last price of a symbol.", risk: "read", money: false, connectorLabel: "exch", schema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } },
  { name: "exch.place_order", alias: "exch__place_order", description: "Place an order.", risk: "sensitive", money: true, connectorLabel: "exch", schema: { type: "object", properties: { symbol: { type: "string" } } } },
  { name: "notes.delete_note", alias: "notes__delete_note", description: "Delete a note.", risk: "destructive", money: false, connectorLabel: "notes", schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "notes.update_note", alias: "notes__update_note", description: "Update a note.", risk: "write", money: false, connectorLabel: "notes", schema: { type: "object", properties: {} } },
];

function fakeConnectors(): ConnectorsBridge & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    // designers see no connector tools (connector roles scoping)
    tools: async ({ role }) => (role === "designer" ? [] : TOOLS),
    async call(name, args) {
      calls.push({ name, args });
      return { ok: true, output: `${name} ran with ${JSON.stringify(args)}` };
    },
  };
}

const order = (over: Partial<OrderDTO> = {}): OrderDTO => ({
  id: "ord-1",
  runId: "run-1",
  agentId: "agent-1",
  symbol: "BTC-USD",
  side: "buy",
  qty: 0.1,
  type: "market",
  limitPrice: null,
  mode: "paper",
  status: "proposed",
  venue: null,
  reason: "breakout",
  riskNote: null,
  fillPrice: null,
  createdAt: 1,
  decidedAt: null,
  filledAt: null,
  ...over,
});

function fakeTrading(): TradingBridge & { proposed: unknown[] } {
  const proposed: unknown[] = [];
  return {
    proposed,
    quote: async (symbol) => ({ symbol, price: 101.5, source: "exch.get_price" }),
    async propose(input) {
      proposed.push(input);
      if (input.qty > 100) throw new Error("qty must be a positive number");
      return order({ symbol: input.symbol, qty: input.qty, mode: input.live ? "live" : "paper" });
    },
    review: async (input) => order({ status: input.verdict === "approve" ? "filled" : "rejected", fillPrice: 101.5, riskNote: input.note }),
    positions: async () => [{ symbol: "BTC-USD", mode: "paper", qty: 0.1, avgPrice: 100, lastPrice: 101.5, unrealizedUsd: 0.15, realizedUsd: 0 }],
    pendingReview: async () => [order({ id: "ord-2" })],
  };
}

let ctx: ModuleContext;
let events: ReturnType<typeof captureEvents>;

beforeEach(async () => {
  events = captureEvents();
  ctx = {
    config: { mode: "local", version: "test", dataDir: "/tmp", workspacesDir: "/tmp", webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null },
    db: await createTestDb(),
    kv: memoryKv(),
    blob: null as never,
    vault: memoryVault(),
    clock: fakeClock(),
    logger: silentLogger,
    events,
  };
});

function build(over: { connectors?: ConnectorsBridge | null; trading?: TradingBridge | null } = {}): ToolsServiceImpl {
  return createToolsModule(ctx, {
    workspace: null as never,
    runner: null,
    memory: null as never,
    assets: null as never,
    security: null as never,
    automation: null,
    settings: null as never,
    projects: null as never,
    ...over,
  }).service;
}

const tc = (role: AgentRole = "engineer", over: Partial<ToolContext & CapabilityContext> = {}): ToolContext & CapabilityContext => ({
  runId: "run-1",
  agentId: "agent-1",
  taskId: "task-1",
  projectId: "p",
  root: "/tmp",
  role,
  ...over,
});
let n = 0;
const call = (name: string, args: unknown) => ({ id: `c${++n}`, name, arguments: typeof args === "string" ? args : JSON.stringify(args) });

describe("lazy connector tools", () => {
  test("nothing extra without connectors or grants: studio prompts stay as they were", async () => {
    const tools = build();
    expect(await tools.taskSpecs({ role: "engineer", runId: "run-1", taskId: "task-1" })).toEqual([]);
    expect((await tools.execute(call(FIND_TOOLS, { query: "price" }), tc())).output).toContain("no connector tools");
    expect((await tools.execute(call("exch__get_price", { symbol: "X" }), tc())).output).toBe("error: unknown tool exch__get_price");
  });

  test("find_tools first; the matches join this task's tool list, schemas only once used", async () => {
    const connectors = fakeConnectors();
    const tools = build({ connectors });
    const specs = async (taskId: string) => (await tools.taskSpecs({ role: "engineer", runId: "run-1", taskId })).map((s) => s.name);
    expect(await specs("task-1")).toEqual([FIND_TOOLS]);
    const found = await tools.execute(call(FIND_TOOLS, { query: "last price of a symbol" }), tc());
    expect(found.ok).toBe(true);
    expect(found.output).toContain("exch__get_price (read): Get the last price of a symbol. Args: symbol*");
    expect(await specs("task-1")).toEqual([FIND_TOOLS, "exch__get_price"]);
    // another task starts clean
    expect(await specs("task-2")).toEqual([FIND_TOOLS]);
    const loaded = (await tools.taskSpecs({ role: "engineer", runId: "run-1", taskId: "task-1" }))[1]!;
    expect(loaded).toEqual({ name: "exch__get_price", description: "Get the last price of a symbol. (exch, read)", parameters: TOOLS[0]!.schema });
    expect(tools.isReadOnly("exch__get_price")).toBe(true);
    expect(tools.isReadOnly(FIND_TOOLS)).toBe(true);
    expect(tools.isReadOnly("notes__update_note")).toBe(false);
    // order placement is listed with its venue note but never loaded
    const orders = await tools.execute(call(FIND_TOOLS, { query: "place order" }), tc());
    expect(orders.output).toContain("exch__place_order (sensitive, places orders)");
    expect(await specs("task-1")).not.toContain("exch__place_order");
  });

  test("a connector call validates its args, runs under the dotted name and is audited", async () => {
    const connectors = fakeConnectors();
    const tools = build({ connectors });
    const r = await tools.execute(call("exch__get_price", { symbol: "BTC-USD", sneaky: "dropped" }), tc());
    expect(r.ok).toBe(true);
    expect(connectors.calls).toEqual([{ name: "exch.get_price", args: { symbol: "BTC-USD" } }]);
    // a direct call loads it for the task too
    expect((await tools.taskSpecs({ role: "engineer", runId: "run-1", taskId: "task-1" })).map((s) => s.name)).toContain("exch__get_price");
    const rows = await ctx.db.query<{ tool: string; ok: unknown }>`select tool, ok from tool_calls where run_id = ${"run-1"}`;
    expect(rows.map((x) => x.tool)).toEqual(["exch__get_price"]);
    expect(events.ofType("tool.call").map((e) => e.data.tool)).toEqual(["exch__get_price"]);
    expect(events.ofType("tool.result")[0]!.data).toMatchObject({ ok: true, summary: "exch.get_price answered" });
    expect((await tools.execute(call("exch__get_price", {}), tc())).output).toBe("error: arguments.symbol is required");
    // a free-form schema passes the arguments through
    await tools.execute(call("notes__update_note", { id: "n1", text: "t" }), tc());
    expect(connectors.calls.at(-1)).toEqual({ name: "notes.update_note", args: { id: "n1", text: "t" } });
  });

  test("roles scope connectors; order placement is never a direct call", async () => {
    const connectors = fakeConnectors();
    const tools = build({ connectors });
    await tools.taskSpecs({ role: "engineer", runId: "run-1", taskId: "task-1" });
    expect((await tools.execute(call("exch__get_price", { symbol: "X" }), tc("designer"))).output).toBe("error: exch.get_price is not available to the designer role");
    const direct = await tools.execute(call("exch.place_order", { symbol: "X" }), tc("engineer", { approve: async () => ({ approved: true, answer: "yes" }) }));
    expect(direct.ok).toBe(false);
    expect(direct.output).toContain("use propose_order");
    expect(connectors.calls).toEqual([]);
  });

  test("destructive and sensitive tools go through the approval path", async () => {
    const connectors = fakeConnectors();
    const tools = build({ connectors });
    expect((await tools.execute(call("notes__delete_note", { id: "n1" }), tc())).output).toContain("needs an approval");
    const asked: unknown[] = [];
    const no = await tools.execute(call("notes__delete_note", { id: "n1" }), tc("engineer", { approve: async (req) => (asked.push(req), { approved: false, answer: "Oyen (the CEO): keep the notes" }) }));
    expect(no.output).toBe("error: not approved: Oyen (the CEO): keep the notes");
    expect(asked[0]).toMatchObject({ tool: "notes.delete_note", risk: "destructive" });
    expect(String((asked[0] as { summary: string }).summary)).toContain('"id":"n1"');
    expect(connectors.calls).toEqual([]);
    const yes = await tools.execute(call("notes__delete_note", { id: "n1" }), tc("engineer", { approve: async () => ({ approved: true, answer: "ok" }) }));
    expect(yes.ok).toBe(true);
    expect(connectors.calls).toEqual([{ name: "notes.delete_note", args: { id: "n1" } }]);
  });

  test("search ranks name words over description words", () => {
    expect(searchTools(TOOLS, "delete", 5).map((t) => t.name)).toEqual(["notes.delete_note"]);
    expect(searchTools(TOOLS, "note", 5).map((t) => t.name)).toEqual(["notes.delete_note", "notes.update_note"]);
    expect(searchTools(TOOLS, "zebra", 5)).toEqual([]);
  });
});

describe("trading tools", () => {
  test("only granted cats get them, in a stable order", async () => {
    const tools = build({ trading: fakeTrading() });
    expect((await tools.taskSpecs({ role: "engineer", runId: "run-1", taskId: "t", grants: ["positions", "propose_order", "get_quote"] })).map((s) => s.name)).toEqual(["get_quote", "propose_order", "positions"]);
    expect((await tools.execute(call("propose_order", { symbol: "BTC-USD", side: "buy", qty: 1, reason: "x" }), tc())).output).toBe("error: propose_order is not granted to your role in this company");
    const none = build();
    expect((await none.execute(call("get_quote", { symbol: "X" }), tc("engineer", { grants: ["get_quote"] }))).output).toBe("error: trading is not available in this build");
  });

  test("propose, review, quote and positions answer in facts; trading errors come back as tool errors", async () => {
    const trading = fakeTrading();
    const tools = build({ trading });
    const g = { grants: ["get_quote", "propose_order", "review_order", "positions"] };
    expect((await tools.execute(call("get_quote", { symbol: "BTC-USD" }), tc("engineer", g))).output).toBe("BTC-USD last price 101.50 (source: exch.get_price)");
    const p = await tools.execute(call("propose_order", { symbol: "BTC-USD", side: "buy", qty: 0.1, quote: 101.5, reason: "breakout" }), tc("engineer", g));
    expect(p.output).toBe("order ord-1 proposed: paper buy 0.1 BTC-USD market. It waits for the risk manager's review_order.");
    expect(trading.proposed[0]).toMatchObject({ runId: "run-1", agentId: "agent-1", type: "market", quote: 101.5 });
    // no live flag: the desk decides (paper unless the owner set live mode and a live venue is ready)
    expect((trading.proposed[0] as { live?: boolean }).live).toBeUndefined();
    const live = await tools.execute(call("propose_order", { symbol: "BTC-USD", side: "buy", qty: 0.1, limit_price: 99, live: true, reason: "add" }), tc("engineer", g));
    expect(live.output).toContain("then the owner's trading gate");
    expect(trading.proposed[1]).toMatchObject({ type: "limit", limitPrice: 99, live: true });
    expect((await tools.execute(call("review_order", { verdict: "approve", note: "fits" }), tc("reviewer", g))).output).toBe("order ord-1 (paper buy 0.1 BTC-USD): filled at 101.50");
    const pos = await tools.execute(call("positions", {}), tc("lead", g));
    expect(pos.output).toContain("paper BTC-USD: qty 0.1 avg 100.00 last 101.50 unrealized +$0.15 realized +$0.00");
    expect(pos.output).toContain("- ord-2: paper buy 0.1 BTC-USD market (breakout)");
    const bad = await tools.execute(call("propose_order", { symbol: "BTC-USD", side: "buy", qty: 1000, reason: "big" }), tc("engineer", g));
    expect(bad).toMatchObject({ ok: false, output: "error: qty must be a positive number" });
    expect((await tools.execute(call("propose_order", { symbol: "BTC-USD", side: "hold", qty: 1, reason: "x" }), tc("engineer", g))).output).toContain("must be one of buy, sell");
    expect(tools.isReadOnly("positions")).toBe(true);
    expect(tools.isReadOnly("propose_order")).toBe(false);
  });
});

describe("the trading venue bridge", () => {
  test("binds the crew memory into the desk, passes venue notes and simulators through, and turns a failing connector call into one crew lesson", async () => {
    const recorded: unknown[] = [];
    const memory = {
      async record(i: unknown) {
        recorded.push(i);
        return {} as never;
      },
      sharedSkills: async () => [],
      skillOutcome: async () => true,
      deleteSharedSkills: async () => 0,
    };
    let bound: unknown = null;
    const trading: TradingBridge = {
      ...fakeTrading(),
      useMemory: (m) => void (bound = m),
      venueNotes: async (role) => [{ venueId: "v1", version: 2, text: `note for ${role}` }],
      connectSimulator: async (sim) => ({ label: sim.label }),
    };
    let n429 = 0;
    const failing: ConnectorsBridge = { tools: async () => TOOLS, call: async () => ({ ok: false, output: `error: HTTP 429 Too Many Requests (retry after ${10 + ++n429} s)` }) };
    const tools = createToolsModule(ctx, {
      workspace: null as never,
      runner: null,
      memory: memory as never,
      assets: null as never,
      security: null as never,
      automation: null,
      settings: null as never,
      projects: null as never,
      connectors: failing,
      trading,
    }).service;
    expect(bound).toBe(memory);
    expect(await tools.venueNotes("engineer")).toEqual([{ venueId: "v1", version: 2, text: "note for engineer" }]);
    const sim = { label: "paw", title: "Paw", tools: [], call: async () => ({ ok: true, output: "" }) };
    expect(await tools.connectSimulator(sim)).toEqual({ label: "paw" });

    expect((await tools.execute(call("exch__get_price", { symbol: "BTC" }), tc())).ok).toBe(false);
    // the same error shape again (only the numbers differ) is not a second lesson
    await tools.execute(call("exch__get_price", { symbol: "ETH" }), tc());
    expect(recorded).toEqual([
      { text: 'exch__get_price failed with "HTTP 429 Too Many Requests (retry after 11 s)": rate limited: wait and call less often.', tags: ["exch", "tool-error"], role: null, projectId: null, runId: "run-1", scope: "global" },
    ]);

    // without the trading desk nothing is passed through
    const plain = build();
    expect(await plain.venueNotes("engineer")).toEqual([]);
    expect(await plain.connectSimulator(sim)).toBeNull();
  });
});
