// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// providers module: CRUD over HTTP, key hygiene (vault only, never in a DTO,
// row or log line), SSRF guard, connection test, tier routing with the
// gpt-4o-mini default, media routing and the JEV binding. Fetch is mocked.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CSRF_HEADER, PROVIDER_PRESETS, type ModelRouting, type ProviderDTO } from "@mengai/shared";
import { Hono } from "hono";
import type { LookupFn } from "../../core/adapters/llm-openai";
import { createApp, jsonErrorHandler } from "../../core/app";
import { createKillSwitch } from "../../core/killswitch";
import type { AppConfig, ModuleContext } from "../../core/module";
import type { BlobStore } from "../../core/ports/blob";
import type { Db } from "../../core/ports/db";
import { LlmError } from "../../core/ports/llm";
import type { Logger } from "../../core/ports/logger";
import type { UsageService } from "../../core/services";
import { redact, REDACTED } from "../../lib/redact";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { createProvidersModule } from "./index";

const OPENAI_KEY = "sk-proj-OPENAIKEYabcdefghijklmnop9Z1x";
const ANTHROPIC_KEY = "sk-ant-api03-ANTHROPICKEYabcdefghij7Q2w";
const JEV_KEY = "jev-live-JEVKEYabcdefghijklmno4R5t";
const ALL_KEYS = [OPENAI_KEY, ANTHROPIC_KEY, JEV_KEY];

const realFetch = globalThis.fetch;
type Call = { url: string; method: string; headers: Headers; body: string | null };
let calls: Call[] = [];
function mockFetch(handler: (c: Call) => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const c = { url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: typeof init?.body === "string" ? init.body : null };
    calls.push(c);
    return handler(c);
  }) as typeof fetch;
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

function captureLogger(lines: string[]): Logger {
  const make = (base: Record<string, unknown>): Logger => ({
    log(level, msg, fields) {
      lines.push(JSON.stringify({ level, msg, ...base, ...fields }));
    },
    child(fields) {
      return make({ ...base, ...fields });
    },
  });
  return make({});
}

const noBlob: BlobStore = {
  async put(key, data) {
    return { key, size: data instanceof Blob ? data.size : (data as ArrayBuffer).byteLength };
  },
  async get() {
    return null;
  },
  async delete() {},
  async exists() {
    return false;
  },
};

const usage: UsageService = {
  async record() {
    throw new Error("not used");
  },
  async cost() {
    return 0;
  },
  async prices() {
    return {};
  },
  async listCalls() {
    return [];
  },
};

interface Env {
  db: Db;
  vault: ReturnType<typeof memoryVault>;
  logs: string[];
  mod: ReturnType<typeof createProvidersModule>;
  app: Hono;
  req(method: string, path: string, body?: unknown): Promise<Response>;
}

function testConfig(mode: AppConfig["mode"]): AppConfig {
  return { mode, version: "test", dataDir: "/tmp/mengai-test", workspacesDir: "/tmp/mengai-test/ws", webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null };
}

async function setup(mode: AppConfig["mode"] = "local", lookup?: LookupFn, wrapDb?: (db: Db) => Db): Promise<Env> {
  const raw = await createTestDb();
  const db = wrapDb ? wrapDb(raw) : raw;
  const vault = memoryVault();
  const logs: string[] = [];
  const clock = fakeClock();
  const config = testConfig(mode);
  const ctx: ModuleContext = { config, db, kv: memoryKv(), blob: noBlob, vault, clock, logger: captureLogger(logs), events: captureEvents(clock) };
  const mod = createProvidersModule(ctx, { usage, lookup, retry: { sleep: async () => {} } });
  // same mount rule and error handler as core/app.ts, without the session and CSRF layers
  expect(mod.mountPath).toBe("");
  const app = new Hono();
  app.onError(jsonErrorHandler(silentLogger));
  app.route("/api", mod.routes!);
  const req = async (method: string, path: string, body?: unknown): Promise<Response> =>
    app.request(path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { db, vault, logs, mod, app, req };
}

async function add(env: Env, body: Record<string, unknown>): Promise<ProviderDTO> {
  const res = await env.req("POST", "/api/providers", body);
  expect(res.status).toBe(201);
  return (await res.json()) as ProviderDTO;
}

/** Db whose provider row updates (update providers set label ...) fail while `fault.armed`. */
function failingUpdates(inner: Db, fault: { armed: boolean }): Db {
  return {
    dialect: inner.dialect,
    query(strings, ...values) {
      if (fault.armed && strings.join("?").includes("update providers set label")) return Promise.reject(new Error("injected db failure"));
      return inner.query(strings, ...values);
    },
    tx: (fn) => inner.tx((tx) => fn(failingUpdates(tx, fault))),
    exec: (sql) => inner.exec(sql),
    close: () => inner.close(),
  };
}

function expectNoKeys(text: string) {
  for (const k of ALL_KEYS) expect(text).not.toContain(k);
}

let env: Env;
beforeEach(async () => {
  env = await setup();
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await env.db.close();
});

describe("providers CRUD and key hygiene", () => {
  test("create stores the key in the vault only and returns hint + hasKey", async () => {
    const p = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    expect(p).toMatchObject({ preset: "openai", label: "OpenAI", protocol: "openai_chat", baseUrl: "https://api.openai.com/v1", hasKey: true, keyHint: "9Z1x" });
    expect(p.models.map((m) => m.id)).toContain("gpt-4o-mini");
    expect(env.vault.dump().get(`provider:${p.id}`)).toBe(OPENAI_KEY);
    const rows = await env.db.query`select * from providers`;
    expect((rows[0] as Record<string, unknown>).key_ref).toBe(`provider:${p.id}`);
    expectNoKeys(JSON.stringify(rows));
    expectNoKeys(JSON.stringify(p));
    expect(redact(`leaked ${OPENAI_KEY}`)).toBe(`leaked ${REDACTED}`);
  });

  test("key never appears in list, patch, test responses or any log line", async () => {
    const p = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    await add(env, { preset: "anthropic", apiKey: ANTHROPIC_KEY });
    await add(env, { preset: "jev", apiKey: JEV_KEY });
    const list = await (await env.req("GET", "/api/providers")).text();
    expectNoKeys(list);
    const patched = await (await env.req("PATCH", `/api/providers/${p.id}`, { label: "Main" })).text();
    expectNoKeys(patched);
    mockFetch(() => json({ error: { message: `Incorrect API key provided: ${OPENAI_KEY}` } }, 401));
    const tested = await (await env.req("POST", `/api/providers/${p.id}/test`)).text();
    expectNoKeys(tested);
    expect(JSON.parse(tested)).toMatchObject({ ok: false, models: [] });
    expect(JSON.parse(tested).error).toContain("401");
    const r = await env.mod.service.llm.resolve({ tier: "fast" });
    await r.provider.chat({ model: r.model, system: "s", messages: [{ role: "user", content: "x" }] }).catch(() => {});
    expect(env.logs.length).toBeGreaterThan(0);
    expectNoKeys(env.logs.join("\n"));
  });

  test("validation: unknown preset, missing key, strict bodies, empty patch", async () => {
    expect((await env.req("POST", "/api/providers", { preset: "nope", apiKey: "x" })).status).toBe(422);
    const noKey = await env.req("POST", "/api/providers", { preset: "anthropic" });
    expect(noKey.status).toBe(422);
    expect(((await noKey.json()) as any).error.code).toBe("key_required");
    const extra = await env.req("POST", "/api/providers", { preset: "openai", apiKey: OPENAI_KEY, keyRef: "provider:evil" });
    expect(extra.status).toBe(422);
    expect(((await extra.json()) as any).error.code).toBe("invalid_body");
    expect((await env.req("POST", "/api/providers", { preset: "openai", apiKey: "has space" })).status).toBe(422);
    const custom = await env.req("POST", "/api/providers", { preset: "custom-openai" });
    expect(((await custom.json()) as any).error.code).toBe("base_url_required");
    const p = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    expect((await env.req("PATCH", `/api/providers/${p.id}`, {})).status).toBe(422);
    expect((await env.req("PATCH", "/api/providers/missing-id", { label: "x" })).status).toBe(404);
    expect((await env.req("PATCH", "/api/providers/bad id!", { label: "x" })).status).toBe(404);
    const bad = await env.req("POST", "/api/providers", "not json");
    expect(bad.status).toBe(422);
  });

  test("patch rotates the key in place; clearing a required key is refused", async () => {
    const p = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    const rotated = "sk-proj-ROTATEDkeyabcdefghijklmnopWXYZ";
    const res = await env.req("PATCH", `/api/providers/${p.id}`, { apiKey: rotated });
    const dto = (await res.json()) as ProviderDTO;
    expect(dto.keyHint).toBe("WXYZ");
    expect(env.vault.dump().get(`provider:${p.id}`)).toBe(rotated);
    expect((await env.req("PATCH", `/api/providers/${p.id}`, { apiKey: "" })).status).toBe(422);
    const local = await add(env, { preset: "ollama" });
    expect(local.hasKey).toBe(false);
    const withKey = (await (await env.req("PATCH", `/api/providers/${local.id}`, { apiKey: "ollama-proxy-key-123" })).json()) as ProviderDTO;
    expect(withKey.hasKey).toBe(true);
    const cleared = (await (await env.req("PATCH", `/api/providers/${local.id}`, { apiKey: "" })).json()) as ProviderDTO;
    expect(cleared).toMatchObject({ hasKey: false, keyHint: null });
    expect(env.vault.dump().has(`provider:${local.id}`)).toBe(false);
  });

  test("delete removes the vault entry and routing references", async () => {
    const p = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    const routing: ModelRouting = {
      tiers: [{ tier: "deep", providerId: p.id, model: "gpt-4.1" }],
      roleTiers: {},
      image: { providerId: null, model: null },
      video: { providerId: null, model: null },
    };
    expect((await env.req("PUT", "/api/routing", routing)).status).toBe(200);
    expect(await (await env.req("DELETE", `/api/providers/${p.id}`)).json()).toEqual({ ok: true });
    expect(env.vault.dump().size).toBe(0);
    const after = (await (await env.req("GET", "/api/routing")).json()) as ModelRouting;
    expect(after.tiers.find((t) => t.tier === "deep")).toEqual({ tier: "deep", providerId: null, model: null });
    expect((await env.req("DELETE", `/api/providers/${p.id}`)).status).toBe(404);
  });

  test("presets route returns PROVIDER_PRESETS", async () => {
    expect(await (await env.req("GET", "/api/providers/presets")).json()).toEqual(JSON.parse(JSON.stringify(PROVIDER_PRESETS)));
  });
});

describe("connection test", () => {
  const toolCall = () =>
    json({
      choices: [{ message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "connection_check", arguments: '{"ok":true}' } }] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 40, completion_tokens: 8 },
    });

  test("GET /models when available, stored on the row, then one tiny tool call with the crew's model", async () => {
    const p = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    mockFetch((c) => (c.url.endsWith("/models") ? json({ data: [{ id: "gpt-4o-mini" }, { id: "gpt-4.1" }] }) : toolCall()));
    const r = (await (await env.req("POST", `/api/providers/${p.id}/test`)).json()) as any;
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/models");
    expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${OPENAI_KEY}`);
    expect(r).toMatchObject({ ok: true, error: null, models: [{ id: "gpt-4o-mini" }, { id: "gpt-4.1" }] });
    expect(typeof r.latencyMs).toBe("number");
    expect(calls[1]!.url).toBe("https://api.openai.com/v1/chat/completions");
    const probe = JSON.parse(calls[1]!.body!);
    expect(probe).toMatchObject({ model: "gpt-4o-mini", tool_choice: "required", max_completion_tokens: 512 });
    expect(probe.tools).toHaveLength(1);
    expect(probe.tools[0].function.name).toBe("connection_check");
    const dto = (await (await env.req("GET", "/api/providers")).json()) as ProviderDTO[];
    expect(dto[0]).toMatchObject({ lastTestOk: true, lastTestError: null });
    expect(dto[0]!.lastTestAt).not.toBeNull();
  });

  test("without a model list, the tool probe alone checks the key and the model", async () => {
    const p = await add(env, { preset: "custom-openai", baseUrl: "https://llm.example.com/v1/", models: [{ id: "my-model" }] });
    expect(p.baseUrl).toBe("https://llm.example.com/v1");
    mockFetch((c) => (c.url.endsWith("/models") ? json({ error: "no" }, 404) : toolCall()));
    const r = (await (await env.req("POST", `/api/providers/${p.id}/test`)).json()) as any;
    expect(r).toMatchObject({ ok: true, error: null, models: [] });
    expect(calls[1]!.url).toBe("https://llm.example.com/v1/chat/completions");
    expect(JSON.parse(calls[1]!.body!)).toMatchObject({ model: "my-model", max_tokens: 512, tool_choice: "required" });
    expect(calls[1]!.headers.get("authorization")).toBeNull();
  });

  test("the probe uses the model a tier maps to this provider", async () => {
    const p = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    const routing: ModelRouting = {
      tiers: [{ tier: "balanced", providerId: p.id, model: "gpt-4.1" }],
      roleTiers: {},
      image: { providerId: null, model: null },
      video: { providerId: null, model: null },
    };
    expect((await env.req("PUT", "/api/routing", routing)).status).toBe(200);
    mockFetch((c) => (c.url.endsWith("/models") ? json({ data: [] }) : toolCall()));
    await env.req("POST", `/api/providers/${p.id}/test`);
    expect(JSON.parse(calls[1]!.body!).model).toBe("gpt-4.1");
  });

  test("a model that cannot call tools fails the test with a plain sentence, and the crew's call fails with it before any request", async () => {
    const p = await add(env, { preset: "ollama", models: [{ id: "gemma2" }] });
    const refusal = { error: { message: "registry.ollama.ai/library/gemma2:latest does not support tools", type: "api_error", param: null, code: null } };
    mockFetch((c) => {
      if (c.url.endsWith("/models")) return json({ data: [{ id: "gemma2" }, { id: "qwen3" }] });
      return "tools" in JSON.parse(c.body!) ? json(refusal, 400) : json({ choices: [{ message: { content: "pong" }, finish_reason: "stop" }] });
    });
    const r = (await (await env.req("POST", `/api/providers/${p.id}/test`)).json()) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Answered, but this model cannot call tools; pick another model for the crew (model gemma2)");
    // the models stay listed so the owner can pick another one
    expect(r.models).toEqual([{ id: "gemma2" }, { id: "qwen3" }]);
    expect(calls).toHaveLength(3);
    const dto = (await (await env.req("GET", "/api/providers")).json()) as ProviderDTO[];
    expect(dto[0]).toMatchObject({ lastTestOk: false, lastTestError: r.error });

    // the routed adapter shares what the test learned: a cat's tool call fails fast with the same sentence
    const { provider, model } = await env.mod.service.llm.resolve({ tier: "balanced" });
    const before = calls.length;
    const err = (await provider
      .chat({ model, system: "s", messages: [{ role: "user", content: "go" }], tools: [{ name: "fs_read", description: "read", parameters: { type: "object" } }] })
      .catch((e) => e)) as LlmError;
    expect(err).toBeInstanceOf(LlmError);
    expect(err.kind).toBe("bad_request");
    expect(err.code).toBe("tools_unsupported");
    expect(err.message).toContain("gemma2 cannot call tools; pick another model for the crew");
    expect(calls.length).toBe(before);
  });

  test("OpenRouter's 404 for a model without tool support is the same plain sentence", async () => {
    const p = await add(env, { preset: "openrouter", apiKey: OPENAI_KEY, models: [{ id: "some/no-tools-model" }] });
    mockFetch((c) => {
      if (c.url.endsWith("/models")) return json({ data: [{ id: "some/no-tools-model" }] });
      if ("tools" in JSON.parse(c.body!)) {
        return json({ error: { message: "No endpoints found that support tool use. To learn more about provider routing, visit: https://openrouter.ai/docs/provider-routing", code: 404 } }, 404);
      }
      return json({ choices: [{ message: { content: "pong" }, finish_reason: "stop" }] });
    });
    const r = (await (await env.req("POST", `/api/providers/${p.id}/test`)).json()) as any;
    expect(r).toMatchObject({ ok: false, error: "Answered, but this model cannot call tools; pick another model for the crew (model some/no-tools-model)" });
  });

  test("a model that answers without calling the test tool passes with a note", async () => {
    const p = await add(env, { preset: "custom-openai", baseUrl: "https://llm.example.com/v1", models: [{ id: "chatty" }] });
    mockFetch((c) => (c.url.endsWith("/models") ? json({ data: [{ id: "chatty" }] }) : json({ choices: [{ message: { content: "ok!" }, finish_reason: "stop" }] })));
    const r = (await (await env.req("POST", `/api/providers/${p.id}/test`)).json()) as any;
    expect(r.ok).toBe(true);
    expect(r.error).toBe("chatty answered without calling the test tool; if cats stall, pick another model for the crew");
  });

  test("a vendor error on the probe still fails the test with the vendor text", async () => {
    const p = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    mockFetch((c) =>
      c.url.endsWith("/models") ? json({ data: [{ id: "gpt-4o-mini" }] }) : json({ error: { message: "The model `gpt-4o-mini` does not exist or you do not have access to it.", code: "model_not_found" } }, 404),
    );
    const r = (await (await env.req("POST", `/api/providers/${p.id}/test`)).json()) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toContain("does not exist or you do not have access");
  });

  test("the test learns the Responses path for a reasoning model on the official host, and the crew starts there", async () => {
    const p = await add(env, { preset: "openai", apiKey: OPENAI_KEY, models: [{ id: "gpt-6-luna" }] });
    const refusal = "Function tools with reasoning_effort are not supported for gpt-6-luna in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.";
    const responsesOk = () =>
      json({
        model: "gpt-6-luna",
        status: "completed",
        output: [
          { type: "reasoning", id: "rs_1", summary: [] },
          { type: "function_call", id: "fc_1", call_id: "call_x", name: "connection_check", arguments: '{"ok":true}', status: "completed" },
        ],
        usage: { input_tokens: 50, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20 },
      });
    mockFetch((c) => {
      if (c.url.endsWith("/models")) return json({ data: [{ id: "gpt-6-luna" }] });
      if (c.url.endsWith("/responses")) return responsesOk();
      return json({ error: { message: refusal, type: "invalid_request_error", param: null, code: null } }, 400);
    });
    const r = (await (await env.req("POST", `/api/providers/${p.id}/test`)).json()) as any;
    expect(r).toMatchObject({ ok: true, error: null });
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/v1/models", "/v1/chat/completions", "/v1/responses"]);

    const { provider, model } = await env.mod.service.llm.resolve({ tier: "balanced" });
    expect(model).toBe("gpt-6-luna");
    const before = calls.length;
    const out = await provider.chat({ model, system: "s", messages: [{ role: "user", content: "go" }], tools: [{ name: "connection_check", description: "x", parameters: { type: "object" } }] });
    expect(out.toolCalls).toEqual([{ id: "call_x", name: "connection_check", arguments: '{"ok":true}' }]);
    expect(calls.slice(before).map((c) => new URL(c.url).pathname)).toEqual(["/v1/responses"]);

    // a new key may be another account: what was learned is dropped with it
    await env.req("PATCH", `/api/providers/${p.id}`, { apiKey: "sk-proj-ROTATEDkeyabcdefghijklmnopQ1W2" });
    const again = await env.mod.service.llm.resolve({ tier: "balanced" });
    const mark = calls.length;
    await again.provider.chat({ model, system: "s", messages: [{ role: "user", content: "go" }], tools: [{ name: "connection_check", description: "x", parameters: { type: "object" } }] });
    expect(calls.slice(mark).map((c) => new URL(c.url).pathname)).toEqual(["/v1/chat/completions", "/v1/responses"]);
  });

  test("rate limited to 10 per minute with Retry-After", async () => {
    const p = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    mockFetch(() => json({ data: [] }));
    for (let i = 0; i < 10; i++) expect((await env.req("POST", `/api/providers/${p.id}/test`)).status).toBe(200);
    const res = await env.req("POST", `/api/providers/${p.id}/test`);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await res.json()) as any).error.code).toBe("rate_limited");
  });

  test("jev provider test goes through the judge transport", async () => {
    const p = await add(env, { preset: "jev", apiKey: JEV_KEY });
    mockFetch(() => json({ verified: true, model: "jev-1.13.0", answers: { ok: { type: "noul", noul: 0.99 } } }));
    const r = (await (await env.req("POST", `/api/providers/${p.id}/test`)).json()) as any;
    expect(r).toMatchObject({ ok: true, models: [] });
    expect(calls[0]!.url).toBe("https://api.typesafe.ai/v1/systemone");
  });

  test("jev is key only: official endpoint, no models, adding again replaces the key", async () => {
    const p = await add(env, { preset: "jev", apiKey: JEV_KEY, baseUrl: "https://elsewhere.example/v1", models: [{ id: "x" }] });
    expect(p).toMatchObject({ baseUrl: "https://api.typesafe.ai/v1", models: [], hasKey: true });
    const rotated = "jev-live-ROTATEDabcdefghijklmnoZ9";
    const again = await add(env, { preset: "jev", apiKey: rotated });
    expect(again.id).toBe(p.id);
    expect(again.keyHint).toBe(rotated.slice(-4));
    const list = (await (await env.req("GET", "/api/providers")).json()) as ProviderDTO[];
    expect(list.filter((x) => x.preset === "jev")).toHaveLength(1);
    const moved = await env.req("PATCH", `/api/providers/${p.id}`, { baseUrl: "https://elsewhere.example/v1" });
    expect(moved.status).toBe(422);
    expect(((await moved.json()) as any).error.code).toBe("jev_official_only");
  });
});

describe("base URL cleanup", () => {
  test("a pasted endpoint path is cut back to the base URL the adapter expects", async () => {
    for (const [pasted, stored] of [
      ["https://api.openai.com/v1/chat/completions", "https://api.openai.com/v1"],
      ["https://api.openai.com/v1/responses/", "https://api.openai.com/v1"],
      ["https://api.openai.com/v1/completions", "https://api.openai.com/v1"],
      ["https://api.openai.com/v1/models?x=1", "https://api.openai.com/v1"],
      ["https://api.openai.com/v1", "https://api.openai.com/v1"],
    ] as const) {
      const p = await add(env, { preset: "openai", apiKey: "sk-test-abcdefghijklmnopqrstu", baseUrl: pasted });
      expect(p.baseUrl).toBe(stored);
      await env.req("DELETE", `/api/providers/${p.id}`);
    }
    const a = await add(env, { preset: "anthropic", apiKey: "sk-ant-test-abcdefghijklmnop", baseUrl: "https://api.anthropic.com/v1/messages" });
    expect(a.baseUrl).toBe("https://api.anthropic.com/v1");
  });
});

describe("SSRF guard on create and update", () => {
  test("server mode rejects private base URLs and local presets", async () => {
    await env.db.close();
    env = await setup("server", async (host) => (host === "evil.example" ? [{ address: "192.168.0.10", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]));
    for (const body of [
      { preset: "custom-openai", baseUrl: "http://10.0.0.5/v1" },
      { preset: "custom-openai", baseUrl: "https://evil.example/v1" },
      { preset: "custom-openai", baseUrl: "http://169.254.169.254/v1" },
      { preset: "ollama" },
    ]) {
      const res = await env.req("POST", "/api/providers", body);
      expect([body, res.status]).toEqual([body, 422]);
      expect(((await res.json()) as any).error.code).toBe("unsafe_base_url");
    }
    const p = await add(env, { preset: "custom-openai", baseUrl: "https://llm.example.com/v1" });
    const res = await env.req("PATCH", `/api/providers/${p.id}`, { baseUrl: "http://127.0.0.1:8080" });
    expect(res.status).toBe(422);
  });

  test("local mode accepts Ollama on localhost", async () => {
    const p = await add(env, { preset: "ollama" });
    expect(p.baseUrl).toBe("http://localhost:11434/v1");
    // not routable yet: Ollama is not the default preset and no tier is mapped to it
    expect(await env.mod.service.llm.configured()).toBe(false);
    const routing = { tiers: [{ tier: "fast", providerId: p.id, model: "llama3.3" }], roleTiers: {}, image: { providerId: null, model: null }, video: { providerId: null, model: null } };
    expect((await env.req("PUT", "/api/routing", routing)).status).toBe(200);
    expect(await env.mod.service.llm.configured()).toBe(true);
    expect((await env.mod.service.llm.resolve({ tier: "balanced" })).model).toBe("llama3.3");
  });

  test("server mode requires https for base URLs", async () => {
    await env.db.close();
    env = await setup("server", async () => [{ address: "93.184.216.34", family: 4 }]);
    const res = await env.req("POST", "/api/providers", { preset: "custom-openai", baseUrl: "http://llm.example.com/v1" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.code).toBe("unsafe_base_url");
  });
});

describe("base URL change and the stored key", () => {
  const publicDns: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
  const ok = () => json({ data: [{ id: "m" }] });

  test("PATCH baseUrl without a new key clears the stored key; the old key never reaches the new host", async () => {
    await env.db.close();
    env = await setup("server", publicDns);
    const p = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    mockFetch(ok);
    expect((await env.req("POST", `/api/providers/${p.id}/test`)).status).toBe(200);
    // warm the adapter cache so a stale adapter could carry the old key
    await env.mod.service.llm.resolve({ tier: "fast" });

    const res = await env.req("PATCH", `/api/providers/${p.id}`, { baseUrl: "https://attacker.example/v1" });
    expect(res.status).toBe(200);
    const dto = (await res.json()) as ProviderDTO;
    expect(dto).toMatchObject({ baseUrl: "https://attacker.example/v1", hasKey: false, keyHint: null, lastTestAt: null, lastTestOk: null, lastTestError: null });
    expect(env.vault.dump().has(`provider:${p.id}`)).toBe(false);
    const listed = ((await (await env.req("GET", "/api/providers")).json()) as ProviderDTO[])[0]!;
    expect(listed).toMatchObject({ baseUrl: "https://attacker.example/v1", hasKey: false, lastTestOk: null });

    // the keyless row of a key-required preset is unusable until the owner re-enters a key
    mockFetch(ok);
    const tested = (await (await env.req("POST", `/api/providers/${p.id}/test`)).json()) as { ok: boolean; error: string };
    expect(tested.ok).toBe(false);
    expect(tested.error).toContain("no API key");
    expect(calls).toHaveLength(0);
    expect(((await env.mod.service.llm.resolve({ tier: "fast" }).catch((e) => e)) as LlmError).kind).toBe("not_found");
    expect(await env.mod.service.llm.configured()).toBe(false);
    expectNoKeys(env.logs.join("\n"));

    const fresh = "sk-proj-REENTEREDkeyabcdefghijklmnWXYZ";
    const rekeyed = (await (await env.req("PATCH", `/api/providers/${p.id}`, { apiKey: fresh })).json()) as ProviderDTO;
    expect(rekeyed).toMatchObject({ baseUrl: "https://attacker.example/v1", hasKey: true, keyHint: "WXYZ" });
    mockFetch(ok);
    await env.req("POST", `/api/providers/${p.id}/test`);
    // the model list, then the tool probe: both to the new host, both with the new key only
    expect(calls.map((c) => [new URL(c.url).pathname, c.headers.get("authorization")])).toEqual([
      ["/v1/models", `Bearer ${fresh}`],
      ["/v1/chat/completions", `Bearer ${fresh}`],
    ]);
    expect(new Set(calls.map((c) => new URL(c.url).host))).toEqual(new Set(["attacker.example"]));
    for (const c of calls) expect(JSON.stringify([...c.headers.entries()])).not.toContain(OPENAI_KEY);
  });

  test("a new key in the same PATCH moves the provider; the same URL (trailing slash) keeps the key", async () => {
    await env.db.close();
    env = await setup("server", publicDns);
    const p = await add(env, { preset: "custom-openai", baseUrl: "https://llm.example.com/v1", apiKey: OPENAI_KEY });
    expect((await env.req("PATCH", `/api/providers/${p.id}`, { baseUrl: "https://llm.example.com/v1/", label: "Same" })).status).toBe(200);
    expect(env.vault.dump().get(`provider:${p.id}`)).toBe(OPENAI_KEY);

    const fresh = "sk-proj-NEWHOSTkeyabcdefghijklmnopQRST";
    const moved = (await (await env.req("PATCH", `/api/providers/${p.id}`, { baseUrl: "https://new.example.com/v1", apiKey: fresh })).json()) as ProviderDTO;
    expect(moved).toMatchObject({ baseUrl: "https://new.example.com/v1", hasKey: true, keyHint: "QRST" });
    mockFetch(ok);
    await env.req("POST", `/api/providers/${p.id}/test`);
    expect(calls[0]!.url).toBe("https://new.example.com/v1/models");
    expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${fresh}`);

    // path-only change on the same host clears the key too (gateways put tenants in the path)
    const pathMove = (await (await env.req("PATCH", `/api/providers/${p.id}`, { baseUrl: "https://new.example.com/other/v1" })).json()) as ProviderDTO;
    expect(pathMove).toMatchObject({ baseUrl: "https://new.example.com/other/v1", hasKey: false, keyHint: null });
    expect(env.vault.dump().has(`provider:${p.id}`)).toBe(false);
    // keyless custom endpoints are allowed: calls go out without any authorization header
    mockFetch(ok);
    await env.req("POST", `/api/providers/${p.id}/test`);
    expect(calls.map((c) => c.headers.get("authorization"))).toEqual([null, null]);

    const dropped = (await (await env.req("PATCH", `/api/providers/${p.id}`, { baseUrl: "https://third.example.com/v1", apiKey: "" })).json()) as ProviderDTO;
    expect(dropped).toMatchObject({ baseUrl: "https://third.example.com/v1", hasKey: false, keyHint: null });
    // no stored key: nothing to leak, the URL moves freely
    expect((await env.req("PATCH", `/api/providers/${p.id}`, { baseUrl: "https://fourth.example.com/v1" })).status).toBe(200);
  });

  test("a required key cannot be dropped on the same URL; moving the URL clears it", async () => {
    const p = await add(env, { preset: "anthropic", apiKey: ANTHROPIC_KEY });
    const same = await env.req("PATCH", `/api/providers/${p.id}`, { apiKey: "" });
    expect(same.status).toBe(422);
    expect(((await same.json()) as any).error.code).toBe("key_required");
    expect(env.vault.dump().get(`provider:${p.id}`)).toBe(ANTHROPIC_KEY);

    const res = await env.req("PATCH", `/api/providers/${p.id}`, { baseUrl: "https://proxy.example.com/v1", apiKey: "" });
    expect(res.status).toBe(200);
    expect((await res.json()) as ProviderDTO).toMatchObject({ baseUrl: "https://proxy.example.com/v1", hasKey: false });
    expect(env.vault.dump().has(`provider:${p.id}`)).toBe(false);
  });

  test("a failed row write puts the vault back, so no key is paired with another endpoint", async () => {
    const fault = { armed: false };
    await env.db.close();
    env = await setup("server", publicDns, (db) => failingUpdates(db, fault));
    const p = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    fault.armed = true;
    const fresh = "sk-proj-NEWHOSTkeyabcdefghijklmnopQRST";
    expect((await env.req("PATCH", `/api/providers/${p.id}`, { baseUrl: "https://new.example.com/v1", apiKey: fresh })).status).toBe(500);
    expect(env.vault.dump().get(`provider:${p.id}`)).toBe(OPENAI_KEY);
    expect((await env.req("PATCH", `/api/providers/${p.id}`, { baseUrl: "https://new.example.com/v1" })).status).toBe(500);
    expect(env.vault.dump().get(`provider:${p.id}`)).toBe(OPENAI_KEY);
    fault.armed = false;

    const keyless = await add(env, { preset: "custom-openai", baseUrl: "https://llm.example.com/v1" });
    fault.armed = true;
    expect((await env.req("PATCH", `/api/providers/${keyless.id}`, { apiKey: fresh })).status).toBe(500);
    expect(env.vault.dump().has(`provider:${keyless.id}`)).toBe(false);
    fault.armed = false;

    const [row] = ((await (await env.req("GET", "/api/providers")).json()) as ProviderDTO[]).filter((x) => x.id === p.id);
    expect(row).toMatchObject({ baseUrl: "https://api.openai.com/v1", hasKey: true });
    mockFetch(ok);
    await env.req("POST", `/api/providers/${p.id}/test`);
    expect(calls.map((c) => [new URL(c.url).host, c.headers.get("authorization")])).toEqual([
      ["api.openai.com", `Bearer ${OPENAI_KEY}`],
      ["api.openai.com", `Bearer ${OPENAI_KEY}`],
    ]);
  });
});

describe("tier routing", () => {
  const routing = (tiers: ModelRouting["tiers"], roleTiers: ModelRouting["roleTiers"] = {}): ModelRouting => ({
    tiers,
    roleTiers,
    image: { providerId: null, model: null },
    video: { providerId: null, model: null },
  });

  test("defaults when unset, and nothing configured means a clear not_found", async () => {
    const r = (await (await env.req("GET", "/api/routing")).json()) as ModelRouting;
    expect(r.tiers.map((t) => t.tier)).toEqual(["fast", "balanced", "deep"]);
    expect(r.tiers.every((t) => t.providerId === null)).toBe(true);
    expect(await env.mod.service.llm.configured()).toBe(false);
    const err = (await env.mod.service.llm.resolve({ tier: "fast" }).catch((e) => e)) as LlmError;
    expect(err).toBeInstanceOf(LlmError);
    expect(err.kind).toBe("not_found");
    expect(err.message).toContain("Add any provider");
    expect(err.message).not.toContain("gpt-4o-mini");
  });

  test("provider agnostic: with no routing, the first provider the owner added serves every tier with its first model", async () => {
    const anthropic = await add(env, { preset: "anthropic", apiKey: ANTHROPIC_KEY });
    await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    for (const tier of ["fast", "balanced", "deep"] as const) {
      const r = await env.mod.service.llm.resolve({ tier });
      expect([tier, r.provider.id, r.model]).toEqual([tier, anthropic.id, "claude-sonnet-5-5"]);
    }
    expect(await env.mod.service.llm.configured()).toBe(true);
  });

  test("an unmapped tier borrows the nearest mapped tier before any unmapped provider", async () => {
    const a = await add(env, { preset: "anthropic", apiKey: ANTHROPIC_KEY });
    await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    expect((await env.req("PUT", "/api/routing", routing([{ tier: "deep", providerId: a.id, model: "claude-opus-5-5" }]))).status).toBe(200);
    for (const tier of ["fast", "balanced", "deep"] as const) {
      const r = await env.mod.service.llm.resolve({ tier });
      expect([tier, r.provider.id, r.model]).toEqual([tier, a.id, "claude-opus-5-5"]);
    }
    const deep = await env.mod.service.llm.resolve({ tier: "deep" });
    expect(deep.contextWindow).toBe(200_000);
    expect(deep.provider.protocol).toBe("anthropic_messages");
  });

  test("borrowing goes cheaper first when both neighbours are mapped", async () => {
    const a = await add(env, { preset: "anthropic", apiKey: ANTHROPIC_KEY });
    await env.req("PUT", "/api/routing", routing([
      { tier: "fast", providerId: a.id, model: "claude-haiku-4-5" },
      { tier: "deep", providerId: a.id, model: "claude-opus-5-5" },
    ]));
    expect(await env.mod.service.llm.configured()).toBe(true);
    expect((await env.mod.service.llm.resolve({ tier: "balanced" })).model).toBe("claude-haiku-4-5");
    await env.req("PUT", "/api/routing", routing([{ tier: "deep", providerId: a.id, model: "claude-opus-5-5" }]));
    // nothing cheaper is mapped: the only way to serve fast is up
    expect((await env.mod.service.llm.resolve({ tier: "fast" })).model).toBe("claude-opus-5-5");
  });

  test("role override and full mapping", async () => {
    const a = await add(env, { preset: "anthropic", apiKey: ANTHROPIC_KEY });
    const o = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    await env.req("PUT", "/api/routing", routing([{ tier: "fast", providerId: o.id, model: "gpt-4.1-mini" }], { reviewer: "deep", lead: "deep" }));
    expect((await env.mod.service.llm.resolve({ tier: "fast" })).model).toBe("gpt-4.1-mini");
    // deep is unmapped: it borrows balanced (unmapped), then fast
    expect((await env.mod.service.llm.resolve({ tier: "deep" })).model).toBe("gpt-4.1-mini");
    expect((await env.mod.service.llm.resolve({ tier: "fast", role: "lead" })).model).toBe("gpt-4.1-mini");

    await env.req(
      "PUT",
      "/api/routing",
      routing(
        [
          { tier: "fast", providerId: o.id, model: "gpt-4.1-mini" },
          { tier: "balanced", providerId: o.id, model: "gpt-4.1" },
          { tier: "deep", providerId: a.id, model: "claude-opus-5-5" },
        ],
        { reviewer: "deep" },
      ),
    );
    expect((await env.mod.service.llm.resolve({ tier: "fast", role: "reviewer" })).model).toBe("claude-opus-5-5");
    expect((await env.mod.service.llm.resolve({ tier: "fast", role: "engineer" })).model).toBe("gpt-4.1-mini");
    expect((await env.mod.service.llm.resolve({ tier: "balanced" })).model).toBe("gpt-4.1");
  });

  test("resolved providers are cached (one breaker per provider) and rebuilt after an update", async () => {
    const o = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    const r1 = await env.mod.service.llm.resolve({ tier: "fast" });
    const r2 = await env.mod.service.llm.resolve({ tier: "deep" });
    expect(r1.provider).toBe(r2.provider);
    await env.req("PATCH", `/api/providers/${o.id}`, { label: "Renamed" });
    const r3 = await env.mod.service.llm.resolve({ tier: "fast" });
    expect(r3.provider).not.toBe(r1.provider);
    mockFetch(() => json({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 5, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } } }));
    const out = await r3.provider.chat({ model: r3.model, system: "s", messages: [{ role: "user", content: "x" }] });
    expect(out.text).toBe("hi");
    expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${OPENAI_KEY}`);
  });

  test("routing validation: unknown provider, wrong protocol, missing model, duplicate tier, unknown role", async () => {
    const jev = await add(env, { preset: "jev", apiKey: JEV_KEY });
    const bad = async (r: unknown, code: string) => {
      const res = await env.req("PUT", "/api/routing", r);
      expect([code, res.status]).toEqual([code, 422]);
      expect(((await res.json()) as any).error.code).toBe(code);
    };
    await bad(routing([{ tier: "fast", providerId: "nope", model: "x" }]), "unknown_provider");
    await bad(routing([{ tier: "fast", providerId: jev.id, model: "jev-latest" }]), "wrong_capability");
    const o = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    await bad(routing([{ tier: "fast", providerId: o.id, model: null }]), "model_required");
    await bad(routing([{ tier: "fast", providerId: o.id, model: "a" }, { tier: "fast", providerId: o.id, model: "b" }]), "invalid_body");
    await bad({ ...routing([]), roleTiers: { wizard: "deep" } }, "invalid_body");
    await bad({ ...routing([]), image: { providerId: o.id, model: "gpt-image-2" } }, "wrong_capability");
  });

  test("reasoning per tier: validated against the list, persisted, missing and default both mean default", async () => {
    const o = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    const res = await env.req(
      "PUT",
      "/api/routing",
      routing([
        { tier: "fast", providerId: o.id, model: "gpt-4.1-mini", reasoning: "none" },
        { tier: "balanced", providerId: o.id, model: "gpt-4.1", reasoning: "default" },
        // a tier without its own provider keeps its effort: the model it borrows thinks at this level
        { tier: "deep", providerId: null, model: null, reasoning: "high" },
      ]),
    );
    expect(res.status).toBe(200);
    const want = [
      { tier: "fast", providerId: o.id, model: "gpt-4.1-mini", reasoning: "none" },
      { tier: "balanced", providerId: o.id, model: "gpt-4.1" },
      { tier: "deep", providerId: null, model: null, reasoning: "high" },
    ];
    expect(((await res.json()) as ModelRouting).tiers).toEqual(want as ModelRouting["tiers"]);
    expect(((await (await env.req("GET", "/api/routing")).json()) as ModelRouting).tiers).toEqual(want as ModelRouting["tiers"]);

    for (const reasoning of ["extreme", "", 3, null]) {
      const bad = await env.req("PUT", "/api/routing", routing([{ tier: "fast", providerId: o.id, model: "gpt-4.1-mini", reasoning } as never]));
      expect([reasoning, bad.status]).toEqual([reasoning, 422]);
      expect(((await bad.json()) as any).error.code).toBe("invalid_body");
    }
    // a stored value from an older or hand-edited row is read back safely
    const { createProvidersRepo } = await import("./repo");
    await createProvidersRepo(env.db).putRouting({ ...routing([{ tier: "fast", providerId: o.id, model: "m", reasoning: "turbo" as never }]) }, 1);
    const read = ((await (await env.req("GET", "/api/routing")).json()) as ModelRouting).tiers[0]!;
    expect(read).toEqual({ tier: "fast", providerId: o.id, model: "m" });
  });

  test("the router puts the tier's reasoning on every chat request of that tier; a request's own setting wins", async () => {
    const o = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    await env.req(
      "PUT",
      "/api/routing",
      routing(
        [
          { tier: "fast", providerId: null, model: null, reasoning: "none" },
          { tier: "balanced", providerId: o.id, model: "gpt-5.5", reasoning: "high" },
          { tier: "deep", providerId: null, model: null },
        ],
        { reviewer: "fast" },
      ),
    );
    mockFetch(() => json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
    const ask = async (r: Awaited<ReturnType<typeof env.mod.service.llm.resolve>>, reasoning?: "low") => {
      await r.provider.chat({ model: r.model, system: "s", messages: [{ role: "user", content: "go" }], ...(reasoning ? { reasoning } : {}) });
      return JSON.parse(calls.at(-1)!.body!).reasoning_effort;
    };
    const balanced = await env.mod.service.llm.resolve({ tier: "balanced" });
    expect(balanced.reasoning).toBe("high");
    expect(await ask(balanced)).toBe("high");
    expect(await ask(balanced, "low")).toBe("low");
    // fast borrows balanced's model at its own effort; deep borrows it at the model's default (nothing sent)
    const fast = await env.mod.service.llm.resolve({ tier: "fast" });
    expect([fast.model, await ask(fast)]).toEqual(["gpt-5.5", "none"]);
    const deep = await env.mod.service.llm.resolve({ tier: "deep" });
    expect(deep.reasoning).toBeUndefined();
    expect(await ask(deep)).toBeUndefined();
    // a role override resolves to that tier's effort
    expect(await ask(await env.mod.service.llm.resolve({ tier: "deep", role: "reviewer" }))).toBe("none");
    // one adapter underneath: the same breaker serves every tier
    expect(Object.getPrototypeOf(balanced.provider)).toBe(deep.provider);
    expect((await env.mod.service.llm.resolve({ tier: "balanced" })).provider).toBe(balanced.provider);
  });

  test("an Anthropic tier with reasoning thinks within the output cap", async () => {
    const a = await add(env, { preset: "anthropic", apiKey: ANTHROPIC_KEY });
    await env.req("PUT", "/api/routing", routing([{ tier: "deep", providerId: a.id, model: "claude-opus-5-5", reasoning: "medium" }]));
    mockFetch(() => json({ model: "claude-opus-5-5", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 1 } }));
    const r = await env.mod.service.llm.resolve({ tier: "deep" });
    await r.provider.chat({ model: r.model, system: "s", messages: [{ role: "user", content: "go" }], maxOutputTokens: 16_000, temperature: 0.2 });
    const body = JSON.parse(calls[0]!.body!);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
    expect(body.temperature).toBe(1);
    expect(body.max_tokens).toBe(16_000);
  });

  test("the connection test probes at the tier's effort, with room to think", async () => {
    const o = await add(env, { preset: "openai", apiKey: OPENAI_KEY });
    await env.req("PUT", "/api/routing", routing([{ tier: "balanced", providerId: o.id, model: "gpt-5.5", reasoning: "medium" }]));
    mockFetch((c) =>
      c.url.endsWith("/models")
        ? json({ data: [{ id: "gpt-5.5" }] })
        : json({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "connection_check", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }),
    );
    const r = (await (await env.req("POST", `/api/providers/${o.id}/test`)).json()) as any;
    expect(r.ok).toBe(true);
    expect(JSON.parse(calls[1]!.body!)).toMatchObject({ model: "gpt-5.5", reasoning_effort: "medium", max_completion_tokens: 4096 });
  });
});

describe("media routing and judge binding", () => {
  test("media router picks a usable provider and a model per kind; overrides and errors", async () => {
    await expect(env.mod.service.media.resolve("image")).rejects.toMatchObject({ code: "media_not_configured" });
    const m = await add(env, { preset: "openai-media", apiKey: OPENAI_KEY });
    const img = await env.mod.service.media.resolve("image");
    expect([img.provider.id, img.model]).toEqual([m.id, "gpt-image-2"]);
    const vid = await env.mod.service.media.resolve("video");
    expect(vid.model).toBe("sora-2");
    expect((await env.mod.service.media.resolve("image", { model: "gpt-image-1-mini" })).model).toBe("gpt-image-1-mini");
    await expect(env.mod.service.media.resolve("image", { providerId: "missing" })).rejects.toMatchObject({ status: 404 });
    const fal = await add(env, { preset: "fal", apiKey: "fal-key-abcdefgh12345678", models: [{ id: "fal-ai/flux/dev" }, { id: "fal-ai/kling-video/v2", caps: ["video"] }] });
    await env.req("PUT", "/api/routing", {
      tiers: [],
      roleTiers: {},
      image: { providerId: fal.id, model: "fal-ai/flux/dev" },
      video: { providerId: fal.id, model: null },
    });
    expect((await env.mod.service.media.resolve("image")).model).toBe("fal-ai/flux/dev");
    const v = await env.mod.service.media.resolve("video");
    expect([v.provider.protocol, v.model]).toEqual(["fal_queue", "fal-ai/kling-video/v2"]);
  });

  test("judge is unverified without a jev provider and uses its key when present", async () => {
    const q = { ok: { type: "noul" as const, instructions: "yes?" } };
    expect(await env.mod.service.judge.configured()).toBe(false);
    const none = await env.mod.service.judge.decide({ decisionId: "orch.route", state: {}, questions: q });
    expect(none).toMatchObject({ verified: false, stamp: "UNVERIFIED BY JEV" });
    await add(env, { preset: "jev", apiKey: JEV_KEY });
    expect(await env.mod.service.judge.configured()).toBe(true);
    mockFetch(() => json({ verified: true, model: "jev-1.13.0", answers: { ok: { type: "noul", noul: 0.8 } } }));
    const r = await env.mod.service.judge.decide({ decisionId: "orch.route", state: { goal: "ship" }, questions: q });
    expect(r).toMatchObject({ verified: true, answers: { ok: { type: "noul", noul: 0.8 } } });
    expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${JEV_KEY}`);
  });

  test("warm-up registers stored keys with the redactor", async () => {
    await env.vault.set("provider:seeded", "seeded-secret-value-abc123");
    await env.db.query`insert into providers (id, preset, label, protocol, base_url, key_ref, key_hint, created_at, updated_at) values (${"seeded"}, ${"openai"}, ${"OpenAI"}, ${"openai_chat"}, ${"https://api.openai.com/v1"}, ${"provider:seeded"}, ${"c123"}, ${1}, ${1})`;
    expect(await env.mod.service.warm()).toBe(1);
    expect(redact("x seeded-secret-value-abc123 y")).toBe(`x ${REDACTED} y`);
  });
});

describe("fal connection test", () => {
  test("no key check endpoint: ok with a note once a key is stored, and no request is sent", async () => {
    const f = await add(env, { preset: "fal", apiKey: "fal-key-abcdefgh12345678" });
    mockFetch(() => json({}, 500));
    const r = (await (await env.req("POST", `/api/providers/${f.id}/test`)).json()) as any;
    expect(r).toMatchObject({ ok: true, models: [] });
    expect(r.error).toContain("first generation");
    expect(calls).toHaveLength(0);
    const dto = (await (await env.req("GET", "/api/providers")).json()) as ProviderDTO[];
    expect(dto[0]).toMatchObject({ lastTestOk: true });
  });
});

// The root bunfig preloads happy-dom for web tests; its global Request drops
// the Origin header and cannot be cloned by hono's body limit, so the
// createApp test runs on Bun's native fetch classes (as auth.test.ts does).
const native = (await import(String("undici"))) as { Request: typeof Request; Response: typeof Response; Headers: typeof Headers };
const NativeRequest = native.Request;

describe("mounted through core/app createApp", () => {
  test("/api/providers and /api/routing are reachable; per-route limits key on the proxied client ip", async () => {
    const db = await createTestDb();
    const clock = fakeClock();
    const config = testConfig("server");
    const kv = memoryKv();
    const ctx: ModuleContext = { config, db, kv, blob: noBlob, vault: memoryVault(), clock, logger: silentLogger, events: captureEvents(clock) };
    const mod = createProvidersModule(ctx, { usage, lookup: async () => [{ address: "93.184.216.34", family: 4 }] });
    const app = createApp({
      config,
      modules: [mod],
      auth: { authenticate: async () => ({ sessionId: "s", userId: "owner", email: null }), session: async () => ({ authenticated: true, mode: "server", needsSetup: false }) },
      killswitch: createKillSwitch({ events: captureEvents(), logger: silentLogger }),
      kv,
      logger: silentLogger,
      trustProxy: 1,
    });
    const call = async (method: string, path: string, body?: unknown, ip = "203.0.113.7") =>
      app.fetch(
        new NativeRequest(`http://mengai.test${path}`, {
          method,
          headers: { origin: "http://mengai.test", [CSRF_HEADER]: "1", "x-forwarded-for": ip, ...(body === undefined ? {} : { "content-type": "application/json" }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    const saved = { Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers };
    Object.assign(globalThis, { Request: native.Request, Response: native.Response, Headers: native.Headers });
    try {
      const got = await call("GET", "/api/routing");
      expect(got.status).toBe(200);
      const routing = (await got.json()) as ModelRouting;
      expect(routing.tiers.map((t) => t.tier)).toEqual(["fast", "balanced", "deep"]);
      const created = await call("POST", "/api/providers", { preset: "openai", apiKey: OPENAI_KEY });
      expect(created.status).toBe(201);
      const p = (await created.json()) as ProviderDTO;
      const put = await call("PUT", "/api/routing", { ...routing, tiers: [{ tier: "deep", providerId: p.id, model: "gpt-4.1" }] });
      expect(put.status).toBe(200);
      expect(((await put.json()) as ModelRouting).tiers.find((t) => t.tier === "deep")).toEqual({ tier: "deep", providerId: p.id, model: "gpt-4.1" });
      expect((await call("GET", "/api/providers/presets")).status).toBe(200);

      mockFetch(() => json({ data: [] }));
      for (let i = 0; i < 10; i++) expect((await call("POST", `/api/providers/${p.id}/test`)).status).toBe(200);
      const limited = await call("POST", `/api/providers/${p.id}/test`);
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("60");
      expect(((await limited.json()) as any).error.code).toBe("rate_limited");
      // another client behind the same proxy has its own bucket
      expect((await call("POST", `/api/providers/${p.id}/test`, undefined, "198.51.100.9")).status).toBe(200);
      expectNoKeys(await (await call("GET", "/api/providers")).text());
    } finally {
      Object.assign(globalThis, saved);
      await db.close();
    }
  });
});
