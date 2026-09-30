// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The trading desk of a hedge fund run (JEV ui.region_gate rows,
// relevance 2.85; ui.component_recipe core.list 0.58; motion tier 1): the
// orders this run's crew proposed, decided or filled, with Approve and
// Reject on a live order that waits on you, then the book. First paint
// reads GET /api/trading/orders (filtered to this run) and the positions;
// trade.order and trade.positions events keep both live, and the replay
// folds them from the log. A server without trading shows a plain line.
import type { OrderDTO, PositionDTO } from "@mengai/shared";
import { SkeletonRows } from "@mengai/ui/src/product";
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { Link } from "../../router";
import type { RunState } from "../../store/runStore";
import { useApp } from "../context";
import { fmtSignedUsd } from "../format";
import { OrderList, PnlLine, PositionsTable, positionTotals, waitsOnYou } from "../parts/Orders";
import { RegionHead } from "../ui";
import { clockOf } from "./office";

type Load = { kind: "loading" } | { kind: "ready"; orders: OrderDTO[]; positions: PositionDTO[] } | { kind: "missing" };

function missing(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501 || err.isNetwork);
}

export function FundPanel({ state, runId, replaying }: { state: RunState; runId: string; replaying: boolean }) {
  const { api } = useApp();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [decided, setDecided] = useState<Record<string, OrderDTO>>({});

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.allSettled([
      api.call("GET /api/trading/orders", { signal: ctrl.signal }),
      api.call("GET /api/trading/positions", { signal: ctrl.signal }),
    ]).then(([o, p]) => {
      if (ctrl.signal.aborted) return;
      if (o.status === "rejected" && missing(o.reason)) {
        setLoad({ kind: "missing" });
        return;
      }
      setLoad({
        kind: "ready",
        orders: o.status === "fulfilled" ? o.value.filter((x) => x.runId === runId) : [],
        positions: p.status === "fulfilled" ? p.value : [],
      });
    });
    return () => ctrl.abort();
  }, [api, runId]);

  const orders = useMemo(() => {
    const byId: Record<string, OrderDTO> = {};
    if (load.kind === "ready" && !replaying) for (const o of load.orders) byId[o.id] = o;
    for (const id of state.orderOrder) if (state.orders[id]) byId[id] = state.orders[id]!;
    if (!replaying) for (const o of Object.values(decided)) if (byId[o.id]) byId[o.id] = { ...byId[o.id]!, ...o };
    return Object.values(byId);
  }, [load, state.orders, state.orderOrder, decided, replaying]);
  const positions = state.positions ?? (load.kind === "ready" && !replaying ? load.positions : []);
  const waiting = orders.filter(waitsOnYou).length;
  const t = positionTotals(positions);
  const nameOf = (id: string | null) => (id ? (state.agents[id]?.name ?? null) : null);

  const meta =
    load.kind === "missing" && orders.length === 0
      ? "This server does not run a trading desk yet, so the run shows no orders."
      : `${positions.length} ${positions.length === 1 ? "position" : "positions"}${positions.length ? `, unrealized ${fmtSignedUsd(t.unrealized)}` : ""}; ${waiting ? `${waiting} live ${waiting === 1 ? "order waits" : "orders wait"} on you` : "nothing waits on you"}.`;

  return (
    <section className="app-region fund-panel" data-container="rows" aria-labelledby="fund-h">
      <RegionHead
        title="Trading desk"
        id="fund-h"
        meta={meta}
        actions={
          <Link className="btn btn-secondary" href="/app/trading">
            Trading settings
          </Link>
        }
      />
      <p className="fund-advice">MengAI gives no investment advice. The cats propose, you decide, and every live order stays inside your limits.</p>
      {load.kind === "loading" && orders.length === 0 ? (
        <SkeletonRows rows={2} label="Loading the trading desk" />
      ) : load.kind === "missing" && orders.length === 0 ? null : (
        <div className="fund-body">
          <div className="fund-part">
            <h3 className="app-h3">Orders</h3>
            {orders.length === 0 ? (
              <p className="app-empty-line">No orders yet. The trader cat proposes them after the backtest and the risk review.</p>
            ) : (
              <OrderList
                orders={orders}
                nameOf={nameOf}
                now={clockOf(state)}
                label="Orders of this run"
                onDecide={
                  replaying
                    ? undefined
                    : async (o, decision) => {
                        const next = await api.call("POST /api/trading/orders/:id/decision", { params: { id: o.id }, body: { decision } });
                        setDecided((d) => ({ ...d, [next.id]: next }));
                      }
                }
              />
            )}
          </div>
          <div className="fund-part">
            <h3 className="app-h3">Book</h3>
            {positions.length === 0 ? (
              <p className="app-empty-line">No positions yet. Paper fills land here first.</p>
            ) : (
              <>
                <PositionsTable positions={positions} />
                <PnlLine positions={positions} />
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
