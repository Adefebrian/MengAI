// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Usage (JEV ui.component_recipe core.table, layer an.R36 0.76): four
// tiles of one shape (tokens of budget, cache hit rate, cost, calls) with
// figures in tabular mono at a modest step, never a giant number, each
// with its meter filling as usage lands, then two full-width tiles: spend
// by model and spend by cat. Rows follow content, so no tile grows a void.
import { ROLE_LABEL, type AgentDTO, type LlmCallDTO } from "@mengai/shared";
import { DataTable, Meter } from "@mengai/ui/src/product";
import type { RunState } from "../../store/runStore";
import { cacheHitRate, tokensUsed } from "../../store/runStore";
import { fmtInt, fmtPct, fmtUsd } from "../format";
import { Figure } from "../ui";
import { spendByAgent, spendByModel, type ModelSpend } from "./derive";

export function Usage({ state, calls }: { state: RunState; calls: LlmCallDTO[] }) {
  const run = state.run;
  if (!run) return null;
  const u = run.usage;
  const used = tokensUsed(u);
  const hit = cacheHitRate(u);
  const byModel = spendByModel(calls);
  const byAgent = spendByAgent(calls);
  const agents = state.agentOrder.map((id) => state.agents[id]).filter((a): a is AgentDTO => !!a);
  const retries = calls.reduce((s, c) => s + c.retries, 0);
  return (
    <section className="app-region usage" data-container="bento" aria-label="Usage">
      <div className="usage-grid">
        <div className="usage-tile">
          <p className="usage-label">Tokens used</p>
          <Figure value={fmtInt(used)} unit={`of ${fmtInt(run.budgetTokens)}`} />
          <Meter label="Tokens of budget" value={run.budgetTokens ? used / run.budgetTokens : 0} valueText={fmtPct(run.budgetTokens ? used / run.budgetTokens : 0)} compact animate />
        </div>
        <div className="usage-tile">
          <p className="usage-label">Cache hit rate</p>
          <Figure value={fmtPct(hit)} />
          <Meter label="Input tokens from the cache" value={hit} valueText={fmtPct(hit)} compact animate />
          <p className="usage-note">
            <span className="num">{fmtInt(u.cachedTokens)}</span> of <span className="num">{fmtInt(u.inputTokens)}</span> input tokens came from the cache
          </p>
        </div>
        <div className="usage-tile">
          <p className="usage-label">Cost</p>
          <Figure value={fmtUsd(u.costUsd)} unit={`of ${fmtUsd(run.budgetUsd)}`} />
          <Meter label="Cost of budget" value={run.budgetUsd ? u.costUsd / run.budgetUsd : 0} valueText={fmtPct(run.budgetUsd ? u.costUsd / run.budgetUsd : 0)} compact animate />
          <p className="usage-note">Billed to your own keys, at your provider's prices</p>
        </div>
        <div className="usage-tile">
          <p className="usage-label">Model calls</p>
          <Figure value={fmtInt(u.calls)} />
          <p className="usage-note">
            <span className="num">{fmtInt(retries)}</span> {retries === 1 ? "retry" : "retries"}, <span className="num">{fmtInt(u.outputTokens)}</span> output tokens
          </p>
        </div>
        <div className="usage-tile" data-wide="">
          <p className="usage-label">By model</p>
          <DataTable<ModelSpend>
            caption="Spend by model"
            rowKey={(r) => r.model}
            rows={byModel}
            empty={<p className="app-empty-line">No model calls yet.</p>}
            columns={[
              { key: "model", label: "Model", cell: (r) => <span className="num">{r.model}</span> },
              { key: "calls", label: "Calls", numeric: true, cell: (r) => fmtInt(r.calls) },
              { key: "in", label: "Input", numeric: true, cell: (r) => fmtInt(r.inputTokens) },
              { key: "cached", label: "Cached", numeric: true, cell: (r) => fmtPct(r.inputTokens ? r.cachedTokens / r.inputTokens : 0) },
              { key: "out", label: "Output", numeric: true, cell: (r) => fmtInt(r.outputTokens) },
              { key: "cost", label: "Cost", numeric: true, cell: (r) => fmtUsd(r.costUsd) },
            ]}
          />
        </div>
        <div className="usage-tile" data-wide="">
          <p className="usage-label">By cat</p>
          <DataTable<AgentDTO>
            caption="Spend by cat"
            rowKey={(a) => a.id}
            rows={agents.filter((a) => byAgent[a.id])}
            empty={<p className="app-empty-line">No cat has called a model yet.</p>}
            columns={[
              { key: "cat", label: "Cat", cell: (a) => `${a.name}, ${ROLE_LABEL[a.role]}` },
              { key: "calls", label: "Calls", numeric: true, cell: (a) => fmtInt(byAgent[a.id]?.calls ?? 0) },
              { key: "tokens", label: "Tokens", numeric: true, cell: (a) => fmtInt((byAgent[a.id]?.inputTokens ?? 0) + (byAgent[a.id]?.outputTokens ?? 0)) },
              {
                key: "cached",
                label: "Cached",
                numeric: true,
                cell: (a) => {
                  const s = byAgent[a.id];
                  return fmtPct(s && s.inputTokens ? s.cachedTokens / s.inputTokens : 0);
                },
              },
              { key: "cost", label: "Cost", numeric: true, cell: (a) => fmtUsd(byAgent[a.id]?.costUsd ?? 0) },
            ]}
          />
        </div>
      </div>
    </section>
  );
}
