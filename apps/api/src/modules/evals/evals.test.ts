// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, test } from "bun:test";
import { CSRF_HEADER, ROLE_TOOLS, type DecisionListQuery, type EvalListQuery, type RouteQuery } from "@mengai/shared";
import { Hono } from "hono";
import { createApp } from "../../core/app";
import { createKillSwitch } from "../../core/killswitch";
import type { ModuleContext } from "../../core/module";
import { LlmError, type ChatRequest } from "../../core/ports/llm";
import { HttpError, errorBody } from "../../lib/http";
import { redact } from "../../lib/redact";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { createContextModule } from "../context";
import {
  OUTPUT_WEIGHT,
  STRATEGY,
  costUnits,
  createEvalsModule,
  evaluateStrategy,
  mergeStrategies,
  MockLlmRouter,
  parseStrategy,
  sampleStrategy,
  ScriptedProvider,
  strategyEvidence,
  strategyText,
  terms,
  worstCaseBrain,
} from "./index";
import { RUN_LIMIT_PER_WINDOW } from "./routes";
import { LEGACY, legacyConversation, legacyToolOutput, type LegacyMessage } from "./legacy";
import { billableInput, CACHED_WEIGHT, charEstimate, measurePrompt, PrefixCache } from "./meter";
import { referenceContext } from "./reference-context";
import { replaySuite } from "./replay";
import { fixtureSpecsFor, loadSuites } from "./suites";
import { synthOutput } from "./synth";

async function makeCtx(): Promise<ModuleContext> {
  const clock = fakeClock();
  return {
    config: { mode: "local", version: "test", dataDir: "/tmp/x", workspacesDir: "/tmp/x", webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null },
    db: await createTestDb(),
    kv: memoryKv(),
    blob: { put: async () => ({ key: "", size: 0 }), get: async () => null, delete: async () => {}, exists: async () => false },
    vault: memoryVault(),
    clock,
    logger: silentLogger,
    events: captureEvents(clock),
  };
}

const suite = () => loadSuites().get("core")!;

describe("fixtures", () => {
  test("core suite and tool schemas load and validate", () => {
    const s = suite();
    expect(s.scenarios).toHaveLength(8);
    expect(new Set(s.scenarios.map((x) => x.role)).size).toBe(7);
    for (const role of Object.keys(ROLE_TOOLS) as Array<keyof typeof ROLE_TOOLS>) {
      expect(fixtureSpecsFor(role).map((t) => t.name)).toEqual(ROLE_TOOLS[role]);
    }
    // fixture schemas are as heavy per tool as legacy's (1,800 tokens / 20 tools)
    const byName = new Map((Object.keys(ROLE_TOOLS) as Array<keyof typeof ROLE_TOOLS>).flatMap((r) => fixtureSpecsFor(r)).map((t) => [t.name, t]));
    const avg = [...byName.values()].reduce((n, t) => n + charEstimate(JSON.stringify(t)), 0) / byName.size;
    expect(avg).toBeGreaterThanOrEqual(LEGACY.toolTokens / LEGACY.toolCount - 5);
  });

  test("synthetic outputs are exact size, deterministic and redaction-neutral", () => {
    for (const tool of ["fs_read", "shell_run", "fs_search", "fs_list", "web_fetch", "scan_deps", "finish"]) {
      const a = synthOutput("s:1:0", tool, 5000, tool !== "shell_run");
      expect(a.length).toBe(5000);
      expect(synthOutput("s:1:0", tool, 5000, tool !== "shell_run")).toBe(a);
      expect(redact(a)).toBe(a);
    }
    expect(synthOutput("s:1:0", "fs_read", 0)).toBe("");
  });
});

describe("legacy port", () => {
  test("tool output cap keeps head 2/3 and tail 1/3 of 4,000 chars", () => {
    const text = "a".repeat(3000) + "b".repeat(3000) + "c".repeat(3000);
    const out = legacyToolOutput(text);
    expect(out.startsWith("a".repeat(2666))).toBe(true);
    expect(out.endsWith("c".repeat(1334))).toBe(true);
    expect(out).toContain("[5000 chars elided");
    expect(legacyToolOutput("short")).toBe("short");
  });

  test("conversation trim keeps the system prompt, a digest and the last 39 messages", () => {
    const convo: LegacyMessage[] = [{ role: "system", content: "sys" }];
    for (let i = 0; i < 60; i++) convo.push({ role: i % 2 ? "tool" : "assistant", content: i === 3 ? "edited src/cart.ts and the tests pass" : `routine line ${i}` });
    const out = legacyConversation(convo, 39);
    expect(out).toHaveLength(41);
    expect(out[0]!.content).toBe("sys");
    expect(out[1]!.content).toContain("- edited src/cart.ts and the tests pass");
    expect(out[40]).toBe(convo[60]!);
    expect(legacyConversation(convo.slice(0, 41), 39)).toHaveLength(41);
  });
});

describe("meter and simulated prefix cache", () => {
  const big = "x".repeat(4400); // 1,100 tokens
  const req = (extra: string[]) => ({
    system: big,
    tools: [],
    cacheSystem: true,
    messages: [{ role: "user" as const, content: "brief", cacheBreakpoint: true }, ...extra.map((c) => ({ role: "user" as const, content: c }))],
  });

  test("breakpoints: only declared prefixes of at least 1,024 tokens identical to the previous call", () => {
    const cache = new PrefixCache("breakpoints");
    const a = measurePrompt(req(["step one"]), charEstimate);
    expect(cache.read("k", a.prefixes)).toBe(0);
    const b = measurePrompt(req(["step one", "step two"]), charEstimate);
    expect(cache.read("k", b.prefixes)).toBe(b.prefixes[1]!.tokens);
    expect(cache.read("other", b.prefixes)).toBe(0);
    const small = new PrefixCache("breakpoints");
    const tiny = measurePrompt({ system: "tiny", messages: [], cacheSystem: true }, charEstimate);
    small.read("k", tiny.prefixes);
    expect(small.read("k", tiny.prefixes)).toBe(0);
  });

  test("prefix: longest identical message boundary, rounded down to 128-token blocks", () => {
    const cache = new PrefixCache("prefix");
    const a = measurePrompt(req(["y".repeat(2000)]), charEstimate);
    cache.read("k", a.prefixes);
    const b = measurePrompt(req(["y".repeat(2000), "next"]), charEstimate);
    const got = cache.read("k", b.prefixes);
    expect(got % 128).toBe(0);
    expect(got).toBe(Math.floor(a.prefixes[a.prefixes.length - 1]!.tokens / 128) * 128);
  });

  test("billable input weights cached tokens at the default model's ratio", () => {
    expect(CACHED_WEIGHT).toBe(0.5);
    expect(billableInput(1000, 600)).toBe(700);
  });
});

describe("benchmark replay", () => {
  test("numbers are stable across replays (reference context)", async () => {
    const a = await replaySuite(suite(), { context: referenceContext(), specsFor: fixtureSpecsFor });
    const b = await replaySuite(suite(), { context: referenceContext(), specsFor: fixtureSpecsFor });
    expect(b).toEqual(a);
    expect(a.legacy.metrics).toEqual({
      scenarios: 8,
      passed: 8,
      calls: 92,
      inputTokens: 838_718,
      outputTokens: 4_198,
      cachedTokens: 0,
      billableInputTokens: 838_718,
      maxPromptTokens: 18_912,
    });
    expect(a.v2.metrics.calls).toBe(93);
    expect(a.v2.metrics.inputTokens).toBe(500_124);
    expect(a.v2.metrics.cachedTokens).toBe(424_192);
    expect(a.v2.metrics.billableInputTokens).toBe(288_028);
    expect(a.savingsPct).toBe(65.7);
  });

  test("v2 billable input is at least 60 percent below legacy, and v2 never exceeds its budget by much", async () => {
    const r = await replaySuite(suite(), { context: referenceContext(), specsFor: fixtureSpecsFor });
    expect(r.v2.metrics.billableInputTokens).toBeLessThanOrEqual(r.legacy.metrics.billableInputTokens * 0.4);
    expect(r.v2.metrics.maxPromptTokens).toBeLessThanOrEqual(12_000 * 1.05);
    expect(r.v2.metrics.passed).toBe(r.v2.metrics.scenarios);
    // same scripted steps: v2 only adds the charged summarize outputs
    expect(r.v2.metrics.outputTokens).toBeGreaterThanOrEqual(r.legacy.metrics.outputTokens);
  });

  test("the real ContextService meets the same bar, deterministically", async () => {
    const ctx = await makeCtx();
    const real = () => createContextModule(ctx).service;
    const a = await replaySuite(suite(), { context: real(), specsFor: fixtureSpecsFor });
    const b = await replaySuite(suite(), { context: real(), specsFor: fixtureSpecsFor });
    expect(b.v2.metrics).toEqual(a.v2.metrics);
    expect(a.legacy.metrics.billableInputTokens).toBe(838_718);
    expect(a.savingsPct).toBeGreaterThanOrEqual(60);
    expect(a.v2.metrics.inputTokens).toBeLessThan(a.legacy.metrics.inputTokens);
  });

  test("the conservative cache models are reported, not hidden", async () => {
    const bp = await replaySuite(suite(), { context: referenceContext(), specsFor: fixtureSpecsFor }, { v2Cache: "breakpoints" });
    const both = await replaySuite(suite(), { context: referenceContext(), specsFor: fixtureSpecsFor }, { legacyCache: "prefix" });
    expect(bp.savingsPct).toBe(47.9);
    expect(both.savingsPct).toBe(38.4);
    expect(both.legacy.metrics.cachedTokens).toBeGreaterThan(0);
  });
});

describe("service and routes", () => {
  function app(mod: ReturnType<typeof createEvalsModule>) {
    const a = new Hono();
    // stands in for core/hardening requestContext: the socket peer, never X-Forwarded-For
    a.use(async (c, next) => {
      c.set("clientIp", c.req.header("x-test-peer") ?? "1.1.1.1");
      await next();
    });
    a.onError((err, c) => (err instanceof HttpError ? c.json(errorBody(err.code, err.message), err.status) : c.json(errorBody("internal", "error"), 500)));
    a.route(`/api/${mod.mountPath}`, mod.routes!);
    return a;
  }
  const post = (body: string, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body });

  test("run persists both policies and list returns them newest first", async () => {
    const ctx = await makeCtx();
    const mod = createEvalsModule(ctx, { context: referenceContext() });
    const r = await mod.service.run();
    expect(r.savingsPct).toBe(65.7);
    expect(r.legacy.policy).toBe("legacy");
    expect(r.v2.policy).toBe("v2");
    expect(r.v2.metrics.billableInputTokens).toBe(288_028);
    (ctx.clock as ReturnType<typeof fakeClock>).advance(1000);
    await mod.service.run({ suite: "core" });
    const listed = await mod.service.list();
    expect(listed).toHaveLength(4);
    expect(listed[3]!.id).toBe(r.legacy.id);
    expect(listed.slice(2).map((x) => x.metrics)).toContainEqual(r.v2.metrics);
    expect(await mod.service.list({ limit: 1 })).toHaveLength(1);
    expect(await mod.service.list({ suite: "nope" })).toEqual([]);
  });

  test("injected tool specs replace the fixture schemas", async () => {
    const ctx = await makeCtx();
    const seen: string[] = [];
    const mod = createEvalsModule(ctx, {
      context: referenceContext(),
      tools: { specsFor: (role) => (seen.push(role), fixtureSpecsFor(role).slice(0, 3)) },
    });
    const r = await mod.service.replay();
    expect(seen).toContain("engineer");
    expect(r.v2.metrics.inputTokens).toBeLessThan(500_124);
  });

  test("routes: list, run, validation, unknown suite, rate limit", async () => {
    const ctx = await makeCtx();
    const mod = createEvalsModule(ctx, { context: referenceContext() });
    const a = app(mod);
    const run = await a.request("/api/evals/run", post("{}"));
    expect(run.status).toBe(200);
    const body = (await run.json()) as { savingsPct: number; legacy: { policy: string }; v2: { policy: string } };
    expect(body.savingsPct).toBe(65.7);
    expect(body.legacy.policy).toBe("legacy");
    const list = await a.request("/api/evals?suite=core&limit=10");
    expect(((await list.json()) as unknown[]).length).toBe(2);
    expect((await a.request("/api/evals?limit=999")).status).toBe(422);
    expect((await a.request("/api/evals/run", post('{"suite":"missing"}'))).status).toBe(404);
    expect((await a.request("/api/evals/run", post('{"suite":"core","extra":1}'))).status).toBe(422);
    expect((await a.request("/api/evals/run", post("not json"))).status).toBe(400);
    let last: Response | null = null;
    for (let i = 0; i < 6; i++) last = await a.request("/api/evals/run", post("{}"));
    expect(last!.status).toBe(429);
    expect(last!.headers.get("retry-after")).toBe("60");
    expect(((await last!.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
  });

  test("every field of the shared EvalListQuery is accepted by GET /api/evals", async () => {
    const ctx = await makeCtx();
    const mod = createEvalsModule(ctx, { context: referenceContext() });
    await mod.service.run({ suite: "core" });
    const q: Required<RouteQuery<"GET /api/evals">> = { suite: "core", limit: 1 };
    const typed: EvalListQuery = q;
    const res = await app(mod).request(`/api/evals?${new URLSearchParams({ suite: typed.suite!, limit: String(typed.limit) })}`);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown[]).toHaveLength(1);
    // the decisions query type names the same fields the jev route validates
    const d: Required<DecisionListQuery> = { runId: "r1", limit: 10 };
    expect(Object.keys(d).sort()).toEqual(["limit", "runId"]);
  });

  test("run limiter keys on clientIp: spoofed X-Forwarded-For cannot mint fresh buckets", async () => {
    const ctx = await makeCtx();
    const mod = createEvalsModule(ctx, { context: referenceContext() });
    const a = app(mod);
    const statuses: number[] = [];
    // one full run, then cheap rejected bodies; every request counts against the bucket
    for (let i = 0; i <= RUN_LIMIT_PER_WINDOW; i++) {
      const spoof = { "x-forwarded-for": `10.0.0.${i}`, "x-real-ip": `10.0.1.${i}` };
      const res = await a.request("/api/evals/run", post(i === 0 ? "{}" : "not json", spoof));
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 400, 400, 400, 400, 400, 429]);
    // a different peer has its own bucket
    expect((await a.request("/api/evals/run", post("not json", { "x-test-peer": "2.2.2.2" }))).status).toBe(400);
  });

  test("run limiter stays on when the kv errors", async () => {
    const ctx = await makeCtx();
    const broken = { ...ctx.kv, incr: async () => Promise.reject(new Error("redis down")) };
    const mod = createEvalsModule({ ...ctx, kv: broken }, { context: referenceContext() });
    const a = app(mod);
    let last = 0;
    for (let i = 0; i <= RUN_LIMIT_PER_WINDOW; i++) last = (await a.request("/api/evals/run", post("not json"))).status;
    expect(last).toBe(429);
  });
});

describe("ScriptedProvider and MockLlmRouter", () => {
  const request = (content: string[], extra: Partial<ChatRequest> = {}): ChatRequest => ({
    model: "mock-fast",
    system: "s".repeat(4400),
    messages: content.map((c) => ({ role: "user" as const, content: c })),
    cacheSystem: true,
    cacheKey: "agent-1",
    ...extra,
  });

  test("answers in script order with deterministic ids, metered usage and prefix cache", async () => {
    const p = new ScriptedProvider({
      script: [{ text: "reading", toolCalls: [{ name: "fs_read", arguments: { path: "a.ts" } }] }, { toolCalls: [{ name: "finish", arguments: { summary: "ok", ok: true } }] }],
    });
    const deltas: string[] = [];
    const r1 = await p.chat(request(["hi"], { onDelta: (d) => deltas.push(d) }));
    expect(r1.toolCalls).toEqual([{ id: "call_0_0", name: "fs_read", arguments: '{"path":"a.ts"}' }]);
    expect(r1.stopReason).toBe("tool_use");
    expect(r1.usage.inputTokens).toBe(measurePrompt(request(["hi"]), charEstimate).inputTokens);
    expect(r1.usage.cachedTokens).toBe(0);
    expect(deltas).toEqual(["reading"]);
    const r2 = await p.chat(request(["hi", "more"]));
    expect(r2.usage.cachedTokens).toBeGreaterThanOrEqual(1024);
    expect(r2.toolCalls[0]!.name).toBe("finish");
    expect(p.remaining).toBe(0);
    const r3 = await p.chat(request(["hi"]));
    expect(r3.toolCalls[0]!.name).toBe("finish");
    expect(p.calls).toHaveLength(3);
  });

  test("errors, exhaustion, abort, output caps and anthropic cache writes", async () => {
    const failing = new ScriptedProvider({ script: [{ error: new LlmError("rate_limit", "slow down", 429, 1000) }], onExhausted: "error" });
    await expect(failing.chat(request(["x"]))).rejects.toMatchObject({ kind: "rate_limit" });
    await expect(failing.chat(request(["x"]))).rejects.toThrow("script exhausted");
    const ac = new AbortController();
    ac.abort();
    await expect(new ScriptedProvider({ script: [] }).chat(request(["x"], { signal: ac.signal }))).rejects.toMatchObject({ kind: "aborted" });
    const capped = await new ScriptedProvider({ script: [{ text: "w".repeat(400) }] }).chat(request(["x"], { maxOutputTokens: 10 }));
    expect(capped.usage.outputTokens).toBe(10);
    expect(capped.stopReason).toBe("length");
    const anthropic = new ScriptedProvider({ protocol: "anthropic_messages", script: (_req, i) => ({ text: `turn ${i}` }) });
    const w = await anthropic.chat(request(["x"]));
    expect(w.usage.cacheWriteTokens).toBeGreaterThanOrEqual(1024);
    const hit = await anthropic.chat(request(["x", "y"]));
    expect(hit.usage.cachedTokens).toBe(w.usage.cacheWriteTokens);
    expect(anthropic.remaining).toBe(Number.POSITIVE_INFINITY);
  });

  test("router resolves per tier and reports configuration", async () => {
    const deep = new ScriptedProvider({ id: "deep", script: [] });
    const router = new MockLlmRouter({ tiers: { deep }, contextWindow: 64_000 });
    const fast = await router.resolve({ tier: "fast", role: "engineer" });
    expect(fast.model).toBe("mock-fast");
    expect(fast.provider.id).toBe("scripted");
    expect(fast.contextWindow).toBe(64_000);
    expect((await router.resolve({ tier: "deep" })).provider).toBe(deep);
    expect(router.resolved).toEqual([{ tier: "fast", role: "engineer" }, { tier: "deep", role: undefined }]);
    expect(await router.configured()).toBe(true);
    const named = new MockLlmRouter({ model: ({ tier, role }) => `${role ?? "any"}-${tier}` });
    expect((await named.resolve({ tier: "balanced", role: "qa" })).model).toBe("qa-balanced");
    const off = new MockLlmRouter({ configured: false });
    expect(await off.configured()).toBe(false);
    await expect(off.resolve({ tier: "fast" })).rejects.toMatchObject({ kind: "auth" });
  });
});

// The root bunfig preloads happy-dom for web tests; its global Request drops
// headers hono needs, so the createApp test runs on Bun's native fetch classes.
const native = (await import(String("undici"))) as { Request: typeof Request; Response: typeof Response; Headers: typeof Headers };

describe("run limiter mounted through core/app createApp", () => {
  async function mounted(trustProxy: number) {
    const ctx = await makeCtx();
    const config = { ...ctx.config, mode: "server" as const };
    const mod = createEvalsModule({ ...ctx, config }, { context: referenceContext() });
    const app = createApp({
      config,
      modules: [mod],
      auth: { authenticate: async () => ({ sessionId: "s", userId: "owner", email: null }), session: async () => ({ authenticated: true, mode: "server", needsSetup: false }) },
      killswitch: createKillSwitch({ events: captureEvents(), logger: silentLogger }),
      kv: ctx.kv,
      logger: silentLogger,
      trustProxy,
    });
    return async (headers: Record<string, string>, peer: string) => {
      const saved = { Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers };
      Object.assign(globalThis, { Request: native.Request, Response: native.Response, Headers: native.Headers });
      try {
        const req = new native.Request("http://mengai.test/api/evals/run", {
          method: "POST",
          headers: { origin: "http://mengai.test", [CSRF_HEADER]: "1", "content-type": "application/json", ...headers },
          body: "not json",
        });
        // the Bun server hands hono the socket peer through env.requestIP
        return (await app.fetch(req, { requestIP: () => ({ address: peer }) })).status;
      } finally {
        Object.assign(globalThis, saved);
      }
    };
  }

  test("without a trusted proxy the socket peer is the key; X-Forwarded-For is ignored", async () => {
    const call = await mounted(0);
    const statuses: number[] = [];
    for (let i = 0; i <= RUN_LIMIT_PER_WINDOW; i++) statuses.push(await call({ "x-forwarded-for": `10.0.0.${i}` }, "203.0.113.7"));
    expect(statuses).toEqual([...Array(RUN_LIMIT_PER_WINDOW).fill(400), 429]);
    expect(await call({}, "198.51.100.9")).toBe(400);
  });

  test("behind one trusted proxy the right-most hop is the key; a spoofed left-most value is not", async () => {
    const call = await mounted(1);
    const statuses: number[] = [];
    // the client spoofs a fresh left-most value every time; the proxy appends the real address
    for (let i = 0; i <= RUN_LIMIT_PER_WINDOW; i++) statuses.push(await call({ "x-forwarded-for": `10.0.0.${i}, 203.0.113.7` }, "172.16.0.2"));
    expect(statuses).toEqual([...Array(RUN_LIMIT_PER_WINDOW).fill(400), 429]);
    // another client behind the same proxy has its own bucket
    expect(await call({ "x-forwarded-for": "10.0.0.1, 198.51.100.9" }, "172.16.0.2")).toBe(400);
  });
});

describe("the brain stays below the legacy token cost", () => {
  test("worst case: full addenda for every cat, a critic on every task, extra rounds and tuning, still far below legacy", async () => {
    const ctx = await makeCtx();
    const context = createContextModule(ctx).service;
    const r = await replaySuite(suite(), { context, specsFor: fixtureSpecsFor }, { brain: worstCaseBrain() });
    const brain = r.brain!.metrics;
    // the brain costs something on top of plain v2
    expect(brain.calls).toBeGreaterThan(r.v2.metrics.calls);
    expect(brain.inputTokens).toBeGreaterThan(r.v2.metrics.inputTokens);
    expect(brain.passed).toBe(brain.scenarios);
    // and stays far below legacy on billable input and on cost units (output weighted at gpt-4o-mini prices)
    expect(brain.billableInputTokens).toBeLessThan(r.legacy.metrics.billableInputTokens * 0.5);
    expect(costUnits(brain)).toBeLessThan(costUnits(r.legacy.metrics));
    expect(r.brainSavingsPct!).toBeGreaterThanOrEqual(45);
    expect(OUTPUT_WEIGHT).toBe(4);
    // deterministic
    const again = await replaySuite(suite(), { context: createContextModule(ctx).service, specsFor: fixtureSpecsFor }, { brain: worstCaseBrain() });
    expect(again.brain!.metrics).toEqual(brain);
    // the service switch replays the same worst case
    const mod = createEvalsModule(ctx, { context });
    const viaService = await mod.service.replay("core", { brain: true });
    expect(viaService.brain!.metrics).toEqual(brain);
    expect((await mod.service.replay("core")).brain).toBeUndefined();
  });

  test("the sample addendum is exactly the 120-token cap", () => {
    expect(charEstimate(sampleStrategy().text)).toBe(STRATEGY.maxTokens);
  });
});

describe("the strategy lab", () => {
  test("candidates parse to at most three redacted rules within 120 tokens", () => {
    const secret = "sk-" + "e".repeat(40);
    expect(parseStrategy('{"rules":["Run the tests after the last edit.","1. Add alt text first.","x"]}')).toBe("- Run the tests after the last edit.\n- Add alt text first.");
    expect(parseStrategy(`{"rules":["Never paste ${secret} anywhere."]}`)).not.toContain(secret);
    const long = parseStrategy(JSON.stringify({ rules: Array.from({ length: 6 }, (_, i) => `Rule ${i} ${"word ".repeat(40)}`) }))!;
    expect(long.split("\n").length).toBeLessThanOrEqual(STRATEGY.maxRules);
    expect(charEstimate(long)).toBeLessThanOrEqual(STRATEGY.maxTokens);
    expect(parseStrategy("no json")).toBeNull();
    expect(parseStrategy('{"rules":[]}')).toBeNull();
    expect(strategyText([])).toBeNull();
    expect(STRATEGY.outputTokens).toBe(120);
  });

  test("merge keeps the candidate first and drops current rules it repeats", () => {
    const merged = mergeStrategies("- Run the tests after the last edit.\n- Keep diffs small.", "- Run the tests after every last edit.\n- Add alt text first.")!;
    expect(merged.split("\n")).toEqual(["- Run the tests after every last edit.", "- Add alt text first.", "- Keep diffs small."]);
    expect(mergeStrategies(null, "- One rule here.")).toBe("- One rule here.");
  });

  test("the offline evaluation scores failures addressed against the replay cost; the rule adopts only a clear win", async () => {
    const ctx = await makeCtx();
    const context = createContextModule(ctx).service;
    const cases = [
      { outcome: "loss" as const, kind: "review_fail", cause: "The hero image has no alt text" },
      { outcome: "loss" as const, kind: "blocked", cause: "Never ran the tests after the last edit" },
      { outcome: "win" as const, kind: "done", cause: "" },
    ];
    const good = await evaluateStrategy({ context, subject: "role", role: "engineer", current: null, candidate: "- Add alt text to every image.\n- Run the tests after the last edit.", cases });
    expect(good.candidate.addressed).toBe(2);
    expect(good.candidate.losses).toBe(2);
    expect(good.adopt).toBe(true);
    expect(good.candidate.billableInputTokens).toBeGreaterThan(good.current.billableInputTokens);
    expect(good.candidate.billableInputTokens).toBeLessThan(good.legacyBillableInputTokens);
    const evidence = strategyEvidence(good);
    expect(evidence).toEqual({
      scores: { current: good.current.score, candidate: good.candidate.score },
      addressed: { current: 0, candidate: 2, losses: 2 },
      billableInputTokens: { current: good.current.billableInputTokens, candidate: good.candidate.billableInputTokens, legacy: good.legacyBillableInputTokens },
      tokens: { current: 0, candidate: good.candidate.tokens },
    });
    const vague = await evaluateStrategy({ context, subject: "agent", role: "engineer", current: { version: 1, text: "- Add alt text to every image." }, candidate: "- Be careful.", cases });
    expect(vague.adopt).toBe(false);
    expect(vague.reason).toStartWith("rejected: addresses 0 of 2");
    expect(terms("Running the tests").has("test")).toBe(true);
  });
});
