// About (/app/about): who built MengAI, under which license, what runs,
// and how you are signed in. Head plain (the card runner-up would box the
// page title, which the law refuses, so the next lawful option), facts as a
// divided section, the session in plain spacing (JEV ui.region_gate
// b_session kept at 2.15; its card primary would sit on the card above, so
// the next lawful option). The session left Settings, where JEV dropped it
// (relevance 1.40). There are no accounts: the session is this browser's
// pairing with the runtime on this machine.
import { Cat } from "@mengai/cats";
import { leadCatName } from "@mengai/shared";
import { KeyValue, ProductIcon } from "@mengai/ui/src/product";
import { useApp } from "../context";
import { useAction, useResource } from "../hooks";
import { FormStatus, Page, Region } from "../ui";

const REPO = "https://github.com/Adefebrian/MengAI";
const AUTHOR = "https://github.com/Adefebrian";
const LICENSE = `${REPO}/blob/main/LICENSE`;

export function AboutScreen() {
  const { api, catsStill, settings, runtime, forgetBrowser, demo } = useApp();
  const ceo = leadCatName(settings?.ceoName);
  const health = useResource((signal) => api.call("GET /api/health", { signal }), "health");
  const out = useAction();
  const unpair = () => out.run(forgetBrowser);
  return (
    <Page>
      <header className="app-head about-head">
        <span className="about-cat">
          <Cat look={{ coat: "ginger", seed: 1204 }} role="lead" status="idle" activity="rest" mood="calm" label={`${ceo}, the CEO cat, resting`} size={96} still={catsStill} />
        </span>
        <div className="app-head-text">
          <h1 className="app-title">About MengAI</h1>
          <p className="app-lead">An autonomous agent company where every agent is a cat. Built by Adefebrian, open source under the Apache License 2.0.</p>
        </div>
      </header>
      <Region container="divided" title="This copy" meta="What is running on this machine.">
        <KeyValue
          label="About this copy"
          items={[
            { label: "Version", value: health.data?.version ?? "Checking", mono: true },
            { label: "Runs on", value: demo ? runtime.label : <span className="num">{runtime.label}</span> },
            { label: "Keeps your data", value: "On this machine only. The website stores nothing." },
            { label: "Built by", value: <a href={AUTHOR} rel="noreferrer" target="_blank">Adefebrian</a> },
            { label: "License", value: <a href={LICENSE} rel="noreferrer" target="_blank">Apache License 2.0</a> },
            { label: "Source", value: <a href={REPO} rel="noreferrer" target="_blank" className="num">github.com/Adefebrian/MengAI</a> },
            { label: "Models", value: "Your own keys, any provider, any model." },
          ]}
        />
      </Region>
      <Region
        container="plain"
        title="This browser"
        meta={
          demo
            ? "Sample data only. Nothing here talks to a runtime."
            : runtime.paired
              ? `Paired with MengAI at ${runtime.label}. The key stays in this browser; unpair to drop it.`
              : "Opened by MengAI itself. To end it, quit MengAI from the menu bar."
        }
      >
        {runtime.paired ? (
          <div className="app-form-actions">
            <button type="button" className="btn-secondary" aria-busy={out.busy || undefined} onClick={unpair}>
              <ProductIcon name="logout" size={20} />
              <span>Unpair this browser</span>
            </button>
            <FormStatus error={out.error} />
          </div>
        ) : null}
      </Region>
    </Page>
  );
}
