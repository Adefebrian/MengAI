// Default security hardening applied to every route, per jal-security-hardening.
// Secure headers, a CORS allowlist sourced from env, a Redis-backed rate
// limiter that fails open (never blocks traffic because Redis is down), and
// a basic body-size guard. None of this touches a network resource at
// import time, everything here is either pure config or lazy on first request.
import type { Context, MiddlewareHandler, Next } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { consumeRateLimit } from "../lib/redis";

const DEFAULT_ORIGINS = ["http://localhost:3000"];
const MAX_BODY_BYTES = 1_000_000; // 1 MB
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 120;

export function corsAllowlist(): string[] {
  const raw = process.env.CORS_ORIGINS;
  if (!raw) return DEFAULT_ORIGINS;
  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return origins.length > 0 ? origins : DEFAULT_ORIGINS;
}

/** hono/secure-headers, applied globally before any route is registered. */
export const secureHeadersMiddleware: MiddlewareHandler = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    frameAncestors: ["'none'"],
  },
  crossOriginResourcePolicy: "same-origin",
  referrerPolicy: "strict-origin-when-cross-origin",
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
});

/** Explicit origin allowlist from env, never `*`, never a reflected wildcard. */
export const corsMiddleware: MiddlewareHandler = cors({
  origin: (origin) => {
    const allowlist = corsAllowlist();
    return origin && allowlist.includes(origin) ? origin : allowlist[0];
  },
  credentials: true,
});

/** Rejects any request whose declared Content-Length exceeds the limit. */
export const bodySizeGuard: MiddlewareHandler = async (c: Context, next: Next) => {
  const contentLength = c.req.header("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return c.json({ error: "Payload too large" }, 413);
  }
  return next();
};

/**
 * Redis-backed rate limit, keyed by client IP + route. Fails open: if Redis
 * is unreachable the request is allowed through rather than the API going
 * fully down because the cache is unavailable.
 */
export const rateLimitMiddleware: MiddlewareHandler = async (c: Context, next: Next) => {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown";
  const key = `ratelimit:${ip}:${c.req.path}`;
  const { allowed, remaining } = await consumeRateLimit(
    key,
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_SECONDS,
  );
  c.header("X-RateLimit-Remaining", String(remaining));
  if (!allowed) {
    c.header("Retry-After", String(RATE_LIMIT_WINDOW_SECONDS));
    return c.json({ error: "Too many requests" }, 429);
  }
  return next();
};

/** Registers the full hardening stack, in the order it must run. */
export function applyHardening(app: { use: (path: string, ...handlers: MiddlewareHandler[]) => unknown }): void {
  app.use("*", secureHeadersMiddleware);
  app.use("*", corsMiddleware);
  app.use("*", bodySizeGuard);
  app.use("*", rateLimitMiddleware);
}
