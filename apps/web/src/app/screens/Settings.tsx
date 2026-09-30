// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Settings (/app/settings): the defaults every run starts from and how
// much the app and the cats move. Regions per JEV ui.region_gate: head
// plain, budgets card, company divided (2.93; its card primary sat on the
// budgets card, so the runner-up), crew plain, network plain, motion card
// (session was dropped at relevance 1.15, so it is not built). A budget or
// a cap of 0 is unlimited: the budget says so in a warning while it is 0,
// the org caps read Unlimited.
import { leadCatName, type OwnerSettings } from "@mengai/shared";
import { Notice, SkeletonRows } from "@mengai/ui/src/product";
import { useEffect, useState, type FormEvent } from "react";
import { useApp, type CatMotion } from "../context";
import { fmtInt } from "../format";
import { useAction } from "../hooks";
import { FormStatus, Page, PageHead, Region, Segmented, Switch, TextField } from "../ui";

export function SettingsScreen() {
  const { api, settings, setSettings, catMotion, setCatMotion, motion } = useApp();
  const [tokens, setTokens] = useState("");
  const [usd, setUsd] = useState("");
  const [agents, setAgents] = useState("");
  const [ceoName, setCeoName] = useState("");
  const [maxAgents, setMaxAgents] = useState("");
  const [maxDepth, setMaxDepth] = useState("");
  const [orgOk, setOrgOk] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<{ agents?: string; depth?: string }>({});
  const org = useAction();
  const [budgetOk, setBudgetOk] = useState<string | null>(null);
  const [crewOk, setCrewOk] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const budget = useAction();
  const crew = useAction();
  const toggle = useAction();

  useEffect(() => {
    if (!settings) return;
    setTokens(String(settings.defaultBudgetTokens));
    setUsd(String(settings.defaultBudgetUsd));
    setAgents(String(settings.maxConcurrentAgents));
    setCeoName(settings.ceoName ?? "");
    setMaxAgents(String(settings.maxAgents ?? 0));
    setMaxDepth(String(settings.maxDepth ?? 0));
  }, [settings]);

  const patch = async (p: Partial<OwnerSettings>) => {
    const next = await api.call("PATCH /api/settings", { body: p });
    setSettings(next);
    return next;
  };

  const saveBudget = (e: FormEvent) => {
    e.preventDefault();
    setBudgetOk(null);
    const tDigits = tokens.replace(/[^0-9]/g, "");
    const t = Number(tDigits);
    const u = Number(usd.replace(/[^0-9.]/g, "") || "0");
    if (!tDigits || (t > 0 && t < 1000)) {
      setTokenError("Use 0 for no cap, or at least 1,000 tokens.");
      return;
    }
    setTokenError(null);
    void budget.run(async () => {
      const next = await patch({ defaultBudgetTokens: t, defaultBudgetUsd: Number.isFinite(u) ? u : 0 });
      const tok = next.defaultBudgetTokens ? `${fmtInt(next.defaultBudgetTokens)} tokens` : "no token cap";
      const cost = next.defaultBudgetUsd ? `$${next.defaultBudgetUsd}` : "no cost cap";
      setBudgetOk(`Saved. New runs start with ${tok} and ${cost}.`);
    });
  };

  const saveCrew = (e: FormEvent) => {
    e.preventDefault();
    setCrewOk(null);
    const n = Number(agents);
    if (!Number.isInteger(n) || n < 1 || n > 12) {
      setAgentError("Pick a whole number from 1 to 12.");
      return;
    }
    setAgentError(null);
    void crew.run(async () => {
      const next = await patch({ maxConcurrentAgents: n });
      setCrewOk(`Saved. Up to ${next.maxConcurrentAgents} cats work at once.`);
    });
  };

  const saveOrg = (e: FormEvent) => {
    e.preventDefault();
    setOrgOk(null);
    const a = Number(maxAgents.trim() || "0");
    const d = Number(maxDepth.trim() || "0");
    const errors: typeof orgError = {};
    if (!Number.isInteger(a) || a < 0) errors.agents = "Use 0 for no cap, or a whole number.";
    if (!Number.isInteger(d) || d < 0) errors.depth = "Use 0 for no cap, or a whole number.";
    setOrgError(errors);
    if (errors.agents || errors.depth) return;
    void org.run(async () => {
      const next = await patch({ ceoName: ceoName.trim(), maxAgents: a, maxDepth: d });
      const name = leadCatName(next.ceoName);
      setOrgOk(`Saved. ${name} runs every new company, ${next.maxAgents ? `up to ${next.maxAgents} ${next.maxAgents === 1 ? "cat" : "cats"}` : "with no cap on cats"}, ${next.maxDepth ? `${next.maxDepth} ${next.maxDepth === 1 ? "level" : "levels"} deep` : "as deep as the work needs"}.`);
    });
  };

  if (!settings) {
    return (
      <Page>
        <PageHead title="Settings" lead="Defaults for every new run, and how much the cats move." />
        <SkeletonRows rows={4} label="Loading settings" />
      </Page>
    );
  }

  const zeroTokens = tokens.trim() !== "" && Number(tokens.replace(/[^0-9]/g, "") || "1") === 0;
  const zeroUsd = usd.trim() !== "" && Number(usd.replace(/[^0-9.]/g, "") || "1") === 0;
  const budgetsRegion = (
    <Region container="card" title="Budgets" className="app-card settings-budgets" meta="Every run stops at whichever limit comes first. You can change it per run.">
      <form className="app-form" onSubmit={saveBudget} noValidate>
        <div className="field-row">
          <TextField label="Tokens per run" inputMode="numeric" value={tokens} onChange={(e) => setTokens(e.target.value)} error={tokenError} hint="Input and output together. 0 means no cap." />
          <TextField label="USD per run" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} hint="Billed to your own keys. 0 means no cap." />
        </div>
        {zeroTokens || zeroUsd ? (
          <Notice tone="warning" title={zeroTokens && zeroUsd ? "No token or cost cap" : zeroTokens ? "No token cap" : "No cost cap"}>
            With 0, a run keeps spending on your own key until it finishes or you stop it. Stop all in the header always works.
          </Notice>
        ) : null}
        <div className="app-form-actions">
          <button type="submit" aria-busy={budget.busy || undefined}>
            Save budgets
          </button>
        </div>
        <FormStatus ok={budgetOk} error={budget.error} />
      </form>
    </Region>
  );

  const ceo = leadCatName(ceoName);
  const agentsN = Number(maxAgents.trim() || "0");
  const depthN = Number(maxDepth.trim() || "0");
  const companyRegion = (
    <Region container="divided" title="Company" className="settings-company" meta="Who runs every new company, and how big the org may grow.">
      <form className="app-form" onSubmit={saveOrg} noValidate>
        <TextField label="CEO name" value={ceoName} maxLength={24} placeholder="Oyen" onChange={(e) => setCeoName(e.target.value)} hint={`${ceo} plans every run, hires the crew and signs off the report. Empty means Oyen.`} />
        <div className="field-row">
          <TextField
            label="Max cats"
            inputMode="numeric"
            value={maxAgents}
            onChange={(e) => setMaxAgents(e.target.value)}
            error={orgError.agents}
            hint={agentsN > 0 ? `Up to ${fmtInt(agentsN)} ${agentsN === 1 ? "cat" : "cats"}, ${ceo} included.` : "0 means no cap."}
          />
          <TextField
            label="Max depth"
            inputMode="numeric"
            value={maxDepth}
            onChange={(e) => setMaxDepth(e.target.value)}
            error={orgError.depth}
            hint={depthN > 0 ? `${fmtInt(depthN)} ${depthN === 1 ? "level" : "levels"} of the org below ${ceo}.` : "0 means no cap."}
          />
        </div>
        <p className="settings-org-now">
          Now: {agentsN > 0 ? `${fmtInt(agentsN)} ${agentsN === 1 ? "cat" : "cats"} at most` : "Unlimited cats"}, {depthN > 0 ? `${fmtInt(depthN)} ${depthN === 1 ? "level" : "levels"} deep` : "Unlimited depth"}.
        </p>
        <div className="app-form-actions">
          <button type="submit" aria-busy={org.busy || undefined}>
            Save company
          </button>
        </div>
        <FormStatus ok={orgOk} error={org.error} />
      </form>
    </Region>
  );

  const crewRegion = (
    <Region container="plain" title="Crew size" className="settings-crew" meta="How many cats may work at the same time in one run.">
      <form className="app-form settings-inline" onSubmit={saveCrew} noValidate>
        <TextField label="Cats at once" inputMode="numeric" value={agents} onChange={(e) => setAgents(e.target.value)} error={agentError} hint="1 to 12. More cats finish sooner and spend faster." />
        <button type="submit" className="btn-secondary" aria-busy={crew.busy || undefined}>
          Save
        </button>
      </form>
      <FormStatus ok={crewOk} error={crew.error} />
    </Region>
  );

  const networkRegion = (
    <Region container="plain" title="Network tools" className="settings-network" meta="Dependency audits against OSV and web research need the network.">
      <Switch
        label="Allow network tools"
        description={settings.allowNetworkTools ? "On. The security cat checks advisories and the researcher reads the web." : "Off. The crew works offline inside your project folder."}
        checked={settings.allowNetworkTools}
        disabled={toggle.busy}
        onChange={(v) => void toggle.run(() => patch({ allowNetworkTools: v }))}
      />
      <FormStatus error={toggle.error} />
    </Region>
  );

  const motionRegion = (
    <Region
      container="card"
      title="Motion"
      className="app-card settings-motion"
      meta={motion === "off" && settings.motion !== "off" ? "Your system asks for reduced motion, so everything holds still whatever you pick here." : "The system reduced motion setting always wins."}
    >
      <div className="app-form">
        <div className="app-choice-block">
          <Segmented<OwnerSettings["motion"]>
            legend="App motion"
            name="app-motion"
            showLegend
            value={settings.motion}
            options={[
              { value: "full", label: "Full" },
              { value: "calm", label: "Calm" },
              { value: "off", label: "Off" },
            ]}
            onChange={(v) => void toggle.run(() => patch({ motion: v }))}
          />
          <p className="field-hint">Calm keeps the cats alive but stops cards and rows from travelling.</p>
        </div>
        <div className="app-choice-block">
          <Segmented<CatMotion>
            legend="Cat motion on this device"
            name="cat-motion"
            showLegend
            value={catMotion}
            options={[
              { value: "live", label: "Live" },
              { value: "still", label: "Still" },
            ]}
            onChange={setCatMotion}
          />
          <p className="field-hint">Still shows each cat in its pose with its words, and nothing moves.</p>
        </div>
      </div>
    </Region>
  );

  // DOM order follows the region gate (budgets, company, crew, network, motion); two
  // columns from 1024px, each a stack, so no two cards share a row.
  return (
    <Page>
      <PageHead title="Settings" lead="Defaults for every new run, and how much the cats move." />
      <div className="settings-grid">
        <div className="settings-col">
          {budgetsRegion}
          {companyRegion}
          {crewRegion}
        </div>
        <div className="settings-col">
          {networkRegion}
          {motionRegion}
        </div>
      </div>
    </Page>
  );
}
