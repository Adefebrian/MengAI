// The local engine connection layer: loopback-only addresses, where the
// page looks, the probe that tells "not running" from "refuses this site",
// the look that needs no sign in, a client that never carries a token or a
// cookie across origins and sends every write as JSON, and the SSE reader.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApiClient, type FetchLike } from "./client";
import { connectRuntime, resetConnectForTests } from "./connect";
import { DEFAULT_RUNTIME_URL, MAC_DOWNLOAD_URL, baseFor, normalizeRuntimeUrl, probeRuntime, readRuntimeSetting, runtimeCandidates, writeRuntimeSetting } from "./runtime";
import { fetchEventSource, parseSseChunk } from "./sse";

const HEALTH = { ok: true, mode: "local", version: "0.1.0", configured: true, automation: { available: false, accessibility: false, screen: false }, jev: { configured: false } };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  localStorage.clear();
  resetConnectForTests();
});
afterEach(() => localStorage.clear());

describe("runtime addresses", () => {
  test("only loopback http(s) addresses are accepted, as origins", () => {
    expect(normalizeRuntimeUrl("127.0.0.1:4190")).toBe("http://127.0.0.1:4190");
    expect(normalizeRuntimeUrl("http://localhost:5000/app/x")).toBe("http://localhost:5000");
    expect(normalizeRuntimeUrl("https://[::1]:4190")).toBe("https://[::1]:4190");
    for (const bad of ["https://evil.example", "http://192.168.1.4:4190", "ftp://127.0.0.1", "http://user:pw@127.0.0.1:4190", "javascript:alert(1)", ""]) {
      expect(normalizeRuntimeUrl(bad)).toBeNull();
    }
  });

  test("the website looks at 127.0.0.1:4190, a page on this machine looks at itself first, a saved address wins", () => {
    expect(runtimeCandidates({ origin: "https://mengai.example", hostname: "mengai.example" }, null)).toEqual([DEFAULT_RUNTIME_URL]);
    expect(runtimeCandidates({ origin: "http://127.0.0.1:4190", hostname: "127.0.0.1" }, null)).toEqual([""]);
    expect(runtimeCandidates({ origin: "http://localhost:3000", hostname: "localhost" }, null)).toEqual(["", DEFAULT_RUNTIME_URL]);
    expect(runtimeCandidates({ origin: "https://mengai.example", hostname: "mengai.example" }, "http://127.0.0.1:4297")).toEqual(["http://127.0.0.1:4297"]);
    expect(baseFor("http://127.0.0.1:4297", { origin: "http://127.0.0.1:4297", hostname: "127.0.0.1" })).toBe("");
  });

  test("the saved address refuses anything off this machine", () => {
    writeRuntimeSetting("https://evil.example");
    expect(readRuntimeSetting()).toBeNull();
    writeRuntimeSetting("localhost:4297");
    expect(readRuntimeSetting()).toBe("http://localhost:4297");
    writeRuntimeSetting(null);
    expect(readRuntimeSetting()).toBeNull();
  });

  test("the Mac download is the v0.1.0 beta prerelease, not releases/latest", () => {
    expect(MAC_DOWNLOAD_URL).toBe("https://github.com/Adefebrian/MengAI/releases/tag/v0.1.0-beta");
  });
});

describe("probe", () => {
  test("open when health reads, closed when only an opaque request answers, down when nothing does", async () => {
    const open: FetchLike = async () => json(200, HEALTH);
    expect((await probeRuntime(DEFAULT_RUNTIME_URL, { fetch: open })).state).toBe("open");

    const corsRefused: FetchLike = async (_u, init) => {
      if (init.mode === "no-cors") return new Response(null, { status: 200 });
      throw new TypeError("Failed to fetch");
    };
    expect((await probeRuntime(DEFAULT_RUNTIME_URL, { fetch: corsRefused })).state).toBe("closed");

    const down: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect((await probeRuntime(DEFAULT_RUNTIME_URL, { fetch: down })).state).toBe("down");

    // a static page server that answers /api/health with index.html is not the runtime
    const spa: FetchLike = async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } });
    expect((await probeRuntime("", { fetch: spa })).state).toBe("down");
  });
});

describe("connect", () => {
  test("ready as soon as health reads: no sign in, no token, no session call", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fake: FetchLike = async (url, init) => {
      seen.push({ url, init });
      if (url.endsWith("/api/health")) return json(200, HEALTH);
      return json(404, { error: { code: "not_found", message: "no" } });
    };
    const c = await connectRuntime({ fetch: fake, candidates: [DEFAULT_RUNTIME_URL] });
    expect(c.kind).toBe("ready");
    if (c.kind === "ready") expect(c.health.version).toBe("0.1.0");
    expect(seen.map((s) => s.url)).toEqual([`${DEFAULT_RUNTIME_URL}/api/health`]);
    expect(seen[0]!.init.credentials).toBe("omit");
    expect(new Headers(seen[0]!.init.headers).get("authorization")).toBeNull();
  });

  test("offline when nothing answers; refused when the engine answers but not this site", async () => {
    const down: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await connectRuntime({ fetch: down, candidates: [DEFAULT_RUNTIME_URL] })).toEqual({ kind: "offline", tried: [DEFAULT_RUNTIME_URL] });

    const closed: FetchLike = async (_u, init) => {
      if (init.mode === "no-cors") return new Response(null, { status: 200 });
      throw new TypeError("Failed to fetch");
    };
    expect(await connectRuntime({ fetch: closed, candidates: [DEFAULT_RUNTIME_URL] })).toEqual({ kind: "refused", base: DEFAULT_RUNTIME_URL });
  });

  test("a later candidate that answers wins over one that refuses", async () => {
    const fake: FetchLike = async (url, init) => {
      if (url.startsWith("http://127.0.0.1:4297")) return json(200, HEALTH);
      if (init.mode === "no-cors") return new Response(null, { status: 200 });
      throw new TypeError("Failed to fetch");
    };
    const c = await connectRuntime({ fetch: fake, candidates: [DEFAULT_RUNTIME_URL, "http://127.0.0.1:4297"] });
    expect(c).toMatchObject({ kind: "ready", base: "http://127.0.0.1:4297" });
  });
});

describe("client", () => {
  test("never a token or a cookie across origins; every write is JSON with the CSRF header, even with no body", async () => {
    const seen: RequestInit[] = [];
    const fake: FetchLike = async (_u, init) => {
      seen.push(init);
      return json(200, { ok: true });
    };
    const local = createApiClient({ fetch: fake });
    await local.call("GET /api/runs");
    expect(seen[0]!.credentials).toBe("same-origin");
    expect(new Headers(seen[0]!.headers).get("content-type")).toBeNull();

    const remote = createApiClient({ base: DEFAULT_RUNTIME_URL, fetch: fake });
    await remote.call("POST /api/projects/:id/reveal", { params: { id: "p1" } });
    const reveal = new Headers(seen[1]!.headers);
    expect(seen[1]!.credentials).toBe("omit");
    expect(reveal.get("authorization")).toBeNull();
    expect(reveal.get("content-type")).toBe("application/json");
    expect(reveal.get("x-mengai-csrf")).toBe("1");
    expect(seen[1]!.body).toBeUndefined();

    await remote.call("POST /api/projects/:id/preview", { params: { id: "p1" }, body: { restart: true } });
    expect(new Headers(seen[2]!.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(seen[2]!.body))).toEqual({ restart: true });
    await remote.call("DELETE /api/projects/:id/preview", { params: { id: "p1" } });
    expect(new Headers(seen[3]!.headers).get("content-type")).toBe("application/json");
  });

  test("an engine file resolves to the engine origin from the website, to its own path on the engine page", () => {
    expect(createApiClient().resolve("/api/assets/a1/file")).toBe("/api/assets/a1/file");
    expect(createApiClient({ base: DEFAULT_RUNTIME_URL }).resolve("/api/assets/a1/file")).toBe(`${DEFAULT_RUNTIME_URL}/api/assets/a1/file`);
    expect(createApiClient({ base: DEFAULT_RUNTIME_URL }).resolve("https://cdn.example/x.png")).toBe("https://cdn.example/x.png");
  });
});

describe("sse over fetch", () => {
  test("parses named frames split across chunks, with ids and multi-line data", () => {
    const got: Array<[string, string, string | null]> = [];
    let rest = parseSseChunk("event: mengai\nid: 4\ndata: {\"a\"", (e, d, id) => got.push([e, d, id]));
    expect(got.length).toBe(0);
    rest = parseSseChunk(rest + ":1}\n\n: keepalive\n\ndata: one\ndata: two\n\n", (e, d, id) => got.push([e, d, id]));
    expect(rest).toBe("");
    expect(got).toEqual([
      ["mengai", '{"a":1}', "4"],
      ["message", "one\ntwo", null],
    ]);
  });

  test("streams with no Authorization header and closes on a drop so the store reopens after lastSeq", async () => {
    let headers: Headers | null = null;
    const fake: FetchLike = async (_u, init) => {
      headers = new Headers(init.headers);
      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(new TextEncoder().encode('event: mengai\ndata: {"seq":1}\n\n'));
          ctrl.close();
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const frames: string[] = [];
    const es = fetchEventSource(`${DEFAULT_RUNTIME_URL}/api/events?after=0`, { headers: {}, credentials: "omit", fetch: fake });
    const closed = new Promise<void>((resolve) => {
      es.onerror = () => resolve();
    });
    es.addEventListener("mengai", (m) => frames.push(String(m.data)));
    await closed;
    expect(headers!.get("authorization")).toBeNull();
    expect(headers!.get("accept")).toBe("text/event-stream");
    expect(frames).toEqual(['{"seq":1}']);
    expect(es.readyState).toBe(2);
  });
});
