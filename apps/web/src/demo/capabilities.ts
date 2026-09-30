// Demo mode's answers for the newer routes: what is in a cat's head, the
// connectors and the trading desk. Sample data, scripted for the page,
// never a recording. Secrets typed into the demo are never kept: a
// connector keeps a 4 character hint, the same rule the real vault
// follows.
import {
  DEFAULT_TRADING,
  ROLE_LABEL,
  type AgentDTO,
  type AgentMindDTO,
  type ConnectorDTO,
  type ConnectorTool,
  type CreateConnectorBody,
  type DecisionDTO,
  type OrderDTO,
  type PositionDTO,
  type RoleDTO,
  type StrategyVersionDTO,
  type TradingSettings,
  type UpdateConnectorBody,
} from "@mengai/shared";
import { DEMO_T0 } from "./fixture";

const H = 3_600_000;
const D = 86_400_000;

/** Short sample charters per base role, in the voice the engine writes them. */
const CHARTER: Record<string, string> = {
  lead: "You run the company. Turn the owner's goal into a small task graph with one owner per card, hire only the roles the plan needs, answer the crew's questions yourself unless they touch scope, credentials, money or anything that cannot be undone, and write the final report with what shipped and what to watch.",
  engineer: "You write and change code inside the project folder. Read before you edit, change by line range, keep the diff small, run the tests yourself and hand off with what changed and what you checked.",
  designer: "You design screens and their states. Every control ships its eight states, every empty state says why, and every image you generate is sized for its slot.",
  reviewer: "You review every change against its acceptance checks. Run the tests yourself, never trust a summary, pass it only when every check holds, and send it back with concrete notes when one fails.",
  qa: "You test against real fixtures. Cover the empty case, the normal case and the case that breaks naive code, run the whole suite and report the first failing input.",
  security: "You scan for committed secrets, unsafe dependencies and risky config. Grade every finding by what ships, and block only on what can hurt the owner.",
  researcher: "You read the web for answers when network tools are allowed. Cite the page you read and say how sure you are.",
  operator: "You would operate apps on the owner's Mac with their permission. You sit this build out.",
};

const ENGINEER_V1 = "Before a handoff, run the tests that cover the file you changed and name them in the summary.";
const ENGINEER_V2 = "Before a handoff, run the tests that cover the file you changed and name them in the summary. For any text export, quote fields that contain a comma, a quote, CR or LF, and double embedded quotes.";

function strategy(over: Partial<StrategyVersionDTO> & Pick<StrategyVersionDTO, "id" | "version" | "text" | "status">): StrategyVersionDTO {
  return {
    subject: "role",
    subjectKey: "engineer",
    role: "engineer",
    tokens: Math.round(over.text.split(/\s+/).length * 1.3),
    choice: "adopt",
    reason: "",
    decision: null,
    evidence: null,
    createdAt: DEMO_T0,
    ...over,
  };
}

const ENGINEER_HISTORY: StrategyVersionDTO[] = [
  strategy({
    id: "sv-eng-cand",
    version: 3,
    text: "Always write the tests after the code so the handoff is faster.",
    status: "rejected",
    choice: "keep",
    reason: "The candidate dropped the test-first habit that closed the review loop; JEV kept version 2.",
    decision: { id: "dec-adopt-eng-3", confidence: 0.77, verified: true, stamp: null },
    createdAt: DEMO_T0 + 160_000,
  }),
  strategy({
    id: "sv-eng-2",
    version: 2,
    text: ENGINEER_V2,
    status: "active",
    choice: "merge",
    reason: "A review sent csv.ts back for quoting; the merged text keeps the test rule and adds the quoting rule.",
    decision: { id: "dec-adopt-eng-2", confidence: 0.81, verified: true, stamp: null },
    evidence: {
      scores: { current: 0.62, candidate: 0.79 },
      addressed: { current: 1, candidate: 3, losses: 4 },
      billableInputTokens: { current: 41_200, candidate: 38_900, legacy: 96_400 },
      tokens: { current: 22, candidate: 44 },
    },
    createdAt: DEMO_T0 + 150_000,
  }),
  strategy({
    id: "sv-eng-1",
    version: 1,
    text: ENGINEER_V1,
    status: "retired",
    reason: "Two handoffs in a row came back because the tests were not run first.",
    decision: { id: "dec-adopt-eng-1", confidence: null, verified: false, stamp: "UNVERIFIED BY JEV" },
    createdAt: DEMO_T0 - 3 * D,
  }),
];

function decision(id: string, decisionId: string, action: string, answers: Record<string, unknown>, confidence: number | null, verified = true): DecisionDTO {
  return { id, runId: "demo", decisionId, answers, action, confidence, verified, stamp: verified ? null : "UNVERIFIED BY JEV", latencyMs: 640, createdAt: DEMO_T0 + 60_000 };
}

/** What is in one cat's head, from the demo crew as the board shows it. */
export function demoMind(agent: AgentDTO, roles: Record<string, RoleDTO>): AgentMindDTO {
  const role = agent.roleId ? roles[agent.roleId] : undefined;
  const base = agent.archetype ?? agent.role;
  const title = role?.title ?? (agent.role === "lead" ? "CEO" : ROLE_LABEL[agent.role]);
  const charterText = role?.charter ?? CHARTER[base] ?? CHARTER.engineer!;
  const engineer = base === "engineer";
  const addenda = engineer ? ENGINEER_HISTORY.filter((v) => v.status === "active") : [];
  const history = engineer ? ENGINEER_HISTORY : [];
  const lessons = engineer
    ? [
        { id: "l-1", text: "Quote CSV fields that contain a comma, a quote, CR or LF, and double embedded quotes.", reason: "It matches the csv.ts task and came out of this project's last review." },
        { id: "l-4", text: "Read a file by line range before editing it; never rewrite a whole file for a small change.", reason: "It is a proven global lesson with 12 wins in 14 uses." },
      ]
    : base === "reviewer"
      ? [{ id: "l-3", text: "Run the tests yourself before passing a review, never trust the summary.", reason: "Every review task picks up the reviewer's top lesson." }]
      : [];
  const skills = engineer ? [{ id: "s-1", name: "Run the report tests", description: "Type check, then run the report suite and summarise failures.", reason: "Its steps match the shell commands the task needs." }] : [];
  const decisions =
    agent.role === "lead"
      ? [decision("dm-lead-1", "orch.route", "Route the serializer to an engineer, no split", { owner: { choice: "engineer" } }, 0.86)]
      : [
          decision(`dm-${agent.id}-hire`, "orch.role", `Hire ${/^[aeiou]/i.test(title) ? "an" : "a"} ${title.toLowerCase()} for the plan`, { archetype: { choice: base } }, 0.72),
          ...(engineer ? [decision("dec-adopt-eng-2", "prompt.adopt", "Merge the quoting rule into the engineer strategy, version 2", { choice: { choice: "merge" } }, 0.81)] : []),
        ];
  return {
    runId: agent.runId,
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    roleTitle: title,
    roleId: agent.roleId ?? null,
    charter: { version: role?.charterVersion ?? (engineer ? 3 : 1), title, dynamic: !!role, text: charterText, tokens: Math.round(charterText.split(/\s+/).length * 1.3) },
    layerVersion: `${role?.key ?? base}.c${role?.charterVersion ?? (engineer ? 3 : 1)}${engineer ? ".s2" : ""}`,
    addenda,
    lessons,
    skills,
    decisions,
    history,
    updatedAt: DEMO_T0 + 160_000,
  };
}

const GITHUB_TOOLS: ConnectorTool[] = [
  { name: "github.search_issues", description: "Search issues and pull requests in a repository.", risk: "read" },
  { name: "github.get_file", description: "Read one file at a ref.", risk: "read" },
  { name: "github.create_issue", description: "Open an issue with a title and body.", risk: "write" },
  { name: "github.merge_pull_request", description: "Merge a pull request into its base branch.", risk: "destructive" },
];
const MARKET_TOOLS: ConnectorTool[] = [
  { name: "market.get_quote", description: "Latest quote for a symbol.", risk: "read" },
  { name: "market.get_bars", description: "Daily or intraday bars for a symbol and range.", risk: "read" },
];
const BROKER_TOOLS: ConnectorTool[] = [
  { name: "broker.get_account", description: "Cash, buying power and open positions.", risk: "read" },
  { name: "broker.place_order", description: "Place a market or limit order.", risk: "sensitive" },
  { name: "broker.cancel_order", description: "Cancel an open order.", risk: "sensitive" },
];

export function createCapabilityState() {
  const connectors: ConnectorDTO[] = [
    { id: "cn-github", kind: "mcp_stdio", label: "GitHub", target: "bunx @modelcontextprotocol/server-github", hasSecret: true, keyHint: "q7Zk", status: "connected", error: null, tools: GITHUB_TOOLS, roles: ["lead", "engineer", "reviewer"], createdAt: DEMO_T0 - 4 * D, updatedAt: DEMO_T0 - 2 * H },
    { id: "cn-market", kind: "http_api", label: "Market data", target: "https://api.marketdata.example/v1", hasSecret: true, keyHint: "M3xa", status: "connected", error: null, tools: MARKET_TOOLS, roles: null, createdAt: DEMO_T0 - 3 * D, updatedAt: DEMO_T0 - D },
    { id: "cn-broker", kind: "http_api", label: "Broker, paper account", target: "https://paper-api.broker.example/v2", hasSecret: true, keyHint: "9fQe", status: "error", error: "401 from the broker: the key was revoked. Add a new one and test again.", tools: BROKER_TOOLS, roles: ["researcher"], createdAt: DEMO_T0 - 2 * D, updatedAt: DEMO_T0 - 5 * H },
  ];
  let trading: TradingSettings = { ...DEFAULT_TRADING };
  const orders: OrderDTO[] = [
    { id: "ord-1", runId: null, agentId: null, symbol: "NVDA", side: "buy", qty: 5, type: "limit", limitPrice: 118.4, mode: "live", status: "proposed", venue: "cn-broker", reason: "Momentum held above the 50 day average for 12 sessions; the backtest kept a 1.4 Sharpe with this entry.", riskNote: "Inside the limits: $592 of a $1,000 order cap, symbol allowed.", fillPrice: null, createdAt: DEMO_T0 - 20 * 60_000, decidedAt: null, filledAt: null },
    { id: "ord-2", runId: null, agentId: null, symbol: "AAPL", side: "buy", qty: 10, type: "market", limitPrice: null, mode: "paper", status: "filled", venue: null, reason: "Paper entry to test the thesis before any live order.", riskNote: "Paper, no limits apply.", fillPrice: 181.92, createdAt: DEMO_T0 - 3 * H, decidedAt: DEMO_T0 - 3 * H, filledAt: DEMO_T0 - 3 * H + 2000 },
    { id: "ord-3", runId: null, agentId: null, symbol: "TSLA", side: "sell", qty: 4, type: "limit", limitPrice: 244, mode: "paper", status: "filled", venue: null, reason: "Closed the paper position once the thesis broke below support.", riskNote: null, fillPrice: 244.1, createdAt: DEMO_T0 - 5 * H, decidedAt: DEMO_T0 - 5 * H, filledAt: DEMO_T0 - 4 * H },
    { id: "ord-4", runId: null, agentId: null, symbol: "COIN", side: "buy", qty: 8, type: "market", limitPrice: null, mode: "live", status: "rejected", venue: "cn-broker", reason: "Breakout on volume.", riskNote: "COIN is not on the allowed symbols list.", fillPrice: null, createdAt: DEMO_T0 - D, decidedAt: DEMO_T0 - D + 60_000, filledAt: null },
  ];
  const positions: PositionDTO[] = [
    { symbol: "AAPL", mode: "paper", qty: 10, avgPrice: 181.92, lastPrice: 186.3, unrealizedUsd: 43.8, realizedUsd: 0 },
    { symbol: "TSLA", mode: "paper", qty: 0, avgPrice: 249.6, lastPrice: 241.8, unrealizedUsd: 0, realizedUsd: -22 },
  ];
  let n = 0;
  return {
    connectors,
    orders,
    positions,
    getTrading: () => trading,
    setTrading: (t: TradingSettings) => (trading = t),
    addConnector(b: CreateConnectorBody): ConnectorDTO {
      n += 1;
      const c: ConnectorDTO = {
        id: `cn-new-${n}`,
        kind: b.kind,
        label: b.label,
        target: b.target,
        hasSecret: !!b.secret,
        keyHint: b.secret ? b.secret.slice(-4) : null,
        status: "connected",
        error: null,
        tools: [],
        roles: b.roles ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      connectors.push(c);
      return c;
    },
    updateConnector(id: string, b: UpdateConnectorBody): ConnectorDTO | null {
      const c = connectors.find((x) => x.id === id);
      if (!c) return null;
      if (b.label) c.label = b.label;
      if (b.target) c.target = b.target;
      if (b.roles !== undefined) c.roles = b.roles;
      if (b.secret) {
        c.hasSecret = true;
        c.keyHint = b.secret.slice(-4);
      }
      if (b.enabled !== undefined) {
        c.status = b.enabled ? (c.error ? "error" : "connected") : "disabled";
      }
      c.updatedAt = Date.now();
      return c;
    },
    /** A test lists sample tools for a new connector: a read tool, and a write tool when it is an HTTP API. */
    testConnector(id: string): ConnectorDTO | null {
      const c = connectors.find((x) => x.id === id);
      if (!c) return null;
      if (c.tools.length === 0) {
        const slug = c.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "tool";
        c.tools = [
          { name: `${slug}.list`, description: "List the records this connector serves (sample tool in the demo).", risk: "read" },
          ...(c.kind === "http_api" ? [{ name: `${slug}.create`, description: "Create a record (sample tool in the demo).", risk: "write" as const }] : []),
        ];
      }
      c.updatedAt = Date.now();
      return c;
    },
    decideOrder(id: string, decision: "approve" | "reject"): OrderDTO | null {
      const o = orders.find((x) => x.id === id);
      if (!o) return null;
      o.status = decision === "approve" ? "approved" : "rejected";
      o.decidedAt = Date.now();
      return o;
    },
  };
}
