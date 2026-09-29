// Product views for the landing, drawn with the real crew components and
// the sample run's data (replay/fixture.ts): the plan, one cat's tool calls,
// the review verdict and the handoff card for the loop section, then the
// decisions log and the token chart. Each loop view is a picture of the app
// (role img with one summary sentence, inert body), so a screen reader hears
// one line instead of a dead list.
import type { ReactNode } from "react";
import { Cat } from "@mengai/cats";
import { ACTIVITY_LABEL, ROLE_LABEL, activityForTool, type Activity, type AgentRole, type CatLook } from "@mengai/shared";
import { CheckCircleIcon, CheckIcon, UndoIcon, WarningIcon } from "../icons";
import { HEADLINE, SCENARIOS } from "../data/bench";
import { SAMPLE_RUN } from "../replay/fixture";
import { foldEvents } from "../replay/reduce";

const FINAL = foldEvents(SAMPLE_RUN.events);
const [KOPI, KLEPON, MOCHI, TEMPE] = SAMPLE_RUN.crew.map((id) => FINAL.agents[id]!);

function Picture({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="lp-view" role="img" aria-label={label}>
      <div className="lp-view-body" inert>
        {children}
      </div>
    </div>
  );
}

function Who({ name, role, look, activity }: { name: string; role: AgentRole; look: CatLook; activity: Activity }) {
  return (
    <span className="lp-who-cat">
      <Cat look={look} role={role} status="working" activity={activity} mood="focused" label={`${name}, ${ROLE_LABEL[role]}`} size={48} still />
    </span>
  );
}

function ViewHead({ cat, title, meta }: { cat: ReactNode; title: string; meta: string }) {
  return (
    <div className="lp-view-head">
      {cat}
      <span className="lp-view-head-text">
        <span className="lp-view-title">{title}</span>
        <span className="lp-view-meta">{meta}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- plan
const PLAN = [
  { title: "Add a CSV encoder for invoice rows", role: "engineer" as const, after: null, review: true },
  { title: "Add GET /invoices/export.csv", role: "engineer" as const, after: "After the CSV encoder", review: true },
  { title: "Add an Export button to the invoices toolbar", role: "designer" as const, after: null, review: false },
];

export function PlanView() {
  return (
    <Picture label="Sample plan: Kopi splits the goal into three tasks, two for the engineer that need a review and one for the designer">
      <ViewHead cat={<Who name={KOPI!.name} role={KOPI!.role} look={KOPI!.look} activity="plan" />} title="Kopi planned 3 tasks" meta={SAMPLE_RUN.goal} />
      <ul className="lp-rows">
        {PLAN.map((t) => (
          <li key={t.title} className="lp-row">
            <span className="lp-row-title">{t.title}</span>
            <span className="lp-row-meta">
              <span>{ROLE_LABEL[t.role]}</span>
              {t.after ? <span>{t.after}</span> : null}
              {t.review ? <span>Needs review</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </Picture>
  );
}

// ---------------------------------------------------------------- build
const CALLS = [
  { tool: "fs_read", target: "src/invoices/table.tsx" },
  { tool: "fs_write", target: "src/lib/csv.ts" },
  { tool: "shell_run", target: "bun test src/lib/csv.test.ts" },
];

export function ToolsView() {
  return (
    <Picture label="Sample tool calls: Klepon reads a file, writes code and runs the tests, and its pose changes with each call">
      <ViewHead
        cat={<Who name={KLEPON!.name} role={KLEPON!.role} look={KLEPON!.look} activity="code" />}
        title="Klepon, last three tool calls"
        meta="Add a CSV encoder for invoice rows"
      />
      <ul className="lp-rows">
        {CALLS.map((c) => {
          const activity = activityForTool(c.tool);
          return (
            <li key={c.tool} className="lp-row lp-row-cat">
              <span className="lp-who-cat">
                <Cat look={KLEPON!.look} role="engineer" status="working" activity={activity} mood="focused" label={ACTIVITY_LABEL[activity]} size={48} still />
              </span>
              <span className="lp-row-text">
                <span className="lp-row-title">{ACTIVITY_LABEL[activity]}</span>
                <span className="lp-row-meta lp-mono">
                  <span>{c.tool}</span>
                  <span className="lp-clip">{c.target}</span>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </Picture>
  );
}

// ---------------------------------------------------------------- review
export function ReviewView() {
  return (
    <Picture label="Sample review: Tempe sends the CSV encoder back once because commas break the rows, Klepon quotes them, and Tempe passes it in round 2 of 3">
      <ViewHead cat={<Who name={TEMPE!.name} role={TEMPE!.role} look={TEMPE!.look} activity="review" />} title="Tempe reviewed the CSV export" meta="Add a CSV encoder for invoice rows" />
      <dl className="lp-kv">
        <div className="lp-kv-row">
          <dt>Round 1</dt>
          <dd className="lp-back">
            <UndoIcon size={16} color="currentColor" />
            <span>Sent back: quote fields that contain commas</span>
          </dd>
        </div>
        <div className="lp-kv-row">
          <dt>Fix</dt>
          <dd>
            Klepon edits <span className="lp-mono">src/lib/csv.ts</span>, <span className="kit-num">5</span> tests pass
          </dd>
        </div>
        <div className="lp-kv-row">
          <dt>Round 2</dt>
          <dd className="lp-ok">
            <CheckCircleIcon size={16} color="currentColor" />
            <span>
              Passed, <span className="kit-num">17</span> tests pass
            </span>
          </dd>
        </div>
      </dl>
    </Picture>
  );
}

// ---------------------------------------------------------------- hand off
const HANDOFF = SAMPLE_RUN.events.find((e) => e.type === "handoff");
const HANDOFF_SUMMARY =
  HANDOFF && HANDOFF.type === "handoff" ? (HANDOFF.data as { handoff: { summary: string } }).handoff.summary : "";

export function HandoffView() {
  return (
    <Picture label="Sample handoff: Klepon hands the button wiring to Mochi with a one line summary of the new endpoint, Mochi picks it up and Klepon waits for the result">
      <ViewHead
        cat={<Who name={KLEPON!.name} role={KLEPON!.role} look={KLEPON!.look} activity="handoff" />}
        title="Klepon hands off to Mochi"
        meta="Engineer to designer"
      />
      <div className="lp-handoff">
        <span className="lp-handoff-card">
          <span className="lp-row-title">Wire the Export button to the endpoint</span>
          <span className="lp-handoff-summary">{HANDOFF_SUMMARY}</span>
        </span>
        <ul className="lp-rows">
          <li className="lp-row lp-row-cat">
            <Who name={MOCHI!.name} role={MOCHI!.role} look={MOCHI!.look} activity="code" />
            <span className="lp-row-text">
              <span className="lp-row-title">Mochi picks it up</span>
              <span className="lp-row-meta">
                <span>{ACTIVITY_LABEL.code}</span>
                <span className="lp-mono lp-clip">src/invoices/Toolbar.tsx</span>
              </span>
            </span>
          </li>
          <li className="lp-row lp-row-cat">
            <Who name={KLEPON!.name} role={KLEPON!.role} look={KLEPON!.look} activity="wait" />
            <span className="lp-row-text">
              <span className="lp-row-title">Klepon waits for the result</span>
              <span className="lp-row-meta">
                <span>{ACTIVITY_LABEL.wait}</span>
                <span>Then finishes its own task</span>
              </span>
            </span>
          </li>
        </ul>
      </div>
    </Picture>
  );
}

// ---------------------------------------------------------------- decisions
interface DecisionRow {
  id: string;
  question: string;
  answer: string;
  confidence: string | null;
  action: string;
  kind: "judged" | "rule" | "fallback";
}

// Catalog ids, answers and action strings as the jev module writes them
// (apps/api/src/modules/jev/catalog.ts); the run itself is sample data.
export const DECISIONS: DecisionRow[] = [
  { id: "orch.route", question: "Who owns Add GET /invoices/export.csv?", answer: "engineer", confidence: "0.84", action: "dispatch to engineer", kind: "judged" },
  { id: "orch.model", question: "Which model tier reviews the export?", answer: "deep", confidence: "0.71", action: "use deep tier", kind: "judged" },
  { id: "orch.loop_exit", question: "Round 1 of the CSV export review: done?", answer: "another_round", confidence: "0.81", action: "run another review round", kind: "judged" },
  { id: "orch.loop_exit", question: "Round 2 of the CSV export review: done?", answer: "exit_done", confidence: "0.77", action: "exit the review loop", kind: "judged" },
  { id: "orch.escalate", question: "Drop the old invoices table?", answer: "human", confidence: null, action: "precheck: ask the owner (destructive_data_or_history)", kind: "rule" },
  { id: "orch.route", question: "Who owns Update the export docs?", answer: "engineer", confidence: null, action: "dispatch to engineer", kind: "fallback" },
];

function DecisionState({ row }: { row: DecisionRow }) {
  if (row.kind === "rule") {
    return (
      <span className="lp-stamp">
        <CheckIcon size={16} color="currentColor" />
        <span>Rule in code, never sent</span>
      </span>
    );
  }
  if (row.kind === "fallback") {
    return (
      <span className="lp-stamp" data-kind="fallback">
        <WarningIcon size={16} color="currentColor" />
        <span>UNVERIFIED BY JEV</span>
      </span>
    );
  }
  return (
    <span className="lp-stamp">
      <span className="kit-num">{row.confidence}</span>
      <span>confidence</span>
    </span>
  );
}

export function DecisionsLog() {
  return (
    <table className="lp-log-table" aria-label="Sample decisions log from one run">
      <thead>
        <tr>
          <th scope="col">Decision</th>
          <th scope="col">Question</th>
          <th scope="col">Answer</th>
          <th scope="col">Judged</th>
          <th scope="col">Action taken</th>
        </tr>
      </thead>
      <tbody>
        {DECISIONS.map((d, i) => (
          <tr key={i} data-kind={d.kind}>
            <td className="lp-mono" data-label="Decision">
              {d.id}
            </td>
            <th scope="row" data-label="Question">
              {d.question}
            </th>
            <td className="lp-mono" data-label="Answer">
              {d.answer}
            </td>
            <td data-label="Judged">
              <DecisionState row={d} />
            </td>
            <td data-label="Action taken">{d.action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------- tokens
const MAX = Math.max(...SCENARIOS.map((s) => s.legacy));
const fmt = (n: number) => n.toLocaleString("en-US");

export function TokenChart() {
  return (
    <figure className="lp-chart" aria-labelledby="lp-chart-caption">
      <ul className="lp-bars">
        {SCENARIOS.map((s) => (
          <li key={s.id} className="lp-bar-row">
            <span className="lp-bar-name lp-mono">{s.id}</span>
            <span className="lp-bar-pair" aria-label={`${s.id}: legacy ${fmt(s.legacy)}, v2 ${fmt(s.v2)} billable input tokens, ${s.savingsPct}% fewer`}>
              <span className="lp-bar-track">
                <span className="lp-bar" data-series="legacy" style={{ inlineSize: `${((s.legacy / MAX) * 100).toFixed(2)}%` }} />
              </span>
              <span className="lp-bar-track">
                <span className="lp-bar" data-series="v2" style={{ inlineSize: `${((s.v2 / MAX) * 100).toFixed(2)}%` }} />
              </span>
            </span>
            <span className="lp-bar-save kit-num">{`\u2212${s.savingsPct}%`}</span>
          </li>
        ))}
      </ul>
      <figcaption id="lp-chart-caption" className="kit-meta">
        Billable input tokens per scenario, legacy in gray and v2 in ink. Legacy ran uncached, as recorded; with the same prompt cache on legacy, v2 would still need{" "}
        {HEADLINE.savingsIfLegacyCachedPct}% fewer. Method and limits: docs/reports/token-benchmark.md.
      </figcaption>
    </figure>
  );
}
