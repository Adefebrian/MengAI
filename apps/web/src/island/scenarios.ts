// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The island's scenario gallery (the browser preview, ?scenario=<id>): one
// sample of every island scenario, each driven by real events of the
// stream through the real pipeline (the feed's reducer, the moments
// deriver, the director, the machine), never by a hand-set frame. A
// scenario starts from the sample studio run (fixture.ts) and plays its
// steps on a timeline from t = 0: events stamped with the preview clock,
// the shell's pointer calls, the owner's own clicks and keys on the island,
// and, where the island waits on time (the tuck, a quirk), a jump of the
// preview clock so it shows in seconds. Each has a one-line description in
// plain words: what changed and who did it.
import type { Capability, MengaiEvent } from "@mengai/shared";
import { QUIRK_GAP_MAX_MS, QUIRK_QUIET_MS } from "./director";
import { PREVIEW_RUN_ID, Script, agentDTO, fold, orderDTO, sampleRun, taskDTO } from "./fixture";
import { emptyLive, type IslandLive } from "./live";
import type { PointerZone } from "./native";
import { TUCK_MS } from "./progress";

const RUN = PREVIEW_RUN_ID;

/** What a step may do. The island side (IslandApp) carries each out for real. */
export interface ScenarioCtx {
  /** the preview clock, for the times inside an event's payload */
  now(): number;
  /** one event of the stream, stamped with the preview clock, through the island's own reducer and moments */
  emit<T extends MengaiEvent["type"]>(type: T, data: MengaiEvent<T>["data"], agentId?: string | null, taskId?: string | null, runId?: string | null): void;
  /** the shell's pointer call (window-local points; y under the band height lands on the shape) */
  pointer(zone: PointerZone, x?: number, y?: number): void;
  /** the preview clock jumps forward, as if that much time went by with nothing new */
  skip(ms: number): void;
  /** the owner clicks the island button with this text or accessible name */
  press(label: string): void;
  /** the owner clicks the band's mini cat */
  tapCat(): void;
  /** the owner presses a key on the island */
  key(key: string): void;
}

export interface ScenarioStep {
  /** ms after the scenario starts */
  at: number;
  run(ctx: ScenarioCtx): void;
}

export type ScenarioGroup = "run" | "asks" | "crew" | "end" | "play";

export interface Scenario {
  id: string;
  group: ScenarioGroup;
  /** the button's words */
  title: string;
  /** one plain line under the screen: what changed and who did it */
  description: string;
  /** how long the tour stays on it */
  ms: number;
  /** the island before the first step, and the script its own events continue */
  start(now: number): ScenarioStart;
  steps: ScenarioStep[];
}

export interface ScenarioStart {
  live: IslandLive;
  /** its seq numbers carry on after the folded ones; Script.at stamps each live event */
  script: Script;
}

export const SCENARIO_GROUPS: ReadonlyArray<{ id: ScenarioGroup; title: string }> = [
  { id: "run", title: "The run" },
  { id: "asks", title: "Asks" },
  { id: "crew", title: "The crew" },
  { id: "end", title: "The end of a run" },
  { id: "play", title: "Play" },
];

// ------------------------------------------------------------------ the sample run

/** The sample run plus a fuller board: three tasks done, two running, one queued. */
export function scenarioRun(now: number): Script {
  const s = sampleRun(now - 600_000);
  const done = { status: "done" as const, startedAt: s.now, endedAt: s.now };
  s.emit("task.created", { task: taskDTO(RUN, "t-plan", "Plan the export", "lead", "a-oyen", s.now, done) }, "a-oyen", "t-plan");
  s.emit("task.created", { task: taskDTO(RUN, "t-layout", "Lay out the export button", "designer", "a-onde", s.now, done) }, "a-onde", "t-layout");
  s.emit("task.created", { task: taskDTO(RUN, "t-route", "Add the export route", "engineer", "a-gembul", s.now, done) }, "a-gembul", "t-route");
  s.emit("task.created", { task: taskDTO(RUN, "t-test", "Test the CSV export", "qa", "a-tempe", s.now) }, "a-oyen", "t-test");
  return s;
}

/** The sample run, live on the island, its script open for the scenario's own events. */
function runStart(now: number): ScenarioStart {
  const script = scenarioRun(now);
  return { live: fold(script, now), script };
}

/** Nothing runs. */
function idleStart(now: number): ScenarioStart {
  return { live: emptyLive(), script: new Script(RUN, now) };
}

function approval(id: string, capability: Capability, agentId: string, title: string, detail: Record<string, unknown>, at: number) {
  return { id, runId: RUN, agentId, capability, risk: "write" as const, title, detail, status: "pending" as const, scope: "once" as const, createdAt: at, decidedAt: null, expiresAt: at + 600_000 };
}

/** A cat asks the owner for a capability and waits on the answer. */
function ask(c: ScenarioCtx, id: string, capability: Capability, agentId: string, taskId: string, title: string, detail: Record<string, unknown>, at = c.now()): void {
  c.emit("approval.requested", { approval: approval(id, capability, agentId, title, detail, at) }, agentId, taskId);
  c.emit("agent.status", { status: "approval", activity: "ask", mood: "focused", statusText: `Meowing for you: may I ${title.charAt(0).toLowerCase()}${title.slice(1)}?`, taskId }, agentId, taskId);
}

function shellAsk(c: ScenarioCtx): void {
  ask(c, "ap-shell", "shell", "a-klepon", "t-review", "Run npm install papaparse in the shop repo", { command: "npm install papaparse" });
}

function hint(c: ScenarioCtx, kind: MengaiEvent<"moment">["data"]["kind"], agentId: string, taskId: string | null, level: "info" | "good" | "bad", text: string): void {
  c.emit("moment", { kind, agentId, taskId, level, text }, agentId, taskId);
}

/** A task's new state, stamped now. */
function task(c: ScenarioCtx, id: string, title: string, role: Parameters<typeof taskDTO>[3], agentId: string, status: "running" | "done"): void {
  const at = c.now();
  c.emit("task.updated", { task: taskDTO(RUN, id, title, role, agentId, at, { status, startedAt: at, endedAt: status === "done" ? at : null }) }, agentId, id);
}

/** The two running tasks finish: the export by Gembul, its review by Klepon. */
function finishTasks(c: ScenarioCtx): void {
  task(c, "t-export", "Build the CSV export", "engineer", "a-gembul", "done");
  task(c, "t-review", "Review the export", "reviewer", "a-klepon", "done");
}

function usage(c: ScenarioCtx, inputTokens: number, progress: number): void {
  c.emit("run.usage", { usage: { inputTokens, outputTokens: 30_000, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0, calls: 40 }, budgetTokens: 400_000, budgetUsd: 0, progress });
}

const FAIL_REASON = "The model provider refused the request: this month's spend limit was reached.";

// The pointer on the band: centred, a few points down.
const ON_BAND = { x: 240, y: 10 };

function step(at: number, run: (c: ScenarioCtx) => void): ScenarioStep {
  return { at, run };
}

/** Tempe starts testing: news for the tuck, a new running share for the ring. */
function tempeStarts(c: ScenarioCtx): void {
  task(c, "t-test", "Test the CSV export", "qa", "a-tempe", "running");
}

export const SCENARIOS: readonly Scenario[] = [
  // ---------------------------------------------------------------- the run
  {
    id: "idle",
    group: "run",
    title: "Nothing runs",
    description: "No run is live: the island is exactly the notch, and nothing shows on it.",
    ms: 3000,
    start: idleStart,
    steps: [],
  },
  {
    id: "collapsed",
    group: "run",
    title: "Run in progress",
    description: "The crew is working: mini Oyen, the ring and the stage (Review 5 of 7) sit in the ears.",
    ms: 4500,
    start: runStart,
    steps: [],
  },
  {
    id: "ear-rotation",
    group: "run",
    title: "Ear rotation",
    description: "Every 6 s the ear says the next true thing: the stage, each cat at work, what is left; the mini cat turns to the cat it names.",
    ms: 25_000,
    start: runStart,
    steps: [],
  },
  {
    id: "ring-run",
    group: "run",
    title: "Ring: running",
    description: "Gembul finished the export: the solid done arc grows, and Tempe's new task joins the dim running arc right after it.",
    ms: 5500,
    start: runStart,
    steps: [
      step(1200, (c) => {
        task(c, "t-export", "Build the CSV export", "engineer", "a-gembul", "done");
        usage(c, 160_000, 0.75);
      }),
      step(3200, tempeStarts),
    ],
  },
  {
    id: "ring-wait",
    group: "run",
    title: "Ring: waits on you",
    description: "Klepon asks to run a command and you put it aside with Escape: the ring turns amber and the ear counts what waits.",
    ms: 5500,
    start: runStart,
    steps: [step(800, shellAsk), step(2600, (c) => c.key("Escape"))],
  },
  {
    id: "ring-paused",
    group: "run",
    title: "Ring: paused",
    description: "You paused the run: the ring dims to grey and the ear says Paused.",
    ms: 4000,
    start: runStart,
    steps: [step(1000, (c) => c.emit("run.status", { status: "paused", reason: "Paused by you" }))],
  },
  {
    id: "ring-low",
    group: "run",
    title: "Ring: budget low",
    description: "The run has spent 82 percent of its token budget: the ring turns amber.",
    ms: 4000,
    start: runStart,
    steps: [step(1000, (c) => usage(c, 300_000, 0.7))],
  },
  {
    id: "ring-failed",
    group: "run",
    title: "Ring: failed",
    description: "The provider refused the run: the ring turns red and the ear says Failed.",
    ms: 4500,
    start: runStart,
    steps: [step(1000, (c) => c.emit("run.status", { status: "failed", reason: FAIL_REASON }))],
  },
  {
    id: "ring-shipped",
    group: "run",
    title: "Ring: shipped",
    description: "Klepon finished the last review and the run shipped: the ring closes in green.",
    ms: 5000,
    start: runStart,
    steps: [
      step(600, finishTasks),
      step(1000, (c) => c.emit("run.status", { status: "done", reason: null })),
    ],
  },
  {
    id: "tucked",
    group: "run",
    title: "Tucked after quiet",
    description: "Nothing changed for 20 s (fast forwarded): the island tucks into the notch; Tempe starting a task brings it back out.",
    ms: 7000,
    start: runStart,
    steps: [
      step(1500, (c) => c.skip(TUCK_MS - 500)),
      step(5000, tempeStarts),
    ],
  },
  {
    id: "near",
    group: "run",
    title: "Pointer near",
    description: "Your pointer passes near the island on its way to the menu bar: the ears fold into the notch at once, and come back 0.6 s after it leaves.",
    ms: 6000,
    start: runStart,
    steps: [step(1500, (c) => c.pointer("near", -24, 12)), step(4000, (c) => c.pointer("far", -200, 60))],
  },
  {
    id: "peek",
    group: "run",
    title: "Peek at the crew",
    description: "Your pointer rests on the island: it opens to show who is doing what right now.",
    ms: 4500,
    start: runStart,
    steps: [step(1000, (c) => c.pointer("inside", ON_BAND.x, ON_BAND.y))],
  },
  // ---------------------------------------------------------------- asks
  {
    id: "ask-shell",
    group: "asks",
    title: "Ask: shell",
    description: "Klepon needs your yes to run a shell command: it comes out under the island holding a terminal.",
    ms: 5000,
    start: runStart,
    steps: [step(800, shellAsk)],
  },
  {
    id: "ask-file",
    group: "asks",
    title: "Ask: file write",
    description: "Gembul asks to write a file: it comes out holding the page it wants to change.",
    ms: 5000,
    start: runStart,
    steps: [step(800, (c) => ask(c, "ap-file", "fs", "a-gembul", "t-export", "Write src/export/csv.ts", { path: "src/export/csv.ts" }))],
  },
  {
    id: "ask-network",
    group: "asks",
    title: "Ask: network",
    description: "Tempe asks to reach the staging site: it comes out holding the spyglass.",
    ms: 5000,
    start: runStart,
    steps: [step(800, (c) => ask(c, "ap-net", "network", "a-tempe", "t-test", "Fetch staging.shop.test to check the export", { url: "https://staging.shop.test" }))],
  },
  {
    id: "ask-automation",
    group: "asks",
    title: "Ask: automation",
    description: "Onde asks to drive the browser: it comes out holding the runbook.",
    ms: 5000,
    start: runStart,
    steps: [step(800, (c) => ask(c, "ap-auto", "browser", "a-onde", "t-layout", "Open the shop admin and click Export", { url: "https://shop.test/admin" }))],
  },
  {
    id: "approve",
    group: "asks",
    title: "Approve reaction",
    description: "You approved Klepon's command: Klepon celebrates, then climbs back into the island.",
    ms: 6000,
    start: runStart,
    steps: [step(800, shellAsk), step(2800, (c) => c.press("Approve"))],
  },
  {
    id: "deny",
    group: "asks",
    title: "Deny reaction",
    description: "You said no to Klepon's command: its ears go down, then it climbs back into the island.",
    ms: 6000,
    start: runStart,
    steps: [step(800, shellAsk), step(2800, (c) => c.press("Deny"))],
  },
  {
    id: "ask-order",
    group: "asks",
    title: "Ask: live order",
    description: "Gembul proposes a live order: it holds the order card until you approve or reject it.",
    ms: 5000,
    start: runStart,
    steps: [step(800, (c) => c.emit("trade.order", { order: orderDTO("o-btc", null, c.now()) }, "a-gembul", null, null))],
  },
  {
    id: "ask-question",
    group: "asks",
    title: "Ask: question",
    description: "Onde has an open question for you: it thinks, holding a page, and you answer in MengAI.",
    ms: 5000,
    start: runStart,
    steps: [
      step(800, (c) => {
        c.emit("request.raised", { requestId: "rq-accent", fromAgentId: "a-onde", toAgentId: null, question: "Which accent should the export button use?", toOwner: true }, "a-onde", "t-layout");
        c.emit("agent.status", { status: "approval", activity: "ask", mood: "focused", statusText: "Meowing for you: which accent should the export button use?", taskId: "t-layout" }, "a-onde", "t-layout");
      }),
    ],
  },
  {
    id: "ask-queue",
    group: "asks",
    title: "Queue of 3 asks",
    description: "Klepon, Gembul and a live order wait, oldest first; stepping to the next ask brings its own cat out.",
    ms: 7000,
    start: runStart,
    steps: [
      step(800, (c) => {
        shellAsk(c);
        ask(c, "ap-file", "fs", "a-gembul", "t-export", "Write src/export/csv.ts", { path: "src/export/csv.ts" }, c.now() + 1);
        c.emit("trade.order", { order: orderDTO("o-btc", null, c.now() + 2) }, "a-gembul", null, null);
      }),
      step(3600, (c) => c.press("Next request")),
    ],
  },
  // ---------------------------------------------------------------- the crew
  {
    id: "hire",
    group: "crew",
    title: "Hire",
    description: "Oyen hired Kopi as an engineer: Kopi drops out of the island, waves once and climbs back in.",
    ms: 4500,
    start: runStart,
    steps: [step(1000, (c) => c.emit("agent.spawned", { agent: agentDTO(RUN, "a-kopi", "Kopi", "engineer", c.now()), reason: "work is waiting", hiredBy: "a-oyen" }, "a-kopi"))],
  },
  {
    id: "let-go",
    group: "crew",
    title: "Let go",
    description: "Oyen let Onde go now the design is done: Onde lies down and slides away.",
    ms: 4000,
    start: runStart,
    steps: [step(1000, (c) => c.emit("agent.left", { agentId: "a-onde", reason: "no design work left", byAgentId: "a-oyen", requeued: [] }, "a-oyen"))],
  },
  {
    id: "handoff",
    group: "crew",
    title: "Handoff",
    description: "Gembul handed the export to Klepon: Gembul holds out the card and Klepon catches it into review.",
    ms: 4500,
    start: runStart,
    steps: [
      step(1000, (c) =>
        c.emit("handoff", { handoff: { id: "h-1", runId: RUN, taskId: "t-export", fromAgentId: "a-gembul", toAgentId: "a-klepon", toRole: "reviewer", summary: "Export ready for review", createdAt: c.now() } }, "a-gembul", "t-export"),
      ),
    ],
  },
  {
    id: "review-pass",
    group: "crew",
    title: "Review passed",
    description: "Klepon passed the export in review: it hops out and cheers.",
    ms: 4500,
    start: runStart,
    steps: [step(1000, (c) => hint(c, "review_pass", "a-klepon", "t-review", "good", "Klepon passed the CSV export in review."))],
  },
  {
    id: "review-fail",
    group: "crew",
    title: "Review failed",
    description: "Klepon sent the export back: it comes out holding the bug it found.",
    ms: 4500,
    start: runStart,
    steps: [step(1000, (c) => hint(c, "review_fail", "a-klepon", "t-review", "bad", "Klepon found an empty file bug and sent the export back."))],
  },
  {
    id: "ceo-approved",
    group: "crew",
    title: "CEO approved",
    description: "Oyen approved Gembul's request for more time on its own: Oyen comes out and nods.",
    ms: 4000,
    start: runStart,
    steps: [step(1000, (c) => hint(c, "ceo_approved", "a-oyen", "t-export", "good", "Oyen gave Gembul more time for the export."))],
  },
  {
    id: "ceo-denied",
    group: "crew",
    title: "CEO denied",
    description: "Oyen turned down a crew request on its own: Oyen comes out and lies down.",
    ms: 4000,
    start: runStart,
    steps: [step(1000, (c) => hint(c, "ceo_denied", "a-oyen", "t-export", "bad", "Oyen turned down a second export format."))],
  },
  {
    id: "rethink",
    group: "crew",
    title: "Rethink",
    description: "Gembul's self-check failed: it comes out to think the approach over.",
    ms: 4000,
    start: runStart,
    steps: [step(1000, (c) => hint(c, "rethink", "a-gembul", "t-export", "info", "Gembul is rethinking how the export streams rows."))],
  },
  {
    id: "stuck",
    group: "crew",
    title: "Stuck",
    description: "Tempe hit the same failing test three times: it comes out frowning, twitches an ear and tries another way.",
    ms: 4000,
    start: runStart,
    steps: [step(1000, (c) => hint(c, "stuck", "a-tempe", "t-test", "bad", "Tempe is stuck on the same failing test and tries another way."))],
  },
  {
    id: "budget-low",
    group: "crew",
    title: "Budget low",
    description: "The run spent most of its budget: Oyen checks the plan with its clipboard and the ring turns amber.",
    ms: 4500,
    start: runStart,
    steps: [
      step(1000, (c) => {
        usage(c, 300_000, 0.7);
        hint(c, "budget_low", "a-oyen", null, "bad", "The run has spent 82 percent of its budget.");
      }),
    ],
  },
  {
    id: "stage-done",
    group: "crew",
    title: "Stage done",
    description: "Klepon finished review: the island pops the news and Klepon celebrates; testing is next.",
    ms: 4500,
    start: runStart,
    steps: [
      step(600, (c) => task(c, "t-review", "Review the export", "reviewer", "a-klepon", "done")),
      step(1000, (c) => c.emit("run.stage", { stage: "testing", previous: "review", reason: "Review passed" })),
    ],
  },
  // ---------------------------------------------------------------- the end of a run
  {
    id: "shipped",
    group: "end",
    title: "Shipped, 3 cats",
    description: "Oyen and the crew shipped the run: Gembul, Oyen and Klepon hop out on a stagger and cheer, the lead in the middle.",
    ms: 5500,
    start: runStart,
    steps: [
      step(600, finishTasks),
      step(1000, (c) => c.emit("run.status", { status: "done", reason: null })),
    ],
  },
  {
    id: "failed",
    group: "end",
    title: "Run failed",
    description: "The run failed: Oyen lies still under the island until you act; Dismiss sends Oyen back in.",
    ms: 7000,
    start: runStart,
    steps: [step(1000, (c) => c.emit("run.status", { status: "failed", reason: FAIL_REASON })), step(5000, (c) => c.press("Dismiss"))],
  },
  // ---------------------------------------------------------------- play
  {
    id: "quirk",
    group: "play",
    title: "Fooling around",
    description: "Nothing happened on the stage for two minutes (fast forwarded): a crew cat at work slides out, fools around once and climbs back.",
    ms: 6000,
    start: runStart,
    steps: [
      step(1000, (c) => {
        c.skip(QUIRK_GAP_MAX_MS + QUIRK_QUIET_MS);
        // news in the same instant keeps the island out of the tuck, so the cat comes out under the ears
        tempeStarts(c);
      }),
    ],
  },
  {
    id: "tap",
    group: "play",
    title: "Tap",
    description: "You clicked mini Oyen: Oyen pops out under the island and looks up at you.",
    ms: 3500,
    start: runStart,
    steps: [step(1200, (c) => c.tapCat())],
  },
  {
    id: "tap-combo",
    group: "play",
    title: "Tap combo",
    description: "You clicked mini Oyen three times quickly: a crew cat at work pops out to wave.",
    ms: 4000,
    start: runStart,
    steps: [step(1000, (c) => c.tapCat()), step(1300, (c) => c.tapCat()), step(1600, (c) => c.tapCat())],
  },
];

export function findScenario(id: string | null | undefined): Scenario | null {
  return SCENARIOS.find((s) => s.id === id) ?? null;
}

/** The preview's clock: real time from `start`, plus every jump forward. */
export interface PreviewClock {
  now(): number;
  skip(ms: number): void;
}

export function previewClock(start: number, real: () => number = Date.now): PreviewClock {
  const base = real();
  let ahead = 0;
  return {
    now: () => start + (real() - base) + ahead,
    skip: (ms) => {
      ahead += Math.max(0, ms);
    },
  };
}
