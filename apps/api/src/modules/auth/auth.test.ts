import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SESSION_COOKIE, type SessionDTO } from "@mengai/shared";
import { Hono } from "hono";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { jsonErrorHandler } from "../../core/app";
import { createFsBlobStore } from "../../core/adapters/blob-fs";
import type { AppConfig, ModuleContext } from "../../core/module";
import { controlTokenMatches, createAuthModule, OWNER_ID, SESSION_TTL_MS } from "./index";

const SETUP_CODE = "correct-horse-battery-staple";

function cfg(mode: "local" | "server"): AppConfig {
  return {
    mode,
    version: "test",
    dataDir: "/tmp/mengai-auth-test",
    workspacesDir: "/tmp/mengai-auth-test/ws",
    webDir: null,
    allowedOrigins: [],
    allowedHosts: [],
    controlToken: mode === "local" ? "control-token-for-tests" : null,
  };
}

async function setup(mode: "local" | "server", setupCode: string | null = SETUP_CODE) {
  const db = await createTestDb();
  const clock = fakeClock();
  const ctx: ModuleContext = {
    config: cfg(mode),
    db,
    kv: memoryKv(),
    blob: createFsBlobStore("/tmp/mengai-auth-test"),
    vault: memoryVault(),
    clock,
    logger: silentLogger,
    events: captureEvents(clock),
  };
  const mod = createAuthModule(ctx, { setupCode });
  const app = new Hono();
  app.onError(jsonErrorHandler(silentLogger));
  app.route("/auth", mod.routes!);
  app.get("/session", async (c) => c.json(await mod.sessionAuth.session(c)));
  return { db, clock, mod, app };
}

// The root bunfig preloads happy-dom (web tests); its global Request drops
// the Cookie header, so requests are built with Bun's native Request.
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

function call(app: Hono, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body !== undefined) headers["content-length"] = String(Buffer.byteLength(init.body));
  return Promise.resolve(app.fetch(new NativeRequest(`http://localhost${path}`, { method: init.method ?? "GET", headers, body: init.body })));
}

const post = (app: Hono, path: string, body: unknown, cookie?: string) =>
  call(app, path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

function cookieOf(res: Response): { header: string; token: string } {
  const set = res.headers.getSetCookie().join(", ");
  const m = new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(set);
  return { header: set, token: m?.[1] ?? "" };
}

describe("auth: server mode", () => {
  test("setup works once, needs the setup code, and issues a hardened cookie", async () => {
    const { app, db } = await setup("server");
    const before = (await (await call(app, "/session")).json()) as SessionDTO;
    expect(before).toEqual({ authenticated: false, mode: "server", needsSetup: true });

    const wrongCode = await post(app, "/auth/setup", { email: "me@example.com", password: "a-long-password-1", setupCode: "nope" });
    expect(wrongCode.status).toBe(403);

    const res = await post(app, "/auth/setup", { email: "Me@Example.com", password: "a-long-password-1", setupCode: SETUP_CODE });
    expect(res.status).toBe(200);
    const dto = (await res.json()) as SessionDTO;
    expect(dto).toEqual({ authenticated: true, mode: "server", needsSetup: false, owner: { id: OWNER_ID, email: "me@example.com" } });
    const { header, token } = cookieOf(res);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Secure");
    expect(header).toContain("Path=/");
    expect(header).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);

    const again = await post(app, "/auth/setup", { email: "x@example.com", password: "a-long-password-2", setupCode: SETUP_CODE });
    expect(again.status).toBe(409);

    // stored as sha256, argon2id password hash
    const s = await db.query<{ token_hash: string }>`select token_hash from sessions`;
    expect(s[0]!.token_hash).toHaveLength(64);
    expect(s[0]!.token_hash).not.toBe(token);
    const u = await db.query<{ pass_hash: string }>`select pass_hash from users`;
    expect(u[0]!.pass_hash.startsWith("$argon2id$")).toBe(true);
    await db.close();
  });

  test("setup is refused when SETUP_CODE is not configured", async () => {
    const { app, db } = await setup("server", null);
    const res = await post(app, "/auth/setup", { email: "me@example.com", password: "a-long-password-1", setupCode: "anything" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("setup_disabled");
    await db.close();
  });

  test("login: wrong password and unknown email give the same 401, right password gives a session", async () => {
    const { app, db } = await setup("server");
    await post(app, "/auth/setup", { email: "me@example.com", password: "a-long-password-1", setupCode: SETUP_CODE });
    const wrong = await post(app, "/auth/login", { email: "me@example.com", password: "wrong-password" });
    const unknown = await post(app, "/auth/login", { email: "who@example.com", password: "wrong-password" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());

    const ok = await post(app, "/auth/login", { email: "ME@example.com", password: "a-long-password-1" });
    expect(ok.status).toBe(200);
    const { token } = cookieOf(ok);
    const session = (await (await call(app, "/session", { headers: { cookie: `${SESSION_COOKIE}=${token}` } })).json()) as SessionDTO;
    expect(session.authenticated).toBe(true);
    expect(session.owner?.email).toBe("me@example.com");

    const out = await call(app, "/auth/logout", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie().join(", ")).toContain(`${SESSION_COOKIE}=;`);
    const after = (await (await call(app, "/session", { headers: { cookie: `${SESSION_COOKIE}=${token}` } })).json()) as SessionDTO;
    expect(after.authenticated).toBe(false);
    await db.close();
  });

  test("login is limited to 5 attempts per minute per ip with Retry-After", async () => {
    const { app, db } = await setup("server");
    for (let i = 0; i < 5; i++) expect((await post(app, "/auth/login", { email: "a@example.com", password: "x" })).status).toBe(401);
    const blocked = await post(app, "/auth/login", { email: "a@example.com", password: "x" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    await db.close();
  });

  test("sessions slide forward and expire", async () => {
    const { app, clock, db } = await setup("server");
    const res = await post(app, "/auth/setup", { email: "me@example.com", password: "a-long-password-1", setupCode: SETUP_CODE });
    const { token } = cookieOf(res);
    const cookie = { cookie: `${SESSION_COOKIE}=${token}` };
    clock.advance(20 * 24 * 60 * 60 * 1000);
    const slid = await call(app, "/session", { headers: cookie });
    expect(((await slid.json()) as SessionDTO).authenticated).toBe(true);
    expect(slid.headers.getSetCookie().join(", ")).toContain(`${SESSION_COOKIE}=${token}`);
    clock.advance(20 * 24 * 60 * 60 * 1000);
    expect(((await (await call(app, "/session", { headers: cookie })).json()) as SessionDTO).authenticated).toBe(true);
    clock.advance(31 * 24 * 60 * 60 * 1000);
    expect(((await (await call(app, "/session", { headers: cookie })).json()) as SessionDTO).authenticated).toBe(false);
    const rows = await db.query`select id from sessions`;
    expect(rows).toHaveLength(0);
    await db.close();
  });

  test("launch is not available in server mode, bodies are validated", async () => {
    const { app, db } = await setup("server");
    expect((await post(app, "/auth/launch", { token: "x".repeat(43) })).status).toBe(404);
    expect((await post(app, "/auth/login", { email: "not-an-email", password: "x" })).status).toBe(422);
    expect((await post(app, "/auth/setup", { email: "me@example.com", password: "short", setupCode: SETUP_CODE })).status).toBe(422);
    await db.close();
  });
});

describe("auth: local mode", () => {
  test("launch token is single use and yields a non-Secure strict cookie", async () => {
    const { app, mod, db } = await setup("local");
    const launch = mod.service.issueLaunchToken();
    const res = await post(app, "/auth/launch", { token: launch });
    expect(res.status).toBe(200);
    expect(((await res.json()) as SessionDTO)).toEqual({ authenticated: true, mode: "local", needsSetup: false });
    const { header, token } = cookieOf(res);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).not.toContain("Secure");
    const reuse = await post(app, "/auth/launch", { token: launch });
    expect(reuse.status).toBe(401);
    const session = (await (await call(app, "/session", { headers: { cookie: `${SESSION_COOKIE}=${token}` } })).json()) as SessionDTO;
    expect(session.authenticated).toBe(true);
    const forged = await post(app, "/auth/launch", { token: "A".repeat(43) });
    expect(forged.status).toBe(401);
    await db.close();
  });

  test("setup and login do not exist in local mode", async () => {
    const { app, db } = await setup("local");
    expect((await post(app, "/auth/setup", { email: "me@example.com", password: "a-long-password-1", setupCode: SETUP_CODE })).status).toBe(404);
    expect((await post(app, "/auth/login", { email: "me@example.com", password: "a-long-password-1" })).status).toBe(404);
    await db.close();
  });

  test("control token check is exact and timing safe", () => {
    expect(controlTokenMatches("abc123", "abc123")).toBe(true);
    expect(controlTokenMatches("abc123", "abc124")).toBe(false);
    expect(controlTokenMatches("abc123", "abc1234")).toBe(false);
    expect(controlTokenMatches("abc123", "")).toBe(false);
    expect(controlTokenMatches(null, "abc123")).toBe(false);
  });
});
