// Exercises the module in isolation via app.request, with a fake CachePort
// standing in for core's real adapter. No Redis, Postgres, S3, or OpenAI
// needs to be running: the module only ever sees the port interface.
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createExampleModule } from "./index";
import type { CachePort } from "./ports";

function createFakeCache(): CachePort {
  const counts = new Map<string, number>();
  return {
    async incr(key: string): Promise<number> {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    async expire(): Promise<void> {},
    async get(key: string): Promise<string | null> {
      const value = counts.get(key);
      return value === undefined ? null : String(value);
    },
  };
}

function buildApp(): Hono {
  const app = new Hono();
  app.route("/example", createExampleModule({ cache: createFakeCache() }));
  return app;
}

describe("example module", () => {
  test("lists items, empty by default", async () => {
    const app = buildApp();
    const res = await app.request("/example");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("creates an item and then lists it", async () => {
    const app = buildApp();
    const created = await app.request("/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "widget" }),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.name).toBe("widget");

    const list = await app.request("/example");
    const items = await list.json();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("widget");
  });

  test("rejects a create request with no name", async () => {
    const app = buildApp();
    const res = await app.request("/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("tracks view counts through the injected cache port", async () => {
    const app = buildApp();
    const first = await app.request("/example/abc/views");
    expect(await first.json()).toEqual({ views: 1 });
    const second = await app.request("/example/abc/views");
    expect(await second.json()).toEqual({ views: 2 });
  });
});
