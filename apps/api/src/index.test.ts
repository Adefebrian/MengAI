// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Platform tests: config, hardening, auth flows through the full app, the
// no-auth local engine (Host check, exact Origin allowlist with a 403,
// writes only with an allowlisted Origin except the kill switch, Origin-less
// cross-site loads refused except the health probe, refusals logged,
// JSON-only mutations, CORS and Private Network Access, cross-origin SSE),
// SSE through the app, kill switch, and the kv / vault / blob / logger
// adapters.
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
import { buildConfig, defaultLocalDataDir, localOrigins, type BootConfig } from "./core/config";
import { createKillSwitch } from "./core/killswitch";
import type { AppConfig, MountedModule } from "./core/module";
import type { Logger } from "./core/ports/logger";
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

  test("MENGAI_SITE_ORIGINS: exact https origins, checked at boot; MENGAI_UI_ORIGIN: one loopback dev origin", () => {
    const bare = buildConfig(parseEnv({ MENGAI_MODE: "local" }));
    expect(bare.siteOrigins).toEqual([]);
    expect(bare.app.allowedOrigins).toEqual([]);
    const boot = buildConfig(parseEnv({ MENGAI_MODE: "local", MENGAI_SITE_ORIGINS: " https://mengai.example/ , https://b.example:8443", MENGAI_UI_ORIGIN: "http://localhost:3000/" }));
    expect(boot.siteOrigins).toEqual(["https://mengai.example", "https://b.example:8443"]);
    expect(boot.app.allowedOrigins).toEqual(["https://mengai.example", "https://b.example:8443", "http://localhost:3000"]);
    for (const bad of ["http://mengai.example", "https://mengai.example/app", "*", "https://*.example", "mengai.example", "null", "https://Mengai.example", "https://mengai.example:443"]) {
      expect(() => parseEnv({ MENGAI_MODE: "local", MENGAI_SITE_ORIGINS: `https://ok.example,${bad}` })).toThrow(/MENGAI_SITE_ORIGINS/);
    }
    for (const bad of ["http://localhost", "http://127.0.0.1", "https://evil.example:3000", "http://localhost:3000/app", "http://192.168.1.2:3000", "*"]) {
      expect(() => parseEnv({ MENGAI_MODE: "local", MENGAI_UI_ORIGIN: bad })).toThrow(/MENGAI_UI_ORIGIN/);
    }
    // local mode never reads ALLOWED_ORIGINS; server mode never reads the site list
    expect(buildConfig(parseEnv({ MENGAI_MODE: "local", ALLOWED_ORIGINS: "https://x.example" })).app.allowedOrigins).toEqual([]);
    const server = buildConfig(parseEnv({ MENGAI_MODE: "server", VAULT_KEK: KEK, DATABASE_URL: "postgres://h/db", MENGAI_SITE_ORIGINS: "https://mengai.example" }));
    expect(server.siteOrigins).toEqual([]);
    expect(server.app.allowedOrigins).toEqual([]);
    expect(localOrigins(4190)).toEqual(["http://127.0.0.1:4190", "http://localhost:4190"]);
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
    expect(csp).toContain("frame-src http://127.0.0.1:* http://localhost:*");
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
// No auth of any kind: trust comes from the Host check, the exact Origin
// allowlist (403 for anything else) and JSON-only mutations.
describe("local mode", () => {
  const SITE = "https://mengai.example";
  const UI = "http://localhost:3000";
  const HOST = "127.0.0.1:4321";
  const BASE = `http://${HOST}`;
  const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

  async function localPlatform(extra: Record<string, string> = {}, logger: Logger = silentLogger) {
    const dataDir = await tempDir();
    const boot = buildConfig(parseEnv({ MENGAI_MODE: "local", MENGAI_DATA_DIR: dataDir, MENGAI_SITE_ORIGINS: SITE, MENGAI_UI_ORIGIN: UI, ...extra }));
    boot.app.allowedHosts.push(HOST, "localhost:4321");
    const platform = await bootstrap({ boot, logger, overrides: { db: await createTestDb(), vault: memoryVault() } });
    return { boot, platform, app: platform.app, base: BASE };
  }

  /** A browser-like request to the local engine: no cookie, no token, JSON when there is a body. */
  function local(
    app: Hono,
    path: string,
    o: { method?: string; origin?: string; body?: unknown; contentType?: string | null; headers?: Record<string, string>; host?: string } = {},
  ): Promise<Response> {
    const method = o.method ?? (o.body !== undefined ? "POST" : "GET");
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.origin) headers.origin = o.origin;
    const body = o.body === undefined ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body);
    const contentType = o.contentType === undefined ? (method === "GET" || method === "HEAD" || method === "OPTIONS" ? null : "application/json") : o.contentType;
    if (contentType) headers["content-type"] = contentType;
    return call(app, `http://${o.host ?? HOST}${path}`, { method, headers, body });
  }

  const preflight = (app: Hono, path: string, origin: string, pna = true, method = "PATCH") =>
    local(app, path, {
      method: "OPTIONS",
      origin,
      headers: {
        "access-control-request-method": method,
        "access-control-request-headers": "content-type",
        ...(pna ? { "access-control-request-private-network": "true" } : {}),
      },
    });

  test("Host allowlist blocks DNS rebinding, even with an allowed Origin", async () => {
    const { platform, app } = await localPlatform();
    expect((await local(app, "/api/health")).status).toBe(200);
    const rebound = await local(app, "/api/health", { host: "evil.example:4321" });
    expect(rebound.status).toBe(403);
    expect(await errCode(rebound)).toBe("bad_host");
    expect((await local(app, "/api/health", { host: "127.0.0.1:9999" })).status).toBe(403);
    expect((await local(app, "/api/health", { host: "127.0.0.1" })).status).toBe(403);
    const siteRebound = await local(app, "/api/settings", { host: "evil.example:4321", origin: SITE });
    expect(siteRebound.status).toBe(403);
    expect(siteRebound.headers.get("access-control-allow-origin")).toBeNull();
    expect((await local(app, "/api/health")).headers.get("strict-transport-security")).toBeNull();
    await platform.close();
  });

  test("no auth route or token anywhere: every route answers with no cookie, bearer or launch token", async () => {
    const { platform, app } = await localPlatform();
    const session = await local(app, "/api/session");
    expect((await session.json()) as SessionDTO).toEqual({ authenticated: true, mode: "local", needsSetup: false });
    const read = await local(app, "/api/settings");
    expect(read.status).toBe(200);
    expect(read.headers.getSetCookie()).toEqual([]);
    const write = await local(app, "/api/settings", { method: "PATCH", origin: BASE, body: { motion: "off" } });
    expect(write.status).toBe(200);
    expect(((await write.json()) as { motion: string }).motion).toBe("off");
    const project = await local(app, "/api/projects", { origin: SITE, body: { name: "No auth" } });
    expect(project.status).toBeLessThan(300);
    // the pairing and bearer routes are gone
    expect(await errCode(await local(app, "/api/auth/pair", { origin: SITE, body: { token: "A".repeat(43) } }))).toBe("not_found");
    expect((await local(app, "/api/auth/origins", { origin: SITE })).status).toBe(404);
    // a bearer header or a stale cookie changes nothing
    expect((await local(app, "/api/settings", { headers: { authorization: "Bearer nope", cookie: `${SESSION_COOKIE}=stale` } })).status).toBe(200);
    // launch stays in the contract for the desktop: any well-formed body, no cookie
    const launch = await local(app, "/api/auth/launch", { origin: BASE, body: { token: "A".repeat(43) } });
    expect(launch.status).toBe(200);
    expect(launch.headers.getSetCookie()).toEqual([]);
    const sse = await local(app, "/api/events?runId=r1");
    expect(sse.status).toBe(200);
    await sse.body?.cancel();
    await platform.close();
  });

  test("allowed origins (own two, the UI dev origin, the site) get CORS without credentials", async () => {
    const { platform, app } = await localPlatform();
    for (const origin of [BASE, "http://localhost:4321", UI, SITE]) {
      const read = await local(app, "/api/settings", { origin });
      expect(read.status).toBe(200);
      expect(read.headers.get("access-control-allow-origin")).toBe(origin);
      expect(read.headers.get("access-control-allow-credentials")).toBeNull();
      expect(read.headers.get("access-control-expose-headers")).toContain("retry-after");
      expect(read.headers.get("vary")).toContain("Origin");
      const write = await local(app, "/api/settings", { method: "PATCH", origin, body: { motion: "off" } });
      expect(write.status).toBe(200);
      expect(write.headers.get("access-control-allow-origin")).toBe(origin);
    }
    await platform.close();
  });

  test("a foreign Origin is refused with 403 before routing on GET, POST and preflight", async () => {
    const { platform, app } = await localPlatform();
    let killed = 0;
    platform.killswitch.register("probe", async () => ++killed);
    const foreign = [
      "https://evil.example",
      "https://mengai.example.evil.example",
      "http://mengai.example",
      "https://mengai.example:8443",
      // the crew's own preview apps run on other loopback ports and must not drive the engine
      "http://127.0.0.1:5173",
      "http://localhost:4322",
      "http://localhost:3001",
      "null",
    ];
    for (const origin of foreign) {
      for (const [method, path] of [["GET", "/api/settings"], ["GET", "/api/health"], ["GET", "/api/nope"], ["GET", "/"]] as const) {
        const res = await local(app, path, { method, origin });
        expect(res.status).toBe(403);
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
        expect(await errCode(res)).toBe("bad_origin");
      }
      const post = await local(app, "/api/killswitch", { origin, body: {} });
      expect(post.status).toBe(403);
      expect(await errCode(post)).toBe("bad_origin");
      const patch = await local(app, "/api/settings", { method: "PATCH", origin, body: { motion: "off" } });
      expect(patch.status).toBe(403);
      const pre = await preflight(app, "/api/settings", origin);
      expect(pre.status).toBe(403);
      expect(pre.headers.get("access-control-allow-origin")).toBeNull();
      expect(pre.headers.get("access-control-allow-private-network")).toBeNull();
    }
    expect(killed).toBe(0);
    await platform.close();
  });

  test("mutations must be JSON: text/plain, form posts and a missing Content-Type are refused", async () => {
    const { platform, app } = await localPlatform();
    let killed = 0;
    platform.killswitch.register("probe", async () => ++killed);
    for (const contentType of ["text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/jsonp", null]) {
      for (const origin of [BASE, SITE, undefined]) {
        const res = await local(app, "/api/killswitch", { origin, body: "{}", contentType });
        expect(res.status).toBe(415);
        expect(await errCode(res)).toBe("unsupported_media_type");
      }
    }
    expect((await local(app, "/api/settings", { method: "PATCH", origin: SITE, body: "motion=off", contentType: "application/x-www-form-urlencoded" })).status).toBe(415);
    expect((await local(app, "/api/projects/missing-id", { method: "DELETE", origin: SITE, contentType: null })).status).toBe(415);
    expect(killed).toBe(0);
    // application/json with parameters is JSON
    const ok = await local(app, "/api/settings", { method: "PATCH", origin: SITE, body: { motion: "off" }, contentType: "Application/JSON; charset=utf-8" });
    expect(ok.status).toBe(200);
    await platform.close();
  });

  test("preflight: allowlisted origins get the methods, the headers and the Private Network Access answer", async () => {
    const { platform, app } = await localPlatform();
    const pna = "access-control-allow-private-network";
    for (const origin of [SITE, BASE]) {
      const res = await preflight(app, "/api/settings", origin);
      expect(res.status).toBe(204);
      expect(res.headers.get(pna)).toBe("true");
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
      for (const m of ["GET", "POST", "PATCH", "PUT", "DELETE"]) expect(res.headers.get("access-control-allow-methods")).toContain(m);
      const allowHeaders = (res.headers.get("access-control-allow-headers") ?? "").split(",");
      expect(allowHeaders).toContain("content-type");
      expect(allowHeaders).toContain("last-event-id");
      expect(allowHeaders).not.toContain("authorization");
      expect(res.headers.get("vary")).toContain("Origin");
    }
    // only when the browser asks for it
    expect((await preflight(app, "/api/settings", SITE, false)).headers.get(pna)).toBeNull();
    await platform.close();
  });

  test("no Origin: a local native client passes; the control token marks the desktop kill switch", async () => {
    const { platform, boot, app } = await localPlatform();
    let runs = 0;
    platform.killswitch.register("runs", async () => ++runs);
    platform.killswitch.register("processes", async () => 3);
    expect((await local(app, "/api/settings")).status).toBe(200);
    const tray = await local(app, "/api/killswitch", { body: {}, headers: { [CONTROL_TOKEN_HEADER]: boot.app.controlToken! } });
    expect(tray.status).toBe(200);
    expect(await tray.json()).toEqual({ stoppedRuns: 1, killedProcesses: 3 });
    // a wrong control token is just another local request, pressed by the user
    const wrong = await local(app, "/api/killswitch", { body: {}, headers: { [CONTROL_TOKEN_HEADER]: "nope" } });
    expect(wrong.status).toBe(200);
    const bad = await local(app, "/api/killswitch", { body: { by: "hacker" }, headers: { [CONTROL_TOKEN_HEADER]: boot.app.controlToken! } });
    expect(bad.status).toBe(400);
    const rows = await platform.ctx.db.query<{ data: string }>`select data from events where type = ${"killswitch"} order by seq`;
    expect(rows.map((r) => (JSON.parse(r.data) as { by: string }).by)).toEqual(["tray", "user"]);
    await platform.close();
  });

  test("owner writes need an allowlisted Origin: a native client without one is refused, the kill switch is the exception", async () => {
    const lines: Array<{ level: string; msg: string; fields?: Record<string, unknown> }> = [];
    const capture: Logger = { log: (level, msg, fields) => void lines.push({ level, msg, fields }), child: () => capture };
    const { platform, app } = await localPlatform({}, capture);
    let killed = 0;
    platform.killswitch.register("probe", async () => ++killed);
    // what a prompt-injected process would try with curl: approve, raise limits, change keys, delete
    const writes: Array<[string, string, unknown]> = [
      ["PATCH", "/api/settings", { motion: "off" }],
      ["POST", "/api/projects", { name: "Injected" }],
      ["PUT", "/api/routing", {}],
      ["POST", "/api/providers", { name: "x" }],
      ["DELETE", "/api/projects/some-id", undefined],
      ["POST", "/api/trading/orders/some-id/approve", {}],
      ["POST", "/api/nope", {}],
      ["POST", "/api/killswitch/", {}],
    ];
    for (const [method, path, body] of writes) {
      const res = await local(app, path, { method, body: body ?? (method === "DELETE" ? undefined : {}) });
      expect(`${method} ${path} ${res.status}`).toBe(`${method} ${path} 403`);
      expect(await errCode(res)).toBe("origin_required");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(((await (await local(app, "/api/settings")).json()) as { motion: string }).motion).not.toBe("off");
    expect(((await (await local(app, "/api/projects")).json()) as unknown[]).length).toBe(0);
    // the same writes from the app window or an allowlisted site pass
    expect((await local(app, "/api/settings", { method: "PATCH", origin: BASE, body: { motion: "off" } })).status).toBe(200);
    expect((await local(app, "/api/projects", { origin: SITE, body: { name: "Owner" } })).status).toBeLessThan(300);
    // reads without an Origin still work (curl, the desktop shell)
    expect((await local(app, "/api/settings")).status).toBe(200);
    // the kill switch needs no Origin (stopping is the safe direction), control token or not
    const stop = await local(app, "/api/killswitch", { body: {} });
    expect(stop.status).toBe(200);
    expect(killed).toBe(1);
    // refusals are logged with the reason and the route, never the body
    const refused = lines.filter((l) => l.msg === "local request refused");
    expect(refused[0]).toMatchObject({ level: "warn", fields: { reason: "origin_required", method: "PATCH", route: "/api/settings" } });
    expect(JSON.stringify(refused)).not.toContain("Injected");
    // throttled per reason: one line, the rest counted for the next one
    expect(refused.filter((l) => l.fields?.reason === "origin_required")).toHaveLength(1);
    await platform.close();
  });

  test("no Origin plus Sec-Fetch-Site cross-site or same-site is a page on another site: refused, except the health probe", async () => {
    const { platform, app } = await localPlatform();
    let killed = 0;
    platform.killswitch.register("probe", async () => ++killed);
    // <img>, <script>, a GET form, a preview page on another loopback port (same-site)
    const probes: Array<[string, Record<string, string>]> = [
      ["/api/settings", { "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors" }],
      ["/api/assets/a1/file", { "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors" }],
      ["/api/events?runId=r1", { "sec-fetch-dest": "script", "sec-fetch-mode": "no-cors" }],
      ["/api/projects", { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" }],
      ["/", { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" }],
    ];
    for (const site of ["cross-site", "same-site", "Cross-Site"]) {
      for (const [path, headers] of probes) {
        const res = await local(app, path, { headers: { ...headers, "sec-fetch-site": site } });
        expect(`${site} ${path} ${res.status}`).toBe(`${site} ${path} 403`);
        expect(await errCode(res)).toBe("cross_site");
      }
      // a no-Origin kill switch that a browser page sent is refused too
      expect((await local(app, "/api/killswitch", { body: {}, headers: { "sec-fetch-site": site } })).status).toBe(403);
      // the website's no-cors probe: GET and HEAD /api/health only
      const health = await local(app, "/api/health", { headers: { "sec-fetch-site": site, "sec-fetch-mode": "no-cors", "sec-fetch-dest": "empty" } });
      expect(health.status).toBe(200);
      expect(health.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
      expect((await local(app, "/api/health", { method: "HEAD", headers: { "sec-fetch-site": site } })).status).toBe(200);
    }
    expect(killed).toBe(0);
    // the engine's own pages and typed URLs pass
    for (const site of ["same-origin", "none"]) {
      expect((await local(app, "/api/settings", { headers: { "sec-fetch-site": site } })).status).toBe(200);
    }
    // an allowlisted site's CORS request carries its Origin and is not affected
    expect((await local(app, "/api/settings", { origin: SITE, headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" } })).status).toBe(200);
    await platform.close();
  });

  test("SSE streams cross-origin to an allowlisted site with Last-Event-ID replay", async () => {
    const { platform, app } = await localPlatform();
    const bus = platform.modules.events.service;
    for (let i = 0; i < 4; i++) await bus.publish({ type: "error", runId: "r1", data: { message: `m${i}`, code: null } });
    const pre = await preflight(app, "/api/events?runId=r1", SITE, true, "GET");
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(SITE);
    const res = await local(app, "/api/events?runId=r1", { origin: SITE, headers: { "last-event-id": "2" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
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
    expect(frames.map((f) => (JSON.parse(/^data: (.*)$/m.exec(f)![1]!) as MengaiEvent).seq)).toEqual([3, 4]);
    // a foreign site cannot open the stream
    expect((await local(app, "/api/events?runId=r1", { origin: "https://evil.example" })).status).toBe(403);
    await platform.close();
  });

  test("health answers an opaque probe (CORP cross-origin); pages allow loopback preview frames", async () => {
    const { platform, app } = await localPlatform();
    const probe = await local(app, "/api/health");
    expect(probe.status).toBe(200);
    expect(probe.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect((await local(app, "/api/health", { origin: SITE })).headers.get("access-control-allow-origin")).toBe(SITE);
    expect((await local(app, "/api/settings")).headers.get("cross-origin-resource-policy")).toBe("same-origin");
    const csp = probe.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-src http://127.0.0.1:* http://localhost:*");
    expect(csp).toContain("frame-ancestors 'none'");
    await platform.close();
  });

  test("startLocal listens on loopback, fills the Host allowlist and prints the ready line shape", async () => {
    const dataDir = await tempDir();
    const handle = await startLocal({
      env: { MENGAI_DATA_DIR: dataDir, MENGAI_SITE_ORIGINS: SITE },
      logger: silentLogger,
      overrides: { vault: memoryVault() },
    });
    try {
      expect(handle.port).toBeGreaterThan(0);
      expect(handle.boot.app.allowedHosts).toEqual([`127.0.0.1:${handle.port}`, `localhost:${handle.port}`]);
      expect(handle.boot.siteOrigins).toEqual([SITE]);
      const line = readyLine(handle);
      expect(Object.keys(JSON.parse(line))).toEqual(["event", "port", "launchToken", "controlToken"]);
      expect(JSON.parse(line)).toEqual({ event: "ready", port: handle.port, launchToken: handle.launchToken, controlToken: handle.controlToken });
      expect(handle.launchToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(line.includes("\n")).toBe(false);
      const own = `http://127.0.0.1:${handle.port}`;
      const read = await call(handle.platform.app, `${own}/api/settings`, { headers: { origin: `http://localhost:${handle.port}` } });
      expect(read.status).toBe(200);
      expect(read.headers.get("access-control-allow-origin")).toBe(`http://localhost:${handle.port}`);
      const fromSite = await call(handle.platform.app, `${own}/api/settings`, {
        method: "PATCH",
        headers: { origin: SITE, "content-type": "application/json" },
        body: JSON.stringify({ motion: "off" }),
      });
      expect(fromSite.status).toBe(200);
      expect((await call(handle.platform.app, `${own}/api/settings`, { headers: { origin: "http://127.0.0.1:5173" } })).status).toBe(403);
      expect(await Bun.file(join(dataDir, "app.db")).exists()).toBe(true);
    } finally {
      await handle.stop();
    }
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

  test("serves a leading .well-known folder but keeps every other dot path hidden", async () => {
    const webDir = await tempDir();
    await writeFile(join(webDir, "index.html"), "<!doctype html><title>MengAI</title>");
    await mkdir(join(webDir, ".well-known"));
    await writeFile(join(webDir, ".well-known", "tdmrep.json"), "[]");
    await writeFile(join(webDir, ".env"), "SECRET=x");
    await mkdir(join(webDir, "a"));
    await mkdir(join(webDir, "a", ".well-known"));
    await writeFile(join(webDir, "a", ".well-known", "x.json"), "{}");
    const { platform } = await serverPlatform({ WEB_DIR: webDir });
    const app = platform.app;
    const tdm = await req(app, "/.well-known/tdmrep.json");
    expect(tdm.status).toBe(200);
    expect(await tdm.text()).toBe("[]");
    // a dot file is never served; the extensionless path falls back to the app shell
    const env = await req(app, "/.env");
    expect(await env.text()).not.toContain("SECRET");
    expect(env.headers.get("content-type")).toContain("text/html");
    expect((await req(app, "/a/.well-known/x.json")).status).toBe(404);
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
