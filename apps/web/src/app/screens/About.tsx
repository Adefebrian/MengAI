// About (/app/about): who built MengAI, under which license, what runs,
// and how you are signed in. Head plain (the card runner-up would box the
// page title, which the law refuses, so the next lawful option), facts as a
// divided section, the session in plain spacing (JEV ui.region_gate
// b_session kept at 2.15; its card primary would sit on the card above, so
// the next lawful option). The session left Settings, where JEV dropped it
// (relevance 1.40).
import { Cat } from "@mengai/cats";
import { KeyValue, ProductIcon } from "@mengai/ui/src/product";
import { useApp } from "../context";
import { useAction, useResource } from "../hooks";
import { FormStatus, Page, Region } from "../ui";

const REPO = "https://github.com/adefebrian/mengai";
const AUTHOR = "https://github.com/adefebrian";
const LICENSE = `${REPO}/blob/main/LICENSE`;

export function AboutScreen() {
  const { api, session, catsStill } = useApp();
  const health = useResource((signal) => api.call("GET /api/health", { signal }), "health");
  const out = useAction();
  const signOut = () =>
    out.run(async () => {
      await api.call("POST /api/auth/logout");
      window.location.assign("/app");
    });
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
      <Region container="plain" title="Your session" meta={session.mode === "local" ? "Signed in locally through the Mac app. To end it, quit MengAI from the menu bar." : `Signed in as the owner${session.owner ? `, ${session.owner.email}` : ""}.`}>
        {session.mode === "server" ? (
          <div className="app-form-actions">
            <button type="button" className="btn-secondary" aria-busy={out.busy || undefined} onClick={signOut}>
              <ProductIcon name="logout" size={20} />
              <span>Sign out</span>
            </button>
            <FormStatus error={out.error} />
          </div>
        ) : null}
      </Region>
    </Page>
  );
}
