// Company templates. MengAI is a general cat company: the same crew engine
// runs a software studio (the default, today's behaviour) or a hedge fund.
// A template names the CEO's title, the specialist roles (dynamic roles on
// the base archetypes, with their charters and tool subsets), the tracker
// stages, the CEO's planning guidance and the capability tools each role is
// granted. Pure data, no I/O.
import { COMPANY_STAGES, type AgentRole, type CompanyKind } from "@mengai/shared";

export interface CompanyRoleTemplate {
  /** role key, unique per project ("risk-manager") */
  key: string;
  title: string;
  archetype: AgentRole;
  /** charter lines under the role header */
  charter: readonly string[];
  /** tools of the archetype this role keeps; finish and note always stay */
  tools: readonly string[];
  /** capability tools (trading) this role is granted on top of its archetype tools */
  grants: readonly string[];
}

export interface CompanyTemplate {
  kind: CompanyKind;
  label: string;
  /** the CEO cat's display title; null keeps the base label */
  leadTitle: string | null;
  stages: readonly string[];
  roles: readonly CompanyRoleTemplate[];
  /** lines added to the CEO's planning task */
  planGuide: readonly string[];
  /** spec of the CEO's final report task; null keeps the engine default */
  finalSpec: string | null;
  /** capability tools the CEO cat is granted */
  leadGrants: readonly string[];
  /** capability tools every other cat is granted */
  crewGrants: readonly string[];
}

/** The one line every fund text carries: MengAI never gives investment advice. */
export const NO_ADVICE =
  "Never give investment advice: describe what the crew tested, traded and measured, never what anyone should buy or sell, and never promise returns.";

export const TRADING_TOOLS = ["get_quote", "propose_order", "review_order", "positions"] as const;
export type TradingTool = (typeof TRADING_TOOLS)[number];

export const STUDIO: CompanyTemplate = {
  kind: "studio",
  label: "Software studio",
  leadTitle: null,
  stages: COMPANY_STAGES.studio,
  roles: [],
  planGuide: [],
  finalSpec: null,
  leadGrants: [],
  crewGrants: [],
};

export const FUND_ROLES: readonly CompanyRoleTemplate[] = [
  {
    key: "quant-researcher",
    title: "Quant researcher",
    archetype: "researcher",
    charter: [
      "Turn the thesis into a rule you can test: entry, exit, position size and the data it needs.",
      "Backtest on the data files the crew collected and write the result with its sample size, hit rate, drawdown and costs.",
      "State what the backtest cannot show (regime changes, slippage, small samples) next to every number.",
      NO_ADVICE,
    ],
    tools: ["finish", "note", "recall", "record_lesson", "web_fetch", "fs_write"],
    grants: ["get_quote"],
  },
  {
    key: "data-engineer",
    title: "Data engineer",
    archetype: "engineer",
    charter: [
      "Collect the price data the thesis needs from the owner's connectors (find_tools first) or the files you are given.",
      "Write clean CSV files with a header, one row per bar, UTC timestamps, and note the source and any gaps.",
      "Check the data before you hand it over: row counts, missing bars, duplicates and outliers.",
    ],
    tools: ["finish", "note", "recall", "record_lesson", "fs_list", "fs_read", "fs_search", "fs_write", "fs_edit"],
    grants: ["get_quote"],
  },
  {
    key: "trader",
    title: "Trader",
    archetype: "engineer",
    charter: [
      "Trade only what the risk review allowed: every order goes through propose_order with a one line reason and the quote you read.",
      "Paper trade first. A live order is a proposal that waits for the risk manager and then the owner; never route an order around the trading gate.",
      "Keep the trade log in the workspace: time, symbol, side, size, quote and why.",
      NO_ADVICE,
    ],
    tools: ["finish", "note", "recall", "record_lesson", "fs_list", "fs_read", "fs_write", "fs_edit"],
    grants: ["get_quote", "propose_order", "positions"],
  },
  {
    key: "risk-manager",
    title: "Risk manager",
    archetype: "reviewer",
    charter: [
      "Review the strategy before any trade: position size, stop, worst case loss and the owner's limits.",
      "Review every proposed order with review_order: approve only when it fits the risk review and the owner's limits, and say why in the note.",
      "Reject an order you cannot size or price; never approve your own order.",
      NO_ADVICE,
    ],
    tools: ["finish", "note", "recall", "record_lesson", "fs_list", "fs_read", "fs_search"],
    grants: ["get_quote", "review_order", "positions"],
  },
  {
    key: "compliance-officer",
    title: "Compliance officer",
    archetype: "security",
    charter: [
      "Read every report and trade log the crew wrote before it reaches the owner.",
      "Flag any sentence that reads as investment advice, a promise of returns or a missing risk statement, with the file and line.",
      "Check that no key, account number or secret is written into the workspace.",
    ],
    tools: ["finish", "note", "recall", "record_lesson", "fs_list", "fs_read", "fs_search", "scan_secrets", "report_issue"],
    grants: ["positions"],
  },
];

export const FUND: CompanyTemplate = {
  kind: "fund",
  label: "Hedge fund",
  leadTitle: "CIO",
  stages: COMPANY_STAGES.fund,
  roles: FUND_ROLES,
  planGuide: [
    "Company: hedge fund. You are the CIO. The tracker runs thesis, data research, backtest, risk review, paper trade, live trade, P&L report.",
    `Specialists (set role_title to the title, role to the archetype): ${FUND_ROLES.map((r) => `${r.title} (${r.archetype})`).join(", ")}.`,
    "Order of work: the thesis and the data first, then the backtest, then the risk manager's strategy review, then paper trades, the risk manager's review of every order, and at most one live order proposal for the owner.",
    "Orders only go through propose_order and the risk manager's review_order; live orders wait for the owner and the owner's trading limits.",
    NO_ADVICE,
  ],
  finalSpec: [
    "Every crew task has ended. Read the results below, then call finish with the P&L report for the owner:",
    "the thesis and what the backtest showed, the paper trades with their fills, realized and unrealized P&L, any live order waiting for the owner, and what failed or is blocked.",
    "Call positions first for the numbers. This is a record of what the crew did, not investment advice; say so in one line.",
  ].join(" "),
  leadGrants: ["positions"],
  crewGrants: [],
};

export const TEMPLATES: Readonly<Record<CompanyKind, CompanyTemplate>> = { studio: STUDIO, fund: FUND };
