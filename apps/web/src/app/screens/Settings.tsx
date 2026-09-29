// Settings (/app/settings): the defaults every run starts from and how
// much the app and the cats move. Regions per JEV ui.region_gate: head
// plain, budgets card, crew plain, network plain, motion card (session was
// dropped at relevance 1.15, so it is not built).
import type { OwnerSettings } from "@mengai/shared";
import { SkeletonRows } from "@mengai/ui/src/product";
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
  }, [settings]);

  const patch = async (p: Partial<OwnerSettings>) => {
    const next = await api.call("PATCH /api/settings", { body: p });
    setSettings(next);
    return next;
  };

  const saveBudget = (e: FormEvent) => {
    e.preventDefault();
    setBudgetOk(null);
    const t = Number(tokens.replace(/[^0-9]/g, ""));
    const u = Number(usd.replace(/[^0-9.]/g, ""));
    if (!t || t < 1000) {
      setTokenError("Use at least 1,000 tokens.");
      return;
    }
    setTokenError(null);
    void budget.run(async () => {
      const next = await patch({ defaultBudgetTokens: t, defaultBudgetUsd: u || 0 });
      setBudgetOk(`Saved. New runs stop at ${fmtInt(next.defaultBudgetTokens)} tokens or $${next.defaultBudgetUsd}.`);
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

  if (!settings) {
    return (
      <Page>
        <PageHead title="Settings" lead="Defaults for every new run, and how much the cats move." />
        <SkeletonRows rows={4} label="Loading settings" />
      </Page>
    );
  }

  const budgetsRegion = (
    <Region container="card" title="Budgets" className="app-card settings-budgets" meta="Every run stops at whichever limit comes first. You can change it per run.">
      <form className="app-form" onSubmit={saveBudget} noValidate>
        <div className="field-row">
          <TextField label="Tokens per run" inputMode="numeric" value={tokens} onChange={(e) => setTokens(e.target.value)} error={tokenError} hint="Input and output together" />
          <TextField label="USD per run" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} hint="Billed to your own keys" />
        </div>
        <div className="app-form-actions">
          <button type="submit" aria-busy={budget.busy || undefined}>
            Save budgets
          </button>
        </div>
        <FormStatus ok={budgetOk} error={budget.error} />
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

  // DOM order follows the region gate (budgets, crew, network, motion); two
  // columns from 1024px, each a stack, so no two cards share a row.
  return (
    <Page>
      <PageHead title="Settings" lead="Defaults for every new run, and how much the cats move." />
      <div className="settings-grid">
        <div className="settings-col">
          {budgetsRegion}
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
