// One cat up close (JEV: card, ui.component_recipe core.panel.swap at
// 0.82). The CatCard is the card: the cat on its cushion, who it is, what
// it does, the task and the energy used. Under it, on the page ground: the
// facts, its latest words, the tool call in flight, the one action that
// matters when a cat misbehaves, then what is in its head (Mind). A cat
// that was let go opens here too, with the reason it left.
import { CatCard } from "@mengai/cats";
import { ACTIVITY_LABEL } from "@mengai/shared";
import { KeyValue, ProductIcon, Sheet } from "@mengai/ui/src/product";
import { useState } from "react";
import type { RunState } from "../../store/runStore";
import { fmtDuration, fmtInt, fmtUsd } from "../format";
import { useAction } from "../hooks";
import { isFinished } from "../status";
import { energyOf, type AgentSpend } from "./derive";
import { Mind } from "./Mind";
import { roleTitleOf } from "./office";

export function AgentDetail({
  runId,
  state,
  agentId,
  spend,
  now,
  still,
  onClose,
  onXray,
  onStop,
  onOpenAgent,
  replaying,
}: {
  runId: string;
  state: RunState;
  agentId: string;
  spend: Record<string, AgentSpend>;
  now: number;
  still: boolean;
  onClose?: () => void;
  onXray: (agentId: string) => void;
  onStop: (agentId: string) => Promise<void>;
  onOpenAgent: (agentId: string) => void;
  replaying: boolean;
}) {
  const a = state.agents[agentId];
  const act = useAction();
  const [confirm, setConfirm] = useState(false);
  if (!a) return null;
  const s = spend[a.id];
  const energy = energyOf(s, state.run?.budgetTokens ?? 0);
  const task = a.currentTaskId ? state.tasks[a.currentTaskId] : null;
  const tool = state.tools[a.id];
  const said = state.says[a.id];
  const gone = state.departed[a.id];
  const canStop = !gone && !replaying && !isFinished(state.run?.status) && a.status !== "stopped" && a.status !== "done";
  const title = roleTitleOf(a);
  const since = state.activitySince[a.id] ?? a.updatedAt;

  return (
    <section className="app-region detail" data-container="card" aria-label={`${a.name} details`}>
      {onClose ? (
        <div className="detail-top">
          <button type="button" className="btn-ghost detail-back" onClick={onClose}>
            <ProductIcon name="chevronLeft" size={20} />
            <span>Back to tasks</span>
          </button>
        </div>
      ) : null}
      <CatCard
        look={a.look}
        role={a.role}
        status={a.status}
        activity={a.activity}
        mood={a.mood}
        label={`${a.name}, ${title}, ${gone ? "left the company" : ACTIVITY_LABEL[a.activity].toLowerCase()}`}
        size={160}
        still={still}
        name={a.name}
        statusText={a.statusText}
        taskTitle={task?.title ?? null}
        energy={energy}
        celebrateKey={state.celebrate[a.id]}
      />
      <KeyValue
        label={`${a.name} facts`}
        items={[
          { label: "Role", value: title },
          gone
            ? { label: "Left", value: gone.reason }
            : { label: "Doing", value: `${ACTIVITY_LABEL[a.activity]} for ${fmtDuration(Math.max(0, now - since))}` },
          { label: "Model tier", value: a.tier === "deep" ? "Deep" : a.tier === "fast" ? "Fast" : "Balanced" },
          { label: "Steps", value: fmtInt(a.steps), mono: true },
          { label: "Tokens", value: s ? fmtInt(s.inputTokens + s.outputTokens) : fmtInt(a.usage.inputTokens + a.usage.outputTokens), mono: true },
          { label: "Cost", value: fmtUsd(s?.costUsd ?? a.usage.costUsd), mono: true },
        ]}
      />
      {tool ? (
        <div className="detail-block">
          <p className="detail-label">Tool call in flight</p>
          <pre className="approval-code" tabIndex={0}>
            <code>
              {tool.tool} {tool.argsPreview}
            </code>
          </pre>
        </div>
      ) : null}
      {said ? (
        <div className="detail-block">
          <p className="detail-label">Last said{said.to && state.agents[said.to] ? ` to ${state.agents[said.to]!.name}` : ""}</p>
          <p className="detail-said">{said.text}</p>
        </div>
      ) : null}
      <div className="detail-actions">
        <button type="button" className="btn-secondary" onClick={() => onXray(a.id)}>
          <ProductIcon name="layers" size={20} />
          <span>Open the prompt X-ray</span>
        </button>
        {canStop ? (
          <button type="button" className="btn-secondary app-btn-danger" onClick={() => setConfirm(true)}>
            <ProductIcon name="stop" size={20} />
            <span>Stop {a.name}</span>
          </button>
        ) : null}
      </div>
      {act.error ? (
        <p className="app-form-status" data-tone="danger" role="alert">
          <ProductIcon name="alertCircle" size={16} />
          <span>{act.error}</span>
        </p>
      ) : null}
      <Mind runId={runId} state={state} agent={a} spend={s} now={now} onOpenAgent={onOpenAgent} />
      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        alert
        dismissible={false}
        title={`Stop ${a.name}?`}
        description={`${a.name} puts its paws down now. The rest of the crew keeps working.`}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setConfirm(false)}>
              Keep {a.name}
            </button>
            <button
              type="button"
              className="app-btn-destructive"
              aria-busy={act.busy || undefined}
              onClick={async () => {
                await act.run(() => onStop(a.id));
                setConfirm(false);
              }}
            >
              Stop {a.name}
            </button>
          </>
        }
      >
        <p className="app-body-muted">Only this cat stops. Use Stop in the run header to stop the whole run.</p>
      </Sheet>
    </section>
  );
}
