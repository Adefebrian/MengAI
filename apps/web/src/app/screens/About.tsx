// About (/app/about): who built MengAI, under which license, what runs,
// and how this browser reaches it. Head plain (the card runner-up would box
// the page title, which the law refuses, so the next lawful option), facts
// as a divided section, this browser in plain spacing (JEV ui.region_gate
// b_session kept at 2.15; its card primary would sit on the card above, so
// the next lawful option). There are no accounts and no sign in: the page
// talks straight to the engine on this Mac, so there is nothing to unpair.
import { Cat } from "@mengai/cats";
import { leadCatName } from "@mengai/shared";
import { KeyValue } from "@mengai/ui/src/product";
import { useApp } from "../context";
import { useResource } from "../hooks";
import { Page, Region } from "../ui";

const REPO = "https://github.com/Adefebrian/MengAI";
const AUTHOR = "https://github.com/Adefebrian";
const LICENSE = `${REPO}/blob/main/LICENSE`;

export function AboutScreen() {
  const { api, catsStill, settings, runtime, demo } = useApp();
  const ceo = leadCatName(settings?.ceoName);
  const health = useResource((signal) => api.call("GET /api/health", { signal }), "health");
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
            ? "Sample data only. Nothing here talks to an engine."
            : runtime.own
              ? `Served by MengAI itself at ${runtime.label}. Nothing to sign in to: quit MengAI from the menu bar to close it.`
              : `Talks straight to MengAI at ${runtime.label} on this Mac. Nothing to sign in to and no key in this browser; only your view settings stay here.`
        }
      >
        {demo ? null : <p className="app-empty-line">The engine only answers this Mac, and only the sites on its own list.</p>}
      </Region>
    </Page>
  );
}
