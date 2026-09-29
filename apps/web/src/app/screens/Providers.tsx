// Providers (/app/providers): bring your own key. Connected providers as
// rows with a real connection test (JEV core.list.actions), the add form
// beside them (card, the key field never echoes and clears after save),
// then model routing per tier, per role and for media (divided section).
import {
  AGENT_ROLES,
  DEFAULT_CHAT_MODEL,
  ROLE_LABEL,
  TIERS,
  findPreset,
  type AgentRole,
  type ModelRouting,
  type ProviderDTO,
  type ProviderPreset,
  type Tier,
} from "@mengai/shared";
import { EmptyState, ProductIcon, Sheet, SkeletonRows } from "@mengai/ui/src/product";
import { useEffect, useState, type FormEvent } from "react";
import { useApp } from "../context";
import { fmtAgo } from "../format";
import { useAction, useNow, useResource } from "../hooks";
import { FormStatus, Page, PageHead, Region, SelectField, TextField } from "../ui";

const TIER_WORD: Record<Tier, string> = { fast: "Fast", balanced: "Balanced", deep: "Deep" };
const TIER_JOB: Record<Tier, string> = {
  fast: "Short steps, scans and summaries",
  balanced: "Most coding and review steps",
  deep: "Planning and the hardest calls",
};

function ProviderRow({ p, now, onChange, onRemove }: { p: ProviderDTO; now: number; onChange: (p: ProviderDTO) => void; onRemove: (id: string) => void }) {
  const { api } = useApp();
  const test = useAction();
  const remove = useAction();
  const [confirm, setConfirm] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const status =
    p.lastTestOk === true
      ? { tone: "success", icon: "checkCircle" as const, text: latency ? `Answered in ${latency} ms` : `Answered ${p.lastTestAt ? fmtAgo(p.lastTestAt, now) : ""}`.trim() }
      : p.lastTestOk === false
        ? { tone: "danger", icon: "xCircle" as const, text: p.lastTestError ?? "Did not answer" }
        : { tone: "neutral", icon: "clock" as const, text: "Not tested yet" };
  return (
    <li className="prov-row">
      <span className="prov-icon">
        <ProductIcon name="providers" size={20} />
      </span>
      <span className="prov-body">
        <span className="prov-title">
          <span className="prov-name">{p.label}</span>
          <span className="prov-preset">{findPreset(p.preset)?.label ?? "Custom"}</span>
        </span>
        <span className="prov-url" title={p.baseUrl}>
          {p.baseUrl}
        </span>
        <span className="prov-meta">
          <span>{p.hasKey ? <>Key ending <span className="num">{p.keyHint}</span></> : "No key"}</span>
          <span>
            <span className="num">{p.models.length}</span> {p.models.length === 1 ? "model" : "models"}
          </span>
          <span className="prov-test" data-tone={status.tone}>
            <ProductIcon name={status.icon} size={16} />
            <span>{test.error ?? status.text}</span>
          </span>
        </span>
      </span>
      <span className="prov-actions">
        <button
          type="button"
          className="btn-secondary"
          aria-busy={test.busy || undefined}
          onClick={() =>
            test.run(async () => {
              const r = await api.call("POST /api/providers/:id/test", { params: { id: p.id } });
              setLatency(r.ok ? r.latencyMs : null);
              onChange({ ...p, lastTestOk: r.ok, lastTestError: r.error, lastTestAt: Date.now(), models: r.models.length ? r.models : p.models });
            })
          }
        >
          Test connection
        </button>
        <button type="button" className="btn-ghost" onClick={() => setConfirm(true)} aria-label={`Remove ${p.label}`}>
          <ProductIcon name="trash" size={20} />
          <span>Remove</span>
        </button>
      </span>
      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        alert
        title={`Remove ${p.label}?`}
        description="The key is deleted from the vault. Tiers routed to it fall back to the default model."
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setConfirm(false)}>
              Keep it
            </button>
            <button
              type="button"
              className="app-btn-destructive"
              aria-busy={remove.busy || undefined}
              onClick={() =>
                remove.run(async () => {
                  await api.call("DELETE /api/providers/:id", { params: { id: p.id } });
                  setConfirm(false);
                  onRemove(p.id);
                })
              }
            >
              Remove provider
            </button>
          </>
        }
      >
        <FormStatus error={remove.error} />
      </Sheet>
    </li>
  );
}

function AddProvider({ presets, onAdded }: { presets: ProviderPreset[]; onAdded: (p: ProviderDTO) => void }) {
  const { api } = useApp();
  const [presetId, setPresetId] = useState("openai");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [models, setModels] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const save = useAction();
  const preset = presets.find((x) => x.id === presetId) ?? presets[0];

  useEffect(() => {
    setBaseUrl("");
    setModels("");
  }, [presetId]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOk(null);
    if (preset?.keyRequired && !key) {
      setKeyError(`${preset.label} needs an API key. Paste it once; it is never shown again.`);
      return;
    }
    void save.run(async () => {
      const list = models
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
        .map((id) => ({ id }));
      const p = await api.call("POST /api/providers", {
        body: {
          preset: presetId,
          label: label.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined,
          apiKey: key || undefined,
          models: list.length ? list : undefined,
        },
      });
      setKey("");
      setLabel("");
      setModels("");
      setOk(p.hasKey ? `${p.label} added. The key is in the vault, ends in ${p.keyHint}, and will not be shown again.` : `${p.label} added, no key needed.`);
      onAdded(p);
    });
  };

  return (
    <section className="app-region app-card prov-add" data-container="card" aria-labelledby="add-h">
      <div className="app-region-head">
        <div className="app-region-text">
          <h2 className="app-h2" id="add-h">
            Add a provider
          </h2>
          <p className="app-region-meta">Any vendor that speaks OpenAI Chat or Anthropic Messages works, local ones too.</p>
        </div>
      </div>
      <form className="app-form" onSubmit={submit} noValidate autoComplete="off">
        <SelectField label="Provider" value={presetId} onChange={(e) => setPresetId(e.target.value)} hint={preset ? `${preset.caps.join(", ")}` : undefined}>
          {presets.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </SelectField>
        <div className="field-row">
          <TextField label="Name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={preset?.label ?? "My provider"} hint="How it shows up here" />
          <TextField label="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={preset?.baseUrl ?? "https://"} hint="Leave empty for the preset" spellCheck={false} />
        </div>
        <TextField
          label="API key"
          type="password"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            if (keyError) setKeyError(null);
          }}
          autoComplete="new-password"
          spellCheck={false}
          placeholder={preset?.keyRequired ? "Paste the key once" : "No key needed"}
          disabled={preset ? !preset.keyRequired && preset.auth === "none" : false}
          error={keyError}
          hint="Sent once to the vault. Only the last 4 characters ever come back."
        />
        <TextField
          label="Models"
          value={models}
          onChange={(e) => setModels(e.target.value)}
          placeholder={preset?.suggestedModels.slice(0, 3).join(", ") || DEFAULT_CHAT_MODEL}
          hint="Comma separated. Test connection fetches the real list when the vendor has one."
          spellCheck={false}
        />
        <div className="app-form-actions">
          <button type="submit" aria-busy={save.busy || undefined}>
            <ProductIcon name="plus" size={20} />
            <span>Save provider</span>
          </button>
        </div>
        <FormStatus ok={ok} error={save.error} />
      </form>
    </section>
  );
}

function Routing({ providers, routing, onSaved }: { providers: ProviderDTO[]; routing: ModelRouting; onSaved: (r: ModelRouting) => void }) {
  const { api } = useApp();
  const [draft, setDraft] = useState<ModelRouting>(routing);
  const [ok, setOk] = useState<string | null>(null);
  const save = useAction();
  useEffect(() => setDraft(routing), [routing]);
  const chat = providers.filter((p) => p.caps.includes("chat"));
  const tier = (t: Tier) => draft.tiers.find((x) => x.tier === t) ?? { tier: t, providerId: null, model: null };
  const setTier = (t: Tier, patch: { providerId?: string | null; model?: string | null }) =>
    setDraft((d) => {
      const rest = d.tiers.filter((x) => x.tier !== t);
      return { ...d, tiers: [...rest, { ...tier(t), ...patch }].sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)) };
    });
  const modelsOf = (id: string | null) => providers.find((p) => p.id === id)?.models ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOk(null);
    void save.run(async () => {
      const r = await api.call("PUT /api/routing", { body: draft });
      onSaved(r);
      setOk("Routing saved. New steps use it right away.");
    });
  };

  return (
    <form className="routing" onSubmit={submit} noValidate>
      <div className="routing-group">
        <h3 className="app-h3">Tiers</h3>
        <p className="app-region-meta">Unmapped tiers use OpenAI {DEFAULT_CHAT_MODEL} whenever an OpenAI key is present.</p>
        <div className="routing-rows">
          {TIERS.map((t) => {
            const m = tier(t);
            const list = modelsOf(m.providerId);
            return (
              <div className="routing-row" key={t}>
                <p className="routing-name">
                  <span>{TIER_WORD[t]}</span>
                  <span className="routing-job">{TIER_JOB[t]}</span>
                </p>
                <div className="field-row">
                  <SelectField label={`${TIER_WORD[t]} provider`} value={m.providerId ?? ""} onChange={(e) => setTier(t, { providerId: e.target.value || null, model: null })}>
                    <option value="">Default</option>
                    {chat.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField label={`${TIER_WORD[t]} model`} value={m.model ?? ""} onChange={(e) => setTier(t, { model: e.target.value || null })} disabled={!m.providerId}>
                    <option value="">{m.providerId ? "Pick a model" : DEFAULT_CHAT_MODEL}</option>
                    {list.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label ?? x.id}
                      </option>
                    ))}
                    {m.model && !list.some((x) => x.id === m.model) ? <option value={m.model}>{m.model}</option> : null}
                  </SelectField>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="routing-group">
        <h3 className="app-h3">Roles</h3>
        <p className="app-region-meta">Pin a role to one tier. Otherwise JEV picks the tier for each task.</p>
        <div className="routing-roles">
          {AGENT_ROLES.filter((r) => r !== "operator").map((role: AgentRole) => (
            <SelectField
              key={role}
              label={ROLE_LABEL[role]}
              value={draft.roleTiers[role] ?? ""}
              onChange={(e) =>
                setDraft((d) => {
                  const next = { ...d.roleTiers };
                  if (e.target.value) next[role] = e.target.value as Tier;
                  else delete next[role];
                  return { ...d, roleTiers: next };
                })
              }
            >
              <option value="">Per task</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  Always {TIER_WORD[t].toLowerCase()}
                </option>
              ))}
            </SelectField>
          ))}
        </div>
      </div>

      <div className="routing-group">
        <h3 className="app-h3">Media</h3>
        <p className="app-region-meta">Used by the designer cat and on the Assets page.</p>
        <div className="routing-roles">
          {(["image", "video"] as const).map((kind) => {
            const cap = kind === "image" ? "image" : "video";
            const list = providers.filter((p) => p.caps.includes(cap) || p.preset === "openai");
            const cur = draft[kind];
            return (
              <SelectField
                key={kind}
                label={kind === "image" ? "Image provider" : "Video provider"}
                value={cur.providerId ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [kind]: { providerId: e.target.value || null, model: cur.model } }))}
                hint={cur.model ? `Model ${cur.model}` : "No model routed yet"}
              >
                <option value="">Not routed</option>
                {list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </SelectField>
            );
          })}
        </div>
      </div>

      <div className="app-form-actions">
        <button type="submit" aria-busy={save.busy || undefined}>
          Save routing
        </button>
      </div>
      <FormStatus ok={ok} error={save.error} />
    </form>
  );
}

export function ProvidersScreen() {
  const { api } = useApp();
  const now = useNow(60_000);
  const providers = useResource((signal) => api.call("GET /api/providers", { signal }), "providers");
  const presets = useResource((signal) => api.call("GET /api/providers/presets", { signal }), "presets");
  const routing = useResource((signal) => api.call("GET /api/routing", { signal }), "routing");
  const list = providers.data ?? [];

  useEffect(() => {
    if (window.location.hash === "#routing") requestAnimationFrame(() => document.getElementById("routing")?.scrollIntoView({ block: "start" }));
  }, [routing.data]);

  return (
    <Page>
      <PageHead title="Providers" lead="Bring your own keys, any provider, any model. A key goes to the vault once and never comes back to this page; you only ever see its last 4 characters." />
      <div className="app-split prov-split">
        <div className="app-split-main">
          <Region container="rows" title="Connected" meta={list.length ? `${list.length} ${list.length === 1 ? "provider" : "providers"}` : undefined}>
            {providers.error ? (
              <EmptyState icon="alertCircle" tone="danger" title="Providers did not load" action={<button type="button" onClick={providers.reload}>Try again</button>}>
                {providers.error}
              </EmptyState>
            ) : providers.loading && !providers.data ? (
              <SkeletonRows rows={3} label="Loading providers" />
            ) : list.length === 0 ? (
              <EmptyState icon="providers" title="No keys yet">
                The cats need one model key to think. Add a provider and test it.
              </EmptyState>
            ) : (
              <ul className="prov-list">
                {list.map((p) => (
                  <ProviderRow
                    key={p.id}
                    p={p}
                    now={now}
                    onChange={(next) => providers.setData((prev) => (prev ?? []).map((x) => (x.id === next.id ? next : x)))}
                    onRemove={(id) => providers.setData((prev) => (prev ?? []).filter((x) => x.id !== id))}
                  />
                ))}
              </ul>
            )}
          </Region>
        </div>
        <div className="app-split-side">
          {presets.data ? <AddProvider presets={presets.data} onAdded={(p) => providers.setData((prev) => [...(prev ?? []), p])} /> : <SkeletonRows rows={4} label="Loading presets" />}
        </div>
      </div>
      <Region container="divided" title="Model routing" id="routing" meta="Which model each tier, each role and each kind of media uses.">
        {routing.data ? (
          <Routing providers={list} routing={routing.data} onSaved={(r) => routing.setData(r)} />
        ) : routing.error ? (
          <p className="app-empty-line" role="alert">
            {routing.error}
          </p>
        ) : (
          <SkeletonRows rows={3} label="Loading routing" />
        )}
      </Region>
    </Page>
  );
}
