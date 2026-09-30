// The session gate: local mode without a launch (open MengAI from the menu
// bar), first-run setup and sign in for server mode. One card on the page
// ground, the only place the app uses a centred panel.
import type { SessionDTO } from "@mengai/shared";
import { Cat } from "@mengai/cats";
import { ProductIcon } from "@mengai/ui/src/product";
import { useState, type FormEvent, type ReactNode } from "react";
import type { ApiClient } from "../../api/client";
import { useAction } from "../hooks";
import { FormStatus, TextField } from "../ui";

function Gate({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <main className="gate" id="main">
      <section className="gate-card" aria-labelledby="gate-h">
        <span className="gate-cat">
          <Cat look={{ coat: "ginger", seed: 1204 }} role="lead" status="waiting" activity="wait" mood="calm" label="Oyen, the CEO cat, waiting for you" size={64} still />
        </span>
        <h1 className="app-title" id="gate-h">
          {title}
        </h1>
        <p className="app-lead">{lead}</p>
        {children}
      </section>
    </main>
  );
}

export function LocalLaunchScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <Gate title="Open MengAI from the menu bar" lead="This window has no session yet. The Mac app opens the page with a one-time link, so a copied address cannot sign anyone in.">
      <div className="app-form-actions">
        <button type="button" onClick={onRetry}>
          <ProductIcon name="refresh" size={20} />
          <span>Check again</span>
        </button>
        <a className="btn btn-secondary" href="/app/runs/demo?demo=1">
          Watch the sample run
        </a>
      </div>
    </Gate>
  );
}

export function SetupScreen({ api, onDone }: { api: ApiClient; onDone: (s: SessionDTO) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const act = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void act.run(async () => onDone(await api.call("POST /api/auth/setup", { body: { email: email.trim(), password, setupCode: code.trim() } })));
  };
  return (
    <Gate title="Set up the owner account" lead="One owner per server. The setup code is printed in the server log on first start.">
      <form className="app-form" onSubmit={submit} noValidate>
        <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 12 characters" />
        <TextField label="Setup code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
        <div className="app-form-actions">
          <button type="submit" aria-busy={act.busy || undefined}>
            Create the account
          </button>
        </div>
        <FormStatus error={act.error} />
      </form>
    </Gate>
  );
}

export function LoginScreen({ api, onDone }: { api: ApiClient; onDone: (s: SessionDTO) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const act = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void act.run(async () => onDone(await api.call("POST /api/auth/login", { body: { email: email.trim(), password } })));
  };
  return (
    <Gate title="Sign in to MengAI" lead="The crew is waiting where you left it.">
      <form className="app-form" onSubmit={submit} noValidate>
        <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="app-form-actions">
          <button type="submit" aria-busy={act.busy || undefined}>
            Sign in
          </button>
        </div>
        <FormStatus error={act.error} />
      </form>
    </Gate>
  );
}
