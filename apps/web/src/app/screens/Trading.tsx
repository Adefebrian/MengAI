// Trading (/app/trading): the exchanges and brokers the crew trades
// through, how far it may go with money, the orders it proposed and the
// book. Regions per JEV ui.region_gate: the no-advice note in plain spacing
// (1.9), venues as rows (2.96, rows 0.48, the primary kept since the
// wizard beside it is a card), orders as rows (2.96), positions as rows in
// a table (2.41); the connection wizard in a card (2.97, card 0.95) and the
// settings in a card (2.96) in the side column beside the records from
// 1024px, so each column flows on its own with no hole between regions.
// Recipes (ui.component_recipe): orders core.list with the an.R21 slide-in
// (0.64), positions core.table, the mode as core.segmented, allowed symbols
// as input chips (core.chips 0.82), the venue presets as a radio group like
// the connector kind. Motion tier 1 on the orders, 0 elsewhere.
//
// A connected venue is learned by the crew: its tools become shared skills
// that every cat uses at once. Paper executes on its own; live executes on
// its own only with auto-trade on and all three hard limits set, otherwise
// each live order waits for the owner. Every default is the safe one.
// Secrets typed into the wizard go once to the runtime on this machine (its
// keychain) and are cleared from the page as the request leaves.
import {
  DEFAULT_TRADING,
  TRADING_VENUE_PRESETS,
  type CreateTradingVenueBody,
  type OrderDTO,
  type PositionDTO,
  type TradingSettings,
  type TradingVenueDTO,
  type TradingVenuePreset,
} from "@mengai/shared";
import { EmptyState, Notice, ProductIcon, Sheet, SkeletonRows, StatusPill } from "@mengai/ui/src/product";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError } from "../../api/client";
import { useApp } from "../context";
import { fmtAgo, fmtInt, fmtSignedUsd } from "../format";
import { useAction, useNow, useResource } from "../hooks";
import { OrderList, PositionsTable, positionTotals, waitsOnYou } from "../parts/Orders";
import { VENUE_STATUS } from "../status";
import { FormStatus, Page, PageHead, RadioGroup, Region, Segmented, Switch, TextField } from "../ui";

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


// ------------------------------------------------------------------ venues
/** What each preset is for, in one line. */
const PRESET_LINE: Record<string, string> = {
  "ccxt-mcp": "Most crypto exchanges through one MCP server that runs on your machine.",
  "alpaca-mcp": "US stocks, ETFs and crypto, with a free paper account to start on.",
  "custom-mcp": "Any exchange or broker MCP server, started with a command on your machine.",
  "custom-http": "Any REST API; its OpenAPI document turns each endpoint into a tool.",
};

const KIND_LINE: Record<TradingVenuePreset["kind"], string> = {
  crypto: "Crypto exchange",
  broker: "Broker",
  dex: "Decentralized exchange",
  custom: "Your own server",
};

function presetOf(id: string): TradingVenuePreset | undefined {
  return TRADING_VENUE_PRESETS.find((p) => p.id === id);
}

function presetWord(id: string): string {
  const p = presetOf(id);
  return p ? p.label.replace(/\s*\(.*\)$/, "") : "Venue";
}

function modeWord(v: Pick<TradingVenueDTO, "mode" | "testnet">): string {
  if (v.mode === "paper") return v.testnet ? "Paper on the testnet" : "Paper";
  return v.testnet ? "Live on the testnet" : "Live, real money";
}

function isHttp(p: TradingVenuePreset): boolean {
  return p.connector !== "mcp_stdio";
}

/** A preset field is masked unless the preset marks it a plain setting (secret: false, an exchange id). */
export function isSecretField(f: { secret?: boolean }): boolean {
  return f.secret !== false;
}

function VenueRow({ v, now, onChange, onRemove }: { v: TradingVenueDTO; now: number; onChange: (next: TradingVenueDTO) => void; onRemove: (v: TradingVenueDTO) => void }) {
  const { api } = useApp();
  const look = VENUE_STATUS[v.status];
  const learn = useAction();
  const toggle = useAction();
  const enabled = v.status !== "disabled";
  const skills = v.learnedSkills;
  const skillsId = useId();
  return (
    <li className="p-rows-item" data-kind="venue">
      <div className="p-row venue-row" data-type="static">
        <span className="p-row-leading">
          <span className="connector-icon">
            <ProductIcon name={isHttp(presetOf(v.preset) ?? TRADING_VENUE_PRESETS[0]!) ? "code" : "cpu"} size={20} />
          </span>
        </span>
        <span className="p-row-text">
          <span className="p-row-title">{v.label}</span>
          <span className="p-row-meta">
            <StatusPill tone={look.tone} icon={look.icon}>
              {look.word}
            </StatusPill>
            <span>{presetWord(v.preset)}</span>
            <span>{modeWord(v)}</span>
            <span>Changed {fmtAgo(v.updatedAt, now)}</span>
          </span>
          <span className="venue-state" aria-live="polite">
            {v.status === "learning"
              ? "The crew is reading its tools and trying them on paper. Every cat gets what it learns the moment it lands."
              : v.status === "ready"
                ? v.mode === "paper"
                  ? "Ready. The crew trades here on its own, on paper."
                  : "Ready. Live orders run on their own only inside your auto-trade limits; every other one waits for you."
                : v.status === "connected"
                  ? "Connected. Press Learn and the crew learns how to use it."
                  : v.status === "disabled"
                    ? "Off. No cat can reach it until you turn it back on."
                    : null}
          </span>
          {v.status === "error" && v.error ? (
            <span className="app-form-status" data-tone="danger">
              <ProductIcon name="alertCircle" size={16} />
              <span>{v.error}</span>
            </span>
          ) : null}
          <span className="venue-skills">
            <span className="venue-skills-head" id={skillsId}>
              {skills.length ? `${skills.length} learned ${skills.length === 1 ? "skill" : "skills"}, shared by every cat` : "No learned skills yet"}
            </span>
            {skills.length ? (
              <ul className="venue-skill-list" aria-labelledby={skillsId}>
                {skills.map((k) => (
                  <li className="venue-skill" key={k.id}>
                    <span className="venue-skill-name">{k.name}</span>
                    <span className="venue-skill-use num">
                      {k.uses ? `${fmtInt(k.uses)} ${k.uses === 1 ? "use" : "uses"}, ${fmtInt(k.wins)} ${k.wins === 1 ? "win" : "wins"}` : "New"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </span>
          <span className="connector-actions">
            <Switch
              label="Enabled"
              checked={enabled}
              disabled={toggle.busy}
              onChange={(on) =>
                void toggle.run(async () => {
                  onChange(await api.call("PATCH /api/trading/venues/:id", { params: { id: v.id }, body: { enabled: on } }));
                })
              }
            />
            <button
              type="button"
              className="btn-secondary"
              aria-busy={learn.busy || undefined}
              disabled={!enabled || v.status === "learning"}
              onClick={() =>
                void learn.run(async () => {
                  onChange(await api.call("POST /api/trading/venues/:id/learn", { params: { id: v.id } }));
                })
              }
            >
              <ProductIcon name="refresh" size={20} />
              <span>{skills.length ? "Learn again" : "Learn"}</span>
            </button>
            <button type="button" className="btn-ghost connector-remove" onClick={() => onRemove(v)}>
              <ProductIcon name="trash" size={20} />
              <span>Remove</span>
            </button>
          </span>
          {learn.error || toggle.error ? (
            <span className="app-form-status" data-tone="danger" role="alert">
              <ProductIcon name="alertCircle" size={16} />
              <span>{learn.error ?? toggle.error}</span>
            </span>
          ) : null}
        </span>
      </div>
    </li>
  );
}

type Step = 1 | 2 | 3 | "done";
const STEP_TITLE: Record<Exclude<Step, "done">, string> = { 1: "Pick the venue", 2: "Connect it", 3: "Paper or live" };

function ConnectVenue({ latest, onAdded }: { latest: (id: string) => TradingVenueDTO | null; onAdded: (v: TradingVenueDTO) => void }) {
  const { api } = useApp();
  const [step, setStep] = useState<Step>(1);
  const [presetId, setPresetId] = useState(TRADING_VENUE_PRESETS[0]!.id);
  const preset = presetOf(presetId) ?? TRADING_VENUE_PRESETS[0]!;
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState(preset.target);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const [testnet, setTestnet] = useState(preset.supportsTestnet);
  const [errors, setErrors] = useState<{ target?: string }>({});
  const [createdId, setCreatedId] = useState<string | null>(null);
  const add = useAction();
  const headRef = useRef<HTMLHeadingElement | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (moved.current) headRef.current?.focus();
  }, [step]);

  const go = (next: Step) => {
    moved.current = true;
    setStep(next);
  };

  const pick = (id: string) => {
    const p = presetOf(id);
    if (!p) return;
    setPresetId(id);
    setTarget(p.target);
    setSecrets({});
    setTestnet(p.supportsTestnet);
    if (!p.supportsPaper) setMode("live");
    setErrors({});
  };

  const checkTarget = (): boolean => {
    const t = target.trim();
    let err: string | undefined;
    if (!t || t === "https://") err = isHttp(preset) ? "Give the base URL of the API." : "Give the command that starts the MCP server.";
    else if (isHttp(preset) && !/^https:\/\/\S+$/i.test(t) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/\S*)?$/i.test(t)) err = "Use a full URL that starts with https://.";
    setErrors({ target: err });
    return !err;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (step !== 3) return;
    const sent: Record<string, string> = {};
    for (const s of preset.secrets) {
      const v = secrets[s.key]?.trim();
      if (v) sent[s.key] = v;
    }
    const body: CreateTradingVenueBody = {
      preset: preset.id,
      target: target.trim(),
      mode,
      ...(label.trim() ? { label: label.trim() } : {}),
      ...(Object.keys(sent).length ? { secrets: sent } : {}),
      ...(preset.supportsTestnet ? { testnet } : {}),
    };
    // the secrets leave the page with this request; the fields never keep them
    setSecrets({});
    void add.run(async () => {
      const created = await api.call("POST /api/trading/venues", { body });
      onAdded(created);
      let next = created;
      if (created.status === "connected") {
        try {
          next = await api.call("POST /api/trading/venues/:id/learn", { params: { id: created.id } });
          onAdded(next);
        } catch {
          // the row keeps its own Learn button
        }
      }
      setCreatedId(next.id);
      go("done");
    });
  };

  const reset = () => {
    pick(TRADING_VENUE_PRESETS[0]!.id);
    setLabel("");
    setMode("paper");
    setCreatedId(null);
    add.setError(null);
    go(1);
  };

  const made = createdId ? latest(createdId) : null;
  const title = step === "done" ? "Venue connected" : STEP_TITLE[step];
  const meta =
    step === "done"
      ? made?.status === "ready"
        ? "Every cat can use it now."
        : made?.status === "error"
          ? "It needs another look."
          : "The crew is learning it now."
      : `Step ${step} of 3. Keys go to the keychain on this machine and never come back to the page.`;

  return (
    <Region container="card" title="Connect a venue" className="app-card venue-add" meta="An exchange or a broker, as an MCP server or an API.">
      <form className="app-form venue-form" onSubmit={submit} noValidate>
        <div className="venue-step-head">
          <h3 className="app-h3" ref={headRef} tabIndex={-1}>
            {title}
          </h3>
          <p className="app-region-meta">{meta}</p>
        </div>

        {step === 1 ? (
          <>
            <RadioGroup<string>
              legend="Exchange or broker"
              name="venue-preset"
              value={presetId}
              onChange={pick}
              options={TRADING_VENUE_PRESETS.map((p) => ({ value: p.id, label: p.label, description: `${KIND_LINE[p.kind]}. ${PRESET_LINE[p.id] ?? (isHttp(p) ? "An HTTP API." : "An MCP server on your machine.")}` }))}
            />
            <div className="app-form-actions">
              <button type="button" onClick={() => go(2)}>
                <span>Next</span>
                <ProductIcon name="chevronRight" size={20} />
              </button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <TextField
              label={isHttp(preset) ? "Base URL" : "Command"}
              className="num"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={isHttp(preset) ? "https://api.example.com/v1" : "npx -y your-exchange-mcp"}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              error={errors.target}
              hint={isHttp(preset) ? "Every call the crew makes starts here. Check it before you connect." : "Runs on your machine with the keys below in its environment. Check it before you connect."}
            />
            <TextField label="Name" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder={presetWord(preset.id)} hint="Optional. Shown to the crew beside each tool." />
            {preset.secrets.map((sec) =>
              isSecretField(sec) ? (
                <TextField
                  key={sec.key}
                  label={sec.label}
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  autoCapitalize="off"
                  value={secrets[sec.key] ?? ""}
                  onChange={(e) => setSecrets((cur) => ({ ...cur, [sec.key]: e.target.value }))}
                  hint={`Goes to the keychain on this machine as ${sec.key}, never shown again. Leave it empty if the venue needs none.`}
                />
              ) : (
                <TextField
                  key={sec.key}
                  label={sec.label}
                  className="num"
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  value={secrets[sec.key] ?? ""}
                  onChange={(e) => setSecrets((cur) => ({ ...cur, [sec.key]: e.target.value }))}
                  hint={`Given to the server as ${sec.key}, kept in the keychain with the keys.`}
                />
              ),
            )}
            <p className="app-region-meta venue-docs">
              Where to get the keys: <a href={preset.docsUrl} target="_blank" rel="noreferrer">{presetWord(preset.id)} setup notes</a>
            </p>
            <div className="app-form-actions">
              <button type="button" className="btn-secondary" onClick={() => go(1)}>
                <ProductIcon name="chevronLeft" size={20} />
                <span>Back</span>
              </button>
              <button type="button" onClick={() => checkTarget() && go(3)}>
                <span>Next</span>
                <ProductIcon name="chevronRight" size={20} />
              </button>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div className="app-choice-block">
              <Segmented<"paper" | "live">
                legend="Connection mode"
                name="venue-mode"
                showLegend
                value={mode}
                options={[...(preset.supportsPaper ? [{ value: "paper" as const, label: "Paper" }] : []), { value: "live", label: "Live" }]}
                onChange={setMode}
              />
              <p className="field-hint">
                {mode === "paper"
                  ? "Paper runs on its own: the crew places orders with no real money and learns from every fill."
                  : "Live runs on its own only when auto-trade is on with all three limits below; otherwise each order waits for you."}
              </p>
            </div>
            {preset.supportsTestnet ? (
              <Switch
                label="Use the testnet"
                description={testnet ? "On. Orders go to the venue's test exchange, with test funds." : "Off. Orders go to the real exchange."}
                checked={testnet}
                onChange={setTestnet}
              />
            ) : null}
            {mode === "live" && !testnet ? (
              <Notice tone="warning" title="Live means real money">
                The keys you gave can place real orders. The crew still keeps inside the trading settings below.
              </Notice>
            ) : null}
            <div className="app-form-actions">
              <button type="button" className="btn-secondary" onClick={() => go(2)}>
                <ProductIcon name="chevronLeft" size={20} />
                <span>Back</span>
              </button>
              <button type="submit" aria-busy={add.busy || undefined}>
                <ProductIcon name="plus" size={20} />
                <span>Connect and learn</span>
              </button>
            </div>
            <FormStatus error={add.error ? `${add.error} Type the keys again to retry; the page never keeps them.` : null} />
          </>
        ) : null}

        {step === "done" ? (
          <>
            {made ? (
              <div className="venue-done">
                <span className="venue-done-head">
                  <span className="p-row-title">{made.label}</span>
                  <StatusPill tone={VENUE_STATUS[made.status].tone} icon={VENUE_STATUS[made.status].icon}>
                    {VENUE_STATUS[made.status].word}
                  </StatusPill>
                </span>
                <span className="venue-state" aria-live="polite">
                  {made.status === "learning"
                    ? "Reading its tools and trying them on paper."
                    : made.status === "ready"
                      ? `Ready with ${made.learnedSkills.length} learned ${made.learnedSkills.length === 1 ? "skill" : "skills"}, shared by every cat.`
                      : made.status === "error"
                        ? (made.error ?? "It did not connect. Check the command and the keys.")
                        : "Connected. Press Learn on its row to teach the crew."}
                </span>
              </div>
            ) : (
              <p className="app-empty-line">The venue was added. Its row shows how the learning goes.</p>
            )}
            <div className="app-form-actions">
              <button type="button" className="btn-secondary" onClick={reset}>
                <ProductIcon name="plus" size={20} />
                <span>Connect another</span>
              </button>
            </div>
          </>
        ) : null}
      </form>
    </Region>
  );
}

// ---------------------------------------------------------------- settings
/** What live auto-trade needs before a live order may run on its own. */
export function autoTradeGaps(s: Pick<TradingSettings, "maxOrderUsd" | "dailyLossLimitUsd" | "allowedSymbols">): Array<{ key: string; met: boolean; text: string }> {
  return [
    { key: "order", met: s.maxOrderUsd > 0, text: "A max order above $0" },
    { key: "loss", met: s.dailyLossLimitUsd > 0, text: "A daily loss limit above $0" },
    { key: "symbols", met: s.allowedSymbols.length > 0, text: "At least one allowed symbol" },
  ];
}

function SettingsCard({ initial, missing, onSaved }: { initial: TradingSettings | null; missing: boolean; onSaved: (s: TradingSettings) => void }) {
  const { api } = useApp();
  const [form, setForm] = useState<TradingSettings>(initial ?? DEFAULT_TRADING);
  const [maxOrder, setMaxOrder] = useState(String((initial ?? DEFAULT_TRADING).maxOrderUsd));
  const [lossLimit, setLossLimit] = useState(String((initial ?? DEFAULT_TRADING).dailyLossLimitUsd));
  const [ok, setOk] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ order?: string; loss?: string; auto?: string }>({});
  const save = useAction();

  useEffect(() => {
    if (!initial) return;
    setForm(initial);
    setMaxOrder(String(initial.maxOrderUsd));
    setLossLimit(String(initial.dailyLossLimitUsd));
  }, [initial]);

  const money = (v: string) => Number(v.replace(/[^0-9.]/g, ""));
  const gaps = autoTradeGaps({ maxOrderUsd: money(maxOrder) || 0, dailyLossLimitUsd: money(lossLimit) || 0, allowedSymbols: form.allowedSymbols });
  const limitsSet = gaps.every((g) => g.met);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOk(null);
    const order = money(maxOrder);
    const loss = money(lossLimit);
    const errors: { order?: string; loss?: string; auto?: string } = {};
    if (!Number.isFinite(order) || order < 0) errors.order = "Use 0 or a positive amount in USD.";
    if (!Number.isFinite(loss) || loss < 0) errors.loss = "Use 0 or a positive amount in USD.";
    if (form.mode === "live" && form.autoTrade && !limitsSet) errors.auto = "Live auto-trade needs all three limits. Set them, or turn auto-trade off so each live order waits for you.";
    setFieldError(errors);
    if (errors.order || errors.loss || errors.auto) return;
    const next: TradingSettings = { ...form, maxOrderUsd: order, dailyLossLimitUsd: loss };
    void save.run(async () => {
      const saved = await api.call("PUT /api/trading/settings", { body: next });
      onSaved(saved);
      setOk(saved.mode === "paper" ? "Saved. The crew trades on paper, on its own." : saved.autoTrade ? "Saved. Live orders inside your limits run on their own." : "Saved. Every live order waits for you.");
    });
  };

  const liveAuto = form.mode === "live" && form.autoTrade;
  return (
    <Region container="card" title="Trading settings" className="app-card trading-settings" meta="Safe by default: paper until you switch to live, and every live order waits for you.">
      {missing ? (
        <p className="app-empty-line">Trading settings are not on this runtime yet. Until they are, the crew only trades on paper.</p>
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
              {form.mode === "paper" ? "Paper runs on its own: orders fill at market prices with no real money. The default." : "Live sends orders through your connected venues, inside the limits below."}
            </p>
          </div>
          <Switch
            label="Auto-trade live orders"
            description={form.autoTrade ? "On. Live orders inside every limit below run without asking you." : "Off. Every live order waits for your Approve. The default."}
            checked={form.autoTrade}
            onChange={(autoTrade) => {
              setFieldError((f) => ({ ...f, auto: undefined }));
              setForm((f) => ({ ...f, autoTrade }));
            }}
          />
          <div className="auto-needs" data-met={limitsSet ? "" : undefined}>
            <p className="field-label">Live auto-trade needs all three</p>
            <ul className="auto-needs-list">
              {gaps.map((g) => (
                <li key={g.key} className="auto-need" data-tone={g.met ? "success" : undefined}>
                  <span className="auto-need-icon">
                    <ProductIcon name={g.met ? "checkCircle" : "minusCircle"} size={16} label={g.met ? "Set" : "Not set"} />
                  </span>
                  <span>{g.text}</span>
                </li>
              ))}
            </ul>
            <p className="field-hint" data-state={fieldError.auto ? "error" : undefined} aria-live="polite">
              {fieldError.auto ?? (limitsSet ? "All three are set. With auto-trade on, live orders inside them run on their own." : "Until they are, every live order waits for you, even with auto-trade on.")}
            </p>
          </div>
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
          {liveAuto && limitsSet ? (
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
                setFieldError({});
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
  const venues = useCall((signal) => api.call("GET /api/trading/venues", { signal }), "trading-venues");
  const settings = useCall((signal) => api.call("GET /api/trading/settings", { signal }), "trading-settings");
  const orders = useCall((signal) => api.call("GET /api/trading/orders", { signal }), "trading-orders");
  const positions = useCall((signal) => api.call("GET /api/trading/positions", { signal }), "trading-positions");
  const runs = useResource((signal) => api.call("GET /api/runs", { signal }), "runs");
  const [removing, setRemoving] = useState<TradingVenueDTO | null>(null);
  const remove = useAction();

  const venueList: TradingVenueDTO[] = venues.data ?? [];
  const list: OrderDTO[] = orders.data ?? [];
  const book: PositionDTO[] = positions.data ?? [];
  const waiting = list.filter(waitsOnYou).length;
  const t = positionTotals(book);
  const fundRuns = (runs.data ?? []).filter((r) => r.company === "fund").length;
  const learningNow = venueList.some((v) => v.status === "learning");
  const ready = venueList.filter((v) => v.status === "ready").length;
  const skills = venueList.reduce((n, v) => n + (v.status === "disabled" ? 0 : v.learnedSkills.length), 0);

  // While a venue learns, its status and skills refresh on their own.
  const setVenues = venues.setData;
  useEffect(() => {
    if (!learningNow) return;
    const ctrl = new AbortController();
    const tick = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      api.call("GET /api/trading/venues", { signal: ctrl.signal }).then(setVenues, () => {});
    }, 2500);
    return () => {
      ctrl.abort();
      clearInterval(tick);
    };
  }, [api, learningNow, setVenues]);

  const upsert = (v: TradingVenueDTO) => venues.setData((prev) => (prev?.some((x) => x.id === v.id) ? prev.map((x) => (x.id === v.id ? v : x)) : [...(prev ?? []), v]));

  const decide = async (o: OrderDTO, decision: "approve" | "reject") => {
    const next = await api.call("POST /api/trading/orders/:id/decision", { params: { id: o.id }, body: { decision } });
    orders.setData((prev) => (prev ?? []).map((x) => (x.id === next.id ? next : x)));
  };

  return (
    <Page>
      <PageHead title="Trading" lead="Connect an exchange or a broker and the crew learns to use it. Set how far it may go with money, and watch the orders and the book." />

      <section className="app-region trading-advice" data-container="plain" aria-label="No investment advice">
        <Notice tone="info" title="MengAI gives no investment advice">
          The cats research, backtest and propose trades from your own data and keys. Every decision and every loss is yours, so start on paper and keep the limits tight.
        </Notice>
      </section>

      <div className="app-split trading-split">
        <div className="app-split-main">
          <Region
            container="rows"
            title="Venues"
            className="trading-venues"
            meta={
              venues.data && venueList.length
                ? `${venueList.length} ${venueList.length === 1 ? "venue" : "venues"}, ${ready} ready, ${skills} learned ${skills === 1 ? "skill" : "skills"}. What one cat learns, every cat uses at once.`
                : "What one cat learns about a venue, every cat uses at once."
            }
          >
            {venues.loading && !venues.data ? (
              <SkeletonRows rows={2} label="Loading venues" />
            ) : venues.missing ? (
              <EmptyState icon="dollar" title="Venues are not on this runtime yet">
                Update MengAI on this machine. Once venues are on, every exchange and broker you connect shows here with what the crew learned.
              </EmptyState>
            ) : venues.error ? (
              <EmptyState icon="alertCircle" tone="danger" title="Venues did not load" action={<button type="button" onClick={venues.reload}>Try again</button>}>
                {venues.error}
              </EmptyState>
            ) : venueList.length === 0 ? (
              <EmptyState icon="dollar" title="No venue connected yet">
                Connect an exchange or a broker in Connect a venue. Start on paper: the crew trades there on its own and learns every tool.
              </EmptyState>
            ) : (
              <ul className="p-rows" data-variant="boxed" aria-label="Venues">
                {venueList.map((v) => (
                  <VenueRow key={v.id} v={v} now={now} onChange={upsert} onRemove={setRemoving} />
                ))}
              </ul>
            )}
          </Region>

          <Region
            container="rows"
            title="Orders"
            className="trading-orders"
            meta={orders.data ? (waiting ? `${waiting} live ${waiting === 1 ? "order waits" : "orders wait"} on you, ${list.length} in all` : `${list.length} ${list.length === 1 ? "order" : "orders"}, nothing waits on you`) : undefined}
          >
            {orders.loading && !orders.data ? (
              <SkeletonRows rows={3} label="Loading orders" />
            ) : orders.missing ? (
              <EmptyState icon="dollar" title="The order feed is not on this runtime yet">
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
              <p className="app-empty-line">Positions show here once the trading desk is on this runtime.</p>
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
          {venues.missing ? null : <ConnectVenue latest={(id) => venueList.find((v) => v.id === id) ?? null} onAdded={upsert} />}
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

      <Sheet
        open={!!removing}
        onClose={() => setRemoving(null)}
        alert
        dismissible={false}
        title={removing ? `Remove ${removing.label}?` : "Remove the venue?"}
        description="The crew stops trading through it at once. You can connect it again any time with fresh keys."
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setRemoving(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="app-btn-destructive"
              aria-busy={remove.busy || undefined}
              onClick={() =>
                void remove.run(async () => {
                  if (!removing) return;
                  await api.call("DELETE /api/trading/venues/:id", { params: { id: removing.id } });
                  venues.setData((prev) => (prev ?? []).filter((x) => x.id !== removing.id));
                  setRemoving(null);
                })
              }
            >
              Remove
            </button>
          </>
        }
      >
        <p className="app-body-muted">{removing ? `Its ${removing.learnedSkills.length} learned ${removing.learnedSkills.length === 1 ? "skill goes" : "skills go"} with it.` : null}</p>
        <FormStatus error={remove.error} />
      </Sheet>
    </Page>
  );
}
