// The trading records the trading screen and a fund run share.
// Orders (JEV ui.component_recipe core.list 0.97, with the an.R21 layer at
// 0.64: a new order slides in at the top, a decided one settles in place,
// no spring, opacity only under reduced motion): one row per order, the
// trade as the title (side, quantity, symbol, type), its state as an icon
// plus a word, paper or live, the cat that proposed it, the trader's reason
// and the risk manager's note; a proposed live order carries Approve and
// Reject. Positions (core.table 0.5): a table in tabular figures with the
// P&L signed, never color alone, and the totals under it.
import type { OrderDTO, PositionDTO } from "@mengai/shared";
import { Chip, DataTable, ProductIcon } from "@mengai/ui/src/product";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { errorMessage } from "../../api/client";
import { fmtAgo, fmtPrice, fmtQty, fmtSignedUsd } from "../format";
import { T, useMotionLevel } from "../motion";
import { ORDER_STATUS } from "../status";

export function orderTitle(o: OrderDTO): string {
  const side = o.side === "buy" ? "Buy" : "Sell";
  return `${side} ${fmtQty(o.qty)} ${o.symbol}`;
}

function orderType(o: OrderDTO): string {
  return o.type === "limit" && o.limitPrice !== null ? `limit at ${fmtPrice(o.limitPrice)}` : "at market";
}

/** Orders a person must answer: live and proposed. Paper orders never wait on you. */
export function waitsOnYou(o: OrderDTO): boolean {
  return o.status === "proposed" && o.mode === "live";
}

/** Newest first, the ones waiting on you on top. */
export function sortOrders(list: OrderDTO[]): OrderDTO[] {
  return [...list].sort((a, b) => Number(waitsOnYou(b)) - Number(waitsOnYou(a)) || b.createdAt - a.createdAt);
}

function OrderRow({
  o,
  who,
  now,
  onDecide,
}: {
  o: OrderDTO;
  who: string | null;
  now: number;
  onDecide?: (o: OrderDTO, decision: "approve" | "reject") => Promise<void>;
}) {
  const look = ORDER_STATUS[o.status];
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (d: "approve" | "reject") => {
    if (!onDecide) return;
    setBusy(d);
    setError(null);
    try {
      await onDecide(o, d);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const ask = waitsOnYou(o) && !!onDecide;
  return (
    <div className="p-row order-row" data-type="static" data-waiting={ask ? "" : undefined}>
      <span className="p-row-leading">
        <span className="row-status" data-tone={look.tone}>
          <ProductIcon name={look.icon} size={20} label={look.word} />
        </span>
      </span>
      <span className="p-row-text">
        <span className="p-row-title">
          {orderTitle(o)} <span className="order-type">{orderType(o)}</span>
        </span>
        <span className="p-row-meta">
          <span>{ask ? "Waits on you" : look.word}</span>
          <Chip icon={o.mode === "live" ? "dollar" : "fileText"}>{o.mode === "live" ? "Live" : "Paper"}</Chip>
          {who ? <span>Proposed by {who}</span> : null}
          {o.fillPrice !== null ? (
            <span>
              Filled at <span className="num">{fmtPrice(o.fillPrice)}</span>
            </span>
          ) : null}
          <span>{fmtAgo(o.filledAt ?? o.decidedAt ?? o.createdAt, now)}</span>
        </span>
        {o.reason ? <span className="order-reason">{o.reason}</span> : null}
        {o.riskNote ? <span className="order-risk">Risk check: {o.riskNote}</span> : null}
        {ask ? (
          <span className="order-actions">
            <button type="button" aria-busy={busy === "approve" || undefined} disabled={busy !== null} onClick={() => void decide("approve")}>
              <ProductIcon name="check" size={20} />
              <span>Approve</span>
            </button>
            <button type="button" className="btn-secondary" aria-busy={busy === "reject" || undefined} disabled={busy !== null} onClick={() => void decide("reject")}>
              <ProductIcon name="close" size={20} />
              <span>Reject</span>
            </button>
          </span>
        ) : null}
        {error ? (
          <span className="app-form-status" data-tone="danger" role="alert">
            <ProductIcon name="alertCircle" size={16} />
            <span>{error}</span>
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function OrderList({
  orders,
  nameOf,
  now,
  onDecide,
  label = "Orders",
}: {
  orders: OrderDTO[];
  nameOf: (agentId: string | null) => string | null;
  now: number;
  onDecide?: (o: OrderDTO, decision: "approve" | "reject") => Promise<void>;
  label?: string;
}) {
  const level = useMotionLevel();
  const off = level === "off";
  return (
    <ul className="p-rows order-list" data-variant="boxed" aria-label={label}>
      <AnimatePresence initial={false}>
        {sortOrders(orders).map((o) => (
          <motion.li
            key={o.id}
            className="p-rows-item"
            data-kind="order"
            initial={off ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0, transition: off ? T.reduced : T.base }}
            exit={{ opacity: 0, transition: off ? T.reduced : T.baseExit }}
          >
            <OrderRow o={o} who={nameOf(o.agentId)} now={now} onDecide={onDecide} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function Pnl({ value }: { value: number }) {
  const tone = value > 0.004 ? "success" : value < -0.004 ? "danger" : undefined;
  return (
    <span className="num pnl" data-tone={tone}>
      {fmtSignedUsd(value)}
    </span>
  );
}

export function PositionsTable({ positions }: { positions: PositionDTO[] }) {
  return (
    <DataTable<PositionDTO>
      caption="Positions"
      rowKey={(p) => `${p.mode}:${p.symbol}`}
      rows={positions}
      columns={[
        { key: "symbol", label: "Symbol", cell: (p) => <span className="num">{p.symbol}</span> },
        { key: "mode", label: "Book", cell: (p) => (p.mode === "live" ? "Live" : "Paper") },
        { key: "qty", label: "Quantity", numeric: true, cell: (p) => fmtQty(p.qty) },
        { key: "avg", label: "Average", numeric: true, cell: (p) => fmtPrice(p.avgPrice) },
        { key: "last", label: "Last", numeric: true, cell: (p) => (p.lastPrice !== null ? fmtPrice(p.lastPrice) : "No price") },
        { key: "unrealized", label: "Unrealized", numeric: true, cell: (p) => <Pnl value={p.unrealizedUsd} /> },
        { key: "realized", label: "Realized", numeric: true, cell: (p) => <Pnl value={p.realizedUsd} /> },
      ]}
    />
  );
}

export function positionTotals(positions: PositionDTO[]): { unrealized: number; realized: number } {
  return positions.reduce((t, p) => ({ unrealized: t.unrealized + p.unrealizedUsd, realized: t.realized + p.realizedUsd }), { unrealized: 0, realized: 0 });
}

export function PnlLine({ positions }: { positions: PositionDTO[] }) {
  const t = positionTotals(positions);
  return (
    <p className="pnl-line">
      Unrealized <Pnl value={t.unrealized} />, realized <Pnl value={t.realized} /> across <span className="num">{positions.length}</span>{" "}
      {positions.length === 1 ? "position" : "positions"}
    </p>
  );
}
