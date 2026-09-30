// Company kinds, external connectors (MCP and HTTP APIs) and trading. MengAI
// is a general cat company: the same crew engine runs a software studio or a
// hedge fund, and any agent can use tools from connectors the owner adds.
// Secrets never appear here: connectors expose a 4 character key hint at most.
import type { AgentRole, Risk } from "./enums";

/** What kind of company a run is. Drives the role templates, the tracker stages and the office theme. */
export const COMPANY_KINDS = ["studio", "fund"] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number];

/** Tracker stages per company kind, in order. Studio matches RUN_STAGES. */
export const COMPANY_STAGES: Record<CompanyKind, readonly string[]> = {
  studio: ["goal", "planned", "hired", "working", "review", "testing", "shipped"],
  fund: ["thesis", "research", "backtest", "risk_review", "paper_trade", "live_trade", "report"],
};

export const COMPANY_STAGE_LABEL: Record<string, string> = {
  goal: "Goal received",
  planned: "Oyen plans",
  hired: "Team hired",
  working: "Working",
  review: "Review",
  testing: "Testing",
  shipped: "Shipped",
  thesis: "Thesis",
  research: "Data research",
  backtest: "Backtest",
  risk_review: "Risk review",
  paper_trade: "Paper trade",
  live_trade: "Live trade",
  report: "P&L report",
};

export const CONNECTOR_KINDS = ["mcp_stdio", "mcp_http", "http_api"] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

export interface ConnectorTool {
  /** namespaced tool name the agents see, e.g. "binance.get_ticker" */
  name: string;
  description: string;
  /** read, write, destructive or sensitive; order placement and fund movement are always sensitive */
  risk: Risk;
}

export interface ConnectorDTO {
  id: string;
  kind: ConnectorKind;
  label: string;
  /** mcp_stdio: the command line (secrets redacted); mcp_http and http_api: the base URL */
  target: string;
  hasSecret: boolean;
  keyHint: string | null;
  status: "connected" | "error" | "disabled";
  error: string | null;
  tools: ConnectorTool[];
  /** roles that may use this connector; null means every role */
  roles: AgentRole[] | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateConnectorBody {
  kind: ConnectorKind;
  label: string;
  /** mcp_stdio: command and args; mcp_http and http_api: base URL */
  target: string;
  /** env for mcp_stdio or the auth header value for HTTP; stored in the vault, never returned */
  secret?: string;
  /** http_api: header name for the secret, e.g. "Authorization" or "X-API-KEY" */
  authHeader?: string;
  /** http_api: an OpenAPI 3 document URL or JSON to turn endpoints into tools */
  openapi?: string;
  roles?: AgentRole[] | null;
}

export type UpdateConnectorBody = Partial<Omit<CreateConnectorBody, "kind">> & { enabled?: boolean };

/** Trading safety. Defaults are conservative: paper trading, approval for every live order. */
export interface TradingSettings {
  mode: "paper" | "live";
  /** when false, every live order waits for the owner's approval */
  autoTrade: boolean;
  /** hard cap per order in USD (0 blocks live orders) */
  maxOrderUsd: number;
  /** trading stops for the day when realized plus unrealized loss passes this (USD) */
  dailyLossLimitUsd: number;
  /** only these symbols may be traded live; empty means none */
  allowedSymbols: string[];
}

export const DEFAULT_TRADING: TradingSettings = {
  mode: "paper",
  autoTrade: false,
  maxOrderUsd: 0,
  dailyLossLimitUsd: 0,
  allowedSymbols: [],
};

export const ORDER_STATUSES = ["proposed", "approved", "rejected", "filled", "cancelled", "failed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderDTO {
  id: string;
  runId: string | null;
  agentId: string | null;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  type: "market" | "limit";
  limitPrice: number | null;
  mode: "paper" | "live";
  status: OrderStatus;
  /** connector id that routes the order; null for paper fills */
  venue: string | null;
  /** the trader cat's one-line reason, and the risk manager's verdict */
  reason: string;
  riskNote: string | null;
  fillPrice: number | null;
  createdAt: number;
  decidedAt: number | null;
  filledAt: number | null;
}

export interface PositionDTO {
  symbol: string;
  mode: "paper" | "live";
  qty: number;
  avgPrice: number;
  lastPrice: number | null;
  unrealizedUsd: number;
  realizedUsd: number;
}

// ------------------------------------------------------------ trading venues
/**
 * Presets for the Trading menu's connection wizard. A venue is a connector
 * (MCP or HTTP API) plus trading metadata. Commands and URLs are editable
 * templates: the owner confirms them before connecting.
 */
export interface TradingVenuePreset {
  id: string;
  label: string;
  kind: "crypto" | "broker" | "dex" | "custom";
  connector: ConnectorKind;
  /** mcp_stdio: the command template; http: the base URL template */
  target: string;
  /** fields the wizard asks for; values go to the vault, never returned. secret false means a plain setting (shown as text) */
  secrets: Array<{ key: string; label: string; secret?: boolean }>;
  supportsPaper: boolean;
  supportsTestnet: boolean;
  docsUrl: string;
}

export const TRADING_VENUE_PRESETS: TradingVenuePreset[] = [
  { id: "ccxt-mcp", label: "CCXT MCP (crypto exchanges)", kind: "crypto", connector: "mcp_stdio", target: "npx -y ccxt-mcp", secrets: [{ key: "CCXT_MCP_EXCHANGE", label: "Exchange id, e.g. binance", secret: false }, { key: "CCXT_MCP_APIKEY", label: "API key" }, { key: "CCXT_MCP_SECRET", label: "API secret" }], supportsPaper: true, supportsTestnet: true, docsUrl: "https://github.com/ccxt/ccxt/tree/master/mcp" },
  { id: "alpaca-mcp", label: "Alpaca (stocks and crypto broker)", kind: "broker", connector: "mcp_stdio", target: "uvx alpaca-mcp-server", secrets: [{ key: "ALPACA_API_KEY", label: "API key" }, { key: "ALPACA_SECRET_KEY", label: "Secret key" }], supportsPaper: true, supportsTestnet: false, docsUrl: "https://github.com/alpacahq/alpaca-mcp-server" },
  { id: "custom-mcp", label: "Custom MCP server", kind: "custom", connector: "mcp_stdio", target: "", secrets: [{ key: "API_KEY", label: "API key" }], supportsPaper: true, supportsTestnet: true, docsUrl: "https://modelcontextprotocol.io" },
  { id: "custom-http", label: "Custom REST API (OpenAPI)", kind: "custom", connector: "http_api", target: "https://", secrets: [{ key: "Authorization", label: "Auth header value" }], supportsPaper: true, supportsTestnet: true, docsUrl: "https://spec.openapis.org/oas/latest.html" },
];

/** A trading venue connection as the Trading menu shows it. */
export interface TradingVenueDTO {
  id: string;
  /** the connector row that carries the tools and the vault secret */
  connectorId: string;
  preset: string;
  label: string;
  mode: "paper" | "live";
  testnet: boolean;
  status: "connected" | "learning" | "ready" | "error" | "disabled";
  error: string | null;
  /** skills the crew learned for this venue (shared by every agent) */
  learnedSkills: Array<{ id: string; name: string; uses: number; wins: number }>;
  createdAt: number;
  updatedAt: number;
}

export interface CreateTradingVenueBody {
  preset: string;
  label?: string;
  /** overrides the preset target (command or URL) */
  target?: string;
  secrets?: Record<string, string>;
  mode: "paper" | "live";
  testnet?: boolean;
}
