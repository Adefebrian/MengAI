// The live views of the five company steps (sections/Company.tsx): how the
// cat company runs one goal. Rows between hairlines, a cat at the start of
// a row, tabular mono for times and files. Sample data from the story.
import { AskIcon, CheckIcon, CodeIcon, UsersIcon } from "../icons";
import { PLAN, STORY_GOAL } from "../story/script";
import { CrewCat, crew } from "./crew";

const STATUS_WORD = { todo: "To do", doing: "Doing", review: "In review", done: "Done" } as const;

export function PlanView() {
  const plan = PLAN.map((p, i) => ({ ...p, status: i === 0 ? ("done" as const) : i < 3 ? ("doing" as const) : ("todo" as const) }));
  return (
    <div className="lp-view">
      <div className="lp-view-head">
        <CrewCat id="kopi" activity="plan" />
        <div className="lp-view-headtext">
          <p className="lp-view-strong">Kopi, CEO</p>
          <p className="lp-view-muted">{STORY_GOAL}</p>
        </div>
      </div>
      <ol className="lp-rows" aria-label="Plan">
        {plan.map((p) => (
          <li key={p.id} className="lp-row lp-row-3">
            <span className="lp-view-strong lp-clip" title={p.title}>
              {p.title}
            </span>
            <span className="lp-view-muted">{crew(p.ownerId ?? "kopi").name}</span>
            <span className="lp-view-muted lp-row-end">{STATUS_WORD[p.status]}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const DESKS = [
  { id: "mochi", activity: "code", doing: "Writing the export", file: "src/report/export.ts" },
  { id: "tempe", activity: "wait", doing: "Waiting to review", file: "src/report/export.ts" },
  { id: "klepon", activity: "design", doing: "Drawing the button", file: "src/ui/ExportButton.tsx" },
  { id: "onde", activity: "read", doing: "Reading the tests", file: "tests/report.test.ts" },
  { id: "cilok", activity: "scan", doing: "Scanning the route", file: "src/report/route.ts" },
] as const;

export function DesksView() {
  return (
    <div className="lp-view">
      <div className="lp-view-head">
        <span className="lp-view-icon">
          <CodeIcon size={20} color="currentColor" />
        </span>
        <div className="lp-view-headtext">
          <p className="lp-view-strong">Five desks, one project folder</p>
          <p className="lp-view-muted">Each monitor shows the file that cat has open</p>
        </div>
      </div>
      <ul className="lp-rows" aria-label="Desks">
        {DESKS.map((d) => (
          <li key={d.id} className="lp-row lp-row-cat">
            <CrewCat id={d.id} activity={d.activity} />
            <span className="lp-row-text">
              <span className="lp-view-strong">{crew(d.id).name}</span>
              <span className="lp-view-muted lp-clip">{d.doing}</span>
            </span>
            <span className="kit-num lp-view-muted lp-clip lp-row-file" title={d.file}>
              {d.file}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MeetView() {
  const seats = ["kopi", "mochi", "klepon", "onde"];
  return (
    <div className="lp-view">
      <div className="lp-view-head">
        <span className="lp-view-icon">
          <UsersIcon size={20} color="currentColor" />
        </span>
        <div className="lp-view-headtext">
          <p className="lp-view-strong">Kickoff at the meeting table</p>
          <p className="lp-view-muted">
            <span className="kit-num">10:00</span>, four cats, three items
          </p>
        </div>
      </div>
      <ul className="lp-seats" aria-label="At the table">
        {seats.map((id) => (
          <li key={id}>
            <CrewCat id={id} activity="think" />
            <span className="lp-view-muted">{crew(id).name}</span>
          </li>
        ))}
      </ul>
      <ol className="lp-rows" aria-label="Agenda">
        <li className="lp-row lp-row-icon">
          <CheckIcon size={16} color="currentColor" />
          <span className="lp-view-strong">Mochi writes the export first</span>
        </li>
        <li className="lp-row lp-row-icon">
          <CheckIcon size={16} color="currentColor" />
          <span className="lp-view-strong">Klepon draws the button beside it</span>
        </li>
        <li className="lp-row lp-row-icon">
          <CheckIcon size={16} color="currentColor" />
          <span className="lp-view-strong">Tempe reviews before any test runs</span>
        </li>
      </ol>
    </div>
  );
}

export function AskView() {
  return (
    <div className="lp-view">
      <div className="lp-view-head">
        <span className="lp-view-icon">
          <AskIcon size={20} color="currentColor" />
        </span>
        <div className="lp-view-headtext">
          <p className="lp-view-strong">Requests to the CEO</p>
          <p className="lp-view-muted">
            <span className="kit-num">10:09</span>, two questions, one decided on the spot
          </p>
        </div>
      </div>
      <ol className="lp-thread" aria-label="Requests to the CEO">
        <li className="lp-say">
          <CrewCat id="onde" activity="ask" status="waiting" />
          <span className="lp-row-text">
            <span className="lp-view-muted">Onde asks</span>
            <span className="lp-view-strong">Can I add a CSV fixture under tests?</span>
          </span>
        </li>
        <li className="lp-say">
          <CrewCat id="kopi" activity="think" />
          <span className="lp-row-text">
            <span className="lp-view-muted">Kopi decides</span>
            <span className="lp-view-strong">Yes, keep it under tests/fixtures.</span>
            <span className="lp-state" data-state="ok">
              <CheckIcon size={16} color="currentColor" />
              Approved by the CEO
            </span>
          </span>
        </li>
        <li className="lp-say">
          <CrewCat id="mochi" activity="ask" status="waiting" />
          <span className="lp-row-text">
            <span className="lp-view-muted">Mochi asks</span>
            <span className="lp-view-strong">Can I add a new package for CSV?</span>
            <span className="lp-state" data-state="wait">
              <AskIcon size={16} color="currentColor" />
              Kopi sends this one to you
            </span>
          </span>
        </li>
      </ol>
    </div>
  );
}

export function ReviewView() {
  return (
    <div className="lp-view">
      <div className="lp-view-head">
        <CrewCat id="tempe" activity="review" />
        <div className="lp-view-headtext">
          <p className="lp-view-strong">Tempe reviews the CSV export</p>
          <p className="lp-view-muted">Round 1 of at most 3</p>
        </div>
      </div>
      <ul className="lp-rows" aria-label="Review">
        {["22 changed lines read", "Types check", "Tests pass", "No secrets in the diff"].map((c) => (
          <li key={c} className="lp-row lp-row-icon">
            <CheckIcon size={16} color="currentColor" />
            <span className="lp-view-strong">{c}</span>
          </li>
        ))}
        <li className="lp-row lp-row-cat">
          <CrewCat id="onde" activity="handoff" />
          <span className="lp-row-text">
            <span className="lp-view-strong">Passed, handed to Onde</span>
            <span className="lp-view-muted lp-clip">Next task: Test the CSV output</span>
          </span>
        </li>
      </ul>
    </div>
  );
}
