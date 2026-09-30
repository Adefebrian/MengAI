// Providers (/app/providers): bring your own key. Connected providers as
// rows with a real connection test (JEV core.list.actions), the add form
// beside them (card, the key field never echoes and clears after save; the
// base URL comes prefilled from the preset and stays editable, custom
// endpoints start empty), the JEV judge as its own key-only card,
// then model routing per tier, per role and for media (divided section of
// three settings tables on one column grid, closed by one save row).
import {
  AGENT_ROLES,
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
import { useEffect, useId, useState, type FormEvent } from "react";
import { useApp } from "../context";
import { fmtAgo } from "../format";
import { useAction, useNow, useResource } from "../hooks";
import { FormStatus, Page, PageHead, Region, SelectField, TextField } from "../ui";

const TIER_WORD: Record<Tier, string> = { fast: "Fast", balanced: "Balanced", deep: "Deep" };
const TIER_JOB: Record<Tier, string> = {
  fast: "Scans and short steps",
  balanced: "Most coding and review",
  deep: "Planning and hard calls",
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
        description="The key is deleted from the vault. Tiers routed to it go back to Automatic."
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
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "openai");
  const [label, setLabel] = useState("");
  // prefilled from the preset and editable; custom presets have no URL, so the owner types it
  const [baseUrl, setBaseUrl] = useState(presets[0]?.baseUrl ?? "");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [models, setModels] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const save = useAction();
  const preset = presets.find((x) => x.id === presetId) ?? presets[0];
  const custom = !preset?.baseUrl;

  // presets arrive filtered (a new array each render), so only a preset change refills the URL
  useEffect(() => {
    setBaseUrl(presets.find((x) => x.id === presetId)?.baseUrl ?? "");
    setUrlError(null);
    setModels("");
  }, [presetId]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOk(null);
    if (!baseUrl.trim()) {
      setUrlError(custom ? "Paste your endpoint's base URL, for example https://llm.example.com/v1." : `Put the base URL back, or pick ${preset?.label ?? "the preset"} again to refill it.`);
      return;
    }
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
      setBaseUrl(preset?.baseUrl ?? "");
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
          <TextField
            label="Base URL"
            type="url"
            inputMode="url"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              if (urlError) setUrlError(null);
            }}
            placeholder={custom ? "https://your-endpoint/v1" : preset?.baseUrl}
            hint={custom ? "Required. The URL of your own endpoint." : "Prefilled. Edit it for a proxy or a regional endpoint."}
            error={urlError}
            spellCheck={false}
          />
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
          placeholder={preset?.suggestedModels.slice(0, 3).join(", ") || "your-model-id"}
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

/**
 * JEV is not a model provider: it judges the crew's soft calls (which roles
 * to hire, which prompt version wins, when a loop is done). So it gets a
 * key-only card: paste the key, it connects and tests itself. The row is
 * still a provider row with the jev preset, so the vault and the judge
 * adapter stay the same.
 */
function JevCard({ preset, row, onSaved, onRemoved }: { preset: ProviderPreset; row: ProviderDTO | undefined; onSaved: (p: ProviderDTO) => void; onRemoved: (id: string) => void }) {
  const { api } = useApp();
  const [key, setKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const save = useAction();
  const test = useAction();
  const remove = useAction();
  const showForm = !row || editing;

  const check = async (p: ProviderDTO) => {
    const r = await api.call("POST /api/providers/:id/test", { params: { id: p.id } });
    onSaved({ ...p, lastTestOk: r.ok, lastTestError: r.error, lastTestAt: Date.now() });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) {
      setKeyError("Paste your JEV key. It is never shown again.");
      return;
    }
    void save.run(async () => {
      const p = row
        ? await api.call("PATCH /api/providers/:id", { params: { id: row.id }, body: { apiKey: key.trim() } })
        : await api.call("POST /api/providers", { body: { preset: preset.id, apiKey: key.trim() } });
      setKey("");
      setEditing(false);
      onSaved(p);
      await check(p);
    });
  };

  const status =
    !row
      ? { tone: "neutral", icon: "clock" as const, text: "Not connected. The crew still decides, and marks those calls unverified." }
      : row.lastTestOk === true
        ? { tone: "success", icon: "checkCircle" as const, text: "Connected. Oyen checks the soft calls with JEV." }
        : row.lastTestOk === false
          ? { tone: "danger", icon: "xCircle" as const, text: row.lastTestError ?? "JEV did not answer" }
          : { tone: "neutral", icon: "clock" as const, text: "Key saved, not tested yet" };

  return (
    <section className="app-region app-card prov-add" data-container="card" aria-labelledby="jev-h">
      <div className="app-region-head">
        <div className="app-region-text">
          <h2 className="app-h2" id="jev-h">
            JEV judge
          </h2>
          <p className="app-region-meta">
            JEV settles the crew's soft calls: who to hire, which prompt version wins, when a loop is done. Only a key, nothing else to set.{" "}
            <a href={preset.docsUrl} target="_blank" rel="noreferrer">
              Get a key
            </a>
          </p>
        </div>
      </div>
      <div className="prov-meta">
        {row?.hasKey ? (
          <span>
            Key ending <span className="num">{row.keyHint}</span>
          </span>
        ) : null}
        <span className="prov-test" data-tone={status.tone} aria-live="polite">
          <ProductIcon name={status.icon} size={16} />
          <span>{test.error ?? status.text}</span>
        </span>
      </div>
      {showForm ? (
        <form className="app-form" onSubmit={submit} noValidate autoComplete="off">
          <TextField
            label="JEV API key"
            type="password"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              if (keyError) setKeyError(null);
            }}
            autoComplete="new-password"
            spellCheck={false}
            placeholder="Paste the key once"
            error={keyError}
            hint="Goes to the vault on your machine. Only the last 4 characters come back."
          />
          <div className="app-form-actions">
            <button type="submit" aria-busy={save.busy || undefined}>
              <ProductIcon name="checkCircle" size={20} />
              <span>{row ? "Save new key" : "Connect JEV"}</span>
            </button>
            {row ? (
              <button type="button" className="btn-ghost" onClick={() => { setEditing(false); setKey(""); setKeyError(null); }}>
                Cancel
              </button>
            ) : null}
          </div>
          <FormStatus error={save.error} />
        </form>
      ) : (
        <div className="app-form-actions">
          <button type="button" className="btn-secondary" aria-busy={test.busy || undefined} onClick={() => row && test.run(() => check(row))}>
            Test
          </button>
          <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
            Replace key
          </button>
          <button type="button" className="btn-ghost" onClick={() => setConfirm(true)} aria-label="Remove the JEV key">
            <ProductIcon name="trash" size={20} />
            <span>Remove</span>
          </button>
        </div>
      )}
      {row ? (
        <Sheet
          open={confirm}
          onClose={() => setConfirm(false)}
          alert
          title="Remove the JEV key?"
          description="The key is deleted from the vault. The crew keeps working and marks its soft calls unverified."
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
                    await api.call("DELETE /api/providers/:id", { params: { id: row.id } });
                    setConfirm(false);
                    onRemoved(row.id);
                  })
                }
              >
                Remove key
              </button>
            </>
          }
        >
          <FormStatus error={remove.error} />
        </Sheet>
      ) : null}
    </section>
  );
}

const ROUTED_ROLES = AGENT_ROLES.filter((r): r is Exclude<AgentRole, "operator"> => r !== "operator");
const MEDIA = [
  { kind: "image", word: "Image", noun: "images" },
  { kind: "video", word: "Video", noun: "videos" },
] as const;

/** One comparable shape per routing, so the status line knows when the draft differs from what is saved. */
function routingKey(r: ModelRouting): string {
  return JSON.stringify({
    tiers: TIERS.map((t) => {
      const m = r.tiers.find((x) => x.tier === t);
      return [m?.providerId ?? null, m?.model ?? null];
    }),
    roles: ROUTED_ROLES.map((role) => r.roleTiers[role] ?? null),
    image: [r.image.providerId, r.image.model],
    video: [r.video.providerId, r.video.model],
  });
}

/** The column heads of one routing table, shown once above its rows from 768px. Each control carries its own name. */
function RoutingHead({ cols }: { cols: readonly [string, string, string] }) {
  return (
    <div className="rt-head" aria-hidden="true">
      {cols.map((c) => (
        <span key={c}>{c}</span>
      ))}
    </div>
  );
}

/**
 * Model routing as three settings tables on one column grid (JEV
 * ui.component_recipe core.settings_table): the name, the choice, then the
 * model it resolves to, so every control column lines up down the section.
 * Below 768px each row stacks and the column names turn into labels.
 */
function Routing({ providers, routing, onSaved }: { providers: ProviderDTO[]; routing: ModelRouting; onSaved: (r: ModelRouting) => void }) {
  const { api } = useApp();
  const uid = useId();
  const [draft, setDraft] = useState<ModelRouting>(routing);
  const [ok, setOk] = useState(false);
  const [tried, setTried] = useState(false);
  const save = useAction();
  useEffect(() => setDraft(routing), [routing]);
  const draftKey = routingKey(draft);
  const dirty = draftKey !== routingKey(routing);
  // an edit answers the last error: the status line goes back to the draft's state
  useEffect(() => save.setError(null), [draftKey, save.setError]);
  const chat = providers.filter((p) => p.caps.includes("chat"));
  const labelOf = (id: string | null) => providers.find((p) => p.id === id)?.label ?? "a removed provider";
  const modelsOf = (id: string | null) => providers.find((p) => p.id === id)?.models ?? [];
  const tier = (t: Tier) => draft.tiers.find((x) => x.tier === t) ?? { tier: t, providerId: null, model: null };
  const setTier = (t: Tier, patch: { providerId?: string | null; model?: string | null }) =>
    setDraft((d) => {
      const rest = d.tiers.filter((x) => x.tier !== t);
      return { ...d, tiers: [...rest, { ...tier(t), ...patch }].sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)) };
    });
  // Mirrors the server (provider agnostic): an Automatic tier borrows the
  // nearest mapped tier, cheaper first; with nothing mapped it uses the first
  // chat provider the owner added, with that provider's first model.
  const BORROW: Record<Tier, Tier[]> = { fast: ["balanced", "deep"], balanced: ["fast", "deep"], deep: ["balanced", "fast"] };
  const firstProvider = providers.find((p) => p.caps.includes("chat") && (p.hasKey || !findPreset(p.preset)?.keyRequired));
  const firstModel = firstProvider ? (firstProvider.models[0]?.id ?? findPreset(firstProvider.preset)?.suggestedModels[0] ?? null) : null;
  const autoUse = (t: Tier) => {
    for (const b of BORROW[t]) {
      const m = tier(b);
      if (m.providerId && m.model) return `Borrows ${TIER_WORD[b]}: ${m.model}`;
    }
    return firstProvider && firstModel ? `${firstModel} on ${firstProvider.label}` : "Needs a provider first";
  };
  const tierUse = (t: Tier) => {
    const m = tier(t);
    if (!m.providerId) return autoUse(t);
    return m.model ? `${m.model} on ${labelOf(m.providerId)}` : `${TIER_WORD[t]} has no model yet`;
  };
  const mediaUse = (kind: "image" | "video", noun: string) => {
    const cur = draft[kind];
    if (cur.providerId) return cur.model ?? `First ${kind} model on ${labelOf(cur.providerId)}`;
    return providers.some((p) => p.caps.includes(kind)) ? `First provider that makes ${noun}` : `Add a provider that makes ${noun}`;
  };
  const missing = TIERS.filter((t) => tier(t).providerId && !tier(t).model);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOk(false);
    setTried(true);
    if (missing.length) {
      save.setError(`Pick a model for ${missing.map((t) => TIER_WORD[t]).join(" and ")}.`);
      return;
    }
    void save.run(async () => {
      const r = await api.call("PUT /api/routing", { body: draft });
      onSaved(r);
      setOk(true);
    });
  };

  const status = save.error
    ? { tone: "danger", icon: "alertCircle" as const, text: save.error }
    : dirty
      ? { tone: "neutral", icon: "pen" as const, text: "Unsaved changes" }
      : ok
        ? { tone: "success", icon: "checkCircle" as const, text: "Saved. New steps use it right away." }
        : { tone: "neutral", icon: "checkCircle" as const, text: "Saved" };

  return (
    <form className="routing" data-density="comfortable" onSubmit={submit} noValidate>
      <div className="rt-group">
        <div className="rt-intro">
          <h3 className="app-h3">Tiers</h3>
          <p className="app-region-meta">A tier left on Automatic borrows the nearest tier you mapped, or uses the first provider you added.</p>
        </div>
        <div className="rt-table">
          <RoutingHead cols={["Tier", "Provider", "Model"]} />
          {TIERS.map((t) => {
            const m = tier(t);
            const list = modelsOf(m.providerId);
            const id = `${uid}-${t}`;
            return (
              <div className="rt-row" data-kind="tier" role="group" aria-labelledby={`${id}-name`} key={t}>
                <p className="rt-name">
                  <span className="rt-title" id={`${id}-name`}>
                    {TIER_WORD[t]}
                  </span>
                  <span className="rt-sub">{TIER_JOB[t]}</span>
                </p>
                <div className="rt-cell rt-prov">
                  <label className="rt-cap" htmlFor={`${id}-prov`}>
                    Provider
                  </label>
                  <select
                    id={`${id}-prov`}
                    aria-label={`${TIER_WORD[t]} provider`}
                    value={m.providerId ?? ""}
                    onChange={(e) => setTier(t, { providerId: e.target.value || null, model: null })}
                  >
                    <option value="">Automatic</option>
                    {chat.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rt-cell rt-model">
                  {m.providerId ? (
                    <>
                      <label className="rt-cap" htmlFor={`${id}-model`}>
                        Model
                      </label>
                      <select
                        id={`${id}-model`}
                        aria-label={`${TIER_WORD[t]} model`}
                        aria-invalid={tried && !m.model ? true : undefined}
                        value={m.model ?? ""}
                        onChange={(e) => setTier(t, { model: e.target.value || null })}
                      >
                        <option value="">Pick a model</option>
                        {list.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.label ?? x.id}
                          </option>
                        ))}
                        {m.model && !list.some((x) => x.id === m.model) ? <option value={m.model}>{m.model}</option> : null}
                      </select>
                    </>
                  ) : (
                    <>
                      <span className="rt-cap" aria-hidden="true">
                        Model
                      </span>
                      <p className="rt-use rt-inherit">{autoUse(t)}</p>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rt-group">
        <div className="rt-intro">
          <h3 className="app-h3">Roles</h3>
          <p className="app-region-meta">Pin a role to one tier. Per task means JEV picks the tier for each task.</p>
        </div>
        <div className="rt-table">
          <RoutingHead cols={["Role", "Tier", "Model"]} />
          {ROUTED_ROLES.map((role) => {
            const id = `${uid}-${role}`;
            const pinned = draft.roleTiers[role];
            return (
              <div className="rt-row" data-kind="pick" key={role}>
                <label className="rt-title rt-name" htmlFor={id}>
                  {ROLE_LABEL[role]}
                </label>
                <select
                  id={id}
                  className="rt-ctl"
                  aria-describedby={`${id}-use`}
                  value={pinned ?? ""}
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
                      {TIER_WORD[t]}
                    </option>
                  ))}
                </select>
                <p className="rt-use" id={`${id}-use`}>
                  {pinned ? tierUse(pinned) : "Depends on the task"}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rt-group">
        <div className="rt-intro">
          <h3 className="app-h3">Media</h3>
          <p className="app-region-meta">Used by the designer cat and on the Assets page.</p>
        </div>
        <div className="rt-table">
          <RoutingHead cols={["Media", "Provider", "Model"]} />
          {MEDIA.map(({ kind, word, noun }) => {
            const id = `${uid}-${kind}`;
            const cur = draft[kind];
            const saved = routing[kind];
            return (
              <div className="rt-row" data-kind="pick" key={kind}>
                <label className="rt-title rt-name" htmlFor={id}>
                  {word}
                </label>
                <select
                  id={id}
                  className="rt-ctl"
                  aria-label={`${word} provider`}
                  aria-describedby={`${id}-use`}
                  value={cur.providerId ?? ""}
                  onChange={(e) => {
                    const next = e.target.value || null;
                    setDraft((d) => ({ ...d, [kind]: { providerId: next, model: next && next === saved.providerId ? saved.model : null } }));
                  }}
                >
                  <option value="">Automatic</option>
                  {providers
                    .filter((p) => p.caps.includes(kind))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                </select>
                <p className="rt-use" id={`${id}-use`}>
                  {mediaUse(kind, noun)}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rt-actions">
        <p className="rt-status" data-tone={status.tone} aria-live="polite">
          <ProductIcon name={status.icon} size={16} />
          <span>{status.text}</span>
        </p>
        <button type="submit" aria-busy={save.busy || undefined}>
          Save routing
        </button>
      </div>
    </form>
  );
}

export function ProvidersScreen() {
  const { api } = useApp();
  const now = useNow(60_000);
  const providers = useResource((signal) => api.call("GET /api/providers", { signal }), "providers");
  const presets = useResource((signal) => api.call("GET /api/providers/presets", { signal }), "presets");
  const routing = useResource((signal) => api.call("GET /api/routing", { signal }), "routing");
  const all = providers.data ?? [];
  // JEV has its own card; the connected list and routing only show model providers
  const isJudge = (p: { caps: readonly string[] }) => p.caps.includes("judge");
  const list = all.filter((p) => !isJudge(p));
  const jevPreset = presets.data?.find(isJudge);
  const jevRow = all.find(isJudge);
  const upsert = (next: ProviderDTO) => providers.setData((prev) => (prev?.some((x) => x.id === next.id) ? prev.map((x) => (x.id === next.id ? next : x)) : [...(prev ?? []), next]));
  const drop = (id: string) => providers.setData((prev) => (prev ?? []).filter((x) => x.id !== id));

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
                    onChange={upsert}
                    onRemove={drop}
                  />
                ))}
              </ul>
            )}
          </Region>
        </div>
        <div className="app-split-side">
          {presets.data ? <AddProvider presets={presets.data.filter((p) => !isJudge(p))} onAdded={upsert} /> : <SkeletonRows rows={4} label="Loading presets" />}
          {jevPreset && providers.data ? <JevCard preset={jevPreset} row={jevRow} onSaved={upsert} onRemoved={drop} /> : null}
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
