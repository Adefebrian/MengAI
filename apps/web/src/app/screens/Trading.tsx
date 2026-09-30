// Trading (/app/trading): how far the crew may go with real money, the
// orders it proposed and the book. Regions per JEV ui.region_gate: the
// no-advice note in plain spacing (1.9), orders as rows (2.96), positions
// as rows in a table (2.41), settings in a card (2.96) beside the records
// from 1024px. Recipes (ui.component_recipe): orders core.list with the
// an.R21 slide-in (0.64), positions core.table, the mode as core.segmented,
// allowed symbols as input chips (core.chips 0.82). Motion tier 1 on the
// orders, 0 elsewhere. Every default is the safe one: paper, approval for
// every live order, a 0 USD order cap that blocks live orders, no symbols.
import { DEFAULT_TRADING, type OrderDTO, type PositionDTO, type TradingSettings } from "@mengai/shared";
import { EmptyState, Notice, ProductIcon, SkeletonRows } from "@mengai/ui/src/product";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError } from "../../api/client";
import { useApp } from "../context";
import { fmtInt, fmtSignedUsd } from "../format";
import { useAction, useNow, useResource } from "../hooks";
import { OrderList, PositionsTable, positionTotals, waitsOnYou } from "../parts/Orders";
import { FormStatus, Page, PageHead, Region, Segmented, Switch, TextField } from "../ui";

/** A 404 (or no server) means the trading module is not on this server yet. */
function unavailable(error: string | null, err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 404 || err.status === 501;
  return !!error && /not found|no data for that page/i.test(error);
}

function useCall<T>(load: (signal: AbortSignal) => Promise<T>, key: string) {
  const [err, setErr] = useState<unknown>(null);
  const res = useResource(
    (signal) =>
      load(signal).catch((e: unknown) => {
        setErr(e);
        throw e;
      }),
    key,
  );
  return { ...res, missing: !!res.error && unavailable(res.error, err) };
}

const SYMBOL = /^[A-Z0-9][A-Z0-9.\-/:]{0,19}$/;

function SymbolChips({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const parts = draft
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (parts.length === 0) return;
    const bad = parts.find((p) => !SYMBOL.test(p));
    if (bad) {
      setError(`${bad} is not a symbol. Use letters, digits and . - / : only, like AAPL or BTC-USD.`);
      return;
    }
    setError(null);
    onChange([...new Set([...value, ...parts])]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    }
  };
  return (
    <div className="symbols">
      <div className="symbols-add">
        <TextField
          label="Allowed symbols"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          disabled={disabled}
          placeholder="AAPL, BTC-USD"
          autoCapitalize="characters"
          spellCheck={false}
          error={error}
          hint={value.length ? `${value.length} ${value.length === 1 ? "symbol" : "symbols"} may trade live. Paper trades any symbol.` : "Empty means no symbol may trade live. Paper trades any symbol."}
        />
        <button type="button" className="btn-secondary symbols-add-btn" onClick={add} disabled={disabled || !draft.trim()}>
          <ProductIcon name="plus" size={20} />
          <span>Add</span>
        </button>
      </div>
      {value.length ? (
        <ul className="symbols-list" aria-label="Allowed symbols">
          {value.map((s) => (
            <li key={s}>
              <button type="button" className="btn-secondary symbol-chip" aria-label={`Remove ${s}`} disabled={disabled} onClick={() => onChange(value.filter((x) => x !== s))}>
                <span className="num">{s}</span>
                <ProductIcon name="close" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SettingsCard({ initial, missing, onSaved }: { initial: TradingSettings | null; missing: boolean; onSaved: (s: TradingSettings) => void }) {
  const { api } = useApp();
  const [form, setForm] = useState<TradingSettings>(initial ?? DEFAULT_TRADING);
  const [maxOrder, setMaxOrder] = useState(String((initial ?? DEFAULT_TRADING).maxOrderUsd));
  const [lossLimit, setLossLimit] = useState(String((initial ?? DEFAULT_TRADING).dailyLossLimitUsd));
  const [ok, setOk] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ order?: string; loss?: string }>({});
  const save = useAction();

  useEffect(() => {
    if (!initial) return;
    setForm(initial);
    setMaxOrder(String(initial.maxOrderUsd));
    setLossLimit(String(initial.dailyLossLimitUsd));
  }, [initial]);

  const money = (v: string) => Number(v.replace(/[^0-9.]/g, ""));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOk(null);
    const order = money(maxOrder);
    const loss = money(lossLimit);
    const errors: { order?: string; loss?: string } = {};
    if (!Number.isFinite(order) || order < 0) errors.order = "Use 0 or a positive amount in USD.";
    if (!Number.isFinite(loss) || loss < 0) errors.loss = "Use 0 or a positive amount in USD.";
    setFieldError(errors);
    if (errors.order || errors.loss) return;
    const next: TradingSettings = { ...form, maxOrderUsd: order, dailyLossLimitUsd: loss };
    void save.run(async () => {
      const saved = await api.call("PUT /api/trading/settings", { body: next });
      onSaved(saved);
      setOk(saved.mode === "paper" ? "Saved. The crew trades on paper." : saved.autoTrade ? "Saved. Live orders inside your limits go through without asking." : "Saved. Every live order waits for you.");
    });
  };

  const liveAuto = form.mode === "live" && form.autoTrade;
  return (
    <Region container="card" title="Trading settings" className="app-card trading-settings" meta="Safe by default: paper until you switch to live, and every live order waits for you.">
      {missing ? (
        <p className="app-empty-line">Trading settings are not on this server yet. Until they are, the crew only trades on paper.</p>
      ) : (
        <form className="app-form" onSubmit={submit} noValidate>
          <div className="app-choice-block">
            <Segmented<TradingSettings["mode"]>
              legend="Mode"
              name="trading-mode"
              showLegend
              value={form.mode}
              options={[
                { value: "paper", label: "Paper" },
                { value: "live", label: "Live" },
              ]}
              onChange={(mode) => setForm((f) => ({ ...f, mode }))}
            />
            <p className="field-hint">
              {form.mode === "paper" ? "Paper fills orders at market prices with no real money. The default." : "Live sends orders through your broker connector, inside the limits below."}
            </p>
          </div>
          <Switch
            label="Auto-trade live orders"
            description={form.autoTrade ? "On. Live orders inside the limits below go through without asking you." : "Off. Every live order waits for your Approve. The default."}
            checked={form.autoTrade}
            onChange={(autoTrade) => setForm((f) => ({ ...f, autoTrade }))}
          />
          <div className="field-row">
            <TextField
              label="Max order in USD"
              inputMode="decimal"
              value={maxOrder}
              onChange={(e) => setMaxOrder(e.target.value)}
              error={fieldError.order}
              hint={money(maxOrder) > 0 ? `No live order above $${fmtInt(money(maxOrder))}.` : "0 blocks every live order."}
            />
            <TextField
              label="Daily loss limit in USD"
              inputMode="decimal"
              value={lossLimit}
              onChange={(e) => setLossLimit(e.target.value)}
              error={fieldError.loss}
              hint={money(lossLimit) > 0 ? `Live trading stops for the day past a $${fmtInt(money(lossLimit))} loss.` : "0 stops live trading at the first loss."}
            />
          </div>
          <SymbolChips value={form.allowedSymbols} onChange={(allowedSymbols) => setForm((f) => ({ ...f, allowedSymbols }))} />
          {liveAuto ? (
            <Notice tone="warning" title="Live auto-trade is on">
              Orders inside your limits spend real money without asking you. Stop all in the header halts every run at once.
            </Notice>
          ) : null}
          <div className="app-form-actions">
            <button type="submit" aria-busy={save.busy || undefined}>
              Save trading settings
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setForm(DEFAULT_TRADING);
                setMaxOrder(String(DEFAULT_TRADING.maxOrderUsd));
                setLossLimit(String(DEFAULT_TRADING.dailyLossLimitUsd));
                setOk(null);
              }}
            >
              Back to the safe defaults
            </button>
          </div>
          <FormStatus ok={ok} error={save.error} />
        </form>
      )}
    </Region>
  );
}

export function TradingScreen() {
  const { api } = useApp();
  const now = useNow(30_000);
  const settings = useCall((signal) => api.call("GET /api/trading/settings", { signal }), "trading-settings");
  const orders = useCall((signal) => api.call("GET /api/trading/orders", { signal }), "trading-orders");
  const positions = useCall((signal) => api.call("GET /api/trading/positions", { signal }), "trading-positions");
  const runs = useResource((signal) => api.call("GET /api/runs", { signal }), "runs");

  const list: OrderDTO[] = orders.data ?? [];
  const book: PositionDTO[] = positions.data ?? [];
  const waiting = list.filter(waitsOnYou).length;
  const t = positionTotals(book);
  const fundRuns = (runs.data ?? []).filter((r) => r.company === "fund").length;

  const decide = async (o: OrderDTO, decision: "approve" | "reject") => {
    const next = await api.call("POST /api/trading/orders/:id/decision", { params: { id: o.id }, body: { decision } });
    orders.setData((prev) => (prev ?? []).map((x) => (x.id === next.id ? next : x)));
  };

  return (
    <Page>
      <PageHead title="Trading" lead="What a hedge fund crew may do with money: the orders it proposed, the book it holds, and the limits it trades inside." />

      <section className="app-region trading-advice" data-container="plain" aria-label="No investment advice">
        <Notice tone="info" title="MengAI gives no investment advice">
          The cats research, backtest and propose trades from your own data and keys. Every decision and every loss is yours, so start on paper and keep the limits tight.
        </Notice>
      </section>

      <div className="app-split trading-split">
        <div className="app-split-main">
          <Region
            container="rows"
            title="Orders"
            className="trading-orders"
            meta={orders.data ? (waiting ? `${waiting} live ${waiting === 1 ? "order waits" : "orders wait"} on you, ${list.length} in all` : `${list.length} ${list.length === 1 ? "order" : "orders"}, nothing waits on you`) : undefined}
          >
            {orders.loading && !orders.data ? (
              <SkeletonRows rows={3} label="Loading orders" />
            ) : orders.missing ? (
              <EmptyState icon="dollar" title="The order feed is not on this server yet">
                Once the trading desk is on, every order a trader cat proposes shows up here with its reason and the risk check.
              </EmptyState>
            ) : orders.error ? (
              <EmptyState icon="alertCircle" tone="danger" title="Orders did not load" action={<button type="button" onClick={orders.reload}>Try again</button>}>
                {orders.error}
              </EmptyState>
            ) : list.length === 0 ? (
              <EmptyState icon="dollar" title="No orders yet">
                {fundRuns ? "Your hedge fund runs have not proposed an order yet." : "Start a run as a hedge fund in New run and its trader cat proposes orders here."}
              </EmptyState>
            ) : (
              <OrderList orders={list} nameOf={() => null} now={now} onDecide={decide} />
            )}
          </Region>

          <Region
            container="rows"
            title="Positions"
            className="trading-positions"
            meta={positions.data && book.length ? `Unrealized ${fmtSignedUsd(t.unrealized)}, realized ${fmtSignedUsd(t.realized)}` : undefined}
          >
            {positions.loading && !positions.data ? (
              <SkeletonRows rows={2} label="Loading positions" />
            ) : positions.missing ? (
              <p className="app-empty-line">Positions show here once the trading desk is on this server.</p>
            ) : positions.error ? (
              <EmptyState icon="alertCircle" tone="danger" title="Positions did not load" action={<button type="button" onClick={positions.reload}>Try again</button>}>
                {positions.error}
              </EmptyState>
            ) : book.length === 0 ? (
              <p className="app-empty-line">No positions. Paper fills land here first.</p>
            ) : (
              <PositionsTable positions={book} />
            )}
          </Region>
        </div>
        <div className="app-split-side">
          {settings.loading && !settings.data ? (
            <Region container="card" title="Trading settings" className="app-card trading-settings">
              <SkeletonRows rows={3} label="Loading trading settings" />
            </Region>
          ) : settings.error && !settings.missing ? (
            <Region container="card" title="Trading settings" className="app-card trading-settings">
              <EmptyState icon="alertCircle" tone="danger" title="Trading settings did not load" action={<button type="button" onClick={settings.reload}>Try again</button>}>
                {settings.error} Until they load, the crew keeps to paper trading.
              </EmptyState>
            </Region>
          ) : (
            <SettingsCard initial={settings.data} missing={settings.missing} onSaved={(s) => settings.setData(s)} />
          )}
        </div>
      </div>
    </Page>
  );
}
