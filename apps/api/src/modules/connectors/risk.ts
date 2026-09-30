// Tool names and risk. Tool names are namespaced by connector label
// ("binance.get_ticker"); providers reject dots in function names, so the
// model sees a safe alias ("binance__get_ticker") and the tools service
// accepts both. Risk comes from MCP annotations and the name: reads are
// read, deletes are destructive, sending data out is sensitive, and order
// placement or fund movement is always sensitive and marked money, which
// only the trading gate may call. Pure.
import type { Risk } from "@mengai/shared";

/** connector labels: lowercase, digits, dash and single underscores, at most 24 chars */
export const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]|_(?!_)){0,23}$/;
const LOCAL_MAX = 38;

/** A remote tool or operation name as a safe local name: [A-Za-z0-9_-], at most 38 chars. */
export function localName(raw: string): string {
  const s = String(raw)
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, LOCAL_MAX)
    .replace(/[_-]+$/g, "");
  return s || "tool";
}

/** Unique local names in order: a clash gets _2, _3, ... */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.map((n) => {
    let name = n;
    for (let i = 2; seen.has(name); i++) name = `${n.slice(0, LOCAL_MAX - String(i).length - 1)}_${i}`;
    seen.add(name);
    return name;
  });
}

export const toolName = (label: string, local: string) => `${label}.${local}`;
export const toolAlias = (label: string, local: string) => `${label}__${local}`;

/** "binance__get_ticker" or "binance.get_ticker" to its namespaced name; null when it is neither. */
export function namespaced(name: string): string | null {
  const dot = name.indexOf(".");
  if (dot > 0) return name;
  const at = name.indexOf("__");
  if (at > 0) return `${name.slice(0, at)}.${name.slice(at + 2)}`;
  return null;
}

function tokens(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const READ_VERBS = new Set(["get", "list", "read", "fetch", "search", "query", "describe", "show", "find", "lookup", "view", "info", "status", "check", "count", "stats", "history", "quote", "ticker", "price", "prices"]);
const MONEY_WORDS = new Set(["order", "orders", "trade", "trades", "buy", "sell", "withdraw", "withdrawal", "transfer", "payment", "payments", "pay", "payout", "swap", "deposit", "wire", "charge", "refund", "transaction"]);
const DESTRUCTIVE_WORDS = new Set(["delete", "remove", "drop", "destroy", "wipe", "purge", "truncate", "kill", "erase", "reset", "revoke"]);
const SEND_WORDS = new Set(["send", "post", "publish", "email", "notify", "tweet", "share", "upload", "message", "invite"]);

export interface RiskHints {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

export interface Classified {
  risk: Risk;
  money: boolean;
}

/** Risk of a tool from its name (and MCP annotations when present). */
export function classify(name: string, hints: RiskHints = {}, method?: string): Classified {
  const t = tokens(name);
  const readFirst = t.length > 0 && READ_VERBS.has(t[0]!);
  const moneyWord = t.some((w) => MONEY_WORDS.has(w));
  if (moneyWord && !readFirst && method !== "GET") return { risk: "sensitive", money: true };
  if (method === "DELETE" || t.some((w) => DESTRUCTIVE_WORDS.has(w)) || hints.destructiveHint === true) return { risk: "destructive", money: false };
  if (method === "GET" || hints.readOnlyHint === true || readFirst) return { risk: "read", money: false };
  if (t.some((w) => SEND_WORDS.has(w))) return { risk: "sensitive", money: false };
  return { risk: "write", money: false };
}

/** Destructive and sensitive tools always go through the approval path. */
export function needsApproval(risk: Risk): boolean {
  return risk === "destructive" || risk === "sensitive";
}
