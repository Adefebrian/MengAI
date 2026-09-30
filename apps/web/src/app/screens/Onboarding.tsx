// The runtime gate, inside the app shell. MengAI has no accounts and the
// website keeps nothing, so there is no sign in: the page finds the MengAI
// runtime on this machine and pairs with it once.
//   RuntimeOfflineScreen  nothing answers: download the Mac app, open it,
//                         click Open in browser (or bun run dev); the page
//                         looks again every few seconds on its own
//   PairScreen            the runtime answers but this browser holds no
//                         session: Open in browser from the menu, or paste
//                         the pairing link
// Regions per JEV ui.region_gate: the steps in plain spacing (2.65; card
// 0.36 sat beside the address card, so the runner-up), the address and
// the pasted link in a card (1.74, card 0.55). Oyen waits in the head.
import { Cat } from "@mengai/cats";
import { Notice, ProductIcon } from "@mengai/ui/src/product";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import {
  DEFAULT_RUNTIME_URL,
  MAC_DOWNLOAD_URL,
  normalizeRuntimeUrl,
  readPairLink,
  readRuntimeSetting,
  runtimeLabel,
  writeRuntimeSetting,
  type PairLink,
} from "../../api/runtime";
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
        Looking for MengAI at <span className="num">{where}</span> every few seconds. This page moves on by itself once it answers.
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
      setError("Use an address on this machine, like 127.0.0.1:4190 or localhost:4190.");
      return;
    }
    setError(null);
    writeRuntimeSetting(norm === DEFAULT_RUNTIME_URL ? null : norm);
    setValue(norm);
    setOk(`Saved. Looking at ${norm.replace(/^https?:\/\//, "")} now.`);
    onSaved();
  };
  return (
    <Region container="card" title="Runtime address" className="app-card onboard-card" meta="Where this page looks for MengAI. Only an address on this machine is allowed, so your keys never leave it.">
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
          hint="The Mac app and bun run dev both answer on 127.0.0.1:4190."
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

export function RuntimeOfflineScreen({ tried, onRetry, still }: { tried: string[]; onRetry: () => void; still: boolean }) {
  const where = runtimeLabel(tried.at(-1) ?? DEFAULT_RUNTIME_URL);
  return (
    <Page>
      <Head
        title="Oyen is not answering yet"
        lead="MengAI runs on your own machine. This page is only the window: your keys, your projects and the whole crew stay with you, and the website keeps nothing."
        still={still}
      />
      <div className="app-split onboard-split">
        <div className="app-split-main">
          <Steps
            title="Wake the crew in three steps"
            steps={[
              { title: "Download MengAI for Mac", text: "Free and open source. Drag it into Applications." },
              { title: "Open it", text: "Oyen curls up in your menu bar and the crew wakes on this machine." },
              { title: "Click Open in browser in its menu", text: "This page pairs with it in one click, and the crew comes to the window." },
            ]}
          >
            <p className="app-region-meta">
              Running from the source instead? Run <code className="num">bun run dev</code> in the repo and open the link it prints.
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
            <Looking where={where} />
          </Steps>
        </div>
        <div className="app-split-side">
          <AddressCard onSaved={onRetry} />
        </div>
      </div>
    </Page>
  );
}

export function PairScreen({
  base,
  error,
  onRetry,
  onPair,
  pairing,
  still,
}: {
  base: string;
  error: string | null;
  onRetry: () => void;
  onPair: (link: PairLink) => void;
  pairing: boolean;
  still: boolean;
}) {
  const [link, setLink] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const where = runtimeLabel(base);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = readPairLink(link);
    if (!parsed) {
      setFieldError("Paste the whole link, the part after #pair= included.");
      return;
    }
    setFieldError(null);
    setLink("");
    onPair(parsed);
  };
  return (
    <Page>
      <Head
        title="Almost there. Pair this browser."
        lead={`MengAI is awake at ${where}, but this browser has no key to its door yet. Pairing takes one click, and the key it gets stays in this browser and on your machine.`}
        still={still}
      />
      {error ? (
        <Notice tone="warning" title="Not paired yet">
          {error}
        </Notice>
      ) : null}
      <div className="app-split onboard-split">
        <div className="app-split-main">
          <Steps
            title="Pair it once"
            steps={[
              { title: "Open the MengAI menu", text: "The paw in your menu bar." },
              { title: "Click Open in browser", text: "A one-time link opens this page and pairs it. A copied link cannot pair anyone else." },
            ]}
          >
            <p className="app-region-meta">
              Running <code className="num">bun run dev</code>? Open the pairing link it printed, or paste it into the pairing link field.
            </p>
            <div className="app-form-actions">
              <button type="button" className="btn-secondary" onClick={onRetry}>
                <ProductIcon name="refresh" size={20} />
                <span>Check again</span>
              </button>
              <a className="btn btn-ghost" href="/app/runs/demo?demo=1">
                Watch the sample run
              </a>
            </div>
          </Steps>
        </div>
        <div className="app-split-side">
          <Region container="card" title="Paste a pairing link" className="app-card onboard-card" meta="For a link that opened in another browser. It works once.">
            <form className="app-form" onSubmit={submit} noValidate>
              <TextField
                label="Pairing link"
                type="password"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                placeholder={`${typeof window === "undefined" ? "" : window.location.origin}/app#pair=`}
                error={fieldError}
                hint="Hidden as you paste, like a password: it is one."
              />
              <div className="app-form-actions">
                <button type="submit" aria-busy={pairing || undefined}>
                  Pair this browser
                </button>
              </div>
            </form>
          </Region>
        </div>
      </div>
    </Page>
  );
}
