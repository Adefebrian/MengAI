// Context X-ray (JEV: card, ui.component_recipe core.list 0.79 with layer
// an.R36 0.73): pick a cat, see what fills its prompt. The prompt against
// its budget as one meter, then one row per layer, stable layers first:
// the name and what it holds, its tokens, cached or fresh in words (never
// by color alone), and a bar of its share of the prompt. The bars grow in
// layer by layer when the X-ray opens and tween when the next call lands.
import { ROLE_LABEL, type AgentDTO, type ContextLayer, type ContextXrayDTO } from "@mengai/shared";
import { Meter, ProductIcon, SkeletonRows } from "@mengai/ui/src/product";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import type { RunState } from "../../store/runStore";
import { useApp } from "../context";
import { fmtInt, fmtPct } from "../format";
import { RegionHead, SelectField } from "../ui";
import { errorMessage } from "../../api/client";

const LAYER: Record<ContextLayer, { name: string; what: string }> = {
  charter: { name: "Charter", what: "Who the cat is and the rules it keeps" },
  tools: { name: "Tools", what: "The tool schemas its role may call" },
  brief: { name: "Brief", what: "The run goal and the project brief" },
  memory: { name: "Memory", what: "Lessons recalled for this task" },
  task: { name: "Task", what: "The task spec and its acceptance checks" },
  summary: { name: "Summary", what: "Older steps, compacted" },
  recent: { name: "Recent", what: "The latest steps in full" },
};

type Row = ContextXrayDTO["layers"][number];

export function Xray({ state, runId, agentId, onAgent }: { state: RunState; runId: string; agentId: string | null; onAgent: (id: string) => void }) {
  const { api } = useApp();
  const agents = state.agentOrder.map((id) => state.agents[id]).filter((a): a is AgentDTO => !!a);
  const current = agentId && state.agents[agentId] ? agentId : (agents[0]?.id ?? null);
  const [data, setData] = useState<ContextXrayDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const steps = current ? state.agents[current]?.steps ?? 0 : 0;

  useEffect(() => {
    if (!current) return;
    const ctrl = new AbortController();
    setError(null);
    api.call("GET /api/runs/:id/xray/:agentId", { params: { id: runId, agentId: current }, signal: ctrl.signal }).then(
      (x) => setData(x),
      (err: unknown) => {
        if (!ctrl.signal.aborted) setError(errorMessage(err));
      },
    );
    return () => ctrl.abort();
  }, [api, runId, current, steps]);

  const cat = current ? state.agents[current] : null;
  const shown = data && data.agentId === current ? data : null;
  const cached = shown ? shown.layers.filter((l) => l.cached).reduce((s, l) => s + l.tokens, 0) : 0;

  return (
    <section className="app-region app-card xray" data-container="card" aria-labelledby="xray-h">
      <RegionHead
        title="Context X-ray"
        id="xray-h"
        meta={shown ? `${fmtInt(shown.totalTokens)} tokens of a ${fmtInt(shown.budget)} budget on ${shown.model}` : "What fills a cat's prompt, layer by layer"}
      />
      {agents.length === 0 ? (
        <p className="app-empty-line">Pick a cat to look inside its prompt once the crew has joined.</p>
      ) : (
        <>
          <div className="xray-pick">
            <SelectField label="Cat" value={current ?? ""} onChange={(e) => onAgent(e.target.value)} hint={cat ? `${ROLE_LABEL[cat.role]}, ${cat.steps} steps so far` : undefined}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}, {ROLE_LABEL[a.role]}
                </option>
              ))}
            </SelectField>
          </div>
          {error ? <p className="app-empty-line" role="alert">{error}</p> : null}
          {!shown && !error ? <SkeletonRows rows={3} label="Loading the X-ray" /> : null}
          {shown ? (
            <>
              <div className="xray-bar">
                <Meter
                  label={`${cat?.name ?? "Cat"} prompt of its budget`}
                  value={shown.budget ? shown.totalTokens / shown.budget : 0}
                  valueText={`${fmtInt(shown.totalTokens)} of ${fmtInt(shown.budget)} tokens`}
                  animate
                />
                <p className="xray-legend">
                  <span className="tnum">{fmtInt(cached)}</span> tokens ({fmtPct(shown.totalTokens ? cached / shown.totalTokens : 0)}) are a cached prefix, billed at the cache price. The rest is sent fresh.
                </p>
              </div>
              <ol className="xray-layers" aria-label={`Prompt layers for ${cat?.name ?? "this cat"}`}>
                {shown.layers.map((r: Row, i) => {
                  const share = shown.totalTokens ? r.tokens / shown.totalTokens : 0;
                  const word = r.cached ? "Cached" : r.tokens > 0 ? "Fresh" : "Empty";
                  return (
                    <li className="xray-row" key={r.layer} style={{ ["--i" as string]: String(i) } as CSSProperties}>
                      <span className="xray-layer">
                        <span className="xray-name">{LAYER[r.layer].name}</span>
                        <span className="xray-what">{LAYER[r.layer].what}</span>
                      </span>
                      <span className="xray-figures">
                        <span className="tnum xray-tokens">{fmtInt(r.tokens)}</span>
                        <span className="xray-cache" data-cached={r.cached ? "" : undefined}>
                          <ProductIcon name={r.cached ? "checkCircle" : r.tokens > 0 ? "refresh" : "minusCircle"} size={16} />
                          <span>{word}</span>
                        </span>
                      </span>
                      <span className="xray-track" aria-hidden="true">
                        <span className="xray-fill" data-cached={r.cached ? "" : undefined} style={{ ["--v" as string]: String(share) } as CSSProperties} />
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="xray-foot">
                <span className="num">{fmtInt(shown.compactions)}</span> {shown.compactions === 1 ? "compaction" : "compactions"} so far, <span className="num">{fmtInt(shown.lastCachedTokens)}</span> tokens cached on the last call.
              </p>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
