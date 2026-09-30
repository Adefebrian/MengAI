// POST /api/auth/{launch,setup,login,logout,pair}, GET and DELETE
// /api/auth/origins. Validation, cookies and bearer tokens only; the rules
// live in service.ts. /api/auth/origins needs a session (core/auth
// isPublicApiPath); the rest of /api/auth is public.
import type { RouteResponse, SessionDTO } from "@mengai/shared";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { requestHost } from "../../core/hardening";
import { HttpError, parseBody, parseQuery } from "../../lib/http";
import { clearSessionCookie, readSessionCredential, writeSessionCookie } from "./http";
import type { AuthService, IssuedSession, PairedOrigin } from "./service";

const email = z.string().trim().toLowerCase().email().max(254);

const launchBody = z.object({ token: z.string().min(16).max(256) }).strict();
const pairBody = z.object({ token: z.string().min(16).max(256) }).strict();
const setupBody = z
  .object({
    email,
    password: z.string().min(12, "use at least 12 characters").max(256),
    setupCode: z.string().min(1).max(256),
  })
  .strict();
const loginBody = z.object({ email, password: z.string().min(1).max(256) }).strict();
const originQuery = z.object({ origin: z.string().min(1).max(255) }).strict();

/** the session guard already enforces this; checked again so the route never depends on the public path list alone */
function signedIn(c: Context): void {
  if (!c.get("session")) throw new HttpError(401, "unauthenticated", "Sign in first");
}

export function createAuthRoutes(service: AuthService, now: () => number): Hono {
  const secure = service.mode === "server";
  const ip = (c: Context) => c.get("clientIp") ?? "unknown";
  const respond = async (c: Context, issued: IssuedSession) => {
    writeSessionCookie(c, issued.token, issued.expiresAt, secure, now());
    return c.json<SessionDTO>(await service.sessionInfo(issued.principal));
  };

  return new Hono()
    .post("/launch", async (c) => {
      const body = await parseBody(c, launchBody);
      return respond(c, await service.launch(body.token, ip(c)));
    })
    .post("/pair", async (c) => {
      const body = await parseBody(c, pairBody);
      const result = await service.pair({ token: body.token, origin: c.req.header("origin") ?? "", host: requestHost(c) }, ip(c));
      c.header("cache-control", "no-store");
      return c.json<RouteResponse<"POST /api/auth/pair">>({ sessionToken: result.session.token, origin: result.origin });
    })
    .get("/origins", async (c) => {
      signedIn(c);
      return c.json<{ origins: PairedOrigin[] }>({ origins: await service.listOrigins() });
    })
    .delete("/origins", async (c) => {
      signedIn(c);
      const { origin } = parseQuery(c, originQuery);
      if (!(await service.removeOrigin(origin))) throw new HttpError(404, "not_found", "That site is not paired");
      return c.json({ ok: true as const });
    })
    .post("/setup", async (c) => {
      const body = await parseBody(c, setupBody);
      return respond(c, await service.setup(body, ip(c)));
    })
    .post("/login", async (c) => {
      const body = await parseBody(c, loginBody);
      return respond(c, await service.login(body, ip(c)));
    })
    .post("/logout", async (c) => {
      const cred = readSessionCredential(c);
      await service.logout(cred?.token);
      // a bearer logout leaves the cookie alone: that browser never had one from this site
      if (cred?.via !== "bearer") clearSessionCookie(c, secure);
      return c.json({ ok: true as const });
    });
}
