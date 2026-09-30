// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Connectors (/app/connectors): the outside tools the crew may use, MCP
// servers (a local command or a remote URL) and HTTP APIs. Regions per JEV
// ui.region_gate: head plain (1.84), connectors as rows (2.93), the add
// form in a card (2.99) beside the rows from 1024px, and the tool safety
// note in plain spacing (1.63). Recipes (ui.component_recipe): core.list
// with the an.R22 disclosure for each tool list (0.62), the kind as a
// radio group (0.97), the role scope as checkboxes (0.92). Motion tier 0.
// A secret is sent once and stored in the vault: the page only ever shows
// the 4 character hint the server returns, and clears the field on send.
import {
  AGENT_ROLES,
  ROLE_LABEL,
  type AgentRole,
  type ConnectorDTO,
  type ConnectorKind,
  type CreateConnectorBody,
  type Risk,
} from "@mengai/shared";
import { EmptyState, ProductIcon, Sheet, SkeletonRows, StatusPill, type GlyphName } from "@mengai/ui/src/product";
import { useId, useState, type FormEvent } from "react";
import { ApiError } from "../../api/client";
import { useApp } from "../context";
import { fmtAgo, fmtInt } from "../format";
import { useAction, useNow, useResource } from "../hooks";
import { CONNECTOR_STATUS, RISK } from "../status";
import { Checkbox, FormStatus, Page, PageHead, RadioGroup, Region, Switch, TextArea, TextField } from "../ui";

const KIND_WORD: Record<ConnectorKind, string> = {
  mcp_stdio: "MCP server, local command",
  mcp_http: "MCP server, remote URL",
  http_api: "HTTP API",
};
const KIND_ICON: Record<ConnectorKind, GlyphName> = { mcp_stdio: "cpu", mcp_http: "cpu", http_api: "code" };

const RISK_LINES: Array<[Risk, string]> = [
  ["read", "Looks things up and never changes them."],
  ["write", "Changes files or records."],
  ["destructive", "Cannot be undone, so it waits for your yes."],
  ["sensitive", "Money, credentials or private data, so it waits for your yes."],
];

/** Roles a connector may serve: every working role (the operator sits this build out). */
const SCOPE_ROLES = AGENT_ROLES.filter((r) => r !== "operator");

function rolesWord(roles: AgentRole[] | null): string {
  if (!roles) return "Every role";
  if (roles.length === 0) return "No role";
  return roles.map((r) => (r === "lead" ? "CEO" : ROLE_LABEL[r])).join(", ");
}

function ConnectorRow({ c, onChange, onRemove, now }: { c: ConnectorDTO; onChange: (next: ConnectorDTO) => void; onRemove: (c: ConnectorDTO) => void; now: number }) {
  const { api } = useApp();
  const look = CONNECTOR_STATUS[c.status];
  const test = useAction();
  const toggle = useAction();
  const [open, setOpen] = useState(false);
  const toolsId = useId();
  const enabled = c.status !== "disabled";
  const risky = c.tools.filter((t) => t.risk === "sensitive" || t.risk === "destructive").length;
  return (
    <li className="p-rows-item" data-kind="connector">
      <div className="p-row connector-row" data-type="static">
        <span className="p-row-leading">
          <span className="connector-icon">
            <ProductIcon name={KIND_ICON[c.kind]} size={20} />
          </span>
        </span>
        <span className="p-row-text">
          <span className="p-row-title">{c.label}</span>
          <span className="p-row-meta">
            <StatusPill tone={look.tone} icon={look.icon}>
              {look.word}
            </StatusPill>
            <span>{KIND_WORD[c.kind]}</span>
            <span>
              <span className="num">{fmtInt(c.tools.length)}</span> {c.tools.length === 1 ? "tool" : "tools"}
              {risky ? `, ${risky} ask you first` : ""}
            </span>
            <span>{rolesWord(c.roles)}</span>
          </span>
          <span className="connector-target num" title={c.target}>
            {c.target}
          </span>
          <span className="connector-facts">
            {c.hasSecret ? <span>Secret in the vault{c.keyHint ? `, ends in ${c.keyHint}` : ""}</span> : <span>No secret</span>}
            <span>Changed {fmtAgo(c.updatedAt, now)}</span>
          </span>
          {c.status === "error" && c.error ? (
            <span className="app-form-status" data-tone="danger">
              <ProductIcon name="alertCircle" size={16} />
              <span>{c.error}</span>
            </span>
          ) : null}
          <span className="connector-actions">
            <Switch
              label="Enabled"
              checked={enabled}
              disabled={toggle.busy}
              onChange={(v) =>
                void toggle.run(async () => {
                  onChange(await api.call("PATCH /api/connectors/:id", { params: { id: c.id }, body: { enabled: v } }));
                })
              }
            />
            <button
              type="button"
              className="btn-secondary"
              aria-busy={test.busy || undefined}
              disabled={!enabled}
              onClick={() =>
                void test.run(async () => {
                  const next = await api.call("POST /api/connectors/:id/test", { params: { id: c.id } });
                  onChange(next);
                  setOpen(true);
                })
              }
            >
              <ProductIcon name="refresh" size={20} />
              <span>Test</span>
            </button>
            <button type="button" className="btn-ghost connector-remove" onClick={() => onRemove(c)}>
              <ProductIcon name="trash" size={20} />
              <span>Remove</span>
            </button>
          </span>
          {test.error || toggle.error ? (
            <span className="app-form-status" data-tone="danger" role="alert">
              <ProductIcon name="alertCircle" size={16} />
              <span>{test.error ?? toggle.error}</span>
            </span>
          ) : null}
          {c.tools.length > 0 ? (
            <span className="connector-tools">
              <button type="button" className="btn-ghost connector-toggle" aria-expanded={open} aria-controls={toolsId} onClick={() => setOpen((v) => !v)}>
                <span className="connector-toggle-icon" aria-hidden="true">
                  <ProductIcon name="chevronDown" size={16} />
                </span>
                <span>{open ? "Hide the tools" : `Show the ${c.tools.length} ${c.tools.length === 1 ? "tool" : "tools"}`}</span>
              </button>
              <span id={toolsId} className="connector-tool-list" hidden={!open}>
                {open
                  ? c.tools.map((t) => {
                      const r = RISK[t.risk];
                      return (
                        <span className="connector-tool" key={t.name}>
                          <span className="connector-tool-head">
                            <span className="num connector-tool-name">{t.name}</span>
                            <StatusPill tone={r.tone} icon={r.icon}>
                              {r.word}
                            </StatusPill>
                          </span>
                          {t.description ? <span className="connector-tool-desc">{t.description}</span> : null}
                        </span>
                      );
                    })
                  : null}
              </span>
            </span>
          ) : null}
        </span>
      </div>
    </li>
  );
}

const TARGET: Record<ConnectorKind, { label: string; placeholder: string; hint: string }> = {
  mcp_stdio: { label: "Command", placeholder: "bunx @modelcontextprotocol/server-github", hint: "The command and its arguments, run on the machine MengAI runs on." },
  mcp_http: { label: "Server URL", placeholder: "https://mcp.example.com/mcp", hint: "The MCP endpoint over HTTP. Use HTTPS for anything off this machine." },
  http_api: { label: "Base URL", placeholder: "https://api.example.com/v1", hint: "Every endpoint the crew calls starts here." },
};

const SECRET: Record<ConnectorKind, { label: string; hint: string }> = {
  mcp_stdio: { label: "Secret environment", hint: "KEY=value lines for the command. Stored in the vault, never shown again." },
  mcp_http: { label: "Auth token", hint: "Sent as the Authorization header. Stored in the vault, never shown again." },
  http_api: { label: "Secret", hint: "The value of the auth header. Stored in the vault, never shown again." },
};

function AddConnector({ onAdded }: { onAdded: (c: ConnectorDTO) => void }) {
  const { api } = useApp();
  const [kind, setKind] = useState<ConnectorKind>("mcp_stdio");
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("");
  const [secret, setSecret] = useState("");
  const [authHeader, setAuthHeader] = useState("Authorization");
  const [openapi, setOpenapi] = useState("");
  const [everyRole, setEveryRole] = useState(true);
  const [roles, setRoles] = useState<AgentRole[]>(["engineer"]);
  const [errors, setErrors] = useState<{ label?: string; target?: string; roles?: string }>({});
  const [ok, setOk] = useState<string | null>(null);
  const add = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOk(null);
    const next: typeof errors = {};
    if (!label.trim()) next.label = "Name it, so the crew and you can tell connectors apart.";
    if (!target.trim()) next.target = kind === "mcp_stdio" ? "Give the command that starts the server." : "Give the URL.";
    else if (kind !== "mcp_stdio" && !/^https?:\/\/\S+$/i.test(target.trim())) next.target = "Use a full URL that starts with https://.";
    if (!everyRole && roles.length === 0) next.roles = "Tick at least one role, or let every role use it.";
    setErrors(next);
    if (next.label || next.target || next.roles) return;
    const body: CreateConnectorBody = {
      kind,
      label: label.trim(),
      target: target.trim(),
      roles: everyRole ? null : roles,
      ...(secret ? { secret } : {}),
      ...(kind === "http_api" && authHeader.trim() ? { authHeader: authHeader.trim() } : {}),
      ...(kind === "http_api" && openapi.trim() ? { openapi: openapi.trim() } : {}),
    };
    void add.run(async () => {
      const created = await api.call("POST /api/connectors", { body });
      // the secret left the page with the request; the field never keeps it
      setSecret("");
      onAdded(created);
      let tested = created;
      try {
        tested = await api.call("POST /api/connectors/:id/test", { params: { id: created.id } });
        onAdded(tested);
      } catch {
        // the row shows the error state and its own Test button
      }
      setOk(`${tested.label} added${tested.status === "connected" ? ` with ${tested.tools.length} ${tested.tools.length === 1 ? "tool" : "tools"}` : ", the test did not connect yet"}.`);
      setLabel("");
      setTarget("");
      setOpenapi("");
    });
  };

  const t = TARGET[kind];
  const sec = SECRET[kind];
  return (
    <Region container="card" title="Add a connector" className="app-card connector-add" meta="Point the crew at a server, test it, and pick who may use it.">
      <form className="app-form" onSubmit={submit} noValidate>
        <RadioGroup<ConnectorKind>
          legend="Kind"
          name="connector-kind"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setErrors({});
          }}
          options={[
            { value: "mcp_stdio", label: "MCP server, local command", description: "Starts on this machine and talks over stdio." },
            { value: "mcp_http", label: "MCP server, remote URL", description: "A hosted MCP server over HTTP." },
            { value: "http_api", label: "HTTP API", description: "Any REST API; an OpenAPI document turns its endpoints into tools." },
          ]}
        />
        <TextField label="Name" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder={kind === "http_api" ? "Broker API" : "GitHub"} error={errors.label} hint="Shown to the crew beside each tool" />
        <TextField label={t.label} value={target} onChange={(e) => setTarget(e.target.value)} placeholder={t.placeholder} spellCheck={false} autoCapitalize="off" error={errors.target} hint={t.hint} />
        {kind === "http_api" ? (
          <div className="field-row">
            <TextField label="Auth header" value={authHeader} onChange={(e) => setAuthHeader(e.target.value)} spellCheck={false} autoCapitalize="off" hint="For example Authorization or X-API-KEY" />
            <TextField label="Secret" type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} hint={sec.hint} />
          </div>
        ) : kind === "mcp_stdio" ? (
          <TextArea label={sec.label} value={secret} onChange={(e) => setSecret(e.target.value)} rows={2} spellCheck={false} autoCapitalize="off" placeholder="GITHUB_TOKEN=..." hint={sec.hint} className="connector-secret" />
        ) : (
          <TextField label={sec.label} type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} hint={sec.hint} />
        )}
        {kind === "http_api" ? (
          <TextField label="OpenAPI document" value={openapi} onChange={(e) => setOpenapi(e.target.value)} placeholder="https://api.example.com/openapi.json" spellCheck={false} autoCapitalize="off" hint="Optional. With it, each endpoint becomes a tool of its own." />
        ) : null}
        <fieldset className="app-checks">
          <legend className="field-label">Who may use it</legend>
          <Checkbox label="Every role" description={everyRole ? "Every cat on the crew can call its tools." : "Only the roles you tick below."} checked={everyRole} onChange={setEveryRole} />
          {everyRole ? null : (
            <div className="connector-roles">
              {SCOPE_ROLES.map((r) => (
                <Checkbox
                  key={r}
                  label={r === "lead" ? "CEO" : ROLE_LABEL[r]}
                  checked={roles.includes(r)}
                  onChange={(on) => setRoles((cur) => (on ? [...cur, r] : cur.filter((x) => x !== r)))}
                />
              ))}
            </div>
          )}
          <p className="field-hint" data-state={errors.roles ? "error" : undefined} aria-live="polite">
            {errors.roles ?? "Roles you leave out never see its tools."}
          </p>
        </fieldset>
        <div className="app-form-actions">
          <button type="submit" aria-busy={add.busy || undefined}>
            <ProductIcon name="plus" size={20} />
            <span>Add and test</span>
          </button>
        </div>
        <FormStatus ok={ok} error={add.error} />
      </form>
    </Region>
  );
}

export function ConnectorsScreen() {
  const { api } = useApp();
  const now = useNow(60_000);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const list = useResource(
    (signal) =>
      api.call("GET /api/connectors", { signal }).catch((e: unknown) => {
        setLoadErr(e);
        throw e;
      }),
    "connectors",
  );
  const [removing, setRemoving] = useState<ConnectorDTO | null>(null);
  const remove = useAction();
  const missing = !!list.error && loadErr instanceof ApiError && (loadErr.status === 404 || loadErr.status === 501);
  const data = list.data ?? [];
  const connected = data.filter((c) => c.status === "connected").length;
  const tools = data.reduce((n, c) => n + (c.status === "connected" ? c.tools.length : 0), 0);

  const upsert = (c: ConnectorDTO) => list.setData((prev) => (prev?.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? c : x)) : [...(prev ?? []), c]));

  return (
    <Page>
      <PageHead title="Connectors" lead="Give the crew tools from MCP servers and HTTP APIs. Keys go to the vault and never come back to this page." />
      <div className="app-split connectors-split">
        <div className="app-split-main">
          <Region
            container="rows"
            title="Your connectors"
            className="connectors-list"
            meta={list.data && data.length ? `${data.length} ${data.length === 1 ? "connector" : "connectors"}, ${connected} connected, ${tools} ${tools === 1 ? "tool" : "tools"} for the crew` : undefined}
          >
            {list.loading && !list.data ? (
              <SkeletonRows rows={3} label="Loading connectors" />
            ) : missing ? (
              <EmptyState icon="cpu" title="Connectors are not on this server yet">
                Once they are, every MCP server and HTTP API you add shows here with its tools and who may use them.
              </EmptyState>
            ) : list.error ? (
              <EmptyState icon="alertCircle" tone="danger" title="Connectors did not load" action={<button type="button" onClick={list.reload}>Try again</button>}>
                {list.error}
              </EmptyState>
            ) : data.length === 0 ? (
              <EmptyState icon="cpu" title="No connectors yet">
                Add an MCP server or an HTTP API and the roles you pick can call its tools.
              </EmptyState>
            ) : (
              <ul className="p-rows" data-variant="boxed" aria-label="Connectors">
                {data.map((c) => (
                  <ConnectorRow key={c.id} c={c} now={now} onChange={upsert} onRemove={setRemoving} />
                ))}
              </ul>
            )}
          </Region>

          <section className="app-region connector-safety" data-container="plain" aria-labelledby="safety-h">
            <h2 className="app-h2" id="safety-h">
              How risky tools are handled
            </h2>
            <p className="app-region-meta">A test marks every tool with one of four risks. Placing an order or moving money is always sensitive.</p>
            <ul className="connector-risks">
              {RISK_LINES.map(([r, text]) => (
                <li className="connector-risk" key={r}>
                  <StatusPill tone={RISK[r].tone} icon={RISK[r].icon}>
                    {RISK[r].word}
                  </StatusPill>
                  <span className="connector-risk-text">{text}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="app-split-side">{missing ? null : <AddConnector onAdded={upsert} />}</div>
      </div>

      <Sheet
        open={!!removing}
        onClose={() => setRemoving(null)}
        alert
        dismissible={false}
        title={removing ? `Remove ${removing.label}?` : "Remove the connector?"}
        description="You can add it again any time with a fresh secret."
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
                  await api.call("DELETE /api/connectors/:id", { params: { id: removing.id } });
                  list.setData((prev) => (prev ?? []).filter((x) => x.id !== removing.id));
                  setRemoving(null);
                })
              }
            >
              Remove
            </button>
          </>
        }
      >
        <p className="app-body-muted">{removing ? `The crew loses ${removing.tools.length} ${removing.tools.length === 1 ? "tool" : "tools"}.` : null}</p>
        <FormStatus error={remove.error} />
      </Sheet>
    </Page>
  );
}
