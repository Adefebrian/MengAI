// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The security views (sections/Security.tsx; critic fix round 2: real app
// views on labelled sample data instead of icon cells). Each is the app's
// own control in small, and each carries its state change once (JEV
// ui.component_recipe security kit.bento_reveal_states, 0.48, the top pick):
//   AskView     the permission ask: a cat asks to install a package in
//               your project; Approve once or Deny (R14 state on the answer)
//   KillView    the kill switch, a real switch (R17): everything stops
//   BudgetView  the run budget meter at 182,400 of 400,000 tokens, filling
//               from empty the first time it shows (R36)
//   VaultView   the key in the keychain, and what a cat sees in a log
//   JailView    a read outside the project folder, blocked
import { Cat } from "@mengai/cats";
import { Meter, ProductIcon, StatusPill } from "@mengai/ui/src/product";
import { useState } from "react";
import { crew } from "./crew";

export const SAMPLE_NOTE = "Sample";

export const ASK = {
  who: "onde",
  title: "Install a package in your project",
  command: "bun add csv-stringify",
  meta: ["Shell", "Installs always ask", "Expires in 4 min"],
} as const;

type Answer = "ask" | "approved" | "denied";

export function AskView() {
  const [answer, setAnswer] = useState<Answer>("ask");
  const cat = crew(ASK.who);
  const tone = answer === "approved" ? "success" : answer === "denied" ? "neutral" : "warning";
  const title = answer === "approved" ? "Approved once" : answer === "denied" ? "Denied" : `${cat.name} needs you`;
  return (
    <div className="lp-sec-view lp-ask" data-answer={answer}>
      <div className="lp-ask-sheet" data-tone={tone}>
        <p className="lp-ask-title" aria-live="polite">
          <span className="lp-ask-icon">
            <ProductIcon name={answer === "approved" ? "checkCircle" : answer === "denied" ? "ban" : "alertTriangle"} size={20} />
          </span>
          <span>{title}</span>
        </p>
        <div className="lp-ask-body">
          <span className="lp-ask-cat">
            <Cat
              look={{ coat: cat.coat, seed: cat.seed }}
              role={cat.role}
              status={answer === "ask" ? "approval" : "working"}
              activity={answer === "ask" ? "ask" : answer === "approved" ? "run" : "think"}
              mood="focused"
              label={`${cat.name}, QA, ${answer === "ask" ? "asking you" : "back at work"}`}
              size={64}
            />
          </span>
          <div className="lp-ask-text">
            <p className="lp-view-strong">{ASK.title}</p>
            <pre className="lp-ask-code" tabIndex={0} aria-label="Exact request" data-lenis-prevent="">
              <code>{ASK.command}</code>
            </pre>
            <p className="lp-ask-meta">
              {ASK.meta.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </p>
          </div>
        </div>
        <div className="lp-ask-actions">
          {answer === "ask" ? (
            <>
              <button type="button" className="lp-ask-yes" onClick={() => setAnswer("approved")}>
                <ProductIcon name="check" size={20} />
                <span>Approve once</span>
              </button>
              <button type="button" className="btn-secondary" onClick={() => setAnswer("denied")}>
                Deny
              </button>
            </>
          ) : (
            <>
              <p className="lp-ask-result">{answer === "approved" ? `${cat.name} runs it once. The next command asks again.` : `${cat.name} asks Oyen for another way.`}</p>
              <button type="button" className="btn-secondary" onClick={() => setAnswer("ask")}>
                Ask again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function KillView() {
  const [stopped, setStopped] = useState(false);
  return (
    <div className="lp-sec-view lp-kill" data-stopped={stopped ? "" : undefined}>
      <button type="button" role="switch" aria-checked={stopped} className="lp-switch" onClick={() => setStopped((s) => !s)}>
        <span className="lp-switch-track" aria-hidden="true" />
        <span className="lp-switch-text">
          <span className="lp-view-strong">Kill switch</span>
          <span className="lp-view-muted">{stopped ? "On: 3 calls and 2 commands ended" : "Off: the crew is working"}</span>
        </span>
      </button>
      <p className="lp-kill-state" aria-live="polite">
        {stopped ? (
          <StatusPill tone="danger" icon="stopAll" variant="pill">
            Everything stopped
          </StatusPill>
        ) : (
          <StatusPill tone="info" icon="refresh" variant="pill">
            5 cats at work
          </StatusPill>
        )}
      </p>
    </div>
  );
}

/** The audit log: every answer and every stop, in order (sample rows). */
export const AUDIT = [
  { time: "10:22", text: "Onde: bun add csv-stringify", state: "Approved once", ok: true },
  { time: "10:26", text: "Cemong: delete the dist folder", state: "Denied", ok: false },
  { time: "10:31", text: "You: kill switch on", state: "3 calls ended", ok: false },
] as const;

export function AuditView() {
  return (
    <div className="lp-sec-view lp-audit">
      <p className="lp-kv">
        <span className="lp-view-muted">Audit log, append only and hash chained</span>
      </p>
      <ol className="lp-rows" aria-label="Audit log">
        {AUDIT.map((r) => (
          <li key={r.time} className="lp-row lp-row-3 lp-audit-row">
            <span className="kit-num lp-view-muted">{r.time}</span>
            <span className="lp-view-strong lp-clip" title={r.text}>
              {r.text}
            </span>
            <span className="lp-state" data-state={r.ok ? "ok" : "wait"}>
              {r.state}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export const BUDGET = { used: 182_400, total: 400_000 } as const;

export function BudgetView() {
  const text = `${BUDGET.used.toLocaleString("en-US")} of ${BUDGET.total.toLocaleString("en-US")} tokens`;
  return (
    <div className="lp-sec-view lp-budget">
      <p className="lp-kv">
        <span className="lp-view-muted">Budget used</span>
        <span className="kit-num lp-view-strong">{text}</span>
      </p>
      <Meter label="Budget used" value={BUDGET.used / BUDGET.total} valueText={text} compact animate />
      <p className="lp-budget-row">
        <span className="lp-view-muted">The run stops at</span>
        <span className="kit-num lp-view-strong">{BUDGET.total.toLocaleString("en-US")}</span>
      </p>
      <p className="lp-budget-row">
        <span className="lp-view-muted">Loop guard</span>
        <StatusPill tone="success" icon="checkCircle">
          On
        </StatusPill>
      </p>
    </div>
  );
}

export function VaultView() {
  return (
    <div className="lp-sec-view lp-vault">
      <p className="lp-kv">
        <span className="lp-view-muted">OpenAI key</span>
        <StatusPill tone="success" icon="checkCircle">
          In the macOS Keychain
        </StatusPill>
      </p>
      <p className="lp-kv">
        <span className="lp-view-muted">What a cat sees in a log</span>
        <code className="lp-ask-code">OPENAI_API_KEY=[scrubbed]</code>
      </p>
    </div>
  );
}

export function JailView() {
  return (
    <div className="lp-sec-view lp-jail">
      <p className="lp-kv">
        <span className="lp-view-muted">A command outside the project</span>
        <code className="lp-ask-code">cat ~/.ssh/id_ed25519</code>
      </p>
      <p className="lp-budget-row">
        <span className="lp-view-muted">Result</span>
        <StatusPill tone="danger" icon="ban">
          Blocked
        </StatusPill>
      </p>
      <p className="lp-budget-row">
        <span className="lp-view-muted">Mac app listens on</span>
        <span className="kit-num lp-view-strong">127.0.0.1</span>
      </p>
    </div>
  );
}
