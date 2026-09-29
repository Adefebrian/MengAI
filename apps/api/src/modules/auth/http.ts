// Cookie layer of the auth module: HttpOnly, SameSite=Strict, Secure in
// server mode, Path=/, 30 days, re-sent when the expiry slides forward.
// Implements core/auth SessionAuth for the session guard.
import { SESSION_COOKIE } from "@mengai/shared";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { SessionAuth } from "../../core/auth";
import type { AuthService } from "./service";

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
  const secure = service.mode === "server";
  return {
    async authenticate(c) {
      const token = readSessionToken(c);
      if (!token) return null;
      const resolved = await service.resolve(token);
      if (!resolved) return null;
      if (resolved.refreshedExpiresAt !== null) writeSessionCookie(c, token, resolved.refreshedExpiresAt, secure, now());
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
