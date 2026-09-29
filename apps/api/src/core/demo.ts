// Demo crew (MENGAI_DEMO=1). A scripted LlmRouter that plays one believable
// crew run through the real orchestrator, tools and workspace: the lead plans
// five tasks with dependencies, the engineer writes files, the designer drafts
// copy after a handoff to the researcher, the reviewer rejects once and then
// approves, QA runs a harmless echo, and the lead writes the final report.
// No model is called and no key is needed. Each reply waits 700 to 1400 ms so
// the crew is visibly alive.
//
// The router is stateless per request: the role comes from the system prompt
// (it is exactly ContextService.charter(role)), the task from the task packet,
// and the step from the number of assistant turns already in the prompt.
// Token metering and the prompt cache are simulated by the evals module's
// ScriptedProvider, so the usage panels move like a real run.
import { AGENT_ROLES, type AgentRole, type ProviderModel } from "@mengai/shared";
import { ScriptedProvider, type ScriptedTurn } from "../modules/evals";
import { LlmError, type ChatRequest, type ChatResult, type LlmProvider, type LlmRouter, type Logger } from "./ports";
import type { ProjectsService, RunsService } from "./services";

export const DEMO_PROVIDER_ID = "demo";
export const DEMO_MODEL = "mengai-demo-crew";
export const DEMO_PROJECT_NAME = "Whisker Cafe";
export const DEMO_GOAL =
  "Build a one page landing site for Whisker Cafe, a calm cafe with twelve resident cats: a tagline, menu highlights and visit details, reviewed and smoke checked before launch.";
/** default pause before each scripted reply, ms */
export const DEMO_PACE_MS: readonly [number, number] = [700, 1400];

export interface DemoOptions {
  /** pause range per reply in ms (tests use a few ms) */
  paceMs?: readonly [number, number];
  /** create the demo project and start one run when no project exists (default true) */
  seed?: boolean;
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
} as const;

const HTML = `<!doctype html>
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
    <section class="hero">
      <h1 id="tagline">Tagline goes here</h1>
      <p class="lede">Hero line goes here</p>
      <img class="hero-art" src="assets/hero.svg">
    </section>
    <section id="menu" class="menu">
      <h2>On the menu</h2>
      <ul id="highlights"><li>Highlight one</li><li>Highlight two</li><li>Highlight three</li></ul>
    </section>
    <section id="visit" class="visit">
      <h2>Visit us</h2>
      <p>Open daily, 8 to 18. Twelve resident cats, all adopted.</p>
    </section>
  </main>
  <footer>Whisker Cafe. Coffee, calm and cats.</footer>
</body>
</html>
`;

const CSS = `:root { --ink: #1d1d1f; --paper: #ffffff; --accent: #c2410c; --muted: #6b6b70; }
* { box-sizing: border-box; }
body { margin: 0; font: 17px/1.55 system-ui, sans-serif; color: var(--ink); background: var(--paper); }
.top { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; }
.brand { font-weight: 700; color: var(--ink); text-decoration: none; }
nav a { margin-left: 16px; color: var(--muted); }
.hero, .menu, .visit { max-width: 960px; margin: 0 auto; padding: 48px 24px; }
.hero h1 { font-size: clamp(36px, 6vw, 64px); line-height: 1.05; margin: 0 0 16px; }
.lede { font-size: 20px; color: var(--muted); max-width: 36ch; }
.hero-art { width: 100%; max-width: 480px; margin-top: 24px; }
#highlights { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; padding: 0; list-style: none; }
#highlights li { border: 1px solid #e5e5ea; border-radius: 12px; padding: 16px; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
footer { padding: 32px 24px; color: var(--muted); text-align: center; }
`;

const COPY = `# Whisker Cafe copy

Tagline: Slow coffee. Soft paws.

Hero: Twelve resident cats, one quiet room, and coffee we roast ourselves.

Menu highlights
- House latte, roasted in small batches every Monday
- Matcha for the cats who do not do coffee
- Pastries baked each morning, crumbs shared with no one

Visit: open daily, 8 to 18. Book a slot and a cat will find you.
`;

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
    spec: "Check that the page files are in place and report anything missing.",
    acceptance: ["A smoke check ran and its real output is in the summary"],
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

const FINAL_REPORT = [
  "Whisker Cafe landing page is ready.",
  "Delivered: index.html and styles.css (semantic, mobile first), copy.md with the tagline and menu highlights, notes/taglines.md, README.md.",
  "Review: rejected once for a missing alt text and meta description, fixed, then approved.",
  "QA: smoke check passed.",
  "Open: swap the placeholder hero art for a real photo. Add your own model key in Settings to give the crew your own goals.",
].join(" ");

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

function leadSteps(planning: boolean): Step[] {
  if (!planning) {
    return [
      { say: "Everyone is back on their cushions. Checking the board before I write it up.", calls: [call("list_tasks")] },
      { calls: [finish(FINAL_REPORT)] },
    ];
  }
  return [
    { say: "Demo crew on duty. Every step in this run is scripted, no model is called. Reading the workspace first.", calls: [call("fs_list", { path: "." })] },
    { say: "Empty workspace. Five tasks: engineer and designer start together, then the copy goes in, then QA and the README.", calls: [call("create_tasks", { tasks: PLAN_TASKS })] },
    { calls: [finish("Plan: 5 tasks. Scaffold and copy run in parallel, the engineer wires the copy in, then QA smoke checks and the README lands. The scaffold goes through review.")] },
  ];
}

function engineerSteps(title: string): Step[] {
  if (title.startsWith(`Fix: ${TITLE.scaffold}`)) {
    return [
      {
        say: "Fair catch. Adding the alt text first.",
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
      { say: "Paws on the keyboard. Starting with the page skeleton.", calls: [call("fs_write", { path: "index.html", content: HTML })] },
      { say: "Structure is in. Styles next, mobile first.", calls: [call("fs_write", { path: "styles.css", content: CSS })] },
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
    { say: "Pattern one it is. Two short beats, like a slow blink.", calls: [call("fs_write", { path: "copy.md", content: COPY })] },
    { calls: [finish("copy.md has the tagline (Slow coffee. Soft paws.), the hero line, three menu highlights and visit details.", ["copy.md"])] },
  ];
}

function researcherSteps(): Step[] {
  return [
    { say: "Network tools are off for this run, so I am working from the crew's notes.", calls: [call("fs_write", { path: "notes/taglines.md", content: TAGLINES })] },
    { calls: [finish("Five tagline patterns in notes/taglines.md. Pick: two short beats (Slow coffee. Soft paws.).", ["notes/taglines.md"])] },
  ];
}

function reviewerSteps(round: number): Step[] {
  if (round <= 1) {
    return [
      { say: "Nose to the markup.", calls: [call("fs_read", { path: "index.html" })] },
      {
        say: "Two things before this ships.",
        calls: [call("submit_review", { verdict: "fail", notes: ["The hero image has no alt text", "The page has no meta description for search and link previews"] })],
      },
    ];
  }
  return [
    { say: "Second look.", calls: [call("fs_read", { path: "index.html" })] },
    { calls: [call("submit_review", { verdict: "pass", notes: ["Alt text and meta description are in. Structure is clean."] })] },
  ];
}

function qaSteps(): Step[] {
  return [
    { say: "Sniffing around the workspace.", calls: [call("fs_list", { path: "." })] },
    { say: "Running the smoke check.", calls: [call("shell_run", { command: "echo 'smoke check: index.html, styles.css and copy.md are in place'" })] },
    { calls: [finish("Smoke check passed: index.html, styles.css and copy.md are in place, the echo check exited 0.")] },
  ];
}

function stepsFor(t: TurnInfo): Step[] {
  switch (t.role) {
    case "lead":
      return leadSteps(t.planning);
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
    default:
      return [{ calls: [finish("Done.")] }];
  }
}

const REFLECTION = JSON.stringify({
  lesson: "Add image alt text and a meta description before asking for review; the reviewer checks both first.",
  tags: ["html", "review", "accessibility"],
});

/** The scripted reply for one request (exported for tests). */
export function demoTurn(req: ChatRequest, roleBySystem: Map<string, AgentRole>): ScriptedTurn {
  const t = readTurn(req, roleBySystem);
  if (!t.role) {
    // memory reflection (JSON) or step compaction: short, well formed answers
    if (req.responseFormat === "json") return { text: REFLECTION };
    return { text: "Earlier steps: files written and checked, nothing open." };
  }
  const steps = stepsFor(t);
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

export interface DemoRouterOptions {
  /** ContextService.charter: the exact system prompt of each role */
  charter(role: AgentRole): string;
  paceMs?: readonly [number, number];
}

const DEMO_MODELS: ProviderModel[] = [{ id: DEMO_MODEL, label: "MengAI demo crew (scripted)", contextWindow: 128_000, caps: ["chat", "tools"] }];

export function createDemoRouter(opts: DemoRouterOptions): LlmRouter {
  const roleBySystem = new Map<string, AgentRole>(AGENT_ROLES.map((r) => [opts.charter(r), r] as const));
  const [lo, hi] = opts.paceMs ?? DEMO_PACE_MS;
  const min = Math.max(0, Math.min(lo, hi));
  const max = Math.max(min, lo, hi);
  const scripted = new ScriptedProvider({
    id: DEMO_PROVIDER_ID,
    protocol: "openai_chat",
    script: (req) => demoTurn(req, roleBySystem),
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
