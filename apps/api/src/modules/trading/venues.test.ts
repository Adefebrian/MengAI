// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Trading venues: a preset becomes a connector (secrets in the vault, mode
// flags on the command), the data engineer's read-only learning pass, the
// crew-wide skills and the memory layer notes, paper orders priced through
// the venue in its own symbol form, live orders through the learned order
// tool (auto trade within the owner's limits, else the owner decides), fills
// and failures on the venue's skills, error lessons, reuse and removal, and
// the routes. A fake exchange MCP server runs over stdio.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LessonDTO, SkillDTO } from "@mengai/shared";
import { Hono } from "hono";
import type { ModuleContext } from "../../core/module";
import { HttpError } from "../../lib/http";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { createConnectorsModule } from "../connectors";
import { createTradingModule, type TradingVenue, type VenueMemory } from "./index";
import { classifyVenueTools, errorMeaning, fillArgs, learnVenue, symbolForm, symbolsIn, venueNote, type VenueProfile } from "./learn";
import type { VenueTool } from "./ports";
import { toVenueSymbol } from "./symbols";
import { createTradingRepo } from "./repo";
import { checkSecrets, composeTarget, createDesk, modeEnv, presetOf, venueSlug } from "./venues";

const FIXTURE = join(import.meta.dir, "fixtures", "fake-exchange.ts");
const STDIO = `${process.execPath} ${FIXTURE}`;
const KEY = "key_fake_0123456789abcdef";
const SECRET = "sec_fake_0123456789abcdef";
const SECRETS = { CCXT_MCP_EXCHANGE: "binance", CCXT_MCP_APIKEY: KEY, CCXT_MCP_SECRET: SECRET };

const temps: string[] = [];
const closers: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const c of closers) await c();
  for (const d of temps) await rm(d, { recursive: true, force: true });
});

function fakeMemory() {
  const skills = new Map<string, SkillDTO>();
  const outcomes: Array<{ name: string; win: boolean }> = [];
  const lessons: string[] = [];
  let n = 0;
  const mem: VenueMemory = {
    async saveSkill(i) {
      const prev = skills.get(i.name);
      const s: SkillDTO = { id: prev?.id ?? `sk-${++n}`, name: i.name, description: i.description, role: i.role, steps: i.steps, uses: prev?.uses ?? 0, wins: prev?.wins ?? 0, createdAt: 1 };
      skills.set(i.name, s);
      return s;
    },
    async sharedSkills(prefix) {
      return [...skills.values()].filter((s) => s.role === null && s.name.startsWith(prefix));
    },
    async skillOutcome(name, win) {
      outcomes.push({ name, win });
      const s = skills.get(name);
      if (!s) return false;
      s.uses++;
      if (win) s.wins++;
      return true;
    },
    async deleteSharedSkills(prefix) {
      let k = 0;
      for (const name of [...skills.keys()]) if (name.startsWith(prefix) && skills.delete(name)) k++;
      return k;
    },
    async record(i) {
      lessons.push(i.text);
      return { id: `l${lessons.length}`, scope: "global", role: null, projectId: null, text: i.text, tags: i.tags ?? [], status: "candidate", uses: 0, wins: 0, losses: 0, score: 0.5, createdAt: 1, lastUsedAt: null } satisfies LessonDTO;
    },
  };
  return { mem, skills, outcomes, lessons };
}

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), "mengai-venues-"));
  temps.push(dataDir);
  const ctx: ModuleContext = {
    config: { mode: "local", version: "0.0.0-test", dataDir, workspacesDir: dataDir, webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null },
    db: await createTestDb(),
    kv: memoryKv(),
    blob: {} as ModuleContext["blob"],
    vault: memoryVault(),
    clock: fakeClock(Date.UTC(2026, 8, 30, 10)),
    logger: silentLogger,
    events: captureEvents(),
  };
  const connectors = createConnectorsModule(ctx).service;
  closers.push(() => connectors.close());
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  // the connectors service, with every call recorded
  const venue: TradingVenue = {
    tools: (s) => connectors.tools(s),
    call: (name, args, o) => {
      calls.push({ name, args });
      return connectors.call(name, args, o);
    },
    list: () => connectors.list(),
    create: (b) => connectors.create(b),
    update: (id, b) => connectors.update(id, b),
    remove: (id) => connectors.remove(id),
    test: (id) => connectors.test(id),
  };
  const mod = createTradingModule(ctx, { venue });
  closers.push(() => mod.close!());
  const memory = fakeMemory();
  mod.service.useMemory(memory.mem);
  return { ctx, connectors, trading: mod.service, mod, memory, calls };
}

async function rejects(p: Promise<unknown>): Promise<HttpError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(HttpError);
  return e as HttpError;
}

const K = "binance-testnet";

describe("venue setup", () => {
  test("a ccxt testnet venue: secrets to the vault, the sandbox flag on the command, then the learning pass writes crew-wide skills", async () => {
    const { trading, connectors, memory, calls, ctx } = await setup();
    const v = await trading.createVenue({ preset: "ccxt-mcp", label: "Binance testnet", target: STDIO, secrets: SECRETS, mode: "paper", testnet: true });
    expect(v).toMatchObject({ preset: "ccxt-mcp", label: "Binance testnet", mode: "paper", testnet: true, status: "learning", error: null });
    expect(JSON.stringify(v)).not.toContain(KEY);
    const conn = (await connectors.list()).find((c) => c.id === v.connectorId)!;
    expect(conn).toMatchObject({ kind: "mcp_stdio", label: K, status: "connected", hasSecret: true, roles: null });
    expect(conn.target).toBe(`env CCXT_MCP_SANDBOX=true ${STDIO}`);
    expect(JSON.stringify(conn)).not.toContain(KEY);
    expect(await ctx.vault.get(`connector:${conn.id}`)).toBe(JSON.stringify(SECRETS));

    await trading.idle();
    const [ready] = await trading.venues();
    expect(ready).toMatchObject({ status: "ready", error: null });
    expect(ready!.learnedSkills.map((s) => s.name)).toEqual([`venue ${K}: prices`, `venue ${K}: orders`, `venue ${K}: account`, `venue ${K}: limits`]);
    // read-only calls only: markets, one ticker, the balances, the limits; the order tool is read from its schema
    expect(calls.map((c) => c.name)).toEqual([`${K}.search_markets`, `${K}.get_ticker`, `${K}.get_balance`, `${K}.get_safety_status`]);
    expect(calls[1]!.args).toEqual({ exchange: "binance", symbol: "BTC/USDT" });

    const prices = memory.skills.get(`venue ${K}: prices`)!;
    expect(prices.role).toBeNull();
    expect(prices.description).toBe(
      `Binance testnet prices: get_quote reads ${K}.get_ticker (symbol like BTC/USDT, with exchange binance). The venue writes symbols with a slash (BTC/USDT); give get_quote and propose_order BTC-USDT and the desk converts.`,
    );
    expect(prices.steps[0]).toMatchObject({ tool: `${K}.get_ticker`, args: { symbol: "BTC/USDT", exchange: "binance" } });
    expect(memory.skills.get(`venue ${K}: orders`)!.description).toContain(`never call ${K}.create_order yourself; propose_order sends it. It takes symbol like BTC/USDT, amount in base units (BTC, not USD), side buy or sell, type market or limit, price for a limit`);
    expect(memory.skills.get(`venue ${K}: account`)!.description).toBe(`Binance testnet account: ${K}.get_balance reads the balances.`);
    expect(memory.skills.get(`venue ${K}: limits`)!.description).toContain("the venue says: rate limit: 20 requests per second");
    expect(memory.skills.get(`venue ${K}: limits`)!.description).toContain("Testnet: the balances are not real money.");

    // every role may use the connector: every cat gets one note, byte-stable per version
    const notes = await trading.venueNotes("engineer");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.version).toBe(1);
    expect(notes[0]!.text.startsWith(`Crew skill v1 for the Binance testnet venue (paper, testnet), learned by the data engineer: Prices: get_quote reads ${K}.get_ticker`)).toBe(true);
    expect(notes[0]!.text).toContain("Orders: never call");
    expect((await trading.venueNotes("reviewer"))[0]!.text).toBe(notes[0]!.text);
    // a connector limited to other roles keeps the note from this one
    await connectors.update(conn.id, { roles: ["reviewer"] });
    await new Promise((r) => setTimeout(r, 0));
    const again = await trading.learnVenue(v.id);
    expect(again).toMatchObject({ status: "ready" });
    expect(await trading.venueNotes("designer")).toEqual([]);
    expect((await trading.venueNotes("reviewer"))[0]!.version).toBe(2);
  }, 20_000);

  test("presets are checked before anything connects", async () => {
    const { trading } = await setup();
    expect((await rejects(trading.createVenue({ preset: "nope", mode: "paper" }))).code).toBe("unknown_preset");
    expect((await rejects(trading.createVenue({ preset: "alpaca-mcp", mode: "live", testnet: true }))).message).toContain("has no testnet");
    expect((await rejects(trading.createVenue({ preset: "ccxt-mcp", mode: "paper", secrets: { API_KEY: "x" } }))).code).toBe("invalid_secret");
    expect((await rejects(trading.createVenue({ preset: "custom-mcp", mode: "paper" }))).message).toContain("give the command");
    expect((await rejects(trading.createVenue({ preset: "custom-http", mode: "paper" }))).message).toContain("base URL");
    expect((await rejects(trading.createVenue({ preset: "custom-mcp", target: STDIO, mode: "paper", secrets: { "bad name": "x" } }))).code).toBe("invalid_secret");
    expect((await rejects(trading.createVenue({ preset: "custom-mcp", target: STDIO, mode: "paper", secrets: { API_KEY: "two\nlines" } }))).code).toBe("invalid_secret");
    expect(await trading.venues()).toEqual([]);
  });

  test("a connector with the same command is reused and kept on removal; a venue's own connector and skills go with it", async () => {
    const { trading, connectors, memory } = await setup();
    const own = await connectors.create({ kind: "mcp_stdio", label: "desk", target: STDIO, secret: JSON.stringify(SECRETS) });
    const v = await trading.createVenue({ preset: "custom-mcp", target: STDIO, mode: "paper" });
    expect(v.connectorId).toBe(own.id);
    await trading.idle();
    // the venue does not know the exchange id the tools require: no price read, so not ready
    expect((await trading.venues())[0]).toMatchObject({ status: "error", error: "no read-only price tool answered; the crew can still reach the venue's tools with find_tools" });
    expect(await trading.venueNotes("engineer")).toEqual([]);
    // the owner gives the setup: the connector reconnects and the crew learns again
    expect(await trading.updateVenue(v.id, { secrets: SECRETS })).toMatchObject({ status: "learning" });
    await trading.idle();
    expect((await trading.venues())[0]).toMatchObject({ status: "ready", error: null });
    expect(memory.skills.has("venue desk: prices")).toBe(true);
    expect((await rejects(trading.createVenue({ preset: "custom-mcp", target: STDIO, mode: "paper" }))).status).toBe(409);
    await trading.removeVenue(v.id);
    expect((await connectors.list()).map((c) => c.id)).toEqual([own.id]);
    expect([...memory.skills.keys()].some((k) => k.startsWith("venue desk: "))).toBe(false);

    const mine = await trading.createVenue({ preset: "custom-mcp", label: "Second desk", target: `${STDIO} --second`, secrets: SECRETS, mode: "paper" });
    await trading.idle();
    const c2 = (await connectors.list()).find((c) => c.id === mine.connectorId)!;
    expect(c2.label).toBe("second-desk");
    await trading.removeVenue(mine.id);
    expect((await connectors.list()).some((c) => c.id === mine.connectorId)).toBe(false);
    expect((await rejects(trading.removeVenue(mine.id))).status).toBe(404);
  }, 20_000);
});

describe("trading through a learned venue", () => {
  test("paper: the venue prices orders in its own symbol form; fills are wins on its skills", async () => {
    const { trading, memory, calls } = await setup();
    await trading.createVenue({ preset: "ccxt-mcp", label: "Binance testnet", target: STDIO, secrets: SECRETS, mode: "paper", testnet: true });
    await trading.idle();
    calls.length = 0;
    expect(await trading.quote("btc-usdt")).toEqual({ symbol: "BTC-USDT", price: 50000.5, source: `${K}.get_ticker` });
    expect(calls).toEqual([{ name: `${K}.get_ticker`, args: { exchange: "binance", symbol: "BTC/USDT" } }]);
    const o = await trading.propose({ runId: "run-1", agentId: "trader", symbol: "BTC-USDT", side: "buy", qty: 0.01, type: "market", reason: "breakout" });
    expect(o).toMatchObject({ mode: "paper", venue: null, status: "proposed" });
    const f = await trading.review({ runId: "run-1", agentId: "risk", verdict: "approve", note: "inside the size limit" });
    expect(f).toMatchObject({ status: "filled", fillPrice: 50000.5 });
    expect(memory.outcomes).toEqual([
      { name: `venue ${K}: prices`, win: true },
      { name: `venue ${K}: orders`, win: true },
    ]);
    expect((await trading.venues())[0]!.learnedSkills.find((s) => s.name === `venue ${K}: orders`)).toMatchObject({ uses: 1, wins: 1 });
    // an unknown symbol is a crew lesson, once
    await trading.quote("DOGE-USDT", { runId: "run-1" }).catch(() => undefined);
    await trading.quote("DOGE-USDT", { runId: "run-1" }).catch(() => undefined);
    expect(memory.lessons).toEqual([`${K}.get_ticker failed with "bad symbol DOGE/USDT: markets look like BTC/USDT": unknown symbol: use the venue's symbol form.`]);
  }, 20_000);

  test("live: the learned order tool with the venue's arguments; auto trade within the limits executes, else the owner decides; a venue refusal is a loss and a lesson", async () => {
    const { trading, connectors, memory, calls } = await setup();
    const v = await trading.createVenue({ preset: "ccxt-mcp", label: "Binance testnet", target: STDIO, secrets: SECRETS, mode: "paper", testnet: true });
    await trading.idle();
    const live = await trading.updateVenue(v.id, { mode: "live" });
    expect(live).toMatchObject({ mode: "live", status: "learning" });
    await trading.idle();
    expect((await connectors.list())[0]!.target).toBe(`env CCXT_MCP_SANDBOX=true CCXT_MCP_TRADING=sandbox ${STDIO}`);
    expect((await trading.venues())[0]).toMatchObject({ mode: "live", status: "ready" });
    expect(memory.skills.get(`venue ${K}: orders`)!.description).toContain("Live mode: after the risk review the owner's auto trade limits decide, else the owner does.");

    // paper settings: an order without a live flag stays paper even with a live venue
    const paper = await trading.propose({ runId: "run-1", agentId: "trader", symbol: "BTC-USDT", side: "buy", qty: 0.01, type: "market", quote: 50000, reason: "breakout" });
    expect(paper.mode).toBe("paper");

    await trading.saveSettings({ mode: "live", autoTrade: false, maxOrderUsd: 1000, dailyLossLimitUsd: 100, allowedSymbols: ["BTC-USDT"] });
    calls.length = 0;
    const p1 = await trading.propose({ runId: "run-2", agentId: "trader", symbol: "BTC-USDT", side: "buy", qty: 0.01, type: "market", reason: "breakout" });
    expect(p1).toMatchObject({ mode: "live", venue: v.connectorId, status: "proposed" });
    expect((await trading.review({ runId: "run-2", agentId: "risk", verdict: "approve", note: "inside the limits" })).status).toBe("proposed");
    expect(await trading.decide(p1.id, "approve")).toMatchObject({ status: "filled", fillPrice: 50010 });
    expect(calls.find((c) => c.name === `${K}.create_order`)!.args).toEqual({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, type: "market", clientOrderId: p1.id });

    await trading.saveSettings({ mode: "live", autoTrade: true, maxOrderUsd: 200_000, dailyLossLimitUsd: 100, allowedSymbols: ["BTC-USDT"] });
    await trading.propose({ runId: "run-3", agentId: "trader", symbol: "BTC-USDT", side: "sell", qty: 0.01, type: "market", reason: "take profit" });
    expect(await trading.review({ runId: "run-3", agentId: "risk", verdict: "approve", note: "reduces risk" })).toMatchObject({ status: "filled", fillPrice: 50010 });

    // the venue refuses a size it cannot fill: the order fails, the order skill records a loss, the crew gets a lesson
    await trading.propose({ runId: "run-4", agentId: "trader", symbol: "BTC-USDT", side: "buy", qty: 2, type: "market", reason: "size up" });
    expect(await trading.review({ runId: "run-4", agentId: "risk", verdict: "approve", note: "within the cap" })).toMatchObject({ status: "failed" });
    expect(memory.outcomes.at(-1)).toEqual({ name: `venue ${K}: orders`, win: false });
    expect(memory.lessons.at(-1)).toBe(`${K}.create_order failed with "insufficient balance for 2 BTC": not enough balance for the order size.`);
    // outside the allowed symbols the gate holds it for the owner
    await trading.propose({ runId: "run-5", agentId: "trader", symbol: "ETH-USDT", side: "buy", qty: 0.01, type: "market", reason: "rotation" });
    const held = await trading.review({ runId: "run-5", agentId: "risk", verdict: "approve", note: "small" });
    expect(held.status).toBe("proposed");
  }, 30_000);

  test("routes: list, create, patch, learn and delete venues, zod first, never a secret back", async () => {
    const { mod, trading } = await setup();
    const app = new Hono();
    app.onError((e, c) => (e instanceof HttpError ? c.json({ error: { code: e.code, message: e.message } }, e.status) : c.json({ error: { code: "internal", message: String(e) } }, 500)));
    app.route("/api/trading", mod.routes!);
    const req = (method: string, path: string, body?: unknown) =>
      app.request(`/api/trading${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    expect(await (await req("GET", "/venues")).json()).toEqual([]);
    expect((await req("POST", "/venues", { preset: "ccxt-mcp", mode: "paper", extra: 1 })).status).toBe(422);
    expect((await req("POST", "/venues", { preset: "ccxt-mcp", mode: "maybe" })).status).toBe(422);
    const created = await req("POST", "/venues", { preset: "ccxt-mcp", label: "Binance testnet", target: STDIO, secrets: SECRETS, mode: "paper", testnet: true });
    expect(created.status).toBe(201);
    const text = await created.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(SECRET);
    const v = JSON.parse(text) as { id: string };
    await trading.idle();
    expect((await req("PATCH", `/venues/${v.id}`, {})).status).toBe(422);
    expect(await (await req("PATCH", `/venues/${v.id}`, { label: "Binance sandbox" })).json()).toMatchObject({ label: "Binance sandbox", status: "ready" });
    expect(await (await req("POST", `/venues/${v.id}/learn`)).json()).toMatchObject({ status: "ready" });
    expect((await req("POST", "/venues/bad%20id/learn")).status).toBe(404);
    expect((await req("DELETE", "/venues/missing")).status).toBe(404);
    expect(await (await req("DELETE", `/venues/${v.id}`)).json()).toEqual({ ok: true });
    expect(await (await req("GET", "/venues")).json()).toEqual([]);
  }, 20_000);
});

describe("simulated venues", () => {
  test("an in-process venue is learned like a connector; a slow pass answers learning and ends ready; mode changes relearn; removal drops its skills", async () => {
    const { ctx } = await setup();
    const memory = fakeMemory();
    const desk = createDesk({ ctx, repo: createTradingRepo(ctx.db), venue: null, settings: async () => ({ mode: "paper", autoTrade: false, maxOrderUsd: 0, dailyLossLimitUsd: 0, allowedSymbols: [] }), log: silentLogger });
    desk.useMemory(memory.mem);
    let gate: Promise<void> = Promise.resolve();
    const sim = {
      label: "sim",
      title: "Sim Exchange",
      tools: [
        { local: "get_ticker", description: "price", risk: "read" as const, money: false, schema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } },
        { local: "create_order", description: "order", risk: "sensitive" as const, money: true, schema: { type: "object", properties: { symbol: {}, side: {}, qty: {}, type: {} } } },
      ],
      async call(local: string, args: Record<string, unknown>) {
        await gate;
        return local === "get_ticker" && args.symbol === "BTC/USDT" ? { ok: true, output: '{"last": 42}' } : { ok: false, output: "unknown market" };
      },
    };
    const ready = await desk.connectSimulator(sim);
    expect(ready).toMatchObject({ id: "sim-sim", connectorId: "sim:sim", preset: "simulator", label: "Sim Exchange", status: "ready" });
    expect(await desk.price("BTC-USDT")).toEqual({ price: 42, source: "sim.get_ticker", venueId: "sim-sim" });
    let open!: () => void;
    gate = new Promise<void>((r) => (open = r));
    expect(await desk.learn("sim-sim", 10)).toMatchObject({ status: "learning" });
    open();
    await desk.idle();
    expect((await desk.list())[0]).toMatchObject({ status: "ready" });
    expect((await desk.notes("engineer"))[0]!.version).toBe(2);
    expect(await desk.update("sim-sim", { mode: "live" })).toMatchObject({ mode: "live", status: "learning" });
    await desk.idle();
    expect((await desk.notes("engineer"))[0]!.text).toContain("(live)");
    await desk.remove("sim-sim");
    expect(await desk.list()).toEqual([]);
    expect(memory.skills.size).toBe(0);
    expect(await desk.price("BTC-USDT")).toBeNull();
  });
});

describe("the learning pass, pure", () => {
  const tool = (name: string, over: Partial<VenueTool> = {}): VenueTool => ({ name, connectorId: "c", alias: name.replace(".", "__"), description: name, risk: "read", money: false, schema: { type: "object", properties: {} }, ...over });

  test("tool roles, arguments, symbols and error meanings", () => {
    const tools = [
      tool("x.get_ticker", { schema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } }),
      tool("x.get_tickers"),
      tool("x.get_ohlcv"),
      tool("x.list_markets"),
      tool("x.get_balance"),
      tool("x.create_order", { risk: "sensitive", money: true }),
      tool("x.cancel_order", { risk: "sensitive", money: true }),
    ];
    const r = classifyVenueTools(tools);
    expect(r.price.map((t) => t.name)).toEqual(["x.get_ticker", "x.get_tickers"]);
    expect(r.markets.map((t) => t.name)).toEqual(["x.list_markets"]);
    expect(r.account.map((t) => t.name)).toEqual(["x.get_balance"]);
    expect(r.order.map((t) => t.name)).toEqual(["x.create_order"]);
    expect(fillArgs(tools[0]!, { exchange: null })).toBeNull();
    expect(fillArgs(tool("x.t", { schema: { type: "object", properties: { symbols: { type: "array" }, exchange: { type: "string" }, limit: { type: "integer" } }, required: ["exchange"] } }), { symbol: "BTC/USDT", exchange: "okx" })).toEqual({
      args: { symbols: ["BTC/USDT"], exchange: "okx", limit: 5 },
      fixed: { exchange: "okx" },
      symbolArg: "symbols",
      list: true,
    });
    expect(symbolsIn(JSON.stringify({ markets: [{ symbol: "ETH/USDT" }, { symbol: "BTC/USDT:USDT" }] }))).toEqual(["ETH/USDT", "BTC/USDT"]);
    expect(symbolsIn("pairs: BTCUSD-PERP, ETH_USDC, SOL_USDC")).toEqual(["BTCUSD-PERP", "ETH_USDC", "SOL_USDC"]);
    expect(symbolForm(["ETH/USDT", "BTC/USDT", "BTC/EUR"])).toEqual({ sep: "/", example: "BTC/USDT", examples: ["BTC/USDT", "ETH/USDT", "BTC/EUR"] });
    expect(symbolForm(["ETHUSDT", "BTCUSDT"])!.example).toBe("BTCUSDT");
    expect(toVenueSymbol("BTC-USDT", "/")).toBe("BTC/USDT");
    expect(toVenueSymbol("BTC/USDT", "")).toBe("BTCUSDT");
    expect(toVenueSymbol("AAPL", "/")).toBe("AAPL");
    expect(errorMeaning("HTTP 429 Too Many Requests")).toContain("rate limited");
    expect(errorMeaning("401 Unauthorized")).toContain("not authorized");
    expect(errorMeaning("MIN_NOTIONAL filter failure")).toContain("minimum");
    expect(errorMeaning("bad symbol XYZ")).toContain("unknown symbol");
  });

  test("without a markets tool it probes the symbol forms and learns from the misses", async () => {
    const tools = [tool("y.get_price", { schema: { type: "object", properties: { pair: { type: "string" } }, required: ["pair"] } }), tool("y.place_order", { risk: "sensitive", money: true, schema: { type: "object", properties: { pair: {}, side: {}, notional: { description: "order size in USD" }, type: {} }, required: ["pair", "side", "notional", "account_id"] } })];
    const seen: string[] = [];
    const { profile, skills } = await learnVenue({
      title: "Kraken",
      mode: "paper",
      testnet: false,
      tools,
      exchange: null,
      now: () => 0,
      async call(name, args) {
        seen.push(`${name} ${JSON.stringify(args)}`);
        const pair = String(args.pair);
        return pair === "BTC-USD" ? { ok: true, output: '{"result":{"c":["61000.1"]}}' } : { ok: false, output: `EQuery:Unknown asset pair ${pair}` };
      },
    });
    expect(seen).toEqual(['y.get_price {"pair":"BTC/USDT"}', 'y.get_price {"pair":"BTC/USD"}', 'y.get_price {"pair":"BTC-USD"}']);
    expect(profile.price).toEqual({ tool: "y.get_price", arg: "pair", list: false });
    expect(profile.symbols).toEqual({ sep: "-", example: "BTC-USD", examples: ["BTC-USD"] });
    expect(profile.errors).toEqual([{ tool: "y.get_price", meaning: "unknown symbol: use the venue's symbol form" }]);
    expect(profile.order).toMatchObject({ tool: "y.place_order", qtyUnit: "quote", params: { symbol: "pair", qty: "notional" }, unmapped: [] });
    expect(profile.fixedArgs).toEqual({ account_id: "default" });
    const orders = skills.find((s) => s.topic === "orders")!;
    expect(orders.description).toContain("notional in the quote currency");
    const note = venueNote("Kraken", "paper", false, 3, skills.map((s) => ({ name: `venue kraken: ${s.topic}`, description: s.description })), "kraken");
    expect(note.startsWith("Crew skill v3 for the Kraken venue (paper), learned by the data engineer: Prices: get_quote reads y.get_price")).toBe(true);
    expect(note).toContain("Errors while learning: y.get_price: unknown symbol");
  });

  test("setup helpers: mode flags, the command, slugs, secrets", () => {
    const s = { maxOrderUsd: 250 };
    expect(modeEnv("ccxt-mcp", "paper", false, s)).toEqual({});
    expect(modeEnv("ccxt-mcp", "paper", true, s)).toEqual({ CCXT_MCP_SANDBOX: "true" });
    expect(modeEnv("ccxt-mcp", "live", true, s)).toEqual({ CCXT_MCP_SANDBOX: "true", CCXT_MCP_TRADING: "sandbox" });
    expect(modeEnv("ccxt-mcp", "live", false, s)).toEqual({ CCXT_MCP_TRADING: "live", CCXT_MCP_MAX_ORDER_VALUE: "250" });
    expect(modeEnv("alpaca-mcp", "paper", false, s)).toEqual({ ALPACA_PAPER_TRADE: "true" });
    expect(modeEnv("alpaca-mcp", "live", false, s)).toEqual({ ALPACA_PAPER_TRADE: "false" });
    expect(composeTarget("npx -y ccxt-mcp", { CCXT_MCP_SANDBOX: "true" })).toBe("env CCXT_MCP_SANDBOX=true npx -y ccxt-mcp");
    expect(composeTarget("uvx alpaca-mcp-server", {})).toBe("uvx alpaca-mcp-server");
    expect(venueSlug("Binance Testnet!")).toBe("binance-testnet");
    expect(venueSlug("!!!")).toBe("venue");
    expect(checkSecrets(presetOf("ccxt-mcp"), { CCXT_MCP_EXCHANGE: "Binance", CCXT_MCP_APIKEY: " k ", CCXT_MCP_SECRET: "" })).toEqual({
      secret: JSON.stringify({ CCXT_MCP_EXCHANGE: "Binance", CCXT_MCP_APIKEY: "k" }),
      authHeader: null,
      settings: { exchange: "binance" },
    });
    expect(checkSecrets(presetOf("custom-http"), { "X-API-KEY": "abc" })).toEqual({ secret: "abc", authHeader: "X-API-KEY", settings: {} });
    const p: VenueProfile["price"] = null;
    expect(p).toBeNull();
  });
});
