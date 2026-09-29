// About (/app/about): who built MengAI, under which license, what runs.
// Head plain (the card runner-up would box the page title, which the law
// refuses, so the next lawful option), facts as a divided section. Credits
// were dropped by JEV (relevance 1.21).
import { Cat } from "@mengai/cats";
import { KeyValue } from "@mengai/ui/src/product";
import { useApp } from "../context";
import { useResource } from "../hooks";
import { Page, Region } from "../ui";

const REPO = "https://github.com/adefebrian/mengai";
const AUTHOR = "https://github.com/adefebrian";
const LICENSE = `${REPO}/blob/main/LICENSE`;

export function AboutScreen() {
  const { api, session, catsStill } = useApp();
  const health = useResource((signal) => api.call("GET /api/health", { signal }), "health");
  return (
    <Page>
      <header className="app-head about-head">
        <span className="about-cat">
          <Cat look={{ coat: "ginger", seed: 1204 }} role="lead" status="idle" activity="rest" mood="calm" label="Kopi, the lead cat, resting" size={96} still={catsStill} />
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
            { label: "Mode", value: session.mode === "local" ? "Local, on this Mac only" : "Server" },
            { label: "Built by", value: <a href={AUTHOR} rel="noreferrer" target="_blank">Adefebrian</a> },
            { label: "License", value: <a href={LICENSE} rel="noreferrer" target="_blank">Apache License 2.0</a> },
            { label: "Source", value: <a href={REPO} rel="noreferrer" target="_blank" className="num">github.com/adefebrian/mengai</a> },
            { label: "Models", value: "Your own keys, any provider. Default OpenAI gpt-4o-mini." },
          ]}
        />
      </Region>
    </Page>
  );
}
