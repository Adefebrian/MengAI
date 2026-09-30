// auth module: owner account (server), launch and pairing tokens (local),
// sessions (cookie or bearer), paired website origins.
// Exports the SessionAuth helpers core/app.ts plugs into the session guard,
// the OriginRegistry the CORS allowlist and Origin check read, and the timing
// safe control-token check for the kill switch route.
import type { OriginRegistry, SessionAuth } from "../../core/auth";
import type { ModuleContext, MountedModule } from "../../core/module";
import type { Kv } from "../../core/ports/kv";
import { createSessionAuth } from "./http";
import { createAuthRepo } from "./repo";
import { createAuthRoutes } from "./routes";
import { createAuthService, type AuthService } from "./service";

export { controlTokenMatches } from "../../core/auth";
export type { AuthService, IssuedSession, PairedOrigin, PairResult, ResolvedSession } from "./service";
export { MAX_PAIRED_ORIGINS, OWNER_ID, PAIR_TOKEN_TTL_MS, SESSION_TTL_MS } from "./service";

export interface AuthModuleDeps {
  /** server mode: SETUP_CODE from env; setup is refused without it */
  setupCode?: string | null;
  /** rate limit store for login/setup/launch; defaults to ctx.kv */
  kv?: Kv;
  loginPerMinute?: number;
}

export function createAuthModule(
  ctx: ModuleContext,
  deps: AuthModuleDeps = {},
): MountedModule & { service: AuthService; sessionAuth: SessionAuth; origins: OriginRegistry } {
  const now = () => ctx.clock.now();
  const service = createAuthService({
    repo: createAuthRepo(ctx.db),
    kv: deps.kv ?? ctx.kv,
    clock: ctx.clock,
    logger: ctx.logger.child({ module: "auth" }),
    mode: ctx.config.mode,
    setupCode: deps.setupCode ?? null,
    loginPerMinute: deps.loginPerMinute,
  });
  return {
    name: "auth",
    mountPath: "auth",
    routes: createAuthRoutes(service, now),
    service,
    sessionAuth: createSessionAuth(service, now),
    origins: { has: (origin) => service.isPairedOrigin(origin) },
  };
}
