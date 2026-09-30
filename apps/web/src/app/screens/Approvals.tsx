// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Approvals (/app/approvals): what waits on the owner right now, and what
// was decided before. The engine's approval path in this build is the live
// order: a trader cat proposes it, the risk manager reviews it, and it
// waits here for Approve or Reject (paper orders never wait on you). A cat
// that asks for something inside a run asks on that run's page, so those
// asks are rows that open the run. Local computer control is not part of
// this build, so there are no standing capability rules to set here.
// Regions per JEV ui.region_gate: head plain, pending divided (each
// request an actionable row), decided divided.
import type { AgentDTO, ApprovalDTO, OrderDTO, RunDTO } from "@mengai/shared";
import { DataRow, DataRows, EmptyState, ProductIcon, SkeletonRows } from "@mengai/ui/src/product";
import { ApiError } from "../../api/client";
import { useApp } from "../context";
import { fmtAgo } from "../format";
import { useNow, useResource } from "../hooks";
import { OrderList, waitsOnYou } from "../parts/Orders";
import { isFinished } from "../status";
import { Page, PageHead, Region } from "../ui";

interface RunAsk {
  run: RunDTO;
  approval: ApprovalDTO;
  who: AgentDTO | null;
}

/** A 404 means the trading desk is not on this engine: nothing waits there. */
function orEmpty<T>(err: unknown): T[] {
  if (err instanceof ApiError && err.status === 404) return [];
  throw err;
}

export function ApprovalsScreen() {
  const { api, refreshApprovals } = useApp();
  const now = useNow(30_000);
  const orders = useResource((signal) => api.call("GET /api/trading/orders", { signal }).catch((err: unknown) => orEmpty<OrderDTO>(err)), "orders");
  const asks = useResource(async (signal): Promise<RunAsk[]> => {
    const runs = await api.call("GET /api/runs", { signal });
    const live = runs.filter((r) => !isFinished(r.status)).slice(0, 10);
    const snaps = await Promise.all(live.map((r) => api.call("GET /api/runs/:id", { params: { id: r.id }, signal }).catch(() => null)));
    return snaps.flatMap((s) =>
      s ? s.approvals.filter((a) => a.status === "pending").map((a) => ({ run: s.run, approval: a, who: s.agents.find((x) => x.id === a.agentId) ?? null })) : [],
    );
  }, "asks");

  const all = orders.data ?? [];
  const pending = all.filter(waitsOnYou);
  const decided = all
    .filter((o) => o.mode === "live" && o.status !== "proposed")
    .sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt));
  const runAsks = asks.data ?? [];
  const waiting = pending.length + runAsks.length;
  const loaded = !!orders.data && !!asks.data;

  const decide = async (o: OrderDTO, decision: "approve" | "reject") => {
    const next = await api.call("POST /api/trading/orders/:id/decision", { params: { id: o.id }, body: { decision } });
    orders.setData((prev) => (prev ?? []).map((x) => (x.id === next.id ? next : x)));
    refreshApprovals();
  };

  const error = orders.error ?? asks.error;
  return (
    <Page>
      <PageHead
        title="Approvals"
        lead={
          loaded
            ? waiting
              ? `${waiting} ${waiting === 1 ? "request waits" : "requests wait"} on you. A live order never goes out without your yes.`
              : "Nothing waits on you. Every cat has what it needs."
            : "What the crew asks you before it does anything that spends real money."
        }
      />

      <Region container="divided" title="Waiting on you" meta={waiting ? undefined : "A live order the crew proposes lands here, and a cat that asks inside a run asks on the run."}>
        {error && !loaded ? (
          <EmptyState
            icon="alertCircle"
            tone="danger"
            title="Approvals did not load"
            action={
              <button
                type="button"
                onClick={() => {
                  orders.reload();
                  asks.reload();
                }}
              >
                Try again
              </button>
            }
          >
            {error}
          </EmptyState>
        ) : !loaded ? (
          <SkeletonRows rows={2} label="Loading approvals" />
        ) : waiting === 0 ? (
          <p className="app-empty-line">All quiet. No paw is raised.</p>
        ) : (
          <div className="pending-list">
            {runAsks.length ? (
              <DataRows label="Asks inside a run">
                {runAsks.map(({ run, approval, who }) => (
                  <DataRow
                    key={approval.id}
                    href={`/app/runs/${encodeURIComponent(run.id)}`}
                    leading={
                      <span className="row-status" data-tone="warning">
                        <ProductIcon name="alertTriangle" size={20} label="Needs you" />
                      </span>
                    }
                    title={approval.title}
                    titleAttr={approval.title}
                    meta={
                      <>
                        <span>{who ? `${who.name} asks` : "A cat asks"}</span>
                        <span title={run.goal}>{run.goal}</span>
                        <span>{fmtAgo(approval.createdAt, now)}</span>
                      </>
                    }
                    trailing={<ProductIcon name="chevronRight" size={20} />}
                  />
                ))}
              </DataRows>
            ) : null}
            {pending.length ? <OrderList orders={pending} nameOf={() => null} now={now} onDecide={decide} label="Live orders waiting on you" /> : null}
          </div>
        )}
      </Region>

      <Region container="divided" title="Decided" meta={decided.length ? `${decided.length} earlier live ${decided.length === 1 ? "order" : "orders"}` : undefined}>
        {decided.length === 0 ? <p className="app-empty-line">No decisions yet.</p> : <OrderList orders={decided} nameOf={() => null} now={now} label="Decided live orders" />}
      </Region>
    </Page>
  );
}
