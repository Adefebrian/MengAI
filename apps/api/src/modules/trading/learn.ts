// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The learning pass: what the data engineer cat does with a venue that just
// connected, read-only. It reads the tool list, asks for the markets, reads
// one ticker (trying the symbol forms a venue may use), reads the balances,
// and reads the order tool's schema without calling it. What it finds becomes
// a profile the desk executes with and a few crew-wide skills every cat gets
// in its memory layer: which tool gives a price, the symbol format, the
// order parameters and their units, rate limits and what the errors meant.
// Order placement and fund movement are never called here. Pure over the
// injected call function.
import type { SkillDTO } from "@mengai/shared";
import { clip, redact } from "../../lib/redact";
import type { VenueTool } from "./ports";
import { argKey, CLIENT_ID_ARGS, parsePrice, PRICE_ARGS, QTY_ARGS, SYMBOL_ARGS, TYPE_ARGS } from "./symbols";

export interface VenueProfile {
  v: 1;
  /** arguments every call of this venue carries (the exchange id, the account name) */
  fixedArgs: Record<string, string>;
  /** the venue's symbol form: separator ("/" "-" "_" ":" or "" for BTCUSDT) and a real example */
  symbols: { sep: string; example: string; examples: string[] } | null;
  price: { tool: string; arg: string; list: boolean } | null;
  markets: { tool: string } | null;
  account: { tool: string; ok: boolean; meaning: string | null } | null;
  order: {
    tool: string;
    params: { symbol: string | null; side: string | null; qty: string | null; type: string | null; price: string | null; clientId: string | null };
    qtyUnit: "base" | "quote";
    /** required arguments the desk cannot fill from an order */
    unmapped: string[];
  } | null;
  rateLimit: string;
  errors: Array<{ tool: string; meaning: string }>;
  calls: number;
  avgMs: number;
}

export type SkillTopic = "prices" | "orders" | "account" | "limits";
export const SKILL_TOPICS: readonly SkillTopic[] = ["prices", "orders", "account", "limits"];

export interface LearnedSkill {
  topic: SkillTopic;
  description: string;
  steps: SkillDTO["steps"];
}

export interface LearnInput {
  /** the venue as the owner named it ("Binance testnet") */
  title: string;
  mode: "paper" | "live";
  testnet: boolean;
  /** this venue's tools only */
  tools: VenueTool[];
  /** the exchange id from the wizard, when the preset has one */
  exchange: string | null;
  call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }>;
  now(): number;
  /** calls allowed in one pass (default 8) */
  maxCalls?: number;
}

export const LEARN_LIMITS = { maxCalls: 8, pricesProbed: 3, examples: 5, errorChars: 160 } as const;

/** Symbols to try when the venue lists no markets: the common crypto and stock forms. */
export const PROBE_SYMBOLS = ["BTC/USDT", "BTC/USD", "BTC-USD", "BTCUSDT", "AAPL"] as const;

const local = (t: VenueTool) => t.name.slice(t.name.indexOf(".") + 1);
const words = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** What an error text means for the crew, in one short clause. */
export function errorMeaning(text: string): string {
  const t = text.toLowerCase();
  if (/\b429\b|rate.?limit|too many requests|throttl/.test(t)) return "rate limited: wait and call less often";
  if (/\b40[13]\b|unauthori[sz]ed|forbidden|invalid api|api.?key|signature|authenticat|credential/.test(t)) return "not authorized: the venue keys are missing or wrong (market data may still work)";
  if (/insufficient|not enough|balance too low/.test(t)) return "not enough balance for the order size";
  if (/min(imum)?[ _-]?(notional|amount|order|size|qty)|too small|lot size|precision/.test(t)) return "below the venue's minimum size or precision";
  if (/not enabled|is disabled|permission|not allowed|trading is not|read.?only/.test(t)) return "not enabled for these keys or this account";
  if (/symbol|market|pair|instrument|ticker|not found|unknown|no such/.test(t)) return "unknown symbol: use the venue's symbol form";
  if (/timeout|timed out|etimedout|econnreset|unavailable|\b50[234]\b/.test(t)) return "the venue was slow or down: retry once later";
  return "the call failed: check the arguments before calling it again";
}

// ------------------------------------------------------------ tool roles
function score(t: VenueTool, want: readonly string[], avoid: readonly string[]): number {
  const w = words(local(t));
  let s = 0;
  for (const x of w) {
    if (want.includes(x)) s += 3;
    if (avoid.includes(x)) s -= 4;
  }
  return s;
}

function best(tools: VenueTool[], want: readonly string[], avoid: readonly string[]): VenueTool[] {
  return tools
    .map((t, i) => ({ t, i, s: score(t, want, avoid) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.t);
}

const HISTORY = ["history", "ohlcv", "candle", "candles", "bars", "klines", "orderbook", "book", "trades", "depth", "historical"];

export function classifyVenueTools(tools: VenueTool[]) {
  const reads = tools.filter((t) => t.risk === "read" && !t.money);
  const price = best(reads, ["ticker", "price", "quote", "last", "mark", "latest", "tickers", "prices", "quotes"], HISTORY);
  // a single symbol read ranks above a batch read
  price.sort((a, b) => Number(/s$/.test(local(a))) - Number(/s$/.test(local(b))));
  const markets = best(reads, ["market", "markets", "symbols", "symbol", "instruments", "instrument", "pairs", "assets", "products"], [...HISTORY, "ticker", "tickers", "price", "prices", "quote", "balance", "account"]);
  const account = best(reads, ["balance", "balances", "account", "portfolio", "wallet", "buying", "power"], [...HISTORY, "config", "activities"]);
  const limits = best(reads, ["safety", "status", "limits", "rate", "clock"], ["order", "orders", "market", "markets", "account"]);
  const order = best(
    tools.filter((t) => t.money),
    ["create", "place", "submit", "new", "order", "buy", "sell", "trade"],
    ["cancel", "edit", "replace", "close", "get", "list", "fetch", "withdraw", "transfer", "deposit", "leverage", "margin"],
  );
  return { price, markets, account, limits, order };
}

// ------------------------------------------------------------- arguments
interface Fill {
  symbol?: string;
  query?: string;
  exchange: string | null;
}

type Props = Record<string, { type?: unknown; enum?: unknown; description?: unknown }>;

/** Arguments for a read call, or null when a required argument cannot be filled. */
export function fillArgs(t: VenueTool, v: Fill): { args: Record<string, unknown>; fixed: Record<string, string>; symbolArg: string | null; list: boolean } | null {
  const props = ((t.schema as { properties?: Props }).properties ?? {}) as Props;
  const required = new Set(((t.schema as { required?: unknown }).required as string[] | undefined) ?? []);
  const args: Record<string, unknown> = {};
  const fixed: Record<string, string> = {};
  let symbolArg: string | null = null;
  let list = false;
  for (const [name, p] of Object.entries(props)) {
    const n = argKey(name);
    const type = p?.type;
    let val: unknown;
    if (SYMBOL_ARGS.includes(n)) {
      val = v.symbol;
      if (val !== undefined) symbolArg = name;
    } else if (["symbols", "tickers", "pairs", "instruments", "markets", "assets", "coins", "products"].includes(n)) {
      val = v.symbol ? [v.symbol] : undefined;
      if (val !== undefined) {
        symbolArg = name;
        list = true;
      }
    } else if (["query", "search", "q", "keyword", "text", "filter", "term", "base"].includes(n)) val = v.query;
    else if (["exchange", "exchangeid", "venue", "broker"].includes(n)) {
      val = v.exchange ?? undefined;
      if (typeof val === "string") fixed[name] = val;
    } else if (["account", "accountname", "accountid"].includes(n)) {
      val = required.has(name) ? "default" : undefined;
      if (typeof val === "string") fixed[name] = val;
    } else if (required.has(name)) {
      if (Array.isArray(p?.enum) && p.enum.length > 0) val = p.enum[0];
      else if ((type === "integer" || type === "number") && /limit|count|size|depth/.test(n)) val = 5;
      else if (type === "boolean") val = false;
    } else if ((n === "limit" || n === "count") && (type === "integer" || type === "number")) val = 5;
    if (val === undefined) {
      if (required.has(name)) return null;
      continue;
    }
    if (Array.isArray(val) && type === "string") {
      val = val[0];
      list = false;
    }
    if (typeof val === "string" && type === "array") {
      val = [val];
      list = true;
    }
    args[name] = val;
  }
  return { args, fixed, symbolArg, list };
}

// --------------------------------------------------------------- symbols
const SYMBOL_KEYS = new Set(["symbol", "id", "ticker", "pair", "name", "instrument", "market", "product_id", "productId", "instId"]);
const SYM = /^[A-Z0-9]{1,12}(?:[/_:-][A-Z0-9]{1,12})?$/;

/** Symbol-looking strings in a markets answer: JSON values of symbol-like keys, then pairs in the text. */
export function symbolsIn(text: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const v = s.trim().toUpperCase().replace(/:[A-Z0-9]+$/, "");
    if (SYM.test(v) && !out.includes(v) && out.length < 60) out.push(v);
  };
  const walk = (o: unknown, depth: number) => {
    if (!o || typeof o !== "object" || depth > 4 || out.length >= 60) return;
    if (Array.isArray(o)) {
      for (const x of o.slice(0, 200)) typeof x === "string" ? push(x) : walk(x, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === "string" && SYMBOL_KEYS.has(k)) push(v);
      else if (typeof v === "object") walk(v, depth + 1);
      else if (depth === 0 && SYM.test(k.toUpperCase()) && /[/_:-]/.test(k)) push(k);
    }
  };
  const t = text.trim();
  const start = t.search(/[[{]/);
  if (start >= 0) {
    try {
      walk(JSON.parse(t.slice(start)), 0);
    } catch {
      // not JSON
    }
  }
  if (out.length === 0) for (const m of t.matchAll(/\b([A-Z0-9]{2,10})([/_:-])([A-Z0-9]{2,10})\b/g)) push(m[0]);
  return out;
}

const QUOTES = ["USDT", "USD", "USDC", "EUR"];

/** The venue's symbol form from symbols it listed: the most common separator and a preferred example. */
export function symbolForm(symbols: readonly string[]): { sep: string; example: string; examples: string[] } | null {
  if (symbols.length === 0) return null;
  const count = new Map<string, number>();
  for (const s of symbols) {
    const m = /[/_:-]/.exec(s);
    const sep = m ? m[0] : "";
    count.set(sep, (count.get(sep) ?? 0) + 1);
  }
  const sep = [...count.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const same = symbols.filter((s) => (sep ? s.includes(sep) : !/[/_:-]/.test(s)));
  const pick = (base: string) => {
    for (const q of QUOTES) {
      const want = sep ? `${base}${sep}${q}` : `${base}${q}`;
      if (same.includes(want)) return want;
    }
    return null;
  };
  const example = pick("BTC") ?? pick("ETH") ?? same[0] ?? symbols[0]!;
  return { sep, example, examples: [example, ...same.filter((s) => s !== example)].slice(0, LEARN_LIMITS.examples) };
}

/** A venue symbol in the desk form (BTC/USDT to BTC-USDT); single tickers stay. */
export function deskSymbol(venueSymbol: string, sep: string): string {
  if (!sep) return venueSymbol;
  const i = venueSymbol.indexOf(sep);
  return i > 0 ? `${venueSymbol.slice(0, i)}-${venueSymbol.slice(i + sep.length)}` : venueSymbol;
}

function sepName(sep: string): string {
  if (sep === "") return "no separator";
  if (sep === "/") return "a slash";
  if (sep === "-") return "a dash";
  if (sep === "_") return "an underscore";
  return `"${sep}"`;
}

// ----------------------------------------------------------------- pass
export async function learnVenue(input: LearnInput): Promise<{ profile: VenueProfile; skills: LearnedSkill[] }> {
  const maxCalls = Math.max(1, input.maxCalls ?? LEARN_LIMITS.maxCalls);
  const roles = classifyVenueTools(input.tools);
  const errors: VenueProfile["errors"] = [];
  const fixedArgs: Record<string, string> = {};
  let calls = 0;
  let spent = 0;
  let rateText: string | null = null;

  async function read(t: VenueTool, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
    calls++;
    const started = input.now();
    let r: { ok: boolean; output: string };
    try {
      r = await input.call(t.name, args);
    } catch (e) {
      r = { ok: false, output: e instanceof Error ? e.message : String(e) };
    }
    spent += Math.max(0, input.now() - started);
    const text = redact(r.output ?? "");
    if (!r.ok || /^error\b/i.test(text.trim())) {
      const meaning = errorMeaning(text);
      if (!errors.some((e) => e.tool === t.name && e.meaning === meaning)) errors.push({ tool: t.name, meaning });
      if (/rate.?limit|429/i.test(text)) rateText ??= "the venue answered with a rate limit while learning: keep well under one call per second";
      return { ok: false, output: text };
    }
    return { ok: true, output: text };
  }

  // 1 markets: the symbol form
  let symbols: VenueProfile["symbols"] = null;
  let markets: VenueProfile["markets"] = null;
  for (const t of roles.markets.slice(0, 2)) {
    if (calls >= maxCalls) break;
    const f = fillArgs(t, { query: "BTC", exchange: input.exchange });
    if (!f || f.symbolArg) continue;
    const r = await read(t, f.args);
    if (!r.ok) continue;
    Object.assign(fixedArgs, f.fixed);
    markets = { tool: t.name };
    symbols = symbolForm(symbolsIn(r.output));
    if (symbols) break;
  }

  // 2 one ticker: the price tool and its argument, trying the symbol forms when the markets said nothing
  let price: VenueProfile["price"] = null;
  const probes = symbols ? [symbols.example] : [...PROBE_SYMBOLS];
  outer: for (const t of roles.price.slice(0, 2)) {
    let tried = 0;
    for (const sym of probes) {
      if (calls >= maxCalls || tried >= LEARN_LIMITS.pricesProbed) break;
      const f = fillArgs(t, { symbol: sym, exchange: input.exchange });
      if (!f || !f.symbolArg) break;
      tried++;
      const r = await read(t, f.args);
      if (!r.ok) continue;
      if (parsePrice(r.output) === null) continue;
      Object.assign(fixedArgs, f.fixed);
      price = { tool: t.name, arg: f.symbolArg, list: f.list };
      if (!symbols) {
        const m = /[/_:-]/.exec(sym);
        symbols = { sep: m ? m[0] : "", example: sym, examples: [sym] };
      }
      break outer;
    }
  }

  // 3 the balances: whether the keys work (the numbers never land in a skill)
  let account: VenueProfile["account"] = null;
  for (const t of roles.account.slice(0, 1)) {
    if (calls >= maxCalls) break;
    const f = fillArgs(t, { exchange: input.exchange });
    if (!f || f.symbolArg) continue;
    const r = await read(t, f.args);
    account = { tool: t.name, ok: r.ok, meaning: r.ok ? null : errorMeaning(r.output) };
    if (r.ok) Object.assign(fixedArgs, f.fixed);
  }

  // 4 limits: a status or safety tool when the venue has one
  for (const t of roles.limits.slice(0, 1)) {
    if (calls >= maxCalls || rateText) break;
    const f = fillArgs(t, { exchange: input.exchange });
    if (!f || f.symbolArg) continue;
    const r = await read(t, f.args);
    if (!r.ok) continue;
    const m = /[^.\n]*\brate.?limit[^.\n]*/i.exec(r.output);
    if (m) rateText = `the venue says: ${clip(m[0].replace(/[{}"[\]]/g, " ").replace(/\s+/g, " ").trim(), 140)}`;
  }

  // 5 the order tool: read its schema, never call it
  let order: VenueProfile["order"] = null;
  const ot = roles.order[0];
  if (ot) {
    const props = ((ot.schema as { properties?: Props }).properties ?? {}) as Props;
    const required = ((ot.schema as { required?: unknown }).required as string[] | undefined) ?? [];
    const find = (names: readonly string[]) => Object.keys(props).find((p) => names.includes(argKey(p))) ?? null;
    const qty = find(QTY_ARGS) ?? find(["notional", "cost", "quoteamount", "quoteqty"]);
    const qtyDesc = qty ? String(props[qty]?.description ?? "") : "";
    const quoteUnit = qty !== null && (["notional", "cost", "quoteamount", "quoteqty"].includes(argKey(qty)) || /\b(quote|notional|usd|dollars?|cost)\b/i.test(qtyDesc));
    const params = {
      symbol: find(SYMBOL_ARGS),
      side: find(["side", "direction", "action"]),
      qty,
      type: find(TYPE_ARGS),
      price: find(PRICE_ARGS),
      clientId: find(CLIENT_ID_ARGS),
    };
    const mapped = new Set([...Object.values(params).filter((x): x is string => !!x), ...Object.keys(fixedArgs)]);
    for (const r of required) {
      const n = argKey(r);
      if (mapped.has(r)) continue;
      if (["exchange", "exchangeid"].includes(n) && input.exchange) {
        fixedArgs[r] = input.exchange;
        mapped.add(r);
      } else if (["account", "accountname", "accountid"].includes(n)) {
        fixedArgs[r] = "default";
        mapped.add(r);
      }
    }
    order = { tool: ot.name, params, qtyUnit: quoteUnit ? "quote" : "base", unmapped: required.filter((r) => !mapped.has(r)) };
  }

  const avgMs = calls ? Math.round(spent / calls) : 0;
  const profile: VenueProfile = {
    v: 1,
    fixedArgs,
    symbols,
    price,
    markets,
    account,
    order,
    rateLimit: rateText ?? `no limit published; keep to about one call per second and back off on a rate limit error${avgMs >= 1000 ? ` (reads took about ${Math.round(avgMs / 100) / 10} s)` : ""}`,
    errors: errors.slice(0, 6),
    calls,
    avgMs,
  };
  return { profile, skills: venueSkills(input, profile) };
}

// ---------------------------------------------------------------- skills
/** "Binance testnet prices: " (the note drops this head) */
export const skillHead = (title: string, topic: SkillTopic) => `${title} ${topic}: `;

function fixedText(fixed: Record<string, string>): string {
  const pairs = Object.entries(fixed);
  return pairs.length ? `, with ${pairs.map(([k, v]) => `${k} ${v}`).join(" and ")}` : "";
}

export function venueSkills(input: Pick<LearnInput, "title" | "mode" | "testnet">, p: VenueProfile): LearnedSkill[] {
  const title = clip(input.title.replace(/\s+/g, " ").trim(), 40);
  const example = p.symbols?.example ?? "BTC/USDT";
  const desk = deskSymbol(example, p.symbols?.sep ?? "/");
  const out: LearnedSkill[] = [];
  if (p.price) {
    out.push({
      topic: "prices",
      description:
        skillHead(title, "prices") +
        `get_quote reads ${p.price.tool} (${p.price.arg} like ${example}${fixedText(p.fixedArgs)}). The venue writes symbols with ${sepName(p.symbols?.sep ?? "/")} (${example}); give get_quote and propose_order ${desk} and the desk converts.`,
      steps: [{ tool: p.price.tool, args: { [p.price.arg]: p.price.list ? [example] : example, ...p.fixedArgs }, note: "read only; get_quote calls it for you" }],
    });
  }
  const mode = input.mode === "paper" ? "Paper mode: the paper broker fills at the venue's prices after the risk review." : "Live mode: after the risk review the owner's auto trade limits decide, else the owner does.";
  if (p.order) {
    const o = p.order.params;
    const qty = `${o.qty ?? "the amount"} in ${p.order.qtyUnit === "quote" ? "the quote currency" : "base units (BTC, not USD)"}`;
    out.push({
      topic: "orders",
      description:
        skillHead(title, "orders") +
        `never call ${p.order.tool} yourself; propose_order sends it. It takes ${o.symbol ?? "the symbol"} like ${example}, ${qty}${o.side ? `, ${o.side} buy or sell` : ""}${o.type ? `, ${o.type} market or limit` : ""}${o.price ? `, ${o.price} for a limit in the quote currency` : ""}${p.order.unmapped.length ? `; it also needs ${p.order.unmapped.join(", ")}, so the owner sets those` : ""}. ${mode}`,
      steps: [{ tool: "propose_order", args: { symbol: desk, side: "buy", qty: 0.001, type: "market", reason: "one line why" }, note: `the desk routes it to ${p.order.tool}` }],
    });
  } else {
    out.push({
      topic: "orders",
      description: skillHead(title, "orders") + `no order tool: propose_order fills on the paper broker at this venue's prices. ${mode}`,
      steps: [{ tool: "propose_order", args: { symbol: desk, side: "buy", qty: 0.001, type: "market", reason: "one line why" }, note: "paper broker" }],
    });
  }
  if (p.account) {
    out.push({
      topic: "account",
      description: skillHead(title, "account") + `${p.account.tool} reads the balances${p.account.ok ? "" : `; while learning it answered ${p.account.meaning}`}.`,
      steps: [{ tool: p.account.tool, args: { ...p.fixedArgs }, note: "read only" }],
    });
  }
  const errs = p.errors.map((e) => `${e.tool}: ${e.meaning}`).join("; ");
  out.push({
    topic: "limits",
    description: skillHead(title, "limits") + `${p.rateLimit}.${errs ? ` Errors while learning: ${errs}.` : " No errors while learning."}${input.testnet ? " Testnet: the balances are not real money." : ""}`,
    steps: [{ tool: p.price?.tool ?? "get_quote", args: {}, note: "back off on a rate limit error" }],
  });
  return out.map((s) => ({ ...s, description: clip(s.description, 400) }));
}

/** The memory layer note of one venue: the skill bodies under one versioned head. Stable per version. */
export function venueNote(title: string, mode: "paper" | "live", testnet: boolean, version: number, skills: ReadonlyArray<{ name: string; description: string }>, key: string): string {
  const head = `Crew skill v${version} for the ${clip(title, 40)} venue (${mode}${testnet ? ", testnet" : ""}), learned by the data engineer:`;
  const body: string[] = [];
  for (const topic of SKILL_TOPICS) {
    const s = skills.find((x) => x.name === skillName(key, topic));
    if (!s) continue;
    const h = /^[^:]{1,80} (prices|orders|account|limits): /.exec(s.description);
    const text = h ? s.description.slice(h[0].length) : s.description;
    body.push(`${topic[0]!.toUpperCase()}${topic.slice(1)}: ${text}`);
  }
  return clip(`${head} ${body.join(" ")}`, 900);
}

/** The skill name of one topic of a venue ("venue binance: prices"). */
export const skillPrefix = (key: string) => `venue ${key}: `;
export const skillName = (key: string, topic: SkillTopic) => `${skillPrefix(key)}${topic}`;
