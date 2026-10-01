// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Sample data for the island preview (?state=... in a browser) and its
// tests: a small studio run folded through the same reducer as the live
// feed, so every preview state reads exactly as a real run would. The
// crew names come from the shared roster, so each cat wears its own coat.
// The scenario gallery (scenarios.ts) builds on the same run and keeps its
// script open, stamping each live event with the preview clock (Script.at).
import { lookFor } from "@mengai/cats/src/roster";
import type { AgentDTO, AgentRole, AgentStatus, Activity, MengaiEvent, OrderDTO, RunDTO, TaskDTO, UsageTotals } from "@mengai/shared";
import { applyEvent, emptyLive, miniOf, type IslandLive } from "./live";

export const PREVIEW_RUN_ID = "island-preview";
export const PREVIEW_STATES = ["idle", "collapsed", "peek", "expanded", "shipped", "failed"] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];

export function readPreviewState(raw: string | null): PreviewState | "live" {
  if (raw === "ask") return "expanded";
  if (raw === "live") return "live";
  return (PREVIEW_STATES as readonly string[]).includes(raw ?? "") ? (raw as PreviewState) : "collapsed";
}

const ZERO: UsageTotals = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0, calls: 0 };

/** Builds an event list with rising seq numbers and times. */
export class Script {
  private seq: number;
  private ts: number;
  readonly events: MengaiEvent[] = [];
  constructor(
    readonly runId: string,
    start: number,
    firstSeq = 1,
  ) {
    this.ts = start;
    this.seq = firstSeq;
  }
  emit<T extends MengaiEvent["type"]>(type: T, data: MengaiEvent<T>["data"], agentId: string | null = null, taskId: string | null = null, runId: string | null = this.runId): MengaiEvent<T> {
    const e = { seq: this.seq++, ts: this.ts, type, runId, agentId, taskId, data } as MengaiEvent<T>;
    this.ts += 1000;
    this.events.push(e);
    return e;
  }
  get now(): number {
    return this.ts;
  }
  /** The next events carry this time (the preview clock of a scenario playing live). */
  at(ts: number): this {
    this.ts = ts;
    return this;
  }
}

export function runDTO(id: string, goal: string, createdAt: number, over: Partial<RunDTO> = {}): RunDTO {
  return {
    id,
    projectId: "p-island",
    goal,
    status: "running",
    statusReason: null,
    budgetTokens: 400_000,
    budgetUsd: 0,
    usage: ZERO,
    progress: 0,
    startedAt: createdAt,
    endedAt: null,
    createdAt,
    company: "studio",
    ...over,
  };
}

export function agentDTO(runId: string, id: string, name: string, role: AgentRole, at: number, over: Partial<AgentDTO> = {}): AgentDTO {
  return {
    id,
    runId,
    parentId: role === "lead" ? null : "a-oyen",
    role,
    name,
    look: lookFor(name),
    tier: "balanced",
    status: "idle",
    activity: "rest",
    mood: "calm",
    statusText: null,
    currentTaskId: null,
    steps: 0,
    usage: ZERO,
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

export function taskDTO(runId: string, id: string, title: string, role: AgentRole, assigneeId: string | null, at: number, over: Partial<TaskDTO> = {}): TaskDTO {
  return {
    id,
    runId,
    parentId: null,
    title,
    spec: title,
    acceptance: [],
    role,
    assigneeId,
    status: "queued",
    priority: 100,
    deps: [],
    review: false,
    attempts: 1,
    resultSummary: null,
    createdBy: "a-oyen",
    createdAt: at,
    updatedAt: at,
    startedAt: null,
    endedAt: null,
    ...over,
  };
}

export function orderDTO(id: string, runId: string | null, at: number, over: Partial<OrderDTO> = {}): OrderDTO {
  return {
    id,
    runId,
    agentId: "a-gembul",
    symbol: "BTCUSDT",
    side: "buy",
    qty: 0.25,
    type: "limit",
    limitPrice: 64_120,
    mode: "live",
    status: "proposed",
    venue: "binance",
    reason: "momentum turned up and funding flipped positive, sized at 2 percent of the book",
    riskNote: "Within the daily loss limit",
    fillPrice: null,
    createdAt: at,
    decidedAt: null,
    filledAt: null,
    ...over,
  };
}

const CREW: Array<{ id: string; name: string; role: AgentRole; status: AgentStatus; activity: Activity; text: string; task: string | null }> = [
  { id: "a-oyen", name: "Oyen", role: "lead", status: "thinking", activity: "review", text: "Watching the review of the export", task: null },
  { id: "a-gembul", name: "Gembul", role: "engineer", status: "working", activity: "code", text: "Writing the CSV export button", task: "t-export" },
  { id: "a-klepon", name: "Klepon", role: "reviewer", status: "working", activity: "review", text: "Reviewing the export code", task: "t-review" },
  { id: "a-tempe", name: "Tempe", role: "qa", status: "waiting", activity: "wait", text: "Waiting for the review to test", task: null },
  { id: "a-onde", name: "Onde", role: "designer", status: "idle", activity: "rest", text: "Resting after the page layout", task: null },
];

export const PREVIEW_GOAL = "Add a CSV export to the shop's sales page";

/** The sample run in review, five cats, two of them at work. `start` is the event clock. */
export function sampleRun(start: number, runId = PREVIEW_RUN_ID): Script {
  const s = new Script(runId, start);
  s.emit("run.created", { run: runDTO(runId, PREVIEW_GOAL, start) });
  for (const c of CREW) s.emit("agent.spawned", { agent: agentDTO(runId, c.id, c.name, c.role, s.now) }, c.id);
  s.emit("task.created", { task: taskDTO(runId, "t-export", "Build the CSV export", "engineer", "a-gembul", s.now, { status: "running" }) }, "a-oyen", "t-export");
  s.emit("task.created", { task: taskDTO(runId, "t-review", "Review the export", "reviewer", "a-klepon", s.now, { status: "running" }) }, "a-oyen", "t-review");
  for (const [stage, previous] of [
    ["goal", null],
    ["planned", "goal"],
    ["hired", "planned"],
    ["working", "hired"],
    ["review", "working"],
  ] as const) {
    s.emit("run.stage", { stage, previous, reason: `Moved to ${stage}` });
  }
  for (const c of CREW) s.emit("agent.status", { status: c.status, activity: c.activity, mood: "focused", statusText: c.text, taskId: c.task }, c.id, c.task);
  s.emit("run.usage", { usage: { ...ZERO, inputTokens: 120_000, outputTokens: 30_000 }, budgetTokens: 400_000, budgetUsd: 0, progress: 0.62 });
  return s;
}

/** A cat raising a yes or no question to the owner and waiting on it. */
export function askOwner(s: Script, requestId = "rq-install"): void {
  s.emit("request.raised", { requestId, fromAgentId: "a-klepon", toAgentId: null, question: "May I run npm install papaparse, a medium risk tool? It parses the CSV in the browser.", toOwner: true }, "a-klepon", "t-review");
  s.emit("agent.status", { status: "approval", activity: "ask", mood: "focused", statusText: "Meowing for you: may I run npm install papaparse?", taskId: "t-review" }, "a-klepon", "t-review");
}

/** Every event of a script through the island's reducer, the island clock at `now`. */
export function fold(s: Script, now: number, live: IslandLive = emptyLive()): IslandLive {
  let l = live;
  for (const e of s.events) l = applyEvent(l, e, now).live;
  return l;
}

/** The island's picture for a preview state; `now` is the island clock the finish counts from. */
export function previewLive(state: PreviewState, now: number): IslandLive {
  if (state === "idle") return emptyLive();
  const s = sampleRun(now - 600_000);
  if (state === "expanded") {
    const order = orderDTO("o-btc", null, now - 400_000);
    s.emit("trade.order", { order }, "a-gembul", null, null);
    askOwner(s);
  }
  const live = fold(s, now);
  if (state === "shipped" || state === "failed") {
    const lead = miniOf(live.runs[PREVIEW_RUN_ID]?.agents["a-oyen"]);
    const runs = { ...live.runs };
    delete runs[PREVIEW_RUN_ID];
    return {
      ...live,
      runs,
      finish:
        state === "shipped"
          ? { kind: "shipped", runId: PREVIEW_RUN_ID, goal: PREVIEW_GOAL, reason: null, at: now, lead: { ...lead, status: "done", activity: "celebrate", mood: "proud" } }
          : {
              kind: "failed",
              runId: PREVIEW_RUN_ID,
              goal: PREVIEW_GOAL,
              reason: "The model provider refused the request: this month's spend limit was reached.",
              at: now,
              lead: { ...lead, status: "error", activity: "rest", mood: "frustrated" },
            },
    };
  }
  return live;
}
