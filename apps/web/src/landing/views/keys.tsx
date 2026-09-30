// The keys view (sections/Keys.tsx; critic fix round 2: the feature list of
// icon glyphs became one app view on labelled sample data, as the security
// bento does). The app's Providers, Connectors and Trading settings in
// small, each part the app's own row anatomy (screens/Providers.tsx,
// screens/Connectors.tsx, screens/Trading.tsx) on sample values:
//   provider   a custom OpenAI compatible gateway, its key ending q7Zk, and
//              a Test button that answers
//   tiers      fast, balanced and deep, each mapped to a model id the owner
//              added (sample ids on the owner's own gateway: MengAI has no
//              house model and names none)
//   connector  an MCP server over HTTP, its token in the keychain, with the
//              Enabled switch
//   trading    the Paper and Live switch; Live says what it takes
// The screens themselves need the signed-in app (its API client and
// context), so the view repeats their anatomy on sample data instead of
// importing them.
// Release round (JEV ui.component_recipe guard_placement
// guard_panel_above_view 0.90): above the view, in a slim panel of its
// own (the landing's character, not the app's UI), Garong, the roster's
// security cat, sits beside a flat keychain vault that holds the view's two
// keys and says so in one line. Each press of Test nods Garong's head once
// and lands a tick on the vault (transform and opacity only, tier 1);
// under reduced motion the cat holds still and the tick fades in.
import { Cat, lookFor, rosterCat } from "@mengai/cats";
import { ProductIcon, StatusPill } from "@mengai/ui/src/product";
import { useId, useState, type ReactNode } from "react";

export const SAMPLE_PROVIDER = {
  label: "Team gateway",
  preset: "Custom, OpenAI compatible",
  url: "https://llm.example.com/v1",
  keyHint: "q7Zk",
  models: 3,
  latency: 412,
} as const;

export const SAMPLE_TIERS = [
  { tier: "Fast", job: "Scans and short steps", model: "team/small-8b" },
  { tier: "Balanced", job: "Most coding and review", model: "team/mid-32b" },
  { tier: "Deep", job: "Planning and hard calls", model: "team/large-70b" },
] as const;

export const SAMPLE_CONNECTOR = {
  name: "Issue tracker",
  kind: "MCP over HTTP",
  meta: ["Token in the keychain", "All roles"],
} as const;

/** The vault's guard: the roster's security cat. */
export const GUARD = rosterCat("Garong")!;
/** What Garong says, before any test and after a Test press. */
export const GUARD_LINES = {
  idle: "Two keys in the vault. Not one in a log.",
  tested: "That key works. It went straight back in.",
} as const;

/** The flat keychain vault: a safe door with a dial and a handle; the tick lands on its corner once a key tests clean. */
function Vault() {
  return (
    <span className="lp-safe">
      <svg className="lp-safe-svg" viewBox="0 0 96 96" width="96" height="96" aria-hidden="true" focusable="false">
        <g transform="translate(4 0)">
          <rect className="lp-safe-body" x="4" y="14" width="80" height="70" rx="8" />
          <rect className="lp-safe-door" x="12" y="22" width="64" height="54" rx="4" />
          <circle className="lp-safe-dial" cx="36" cy="49" r="13" />
          <path className="lp-safe-notch" d="M36 38.5v3M36 56.5v3M25.5 49h3M43.5 49h3" />
          <path className="lp-safe-pointer" d="M36 49v-7" />
          <circle className="lp-safe-hub" cx="36" cy="49" r="2.5" />
          <rect className="lp-safe-handle" x="58" y="40" width="8" height="18" rx="4" />
          <rect className="lp-safe-foot" x="12" y="84" width="14" height="6" rx="2" />
          <rect className="lp-safe-foot" x="62" y="84" width="14" height="6" rx="2" />
          <g className="lp-safe-tick">
            <circle cx="72" cy="16" r="11" />
            <path d="M67 16.5l3.5 3.5 6.5-7" />
          </g>
        </g>
      </svg>
    </span>
  );
}

/** Garong on the vault. `tests` counts Test presses: each one nods the head once and lands the tick. */
function Guard({ tests }: { tests: number }) {
  const tested = tests > 0;
  return (
    <div className="lp-guard" data-checked={tested ? "true" : "false"} data-nod={tested ? (tests % 2 ? "a" : "b") : undefined}>
      <div className="lp-guard-scene">
        <Cat
          look={lookFor(GUARD.name)}
          role={GUARD.role}
          status="idle"
          activity="rest"
          mood="focused"
          label={`${GUARD.name}, the security cat, guarding the keychain vault`}
          size={96}
        />
        <Vault />
      </div>
      <div className="lp-guard-text">
        <p className="lp-guard-say">
          <q>{tested ? GUARD_LINES.tested : GUARD_LINES.idle}</q>
        </p>
        <p className="lp-guard-who">{GUARD.name}, the security cat, on keychain duty</p>
      </div>
    </div>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="lp-keys-part" aria-labelledby={id}>
      <h3 id={id} className="lp-keys-head">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ProviderPart({ tested, onTest }: { tested: boolean; onTest: () => void }) {
  const p = SAMPLE_PROVIDER;
  return (
    <Part title="Providers">
      <div className="lp-keys-row" data-kind="provider">
        <span className="lp-keys-icon" aria-hidden="true">
          <ProductIcon name="providers" size={20} />
        </span>
        <span className="lp-keys-body">
          <span className="lp-keys-title">
            <span className="lp-view-strong">{p.label}</span>
            <span className="lp-view-muted">{p.preset}</span>
          </span>
          <span className="lp-keys-url">{p.url}</span>
          <span className="lp-keys-meta">
            <span>
              Key ending <span className="kit-num">...{p.keyHint}</span>
            </span>
            <span>
              <span className="kit-num">{p.models}</span> models
            </span>
            <span className="lp-keys-test" data-tone={tested ? "success" : "neutral"} aria-live="polite">
              <ProductIcon name={tested ? "checkCircle" : "clock"} size={16} />
              <span>{tested ? `Answered in ${p.latency} ms` : "Not tested yet"}</span>
            </span>
          </span>
        </span>
        <button type="button" className="btn-secondary lp-keys-action" onClick={onTest}>
          Test
        </button>
      </div>
    </Part>
  );
}

function TierPart() {
  return (
    <Part title="Model tiers">
      <dl className="lp-keys-tiers">
        {SAMPLE_TIERS.map((t) => (
          <div key={t.tier} className="lp-keys-tier">
            <dt className="lp-keys-tier-name">
              <span className="lp-view-strong">{t.tier}</span>
              <span className="lp-view-muted">{t.job}</span>
            </dt>
            <dd className="lp-keys-model kit-num">{t.model}</dd>
          </div>
        ))}
      </dl>
    </Part>
  );
}

function ConnectorPart() {
  const [on, setOn] = useState(true);
  const c = SAMPLE_CONNECTOR;
  return (
    <Part title="Connectors">
      <div className="lp-keys-row" data-kind="connector">
        <span className="lp-keys-icon" aria-hidden="true">
          <ProductIcon name="cpu" size={20} />
        </span>
        <span className="lp-keys-body">
          <span className="lp-keys-title">
            <span className="lp-view-strong">{c.name}</span>
            <span className="lp-view-muted">{c.kind}</span>
          </span>
          <span className="lp-keys-meta">
            {c.meta.map((m) => (
              <span key={m}>{m}</span>
            ))}
          </span>
        </span>
        <button type="button" role="switch" aria-checked={on} aria-label={`${c.name} enabled`} className="lp-switch lp-keys-switch" data-tone="on" onClick={() => setOn((v) => !v)}>
          <span className="lp-switch-track" aria-hidden="true" />
          <span className="lp-view-strong">{on ? "Enabled" : "Off"}</span>
        </button>
      </div>
    </Part>
  );
}

function TradingPart() {
  const [live, setLive] = useState(false);
  return (
    <Part title="Trading">
      <div className="lp-keys-trade">
        <div className="lp-kinds lp-keys-mode" role="group" aria-label="Trading mode">
          <button type="button" className="lp-kind" aria-pressed={!live} onClick={() => setLive(false)}>
            <span>Paper</span>
          </button>
          <button type="button" className="lp-kind" aria-pressed={live} onClick={() => setLive(true)}>
            <span>Live</span>
          </button>
        </div>
        <p className="lp-keys-trade-state" aria-live="polite">
          {live ? (
            <StatusPill tone="warning" icon="approvals" variant="pill">
              Each order waits for your yes
            </StatusPill>
          ) : (
            <StatusPill tone="success" icon="checkCircle" variant="pill">
              Simulated, no real money
            </StatusPill>
          )}
        </p>
      </div>
    </Part>
  );
}

export function KeysView() {
  const [tests, setTests] = useState(0);
  return (
    <div className="lp-keys-media">
      <Guard tests={tests} />
      <div className="lp-keys-view" role="group" aria-label="Keys, models, tools and trading in the app, on sample data">
        <ProviderPart tested={tests > 0} onTest={() => setTests((n) => n + 1)} />
        <TierPart />
        <ConnectorPart />
        <TradingPart />
      </div>
      <p className="lp-keys-note">Sample. In the app these are your own keys, models and tools.</p>
    </div>
  );
}
