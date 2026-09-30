// What the tools module needs beyond core/services: the connectors and the
// trading services (structural, injected by core/container.ts), and the
// capability context the runs engine adds to a tool call (company, role key,
// the trading grants of the cat, and the approval path for sensitive tools).
import type { AgentRole, CompanyKind, OrderDTO, PositionDTO, Risk } from "@mengai/shared";

export interface BridgeTool {
  /** namespaced name ("binance.get_ticker") */
  name: string;
  /** provider-safe function name ("binance__get_ticker") */
  alias: string;
  description: string;
  risk: Risk;
  /** order placement or fund movement: never called directly, only through the trading gate */
  money: boolean;
  connectorLabel: string;
  schema: Record<string, unknown>;
}

export interface ConnectorsBridge {
  tools(scope: { role: AgentRole }): Promise<BridgeTool[]>;
  call(name: string, args: Record<string, unknown>, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<{ ok: boolean; output: string }>;
}

export interface TradingBridge {
  quote(symbol: string, opts?: { signal?: AbortSignal; price?: number | null; runId?: string | null }): Promise<{ symbol: string; price: number; source: string }>;
  propose(input: {
    runId: string | null;
    agentId: string | null;
    symbol: string;
    side: "buy" | "sell";
    qty: number;
    type: "market" | "limit";
    limitPrice?: number | null;
    live?: boolean;
    venue?: string | null;
    quote?: number | null;
    reason: string;
    signal?: AbortSignal;
  }): Promise<OrderDTO>;
  review(input: { runId: string | null; agentId: string | null; orderId?: string | null; verdict: "approve" | "reject"; note: string; signal?: AbortSignal }): Promise<OrderDTO>;
  positions(mode?: "paper" | "live"): Promise<PositionDTO[]>;
  pendingReview(runId: string | null): Promise<OrderDTO[]>;
}

export interface ApprovalRequest {
  tool: string;
  risk: Risk;
  /** one line: what will happen */
  summary: string;
}

/** Added by the runs engine to every tool call (all optional: a studio run without connectors sets none). */
export interface CapabilityContext {
  company?: CompanyKind;
  /** the dynamic role key, or the base role */
  roleKey?: string;
  /** capability tools (trading) the company template grants this cat */
  grants?: readonly string[];
  /** the approval path for destructive and sensitive connector tools: the CEO decides crew requests, the owner the rest */
  approve?(req: ApprovalRequest): Promise<{ approved: boolean; answer: string }>;
}

export interface TaskSpecsInput {
  role: AgentRole;
  runId: string;
  taskId: string | null;
  grants?: readonly string[];
}
