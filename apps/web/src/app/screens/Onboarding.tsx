// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The engine gate, inside the app shell. MengAI has no accounts and the
// website keeps nothing, so there is nothing to sign in to and no code to
// copy: the crew engine runs on the owner's own Mac, and this page finds it
// on its own.
//   RuntimeOfflineScreen  nothing answers: download the Mac app and open
//                         it (or run bun run dev from the repo); the page
//                         looks again every 2 s and moves on by itself.
//                         When something answers but refuses this site
//                         (a site that is not on the engine's list), the
//                         same screen says so and links the engine's own
//                         page.
// Regions per JEV ui.region_gate: the steps in plain spacing (2.65; card
// 0.36 sat beside the address card, so the runner-up), the address in a
// card (1.74, card 0.55). Oyen waits in the head.
import { Cat } from "@mengai/cats";
import { Notice, ProductIcon } from "@mengai/ui/src/product";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { DEFAULT_RUNTIME_URL, MAC_DOWNLOAD_URL, normalizeRuntimeUrl, originOf, readRuntimeSetting, runtimeLabel, writeRuntimeSetting } from "../../api/runtime";
import { FormStatus, Page, Region, TextField } from "../ui";

function Head({ title, lead, still }: { title: string; lead: string; still: boolean }) {
  return (
    <header className="app-head onboard-head">
      <span className="onboard-cat">
        <Cat look={{ coat: "ginger", seed: 1204 }} role="lead" status="waiting" activity="wait" mood="calm" label="Oyen, the CEO cat, waiting for you" size={96} still={still} />
      </span>
      <div className="app-head-text">
        <h1 className="app-title">{title}</h1>
        <p className="app-lead">{lead}</p>
      </div>
    </header>
  );
}

function Steps({ title, steps, children }: { title: string; steps: Array<{ title: string; text: ReactNode }>; children?: ReactNode }) {
  const hid = useId();
  return (
    <section className="app-region onboard-steps" data-container="plain" aria-labelledby={hid}>
      <h2 className="app-h2" id={hid}>
        {title}
      </h2>
      <ol className="onboard-list">
        {steps.map((s, i) => (
          <li className="onboard-step" key={s.title}>
            <span className="onboard-num num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="onboard-text">
              <span className="onboard-title">{s.title}</span>
              <span className="onboard-desc">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
      {children}
    </section>
  );
}

function Looking({ where }: { where: string }) {
  return (
    <p className="onboard-looking" aria-live="polite">
      <ProductIcon name="hourglass" size={16} />
      <span>
        Looking for MengAI at <span className="num">{where}</span> every 2 seconds. This page moves on by itself once it answers.
      </span>
    </p>
  );
}

function AddressCard({ onSaved }: { onSaved: () => void }) {
  const saved = readRuntimeSetting();
  const [value, setValue] = useState(saved ?? DEFAULT_RUNTIME_URL);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const norm = normalizeRuntimeUrl(value);
    if (!norm) {
      setOk(null);
      setError("Use an address on this machine, like 127.0.0.1:4280 or localhost:4280.");
      return;
    }
    setError(null);
    writeRuntimeSetting(norm === DEFAULT_RUNTIME_URL ? null : norm);
    setValue(norm);
    setOk(`Saved. Looking at ${norm.replace(/^https?:\/\//, "")} now.`);
    onSaved();
  };
  return (
    <Region container="card" title="Engine address" className="app-card onboard-card" meta="Where this page looks for MengAI. Only an address on this Mac is allowed, so your keys never leave it.">
      <form className="app-form" onSubmit={submit} noValidate>
        <TextField
          label="Address"
          className="num"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          inputMode="url"
          error={error}
          hint="The Mac app and bun run dev answer on 127.0.0.1:4280, or the next free port up to 4289. This page finds it by itself."
        />
        <div className="app-form-actions">
          <button type="submit">Save and look again</button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              writeRuntimeSetting(null);
              setValue(DEFAULT_RUNTIME_URL);
              setError(null);
              setOk("Back to the default address.");
              onSaved();
            }}
          >
            Use the default
          </button>
        </div>
        <FormStatus ok={ok} />
      </form>
    </Region>
  );
}

export function RuntimeOfflineScreen({ where, refused, onRetry, still }: { where: string | null; refused: boolean; onRetry: () => void; still: boolean }) {
  const label = runtimeLabel(where ?? DEFAULT_RUNTIME_URL);
  const own = `${originOf(where ?? DEFAULT_RUNTIME_URL)}/app`;
  const site = typeof window === "undefined" ? "this site" : window.location.origin;
  return (
    <Page>
      <Head
        title={refused ? "Oyen is awake, but the door is shut" : "Oyen is not answering yet"}
        lead="MengAI runs on your own Mac. This page is only the window: your keys, your projects and the whole crew stay with you, and the website keeps nothing."
        still={still}
      />
      {refused ? (
        <Notice tone="warning" title="MengAI does not take requests from this site">
          It answers at <span className="num">{label}</span>, but only for the sites on its own list, and <span className="num">{site}</span> is not on it. Open{" "}
          <a href={own} className="num" rel="noreferrer">
            {label}/app
          </a>{" "}
          instead, the same crew in MengAI's own window, or add this site to MengAI's settings file and reopen it.
        </Notice>
      ) : null}
      <div className="app-split onboard-split">
        <div className="app-split-main">
          <Steps
            title="Wake the crew in three steps"
            steps={[
              { title: "Download MengAI for Mac", text: "Free for personal and noncommercial use, a beta for now. Drag it into Applications." },
              { title: "Open it", text: "Oyen curls up in your menu bar and the crew wakes on this Mac, on your own resources." },
              { title: "This page connects by itself", text: "No code to copy and nothing to sign in to. Keep this tab open and the crew comes to the window." },
            ]}
          >
            <p className="app-region-meta">
              Running from the source instead? Run <code className="num">bun run dev</code> in the repo and keep this page open.
            </p>
            <div className="app-form-actions">
              <a className="btn" href={MAC_DOWNLOAD_URL} rel="noreferrer">
                <ProductIcon name="download" size={20} />
                <span>Download for Mac</span>
              </a>
              <button type="button" className="btn-secondary" onClick={onRetry}>
                <ProductIcon name="refresh" size={20} />
                <span>Check again</span>
              </button>
              <a className="btn btn-ghost" href="/app/runs/demo?demo=1">
                Watch the sample run
              </a>
            </div>
            <Looking where={label} />
          </Steps>
        </div>
        <div className="app-split-side">
          <AddressCard onSaved={onRetry} />
        </div>
      </div>
    </Page>
  );
}
