// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Session guard and control-token check used by core/app.ts. The auth module
// implements SessionAuth: server mode reads the session cookie; local mode has
// no login and no token, so every request that passed the local guard (Host,
// Origin allowlist, JSON-only mutations, see hardening.ts) acts as the local
// owner. This file only decides which requests need a session and how the
// desktop control token is compared. Constant-time comparison hashes both
// sides first, so neither the content nor the length of the expected token
// leaks through timing.
import { CONTROL_TOKEN_HEADER, type SessionDTO } from "@mengai/shared";
import type { Context, MiddlewareHandler } from "hono";
import { errorBody } from "../lib/http";

export interface SessionPrincipal {
  sessionId: string;
  userId: string;
  email: string | null;
}

/** Implemented by modules/auth (createAuthModule().sessionAuth). */
export interface SessionAuth {
  /** server: reads and validates the session cookie (sliding expiry), null when anonymous; local: always the local owner */
  authenticate(c: Context): Promise<SessionPrincipal | null>;
  /** GET /api/session payload for this request */
  session(c: Context): Promise<SessionDTO>;
}

// Request-scoped values set by core/app.ts middleware, typed for every Context.
declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
    clientIp: string;
    session: SessionPrincipal | null;
    /** true when the request carried a valid desktop control token */
    control: boolean;
  }
}

const digest = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest();

/** Timing safe string equality (sha256 of both sides, fixed length compare). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const x = digest(a);
  const y = digest(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** True only when a control token is configured and the given one matches. */
export function controlTokenMatches(expected: string | null | undefined, given: string | null | undefined): boolean {
  if (!expected || !given) return false;
  return timingSafeEqualStr(expected, given);
}

export const KILLSWITCH_PATH = "/api/killswitch";

/** Marks POST /api/killswitch requests that carry the desktop control token. */
export function controlTokenMarker(controlToken: string | null): MiddlewareHandler {
  return async (c, next) => {
    c.set("control", false);
    if (controlToken && c.req.method === "POST" && c.req.path === KILLSWITCH_PATH) {
      if (controlTokenMatches(controlToken, c.req.header(CONTROL_TOKEN_HEADER))) c.set("control", true);
    }
    await next();
  };
}

/** Paths reachable without a session. */
export function isPublicApiPath(method: string, path: string): boolean {
  if (path === "/api/health") return true;
  if (path === "/api/auth" || path.startsWith("/api/auth/")) return true;
  if (method === "GET" && path === "/api/session") return true;
  return false;
}

/** 401 on /api/* without a valid session, except the public paths and a control-token kill switch call. */
export function sessionGuard(auth: SessionAuth): MiddlewareHandler {
  return async (c, next) => {
    c.set("session", null);
    const path = c.req.path;
    if (!(path === "/api" || path.startsWith("/api/"))) return next();
    if (c.req.method === "OPTIONS") return next();
    if (c.get("control")) return next();
    const principal = await auth.authenticate(c);
    c.set("session", principal);
    if (principal || isPublicApiPath(c.req.method, path)) return next();
    return c.json(errorBody("unauthenticated", "Sign in first"), 401);
  };
}
