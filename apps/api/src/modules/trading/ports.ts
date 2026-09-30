// What the trading module exposes and needs. The venue is the connectors
// service, structurally: a live order goes out through one connector tool,
// and a price tool of a connector gives the paper broker its last price.
import type { OrderDTO, OrderStatus, PositionDTO, TradingSettings } from "@mengai/shared";

export interface VenueTool {
  name: string;
  connectorId: string;
  alias: string;
  description: string;
  risk: string;
  money: boolean;
  schema: Record<string, unknown>;
}

export interface TradingVenue {
  /** every connector's tools (no role scope: the owner's gate places the order, not a cat) */
  tools(scope: Record<string, never>): Promise<VenueTool[]>;
  call(name: string, args: Record<string, unknown>, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<{ ok: boolean; output: string }>;
}

export interface ProposeInput {
  runId: string | null;
  agentId: string | null;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  type: "market" | "limit";
  limitPrice?: number | null;
  /** a live order (a proposal that waits for the risk manager, then the gate and the owner) */
  live?: boolean;
  /** the connector tool that places a live order, e.g. "exchange.place_order" */
  venue?: string | null;
  /** the last price the trader read; the paper broker fills market orders at it */
  quote?: number | null;
  reason: string;
  signal?: AbortSignal;
}

export interface ReviewInput {
  runId: string | null;
  /** the reviewing cat (the risk manager); never the cat that proposed the order */
  agentId: string | null;
  /** omitted: the oldest order of the run waiting for a risk review */
  orderId?: string | null;
  verdict: "approve" | "reject";
  note: string;
  signal?: AbortSignal;
}

export interface OrderQuery {
  runId?: string;
  status?: OrderStatus;
  limit?: number;
}

export interface TradingService {
  settings(): Promise<TradingSettings>;
  /** saves the owner's settings and clears a kill switch stop */
  saveSettings(s: TradingSettings): Promise<TradingSettings>;
  orders(q?: OrderQuery): Promise<OrderDTO[]>;
  positions(mode?: "paper" | "live"): Promise<PositionDTO[]>;
  /** the owner's decision on a live order the risk manager approved */
  decide(orderId: string, decision: "approve" | "reject"): Promise<OrderDTO>;
  /** last price: a connector price tool; updates marks and fills open paper limit orders */
  quote(symbol: string, opts?: { signal?: AbortSignal; price?: number | null; runId?: string | null }): Promise<{ symbol: string; price: number; source: string }>;
  propose(input: ProposeInput): Promise<OrderDTO>;
  review(input: ReviewInput): Promise<OrderDTO>;
  /** orders of a run still waiting for a risk review, oldest first */
  pendingReview(runId: string | null): Promise<OrderDTO[]>;
  /** kill switch: cancels open orders and stops trading until the owner saves the settings */
  halt(reason: string): Promise<number>;
  halted(): Promise<boolean>;
}

/** A trading rule a tool call broke; the tools bridge shows the message to the cat. */
export class TradingError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid" | "halted" | "no_price" | "not_found" | "conflict" | "gate" = "invalid",
  ) {
    super(message);
    this.name = "TradingError";
  }
}
