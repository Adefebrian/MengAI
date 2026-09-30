// What the trading module exposes and needs. The venue is the connectors
// service, structurally: a live order goes out through one connector tool,
// a price tool of a connector gives the paper broker its last price, and a
// trading venue creates or reuses a connector through the admin methods.
// The crew memory arrives late (the tools module binds it): the learning
// pass writes crew-wide skills there and fills record wins and losses.
import type {
  AgentRole,
  ConnectorDTO,
  CreateConnectorBody,
  CreateTradingVenueBody,
  LessonDTO,
  OrderDTO,
  OrderStatus,
  PositionDTO,
  SkillDTO,
  TradingSettings,
  TradingVenueDTO,
  UpdateConnectorBody,
} from "@mengai/shared";

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
  // connector admin (the connectors service has them; a narrow fake may not)
  list?(): Promise<ConnectorDTO[]>;
  create?(body: CreateConnectorBody): Promise<ConnectorDTO>;
  update?(id: string, body: UpdateConnectorBody): Promise<ConnectorDTO>;
  remove?(id: string): Promise<void>;
  test?(id: string): Promise<ConnectorDTO>;
}

/** The crew memory as the desk uses it (the memory module's service, structurally). */
export interface VenueMemory {
  saveSkill(input: { name: string; description: string; role: AgentRole | null; steps: SkillDTO["steps"] }): Promise<SkillDTO>;
  sharedSkills(prefix: string): Promise<SkillDTO[]>;
  skillOutcome(name: string, win: boolean): Promise<boolean>;
  deleteSharedSkills(prefix: string): Promise<number>;
  record(input: { text: string; tags?: string[]; role: AgentRole | null; projectId: string | null; runId: string | null; scope?: "global" | "role" | "project" }): Promise<LessonDTO>;
}

/**
 * An in-process venue (a simulated exchange): its tools look like a
 * connector's ("<label>.<local>") and it is learned like one. Kept in memory
 * only; the fund demo attaches one. It never moves real money.
 */
export interface VenueSimulator {
  /** connector-style label, lowercase: the tools are "<label>.<local>" */
  label: string;
  title: string;
  tools: Array<{ local: string; description: string; risk: "read" | "write" | "destructive" | "sensitive"; money: boolean; schema: Record<string, unknown> }>;
  call(local: string, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }>;
  /** the desk reports each order it routes to this venue (a simulated tape may move) */
  observe?(e: { kind: "proposed" | "filled"; symbol: string; side: "buy" | "sell"; qty: number; price: number | null }): void;
}

/** One ready venue's memory layer note. The text changes only with the skill version (prefix caching). */
export interface VenueNote {
  venueId: string;
  version: number;
  text: string;
}

export type UpdateTradingVenueBody = Partial<CreateTradingVenueBody> & { enabled?: boolean };

export interface ProposeInput {
  runId: string | null;
  agentId: string | null;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  type: "market" | "limit";
  limitPrice?: number | null;
  /**
   * true: a live order (it waits for the risk manager, then the gate and the
   * owner); false: paper; absent: live only when the owner set live mode and
   * a live venue is ready, else paper
   */
  live?: boolean;
  /** the connector tool that places a live order, e.g. "exchange.place_order"; absent: the ready venue's learned order tool */
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
  /** last price: a learned venue's price tool, else a connector price tool; updates marks and fills open paper limit orders */
  quote(symbol: string, opts?: { signal?: AbortSignal; price?: number | null; runId?: string | null }): Promise<{ symbol: string; price: number; source: string }>;
  propose(input: ProposeInput): Promise<OrderDTO>;
  review(input: ReviewInput): Promise<OrderDTO>;
  /** orders of a run still waiting for a risk review, oldest first */
  pendingReview(runId: string | null): Promise<OrderDTO[]>;
  /** kill switch: cancels open orders and stops trading until the owner saves the settings */
  halt(reason: string): Promise<number>;
  halted(): Promise<boolean>;

  // ------------------------------------------------------------ venues
  venues(): Promise<TradingVenueDTO[]>;
  /** creates or reuses a connector from a preset, stores the secrets in the vault, then learns the venue in the background */
  createVenue(body: CreateTradingVenueBody): Promise<TradingVenueDTO>;
  updateVenue(id: string, body: UpdateTradingVenueBody): Promise<TradingVenueDTO>;
  /** removes the venue, its learned skills and the connector when the venue created it */
  removeVenue(id: string): Promise<void>;
  /** the read-only learning pass; resolves when the venue is ready or in error */
  learnVenue(id: string): Promise<TradingVenueDTO>;
  /** memory layer notes of the ready venues this role may use */
  venueNotes(role: AgentRole): Promise<VenueNote[]>;
  /** binds the crew memory (the tools module calls it once at boot) */
  useMemory(memory: VenueMemory): void;
  /** attaches an in-process venue and learns it; resolves with the ready venue */
  connectSimulator(sim: VenueSimulator, opts?: { mode?: "paper" | "live" }): Promise<TradingVenueDTO>;
  /** resolves once every background learning pass has settled */
  idle(): Promise<void>;
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
