// The local runtime connection layer: loopback-only addresses, where the
// page looks, the pairing link, the per-runtime bearer session, the probe
// that tells "not running" from "not paired", the pairing exchange, the
// bearer header on every call, and the SSE reader for bearer streams.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApiClient, type FetchLike } from "./client";
import { connectRuntime, resetConnectForTests } from "./connect";
import {
  DEFAULT_RUNTIME_URL,
  MAC_DOWNLOAD_URL,
  baseFor,
  clearSessionToken,
  normalizeRuntimeUrl,
  probeRuntime,
  readPairLink,
  readRuntimeSetting,
  readSessionToken,
  runtimeCandidates,
  writeRuntimeSetting,
  writeSessionToken,
} from "./runtime";
import { fetchEventSource, parseSseChunk } from "./sse";

const HEALTH = { ok: true, mode: "local", version: "0.1.0", configured: true, automation: { available: false, accessibility: false, screen: false }, jev: { configured: false } };
const TOKEN = "pair-token-abcdefghijklmnop";
const SESSION = "session-token-0123456789abcdef";

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

  test("the Mac download is the latest release", () => {
    expect(MAC_DOWNLOAD_URL).toBe("https://github.com/Adefebrian/MengAI/releases/latest");
  });
});

describe("pairing links and sessions", () => {
  test("reads #pair, a pasted link, a bare token and #launch; drops a runtime that is not loopback", () => {
    expect(readPairLink(`#pair=${TOKEN}`)).toEqual({ kind: "pair", token: TOKEN, runtime: null });
    expect(readPairLink(`https://mengai.example/app#pair=${TOKEN}&runtime=http%3A%2F%2F127.0.0.1%3A4297`)).toEqual({ kind: "pair", token: TOKEN, runtime: "http://127.0.0.1:4297" });
    expect(readPairLink(`#pair=${TOKEN}&runtime=https://evil.example`)?.runtime).toBeNull();
    expect(readPairLink(TOKEN)).toEqual({ kind: "pair", token: TOKEN, runtime: null });
    expect(readPairLink(`#launch=${TOKEN}`)?.kind).toBe("launch");
    expect(readPairLink("#pair=short")).toBeNull();
    expect(readPairLink("#pair=<script>alert(1)</script>xxxxxxxx")).toBeNull();
  });

  test("one bearer session per runtime origin", () => {
    writeSessionToken("http://127.0.0.1:4190", SESSION);
    writeSessionToken("http://127.0.0.1:4297", `${SESSION}-b`);
    writeSessionToken("http://127.0.0.1:4298", "bad token with spaces");
    expect(readSessionToken("http://127.0.0.1:4190")).toBe(SESSION);
    expect(readSessionToken("http://127.0.0.1:4297")).toBe(`${SESSION}-b`);
    expect(readSessionToken("http://127.0.0.1:4298")).toBeNull();
    clearSessionToken("http://127.0.0.1:4190");
    expect(readSessionToken("http://127.0.0.1:4190")).toBeNull();
    expect(readSessionToken("http://127.0.0.1:4297")).toBe(`${SESSION}-b`);
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
  test("a pairing link is exchanged once for a bearer session, which then signs every call without cookies", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fake: FetchLike = async (url, init) => {
      seen.push({ url, init });
      if (url.endsWith("/api/health")) return json(200, HEALTH);
      if (url.endsWith("/api/auth/pair")) return json(200, { sessionToken: SESSION, origin: "https://mengai.example" });
      if (url.endsWith("/api/session")) {
        const auth = new Headers(init.headers).get("authorization");
        return json(200, { authenticated: auth === `Bearer ${SESSION}`, mode: "local", needsSetup: false });
      }
      return json(404, { error: { code: "not_found", message: "no" } });
    };
    const c = await connectRuntime({ link: { kind: "pair", token: TOKEN, runtime: null }, fetch: fake, candidates: [DEFAULT_RUNTIME_URL] });
    expect(c.kind).toBe("ready");
    expect(readSessionToken(DEFAULT_RUNTIME_URL)).toBe(SESSION);
    const pair = seen.find((s) => s.url.endsWith("/api/auth/pair"))!;
    expect(JSON.parse(String(pair.init.body))).toEqual({ token: TOKEN });
    expect(new Headers(pair.init.headers).get("x-mengai-csrf")).toBe("1");
    const session = seen.find((s) => s.url.endsWith("/api/session"))!;
    expect(session.init.credentials).toBe("omit");
    expect(seen.filter((s) => s.url.endsWith("/api/auth/pair")).length).toBe(1);
  });

  test("offline when nothing answers; unpaired when the runtime answers but refuses this origin", async () => {
    const down: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await connectRuntime({ fetch: down, candidates: [DEFAULT_RUNTIME_URL] })).toEqual({ kind: "offline", tried: [DEFAULT_RUNTIME_URL] });

    const closed: FetchLike = async (_u, init) => {
      if (init.mode === "no-cors") return new Response(null, { status: 200 });
      throw new TypeError("Failed to fetch");
    };
    const c = await connectRuntime({ fetch: closed, candidates: [DEFAULT_RUNTIME_URL] });
    expect(c.kind).toBe("unpaired");
  });

  test("a used pairing link says so, and a stale session token is dropped", async () => {
    writeSessionToken(DEFAULT_RUNTIME_URL, SESSION);
    const fake: FetchLike = async (url) => {
      if (url.endsWith("/api/health")) return json(200, HEALTH);
      if (url.endsWith("/api/auth/pair")) return json(401, { error: { code: "bad_token", message: "Pairing token is not valid" } });
      return json(200, { authenticated: false, mode: "local", needsSetup: false });
    };
    const c = await connectRuntime({ link: { kind: "pair", token: TOKEN, runtime: null }, fetch: fake, candidates: [DEFAULT_RUNTIME_URL] });
    expect(c.kind).toBe("unpaired");
    if (c.kind === "unpaired") expect(c.error).toContain("used already");
    expect(readSessionToken(DEFAULT_RUNTIME_URL)).toBeNull();
  });
});

describe("client", () => {
  test("same origin sends cookies; a cross-origin runtime sends the bearer token and no cookies; a lost session calls back", async () => {
    const seen: RequestInit[] = [];
    const fake: FetchLike = async (_u, init) => {
      seen.push(init);
      return json(401, { error: { code: "unauthenticated", message: "Sign in first" } });
    };
    let lost = 0;
    const local = createApiClient({ fetch: fake });
    await local.call("GET /api/runs").catch(() => {});
    expect(seen[0]!.credentials).toBe("include");
    expect(new Headers(seen[0]!.headers).get("authorization")).toBeNull();

    const remote = createApiClient({ base: DEFAULT_RUNTIME_URL, fetch: fake, token: () => SESSION, onUnauthenticated: () => (lost += 1) });
    await remote.call("GET /api/runs").catch(() => {});
    expect(seen[1]!.credentials).toBe("omit");
    expect(new Headers(seen[1]!.headers).get("authorization")).toBe(`Bearer ${SESSION}`);
    expect(lost).toBe(1);
  });
});

describe("media from the runtime", () => {
  test("same origin keeps the path; a cross-origin runtime is read with the bearer token into a blob url", async () => {
    let auth: string | null = null;
    const fake: FetchLike = async (_u, init) => {
      auth = new Headers(init.headers).get("authorization");
      return new Response(new Blob(["png"], { type: "image/png" }), { status: 200 });
    };
    const local = await createApiClient({ fetch: fake }).media("/api/assets/a1/file");
    expect(local.src).toBe("/api/assets/a1/file");
    const remote = await createApiClient({ base: DEFAULT_RUNTIME_URL, fetch: fake, token: () => SESSION }).media("/api/assets/a1/file");
    expect(remote.src.startsWith("blob:")).toBe(true);
    expect(auth as string | null).toBe(`Bearer ${SESSION}`);
    remote.revoke();
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

  test("streams with the bearer header and closes on a drop so the store reopens after lastSeq", async () => {
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
    const es = fetchEventSource(`${DEFAULT_RUNTIME_URL}/api/events?after=0`, { headers: { authorization: `Bearer ${SESSION}` }, credentials: "omit", fetch: fake });
    const closed = new Promise<void>((resolve) => {
      es.onerror = () => resolve();
    });
    es.addEventListener("mengai", (m) => frames.push(String(m.data)));
    await closed;
    expect(headers!.get("authorization")).toBe(`Bearer ${SESSION}`);
    expect(frames).toEqual(['{"seq":1}']);
    expect(es.readyState).toBe(2);
  });
});
