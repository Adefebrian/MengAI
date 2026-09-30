// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// HTTP layer of the auth module. Server mode: the session cookie (HttpOnly,
// SameSite=Strict, Secure, Path=/, 30 days, re-sent when the expiry slides
// forward). Local mode reads no cookie and no header: every request that
// passed the local guard (core/hardening.ts) is the local owner.
// Implements core/auth SessionAuth for the session guard.
import { SESSION_COOKIE } from "@mengai/shared";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { SessionAuth } from "../../core/auth";
import { LOCAL_PRINCIPAL, type AuthService } from "./service";

export function readSessionToken(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function writeSessionCookie(c: Context, token: string, expiresAt: number, secure: boolean, now: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Strict",
    secure,
    path: "/",
    maxAge: Math.max(0, Math.floor((expiresAt - now) / 1000)),
  });
}

export function clearSessionCookie(c: Context, secure: boolean): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure, httpOnly: true, sameSite: "Strict" });
}

export function createSessionAuth(service: AuthService, now: () => number): SessionAuth {
  if (service.mode === "local") {
    return {
      authenticate: async () => ({ ...LOCAL_PRINCIPAL }),
      session: async () => service.sessionInfo(LOCAL_PRINCIPAL),
    };
  }
  return {
    async authenticate(c) {
      const token = readSessionToken(c);
      if (!token) return null;
      const resolved = await service.resolve(token);
      if (!resolved) return null;
      if (resolved.refreshedExpiresAt !== null) writeSessionCookie(c, token, resolved.refreshedExpiresAt, true, now());
      return resolved.principal;
    },
    async session(c) {
      // the session guard already resolved this request; resolve again only outside it
      const known = c.get("session");
      const principal = known === undefined ? await this.authenticate(c) : known;
      return service.sessionInfo(principal);
    },
  };
}
