// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Evals (/app/evals): the proof that the v2 context policy bills fewer
// input tokens than legacy on the same scenarios. Head as a divided
// section (JEV runner-up, the card primary matched its neighbour), then
// one comparison card (JEV core.comparison.table). History was dropped
// (relevance 1.3), so only the latest pair is shown.
import type { EvalRunDTO } from "@mengai/shared";
import { DataTable, EmptyState, ProductIcon, SkeletonRows } from "@mengai/ui/src/product";
import { useApp } from "../context";
import { fmtAgo, fmtInt, fmtPct } from "../format";
import { useAction, useNow, useResource } from "../hooks";
import { FormStatus, Page, PageHead, Region } from "../ui";

type Metric = { key: string; label: string; get: (e: EvalRunDTO) => string };

const METRICS: Metric[] = [
  { key: "passed", label: "Scenarios passed", get: (e) => `${e.metrics.passed} of ${e.metrics.scenarios}` },
  { key: "billable", label: "Billable input tokens", get: (e) => fmtInt(e.metrics.billableInputTokens) },
  { key: "input", label: "Input tokens", get: (e) => fmtInt(e.metrics.inputTokens) },
  { key: "cached", label: "Cached input tokens", get: (e) => fmtInt(e.metrics.cachedTokens) },
  { key: "output", label: "Output tokens", get: (e) => fmtInt(e.metrics.outputTokens) },
  { key: "calls", label: "Model calls", get: (e) => fmtInt(e.metrics.calls) },
  { key: "max", label: "Largest prompt", get: (e) => `${fmtInt(e.metrics.maxPromptTokens)} tokens` },
];

export function EvalsScreen() {
  const { api } = useApp();
  const now = useNow(60_000);
  const evals = useResource((signal) => api.call("GET /api/evals", { signal }), "evals");
  const run = useAction();
  const list = (evals.data ?? []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const legacy = list.find((e) => e.policy === "legacy") ?? null;
  const v2 = list.find((e) => e.policy === "v2") ?? null;
  const saving = legacy && v2 && legacy.metrics.billableInputTokens > 0 ? 1 - v2.metrics.billableInputTokens / legacy.metrics.billableInputTokens : null;

  return (
    <Page>
      <div className="app-region evals-head" data-container="divided">
        <PageHead
          title="Evals"
          lead="The same scenarios, run with the legacy prompt policy and with v2, on mock models so it costs nothing."
          actions={
            <button type="button" aria-busy={run.busy || undefined} onClick={() =>
                run.run(async () => {
                  await api.call("POST /api/evals/run", { body: {} });
                  evals.setData(await api.call("GET /api/evals"));
                })
              }>
              <ProductIcon name="play" size={20} />
              <span>Run the eval</span>
            </button>
          }
        />
        <FormStatus error={run.error} />
      </div>
      <Region container="card" title="Legacy against v2" className="app-card evals-compare" meta={v2 ? `Latest pair, ${fmtAgo(v2.createdAt, now)}, suite ${v2.suite}` : undefined}>
        {evals.loading && !evals.data ? (
          <SkeletonRows rows={4} label="Loading evals" />
        ) : !legacy || !v2 ? (
          <EmptyState icon="evals" title="No eval yet">
            Run the eval once and both policies land here side by side.
          </EmptyState>
        ) : (
          <>
            <p className="evals-verdict">
              v2 bills <span className="num">{fmtPct(saving ?? 0)}</span> fewer input tokens and passes <span className="num">{v2.metrics.passed}</span> of <span className="num">{v2.metrics.scenarios}</span>, against <span className="num">{legacy.metrics.passed}</span> for legacy.
            </p>
            <DataTable<Metric>
              caption="Legacy and v2 compared"
              rowKey={(m) => m.key}
              rows={METRICS}
              columns={[
                { key: "metric", label: "Metric", cell: (m) => m.label },
                { key: "legacy", label: "Legacy", numeric: true, cell: (m) => m.get(legacy) },
                { key: "v2", label: "v2", numeric: true, cell: (m) => m.get(v2) },
              ]}
            />
          </>
        )}
      </Region>
    </Page>
  );
}
