// HTTP layer of the auth module. A session token arrives one of two ways:
//   - Authorization: Bearer <token>, from a website paired with this runtime
//     (cross-origin, no cookies; the web client streams SSE over fetch so the
//     header reaches /api/events too). When the header is present it alone
//     decides. Tokens are never read from the query string.
//   - the session cookie: HttpOnly, SameSite=Strict, Secure in server mode,
//     Path=/, 30 days, re-sent when the expiry slides forward.
// A paired session is bound to the origin that paired it: it never rides in
// a cookie, and a request whose Origin names another site is refused.
// Implements core/auth SessionAuth for the session guard.
import { SESSION_COOKIE } from "@mengai/shared";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { SessionAuth } from "../../core/auth";
import type { AuthService } from "./service";

const BEARER_RE = /^Bearer[ \t]+([^\s]+)$/i;

export interface SessionCredential {
  token: string;
  via: "cookie" | "bearer";
}

export function readSessionToken(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

/** The credential this request carries: the bearer header when present (even a malformed one), else the cookie. */
export function readSessionCredential(c: Context): SessionCredential | null {
  const header = c.req.header("authorization");
  if (header !== undefined) return { token: BEARER_RE.exec(header.trim())?.[1] ?? "", via: "bearer" };
  const cookie = readSessionToken(c);
  return cookie ? { token: cookie, via: "cookie" } : null;
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
      const cred = readSessionCredential(c);
      if (!cred) return null;
      const resolved = await service.resolve(cred.token);
      if (!resolved) return null;
      const { principal } = resolved;
      if (cred.via === "cookie") {
        // paired sessions live in the website's storage, never in a cookie
        if (principal.origin) return null;
        if (resolved.refreshedExpiresAt !== null) writeSessionCookie(c, cred.token, resolved.refreshedExpiresAt, secure, now());
      } else if (principal.origin) {
        const origin = c.req.header("origin");
        if (origin !== undefined && origin !== principal.origin) return null;
      }
      return { ...principal, via: cred.via };
    },
    async session(c) {
      // the session guard already resolved this request; resolve again only outside it
      const known = c.get("session");
      const principal = known === undefined ? await this.authenticate(c) : known;
      return service.sessionInfo(principal);
    },
  };
}
