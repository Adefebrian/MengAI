// POST /api/auth/{launch,setup,login,logout}. Validation and cookies only.
import type { SessionDTO } from "@mengai/shared";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { parseBody } from "../../lib/http";
import { clearSessionCookie, readSessionToken, writeSessionCookie } from "./http";
import type { AuthService, IssuedSession } from "./service";

const email = z.string().trim().toLowerCase().email().max(254);

const launchBody = z.object({ token: z.string().min(16).max(256) }).strict();
const setupBody = z
  .object({
    email,
    password: z.string().min(12, "use at least 12 characters").max(256),
    setupCode: z.string().min(1).max(256),
  })
  .strict();
const loginBody = z.object({ email, password: z.string().min(1).max(256) }).strict();

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
    .post("/setup", async (c) => {
      const body = await parseBody(c, setupBody);
      return respond(c, await service.setup(body, ip(c)));
    })
    .post("/login", async (c) => {
      const body = await parseBody(c, loginBody);
      return respond(c, await service.login(body, ip(c)));
    })
    .post("/logout", async (c) => {
      await service.logout(readSessionToken(c));
      clearSessionCookie(c, secure);
      return c.json({ ok: true as const });
    });
}
