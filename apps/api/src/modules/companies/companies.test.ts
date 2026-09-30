// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Company templates: the studio stays today's behaviour, the fund names its
// roles on base archetypes with charters that never give advice, maps the
// engine's beats onto COMPANY_STAGES.fund (forward only), rebuilds the stage
// from a board, and grants the trading tools per role.
import { describe, expect, test } from "bun:test";
import { AGENT_ROLES, COMPANY_STAGES, ROLE_TOOLS } from "@mengai/shared";
import { companyKind, createCompaniesModule, FUND, NO_ADVICE, STUDIO, TRADING_TOOLS } from "./index";

const svc = createCompaniesModule().service;
const task = (title: string, roleKey: string, kind = "work") => ({ title, roleKey, archetype: "engineer" as const, kind });

describe("templates", () => {
  test("studio is the default and adds nothing", () => {
    expect(svc.template(undefined)).toBe(STUDIO);
    expect(svc.template(null)).toBe(STUDIO);
    expect(companyKind("bank")).toBe("studio");
    expect(STUDIO).toMatchObject({ leadTitle: null, roles: [], planGuide: [], finalSpec: null });
    expect(svc.mapStage("studio", "review", null)).toBe("review");
    expect(svc.boardStage("studio", [], "running")).toBeNull();
    expect(svc.grantsFor("studio", "engineer", "engineer")).toEqual([]);
  });

  test("the fund: a CIO, five specialists on base archetypes, tool subsets of their archetype, no advice", () => {
    const fund = svc.template("fund");
    expect(fund).toBe(FUND);
    expect(fund.leadTitle).toBe("CIO");
    expect(fund.stages).toEqual(COMPANY_STAGES.fund);
    expect(fund.roles.map((r) => `${r.key}:${r.archetype}`)).toEqual(["quant-researcher:researcher", "data-engineer:engineer", "trader:engineer", "risk-manager:reviewer", "compliance-officer:security"]);
    for (const r of fund.roles) {
      expect(AGENT_ROLES).toContain(r.archetype);
      for (const t of r.tools) expect(ROLE_TOOLS[r.archetype] as readonly string[]).toContain(t);
      expect(r.tools).toContain("finish");
      for (const g of r.grants) expect(TRADING_TOOLS).toContain(g as (typeof TRADING_TOOLS)[number]);
    }
    for (const key of ["trader", "risk-manager", "quant-researcher"]) expect(fund.roles.find((r) => r.key === key)!.charter).toContain(NO_ADVICE);
    expect(fund.planGuide.join("\n")).toContain("Company: hedge fund");
    expect(fund.planGuide).toContain(NO_ADVICE);
    expect(fund.finalSpec).toContain("P&L report");
    expect(fund.finalSpec).toContain("not investment advice");
    const text = [fund.planGuide.join(" "), fund.finalSpec, ...fund.roles.flatMap((r) => r.charter)].join(" ");
    expect(text.includes(String.fromCharCode(0x2014))).toBe(false);
  });

  test("grants: the trader proposes, the risk manager reviews, the CIO reads positions", () => {
    expect(svc.grantsFor("fund", "trader", "engineer")).toEqual(["get_quote", "propose_order", "positions"]);
    expect(svc.grantsFor("fund", "risk-manager", "reviewer")).toEqual(["get_quote", "review_order", "positions"]);
    expect(svc.grantsFor("fund", "anything", "lead")).toEqual(["positions"]);
    expect(svc.grantsFor("fund", "engineer", "engineer")).toEqual([]);
  });
});

describe("fund stages", () => {
  test("engine beats map onto the fund tracker", () => {
    expect(svc.mapStage("fund", "goal", null)).toBe("thesis");
    expect(svc.mapStage("fund", "planned", null)).toBeNull();
    expect(svc.mapStage("fund", "hired", null)).toBeNull();
    expect(svc.mapStage("fund", "review", null)).toBeNull();
    expect(svc.mapStage("fund", "testing", null)).toBeNull();
    expect(svc.mapStage("fund", "shipped", null)).toBe("report");
    const at = (title: string, roleKey: string, kind?: string) => svc.mapStage("fund", "working", task(title, roleKey, kind));
    expect(at("Write the momentum thesis", "quant-researcher")).toBe("thesis");
    expect(at("Collect the price history", "data-engineer")).toBe("research");
    expect(at("Backtest the momentum rule", "quant-researcher")).toBe("backtest");
    expect(at("Risk review of the strategy", "risk-manager")).toBe("risk_review");
    expect(at("Paper trade the signal", "trader")).toBe("paper_trade");
    expect(at("Review the paper orders", "risk-manager")).toBe("paper_trade");
    expect(at("Propose one live order", "trader")).toBe("live_trade");
    expect(at("Compliance check of the reports", "compliance-officer")).toBeNull();
    expect(at("Report to the owner", "lead", "final")).toBe("report");
  });

  test("forward only; the report is final; studio keeps its loop back", () => {
    expect(svc.stageMoves("fund", null, "thesis")).toBe(true);
    expect(svc.stageMoves("fund", "backtest", "research")).toBe(false);
    expect(svc.stageMoves("fund", "backtest", "risk_review")).toBe(true);
    expect(svc.stageMoves("fund", "risk_review", "research", true)).toBe(false);
    expect(svc.stageMoves("fund", "report", "live_trade")).toBe(false);
    expect(svc.stageMoves("fund", "thesis", "goal")).toBe(false);
    expect(svc.stageMoves("studio", "review", "working", true)).toBe(true);
    expect(svc.stageMoves("studio", "shipped", "working", true)).toBe(false);
  });

  test("a board rebuilds the furthest stage it reached", () => {
    const b = (title: string, roleKey: string, status: "done" | "running" | "queued") => ({ ...task(title, roleKey), status });
    expect(svc.boardStage("fund", [], "running")).toBe("thesis");
    expect(svc.boardStage("fund", [b("Collect the price history", "data-engineer", "done"), b("Backtest the rule", "quant-researcher", "running"), b("Paper trade", "trader", "queued")], "paused")).toBe("backtest");
    expect(svc.boardStage("fund", [], "done")).toBe("report");
  });
});
