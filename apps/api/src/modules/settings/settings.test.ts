// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, test } from "bun:test";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import type { AppConfig, ModuleContext } from "../../core/module";
import { createFsBlobStore } from "../../core/adapters/blob-fs";
import { createSettingsModule, DEFAULT_SETTINGS } from "./index";
import { Hono } from "hono";
import { jsonErrorHandler } from "../../core/app";

function wrap(routes: Hono): Hono {
  const app = new Hono();
  app.onError(jsonErrorHandler(silentLogger));
  app.route("/", routes);
  return app;
}

const config: AppConfig = {
  mode: "server",
  version: "test",
  dataDir: "/tmp/mengai-settings-test",
  workspacesDir: "/tmp/mengai-settings-test/ws",
  webDir: null,
  allowedOrigins: [],
  allowedHosts: [],
  controlToken: null,
};

async function setup() {
  const db = await createTestDb();
  const clock = fakeClock();
  const ctx: ModuleContext = {
    config,
    db,
    kv: memoryKv(),
    blob: createFsBlobStore(config.dataDir),
    vault: memoryVault(),
    clock,
    logger: silentLogger,
    events: captureEvents(clock),
  };
  return { db, clock, mod: createSettingsModule(ctx) };
}

describe("settings", () => {
  test("defaults when nothing is stored", async () => {
    const { mod, db } = await setup();
    const s = await mod.service.get();
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.defaultBudgetTokens).toBe(400_000);
    expect(s.defaultBudgetUsd).toBe(5);
    expect(s.maxConcurrentAgents).toBe(4);
    expect(s.allowNetworkTools).toBe(false);
    expect(s.motion).toBe("full");
    expect(s.prices).toEqual({});
    await db.close();
  });

  test("patch persists only the given keys and merges over defaults", async () => {
    const { mod, db } = await setup();
    const out = await mod.service.patch({ maxConcurrentAgents: 6, motion: "calm", prices: { "my-model": { input: 1, cachedInput: 0.5, output: 2 } } });
    expect(out.maxConcurrentAgents).toBe(6);
    expect(out.motion).toBe("calm");
    expect(out.defaultBudgetTokens).toBe(400_000);
    expect(out.prices["my-model"]).toEqual({ input: 1, cachedInput: 0.5, output: 2 });
    const again = await mod.service.patch({ allowNetworkTools: true });
    expect(again.maxConcurrentAgents).toBe(6);
    expect(again.allowNetworkTools).toBe(true);
    const rows = await db.query<{ key: string }>`select key from settings order by key`;
    expect(rows.map((r) => r.key)).toEqual(["allowNetworkTools", "maxConcurrentAgents", "motion", "prices"]);
    await db.close();
  });

  test("service rejects out of range values and unknown keys", async () => {
    const { mod, db } = await setup();
    await expect(mod.service.patch({ maxConcurrentAgents: 99 })).rejects.toThrow();
    await expect(mod.service.patch({ nope: 1 } as never)).rejects.toThrow();
    expect((await mod.service.get()).maxConcurrentAgents).toBe(4);
    await db.close();
  });

  test("the org: CEO Oyen, unlimited cats and depth, a bounded concurrency queue, budget 0 means unlimited", async () => {
    const { mod, db } = await setup();
    const s = await mod.service.get();
    expect(s.ceoName).toBe("Oyen");
    expect(s.maxAgents).toBe(0);
    expect(s.maxDepth).toBe(0);
    expect(s.maxConcurrentAgents).toBe(4);
    const out = await mod.service.patch({ ceoName: "  Mas Oyen ", maxAgents: 12, maxDepth: 3, defaultBudgetTokens: 0, defaultBudgetUsd: 0 });
    expect(out).toMatchObject({ ceoName: "Mas Oyen", maxAgents: 12, maxDepth: 3, defaultBudgetTokens: 0, defaultBudgetUsd: 0 });
    await expect(mod.service.patch({ defaultBudgetTokens: 500 })).rejects.toThrow();
    await expect(mod.service.patch({ ceoName: "" })).rejects.toThrow();
    await expect(mod.service.patch({ ceoName: "Oyen <b>" })).rejects.toThrow();
    await expect(mod.service.patch({ ceoName: "Oyen \u{1F431}" })).rejects.toThrow();
    await expect(mod.service.patch({ ceoName: "x".repeat(25) })).rejects.toThrow();
    await expect(mod.service.patch({ maxAgents: -1 })).rejects.toThrow();
    await expect(mod.service.patch({ maxConcurrentAgents: 0 })).rejects.toThrow();
    expect((await mod.service.get()).ceoName).toBe("Mas Oyen");
    await db.close();
  });

  test("a corrupted stored row falls back to the default", async () => {
    const { mod, db } = await setup();
    await db.query`insert into settings (owner_id, key, value, updated_at) values (${"owner"}, ${"maxConcurrentAgents"}, ${'"lots"'}, ${1})`;
    expect((await mod.service.get()).maxConcurrentAgents).toBe(4);
    await db.close();
  });

  test("routes: GET returns settings, PATCH validates the body", async () => {
    const { mod, db } = await setup();
    const routes = wrap(mod.routes!);
    const get = await routes.request("/");
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(DEFAULT_SETTINGS);
    const bad = await routes.request("/", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ motion: "wild" }) });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("invalid_body");
    const ok = await routes.request("/", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultBudgetUsd: 12.5 }) });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { defaultBudgetUsd: number }).defaultBudgetUsd).toBe(12.5);
    await db.close();
  });
});
