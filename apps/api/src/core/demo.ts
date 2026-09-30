// Demo crew (MENGAI_DEMO=1). A scripted LlmRouter that plays one believable
// company day through the real orchestrator, tools and workspace, so one run
// shows every scenario the office scene choreographs and every beat of the
// brain:
// - Oyen, the CEO cat, starts alone with the goal, reads the workspace and
//   publishes the plan; one task asks for a specialist (a Launch tester), so
//   runtime JEV defines a dynamic role and the CEO writes its charter
// - the CEO hires the crew for the plan and holds the kickoff meeting, then
//   deals each task to the cat that takes it
// - the engineer grows index.html and styles.css over five steps (the code
//   editor shows the files being written), then wires the copy in; its
//   self-check finds an unchecked change, so it takes one more round
// - the designer hands tagline research to the researcher (runtime JEV
//   approves the hire), who reads the crew's notes and writes them up, then
//   asks the CEO about the tagline; the CEO approves and the designer drafts
//   the copy in two steps
// - the reviewer rejects the scaffold once, the crew meets in a sync, the
//   engineer fixes it, the review passes and the CEO signs it off; the
//   engineer role underperformed, so the brain writes a candidate playbook,
//   scores it offline and JEV adopts it for the engineer's next step
// - the Launch tester runs two tests (a placeholder search and a smoke check)
// - opt in (securityScan): the first security cat insists on a lockfile the
//   static page does not have and blocks three checks in a row; JEV lets it
//   go, the security role gets a new playbook, and a replacement cat runs
//   the three checks
// - a cat with nothing queued takes a coffee break; the crew holds a wrap-up
//   meeting and the CEO writes the final report
// A second project runs a hedge fund day (company "fund", Oyen as CIO):
// - the quant researcher writes a momentum thesis while the data engineer
//   writes the price history, then the quant backtests the rule
// - the risk manager reviews the strategy, then every order: two paper
//   orders fill at the trader's quotes (a buy, then a partial sell), so the
//   book shows realized and unrealized P&L
// - the trader proposes one live limit order; the risk manager approves it
//   and it waits for the owner (the trading gate holds it in paper mode)
// - the compliance officer checks the reports for advice language and
//   secrets, and the CIO writes the P&L report (a record, not advice)
// The tracker walks every fund stage: thesis, research, backtest, risk
// review, paper trade, live trade, report. No network, no connector.
// No model is called and no key is needed. Each reply waits 2.2 to 4.2 s and
// each meeting holds 6 to 10 s, so the crew is visibly alive. The runtime JEV
// is scripted too (the demo judge rides on the router).
//
// The router is stateless per request: the role comes from the system prompt
// (it starts with ContextService.charter(role), or with a dynamic role's
// header), the task from the task packet, and the step from the number of
// assistant turns already in the prompt. The CEO decision, the self-check,
// the strategy candidate and the role charter are their own small calls,
// answered here by their exact system prompts. Token metering and the prompt
// cache are simulated by the evals module's ScriptedProvider, so the usage
// panels move like a real run.
import { AGENT_ROLES, type AgentRole, type ProviderModel } from "@mengai/shared";
import { STRATEGY_SYSTEM, ScriptedProvider, type ScriptedTurn } from "../modules/evals";
import { CEO_SYSTEM, REFLEXION_SYSTEM, ROLE_HEADER_RE, ROLE_SYSTEM, packetQuestion, type CompanyPace, type JudgeHint } from "../modules/runs";
import { LlmError, type ChatRequest, type ChatResult, type JevAnswer, type Judge, type LlmProvider, type LlmRouter, type Logger } from "./ports";
import type { ProjectsService, RunsService } from "./services";

export const DEMO_PROVIDER_ID = "demo";
export const DEMO_MODEL = "mengai-demo-crew";
export const DEMO_PROJECT_NAME = "Whisker Cafe";
export const DEMO_GOAL =
  "Build a one page landing site for Whisker Cafe, a calm cafe with twelve resident cats: a tagline, menu highlights and visit details, reviewed and smoke checked before launch.";
/** default pause before each scripted reply, ms */
export const DEMO_PACE_MS: readonly [number, number] = [2200, 4200];
/** default meeting hold, ms: long enough to watch the crew walk in, sit and walk back */
export const DEMO_MEETING_MS: readonly [number, number] = [6000, 10_000];

export interface DemoOptions {
  /** pause range per reply in ms (tests use a few ms) */
  paceMs?: readonly [number, number];
  /** create the demo projects and start their runs when no project exists (default true) */
  seed?: boolean;
  /** also seed the hedge fund demo run (default true) */
  fund?: boolean;
}

export const FUND_DEMO_PROJECT_NAME = "Paw Capital";
export const FUND_DEMO_GOAL =
  "Run the Paw Capital paper desk on BTC-USD for one day: a momentum thesis, the price history, a backtest summary, a risk review, paper trades with fills and P&L, one live order proposal for the owner to decide, and a P&L report.";

export interface DemoScriptOptions {
  /** add a security cat that scans for secrets and config before launch (default false) */
  securityScan?: boolean;
}

// ------------------------------------------------------------------ script
type Call = { name: string; arguments: Record<string, unknown> };
type Step = { say?: string; calls: Call[] };

const call = (name: string, args: Record<string, unknown> = {}): Call => ({ name, arguments: args });
const finish = (summary: string, files: string[] = []): Call => call("finish", files.length ? { summary, files } : { summary });

const TITLE = {
  scaffold: "Scaffold the landing page",
  copy: "Draft the landing copy",
  wire: "Wire the copy into the page",
  smoke: "Smoke check the page",
  readme: "Write the project README",
  research: "Collect tagline references",
  security: "Scan the page for secrets",
  config: "Check the page config",
  deps: "Check the page dependencies",
} as const;

/** The dynamic role the CEO asks for: runtime JEV defines it on the qa archetype. */
export const DEMO_ROLE_TITLE = "Launch tester";

// index.html grows in three steps: skeleton, hero, then menu and visit
const SECTIONS_MARK = "    <!-- sections -->";
const HTML_TOP = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Whisker Cafe</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="top">
    <a class="brand" href="#">Whisker Cafe</a>
    <nav><a href="#menu">Menu</a> <a href="#visit">Visit</a></nav>
  </header>
  <main>
`;
const HTML_HERO = `    <section class="hero">
      <h1 id="tagline">Tagline goes here</h1>
      <p class="lede">Hero line goes here</p>
      <img class="hero-art" src="assets/hero.svg">
    </section>
`;
const HTML_MENU_VISIT = `    <section id="menu" class="menu">
      <h2>On the menu</h2>
      <ul id="highlights"><li>Highlight one</li><li>Highlight two</li><li>Highlight three</li></ul>
    </section>
    <section id="visit" class="visit">
      <h2>Visit us</h2>
      <p>Open daily, 8 to 18. Twelve resident cats, all adopted.</p>
    </section>
`;
const HTML_BOTTOM = `  </main>
  <footer>Whisker Cafe. Coffee, calm and cats.</footer>
</body>
</html>
`;
/** index.html once the scaffold is done (placeholders until the copy is wired in) */
export const DEMO_HTML = HTML_TOP + HTML_HERO + HTML_MENU_VISIT + HTML_BOTTOM;

// styles.css grows in two steps: base, then sections and focus states
const CSS_MARK = "/* sections */\n";
const CSS_BASE = `:root { --ink: #1d1d1f; --paper: #ffffff; --accent: #c2410c; --muted: #6b6b70; }
* { box-sizing: border-box; }
body { margin: 0; font: 17px/1.55 system-ui, sans-serif; color: var(--ink); background: var(--paper); }
.top { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; }
.brand { font-weight: 700; color: var(--ink); text-decoration: none; }
nav a { margin-left: 16px; color: var(--muted); }
`;
const CSS_SECTIONS = `.hero, .menu, .visit { max-width: 960px; margin: 0 auto; padding: 48px 24px; }
.hero h1 { font-size: clamp(36px, 6vw, 64px); line-height: 1.05; margin: 0 0 16px; }
.lede { font-size: 20px; color: var(--muted); max-width: 36ch; }
.hero-art { width: 100%; max-width: 480px; margin-top: 24px; }
#highlights { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; padding: 0; list-style: none; }
#highlights li { border: 1px solid #e5e5ea; border-radius: 12px; padding: 16px; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
footer { padding: 32px 24px; color: var(--muted); text-align: center; }
`;
export const DEMO_CSS = CSS_BASE + CSS_SECTIONS;

// copy.md grows in two steps: tagline and hero, then highlights and visit
const COPY_MARK = "<!-- more -->\n";
const COPY_HEAD = `# Whisker Cafe copy

Tagline: Slow coffee. Soft paws.

Hero: Twelve resident cats, one quiet room, and coffee we roast ourselves.

`;
const COPY_REST = `Menu highlights
- House latte, roasted in small batches every Monday
- Matcha for the cats who do not do coffee
- Pastries baked each morning, crumbs shared with no one

Visit: open daily, 8 to 18. Book a slot and a cat will find you.
`;
export const DEMO_COPY = COPY_HEAD + COPY_REST;

const TAGLINES = `# Tagline references

Network tools are off for this run, so these are patterns from the crew's own notes, not quotes.

1. Two short beats ("Slow coffee. Soft paws."): rhythm makes it easy to remember.
2. Promise plus proof ("Calm, guaranteed by twelve cats"): the proof carries the claim.
3. Invitation ("Come sit with us"): warm, but says nothing about the cafe.
4. Sensory lead ("Warm cups, warmer laps"): vivid, slightly cute.
5. Plain statement ("A cafe with cats"): clear, forgettable.

Pick: pattern 1, it is short, specific and sounds like the room.
`;

const README = `# Whisker Cafe landing page

One static page, no build step. Open index.html in a browser.

- index.html: structure, hero, menu highlights, visit details
- styles.css: mobile first layout, one accent color, visible focus states
- copy.md: the approved copy
- notes/taglines.md: tagline references from the researcher

Built by a MengAI demo crew.
`;

const PLAN_TASKS = [
  {
    key: "scaffold",
    title: TITLE.scaffold,
    role: "engineer",
    review: true,
    spec: "Create index.html and styles.css: header, hero, menu highlights, visit section, footer. Semantic HTML, no framework, mobile first.",
    acceptance: ["index.html and styles.css exist", "The page is semantic and readable on a phone"],
  },
  {
    key: "copy",
    title: TITLE.copy,
    role: "designer",
    spec: "Write copy.md: tagline, hero line, three menu highlights and visit details. Warm, short, a little feline.",
    acceptance: ["copy.md has a tagline, a hero line, three highlights and visit details"],
  },
  {
    key: "wire",
    title: TITLE.wire,
    role: "engineer",
    deps: ["scaffold", "copy"],
    spec: "Replace the placeholders in index.html with the approved copy from copy.md.",
    acceptance: ["No placeholder text is left in index.html"],
  },
  {
    key: "smoke",
    title: TITLE.smoke,
    role: "qa",
    role_title: DEMO_ROLE_TITLE,
    deps: ["wire"],
    spec: "Test the page: no placeholder text is left, and the page files are in place. Report anything missing.",
    acceptance: ["The tests ran and their real output is in the summary"],
  },
  {
    key: "readme",
    title: TITLE.readme,
    role: "engineer",
    deps: ["wire"],
    spec: "Write README.md: what the page is, how to open it, and what each file holds.",
    acceptance: ["README.md explains every file in the workspace"],
  },
];

const SECURITY_TASKS = [
  {
    key: "security",
    title: TITLE.security,
    role: "security",
    deps: ["wire"],
    spec: "Scan the workspace for committed secrets before launch.",
    acceptance: ["A secret scan ran", "Anything found is listed with where it is"],
  },
  {
    key: "config",
    title: TITLE.config,
    role: "security",
    deps: ["wire"],
    spec: "Check the page files for risky config: debug flags, open CORS, exposed keys.",
    acceptance: ["A config scan ran", "Anything found is listed with where it is"],
  },
  {
    key: "deps",
    title: TITLE.deps,
    role: "security",
    deps: ["wire"],
    spec: "Check the page's dependencies for known vulnerabilities.",
    acceptance: ["The dependency picture is stated with its evidence"],
  },
];

function finalReport(security: boolean): string {
  return [
    "Whisker Cafe landing page is ready.",
    "Delivered: index.html and styles.css (semantic, mobile first), copy.md with the tagline and menu highlights, notes/taglines.md, README.md.",
    "Review: rejected once for a missing alt text and meta description, talked through in a sync, fixed, then approved.",
    "Launch tester (a new role for this run): no placeholder text left and the smoke check passed.",
    ...(security
      ? ["Security: no committed secrets, no risky config and no dependencies to audit. The first security cat was let go after three blocked checks; its replacement ran them with the new security playbook."]
      : []),
    "Brain: a self-check caught an unchecked change before the handoff, and the crew adopted a new engineer playbook.",
    "Open: swap the placeholder hero art for a real photo. Add your own model key in Settings to give the crew your own goals.",
  ].join(" ");
}

const ROLE_BY_TOOL: Array<[string, AgentRole]> = [
  ["create_tasks", "lead"],
  ["submit_review", "reviewer"],
  ["scan_secrets", "security"],
  ["report_issue", "qa"],
  ["generate_image", "designer"],
  ["fs_delete", "engineer"],
  ["web_fetch", "researcher"],
  ["screen_capture", "operator"],
];

interface TurnInfo {
  role: AgentRole | null;
  /** a dynamic role's title from the charter header */
  roleTitle: string | null;
  /** the charter layer carries a learned role strategy */
  coached: boolean;
  title: string;
  /** assistant turns already in this task's prompt */
  step: number;
  /** review round from the reviewer's task spec */
  round: number;
  /** the lead's planning task (its spec asks for create_tasks); any other lead task is the report */
  planning: boolean;
  /** a hedge fund run (the plan guide or the P&L report spec says so) */
  fund: boolean;
}

function textOf(content: ChatRequest["messages"][number]["content"]): string {
  return typeof content === "string" ? content : content.map((p) => (p.type === "text" ? p.text : "")).join("");
}

const DYNAMIC_ROLES: Record<string, AgentRole> = {
  [DEMO_ROLE_TITLE]: "qa",
  "Quant researcher": "researcher",
  "Data engineer": "engineer",
  Trader: "engineer",
  "Risk manager": "reviewer",
  "Compliance officer": "security",
};

function readTurn(req: ChatRequest, charters: ReadonlyArray<readonly [string, AgentRole]>): TurnInfo {
  // the system prompt starts with the role's charter; learned strategies follow it
  let role = charters.find(([c]) => req.system === c || req.system.startsWith(`${c}\n`))?.[1] ?? null;
  const header = ROLE_HEADER_RE.exec(req.system);
  const roleTitle = header ? header[1]! : null;
  if (!role && roleTitle) role = DYNAMIC_ROLES[roleTitle] ?? null;
  if (!role) {
    const names = new Set((req.tools ?? []).map((t) => t.name));
    role = ROLE_BY_TOOL.find(([tool]) => names.has(tool))?.[1] ?? (names.has("fs_write") && names.size <= 6 ? "researcher" : null);
  }
  let title = "";
  let round = 1;
  let planning = false;
  let fund = false;
  for (const m of req.messages) {
    if (m.role !== "user") continue;
    const text = textOf(m.content);
    if (!text.startsWith("Your task: ")) continue;
    title = text.slice("Your task: ".length).split("\n")[0]!.trim();
    const r = /\(round (\d+) of/.exec(text);
    if (r) round = Number(r[1]);
    planning = text.includes("create_tasks");
    fund = text.includes("Company: hedge fund") || text.includes("P&L report");
  }
  const step = req.messages.filter((m) => m.role === "assistant").length;
  return { role, roleTitle, coached: /\nRole strategy v\d+ /.test(req.system), title, step, round, planning, fund };
}

function leadSteps(planning: boolean, security: boolean): Step[] {
  if (!planning) {
    return [
      { say: "Good wrap-up, crew. Checking the board once more before I write to the owner.", calls: [call("list_tasks")] },
      { calls: [finish(finalReport(security))] },
    ];
  }
  const tasks = security ? [...PLAN_TASKS, ...SECURITY_TASKS] : PLAN_TASKS;
  return [
    { say: "Morning, crew. This is the demo run: every step is scripted and no model is called. Reading the workspace first.", calls: [call("fs_list", { path: "." })] },
    {
      say: `Empty workspace. ${tasks.length} tasks on the board: scaffold and copy start together, then the copy goes in, then a Launch tester${security ? ", security" : ""} and the README. Kickoff in the meeting room.`,
      calls: [call("create_tasks", { tasks })],
    },
    {
      calls: [
        finish(
          `Plan: ${tasks.length} tasks. Scaffold and copy run in parallel, the engineer wires the copy in, then a new Launch tester role tests the page${security ? ", security scans it" : ""} and the README lands. The scaffold goes through review.`,
        ),
      ],
    },
  ];
}

function engineerSteps(title: string): Step[] {
  if (title.startsWith(`Fix: ${TITLE.scaffold}`)) {
    return [
      {
        say: "Fair catch in the sync. Adding the alt text first.",
        calls: [call("fs_edit", { path: "index.html", find: '<img class="hero-art" src="assets/hero.svg">', replace: '<img class="hero-art" src="assets/hero.svg" alt="A ginger cat asleep next to a latte">' })],
      },
      {
        say: "Now the meta description.",
        calls: [
          call("fs_edit", {
            path: "index.html",
            find: "<title>Whisker Cafe</title>",
            replace: '<title>Whisker Cafe</title>\n  <meta name="description" content="A calm cafe with twelve resident cats, slow coffee and a quiet corner for every visitor.">',
          }),
        ],
      },
      { calls: [finish("Added alt text to the hero image and a meta description to the head.", ["index.html"])] },
    ];
  }
  if (title === TITLE.scaffold) {
    return [
      { say: "Paws on the keyboard. Page skeleton first.", calls: [call("fs_write", { path: "index.html", content: HTML_TOP + SECTIONS_MARK + "\n" + HTML_BOTTOM })] },
      { say: "Skeleton holds. Hero section next.", calls: [call("fs_edit", { path: "index.html", find: SECTIONS_MARK, replace: HTML_HERO + SECTIONS_MARK })] },
      { say: "Menu highlights and visit details.", calls: [call("fs_edit", { path: "index.html", find: SECTIONS_MARK + "\n", replace: HTML_MENU_VISIT })] },
      { say: "Structure is in. Base styles, mobile first.", calls: [call("fs_write", { path: "styles.css", content: CSS_BASE + CSS_MARK })] },
      { say: "Section styles and visible focus states.", calls: [call("fs_edit", { path: "styles.css", find: CSS_MARK, replace: CSS_SECTIONS })] },
      { calls: [finish("Created index.html (header, hero, menu, visit, footer) and styles.css (mobile first, one accent color, visible focus).", ["index.html", "styles.css"])] },
    ];
  }
  if (title === TITLE.wire) {
    return [
      { say: "Reading the approved copy.", calls: [call("fs_read", { path: "copy.md" })] },
      {
        say: "Swapping the placeholders for the real words.",
        calls: [
          call("fs_edit", { path: "index.html", find: '<h1 id="tagline">Tagline goes here</h1>', replace: '<h1 id="tagline">Slow coffee. Soft paws.</h1>' }),
          call("fs_edit", { path: "index.html", find: '<p class="lede">Hero line goes here</p>', replace: '<p class="lede">Twelve resident cats, one quiet room, and coffee we roast ourselves.</p>' }),
          call("fs_edit", {
            path: "index.html",
            find: "<li>Highlight one</li><li>Highlight two</li><li>Highlight three</li>",
            replace: "<li>House latte, roasted in small batches every Monday</li><li>Matcha for the cats who do not do coffee</li><li>Pastries baked each morning</li>",
          }),
        ],
      },
      { calls: [finish("Tagline, hero line and three menu highlights are in index.html. No placeholder text left.", ["index.html"])] },
      // after the self-check asks for proof: search for leftovers, then finish again
      { say: "Fair point from my own check. Searching the page for leftover placeholders.", calls: [call("fs_search", { pattern: "goes here" })] },
      { calls: [finish("Tagline, hero line and three menu highlights are in index.html. A search for 'goes here' finds nothing: no placeholder text left.", ["index.html"])] },
    ];
  }
  if (title === TITLE.readme) {
    return [
      { say: "Short README so the next cat knows where everything sleeps.", calls: [call("fs_write", { path: "README.md", content: README })] },
      { calls: [finish("README.md explains the page and every file in the workspace.", ["README.md"])] },
    ];
  }
  return [{ calls: [finish("Done.")] }];
}

/** The designer's question for the CEO (the demo CEO approves it). */
export const DEMO_QUESTION = "Tagline pick from the research: Slow coffee. Soft paws. Can I build the copy around it?";

function designerSteps(title: string): Step[] {
  if (title !== TITLE.copy) return [{ calls: [finish("Done.")] }];
  return [
    {
      say: "Before I write, I want tagline references to compare against. Asking the researcher.",
      calls: [
        call("handoff", {
          to_role: "researcher",
          title: TITLE.research,
          spec: "List five tagline patterns that suit a calm cat cafe, one line of analysis each, and pick one. Write them to notes/taglines.md.",
          acceptance: ["Five patterns with one line of analysis each", "One pick with a reason"],
          summary: "The designer needs tagline references for Whisker Cafe before drafting the copy.",
        }),
      ],
    },
    { say: "The research is in. Checking the pick with the lead before I commit to it.", calls: [call("ask_human", { question: DEMO_QUESTION })] },
    { say: "Approved. Headline and hero line first. Two short beats, like a slow blink.", calls: [call("fs_write", { path: "copy.md", content: COPY_HEAD + COPY_MARK })] },
    { say: "Menu highlights and visit details.", calls: [call("fs_edit", { path: "copy.md", find: COPY_MARK, replace: COPY_REST })] },
    { calls: [finish("copy.md has the tagline (Slow coffee. Soft paws.), the hero line, three menu highlights and visit details.", ["copy.md"])] },
  ];
}

function researcherSteps(): Step[] {
  return [
    { say: "Network tools are off for this run, so I am reading the crew's notes first.", calls: [call("recall", { query: "cafe tagline patterns" })] },
    { say: "Nothing on file yet. Writing up five patterns from what I know.", calls: [call("fs_write", { path: "notes/taglines.md", content: TAGLINES })] },
    { calls: [finish("Five tagline patterns in notes/taglines.md. Pick: two short beats (Slow coffee. Soft paws.).", ["notes/taglines.md"])] },
  ];
}

function reviewerSteps(round: number): Step[] {
  if (round <= 1) {
    return [
      { say: "Nose to the markup.", calls: [call("fs_read", { path: "index.html" })] },
      {
        say: "Two things before this ships. Calling a quick sync.",
        calls: [call("submit_review", { verdict: "fail", notes: ["The hero image has no alt text", "The page has no meta description for search and link previews"] })],
      },
    ];
  }
  return [
    { say: "Second look.", calls: [call("fs_read", { path: "index.html" })] },
    { calls: [call("submit_review", { verdict: "pass", notes: ["Alt text and meta description are in. Structure is clean."] })] },
  ];
}

/** The one shell command of the run: QA's smoke check (a harmless echo). */
export const DEMO_SMOKE = "echo 'smoke check: index.html, styles.css and copy.md are in place'";

function qaSteps(): Step[] {
  return [
    { say: "Launch tester on duty. Sniffing around the workspace like a first visitor.", calls: [call("fs_list", { path: "." })] },
    { say: "Test one: no placeholder text left anywhere.", calls: [call("fs_search", { pattern: "goes here" })] },
    { say: "Test two: the smoke check.", calls: [call("shell_run", { command: DEMO_SMOKE })] },
    { calls: [finish("Tests passed: no placeholder text left in the workspace, and the smoke check found index.html, styles.css and copy.md (exit 0).")] },
  ];
}

/** The first security cat insists on a lockfile the static page does not have. */
const STUCK = "No lockfile to audit in this workspace, so I cannot sign off on this check.";

function securitySteps(title: string, coached: boolean): Step[] {
  if (!coached) {
    return [
      { say: "Dependencies first, always.", calls: [call("scan_deps")] },
      { calls: [call("finish", { summary: STUCK, outcome: "blocked" })] },
    ];
  }
  if (title === TITLE.config) {
    return [
      { say: "New playbook: scan what the page has. The config next.", calls: [call("scan_config")] },
      { calls: [finish("Config scan ran: no debug flags, no open CORS, no exposed keys in the page files.")] },
    ];
  }
  if (title === TITLE.deps) {
    return [
      { say: "A static page has no lockfile. Confirming there is no package manifest either.", calls: [call("fs_list", { path: "." })] },
      { calls: [finish("No package manifest or lockfile in the workspace: the page ships no dependencies, so there is nothing to audit.")] },
    ];
  }
  return [
    { say: "Checking under the rug before launch.", calls: [call("scan_secrets")] },
    { calls: [finish("Secret scan ran: no committed secrets in the page files.")] },
  ];
}

function stepsFor(t: TurnInfo, opts: DemoScriptOptions): Step[] {
  const fundScript = t.roleTitle ? FUND_SCRIPTS[t.roleTitle] : undefined;
  if (fundScript) return fundScript(t);
  if (t.role === "lead" && t.fund) return fundLeadSteps(t.planning);
  switch (t.role) {
    case "lead":
      return leadSteps(t.planning, opts.securityScan === true);
    case "engineer":
      return engineerSteps(t.title);
    case "designer":
      return designerSteps(t.title);
    case "researcher":
      return researcherSteps();
    case "reviewer":
      return reviewerSteps(t.round);
    case "qa":
      return qaSteps();
    case "security":
      return securitySteps(t.title, t.coached);
    default:
      return [{ calls: [finish("Done.")] }];
  }
}

const REFLECTION = JSON.stringify({
  lesson: "Add image alt text and a meta description before asking for review; the reviewer checks both first.",
  tags: ["html", "review", "accessibility"],
});

/** The CEO's scripted decisions: the tagline gets a yes with a note, anything else a plain yes. */
function ceoTurn(req: ChatRequest): ScriptedTurn {
  const first = req.messages[0];
  const question = first ? packetQuestion(textOf(first.content)) : "";
  const answer = /tagline/i.test(question)
    ? "Approved. Two short beats sound like the room. Keep the hero line under twelve words."
    : "Approved. Go with your best call and say why in your summary.";
  return { text: JSON.stringify({ decision: "approve", answer }) };
}

/** The self-check critic: one revise for the wire task's first check (no check proved the placeholders gone), a pass otherwise. */
export const DEMO_CRITIQUE = "No check shows the placeholders are gone from index.html. Search it for 'goes here' before finishing.";

function reflexionTurn(req: ChatRequest): ScriptedTurn {
  const packet = req.messages[0] ? textOf(req.messages[0].content) : "";
  const task = /^Task: (.*)$/m.exec(packet)?.[1]?.trim() ?? "";
  const check = Number(/Self-check (\d+) of/.exec(packet)?.[1] ?? 1);
  if (task === TITLE.wire && check === 1) return { text: JSON.stringify({ verdict: "revise", critique: DEMO_CRITIQUE }) };
  return { text: JSON.stringify({ verdict: "pass", critique: "The evidence covers the acceptance criteria." }) };
}

/** Strategy candidates the brain writes when a role underperforms. */
export const DEMO_STRATEGIES: Partial<Record<AgentRole, string[]>> = {
  engineer: [
    "Before finish, prove each acceptance item with a search or check you ran after the last edit, and name it.",
    "Add alt text and a meta description before asking for review.",
  ],
  security: [
    "A static page has no lockfile: never block on scan_deps, confirm there is no manifest and say so.",
    "Scan secrets and config directly and list each finding with where it is.",
  ],
};

function strategyTurn(req: ChatRequest): ScriptedTurn {
  const packet = req.messages[0] ? textOf(req.messages[0].content) : "";
  const role = (/^(?:Role|One crew member, role): ([a-z]+)/m.exec(packet)?.[1] ?? "") as AgentRole;
  const rules = DEMO_STRATEGIES[role] ?? ["Check your work against the acceptance list before finish."];
  return { text: JSON.stringify({ rules }) };
}

function roleTurn(): ScriptedTurn {
  return {
    text: JSON.stringify({
      charter: [
        "Test the page the way a first visitor meets it: placeholders, broken links, missing files.",
        "Search before you run: prove each acceptance item with a search or a command and its exit code.",
        "Report anything missing with where it is; never fix the page yourself.",
      ],
      tools: ["fs_list", "fs_read", "fs_search", "shell_run", "report_issue"],
    }),
  };
}

// ------------------------------------------------------------- the fund
export const FUND_TITLE = {
  thesis: "Write the momentum thesis",
  data: "Collect the BTC-USD price history",
  backtest: "Backtest the momentum rule",
  risk: "Risk review of the strategy",
  paper: "Paper trade the signal",
  paperReview: "Review the paper orders",
  live: "Propose one live order",
  liveReview: "Review the live order",
  compliance: "Compliance check of the reports",
} as const;

/** the paper fills of the demo day and the book they leave */
export const FUND_TRADES = {
  symbol: "BTC-USD",
  buy: { qty: 0.05, quote: 61_200 },
  sell: { qty: 0.02, quote: 62_050 },
  live: { qty: 0.01, limit: 61_900, quote: 62_050 },
  realizedUsd: 17,
  unrealizedUsd: 25.5,
} as const;

const FUND_TASKS = [
  {
    key: "thesis",
    title: FUND_TITLE.thesis,
    role: "researcher",
    role_title: "Quant researcher",
    spec: "Write notes/thesis.md: the momentum idea for BTC-USD as a rule you can test (entry, exit, size), and what would prove it wrong.",
    acceptance: ["notes/thesis.md states the rule and what would falsify it"],
  },
  {
    key: "data",
    title: FUND_TITLE.data,
    role: "engineer",
    role_title: "Data engineer",
    spec: "Write data/btc-usd-daily.csv from the desk's sample: date, open, high, low, close, UTC. Check the rows before you hand it over.",
    acceptance: ["The CSV has a header and one row per day", "Row count and gaps are stated"],
  },
  {
    key: "backtest",
    title: FUND_TITLE.backtest,
    role: "researcher",
    role_title: "Quant researcher",
    deps: ["thesis", "data"],
    spec: "Backtest the rule on data/btc-usd-daily.csv and write reports/backtest.md: signals, hit rate, drawdown, costs and the limits of the test.",
    acceptance: ["reports/backtest.md has the numbers and their sample size", "The limits of the test are stated"],
  },
  {
    key: "risk",
    title: FUND_TITLE.risk,
    role: "reviewer",
    role_title: "Risk manager",
    deps: ["backtest"],
    spec: "Review the strategy against the backtest: position size, stop and worst case. Set the paper limits the trader works within.",
    acceptance: ["Size, stop and worst case are stated", "The paper limits are explicit"],
  },
  {
    key: "paper",
    title: FUND_TITLE.paper,
    role: "engineer",
    role_title: "Trader",
    deps: ["risk"],
    spec: "Paper trade the signal within the risk limits with propose_order (give the quote you read), and keep trades/log.csv.",
    acceptance: ["Every order went through propose_order with a reason", "trades/log.csv lists each order"],
  },
  {
    key: "paper_review",
    title: FUND_TITLE.paperReview,
    role: "reviewer",
    role_title: "Risk manager",
    deps: ["paper"],
    spec: "Review every paper order waiting for you with review_order, then read the positions.",
    acceptance: ["Each order has a risk note", "The positions are stated"],
  },
  {
    key: "live",
    title: FUND_TITLE.live,
    role: "engineer",
    role_title: "Trader",
    deps: ["paper_review"],
    spec: "Propose at most one live limit order within the risk limits. It waits for the risk manager and the owner; do not route around the gate.",
    acceptance: ["One live proposal with a reason and a limit"],
  },
  {
    key: "live_review",
    title: FUND_TITLE.liveReview,
    role: "reviewer",
    role_title: "Risk manager",
    deps: ["live"],
    spec: "Review the live proposal with review_order. The owner and the trading limits decide after you.",
    acceptance: ["The live order has a risk note"],
  },
  {
    key: "compliance",
    title: FUND_TITLE.compliance,
    role: "security",
    role_title: "Compliance officer",
    deps: ["live_review"],
    spec: "Check notes, reports and the trade log for investment advice language, promised returns and committed secrets.",
    acceptance: ["A search for advice language ran", "A secret scan ran"],
  },
];

const FUND_THESIS = `# Momentum thesis: BTC-USD

Rule: go long when the close is above the 20 day high of the prior bars; exit half at +1.4 percent, trail the rest with a 2 percent stop.
Size: at most 0.05 BTC per paper order.
Wrong if: the breakout fails to hold for two closes in a row, or the backtest hit rate is under 45 percent on at least 30 signals.

A research note for the desk, not investment advice.
`;

const FUND_CSV = `date,open,high,low,close
2026-08-01,58210,58940,57820,58600
2026-08-02,58600,59120,58110,58980
2026-08-03,58980,59800,58700,59640
2026-08-04,59640,60210,59200,59910
2026-08-05,59910,60480,59350,60120
2026-08-06,60120,61020,59880,60870
2026-08-07,60870,61400,60410,61200
2026-08-08,61200,62300,60950,62050
`;

const FUND_BACKTEST = `# Backtest: 20 day breakout, BTC-USD daily

Sample: 8 daily bars in the desk file plus the desk's longer history summary (60 bars). Small sample: treat every number as a first look.
Signals: 7. Winners: 4 (hit rate 57 percent). Average win +1.9 percent, average loss -1.1 percent.
Max drawdown: 3.1 percent. Costs: 0.1 percent per side included.
Limits: one regime (a rising month), no slippage model, no weekend gaps.

A record of the test, not investment advice.
`;

const FUND_LOG = `time,symbol,side,qty,type,quote,reason
2026-08-08T00:05Z,BTC-USD,buy,0.05,market,61200,Close above the 20 day high
2026-08-08T20:00Z,BTC-USD,sell,0.02,market,62050,Take part off at the +1.4 percent band
`;

export function fundReport(): string {
  return [
    "Paw Capital paper desk report.",
    "Thesis: a 20 day breakout on BTC-USD daily bars, notes/thesis.md. Data: 8 daily bars in data/btc-usd-daily.csv, no gaps.",
    "Backtest: 7 signals, hit rate 57 percent, max drawdown 3.1 percent on a small sample (reports/backtest.md).",
    "Risk review: at most 0.05 BTC per paper order, a 2 percent stop, worst case about 61 dollars per order.",
    "Paper trades: bought 0.05 BTC-USD at 61,200.00 and sold 0.02 at 62,050.00, both risk approved. P&L: realized +$17.00, unrealized +$25.50 on the 0.03 BTC left, marked at 62,050.00.",
    "Live: one limit buy of 0.01 BTC-USD at 61,900.00 has the risk manager's approval and waits for the owner; the trading gate holds it while live trading is off.",
    "Compliance: no advice language and no committed secrets.",
    "This is a record of what the crew did, not investment advice.",
  ].join(" ");
}

function fundLeadSteps(planning: boolean): Step[] {
  if (!planning) {
    return [
      { say: "Desk closed. Reading the book before I write to the owner.", calls: [call("positions")] },
      { calls: [finish(fundReport())] },
    ];
  }
  return [
    { say: "Morning, desk. This is the demo fund day: every step is scripted, paper money only. Reading the workspace first.", calls: [call("fs_list", { path: "." })] },
    {
      say: `${FUND_TASKS.length} tasks: thesis and data together, then the backtest, the risk review, paper trades, the risk manager on every order, one live proposal for the owner, compliance.`,
      calls: [call("create_tasks", { tasks: FUND_TASKS })],
    },
    { calls: [finish(`Plan: ${FUND_TASKS.length} tasks from thesis to compliance. Paper first; the one live order waits for the risk manager and the owner.`)] },
  ];
}

function quantSteps(title: string): Step[] {
  if (title === FUND_TITLE.backtest) {
    return [
      { say: "Running the breakout rule over the desk's bars.", calls: [call("fs_write", { path: "reports/backtest.md", content: FUND_BACKTEST })] },
      { calls: [finish("Backtest in reports/backtest.md: 7 signals, 57 percent hit rate, 3.1 percent max drawdown, small sample stated.", ["reports/backtest.md"])] },
    ];
  }
  return [
    { say: "A thesis you can test beats a thesis you can like. Writing the rule down.", calls: [call("fs_write", { path: "notes/thesis.md", content: FUND_THESIS })] },
    { calls: [finish("notes/thesis.md: the 20 day breakout rule, its size, and what would prove it wrong.", ["notes/thesis.md"])] },
  ];
}

function dataSteps(): Step[] {
  return [
    { say: "Network tools are off in the demo, so the bars come from the desk's sample file.", calls: [call("fs_write", { path: "data/btc-usd-daily.csv", content: FUND_CSV })] },
    { say: "Counting rows and looking for gaps.", calls: [call("fs_read", { path: "data/btc-usd-daily.csv" })] },
    { calls: [finish("data/btc-usd-daily.csv: 8 daily bars, 2026-08-01 to 2026-08-08, no gaps, header present.", ["data/btc-usd-daily.csv"])] },
  ];
}

function traderSteps(title: string): Step[] {
  const { symbol, buy, sell, live } = FUND_TRADES;
  if (title === FUND_TITLE.live) {
    return [
      {
        say: "One live proposal, inside the limits. It waits for risk and the owner.",
        calls: [call("propose_order", { symbol, side: "buy", qty: live.qty, type: "limit", limit_price: live.limit, quote: live.quote, live: true, reason: "Add on a pullback to the breakout level, within the paper limits" })],
      },
      { calls: [finish(`Proposed one live limit buy of ${live.qty} ${symbol} at ${live.limit}; it waits for the risk review and the owner.`)] },
    ];
  }
  return [
    { say: "Close above the 20 day high. Buying on paper at the quote I read.", calls: [call("propose_order", { symbol, side: "buy", qty: buy.qty, type: "market", quote: buy.quote, reason: "Close above the 20 day high" })] },
    { say: "Logging it.", calls: [call("fs_write", { path: "trades/log.csv", content: FUND_LOG })] },
    { say: "Up 1.4 percent. Taking part off, as the thesis says.", calls: [call("propose_order", { symbol, side: "sell", qty: sell.qty, type: "market", quote: sell.quote, reason: "Take part off at the +1.4 percent band" })] },
    { calls: [finish(`Two paper orders for ${symbol} proposed (buy ${buy.qty} at ${buy.quote}, sell ${sell.qty} at ${sell.quote}); trades/log.csv lists both.`, ["trades/log.csv"])] },
  ];
}

function riskSteps(title: string): Step[] {
  if (title === FUND_TITLE.paperReview) {
    return [
      { say: "Two orders on my desk. Checking the book first.", calls: [call("positions")] },
      { say: "The buy fits the size limit.", calls: [call("review_order", { verdict: "approve", note: "0.05 BTC is inside the 0.05 limit; stop at 2 percent caps the loss near 61 dollars" })] },
      { say: "The sell only reduces risk.", calls: [call("review_order", { verdict: "approve", note: "Reduces the position; no new risk" })] },
      { calls: [call("positions")] },
      { calls: [finish(`Both paper orders approved and filled. Book: 0.03 BTC left, realized +$${FUND_TRADES.realizedUsd.toFixed(2)}, unrealized +$${FUND_TRADES.unrealizedUsd.toFixed(2)}.`)] },
    ];
  }
  if (title === FUND_TITLE.liveReview) {
    return [
      { say: "A live proposal. Sizing it against the risk review.", calls: [call("review_order", { verdict: "approve", note: "0.01 BTC is a fifth of the paper size; the owner's limits and approval decide the rest" })] },
      { calls: [finish("Live proposal risk approved; it waits for the owner and the trading gate.")] },
    ];
  }
  return [
    { say: "Reading the backtest before any trade.", calls: [call("fs_read", { path: "reports/backtest.md" })] },
    { calls: [finish("Strategy review: at most 0.05 BTC per paper order, a 2 percent stop, worst case about 61 dollars per order. Small sample, so paper only until the owner decides.")] },
  ];
}

function complianceSteps(): Step[] {
  return [
    { say: "Reading every note for advice language.", calls: [call("fs_search", { pattern: "you should|guaranteed|we recommend|can't lose" })] },
    { say: "And for anything secret.", calls: [call("scan_secrets")] },
    { calls: [finish("No advice language or promised returns in notes, reports or the trade log; the secret scan found nothing.")] },
  ];
}

const FUND_SCRIPTS: Record<string, (t: TurnInfo) => Step[]> = {
  "Quant researcher": (t) => quantSteps(t.title),
  "Data engineer": () => dataSteps(),
  Trader: (t) => traderSteps(t.title),
  "Risk manager": (t) => riskSteps(t.title),
  "Compliance officer": () => complianceSteps(),
};

/** The scripted reply for one request (exported for tests). */
export function demoTurn(req: ChatRequest, charters: ReadonlyArray<readonly [string, AgentRole]>, opts: DemoScriptOptions = {}): ScriptedTurn {
  if (req.system === CEO_SYSTEM) return ceoTurn(req);
  if (req.system === REFLEXION_SYSTEM) return reflexionTurn(req);
  if (req.system === STRATEGY_SYSTEM) return strategyTurn(req);
  if (req.system === ROLE_SYSTEM) return roleTurn();
  const t = readTurn(req, charters);
  if (!t.role) {
    // memory reflection (JSON) or step compaction: short, well formed answers
    if (req.responseFormat === "json") return { text: REFLECTION };
    return { text: "Earlier steps: files written and checked, nothing open." };
  }
  const steps = stepsFor(t, opts);
  const s = steps[Math.min(t.step, steps.length - 1)]!;
  // past the end of a script: finish again instead of looping on a tool
  const calls = t.step >= steps.length ? [finish("Done.")] : s.calls;
  return { text: t.step >= steps.length ? "" : (s.say ?? ""), toolCalls: calls };
}

/** Base charters for the demo turn, longest first so a prefix never shadows a longer charter. */
export function demoCharters(charter: (role: AgentRole) => string): Array<readonly [string, AgentRole]> {
  return AGENT_ROLES.map((r) => [charter(r), r] as const).sort((a, b) => b[0].length - a[0].length);
}

// --------------------------------------------------------------- the judge
const pick = (c: string, confidence = 0.86): JevAnswer => ({ type: "choice", choice: c, confidence, probabilities: { [c]: confidence } });

/** The runtime JEV answers of the demo day: the Launch tester is a new qa role, handoffs hire, queues wait, the stuck cat goes, playbooks are adopted. */
export function demoJudgeAnswers(decisionId: string, questions: Record<string, { criteria?: unknown }>): Record<string, JevAnswer> | null {
  switch (decisionId) {
    case "orch.role":
      return { need: pick("new_role"), archetype: pick("qa") };
    case "orch.hire": {
      const criteria = (questions.hire?.criteria ?? {}) as Record<string, string>;
      return { hire: pick("self" in criteria ? "hire" : "wait") };
    }
    case "orch.let_go":
      return { decision: pick("let_go", 0.81) };
    case "prompt.adopt":
      return { adopt: pick("adopt", 0.84) };
    default:
      return null;
  }
}

/** The scripted runtime JEV (verified answers from the demo script, model mengai-demo-judge). */
export function createDemoJudge(): Judge {
  return {
    configured: async () => true,
    async decide(req) {
      const answers = demoJudgeAnswers(req.decisionId, req.questions as Record<string, { criteria?: unknown }>);
      if (!answers) return { verified: false, stamp: "UNVERIFIED BY JEV", error: "the demo judge has no answer for this decision", latencyMs: 1 };
      return { verified: true, model: "mengai-demo-judge", answers, latencyMs: 2 };
    },
  };
}

// ------------------------------------------------------------------ router
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LlmError("aborted", "request aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LlmError("aborted", "request aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface DemoRouterOptions extends DemoScriptOptions {
  /** ContextService.charter: the exact system prompt of each role */
  charter(role: AgentRole): string;
  paceMs?: readonly [number, number];
  /** meeting hold range in ms; default DEMO_MEETING_MS, scaled with a custom paceMs */
  meetingMs?: readonly [number, number];
}

const DEMO_MODELS: ProviderModel[] = [{ id: DEMO_MODEL, label: "MengAI demo crew (scripted)", contextWindow: 128_000, caps: ["chat", "tools"] }];

/** Meeting hold that keeps the default ratio to the reply pace (6 to 10 s at the 2.2 to 4.2 s default). */
export function demoMeetingMs(paceMs?: readonly [number, number]): readonly [number, number] {
  if (!paceMs) return DEMO_MEETING_MS;
  const lo = Math.max(0, Math.min(paceMs[0], paceMs[1]));
  const hi = Math.max(lo, paceMs[0], paceMs[1]);
  return [Math.round((lo * DEMO_MEETING_MS[0]) / DEMO_PACE_MS[0]), Math.round((hi * DEMO_MEETING_MS[1]) / DEMO_PACE_MS[1])];
}

export function createDemoRouter(opts: DemoRouterOptions): LlmRouter & CompanyPace & JudgeHint {
  const charters = demoCharters(opts.charter);
  const [lo, hi] = opts.paceMs ?? DEMO_PACE_MS;
  const min = Math.max(0, Math.min(lo, hi));
  const max = Math.max(min, lo, hi);
  const script: DemoScriptOptions = { securityScan: opts.securityScan };
  const scripted = new ScriptedProvider({
    id: DEMO_PROVIDER_ID,
    protocol: "openai_chat",
    script: (req) => demoTurn(req, charters, script),
    models: DEMO_MODELS,
  });
  const provider: LlmProvider = {
    id: DEMO_PROVIDER_ID,
    protocol: "openai_chat",
    async chat(req: ChatRequest): Promise<ChatResult> {
      const started = Date.now();
      // the brain's side calls (self-check, playbook, charter) are quicker than a work step
      const side = req.system === REFLEXION_SYSTEM || req.system === STRATEGY_SYSTEM || req.system === ROLE_SYSTEM;
      const pause = min + Math.random() * (max - min);
      await sleep(side ? pause * 0.4 : pause, req.signal);
      const result = await scripted.chat(req);
      // the scripted double keeps every call for test assertions; a long lived server must not
      scripted.calls.length = 0;
      return { ...result, latencyMs: Date.now() - started };
    },
    listModels: async () => DEMO_MODELS,
  };
  return {
    resolve: async () => ({ provider, model: DEMO_MODEL, contextWindow: 128_000 }),
    configured: async () => true,
    // the runs engine reads these hints: demo meetings hold long enough to watch, and the judge is scripted too
    company: { meetingMs: opts.meetingMs ?? demoMeetingMs(opts.paceMs) },
    judge: createDemoJudge(),
  };
}

// -------------------------------------------------------------------- seed
export interface DemoSeed {
  projectId: string;
  runId: string;
  /** the hedge fund demo run; null when opted out */
  fund: { projectId: string; runId: string } | null;
}

/** First boot in demo mode: one demo project and one running demo run. Null when projects already exist. */
export async function seedDemo(deps: {
  projects: Pick<ProjectsService, "list" | "create">;
  runs: Pick<RunsService, "create">;
  logger: Logger;
  /** also start the hedge fund demo (default true) */
  fund?: boolean;
}): Promise<DemoSeed | null> {
  if ((await deps.projects.list()).length > 0) return null;
  const project = await deps.projects.create({ name: DEMO_PROJECT_NAME });
  const run = await deps.runs.create({ projectId: project.id, goal: DEMO_GOAL });
  deps.logger.log("info", "demo crew started", { projectId: project.id, runId: run.id });
  let fund: DemoSeed["fund"] = null;
  if (deps.fund !== false) {
    const fp = await deps.projects.create({ name: FUND_DEMO_PROJECT_NAME });
    const fr = await deps.runs.create({ projectId: fp.id, goal: FUND_DEMO_GOAL, company: "fund" });
    deps.logger.log("info", "demo fund started", { projectId: fp.id, runId: fr.id });
    fund = { projectId: fp.id, runId: fr.id };
  }
  return { projectId: project.id, runId: run.id, fund };
}
