// Security middleware, applied by core/app.ts in this order:
//   request context (id + client ip) -> secure headers -> CORS allowlist ->
//   body cap -> kv rate limit (fails open) -> Host allowlist (local mode) ->
//   Origin + CSRF header check on mutating requests.
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
export function securityHeaders(mode: Mode): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      fontSrc: ["'self'"],
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
}

// ----------------------------------------------------------------------- CORS
/** Exact-match allowlist with credentials. Unknown origins get no CORS headers. */
export function corsAllowlist(allowedOrigins: string[]): MiddlewareHandler {
  const allow = new Set(allowedOrigins);
  return cors({
    origin: (origin) => (origin && allow.has(origin) ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowHeaders: ["content-type", CSRF_HEADER, "last-event-id"],
    exposeHeaders: ["x-request-id", "retry-after"],
    maxAge: 600,
  });
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

// -------------------------------------------------------------- host allowlist
export function requestHost(c: Context): string {
  const raw = c.req.header("host") ?? new URL(c.req.url).host;
  return raw.trim().toLowerCase();
}

/** Local mode only: DNS rebinding defense. An empty allowlist rejects everything. */
export function hostAllowlist(config: AppConfig): MiddlewareHandler {
  return async (c, next) => {
    if (config.mode !== "local") return next();
    const host = requestHost(c);
    if (!config.allowedHosts.some((h) => h.toLowerCase() === host)) {
      return c.json(errorBody("bad_host", "Host not allowed"), 403);
    }
    return next();
  };
}

// ------------------------------------------------------------ origin and csrf
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function originAllowed(origin: string, host: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.includes(origin)) return true;
  try {
    const u = new URL(origin);
    return (u.protocol === "http:" || u.protocol === "https:") && u.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/**
 * Every mutating request needs an allowed Origin (same host or in the
 * allowlist) and the x-mengai-csrf header. A cross-site page cannot set that
 * header without a CORS preflight, which the allowlist refuses. Requests that
 * carry a valid desktop control token (kill switch) are not browser requests
 * and skip this check.
 */
export function csrfGuard(config: AppConfig): MiddlewareHandler {
  return async (c, next) => {
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

