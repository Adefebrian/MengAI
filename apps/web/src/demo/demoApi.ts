// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Demo mode's server: an in-memory fetch that answers the same Routes the
// real API serves, with sample data, so every screen renders the real
// client path (ApiClient, errors, CSRF header) with no network at all.
// Keys typed into the demo are never kept: only a 4 character hint, the
// same rule the real vault follows. Health answers as a Mac engine with
// every feature on; ?platform=win32 (or linux) answers as that engine, with
// the sandbox-dependent features off and refused like the real engine
// refuses them, so the page shows its coming-soon states. ?skills=empty
// opens the written skills with the built-in pack only, ?skills=error makes
// their list fail, so the Skills screen shows those states too. Routing
// plays a reasoning effort per tier (Fast on None, Balanced on Default by
// leaving it out, Deep on High) and refuses a value the engine would not
// know, storing Default as the missing value like the engine.
import {
  CSRF_HEADER,
  PROVIDER_PRESETS,
  REASONING_EFFORTS,
  TRADING_VENUE_PRESETS,
  findPreset,
  type AssetDTO,
  type ContextXrayDTO,
  type CreateProviderBody,
  type EvalRunDTO,
  type HealthDTO,
  type PlatformFeatures,
  type FindingDTO,
  type LessonDTO,
  type ModelRouting,
  type OwnerSettings,
  type PreviewDTO,
  type ProjectDTO,
  type ProviderDTO,
  type RunDTO,
  type RunSnapshotDTO,
  type ScanDTO,
  type SkillDTO,
  type UsageReport,
  type UsageTotals,
} from "@mengai/shared";
import type { CreateConnectorBody, CreateCrewSkillBody, CreateTradingVenueBody, RunStage, TradingSettings, UpdateConnectorBody, UpdateCrewSkillBody } from "@mengai/shared";
import { matchPath } from "../router";
import { DEMO_SITE_PAGE } from "./site";
import { createCapabilityState, demoMind } from "./capabilities";
import { createCrewSkillState, type CrewSkillResult } from "./crewSkills";
import { replay } from "../store/runStore";
import {
  DEMO_CALLS,
  DEMO_EVENTS,
  demoFiles,
  DEMO_PROJECT,
  DEMO_RUN_ID,
  DEMO_T0,
  DEMO_WARM_SEQ,
  demoFile,
} from "./fixture";

type Handler = (ctx: { params: Record<string, string>; query: URLSearchParams; body: unknown }) => unknown;

let clockFn: () => number = () => Number.POSITIVE_INFINITY;
/** The demo player's clock, so usage and calls match what the board shows. */
export function setDemoClock(fn: () => number): void {
  clockFn = fn;
}

const H = 3_600_000;
const D = 86_400_000;

function usageOf(list: typeof DEMO_CALLS): UsageTotals {
  return list.reduce<UsageTotals>(
    (u, c) => ({
      inputTokens: u.inputTokens + c.inputTokens,
      outputTokens: u.outputTokens + c.outputTokens,
      cachedTokens: u.cachedTokens + c.cachedTokens,
      cacheWriteTokens: u.cacheWriteTokens + c.cacheWriteTokens,
      costUsd: u.costUsd + c.costUsd,
      calls: u.calls + 1,
    }),
    { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0, calls: 0 },
  );
}

/** The run as the board first shows it: the whole crew on it, one request waiting on you. */
function snapshotAt(seq: number): RunSnapshotDTO {
  const s = replay(DEMO_EVENTS.filter((e) => e.seq <= seq));
  return {
    run: s.run!,
    agents: s.agentOrder.map((id) => s.agents[id]!),
    tasks: s.taskOrder.map((id) => s.tasks[id]!),
    handoffs: s.handoffs,
    decisions: s.decisions,
    approvals: s.approvalOrder.map((id) => s.approvals[id]!),
    roles: Object.values(s.roles),
    ...(s.stage ? { stage: s.stage as RunStage } : {}),
    lastSeq: s.lastSeq,
  };
}

export function createDemoState() {
  const snapshot = snapshotAt(DEMO_WARM_SEQ);
  const olderRun: RunDTO = {
    id: "demo-older",
    projectId: "demo-project-2",
    goal: "Move the menu page to React 19 and drop the class components",
    status: "failed",
    statusReason: "Budget reached: 400,000 tokens",
    budgetTokens: 400_000,
    budgetUsd: 5,
    usage: { inputTokens: 371_220, outputTokens: 28_910, cachedTokens: 201_400, cacheWriteTokens: 0, costUsd: 0.21, calls: 96 },
    progress: 0.7,
    startedAt: DEMO_T0 - 2 * D,
    endedAt: DEMO_T0 - 2 * D + 41 * 60_000,
    createdAt: DEMO_T0 - 2 * D,
  };
  const projects: ProjectDTO[] = [
    DEMO_PROJECT,
    { id: "demo-project-2", name: "kopi-menu", workspacePath: "/Users/you/code/kopi-menu", createdAt: DEMO_T0 - 20 * D, updatedAt: DEMO_T0 - 2 * D, lastRunId: "demo-older" },
  ];
  const providers: ProviderDTO[] = [
    {
      id: "prov-openai",
      preset: "openai",
      label: "OpenAI",
      protocol: "openai_chat",
      baseUrl: "https://api.openai.com/v1",
      hasKey: true,
      keyHint: "8f2a",
      models: [{ id: "gpt-4o-mini" }, { id: "gpt-4.1" }],
      caps: ["chat", "tools", "vision"],
      lastTestAt: DEMO_T0 - H,
      lastTestOk: true,
      lastTestError: null,
      createdAt: DEMO_T0 - 6 * D,
      updatedAt: DEMO_T0 - H,
    },
    {
      id: "prov-anthropic",
      preset: "anthropic",
      label: "Anthropic Claude",
      protocol: "anthropic_messages",
      baseUrl: "https://api.anthropic.com",
      hasKey: true,
      keyHint: "q1Bc",
      models: [{ id: "claude-sonnet-5-5" }],
      caps: ["chat", "tools", "vision"],
      lastTestAt: DEMO_T0 - 3 * D,
      lastTestOk: true,
      lastTestError: null,
      createdAt: DEMO_T0 - 5 * D,
      updatedAt: DEMO_T0 - 3 * D,
    },
    {
      id: "prov-ollama",
      preset: "ollama",
      label: "Ollama (local)",
      protocol: "openai_chat",
      baseUrl: "http://localhost:11434/v1",
      hasKey: false,
      keyHint: null,
      models: [],
      caps: ["chat", "tools"],
      lastTestAt: DEMO_T0 - 2 * H,
      lastTestOk: false,
      lastTestError: "Connection refused on localhost:11434",
      createdAt: DEMO_T0 - 2 * D,
      updatedAt: DEMO_T0 - 2 * H,
    },
  ];
  let routing: ModelRouting = {
    tiers: [
      { tier: "fast", providerId: "prov-openai", model: "gpt-4o-mini", reasoning: "none" },
      { tier: "balanced", providerId: "prov-openai", model: "gpt-4o-mini" },
      { tier: "deep", providerId: "prov-openai", model: "gpt-4.1", reasoning: "high" },
    ],
    roleTiers: { lead: "deep" },
    image: { providerId: "prov-openai", model: "gpt-image-1-mini" },
    video: { providerId: null, model: null },
  };
  let settings: OwnerSettings = {
    defaultBudgetTokens: 400_000,
    defaultBudgetUsd: 5,
    maxConcurrentAgents: 4,
    ceoName: "Oyen",
    maxAgents: 0,
    maxDepth: 0,
    allowNetworkTools: false,
    motion: "full",
    prices: {},
  };
  const lessons: LessonDTO[] = [
    { id: "l-1", scope: "role", role: "engineer", projectId: null, text: "Quote CSV fields that contain a comma, a quote, CR or LF, and double embedded quotes.", tags: ["csv"], status: "candidate", uses: 1, wins: 1, losses: 0, score: 0.67, createdAt: DEMO_T0, lastUsedAt: DEMO_T0 },
    { id: "l-2", scope: "project", role: null, projectId: DEMO_PROJECT.id, text: "Money is stored in cents as integers; format it only at the edge.", tags: ["money"], status: "active", uses: 6, wins: 5, losses: 1, score: 0.75, createdAt: DEMO_T0 - 5 * D, lastUsedAt: DEMO_T0 },
    { id: "l-3", scope: "role", role: "reviewer", projectId: null, text: "Run the tests yourself before passing a review, never trust the summary.", tags: ["review"], status: "active", uses: 9, wins: 8, losses: 1, score: 0.82, createdAt: DEMO_T0 - 9 * D, lastUsedAt: DEMO_T0 },
    { id: "l-4", scope: "global", role: null, projectId: null, text: "Read a file by line range before editing it; never rewrite a whole file for a small change.", tags: ["tokens"], status: "active", uses: 14, wins: 12, losses: 2, score: 0.81, createdAt: DEMO_T0 - 12 * D, lastUsedAt: DEMO_T0 - H },
    { id: "l-5", scope: "role", role: "qa", projectId: null, text: "Use Playwright for every UI test.", tags: ["tests"], status: "retired", uses: 6, wins: 1, losses: 5, score: 0.25, createdAt: DEMO_T0 - 15 * D, lastUsedAt: DEMO_T0 - 4 * D },
  ];
  const skills: SkillDTO[] = [
    { id: "s-1", name: "Run the report tests", description: "Type check, then run the report suite and summarise failures.", role: "engineer", steps: [{ tool: "shell_run", args: { command: "bun run typecheck" } }, { tool: "shell_run", args: { command: "bun test src/report" } }], uses: 7, wins: 6, createdAt: DEMO_T0 - 4 * D },
    { id: "s-2", name: "Dependency audit", description: "Audit bun.lock against OSV and grade each advisory.", role: "security", steps: [{ tool: "scan_deps", args: {} }, { tool: "report_issue", args: {} }], uses: 3, wins: 3, createdAt: DEMO_T0 - 8 * D },
  ];
  const assets: AssetDTO[] = [
    { id: "a-1", runId: DEMO_RUN_ID, kind: "image", status: "done", providerId: "prov-openai", model: "gpt-image-1-mini", prompt: "Export button in 8 states, flat, ink on white", url: null, mime: "image/png", width: 1024, height: 1024, durationMs: null, costUsd: 0.04, error: null, createdAt: DEMO_T0 + 60_000 },
    { id: "a-2", runId: null, kind: "image", status: "done", providerId: "prov-openai", model: "gpt-image-1-mini", prompt: "Empty state for a day with no sales", url: null, mime: "image/png", width: 1536, height: 1024, durationMs: null, costUsd: 0.05, error: null, createdAt: DEMO_T0 - D },
    { id: "a-3", runId: null, kind: "video", status: "failed", providerId: "prov-openai", model: "sora-2", prompt: "Six second loop of the report page scrolling", url: null, mime: null, width: null, height: null, durationMs: null, costUsd: 0, error: "No video model is routed. Set one under Providers.", createdAt: DEMO_T0 - 2 * D },
  ];
  const scans: ScanDTO[] = [
    { id: "scan-demo", projectId: DEMO_PROJECT.id, kinds: ["deps", "secrets"], status: "done", counts: { critical: 0, high: 0, medium: 0, low: 1, info: 0 }, error: null, createdAt: DEMO_T0 + 50_000, finishedAt: DEMO_T0 + 56_000 },
    { id: "scan-2", projectId: DEMO_PROJECT.id, kinds: ["config", "secrets"], status: "done", counts: { critical: 0, high: 1, medium: 1, low: 0, info: 1 }, error: null, createdAt: DEMO_T0 - 3 * D, finishedAt: DEMO_T0 - 3 * D + 9000 },
  ];
  const findings: Record<string, FindingDTO[]> = {
    "scan-demo": [
      { id: "finding-1", scanId: "scan-demo", kind: "deps", severity: "low", rule: "OSV GHSA-demo-0001", title: "Prototype pollution in a test-only helper", file: "bun.lock", line: null, detail: "dev dependency only, not shipped in the bundle", fix: "Upgrade when a patched version lands", status: "open" },
    ],
    "scan-2": [
      { id: "f-2", scanId: "scan-2", kind: "secrets", severity: "high", rule: "secret.generic-api-key", title: "API key committed in a test file", file: "src/pay/client.test.ts", line: 14, detail: "sk-****************8f2a", fix: "Move it to an env var and rotate the key", status: "fixed" },
      { id: "f-3", scanId: "scan-2", kind: "config", severity: "medium", rule: "config.cors-wildcard", title: "CORS allows any origin on /api", file: "server/app.ts", line: 22, detail: "origin: \"*\" with credentials", fix: "List the web origin explicitly", status: "open" },
      { id: "f-4", scanId: "scan-2", kind: "config", severity: "info", rule: "config.debug-flag", title: "DEBUG=1 in .env.example", file: ".env.example", line: 3, detail: "DEBUG=1", fix: null, status: "accepted" },
    ],
  };
  const evals: EvalRunDTO[] = [
    { id: "e-1", suite: "core", policy: "legacy", metrics: { scenarios: 12, passed: 11, calls: 188, inputTokens: 1_284_400, outputTokens: 61_230, cachedTokens: 0, billableInputTokens: 1_284_400, maxPromptTokens: 21_870 }, createdAt: DEMO_T0 - D },
    { id: "e-2", suite: "core", policy: "v2", metrics: { scenarios: 12, passed: 12, calls: 121, inputTokens: 702_150, outputTokens: 48_900, cachedTokens: 431_900, billableInputTokens: 270_250, maxPromptTokens: 9_640 }, createdAt: DEMO_T0 - D },
  ];
  return { snapshot, olderRun, projects, providers, routing, settings, lessons, skills, assets, scans, findings, evals,
    setRouting: (r: ModelRouting) => (routing = r),
    getRouting: () => routing,
    setSettings: (s: OwnerSettings) => (settings = s),
    getSettings: () => settings,
  };
}

/**
 * The live preview, played in the page: Start installs for a moment, then
 * starts, then serves the sample site (dist/demo-site). ?preview=ready opens
 * it already running, ?preview=failed shows a start that failed with its
 * log, ?preview=empty a project with nothing to preview yet.
 */
function createPreviewState() {
  const q = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("preview");
  const seed = q === "ready" || q === "failed" || q === "empty" ? q : "idle";
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  type Rec = { phase: "idle" | "run" | "stopped"; since: number; fail: boolean };
  const recs = new Map<string, Rec>();
  const rec = (projectId: string): Rec => {
    let r = recs.get(projectId);
    if (!r) {
      r = seed === "ready" || seed === "failed" ? { phase: "run", since: 0, fail: seed === "failed" } : { phase: "idle", since: 0, fail: false };
      // the older sample project's dev script is broken, so its start fails
      if (projectId === "demo-project-2") r.fail = true;
      recs.set(projectId, r);
    }
    return r;
  };
  const INSTALL = ["$ bun install", "bun install v1.3.14", "Resolving dependencies"];
  const START = [...INSTALL, "+ csv-stringify@6.5.2", "3 packages installed [412.00ms]", "$ bun run dev"];
  const FAIL = [...INSTALL, "3 packages installed [388.00ms]", "$ bun run dev", "$ vite --port 5173", 'error: Script not found "vite"', 'error: script "dev" exited with code 1'];
  const dto = (projectId: string, over: Partial<PreviewDTO>): PreviewDTO => ({ projectId, status: "idle", url: null, command: null, kind: null, logTail: [], error: null, startedAt: null, ...over });
  const get = (projectId: string): PreviewDTO => {
    if (seed === "empty") return dto(projectId, { error: "No dev, start or preview script in package.json and no index.html at the top of the folder yet." });
    const r = rec(projectId);
    // the engine reports what it would run before it starts: the dev script
    if (r.phase === "idle") return dto(projectId, { command: "bun run dev", kind: "script" });
    const base = { command: "bun run dev", kind: "script" as const, startedAt: r.since || Date.now() };
    if (r.phase === "stopped") return dto(projectId, { ...base, status: "stopped", logTail: [...START, "Stopped by you"] });
    const age = r.since ? Date.now() - r.since : Number.POSITIVE_INFINITY;
    if (age < 1200) return dto(projectId, { ...base, status: "installing", logTail: INSTALL });
    if (r.fail) {
      if (age < 2000) return dto(projectId, { ...base, status: "starting", logTail: FAIL.slice(0, 5) });
      return dto(projectId, { ...base, status: "failed", logTail: FAIL, error: "The dev script stopped before it served a page: vite is not installed in this project." });
    }
    if (age < 2600) return dto(projectId, { ...base, status: "starting", logTail: START });
    const url = origin + DEMO_SITE_PAGE;
    return dto(projectId, { ...base, status: "ready", url, logTail: [...START, `Serving the report on ${url}`] });
  };
  return {
    get,
    start(projectId: string): PreviewDTO {
      if (seed === "empty") return get(projectId);
      Object.assign(rec(projectId), { phase: "run", since: Date.now() });
      return get(projectId);
    },
    stop(projectId: string): PreviewDTO {
      const r = rec(projectId);
      if (r.phase === "run") r.phase = "stopped";
      return get(projectId);
    },
  };
}

/** The engine platform the demo plays: ?platform=win32 or linux, else a Mac. */
export function demoPlatform(search: string = typeof window === "undefined" ? "" : window.location.search): string {
  const q = new URLSearchParams(search).get("platform");
  return q === "win32" || q === "linux" ? q : "darwin";
}

/** The demo engine's health: every feature on for a Mac, the sandbox-dependent ones off elsewhere. */
export function demoHealth(search?: string): HealthDTO {
  const platform = demoPlatform(search);
  const on = platform === "darwin";
  const features: PlatformFeatures = { shell: on, liveTrading: on, mcpStdio: on, scriptPreview: on };
  return { ok: true, mode: "local", version: "0.1.0 demo", configured: true, automation: { available: false, accessibility: false, screen: false }, jev: { configured: true }, platform, features };
}

class DemoHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function createDemoFetch(): (input: string, init: RequestInit) => Promise<Response> {
  const st = createDemoState();
  const cap = createCapabilityState();
  const preview = createPreviewState();
  const skillsSeed = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("skills");
  const crew = createCrewSkillState(skillsSeed === "empty" ? "empty" : "sample");
  const health = demoHealth();
  /** The real engine refuses a sandbox-dependent feature on a platform without the crew sandbox (422 coming_soon). */
  const needs = (feature: keyof PlatformFeatures, what: string) => {
    if (!health.features[feature]) throw new DemoHttpError(422, "coming_soon", `${what} is coming soon on ${health.platform === "win32" ? "Windows" : "Linux"}: the crew sandbox there is not ready yet.`);
  };
  const knownProject = (id: string | undefined) => {
    if (!id || !st.projects.some((p) => p.id === id)) throw new DemoHttpError(404, "not_found", "No project with that id.");
    return id;
  };
  let seq = 0;
  const nextId = (p: string) => `${p}-${(seq += 1)}`;
  const skillOut = (r: CrewSkillResult | { ok: true }) => {
    if (!r.ok) throw new DemoHttpError(r.status, r.code, r.message);
    return "skill" in r ? r.skill : { ok: true as const };
  };
  const hint = (key: string) => key.slice(-4);

  const visibleCalls = () => DEMO_CALLS.filter((c) => c.createdAt <= clockFn());
  const runs = (): RunDTO[] => [st.snapshot.run, st.olderRun];

  const routes: Array<[string, Handler]> = [
    ["GET /api/health", () => health],
    ["GET /api/projects", () => st.projects],
    ["POST /api/projects", ({ body }) => {
      const b = body as { name: string; workspacePath?: string };
      const p: ProjectDTO = { id: nextId("project"), name: b.name, workspacePath: b.workspacePath ?? `/Users/you/code/${b.name}`, createdAt: Date.now(), updatedAt: Date.now(), lastRunId: null };
      st.projects.push(p);
      return p;
    }],
    ["GET /api/projects/:id/files", () => demoFiles(clockFn())],
    ["GET /api/projects/:id/file", ({ query }) => demoFile(query.get("path") ?? "", clockFn())],
    ["GET /api/projects/:id", ({ params }) => st.projects.find((p) => p.id === knownProject(params.id))],
    ["GET /api/projects/:id/preview", ({ params }) => preview.get(knownProject(params.id))],
    ["POST /api/projects/:id/preview", ({ params }) => {
      const id = knownProject(params.id);
      // every sample project runs a dev script (bun run dev)
      if (preview.get(id).kind === "script") needs("scriptPreview", "A dev script preview");
      return preview.start(id);
    }],
    ["DELETE /api/projects/:id/preview", ({ params }) => preview.stop(knownProject(params.id))],
    ["POST /api/projects/:id/reveal", ({ params }) => (knownProject(params.id), { ok: true })],
    ["GET /api/runs", () => runs()],
    ["POST /api/runs/estimate", ({ body }) => {
      const goal = String((body as { goal?: string }).goal ?? "");
      const tasks = Math.max(2, Math.min(9, Math.round(goal.split(/\s+/).length / 2)));
      return { tasks, tokens: tasks * 23_500, costUsd: tasks * 0.012, basis: "history" };
    }],
    ["POST /api/runs", () => ({ ...st.snapshot.run })],
    ["GET /api/runs/:id", ({ params }) => {
      if (params.id === DEMO_RUN_ID) return st.snapshot;
      if (params.id === st.olderRun.id) return { run: st.olderRun, agents: [], tasks: [], handoffs: [], decisions: [], approvals: [], lastSeq: 0 } satisfies RunSnapshotDTO;
      throw new DemoHttpError(404, "not_found", "No run with that id.");
    }],
    ["POST /api/runs/:id/pause", () => ({ ...st.snapshot.run, status: "paused" })],
    ["POST /api/runs/:id/resume", () => ({ ...st.snapshot.run, status: "running" })],
    ["POST /api/runs/:id/stop", () => ({ ...st.snapshot.run, status: "stopped" })],
    ["POST /api/runs/:id/message", () => ({ ok: true })],
    ["PATCH /api/runs/:id/tasks/:taskId", ({ params, body }) => {
      const t = st.snapshot.tasks.find((x) => x.id === params.taskId);
      if (!t) throw new DemoHttpError(404, "not_found", "No task with that id.");
      const b = body as { status?: "queued" | "cancelled" };
      return { ...t, status: b.status ?? t.status, updatedAt: Date.now() };
    }],
    ["POST /api/runs/:id/agents/:agentId/stop", ({ params }) => {
      const a = st.snapshot.agents.find((x) => x.id === params.agentId);
      if (!a) throw new DemoHttpError(404, "not_found", "No cat with that id.");
      return { ...a, status: "stopped" };
    }],
    ["GET /api/runs/:id/calls", ({ params }) => (params.id === DEMO_RUN_ID ? visibleCalls() : [])],
    ["GET /api/runs/:id/xray/:agentId", ({ params }): ContextXrayDTO => {
      const a = st.snapshot.agents.find((x) => x.id === params.agentId);
      if (!a) throw new DemoHttpError(404, "not_found", "No cat with that id.");
      const calls = visibleCalls().filter((c) => c.agentId === a.id);
      const last = calls[calls.length - 1];
      const recent = Math.max(0, (last?.inputTokens ?? 2400) - 1880);
      return {
        agentId: a.id,
        taskId: a.currentTaskId,
        model: last?.model ?? "gpt-4o-mini",
        budget: 12_000,
        layers: [
          { layer: "charter", tokens: 340, cached: true },
          { layer: "tools", tokens: 620, cached: true },
          { layer: "brief", tokens: 280, cached: true },
          { layer: "memory", tokens: 190, cached: true },
          { layer: "task", tokens: 450, cached: false },
          { layer: "summary", tokens: 0, cached: false },
          { layer: "recent", tokens: recent, cached: false },
        ],
        totalTokens: 1880 + recent,
        compactions: 0,
        lastCachedTokens: last?.cachedTokens ?? 0,
        createdAt: last?.createdAt ?? DEMO_T0,
      };
    }],
    ["GET /api/runs/:id/agents/:agentId/mind", ({ params }) => {
      const s = replay(DEMO_EVENTS.filter((e) => e.ts <= clockFn()));
      const a = s.agents[params.agentId!];
      if (params.id !== DEMO_RUN_ID || !a) throw new DemoHttpError(404, "not_found", "No cat with that id.");
      return demoMind(a, s.roles, crew.readBy(a.archetype ?? a.role, s.run?.company === "fund" ? "fund" : "studio", s.run?.goal ?? null));
    }],
    ["GET /api/connectors", () => cap.connectors],
    ["POST /api/connectors", ({ body }) => {
      const b = body as CreateConnectorBody;
      if (b.kind === "mcp_stdio") needs("mcpStdio", "A local MCP server");
      return cap.addConnector(b);
    }],
    ["PATCH /api/connectors/:id", ({ params, body }) => {
      const c = cap.updateConnector(params.id!, body as UpdateConnectorBody);
      if (!c) throw new DemoHttpError(404, "not_found", "No connector with that id.");
      return c;
    }],
    ["DELETE /api/connectors/:id", ({ params }) => {
      const i = cap.connectors.findIndex((x) => x.id === params.id);
      if (i >= 0) cap.connectors.splice(i, 1);
      return { ok: true };
    }],
    ["POST /api/connectors/:id/test", ({ params }) => {
      if (cap.connectors.find((x) => x.id === params.id)?.kind === "mcp_stdio") needs("mcpStdio", "A local MCP server");
      const c = cap.testConnector(params.id!);
      if (!c) throw new DemoHttpError(404, "not_found", "No connector with that id.");
      return c;
    }],
    ["GET /api/trading/venues", () => cap.listVenues()],
    ["POST /api/trading/venues", ({ body }) => {
      const b = body as CreateTradingVenueBody;
      if (TRADING_VENUE_PRESETS.find((p) => p.id === b.preset)?.connector === "mcp_stdio") needs("mcpStdio", "A local MCP server");
      if (b.mode === "live") needs("liveTrading", "Live trading");
      try {
        return cap.addVenue(b);
      } catch {
        throw new DemoHttpError(400, "bad_preset", "That venue preset is not in this build.");
      }
    }],
    ["PATCH /api/trading/venues/:id", ({ params, body }) => {
      const v = cap.updateVenue(params.id!, body as Partial<CreateTradingVenueBody> & { enabled?: boolean });
      if (!v) throw new DemoHttpError(404, "not_found", "No venue with that id.");
      return v;
    }],
    ["DELETE /api/trading/venues/:id", ({ params }) => {
      cap.removeVenue(params.id!);
      return { ok: true };
    }],
    ["POST /api/trading/venues/:id/learn", ({ params }) => {
      const preset = cap.listVenues().find((x) => x.id === params.id)?.preset;
      if (TRADING_VENUE_PRESETS.find((p) => p.id === preset)?.connector === "mcp_stdio") needs("mcpStdio", "A local MCP server");
      const v = cap.learnVenue(params.id!);
      if (!v) throw new DemoHttpError(404, "not_found", "No venue with that id.");
      return v;
    }],
    ["GET /api/trading/settings", () => cap.getTrading()],
    ["PUT /api/trading/settings", ({ body }) => {
      const b = body as TradingSettings;
      if (b.mode === "live") needs("liveTrading", "Live trading");
      return cap.setTrading(b);
    }],
    ["GET /api/trading/orders", () => cap.orders],
    ["GET /api/trading/positions", () => cap.positions],
    ["POST /api/trading/orders/:id/decision", ({ params, body }) => {
      const decision = (body as { decision: "approve" | "reject" }).decision;
      if (decision === "approve" && cap.orders.find((x) => x.id === params.id)?.mode === "live") needs("liveTrading", "Live trading");
      const o = cap.decideOrder(params.id!, decision);
      if (!o) throw new DemoHttpError(404, "not_found", "No order with that id.");
      return o;
    }],
    ["GET /api/usage", ({ query }): UsageReport => {
      const list = query.get("runId") === DEMO_RUN_ID || !query.get("runId") ? visibleCalls() : [];
      const totals = usageOf(list);
      const byModel = [...new Set(list.map((c) => c.model))].map((model) => ({ model, ...usageOf(list.filter((c) => c.model === model)) }));
      return { totals, cacheHitRate: totals.inputTokens ? totals.cachedTokens / totals.inputTokens : 0, byModel, byRole: [] };
    }],
    ["GET /api/decisions", () => st.snapshot.decisions],
    ["GET /api/providers", () => st.providers],
    ["GET /api/providers/presets", () => PROVIDER_PRESETS],
    ["POST /api/providers", ({ body }) => {
      const b = body as CreateProviderBody;
      const preset = findPreset(b.preset);
      if (!preset) throw new DemoHttpError(400, "unknown_preset", "Pick a provider from the list.");
      if (preset.keyRequired && !b.apiKey) throw new DemoHttpError(400, "key_required", `${preset.label} needs an API key.`);
      const p: ProviderDTO = {
        id: nextId("prov"),
        preset: preset.id,
        label: b.label?.trim() || preset.label,
        protocol: preset.protocol,
        baseUrl: b.baseUrl?.trim() || preset.baseUrl,
        hasKey: !!b.apiKey,
        keyHint: b.apiKey ? hint(b.apiKey) : null,
        models: b.models ?? preset.suggestedModels.map((id) => ({ id })),
        caps: preset.caps,
        lastTestAt: null,
        lastTestOk: null,
        lastTestError: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      st.providers.push(p);
      return p;
    }],
    ["DELETE /api/providers/:id", ({ params }) => {
      const i = st.providers.findIndex((p) => p.id === params.id);
      if (i >= 0) st.providers.splice(i, 1);
      return { ok: true };
    }],
    ["POST /api/providers/:id/test", ({ params }) => {
      const p = st.providers.find((x) => x.id === params.id);
      if (!p) throw new DemoHttpError(404, "not_found", "No provider with that id.");
      const ok = p.preset !== "ollama";
      p.lastTestAt = Date.now();
      p.lastTestOk = ok;
      p.lastTestError = ok ? null : "Connection refused on localhost:11434";
      return { ok, latencyMs: ok ? 412 : 0, error: p.lastTestError, models: ok ? p.models : [] };
    }],
    ["GET /api/routing", () => st.getRouting()],
    ["PUT /api/routing", ({ body }) => {
      const r = body as ModelRouting;
      const bad = r.tiers.find((t) => t.reasoning !== undefined && !(REASONING_EFFORTS as readonly string[]).includes(t.reasoning));
      if (bad) throw new DemoHttpError(422, "invalid_body", `tiers.${r.tiers.indexOf(bad)}.reasoning: must be one of ${REASONING_EFFORTS.join(", ")}`);
      const tiers = r.tiers.map(({ reasoning, ...t }) => (reasoning && reasoning !== "default" ? { ...t, reasoning } : t));
      return st.setRouting({ ...r, tiers });
    }],
    ["GET /api/memory/lessons", ({ query }) => {
      const status = query.get("status");
      return status ? st.lessons.filter((l) => l.status === status) : st.lessons;
    }],
    ["PATCH /api/memory/lessons/:id", ({ params, body }) => {
      const l = st.lessons.find((x) => x.id === params.id);
      if (!l) throw new DemoHttpError(404, "not_found", "No lesson with that id.");
      Object.assign(l, body as Partial<LessonDTO>);
      return l;
    }],
    ["DELETE /api/memory/lessons/:id", ({ params }) => {
      const i = st.lessons.findIndex((l) => l.id === params.id);
      if (i >= 0) st.lessons.splice(i, 1);
      return { ok: true };
    }],
    ["GET /api/crew-skills", () => {
      if (skillsSeed === "error") throw new DemoHttpError(503, "unavailable", "The engine could not read the skills file. Try again in a moment.");
      return crew.list();
    }],
    ["POST /api/crew-skills", ({ body }) => skillOut(crew.create(body as CreateCrewSkillBody))],
    ["PATCH /api/crew-skills/:id", ({ params, body }) => skillOut(crew.update(params.id!, body as UpdateCrewSkillBody))],
    ["DELETE /api/crew-skills/:id", ({ params }) => skillOut(crew.remove(params.id!))],
    ["GET /api/memory/skills", () => st.skills],
    ["DELETE /api/memory/skills/:id", ({ params }) => {
      const i = st.skills.findIndex((s) => s.id === params.id);
      if (i >= 0) st.skills.splice(i, 1);
      return { ok: true };
    }],
    ["GET /api/assets", () => st.assets],
    ["POST /api/assets", ({ body }) => {
      const b = body as { kind: "image" | "video"; prompt: string };
      const a: AssetDTO = { id: nextId("asset"), runId: null, kind: b.kind, status: "queued", providerId: "prov-openai", model: b.kind === "image" ? "gpt-image-1-mini" : "sora-2", prompt: b.prompt, url: null, mime: null, width: null, height: null, durationMs: null, costUsd: 0, error: null, createdAt: Date.now() };
      st.assets.unshift(a);
      return a;
    }],
    ["DELETE /api/assets/:id", ({ params }) => {
      const i = st.assets.findIndex((a) => a.id === params.id);
      if (i >= 0) st.assets.splice(i, 1);
      return { ok: true };
    }],
    ["GET /api/security/scans", () => st.scans],
    ["POST /api/security/scans", ({ body }) => {
      const b = body as { projectId: string; kinds: ScanDTO["kinds"] };
      const s: ScanDTO = { id: nextId("scan"), projectId: b.projectId, kinds: b.kinds, status: "queued", counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, error: null, createdAt: Date.now(), finishedAt: null };
      st.scans.unshift(s);
      st.findings[s.id] = [];
      return s;
    }],
    ["GET /api/security/scans/:id/findings", ({ params }) => st.findings[params.id!] ?? []],
    ["PATCH /api/security/findings/:id", ({ params, body }) => {
      for (const list of Object.values(st.findings)) {
        const f = list.find((x) => x.id === params.id);
        if (f) {
          f.status = (body as { status: FindingDTO["status"] }).status;
          return f;
        }
      }
      throw new DemoHttpError(404, "not_found", "No finding with that id.");
    }],
    ["GET /api/evals", () => st.evals],
    ["POST /api/evals/run", () => {
      const legacy = { ...st.evals[0]!, id: nextId("eval"), createdAt: Date.now() };
      const v2 = { ...st.evals[1]!, id: nextId("eval"), createdAt: Date.now() };
      st.evals.unshift(v2, legacy);
      const savingsPct = Math.round((1 - v2.metrics.billableInputTokens / legacy.metrics.billableInputTokens) * 100);
      return { legacy, v2, savingsPct };
    }],
    ["POST /api/killswitch", () => ({ stoppedRuns: 1, killedProcesses: 0 })],
    ["GET /api/settings", () => ({ ...st.getSettings(), prices: { ...st.getSettings().prices } })],
    ["PATCH /api/settings", ({ body }) => st.setSettings({ ...st.getSettings(), ...(body as Partial<OwnerSettings>) })],
  ];

  return async (input, init) => {
    const url = new URL(input, "http://demo.local");
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" && !new Headers(init.headers).has(CSRF_HEADER)) {
      return json(403, { error: { code: "csrf_required", message: `Missing ${CSRF_HEADER} header` } });
    }
    for (const [key, handler] of routes) {
      const [m, pattern] = key.split(" ") as [string, string];
      if (m !== method) continue;
      const params = matchPath(pattern, url.pathname);
      if (!params) continue;
      try {
        const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : undefined;
        const out = handler({ params, query: url.searchParams, body });
        return json(200, out ?? { ok: true });
      } catch (err) {
        if (err instanceof DemoHttpError) return json(err.status, { error: { code: err.code, message: err.message } });
        return json(500, { error: { code: "demo_error", message: "The demo server failed on this request." } });
      }
    }
    return json(404, { error: { code: "not_found", message: "This demo has no data for that page." } });
  };
}

