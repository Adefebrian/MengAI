// apps/web/src/server.test.ts
//
// Regression test for a real bug found while building docs-site/server.ts
// and folded back into this template's own server.ts: hono's serve-static
// join() silently drops the leading slash off an absolute `path` option
// when `root` is left at its "./" default, turning the SPA fallback route
// into a request for a path that never exists, so it falls through to a
// plain 404 instead of index.html (verified directly against
// hono@4.13.3's src/middleware/serve-static/path.js). server.ts works
// around it by passing the same `root` to both serveStatic calls instead
// of an absolute `path`. This test exercises the built server through
// real fetches so that fix cannot regress unnoticed.
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

describe("web server", () => {
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    // apps/web's bunfig.toml preloads happy-dom globally so App.test.tsx can
    // render React components under `bun test`. happy-dom's patched fetch
    // cannot talk to a real Bun.serve() listener (same conflict
    // src/smoke.test.ts works around), so undo the patch for the lifetime of
    // this suite and restore it afterwards for any tests that run after.
    GlobalRegistrator.unregister();

    const distIndex = new URL("../dist/index.html", import.meta.url);
    if (!existsSync(distIndex)) {
      await import("../build");
    }
    const { default: app } = await import("../server");
    server = Bun.serve({ fetch: app.fetch, port: 0 });
  });

  afterAll(() => {
    server?.stop();
    GlobalRegistrator.register();
  });

  test("serves the built index.html at /", async () => {
    const res = await fetch(`http://localhost:${server.port}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<title>MengAI");
  });

  test("falls back to index.html for an unknown deep link, not a 404", async () => {
    const res = await fetch(`http://localhost:${server.port}/some/unknown/deep-link`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<title>MengAI");
  });
});
