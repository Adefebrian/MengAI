// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Security middleware, applied by core/app.ts in this order:
//   request context (id + client ip) -> secure headers -> local guard (Host,
//   Origin allowlist, JSON-only mutations) -> CORS allowlist -> body cap ->
//   kv rate limit (fails open) -> Origin + CSRF header check (server mode).
//
// Local mode (the crew engine on the owner's own Mac, 127.0.0.1): there is no
// login, no token and no cookie. Trust comes from the network position plus
// strict request checks, all answered before routing:
//   - Host must be 127.0.0.1:<port> or localhost:<port> (DNS rebinding)
//   - a request that carries an Origin must match the allowlist exactly: the
//     engine's own two origins, the UI dev origin (MENGAI_UI_ORIGIN) and the
//     site origins (MENGAI_SITE_ORIGINS, https). Anything else is a 403, not
//     just a missing CORS header. Never every localhost port: the crew's own
//     preview apps run on 127.0.0.1 ports and must not drive the engine.
//   - owner writes need a browser origin: every POST, PUT, PATCH and DELETE
//     must carry an allowlisted Origin (403 origin_required). Browsers send
//     Origin on every non-GET request, same origin included. The one
//     exception is POST /api/killswitch: stopping is the safe direction and
//     the desktop shell presses it without an Origin
//   - a request without an Origin whose Sec-Fetch-Site is cross-site or
//     same-site is a browser subresource from another site (image, script,
//     GET form, a preview page on another loopback port): 403 cross_site,
//     except GET /api/health, which the website probes with no-cors
//   - POST, PUT, PATCH and DELETE must be Content-Type application/json, which
//     forces a CORS preflight and blocks form posts
//   - CORS echoes allowlisted origins only (Vary: Origin, no credentials) and
//     answers Private Network Access preflights
// A request with no Origin is a local native client (the desktop shell,
// curl): it may read, and press the kill switch, but not write. The crew's
// own processes (shell commands, live previews, stdio MCP servers) cannot
// open a connection to the engine port at all (lib/engine-guard.ts), since a
// native process can forge any header. Refusals are logged as warnings with
// the reason (throttled per reason), never with bodies or header values
// beyond the Origin, the Host and Sec-Fetch-Site (clipped).
//
// Server mode (owner login, not used by the website) keeps cookie sessions:
// ALLOWED_ORIGINS get CORS with credentials, and every mutating request needs
// an allowed Origin plus the x-mengai-csrf header.
//
// Rate limit decisions (jal-security-hardening):
//   - keyed on the matched route pattern + client ip, never the raw path, so
//     query strings or path params cannot mint fresh buckets
//   - client ip is the socket peer; X-Forwarded-For is read only when
//     TRUST_PROXY > 0, and then from the right-hand end (the hop our proxy added)
//   - FAILS OPEN: if the kv errors (Redis down) the request passes and a warning
//     is logged. Stated choice: availability of a single-owner app beats
//     throttling during a cache outage. Login keeps its own 5/min kv limit.
import { CSRF_HEADER, type Mode } from "@mengai/shared";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { matchedRoutes } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
import { errorBody, HttpError } from "../lib/http";
import { KILLSWITCH_PATH } from "./auth";
import type { AppConfig } from "./module";
import type { Kv } from "./ports/kv";
import type { Logger } from "./ports/logger";

export const BODY_LIMIT_BYTES = 1024 * 1024;
export const UPLOAD_BODY_LIMIT_BYTES = 25 * 1024 * 1024;
export const UPLOAD_PREFIXES = ["/api/assets"];

/** 429 with Retry-After (core/app.ts error handler sets the header). */
export class TooManyRequestsError extends HttpError {
  constructor(public readonly retryAfterSec: number, message = "Too many requests, slow down") {
    super(429, "rate_limited", message);
    this.name = "TooManyRequestsError";
  }
}

// ------------------------------------------------------------ request context
type ServerLike = { requestIP?: (req: Request) => { address: string } | null };

function peerAddress(c: Context): string | null {
  const env = c.env as { server?: ServerLike } | ServerLike | undefined;
  const server = (env && "server" in env ? env.server : env) as ServerLike | undefined;
  try {
    return server?.requestIP?.(c.req.raw)?.address ?? null;
  } catch {
    return null;
  }
}

export function clientIp(c: Context, trustProxy: number): string {
  if (trustProxy > 0) {
    const hops = (c.req.header("x-forwarded-for") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // the right-most `trustProxy` entries were appended by proxies we run
    const candidate = hops[hops.length - trustProxy];
    if (candidate && /^[0-9a-fA-F:.]{2,45}$/.test(candidate)) return candidate;
  }
  return peerAddress(c) ?? "unknown";
}

export function requestContext(opts: { trustProxy: number }): MiddlewareHandler {
  return async (c, next) => {
    const id = crypto.randomUUID();
    c.set("requestId", id);
    c.set("clientIp", clientIp(c, opts.trustProxy));
    c.header("x-request-id", id);
    await next();
  };
}

// ------------------------------------------------------------- secure headers
/** Answers a no-cors probe from any site ("something runs here"); the body stays unreadable without CORS. */
export const HEALTH_PATH = "/api/health";

/**
 * hono secure headers. Cross-Origin-Resource-Policy is same-origin
 * everywhere except GET /api/health, which is cross-origin so the web app can
 * tell "engine running" from "nothing here" with an opaque request. CORS
 * reads are not affected by CORP. frame-src admits loopback pages only: the
 * live preview iframe shows what the crew built on its own 127.0.0.1 port.
 */
export function securityHeaders(mode: Mode): MiddlewareHandler {
  const inner = secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      fontSrc: ["'self'"],
      frameSrc: ["http://127.0.0.1:*", "http://localhost:*"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: mode === "server" ? "max-age=31536000; includeSubDomains" : false,
    referrerPolicy: "no-referrer",
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    crossOriginResourcePolicy: "same-origin",
    crossOriginOpenerPolicy: "same-origin",
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [], usb: [] },
  });
  return async (c, next) => {
    await inner(c, next);
    if (c.req.path === HEALTH_PATH && (c.req.method === "GET" || c.req.method === "HEAD")) {
      c.res.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    }
  };
}

// ----------------------------------------------------------------------- CORS
export const PNA_REQUEST_HEADER = "access-control-request-private-network";
export const PNA_ALLOW_HEADER = "Access-Control-Allow-Private-Network";
export const CORS_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];
/**
 * local mode: the only request headers a cross-origin page may send (no
 * credentials, no auth header). x-mengai-csrf is accepted for the web client
 * but never required here: a custom header only forces a preflight.
 * JEV be.api_quality allow_headers: option_compat 0.95.
 */
export const LOCAL_CORS_HEADERS = ["content-type", "last-event-id", CSRF_HEADER];

/** The Origin names the host this request was sent to. */
export function isSameHostOrigin(origin: string, host: string): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === "http:" || u.protocol === "https:") && u.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/**
 * Local mode Origin allowlist, exact match: the engine's own origins (one per
 * allowed Host, read live because the port is known only once listening) and
 * config.allowedOrigins (MENGAI_SITE_ORIGINS and MENGAI_UI_ORIGIN).
 */
export function localOriginAllowed(config: Pick<AppConfig, "allowedOrigins" | "allowedHosts">, origin: string): boolean {
  if (config.allowedOrigins.includes(origin)) return true;
  return origin.startsWith("http://") && config.allowedHosts.includes(origin.slice("http://".length));
}

/**
 * Local mode: allowlisted origins get CORS without credentials, and allowed
 * preflights that ask for Private Network Access get
 * Access-Control-Allow-Private-Network: true. The local guard has already
 * refused every other Origin with a 403.
 * Server mode: exact ALLOWED_ORIGINS with credentials (cookie clients).
 * Unknown origins get no CORS headers at all. Vary: Origin on every answer.
 */
export function corsAllowlist(config: AppConfig): MiddlewareHandler {
  const shared = { allowMethods: CORS_METHODS, exposeHeaders: ["x-request-id", "retry-after"], maxAge: 600 };
  if (config.mode !== "local") {
    const fixed = new Set(config.allowedOrigins);
    return cors({
      ...shared,
      allowHeaders: ["content-type", CSRF_HEADER, "last-event-id"],
      credentials: true,
      origin: (origin) => (fixed.has(origin) ? origin : null),
    });
  }
  const allowed = (origin: string) => origin !== "" && localOriginAllowed(config, origin);
  const local = cors({ ...shared, allowHeaders: LOCAL_CORS_HEADERS, origin: (origin) => (allowed(origin) ? origin : null) });
  return async (c, next) => {
    if (c.req.method === "OPTIONS" && c.req.header(PNA_REQUEST_HEADER) === "true" && allowed(c.req.header("origin") ?? "")) {
      c.res.headers.set(PNA_ALLOW_HEADER, "true");
    }
    return local(c, next);
  };
}

// ------------------------------------------------------------------- body cap
export function bodyCap(): MiddlewareHandler {
  const onError = (c: Context) => {
    // the unread body stays on the socket: tell the client not to reuse it
    c.header("connection", "close");
    return c.json(errorBody("payload_too_large", "Request body is too large"), 413);
  };
  const normal = bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError });
  const upload = bodyLimit({ maxSize: UPLOAD_BODY_LIMIT_BYTES, onError });
  return async (c, next) => {
    const p = c.req.path;
    const isUpload = UPLOAD_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + "/"));
    return (isUpload ? upload : normal)(c, next);
  };
}

// ----------------------------------------------------------------- rate limit
export interface LimitResult {
  allowed: boolean;
  count: number;
  retryAfterSec: number;
}

/** Fixed-window counter on the kv. Throws if the kv throws (callers decide open or closed). */
export async function consumeLimit(kv: Kv, key: string, max: number, windowSec: number): Promise<LimitResult> {
  const count = await kv.incr(`rl:${key}`, windowSec);
  return { allowed: count <= max, count, retryAfterSec: windowSec };
}

/**
 * The registered pattern of the first method route that matches (for
 * example "/api/runs/:id"). Middleware (method ALL) and catch-all routes are
 * skipped, so unknown paths share one bucket.
 */
export function routePattern(c: Context): string {
  try {
    for (const r of matchedRoutes(c)) {
      if (r.method === "ALL") continue;
      if (r.path === "*" || r.path === "/*" || r.path === "/api/*") continue;
      return r.path;
    }
  } catch {
    // no match info (should not happen inside a Hono app)
  }
  return "/api/*";
}

export interface RateLimitOptions {
  kv: Kv;
  logger: Logger;
  windowSec?: number;
  /** per route pattern per ip */
  apiMax?: number;
  authMax?: number;
  staticMax?: number;
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const windowSec = opts.windowSec ?? 60;
  const apiMax = opts.apiMax ?? 300;
  const authMax = opts.authMax ?? 30;
  const staticMax = opts.staticMax ?? 1200;
  let lastWarn = 0;
  return async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const path = c.req.path;
    const isApi = path === "/api" || path.startsWith("/api/");
    const pattern = isApi ? routePattern(c) : "static";
    const max = !isApi ? staticMax : path.startsWith("/api/auth/") ? authMax : apiMax;
    const key = `${c.req.method}:${pattern}:${c.get("clientIp")}`;
    let result: LimitResult;
    try {
      result = await consumeLimit(opts.kv, key, max, windowSec);
    } catch (err) {
      // fail open, see header comment
      const now = Date.now();
      if (now - lastWarn > 60_000) {
        lastWarn = now;
        opts.logger.log("warn", "rate limiter unavailable, failing open", { error: err instanceof Error ? err.message : String(err) });
      }
      return next();
    }
    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfterSec));
      return c.json(errorBody("rate_limited", "Too many requests, slow down"), 429);
    }
    return next();
  };
}

// ---------------------------------------------------------------- local guard
export function requestHost(c: Context): string {
  const raw = c.req.header("host") ?? new URL(c.req.url).host;
  return raw.trim().toLowerCase();
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Sec-Fetch-Site values that mean another site made the browser send this request */
const OTHER_SITE = new Set(["cross-site", "same-site"]);
/** the only write a native client (no Origin) may send: the kill switch */
export const NO_ORIGIN_WRITE_PATH = KILLSWITCH_PATH;
const REFUSAL_LOG_EVERY_MS = 60_000;

/** application/json, parameters allowed (charset); nothing else counts as JSON here. */
export function isJsonContentType(value: string | null | undefined): boolean {
  return (value ?? "").split(";")[0]!.trim().toLowerCase() === "application/json";
}

/** True when a request without an Origin may still write: only POST /api/killswitch. */
export function noOriginWriteAllowed(method: string, path: string): boolean {
  return method === "POST" && path === NO_ORIGIN_WRITE_PATH;
}

/** True for the opaque "is the engine running" probe the website sends. */
export function isHealthProbe(method: string, path: string): boolean {
  return (method === "GET" || method === "HEAD") && path === HEALTH_PATH;
}

/**
 * Local mode only, before CORS and routing (see the header comment), in
 * this order: 403 bad_host for a Host outside allowedHosts (an empty list
 * rejects everything), 403 bad_origin for any Origin off the allowlist on
 * every method, 403 origin_required for a write without an Origin (except
 * the kill switch), 403 cross_site for a request without an Origin that
 * another site made (except the health probe), 415 unsupported_media_type
 * for a mutating request that is not JSON.
 */
export function localGuard(config: AppConfig, logger?: Logger): MiddlewareHandler {
  const lastLog = new Map<string, { at: number; suppressed: number }>();
  const refuse = (c: Context, status: 403 | 415, code: string, message: string, detail: Record<string, unknown> = {}) => {
    if (logger) {
      // detection without flooding: the first refusal per reason, then one a minute with the count in between
      const now = Date.now();
      const seen = lastLog.get(code);
      if (!seen || now - seen.at >= REFUSAL_LOG_EVERY_MS) {
        logger.log("warn", "local request refused", {
          reason: code,
          requestId: c.get("requestId"),
          clientIp: c.get("clientIp"),
          method: c.req.method,
          route: routePattern(c),
          suppressed: seen?.suppressed ?? 0,
          ...detail,
        });
        lastLog.set(code, { at: now, suppressed: 0 });
      } else seen.suppressed++;
    }
    return c.json(errorBody(code, message), status);
  };
  return async (c, next) => {
    if (config.mode !== "local") return next();
    const host = requestHost(c);
    if (!config.allowedHosts.includes(host)) {
      return refuse(c, 403, "bad_host", "Host not allowed", { host: host.slice(0, 100) });
    }
    const method = c.req.method;
    const origin = c.req.header("origin");
    if (origin !== undefined && !localOriginAllowed(config, origin)) {
      return refuse(c, 403, "bad_origin", "This site is not allowed to call MengAI on this machine", { origin: origin.slice(0, 100) });
    }
    if (origin === undefined) {
      if (!SAFE_METHODS.has(method) && !noOriginWriteAllowed(method, c.req.path)) {
        return refuse(c, 403, "origin_required", "Changes come from the MengAI app or an allowed site: this request has no Origin");
      }
      const site = (c.req.header("sec-fetch-site") ?? "").trim().toLowerCase();
      if (OTHER_SITE.has(site) && !isHealthProbe(method, c.req.path)) {
        return refuse(c, 403, "cross_site", "Another site cannot load this from MengAI on this machine", { secFetchSite: site });
      }
    }
    if (!SAFE_METHODS.has(method) && !isJsonContentType(c.req.header("content-type"))) {
      return refuse(c, 415, "unsupported_media_type", "Send JSON: Content-Type must be application/json");
    }
    return next();
  };
}

// ------------------------------------------------------------ origin and csrf
export function originAllowed(origin: string, host: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.includes(origin)) return true;
  return isSameHostOrigin(origin, host);
}

/**
 * Server mode: every mutating request needs an allowed Origin (same host or
 * ALLOWED_ORIGINS) and the x-mengai-csrf header. A cross-site page cannot set
 * that header without a CORS preflight, which the allowlist refuses.
 * Local mode relies on the local guard instead (no cookies to ride along).
 * Requests that carry a valid desktop control token (kill switch) are not
 * browser requests and skip this check.
 */
export function csrfGuard(config: AppConfig): MiddlewareHandler {
  return async (c, next) => {
    if (config.mode === "local") return next();
    if (SAFE_METHODS.has(c.req.method)) return next();
    if (c.get("control")) return next();
    const origin = c.req.header("origin");
    if (!origin || !originAllowed(origin, requestHost(c), config.allowedOrigins)) {
      return c.json(errorBody("bad_origin", "Cross-origin request refused"), 403);
    }
    if (!c.req.header(CSRF_HEADER)) {
      return c.json(errorBody("csrf_required", `Missing ${CSRF_HEADER} header`), 403);
    }
    return next();
  };
}
