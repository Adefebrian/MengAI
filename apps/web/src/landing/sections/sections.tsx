// The landing sections after the Masthead, in page order: board, loop,
// crew, decisions, tokens, keys, security, source, faq, close. Each one's
// job, message, action and container come from JEV ui.region_gate, its
// recipe and layers from ui.component_recipe, its motion from
// motion.intensity (ledger in ../index.tsx). The custom sections sit inside
// <Section> on the kit grid with SectionHead and write their ledger id
// through composition and variant.
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Cat, CatCard } from "@mengai/cats";
import { ROLE_LABEL, type AgentRole } from "@mengai/shared";
import { FAQ, FeatureGrid, MediaFrame, Section, SectionHead, SpecRail, StatRow, staggerStyle } from "@mengai/ui";
import { useMedia } from "../hooks";
import { CloudCrossIcon, EyeSlashIcon, FolderLockIcon, StopCircleIcon, TerminalIcon, UserCheckIcon } from "../icons";
import { AUTHOR_URL, DOWNLOAD_URL, LICENSE_URL, REPO_URL, WEB_APP_URL } from "../links";
import { HEADLINE } from "../data/bench";
import { Replay } from "../replay/Replay";
import { SAMPLE_CREW_TOKENS, SAMPLE_RUN } from "../replay/fixture";
import { foldEvents } from "../replay/reduce";
import { DecisionsLog, HandoffView, PlanView, ReviewView, TokenChart, ToolsView } from "./views";

// 2. The crew board is the app (container card, core.card refused by the
// "no card around section text" law, so custom.card): the head on the
// ground, the real crew board replaying the sample run in one frame.
export function BoardSection() {
  const headId = useId();
  return (
    <Section id="board" tone="layer" composition="custom" variant="card" labelledBy={headId}>
      <SectionHead
        id={headId}
        title="The crew board is the app"
        lead="One row per cat. Its pose is the tool it is using right now, the task it carries rides along, and every token counts against the budget you set."
        action={
          <a className="btn" href={WEB_APP_URL}>
            Open the app
          </a>
        }
      />
      <div className="lp-board" data-motion="rise">
        <Replay startStage="build" />
      </div>
    </Section>
  );
}

// 3. How a run works (custom.plain, staged): four steps in order, each a
// title, one sentence and its view, spaced by whitespace alone.
const STAGES: { title: string; body: string; view: ReactNode }[] = [
  {
    title: "Plan",
    body: "Kopi reads your goal and plans up to 12 tasks, each with an owner, what it waits on, and whether it needs a second pair of eyes.",
    view: <PlanView />,
  },
  {
    title: "Build",
    body: "Ready tasks go to a cat with that role, up to 4 at once. It reads, edits and runs commands inside your project, and its pose shows which.",
    view: <ToolsView />,
  },
  {
    title: "Review",
    body: "A reviewer cat runs the checks, then passes the work or sends it back with a note. Three rounds at most, then it asks you.",
    view: <ReviewView />,
  },
  {
    title: "Hand off",
    body: "When a job needs another role, the cat hands off a new task with a one line summary. When every task is done, Kopi brings you the report.",
    view: <HandoffView />,
  },
];

export function LoopSection() {
  const headId = useId();
  return (
    <Section id="loop" tone="base" composition="custom" variant="plain" labelledBy={headId}>
      <SectionHead
        id={headId}
        title="Plan, build, review, hand off"
        lead="Every run follows the same four steps. You can pause it, nudge it or stop it at any of them."
      />
      <ol className="lp-steps">
        {STAGES.map((g, i) => (
          <li key={g.title} className="lp-step" data-motion="rise" style={staggerStyle(i)}>
            <h3 className="kit-title">{g.title}</h3>
            <p className="kit-body">{g.body}</p>
            <MediaFrame kind="view" ratio="16/9" tone="surface">
              {g.view}
            </MediaFrame>
          </li>
        ))}
      </ol>
      <p className="kit-meta lp-steps-note">Sample data, from the same run as the board above.</p>
    </Section>
  );
}

// 4. Meet the crew (custom.list): one bordered list, a live cat resting at
// the start of each row (cats.live_rest), watching the pointer
// (cats.interactive). Each line follows ROLE_TOOLS in packages/shared.
const CREW: { role: AgentRole; coat: string; seed: number; line: string }[] = [
  { role: "lead", coat: "ginger", seed: 661888672, line: "Plans your goal into tasks, keeps an eye on the crew, and asks you when it must." },
  { role: "engineer", coat: "tabby", seed: 66583270, line: "Reads and edits the code, runs commands inside the project, and hands off what is not its job." },
  { role: "designer", coat: "calico", seed: 1800746109, line: "Edits interface files, and makes images and video through your media provider." },
  { role: "reviewer", coat: "black", seed: 589844755, line: "Reads the change, runs the checks, and passes it or sends it back with a note." },
  { role: "qa", coat: "gray", seed: 1203344, line: "Writes and runs tests, and reports what breaks." },
  { role: "security", coat: "tuxedo", seed: 90210, line: "Scans dependencies, secrets and config in your own code, and reports what it finds." },
  { role: "researcher", coat: "siamese", seed: 424242, line: "Searches and reads the web, and writes what it learns into the project." },
];

export function CrewSection() {
  const headId = useId();
  return (
    <Section id="crew" tone="layer" composition="custom" variant="list" labelledBy={headId}>
      <div className="lp-crew-head">
        <SectionHead
          id={headId}
          layout="stack"
          title="Meet the crew"
          lead="Seven roles, each a cat with its own small set of tools. No cat carries a tool its job does not need, so every call stays short."
        />
      </div>
      <ul className="lp-list" aria-labelledby={headId} data-motion="rise">
        {CREW.map((c) => (
          <li key={c.role} className="lp-item">
            <span className="lp-cat">
              <Cat
                look={{ coat: c.coat, seed: c.seed }}
                role={c.role}
                status="idle"
                activity="rest"
                mood="calm"
                label={`${ROLE_LABEL[c.role]} cat, resting`}
                size={48}
                interactive
              />
            </span>
            <span className="lp-item-text">
              <span className="lp-item-title">{ROLE_LABEL[c.role]}</span>
              <span className="lp-item-desc">{c.line}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// 5. Judgment calls, on the record (core.table, the JAL Core table spec
// on the section ground, JEV runner-up taken at low confidence).
export function DecisionsSection() {
  const headId = useId();
  return (
    <Section id="decisions" tone="base" composition="custom" variant="table" labelledBy={headId}>
      <SectionHead
        id={headId}
        title="Judgment calls, on the record"
        lead="Who owns a task, which model tier fits, whether a review is really done: soft calls like these go to the JEV judge, and the answer, its confidence and the action land in the log. Rules that must never bend stay in code."
      />
      <div className="lp-log-wrap" data-motion="rise">
        <DecisionsLog />
        <p className="kit-meta">Sample data. Without a JEV key, every call falls back to a fixed rule and is stamped UNVERIFIED BY JEV.</p>
      </div>
    </Section>
  );
}

// 6. The same work for about a third of the tokens (kit.stat-row.chart,
// figures count up once, bars grow once): docs/reports/token-benchmark.md.
export function TokensSection() {
  const share = Math.round((HEADLINE.v2Billable / HEADLINE.legacyBillable) * 100);
  return (
    <StatRow
      id="tokens"
      tone="layer"
      variant="chart"
      title="The same work for about a third of the tokens"
      lead={`Measured by the evals module on the same scripted work for the old engine and v2: ${HEADLINE.scenarios} scenarios, ${HEADLINE.roles} roles, ${HEADLINE.steps} steps. v2 bills ${share}% of the old input tokens. No model calls, the same numbers on every run.`}
      stats={[
        { value: `${HEADLINE.savingsPct}%`, caption: "fewer billable input tokens than the old engine", signal: true },
        { value: `${HEADLINE.promptCutPct}%`, caption: "fewer prompt tokens sent, before any cache" },
        { value: `${HEADLINE.cachedSharePct}%`, caption: "of v2 prompt tokens read from the prompt cache" },
        { value: HEADLINE.v2MaxPrompt.toLocaleString("en-US"), unit: "tokens", caption: `in the largest single prompt, down from ${HEADLINE.legacyMaxPrompt.toLocaleString("en-US")}` },
      ]}
      chart={<TokenChart />}
    />
  );
}

// 7. Bring your own key (kit.spec-rail): the head beside two spec rails.
export function KeysSection() {
  const headId = useId();
  return (
    <Section id="keys" tone="base" composition="spec-rail" labelledBy={headId}>
      <div className="lp-keys-head">
        <SectionHead
          id={headId}
          layout="stack"
          title="Bring your own key"
          lead="Use the models you already pay for. Your key is saved once, in your keychain or an encrypted vault, and is never logged, shown again or put in a prompt."
        />
      </div>
      <div className="lp-keys-rails" data-motion="rise">
        <div className="lp-rail">
          <h3 className="kit-title">Where your key lives</h3>
          <SpecRail
            label="Where your key lives"
            rows={[
              { label: "On the Mac app", value: "The macOS keychain" },
              { label: "On your own server", value: "An AES-256-GCM vault, one data key per secret" },
              { label: "Shown after saving", value: "The last 4 characters", numeric: false },
              { label: "Sent to", value: "The provider you chose, inside its own request" },
              { label: "Logs, events, prompts", value: "Never. Active keys are scrubbed from tool output" },
            ]}
          />
        </div>
        <div className="lp-rail">
          <h3 className="kit-title">Any provider, any model</h3>
          <SpecRail
            label="Providers and models"
            rows={[
              { label: "Out of the box", value: "gpt-4o-mini on every tier, until you pick another model" },
              { label: "Hosted APIs", value: "OpenAI, Anthropic, Google Gemini, DeepSeek, Mistral, xAI Grok, Moonshot Kimi, Z.ai GLM, Alibaba Qwen, MiniMax, Xiaomi MiMo" },
              { label: "Routers and clouds", value: "OpenRouter, AgentRouter, Groq, Together AI, Fireworks AI" },
              { label: "On your own Mac", value: "Ollama and LM Studio" },
              { label: "Anything else", value: "Any OpenAI or Anthropic compatible base URL" },
            ]}
          />
        </div>
      </div>
    </Section>
  );
}

// 8. Curious, never careless (kit.feature-grid.cells): six guarantees in
// one hairline cell grid, the icon inline on each title row.
const GUARANTEES: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: "Stays in your project",
    body: "File tools are fenced to the project folder you pick. A path outside it is refused, not asked about.",
    icon: <FolderLockIcon size={20} color="currentColor" />,
  },
  {
    title: "Commands run in a sandbox",
    body: "On the Mac, shell commands run in a Seatbelt sandbox locked to the project, with a scrubbed environment. On a server they run in the container, and the shell stays off until you turn it on.",
    icon: <TerminalIcon size={20} color="currentColor" />,
  },
  {
    title: "Secrets stay out of sight",
    body: "Keys never reach a log, an event or a prompt, and any active key that shows up in tool output is scrubbed before a model or the timeline sees it.",
    icon: <EyeSlashIcon size={20} color="currentColor" />,
  },
  {
    title: "No MengAI server in the middle",
    body: "Runs talk only to the providers you add, with your key. There is no MengAI cloud to trust or to breach.",
    icon: <CloudCrossIcon size={20} color="currentColor" />,
  },
  {
    title: "You make the calls that cannot be undone",
    body: "Dropping data, force pushes, payments, production releases and credential changes always come to you, never to a model or the judge.",
    icon: <UserCheckIcon size={20} color="currentColor" />,
  },
  {
    title: "A budget and a stop on every run",
    body: "Each run has a token budget, 400,000 by default. Pause holds new work, Stop ends the calls in flight, and Stop all ends every run at once.",
    icon: <StopCircleIcon size={20} color="currentColor" />,
  },
];

export function SecuritySection() {
  return (
    <FeatureGrid
      id="security"
      tone="layer"
      variant="cells"
      columns={3}
      title="Curious, never careless"
      lead="The crew works inside your project, in a sandbox, on a budget, and brings you anything it cannot take back."
      items={GUARANTEES}
    />
  );
}

// 9. Open source (custom.plain): the head and its one action on the
// ground, four facts as one spec strip under it.
export function SourceSection() {
  const headId = useId();
  return (
    <Section id="source" tone="base" composition="custom" variant="plain" labelledBy={headId}>
      <SectionHead
        id={headId}
        title="Open source, whiskers to tail"
        lead="Read every line, run the web app on your own server, and change anything you like. The code is Apache-2.0, and the only bill is your model provider's."
        action={
          <a className="btn" href={REPO_URL}>
            Source on GitHub
          </a>
        }
      />
      <div className="lp-facts" data-motion="rise">
        <SpecRail
          layout="strip"
          label="MengAI in four facts"
          rows={[
            { label: "License", value: "Apache-2.0" },
            { label: "Price", value: "Free. You pay your model provider" },
            { label: "Runs on", value: "The Mac app, or your server with Docker" },
            { label: "Built by", value: "Adefebrian" },
          ]}
        />
      </div>
    </Section>
  );
}

// 10. Questions (kit.faq.open): every answer visible.
export function QuestionsSection() {
  return (
    <FAQ
      id="faq"
      tone="layer"
      variant="open"
      title="Questions"
      lead="Plain answers on cost, data, models and platforms."
      items={[
        {
          q: "What does it cost?",
          a: "MengAI is free and open source under Apache-2.0. You pay your model provider for the tokens a run uses, and every run has a budget.",
        },
        {
          q: "Does my code or my key pass through a MengAI server?",
          a: "No. There is no MengAI server: runs talk only to the providers you add, with your key.",
        },
        {
          q: "Which models can I use?",
          a: "Any provider in the list, any OpenAI or Anthropic compatible endpoint, and local models through Ollama or LM Studio in the Mac app. A fresh install uses gpt-4o-mini until you choose.",
        },
        {
          q: "Can I stop a run halfway?",
          a: "Yes. Pause holds new work at the next step, Stop ends the calls in flight, and Stop all ends every run at once.",
        },
        {
          q: "What does the JEV judge need?",
          a: "A JEV key in Providers. Without one the crew still runs: every decision falls back to a fixed rule and is stamped UNVERIFIED BY JEV.",
        },
        {
          q: "Does it run on Windows or Linux?",
          a: "The web app runs on your own server with Docker. The desktop app is macOS only for now.",
        },
      ]}
    />
  );
}

/** true once el has entered view (never under a missing observer). */
function useEntered<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setEntered(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, entered];
}

// 11. Put the crew to work (custom.close): the four cats from the run,
// resting, each celebrating once as the close first comes into view
// (cats.celebrate_on_enter), then the heading, the one action and the
// credit line (the footer region was dropped by ui.region_gate).
export function CloseSection() {
  const headId = useId();
  const wide = useMedia("(min-width: 640px)");
  const final = foldEvents(SAMPLE_RUN.events);
  const [crewRef, entered] = useEntered<HTMLUListElement>();
  return (
    <Section id="get" tone="base" composition="custom" variant="close" labelledBy={headId}>
      <div className="lp-close">
        <ul ref={crewRef} className="lp-close-crew" aria-label="The crew after the sample run" data-motion="rise">
          {SAMPLE_RUN.crew.map((id) => {
            const a = final.agents[id];
            if (!a) return null;
            return (
              <li key={id} className="lp-close-cat">
                <CatCard
                  look={a.look}
                  role={a.role}
                  status="done"
                  activity="rest"
                  mood="proud"
                  label={`${a.name}, ${ROLE_LABEL[a.role]}, resting after the run`}
                  size={wide ? 64 : 48}
                  celebrateKey={entered ? 1 : 0}
                  name={a.name}
                  statusText="Resting"
                  taskTitle="Napping until your next goal"
                  energy={(SAMPLE_CREW_TOKENS[id] ?? 0) / final.budgetTokens}
                />
              </li>
            );
          })}
        </ul>
        <div className="lp-close-text">
          <h2 id={headId} className="kit-heading">
            Put the crew to work
          </h2>
          <p className="kit-lead">Download the Mac app and hand Kopi your first goal. The crew is up from its nap the moment you are.</p>
        </div>
        <div className="kit-actions lp-close-actions">
          <a className="btn" href={DOWNLOAD_URL}>
            Download for Mac
          </a>
          <a className="lp-close-link" href={WEB_APP_URL}>
            Or open the web app
          </a>
        </div>
        <p className="kit-meta lp-credit">
          MengAI is open source under the <a href={LICENSE_URL}>Apache-2.0 license</a>. Built by <a href={AUTHOR_URL}>Adefebrian</a>.
        </p>
      </div>
    </Section>
  );
}
