// Demo crew (MENGAI_DEMO=1). A scripted LlmRouter that plays one believable
// company day through the real orchestrator, tools and workspace, so one run
// shows every scenario the office scene choreographs:
// - the lead (the CEO cat) reads the workspace, publishes five tasks and
//   holds the kickoff meeting, then deals each task to the cat that takes it
// - the engineer grows index.html and styles.css over five steps (the code
//   editor shows the files being written), then wires the copy in
// - the designer hands tagline research to the researcher, who reads the
//   crew's notes and writes them up, then asks the CEO about the tagline;
//   the CEO approves and the designer drafts the copy in two steps
// - the reviewer rejects the scaffold once, the crew meets in a sync, the
//   engineer fixes it, the review passes and the CEO signs it off
// - QA runs two tests (a placeholder search and a smoke check)
// - a cat with nothing queued takes a coffee break; the crew holds a wrap-up
//   meeting and the lead writes the final report
// - opt in (securityScan): a security cat scans for secrets and config
// No model is called and no key is needed. Each reply waits 2.2 to 4.2 s and
// each meeting holds 6 to 10 s, so the crew is visibly alive.
//
// The router is stateless per request: the role comes from the system prompt
// (it is exactly ContextService.charter(role)), the task from the task packet,
// and the step from the number of assistant turns already in the prompt.
// The CEO decision is its own small call (runs CEO_SYSTEM), answered here.
// Token metering and the prompt cache are simulated by the evals module's
// ScriptedProvider, so the usage panels move like a real run.
import { AGENT_ROLES, type AgentRole, type ProviderModel } from "@mengai/shared";
import { ScriptedProvider, type ScriptedTurn } from "../modules/evals";
import { CEO_SYSTEM, packetQuestion, type CompanyPace } from "../modules/runs";
import { LlmError, type ChatRequest, type ChatResult, type LlmProvider, type LlmRouter, type Logger } from "./ports";
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
  /** create the demo project and start one run when no project exists (default true) */
  seed?: boolean;
}

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
} as const;

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

const SECURITY_TASK = {
  key: "security",
  title: TITLE.security,
  role: "security",
  deps: ["wire"],
  spec: "Scan the workspace for committed secrets and risky config before launch.",
  acceptance: ["A secret scan and a config scan ran", "Anything found is listed with where it is"],
};

function finalReport(security: boolean): string {
  return [
    "Whisker Cafe landing page is ready.",
    "Delivered: index.html and styles.css (semantic, mobile first), copy.md with the tagline and menu highlights, notes/taglines.md, README.md.",
    "Review: rejected once for a missing alt text and meta description, talked through in a sync, fixed, then approved.",
    "QA: no placeholder text left and the smoke check passed.",
    ...(security ? ["Security: no committed secrets and no risky config."] : []),
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
  title: string;
  /** assistant turns already in this task's prompt */
  step: number;
  /** review round from the reviewer's task spec */
  round: number;
  /** the lead's planning task (its spec asks for create_tasks); any other lead task is the report */
  planning: boolean;
}

function textOf(content: ChatRequest["messages"][number]["content"]): string {
  return typeof content === "string" ? content : content.map((p) => (p.type === "text" ? p.text : "")).join("");
}

function readTurn(req: ChatRequest, roleBySystem: Map<string, AgentRole>): TurnInfo {
  let role = roleBySystem.get(req.system) ?? null;
  if (!role) {
    const names = new Set((req.tools ?? []).map((t) => t.name));
    role = ROLE_BY_TOOL.find(([tool]) => names.has(tool))?.[1] ?? (names.has("fs_write") && names.size <= 6 ? "researcher" : null);
  }
  let title = "";
  let round = 1;
  let planning = false;
  for (const m of req.messages) {
    if (m.role !== "user") continue;
    const text = textOf(m.content);
    if (!text.startsWith("Your task: ")) continue;
    title = text.slice("Your task: ".length).split("\n")[0]!.trim();
    const r = /\(round (\d+) of/.exec(text);
    if (r) round = Number(r[1]);
    planning = text.includes("create_tasks");
  }
  const step = req.messages.filter((m) => m.role === "assistant").length;
  return { role, title, step, round, planning };
}

function leadSteps(planning: boolean, security: boolean): Step[] {
  if (!planning) {
    return [
      { say: "Good wrap-up, crew. Checking the board once more before I write to the owner.", calls: [call("list_tasks")] },
      { calls: [finish(finalReport(security))] },
    ];
  }
  const tasks = security ? [...PLAN_TASKS, SECURITY_TASK] : PLAN_TASKS;
  return [
    { say: "Morning, crew. This is the demo run: every step is scripted and no model is called. Reading the workspace first.", calls: [call("fs_list", { path: "." })] },
    {
      say: `Empty workspace. ${tasks.length} tasks on the board: scaffold and copy start together, then the copy goes in, then QA${security ? ", security" : ""} and the README. Kickoff in the meeting room.`,
      calls: [call("create_tasks", { tasks })],
    },
    {
      calls: [
        finish(
          `Plan: ${tasks.length} tasks. Scaffold and copy run in parallel, the engineer wires the copy in, then QA tests the page${security ? ", security scans it" : ""} and the README lands. The scaffold goes through review.`,
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
    { say: "Sniffing around the workspace.", calls: [call("fs_list", { path: "." })] },
    { say: "Test one: no placeholder text left anywhere.", calls: [call("fs_search", { pattern: "goes here" })] },
    { say: "Test two: the smoke check.", calls: [call("shell_run", { command: DEMO_SMOKE })] },
    { calls: [finish("Tests passed: no placeholder text left in the workspace, and the smoke check found index.html, styles.css and copy.md (exit 0).")] },
  ];
}

function securitySteps(): Step[] {
  return [
    { say: "Checking under the rug before launch.", calls: [call("scan_secrets")] },
    { say: "Secrets are clean. The config next.", calls: [call("scan_config")] },
    { calls: [finish("No committed secrets and no risky config in the page files.")] },
  ];
}

function stepsFor(t: TurnInfo, opts: DemoScriptOptions): Step[] {
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
      return securitySteps();
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

/** The scripted reply for one request (exported for tests). */
export function demoTurn(req: ChatRequest, roleBySystem: Map<string, AgentRole>, opts: DemoScriptOptions = {}): ScriptedTurn {
  if (req.system === CEO_SYSTEM) return ceoTurn(req);
  const t = readTurn(req, roleBySystem);
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

export function createDemoRouter(opts: DemoRouterOptions): LlmRouter & CompanyPace {
  const roleBySystem = new Map<string, AgentRole>(AGENT_ROLES.map((r) => [opts.charter(r), r] as const));
  const [lo, hi] = opts.paceMs ?? DEMO_PACE_MS;
  const min = Math.max(0, Math.min(lo, hi));
  const max = Math.max(min, lo, hi);
  const script: DemoScriptOptions = { securityScan: opts.securityScan };
  const scripted = new ScriptedProvider({
    id: DEMO_PROVIDER_ID,
    protocol: "openai_chat",
    script: (req) => demoTurn(req, roleBySystem, script),
    models: DEMO_MODELS,
  });
  const provider: LlmProvider = {
    id: DEMO_PROVIDER_ID,
    protocol: "openai_chat",
    async chat(req: ChatRequest): Promise<ChatResult> {
      const started = Date.now();
      await sleep(min + Math.random() * (max - min), req.signal);
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
    // the runs engine reads this hint: demo meetings hold long enough to watch
    company: { meetingMs: opts.meetingMs ?? demoMeetingMs(opts.paceMs) },
  };
}

// -------------------------------------------------------------------- seed
export interface DemoSeed {
  projectId: string;
  runId: string;
}

/** First boot in demo mode: one demo project and one running demo run. Null when projects already exist. */
export async function seedDemo(deps: {
  projects: Pick<ProjectsService, "list" | "create">;
  runs: Pick<RunsService, "create">;
  logger: Logger;
}): Promise<DemoSeed | null> {
  if ((await deps.projects.list()).length > 0) return null;
  const project = await deps.projects.create({ name: DEMO_PROJECT_NAME });
  const run = await deps.runs.create({ projectId: project.id, goal: DEMO_GOAL });
  deps.logger.log("info", "demo crew started", { projectId: project.id, runId: run.id });
  return { projectId: project.id, runId: run.id };
}
