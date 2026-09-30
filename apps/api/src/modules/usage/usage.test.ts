// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// usage module: cost math with overrides, persistence, redaction of errors,
// listCalls ordering and the GET /api/usage aggregate (byModel, byRole).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ModelPrice, OwnerSettings, UsageReport } from "@mengai/shared";
import { Hono } from "hono";
import type { AppConfig, ModuleContext } from "../../core/module";
import type { BlobStore } from "../../core/ports/blob";
import type { Db } from "../../core/ports/db";
import type { RecordCallInput, SettingsService } from "../../core/services";
import { errorBody, HttpError } from "../../lib/http";
import { REDACTED, registerSecret } from "../../lib/redact";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { createUsageModule } from "./index";

const noBlob: BlobStore = {
  async put(key) {
    return { key, size: 0 };
  },
  async get() {
    return null;
  },
  async delete() {},
  async exists() {
    return false;
  },
};

function settingsWith(prices: Record<string, ModelPrice>): SettingsService & { prices: Record<string, ModelPrice> } {
  const s = {
    prices,
    async get(): Promise<OwnerSettings> {
      return { defaultBudgetTokens: 400_000, defaultBudgetUsd: 5, maxConcurrentAgents: 4, allowNetworkTools: false, motion: "full", prices: s.prices };
    },
    async patch(): Promise<OwnerSettings> {
      return s.get();
    },
  };
  return s;
}

const base = (over: Partial<RecordCallInput>): RecordCallInput => ({
  runId: "run-1",
  agentId: null,
  taskId: null,
  providerId: "prov-1",
  model: "gpt-4o-mini",
  purpose: "step",
  usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 },
  latencyMs: 100,
  retries: 0,
  ok: true,
  error: null,
  ...over,
});

let db: Db;
let clock: ReturnType<typeof fakeClock>;
let settings: ReturnType<typeof settingsWith>;
let mod: ReturnType<typeof createUsageModule>;
let app: Hono;

beforeEach(async () => {
  db = await createTestDb();
  clock = fakeClock();
  settings = settingsWith({});
  const config: AppConfig = { mode: "local", version: "test", dataDir: "/tmp/m", workspacesDir: "/tmp/m/ws", webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null };
  const ctx: ModuleContext = { config, db, kv: memoryKv(), blob: noBlob, vault: memoryVault(), clock, logger: silentLogger, events: captureEvents(clock) };
  mod = createUsageModule(ctx, { settings });
  app = new Hono();
  app.onError((err, c) => (err instanceof HttpError ? c.json(errorBody(err.code, err.message), err.status) : c.json(errorBody("internal", String(err)), 500)));
  app.route(`/api/${mod.mountPath}`, mod.routes!);
});

afterEach(async () => {
  await db.close();
});

describe("cost math", () => {
  test("gpt-4o-mini with cached input", async () => {
    const c = await mod.service.record(base({ usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 500_000, cacheWriteTokens: 0 } }));
    // 500k uncached * 0.15 + 500k cached * 0.075 + 1M out * 0.6, per 1M tokens
    expect(c.costUsd).toBeCloseTo(0.075 + 0.0375 + 0.6, 10);
  });

  test("anthropic cache writes and reads priced separately", async () => {
    const cost = await mod.service.cost("claude-sonnet-5-5", { inputTokens: 1300, outputTokens: 100, cachedTokens: 1000, cacheWriteTokens: 200 });
    expect(cost).toBeCloseTo((100 * 3 + 1000 * 0.3 + 200 * 3.75 + 100 * 15) / 1_000_000, 12);
  });

  test("owner price overrides from settings win; unknown models cost 0", async () => {
    settings.prices = { "gpt-4o-mini": { input: 1, cachedInput: 0.5, output: 2 } };
    expect(await mod.service.cost("gpt-4o-mini", { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(3, 10);
    expect(await mod.service.cost("openai/gpt-4o-mini", { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 1_000_000, cacheWriteTokens: 0 })).toBeCloseTo(0.5, 10);
    expect(await mod.service.cost("totally-unknown-model", { inputTokens: 5000, outputTokens: 5000, cachedTokens: 0, cacheWriteTokens: 0 })).toBe(0);
    const prices = await mod.service.prices();
    expect(prices["gpt-4o-mini"]).toEqual({ input: 1, cachedInput: 0.5, output: 2 });
    expect(prices["gpt-4.1"]).toBeDefined();
  });

  test("settings failure falls back to default prices", async () => {
    settings.get = async () => {
      throw new Error("db down");
    };
    expect(await mod.service.cost("gpt-4o-mini", { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(0.15, 10);
  });
});

describe("record and listCalls", () => {
  test("persists, clamps bad numbers, redacts errors, lists in order", async () => {
    registerSecret("sk-live-usage-secret-0123456789");
    const a = await mod.service.record(base({ usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 400, cacheWriteTokens: 0 }, retries: 2 }));
    clock.advance(10);
    const b = await mod.service.record(base({ ok: false, error: "401 bad key sk-live-usage-secret-0123456789", usage: { inputTokens: -5, outputTokens: Number.NaN, cachedTokens: 0, cacheWriteTokens: 0 } }));
    await mod.service.record(base({ runId: "run-2" }));
    expect(a.cachedTokens).toBe(100);
    expect(b.inputTokens).toBe(0);
    expect(b.outputTokens).toBe(0);
    expect(b.error).toBe(`401 bad key ${REDACTED}`);
    const list = await mod.service.listCalls("run-1");
    expect(list.map((c) => c.id)).toEqual([a.id, b.id]);
    expect(list[0]).toEqual(a);
    expect(list[1]!.ok).toBe(false);
    expect(list[0]!.retries).toBe(2);
    const raw = await db.query`select error from llm_calls where id = ${b.id}`;
    expect(JSON.stringify(raw)).not.toContain("sk-live-usage-secret-0123456789");
  });
});

describe("GET /api/usage", () => {
  async function seed() {
    await db.query`insert into agents (id, run_id, role, name, coat, seed, tier, status, activity, mood, created_at, updated_at) values (${"ag-eng"}, ${"run-1"}, ${"engineer"}, ${"Kopi"}, ${"ginger"}, ${1}, ${"fast"}, ${"idle"}, ${"rest"}, ${"calm"}, ${1}, ${1})`;
    await db.query`insert into agents (id, run_id, role, name, coat, seed, tier, status, activity, mood, created_at, updated_at) values (${"ag-rev"}, ${"run-1"}, ${"reviewer"}, ${"Mochi"}, ${"tabby"}, ${2}, ${"deep"}, ${"idle"}, ${"rest"}, ${"calm"}, ${1}, ${1})`;
    await mod.service.record(base({ agentId: "ag-eng", usage: { inputTokens: 1000, outputTokens: 100, cachedTokens: 800, cacheWriteTokens: 0 } }));
    await mod.service.record(base({ agentId: "ag-eng", usage: { inputTokens: 1000, outputTokens: 100, cachedTokens: 200, cacheWriteTokens: 0 } }));
    await mod.service.record(base({ agentId: "ag-rev", model: "claude-sonnet-5-5", usage: { inputTokens: 2000, outputTokens: 50, cachedTokens: 0, cacheWriteTokens: 500 } }));
    clock.advance(1000);
    await mod.service.record(base({ runId: "run-2", agentId: null, usage: { inputTokens: 1000, outputTokens: 0, cachedTokens: 1000, cacheWriteTokens: 0 } }));
  }

  test("totals, cacheHitRate, byModel and byRole", async () => {
    await seed();
    const all = (await (await app.request("/api/usage")).json()) as UsageReport;
    expect(all.totals).toMatchObject({ inputTokens: 5000, outputTokens: 250, cachedTokens: 2000, cacheWriteTokens: 500, calls: 4 });
    expect(all.cacheHitRate).toBe(0.4);
    expect(all.byModel.map((m) => [m.model, m.calls])).toEqual([
      ["claude-sonnet-5-5", 1],
      ["gpt-4o-mini", 3],
    ]);
    expect(all.byRole.map((r) => [r.role, r.calls, r.inputTokens])).toEqual([
      ["engineer", 2, 2000],
      ["reviewer", 1, 2000],
    ]);
    const sum = all.byModel.reduce((s, m) => s + m.costUsd, 0);
    expect(all.totals.costUsd).toBeCloseTo(sum, 12);

    const run1 = (await (await app.request("/api/usage?runId=run-1")).json()) as UsageReport;
    expect(run1.totals.calls).toBe(3);
    expect(run1.cacheHitRate).toBe(0.25);
    const since = (await (await app.request(`/api/usage?from=${clock.now()}`)).json()) as UsageReport;
    expect(since.totals.calls).toBe(1);
  });

  test("empty report and query validation", async () => {
    const empty = (await (await app.request("/api/usage")).json()) as UsageReport;
    expect(empty).toEqual({ totals: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0, calls: 0 }, cacheHitRate: 0, byModel: [], byRole: [] });
    expect((await app.request("/api/usage?from=10&to=5")).status).toBe(400);
    expect((await app.request("/api/usage?runId=bad%20id")).status).toBe(422);
    expect((await app.request("/api/usage?from=abc")).status).toBe(422);
    expect((await app.request("/api/usage?other=1")).status).toBe(422);
  });
});
