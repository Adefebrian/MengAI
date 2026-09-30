// Platform tests: config, hardening, auth flows through the full app, the
// local-first bridge (pairing, bearer sessions, paired-origin CORS, Private
// Network Access), SSE through the app, kill switch, and the kv / vault /
// blob / logger adapters.
// Deterministic and offline: in-memory SQLite, fake ports, app.fetch().
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "@mengai/config";
import { CONTROL_TOKEN_HEADER, CSRF_HEADER, SESSION_COOKIE, SSE_EVENT_NAME, type MengaiEvent, type SessionDTO } from "@mengai/shared";
import { Hono } from "hono";
import { createFsBlobStore, sanitizeBlobKey } from "./core/adapters/blob-fs";
import { createMemoryKv } from "./core/adapters/kv-memory";
import { createJsonLogger } from "./core/adapters/logger";
import { createKeychainVault, type SecretsApi } from "./core/adapters/vault-keychain";
import { createEnvelopeVault } from "./core/adapters/vault-envelope";
import { createApp } from "./core/app";
import type { SessionAuth } from "./core/auth";
import { bootstrap, type Platform } from "./core/bootstrap";
import { buildConfig, defaultLocalDataDir, pairUrl, type BootConfig } from "./core/config";
import { createKillSwitch } from "./core/killswitch";
import type { AppConfig, MountedModule } from "./core/module";
import type { Db } from "./core/ports/db";
import { readyLine, startLocal } from "./local";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "./testing";

const KEK = Buffer.from(new Uint8Array(32).map((_, i) => i + 1)).toString("base64");
const SETUP_CODE = "setup-code-for-tests-123";
const temps: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mengai-platform-"));
  temps.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

interface ReqOpts {
  method?: string;
  body?: unknown;
  rawBody?: string;
  cookie?: string;
  origin?: string | null;
  csrf?: boolean;
  headers?: Record<string, string>;
}

// The root bunfig preloads happy-dom for the web tests, which replaces the
// global Request with a browser one that drops forbidden headers (Origin,
// Cookie). Requests here are built with Bun's native Request instead and sent
// straight to app.fetch, with an explicit content-length.
const native = (await import(String("undici"))) as { Request: typeof Request; Response: typeof Response; Headers: typeof Headers };
const NativeRequest = native.Request;
// Responses are built by Hono with the global Response; the browser one
// hides Set-Cookie. Use Bun's native classes while this file runs.
const savedFetchGlobals = { Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers };
beforeAll(() => {
  Object.assign(globalThis, { Request: native.Request, Response: native.Response, Headers: native.Headers });
});
afterAll(() => {
  Object.assign(globalThis, savedFetchGlobals);
});

function call(app: Hono, url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  const full = /^https?:\/\//.test(url) ? url : `http://localhost${url}`;
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body !== undefined) headers["content-length"] = String(Buffer.byteLength(init.body));
  return Promise.resolve(app.fetch(new NativeRequest(full, { method: init.method ?? "GET", headers, body: init.body })));
}

function req(app: Hono, url: string, o: ReqOpts = {}): Promise<Response> {
  const method = o.method ?? (o.body !== undefined || o.rawBody !== undefined ? "POST" : "GET");
  const base = url.startsWith("http") ? new URL(url).origin : "http://localhost";
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (method !== "GET" && method !== "HEAD") {
    if (o.origin !== null) headers.origin = o.origin ?? base;
    if (o.csrf !== false) headers[CSRF_HEADER] = "1";
  }
  if (o.cookie) headers.cookie = `${SESSION_COOKIE}=${o.cookie}`;
  let body: string | undefined;
  if (o.rawBody !== undefined) body = o.rawBody;
  else if (o.body !== undefined) {
    body = JSON.stringify(o.body);
    headers["content-type"] = "application/json";
  }
  return call(app, url, { method, headers, body });
}

const sessionToken = (res: Response) => new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(res.headers.getSetCookie().join(", "))?.[1] ?? "";

async function serverPlatform(extra: Record<string, string> = {}): Promise<{ platform: Platform; boot: BootConfig }> {
  const dataDir = await tempDir();
  const boot = buildConfig(
    parseEnv({
      MENGAI_MODE: "server",
      DATABASE_URL: "sqlite://:memory:",
      VAULT_KEK: KEK,
      SETUP_CODE,
      ALLOWED_ORIGINS: "https://app.example.com",
      DATA_DIR: dataDir,
      ...extra,
    }),
  );
  const platform = await bootstrap({
    boot,
    logger: silentLogger,
    overrides: { db: await createTestDb(), kv: memoryKv(), vault: memoryVault() },
  });
  return { platform, boot };
}

async function ownerSession(app: Hono): Promise<string> {
  const res = await req(app, "/api/auth/setup", { body: { email: "owner@example.com", password: "a-long-password-1", setupCode: SETUP_CODE } });
  expect(res.status).toBe(200);
  return sessionToken(res);
}

// ------------------------------------------------------------------- config
describe("config", () => {
  test("server mode requires VAULT_KEK and DATABASE_URL and rejects wildcard origins", () => {
    expect(() => parseEnv({ MENGAI_MODE: "server" })).toThrow(/VAULT_KEK is required/);
    expect(() => parseEnv({ MENGAI_MODE: "server", VAULT_KEK: KEK })).toThrow(/DATABASE_URL is required/);
    expect(() => parseEnv({ MENGAI_MODE: "server", VAULT_KEK: "c2hvcnQ=", DATABASE_URL: "postgres://h/db" })).toThrow(/32 bytes/);
    expect(() => parseEnv({ MENGAI_MODE: "server", VAULT_KEK: KEK, DATABASE_URL: "postgres://h/db", ALLOWED_ORIGINS: "*" })).toThrow(/exact origin/);
    expect(() => parseEnv({ MENGAI_MODE: "server", VAULT_KEK: KEK, DATABASE_URL: "postgres://h/db", ALLOWED_ORIGINS: "https://a.example.com/path" })).toThrow(/exact origin/);
    const env = parseEnv({ MENGAI_MODE: "server", VAULT_KEK: KEK, DATABASE_URL: "postgres://u:p@h:5432/db", ALLOWED_ORIGINS: "https://a.example.com, https://b.example.com" });
    const boot = buildConfig(env);
    expect(boot.app.allowedOrigins).toEqual(["https://a.example.com", "https://b.example.com"]);
    expect(boot.port).toBe(3001);
    expect(boot.host).toBe("0.0.0.0");
    expect(boot.vaultKek?.byteLength).toBe(32);
    expect(boot.app.controlToken).toBeNull();
  });

  test("error messages never echo secret values", () => {
    try {
      parseEnv({ MENGAI_MODE: "server", VAULT_KEK: "not-a-valid-kek-value-xyz", DATABASE_URL: "postgres://h/db" });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as Error).message).not.toContain("not-a-valid-kek-value-xyz");
    }
  });

  test("local mode defaults: app support dir, sqlite, loopback, random port, control token", () => {
    const boot = buildConfig(parseEnv({ MENGAI_MODE: "local" }), { home: "/Users/cat" });
    expect(boot.app.dataDir).toBe(defaultLocalDataDir("/Users/cat"));
    expect(boot.app.dataDir).toBe("/Users/cat/Library/Application Support/MengAI");
    expect(boot.databaseUrl).toBe("sqlite:///Users/cat/Library/Application Support/MengAI/app.db");
    expect(boot.host).toBe("127.0.0.1");
    expect(boot.port).toBe(0);
    expect(boot.redisUrl).toBeNull();
    expect(boot.s3).toBeNull();
    expect(boot.app.controlToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const pinned = buildConfig(parseEnv({ MENGAI_MODE: "local", MENGAI_PORT: "4555", MENGAI_DATA_DIR: "/tmp/m", MENGAI_WEB_DIR: "/tmp/w" }));
    expect(pinned.port).toBe(4555);
    expect(pinned.app.dataDir).toBe("/tmp/m");
    expect(pinned.app.webDir).toBe("/tmp/w");
    expect(() => parseEnv({ MENGAI_MODE: "local", HOST: "0.0.0.0" })).toThrow(/loopback/);
  });

  test("MENGAI_SITE_URL is an exact origin and shapes the pairing link", () => {
    expect(buildConfig(parseEnv({ MENGAI_MODE: "local" })).siteUrl).toBeNull();
    expect(buildConfig(parseEnv({ MENGAI_MODE: "local", MENGAI_SITE_URL: " https://mengai.example/ " })).siteUrl).toBe("https://mengai.example");
    for (const bad of ["https://mengai.example/app", "*", "https://*.example", "ftp://mengai.example", "mengai.example"]) {
      expect(() => parseEnv({ MENGAI_MODE: "local", MENGAI_SITE_URL: bad })).toThrow(/MENGAI_SITE_URL must be an exact origin/);
    }
    const token = "t".repeat(43);
    expect(pairUrl({ siteUrl: "https://mengai.example", localUrl: "http://127.0.0.1:4190", token })).toBe(
      `https://mengai.example/app#pair=${token}&runtime=http%3A%2F%2F127.0.0.1%3A4190`,
    );
    expect(pairUrl({ siteUrl: null, localUrl: "http://127.0.0.1:4190", token })).toBe(`http://127.0.0.1:4190/app#pair=${token}&runtime=http%3A%2F%2F127.0.0.1%3A4190`);
  });
});

// ---------------------------------------------------------------- hardening
describe("hardening", () => {
  test("strict CSP and the secure header set on every response", async () => {
    const { platform } = await serverPlatform();
    const res = await req(platform.app, "/api/health");
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const unauth = await req(platform.app, "/api/settings");
    expect(unauth.headers.get("content-security-policy")).toContain("default-src 'self'");
    await platform.close();
  });

  test("foreign Origin, missing Origin and missing CSRF header are rejected on mutating requests", async () => {
    const { platform } = await serverPlatform();
    const body = { email: "a@example.com", password: "whatever-password" };
    const foreign = await req(platform.app, "/api/auth/login", { body, origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe("bad_origin");
    const noOrigin = await req(platform.app, "/api/auth/login", { body, origin: null });
    expect(noOrigin.status).toBe(403);
    const noCsrf = await req(platform.app, "/api/auth/login", { body, csrf: false });
    expect(noCsrf.status).toBe(403);
    expect(((await noCsrf.json()) as { error: { code: string } }).error.code).toBe("csrf_required");
    const allowlisted = await req(platform.app, "/api/auth/login", { body, origin: "https://app.example.com" });
    expect(allowlisted.status).toBe(401);
    const sameOrigin = await req(platform.app, "/api/auth/login", { body });
    expect(sameOrigin.status).toBe(401);
    await platform.close();
  });

  test("CORS answers only allowlisted origins, exact match, with credentials", async () => {
    const { platform } = await serverPlatform();
    const ok = await call(platform.app, "/api/health", { headers: { origin: "https://app.example.com" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
    const evil = await call(platform.app, "/api/health", { headers: { origin: "https://app.example.com.evil.example" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const preflight = await call(platform.app, "/api/settings", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "PATCH" },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
    await platform.close();
  });

  test("body cap: 413 over 1 MB, 25 MB allowed under /api/assets", async () => {
    const { platform } = await serverPlatform();
    const big = "x".repeat(1024 * 1024 + 10);
    const res = await req(platform.app, "/api/settings", { method: "PATCH", rawBody: big, headers: { "content-type": "application/json" } });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("payload_too_large");
    const asset = await req(platform.app, "/api/assets", { method: "POST", rawBody: "y".repeat(2 * 1024 * 1024), headers: { "content-type": "application/json" } });
    expect(asset.status).not.toBe(413);
    await platform.close();
  });

  test("session guard: /api needs a session except health, auth and session", async () => {
    const { platform } = await serverPlatform();
    const app = platform.app;
    expect((await req(app, "/api/settings")).status).toBe(401);
    expect((await req(app, "/api/events")).status).toBe(401);
    expect((await req(app, "/api/nope")).status).toBe(401);
    expect((await req(app, "/api/killswitch", { body: {} })).status).toBe(401);
    expect((await req(app, "/api/health")).status).toBe(200);
    const session = (await (await req(app, "/api/session")).json()) as SessionDTO;
    expect(session).toEqual({ authenticated: false, mode: "server", needsSetup: true });
    const token = await ownerSession(app);
    expect((await req(app, "/api/settings", { cookie: token })).status).toBe(200);
    const unknown = await req(app, "/api/nope", { cookie: token });
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("content-type")).toContain("application/json");
    await platform.close();
  });

  test("rate limit per route pattern and client ip; X-Forwarded-For rotation does not reset it", async () => {
    const config: AppConfig = { mode: "server", version: "t", dataDir: "/tmp", workspacesDir: "/tmp", webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null };
    const auth: SessionAuth = {
      authenticate: async () => ({ sessionId: "s", userId: "owner", email: "o@example.com" }),
      session: async () => ({ authenticated: true, mode: "server", needsSetup: false }),
    };
    const items: MountedModule = { name: "items", routes: new Hono().get("/:id", (c) => c.json({ id: c.req.param("id") })) };
    const make = (trustProxy: number) =>
      createApp({ config, modules: [items], auth, killswitch: createKillSwitch({ events: captureEvents(), logger: silentLogger }), kv: createMemoryKv(), logger: silentLogger, trustProxy, limits: { apiMax: 3 } });

    const app = make(0);
    for (let i = 0; i < 3; i++) expect((await call(app, `/api/items/${i}?q=${i}`, { headers: { "x-forwarded-for": `10.0.0.${i}` } })).status).toBe(200);
    const blocked = await call(app, "/api/items/99", { headers: { "x-forwarded-for": "10.9.9.9" } });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");

    const proxied = make(1);
    for (let i = 0; i < 3; i++) expect((await call(proxied, `/api/items/${i}`, { headers: { "x-forwarded-for": `6.6.6.${i}, 203.0.113.7` } })).status).toBe(200);
    expect((await call(proxied, "/api/items/x", { headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.7" } })).status).toBe(429);
    expect((await call(proxied, "/api/items/x", { headers: { "x-forwarded-for": "203.0.113.8" } })).status).toBe(200);
  });

  test("rate limiter fails open when the kv errors", async () => {
    const config: AppConfig = { mode: "server", version: "t", dataDir: "/tmp", workspacesDir: "/tmp", webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null };
    const broken = memoryKv();
    broken.incr = async () => {
      throw new Error("redis down");
    };
    const app = createApp({
      config,
      modules: [],
      auth: { authenticate: async () => null, session: async () => ({ authenticated: false, mode: "server", needsSetup: false }) },
      killswitch: createKillSwitch({ events: captureEvents(), logger: silentLogger }),
      kv: broken,
      logger: silentLogger,
      limits: { apiMax: 1 },
    });
    for (let i = 0; i < 3; i++) expect((await call(app, "/api/session")).status).toBe(200);
  });

  test("errors: HttpError as is, unknown errors are a 500 with a request id and no internals", async () => {
    const config: AppConfig = { mode: "server", version: "t", dataDir: "/tmp", workspacesDir: "/tmp", webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null };
    const logged: string[] = [];
    const logger = createJsonLogger({ level: "debug", write: (l) => logged.push(l) });
    const boom: MountedModule = {
      name: "boom",
      routes: new Hono().get("/", () => {
        throw new Error("db password=hunter2hunter2 at internal.ts:42");
      }),
    };
    const app = createApp({
      config,
      modules: [boom],
      auth: { authenticate: async () => ({ sessionId: "s", userId: "owner", email: null }), session: async () => ({ authenticated: true, mode: "server", needsSetup: false }) },
      killswitch: createKillSwitch({ events: captureEvents(), logger: silentLogger }),
      kv: memoryKv(),
      logger,
    });
    const res = await call(app, "/api/boom");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("internal");
    expect(body.error.message).toContain(res.headers.get("x-request-id")!);
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(body)).not.toContain("internal.ts");
    expect(logged.join("\n")).not.toContain("hunter2hunter2");
  });
});

// ------------------------------------------------------ auth through the app
describe("auth through the app", () => {
  test("server: setup once, wrong password, cookie session, logout", async () => {
    const { platform } = await serverPlatform();
    const app = platform.app;
    const token = await ownerSession(app);
    const second = await req(app, "/api/auth/setup", { body: { email: "x@example.com", password: "a-long-password-2", setupCode: SETUP_CODE } });
    expect(second.status).toBe(409);
    const wrong = await req(app, "/api/auth/login", { body: { email: "owner@example.com", password: "not-the-password" } });
    expect(wrong.status).toBe(401);
    const login = await req(app, "/api/auth/login", { body: { email: "owner@example.com", password: "a-long-password-1" } });
    expect(login.status).toBe(200);
    const cookie = sessionToken(login);
    expect(cookie).not.toBe(token);
    const me = (await (await req(app, "/api/session", { cookie })).json()) as SessionDTO;
    expect(me).toEqual({ authenticated: true, mode: "server", needsSetup: false, owner: { id: "owner", email: "owner@example.com" } });
    expect((await req(app, "/api/auth/logout", { method: "POST", cookie })).status).toBe(200);
    expect((await req(app, "/api/settings", { cookie })).status).toBe(401);
    expect((await req(app, "/api/settings", { cookie: token })).status).toBe(200);
    await platform.close();
  });

  test("settings through the app: defaults, then patch", async () => {
    const { platform } = await serverPlatform();
    const token = await ownerSession(platform.app);
    const get = await req(platform.app, "/api/settings", { cookie: token });
    expect(((await get.json()) as { defaultBudgetTokens: number }).defaultBudgetTokens).toBe(400_000);
    const patch = await req(platform.app, "/api/settings", { method: "PATCH", body: { motion: "off" }, cookie: token });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { motion: string }).motion).toBe("off");
    await platform.close();
  });
});

// ------------------------------------------------------------ local mode app
describe("local mode", () => {
  async function localPlatform() {
    const dataDir = await tempDir();
    const boot = buildConfig(parseEnv({ MENGAI_MODE: "local", MENGAI_DATA_DIR: dataDir }));
    boot.app.allowedHosts.push("127.0.0.1:4321", "localhost:4321");
    const platform = await bootstrap({ boot, logger: silentLogger, overrides: { db: await createTestDb(), vault: memoryVault() } });
    return { boot, platform, base: "http://127.0.0.1:4321" };
  }

  test("Host allowlist blocks DNS rebinding", async () => {
    const { platform, base } = await localPlatform();
    expect((await req(platform.app, `${base}/api/health`)).status).toBe(200);
    const rebound = await req(platform.app, "http://evil.example:4321/api/health");
    expect(rebound.status).toBe(403);
    expect(((await rebound.json()) as { error: { code: string } }).error.code).toBe("bad_host");
    expect((await req(platform.app, "http://127.0.0.1:9999/api/health")).status).toBe(403);
    expect((await req(platform.app, `${base}/api/health`)).headers.get("strict-transport-security")).toBeNull();
    await platform.close();
  });

  test("launch token exchange is single use and gives a working session", async () => {
    const { platform, base } = await localPlatform();
    const launch = platform.modules.auth.service.issueLaunchToken();
    const res = await req(platform.app, `${base}/api/auth/launch`, { body: { token: launch } });
    expect(res.status).toBe(200);
    const cookie = sessionToken(res);
    expect((await req(platform.app, `${base}/api/settings`, { cookie })).status).toBe(200);
    expect((await req(platform.app, `${base}/api/auth/launch`, { body: { token: launch } })).status).toBe(401);
    expect((await req(platform.app, `${base}/api/auth/launch`, { body: { token: launch }, origin: "http://evil.example" })).status).toBe(403);
    await platform.close();
  });

  test("kill switch: control token path needs no session or CSRF; wrong token is refused", async () => {
    const { platform, boot, base } = await localPlatform();
    let runs = 0;
    platform.killswitch.register("runs", async () => ++runs);
    platform.killswitch.register("processes", async () => 3);
    const ok = await call(platform.app, `${base}/api/killswitch`, { method: "POST", headers: { [CONTROL_TOKEN_HEADER]: boot.app.controlToken! } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ stoppedRuns: 1, killedProcesses: 3 });
    const wrong = await call(platform.app, `${base}/api/killswitch`, { method: "POST", headers: { [CONTROL_TOKEN_HEADER]: "nope" } });
    expect([401, 403]).toContain(wrong.status);
    const bad = await call(platform.app, `${base}/api/killswitch`, {
      method: "POST",
      headers: { [CONTROL_TOKEN_HEADER]: boot.app.controlToken!, "content-type": "application/json" },
      body: JSON.stringify({ by: "hacker" }),
    });
    expect(bad.status).toBe(400);
    const rows = await platform.ctx.db.query<{ type: string; data: string }>`select type, data from events where type = ${"killswitch"}`;
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.data)).toEqual({ by: "tray", stoppedRuns: 1, killedProcesses: 3 });
    await platform.close();
  });

  test("startLocal listens on loopback, fills the Host allowlist and prints the ready line shape", async () => {
    const dataDir = await tempDir();
    const handle = await startLocal({
      env: { MENGAI_DATA_DIR: dataDir },
      logger: silentLogger,
      overrides: { vault: memoryVault() },
    });
    try {
      expect(handle.port).toBeGreaterThan(0);
      expect(handle.boot.app.allowedHosts).toEqual([`127.0.0.1:${handle.port}`, `localhost:${handle.port}`]);
      const line = readyLine(handle);
      expect(Object.keys(JSON.parse(line))).toEqual(["event", "port", "launchToken", "controlToken", "pairUrl"]);
      expect(JSON.parse(line)).toEqual({ event: "ready", port: handle.port, launchToken: handle.launchToken, controlToken: handle.controlToken, pairUrl: handle.pairUrl });
      expect(line.includes("\n")).toBe(false);
      // no MENGAI_SITE_URL: the pairing link points at the runtime itself
      const local = `http://127.0.0.1:${handle.port}`;
      expect(handle.pairUrl).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${handle.port}/app#pair=[A-Za-z0-9_-]{43}&runtime=${encodeURIComponent(local).replace(/\./g, "\\.")}$`));
      const pairToken = new URLSearchParams(handle.pairUrl.split("#")[1]).get("pair")!;
      const paired = await call(handle.platform.app, `${local}/api/auth/pair`, {
        method: "POST",
        headers: { origin: local, [CSRF_HEADER]: "1", "content-type": "application/json" },
        body: JSON.stringify({ token: pairToken }),
      });
      expect(paired.status).toBe(200);
      expect(((await paired.json()) as { origin: string }).origin).toBe(local);
      // the runtime's own origin needs no CORS entry, so it takes no slot
      expect(await handle.platform.modules.auth.service.listOrigins()).toEqual([]);
      expect(handle.newPairUrl()).not.toBe(handle.pairUrl);
      const res = await call(handle.platform.app, `http://127.0.0.1:${handle.port}/api/auth/launch`, {
        method: "POST",
        headers: { origin: `http://127.0.0.1:${handle.port}`, [CSRF_HEADER]: "1", "content-type": "application/json" },
        body: JSON.stringify({ token: handle.launchToken }),
      });
      expect(res.status).toBe(200);
      expect(await Bun.file(join(dataDir, "app.db")).exists()).toBe(true);
    } finally {
      await handle.stop();
    }
  });
});

// ------------------------------------------------------ local-first bridge
describe("local-first bridge", () => {
  const SITE = "https://mengai.example";
  const HOST = "127.0.0.1:4321";
  const BASE = `http://${HOST}`;
  const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

  async function bridge(db?: Db) {
    const dataDir = await tempDir();
    const boot = buildConfig(parseEnv({ MENGAI_MODE: "local", MENGAI_DATA_DIR: dataDir, MENGAI_SITE_URL: SITE }));
    boot.app.allowedHosts.push(HOST, "localhost:4321");
    const platform = await bootstrap({ boot, logger: silentLogger, overrides: { db: db ?? (await createTestDb()), vault: memoryVault() } });
    return { platform, app: platform.app, auth: platform.modules.auth.service };
  }

  const pair = (app: Hono, token: string, origin: string | null = SITE, csrf = true) =>
    req(app, `${BASE}/api/auth/pair`, { body: { token }, origin, csrf });

  async function pairedToken(app: Hono, token: string, origin = SITE): Promise<string> {
    const res = await pair(app, token, origin);
    expect(res.status).toBe(200);
    return ((await res.json()) as { sessionToken: string }).sessionToken;
  }

  const preflight = (app: Hono, path: string, origin: string, pna = true) =>
    call(app, `${BASE}${path}`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "authorization,content-type,x-mengai-csrf",
        ...(pna ? { "access-control-request-private-network": "true" } : {}),
      },
    });

  test("pairing: a one-time token from the site gives a bearer session, single use, origin stored", async () => {
    const { platform, app, auth } = await bridge();
    const token = auth.issuePairToken();
    const res = await pair(app, token);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.getSetCookie()).toEqual([]);
    const body = (await res.json()) as { sessionToken: string; origin: string };
    expect(Object.keys(body).sort()).toEqual(["origin", "sessionToken"]);
    expect(body.origin).toBe(SITE);
    expect(body.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const reuse = await pair(app, token);
    expect(reuse.status).toBe(401);
    expect(await errCode(reuse)).toBe("invalid_pair_token");
    // launch and pairing tokens are separate
    expect((await pair(app, auth.issueLaunchToken())).status).toBe(401);
    expect((await req(app, `${BASE}/api/auth/launch`, { body: { token: auth.issuePairToken() } })).status).toBe(401);
    // an exact web Origin and the csrf header are required, and a refusal does not spend the token
    const fresh = auth.issuePairToken();
    expect((await pair(app, fresh, null)).status).toBe(403);
    expect((await pair(app, fresh, "null")).status).toBe(403);
    expect((await pair(app, fresh, "https://mengai.example/app")).status).toBe(403);
    expect(await errCode(await pair(app, fresh, SITE, false))).toBe("csrf_required");
    expect((await pair(app, fresh, "https://second.example")).status).toBe(200);
    expect((await req(app, `${BASE}/api/auth/pair`, { body: { token: "x", extra: 1 }, origin: SITE })).status).toBe(422);

    const rows = await platform.ctx.db.query<{ origin: string }>`select origin from paired_origins order by origin`;
    expect(rows.map((r) => r.origin)).toEqual(["https://mengai.example", "https://second.example"]);
    const stored = await platform.ctx.db.query<{ token_hash: string; origin: string | null }>`select token_hash, origin from sessions where origin is not null`;
    expect(stored).toHaveLength(2);
    expect(stored.some((r) => r.token_hash === body.sessionToken)).toBe(false);
    await platform.close();

    // server mode has no pairing
    const server = await serverPlatform();
    expect((await req(server.platform.app, "/api/auth/pair", { body: { token: "A".repeat(43) } })).status).toBe(404);
    expect(() => server.platform.modules.auth.service.issuePairToken()).toThrow(/local mode/);
    await server.platform.close();
  });

  test("a foreign site is refused until it pairs, then CORS and the Origin check accept it without credentials, across restarts", async () => {
    const db = await createTestDb();
    const first = await bridge(db);
    const app = first.app;
    const cookie = sessionToken(await req(app, `${BASE}/api/auth/launch`, { body: { token: first.auth.issueLaunchToken() } }));

    // before pairing: no CORS answer, mutations refused even with a valid session
    const before = await preflight(app, "/api/settings", SITE);
    expect(before.headers.get("access-control-allow-origin")).toBeNull();
    expect((await req(app, `${BASE}/api/settings`, { cookie, headers: { origin: SITE } })).headers.get("access-control-allow-origin")).toBeNull();
    const refused = await req(app, `${BASE}/api/settings`, { method: "PATCH", body: { motion: "off" }, cookie, origin: SITE });
    expect(refused.status).toBe(403);
    expect(await errCode(refused)).toBe("bad_origin");

    const bearer = { authorization: `Bearer ${await pairedToken(app, first.auth.issuePairToken())}` };

    // after pairing
    const after = await preflight(app, "/api/settings", SITE);
    expect(after.status).toBe(204);
    expect(after.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(after.headers.get("access-control-allow-credentials")).toBeNull();
    expect(after.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(after.headers.get("access-control-allow-headers")).toContain(CSRF_HEADER);
    const read = await req(app, `${BASE}/api/settings`, { headers: { origin: SITE, ...bearer } });
    expect(read.status).toBe(200);
    expect(read.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(read.headers.get("access-control-allow-credentials")).toBeNull();
    expect(read.headers.get("access-control-expose-headers")).toContain("retry-after");
    const write = await req(app, `${BASE}/api/settings`, { method: "PATCH", body: { motion: "off" }, origin: SITE, headers: bearer });
    expect(write.status).toBe(200);

    // exact match only: a look-alike or another site stays out
    for (const other of ["https://mengai.example.evil.example", "http://mengai.example", "https://other.example"]) {
      expect((await preflight(app, "/api/settings", other)).headers.get("access-control-allow-origin")).toBeNull();
      expect((await req(app, `${BASE}/api/settings`, { method: "PATCH", body: { motion: "off" }, origin: other, cookie })).status).toBe(403);
    }
    // DNS rebinding defense still holds for paired sites
    expect((await req(app, "http://evil.example:4321/api/settings", { headers: { origin: SITE, ...bearer } })).status).toBe(403);
    await first.platform.close();

    // persisted: a restarted runtime on the same database still knows the site and its session
    const second = await bridge(db);
    expect((await preflight(second.app, "/api/settings", SITE)).headers.get("access-control-allow-origin")).toBe(SITE);
    expect((await req(second.app, `${BASE}/api/settings`, { headers: { origin: SITE, ...bearer } })).status).toBe(200);
    await second.platform.close();
    await db.close();
  });

  test("at most 10 paired sites; removing one revokes its sessions and frees the slot", async () => {
    const { platform, app, auth } = await bridge();
    const tokens: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await auth.pair({ token: auth.issuePairToken(), origin: `https://s${i}.example`, host: HOST }, `10.0.0.${i}`);
      tokens.push(r.session.token);
    }
    // pairing a known site again takes no new slot
    expect((await auth.pair({ token: auth.issuePairToken(), origin: "https://s3.example", host: HOST }, "10.0.1.1")).registered).toBe(true);
    const pending = auth.issuePairToken();
    const full = await pair(app, pending, "https://s10.example");
    expect(full.status).toBe(409);
    expect(await errCode(full)).toBe("origin_limit");

    // listing and removing need a session
    expect((await req(app, `${BASE}/api/auth/origins`)).status).toBe(401);
    const s1 = { authorization: `Bearer ${tokens[1]}` };
    const list = await req(app, `${BASE}/api/auth/origins`, { headers: { origin: "https://s1.example", ...s1 } });
    expect(list.status).toBe(200);
    const listed = ((await list.json()) as { origins: { origin: string; pairedAt: number; lastPairedAt: number }[] }).origins;
    expect(listed).toHaveLength(10);
    expect(listed[0]).toEqual({ origin: "https://s0.example", pairedAt: expect.any(Number), lastPairedAt: expect.any(Number) });

    const remove = (origin: string) =>
      req(app, `${BASE}/api/auth/origins?origin=${encodeURIComponent(origin)}`, { method: "DELETE", origin: "https://s1.example", headers: s1 });
    expect((await remove("https://s0.example")).status).toBe(200);
    expect((await remove("https://s0.example")).status).toBe(404);
    expect((await req(app, `${BASE}/api/settings`, { headers: { authorization: `Bearer ${tokens[0]}` } })).status).toBe(401);
    expect((await preflight(app, "/api/settings", "https://s0.example")).headers.get("access-control-allow-origin")).toBeNull();
    expect((await req(app, `${BASE}/api/settings`, { headers: s1 })).status).toBe(200);

    // the link refused while full was not spent
    expect((await pair(app, pending, "https://s10.example")).status).toBe(200);
    expect(await auth.listOrigins()).toHaveLength(10);
    await platform.close();
  });

  test("bearer and cookie: a present Authorization header decides alone, paired tokens stay bound to their site", async () => {
    const { platform, app, auth } = await bridge();
    const cookie = sessionToken(await req(app, `${BASE}/api/auth/launch`, { body: { token: auth.issueLaunchToken() } }));
    const paired = await pairedToken(app, auth.issuePairToken());
    const bearer = `Bearer ${paired}`;
    const settings = `${BASE}/api/settings`;

    expect((await req(app, settings, { cookie })).status).toBe(200);
    const viaBearer = await req(app, settings, { headers: { authorization: bearer, origin: SITE } });
    expect(viaBearer.status).toBe(200);
    expect(viaBearer.headers.getSetCookie()).toEqual([]);
    const session = (await (await req(app, `${BASE}/api/session`, { headers: { authorization: bearer, origin: SITE } })).json()) as SessionDTO;
    expect(session).toEqual({ authenticated: true, mode: "local", needsSetup: false });

    // a bad or foreign-scheme header never falls back to the cookie
    for (const authorization of ["Bearer nope", `Bearer ${"A".repeat(43)}`, "Basic dXNlcjpwdw==", "Bearer"]) {
      expect((await req(app, settings, { cookie, headers: { authorization } })).status).toBe(401);
    }
    expect((await req(app, settings, { headers: { authorization: `bearer   ${paired}` } })).status).toBe(200);
    // a desktop (cookie) session also works as a bearer; a paired token never rides in a cookie
    expect((await req(app, settings, { headers: { authorization: `Bearer ${cookie}` } })).status).toBe(200);
    expect((await req(app, settings, { cookie: paired })).status).toBe(401);
    // bound to its site: another Origin is refused, no Origin (a non-browser client) passes
    expect((await req(app, settings, { headers: { authorization: bearer, origin: "https://other.example" } })).status).toBe(401);
    expect((await req(app, settings, { headers: { authorization: bearer } })).status).toBe(200);

    // the event stream takes the header (the web client reads SSE over fetch); never a query token
    const sse = await call(app, `${BASE}/api/events?runId=r1`, { headers: { authorization: bearer, origin: SITE } });
    expect(sse.status).toBe(200);
    expect(sse.headers.get("access-control-allow-origin")).toBe(SITE);
    await sse.body?.cancel();
    expect((await req(app, `${BASE}/api/events?runId=r1&access_token=${paired}`)).status).toBe(401);

    // bearer logout revokes that session only and sets no cookie
    const out = await req(app, `${BASE}/api/auth/logout`, { method: "POST", origin: SITE, headers: { authorization: bearer } });
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie()).toEqual([]);
    expect((await req(app, settings, { headers: { authorization: bearer } })).status).toBe(401);
    expect((await req(app, settings, { cookie })).status).toBe(200);
    await platform.close();
  });

  test("Private Network Access preflight: answered for the pair route and paired sites only", async () => {
    const { platform, app, auth } = await bridge();
    const pnaHeader = "access-control-allow-private-network";

    const pairPre = await preflight(app, "/api/auth/pair", SITE);
    expect(pairPre.status).toBe(204);
    expect(pairPre.headers.get(pnaHeader)).toBe("true");
    expect(pairPre.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(pairPre.headers.get("access-control-allow-credentials")).toBeNull();
    expect(pairPre.headers.get("access-control-allow-methods")).toContain("POST");
    // not for an opaque origin, nor for other routes before pairing
    for (const [path, origin] of [["/api/auth/pair", "null"], ["/api/settings", SITE], ["/api/auth/launch", SITE]] as const) {
      const res = await preflight(app, path, origin);
      expect(res.headers.get(pnaHeader)).toBeNull();
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }

    await pairedToken(app, auth.issuePairToken());
    const after = await preflight(app, "/api/settings", SITE);
    expect(after.headers.get(pnaHeader)).toBe("true");
    expect(after.headers.get("access-control-allow-origin")).toBe(SITE);
    // only when the browser asks for it
    expect((await preflight(app, "/api/settings", SITE, false)).headers.get(pnaHeader)).toBeNull();

    // health answers an opaque probe from any site (CORP cross-origin) but stays unreadable without pairing
    const probe = await call(app, `${BASE}/api/health`, { headers: { origin: "https://stranger.example" } });
    expect(probe.status).toBe(200);
    expect(probe.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(probe.headers.get("access-control-allow-origin")).toBeNull();
    expect((await req(app, `${BASE}/api/settings`)).headers.get("cross-origin-resource-policy")).toBe("same-origin");
    await platform.close();
  });
});

// ------------------------------------------------------- events through app
describe("events through the app", () => {
  test("append, then SSE replay with Last-Event-ID", async () => {
    const { platform } = await serverPlatform();
    const token = await ownerSession(platform.app);
    const bus = platform.modules.events.service;
    for (let i = 0; i < 4; i++) await bus.publish({ type: "error", runId: "r1", data: { message: `m${i}`, code: null } });
    const res = await call(platform.app, "/api/events?runId=r1", { headers: { cookie: `${SESSION_COOKIE}=${token}`, "last-event-id": "2" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && (text.match(/^id: /gm) ?? []).length < 2) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    await reader.cancel();
    const frames = text.split("\n\n").filter((f) => f.includes(`event: ${SSE_EVENT_NAME}`));
    const events = frames.map((f) => JSON.parse(/^data: (.*)$/m.exec(f)![1]!) as MengaiEvent);
    expect(events.map((e) => e.seq)).toEqual([3, 4]);
    expect(frames[0]).toContain("id: 3");
    await platform.close();
  });
});

// ------------------------------------------------------------------ SPA
describe("SPA", () => {
  test("serves files, falls back to index.html for app routes, never for /api", async () => {
    const webDir = await tempDir();
    await writeFile(join(webDir, "index.html"), "<!doctype html><title>MengAI</title>");
    await writeFile(join(webDir, "index.js"), "console.log(1)");
    await mkdir(join(webDir, "fonts"));
    await writeFile(join(webDir, "fonts", "a.woff2"), "font");
    const { platform } = await serverPlatform({ WEB_DIR: webDir });
    const app = platform.app;
    const root = await req(app, "/");
    expect(root.status).toBe(200);
    expect(await root.text()).toContain("MengAI");
    expect(root.headers.get("content-security-policy")).toContain("default-src 'self'");
    const deep = await req(app, "/app/runs/123");
    expect(deep.status).toBe(200);
    expect(deep.headers.get("content-type")).toContain("text/html");
    const js = await req(app, "/index.js");
    expect(await js.text()).toBe("console.log(1)");
    expect((await req(app, "/fonts/a.woff2")).headers.get("cache-control")).toContain("immutable");
    expect((await req(app, "/missing.js")).status).toBe(404);
    expect((await req(app, "/../../etc/passwd")).headers.get("content-type")).not.toContain("text/plain");
    const api = await req(app, "/api/unknown");
    expect(api.headers.get("content-type")).toContain("application/json");
    await platform.close();
  });
});

// ---------------------------------------------------------------- killswitch
describe("kill switch", () => {
  test("fans out to every hook, sums by category, survives failing and slow hooks, publishes the event", async () => {
    const events = captureEvents();
    const ks = createKillSwitch({ events, logger: silentLogger, hookTimeoutMs: 50 });
    const called: string[] = [];
    ks.register("runs", async () => (called.push("runs"), 2));
    ks.register("runs.queued", async () => (called.push("runs.queued"), 1));
    ks.register("runner", async () => (called.push("runner"), 4));
    ks.register("automation", async () => (called.push("automation"), 1));
    ks.register("broken", async () => {
      called.push("broken");
      throw new Error("nope");
    });
    ks.register("slow", () => new Promise<number>((r) => setTimeout(() => r(100), 500)));
    expect(() => ks.register("runs", async () => 0)).toThrow();
    const result = await ks.trigger("shortcut");
    expect(result).toEqual({ stoppedRuns: 3, killedProcesses: 5 });
    expect(called.sort()).toEqual(["automation", "broken", "runner", "runs", "runs.queued"]);
    const ev = events.ofType("killswitch");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.data).toEqual({ by: "shortcut", stoppedRuns: 3, killedProcesses: 5 });
  });
});

// ------------------------------------------------------------------ adapters
describe("kv memory", () => {
  test("TTL expiry, incr keeps the first TTL, setNx, LRU eviction", async () => {
    let now = 1_000_000;
    const kv = createMemoryKv({ now: () => now, maxEntries: 3 });
    await kv.set("a", "1", 10);
    expect(await kv.get("a")).toBe("1");
    now += 10_001;
    expect(await kv.get("a")).toBeNull();

    expect(await kv.incr("n", 5)).toBe(1);
    now += 3000;
    expect(await kv.incr("n", 5)).toBe(2);
    now += 2001;
    expect(await kv.get("n")).toBeNull();
    expect(await kv.incr("n", 5)).toBe(1);

    expect(await kv.setNx("lock", "x", 1)).toBe(true);
    expect(await kv.setNx("lock", "y", 1)).toBe(false);
    now += 1001;
    expect(await kv.setNx("lock", "z", 1)).toBe(true);

    kv.clear();
    await kv.set("k1", "1");
    await kv.set("k2", "2");
    await kv.set("k3", "3");
    await kv.get("k1");
    await kv.set("k4", "4");
    expect(kv.size).toBe(3);
    expect(await kv.get("k2")).toBeNull();
    expect(await kv.get("k1")).toBe("1");
    await kv.del("k1");
    expect(await kv.get("k1")).toBeNull();
  });
});

describe("vaults", () => {
  test("envelope vault round trip, per-secret DEK, bound to ref and KEK", async () => {
    const db = await createTestDb();
    const clock = fakeClock();
    const kek = new Uint8Array(32).map((_, i) => 200 - i);
    const vault = await createEnvelopeVault({ db, kek, clock });
    expect(vault.kind).toBe("envelope");
    await vault.set("provider:openai", "sk-live-secret-value-0001");
    await vault.set("provider:other", "sk-live-secret-value-0001");
    expect(await vault.get("provider:openai")).toBe("sk-live-secret-value-0001");
    expect(await vault.has("provider:openai")).toBe(true);
    expect(await vault.get("missing")).toBeNull();

    const rows = await db.query<{ ref: string; ciphertext: string; iv: string; dek_wrapped: string }>`select ref, ciphertext, iv, dek_wrapped from vault_items order by ref`;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.ciphertext).not.toContain("sk-live");
      expect(r.dek_wrapped.startsWith("v1.")).toBe(true);
    }
    expect(rows[0]!.dek_wrapped).not.toBe(rows[1]!.dek_wrapped);
    expect(rows[0]!.ciphertext).not.toBe(rows[1]!.ciphertext);

    // a row copied under another ref must not decrypt
    const src = rows.find((r) => r.ref === "provider:openai")!;
    await db.query`update vault_items set ciphertext = ${src.ciphertext}, iv = ${src.iv}, dek_wrapped = ${src.dek_wrapped} where ref = ${"provider:other"}`;
    await expect(vault.get("provider:other")).rejects.toThrow("could not be decrypted");

    // a different KEK must not decrypt
    const other = await createEnvelopeVault({ db, kek: new Uint8Array(32).fill(7), clock });
    await expect(other.get("provider:openai")).rejects.toThrow("could not be decrypted");

    await vault.set("provider:openai", "sk-live-secret-value-0002");
    expect(await vault.get("provider:openai")).toBe("sk-live-secret-value-0002");
    await vault.delete("provider:openai");
    expect(await vault.has("provider:openai")).toBe(false);
    await expect(vault.set("../bad ref", "x")).rejects.toThrow("invalid vault ref");
    await expect(createEnvelopeVault({ db, kek: new Uint8Array(16), clock })).rejects.toThrow("32 bytes");
    await db.close();
  });

  test("keychain vault uses the bundle id service through Bun.secrets", async () => {
    const store = new Map<string, string>();
    const calls: string[] = [];
    const fake: SecretsApi = {
      async get({ service, name }) {
        calls.push(`get ${service}`);
        return store.get(`${service}/${name}`) ?? null;
      },
      async set({ service, name, value }) {
        calls.push(`set ${service}`);
        store.set(`${service}/${name}`, value);
      },
      async delete({ service, name }) {
        return store.delete(`${service}/${name}`);
      },
    };
    const vault = createKeychainVault("id.mengai.app", fake);
    await vault.set("provider:anthropic", "sk-ant-secret-value-123");
    expect(await vault.get("provider:anthropic")).toBe("sk-ant-secret-value-123");
    expect(await vault.has("provider:anthropic")).toBe(true);
    await vault.delete("provider:anthropic");
    expect(await vault.has("provider:anthropic")).toBe(false);
    expect(calls.every((c) => c.endsWith("id.mengai.app"))).toBe(true);
  });
});

describe("blob fs", () => {
  test("round trip under DATA_DIR/blobs, traversal keys rejected", async () => {
    const dir = await tempDir();
    const blob = createFsBlobStore(dir);
    expect(blob.root).toBe(join(dir, "blobs"));
    const put = await blob.put("assets/run-1/cat.png", new Uint8Array([1, 2, 3]), "image/png");
    expect(put).toEqual({ key: "assets/run-1/cat.png", size: 3 });
    expect(await blob.exists("assets/run-1/cat.png")).toBe(true);
    const got = await blob.get("assets/run-1/cat.png");
    expect(got?.contentType).toBe("image/png");
    expect([...got!.data]).toEqual([1, 2, 3]);
    await blob.delete("assets/run-1/cat.png");
    expect(await blob.get("assets/run-1/cat.png")).toBeNull();
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "a//b", ".meta/x", "a\\b", "a/.hidden", ""]) {
      expect(() => sanitizeBlobKey(bad)).toThrow();
    }
    await expect(blob.put("../escape", new Uint8Array([1]), "text/plain")).rejects.toThrow();
  });
});

describe("logger", () => {
  test("JSON lines, level filter, every string redacted, secret-named keys masked", () => {
    const lines: string[] = [];
    const log = createJsonLogger({ level: "info", write: (l) => lines.push(l), now: () => 0 }).child({ module: "t" });
    log.log("debug", "hidden");
    log.log("info", "token sk-abcdefghijklmnopqrstuvwx used", { nested: { note: "Bearer abcdefghijklmnopqrstuv" }, apiKey: "plain-value-123", err: new Error("boom password=supersecret1") });
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!);
    expect(rec.level).toBe("info");
    expect(rec.module).toBe("t");
    expect(rec.ts).toBe("1970-01-01T00:00:00.000Z");
    expect(lines[0]).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(lines[0]).not.toContain("abcdefghijklmnopqrstuv");
    expect(lines[0]).not.toContain("plain-value-123");
    expect(lines[0]).not.toContain("supersecret1");
    expect(rec.err.message).toContain("boom");
  });
});
