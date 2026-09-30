// Assembles the Hono app. Order matters and is fixed here:
//   request id + client ip, access log, secure headers, local guard (Host,
//   exact Origin allowlist with a 403, JSON-only mutations; local mode),
//   CORS allowlist, body cap, kv rate limit (fails open), control token
//   marker, Origin + CSRF check (server mode), session guard, JSON error
//   handler, then every module at /api/<mountPath>, GET /api/session,
//   POST /api/killswitch, an /api 404, and the SPA with index.html fallback.
// Local mode has no login or token of any kind: the allowlisted websites and
// the engine's own window just call the API (see hardening.ts).
// Modules never see adapters: they get ports through ModuleContext.
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { SessionDTO } from "@mengai/shared";
import { Hono, type Context, type ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { z, ZodError } from "zod";
import { errorBody, HttpError } from "../lib/http";
import { redact } from "../lib/redact";
import { createMemoryKv } from "./adapters/kv-memory";
import { controlTokenMarker, sessionGuard, KILLSWITCH_PATH, type SessionAuth } from "./auth";
import {
  bodyCap,
  corsAllowlist,
  csrfGuard,
  localGuard,
  rateLimit,
  requestContext,
  securityHeaders,
  TooManyRequestsError,
  type RateLimitOptions,
} from "./hardening";
import { accessLog, createAppLogger } from "./logger";
import type { AppConfig, MountedModule } from "./module";
import type { Kv } from "./ports/kv";
import type { Logger } from "./ports/logger";
import type { KillSwitch } from "./services";

export interface CreateAppOptions {
  config: AppConfig;
  modules: MountedModule[];
  killswitch: KillSwitch;
  auth: SessionAuth;
  /** rate limit store; defaults to a private in-memory kv */
  kv?: Kv;
  logger?: Logger;
  /** reverse proxy hops to trust for X-Forwarded-For (server mode) */
  trustProxy?: number;
  limits?: Pick<RateLimitOptions, "windowSec" | "apiMax" | "authMax" | "staticMax">;
}

const killSwitchBody = z
  .object({ by: z.enum(["user", "shortcut", "tray"]).optional() })
  .strict();

const MOUNT = /^[a-z][a-z0-9-]{0,31}$/;

export function createApp(opts: CreateAppOptions): Hono {
  const { config, killswitch, auth } = opts;
  const logger = opts.logger ?? createAppLogger("info");
  const kv = opts.kv ?? createMemoryKv({ maxEntries: 20_000 });
  const app = new Hono();

  app.use("*", requestContext({ trustProxy: opts.trustProxy ?? 0 }));
  app.use("*", accessLog(logger));
  app.use("*", securityHeaders(config.mode));
  app.use("*", localGuard(config));
  app.use("*", corsAllowlist(config));
  app.use("*", bodyCap());
  app.use("*", rateLimit({ kv, logger, ...opts.limits }));
  app.use("*", controlTokenMarker(config.controlToken));
  app.use("*", csrfGuard(config));
  app.use("*", sessionGuard(auth));

  app.onError(jsonErrorHandler(logger));

  const seen = new Set<string>();
  for (const mod of opts.modules) {
    if (!mod.routes) continue;
    const mount = mod.mountPath ?? mod.name;
    // "" mounts the module's routes directly under /api (for modules owning several top-level segments)
    if (mount === "") {
      app.route("/api", mod.routes);
      continue;
    }
    if (!MOUNT.test(mount)) throw new Error(`module ${mod.name}: invalid mount path "${mount}"`);
    if (seen.has(mount)) throw new Error(`module ${mod.name}: mount path "${mount}" already used`);
    seen.add(mount);
    app.route(`/api/${mount}`, mod.routes);
  }

  app.get("/api/session", async (c) => c.json<SessionDTO>(await auth.session(c)));

  app.post(KILLSWITCH_PATH, async (c) => {
    const raw = await c.req.text();
    let parsed: unknown = {};
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "invalid_json", "Body must be JSON");
      }
    }
    const body = killSwitchBody.safeParse(parsed);
    if (!body.success) throw new HttpError(400, "invalid_body", "by: must be user, shortcut or tray");
    const by = body.data.by ?? (c.get("control") ? "tray" : "user");
    return c.json(await killswitch.trigger(by));
  });

  app.all("/api/*", (c) => c.json(errorBody("not_found", "No such API route"), 404));
  app.all("/api", (c) => c.json(errorBody("not_found", "No such API route"), 404));

  // HEAD is routed to GET handlers by Hono
  app.get("*", createSpaHandler(config.webDir));

  app.notFound((c) => c.json(errorBody("not_found", "Not found"), 404));
  return app;
}

/**
 * HttpError as is (message redacted), zod errors as 400, hono HTTP
 * exceptions below 500 with a generic message, anything else 500 with the
 * request id and no stack or internal message.
 */
export function jsonErrorHandler(logger: Logger): ErrorHandler {
  return (err, c) => {
    if (err instanceof HttpError) {
      if (err instanceof TooManyRequestsError) c.header("Retry-After", String(err.retryAfterSec));
      return c.json(errorBody(err.code, redact(err.message)), err.status);
    }
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const where = issue?.path.join(".") || "input";
      return c.json(errorBody("invalid_input", `${where}: ${issue?.message ?? "invalid"}`), 400);
    }
    if (err instanceof HTTPException && err.status < 500) {
      return c.json(errorBody("http_error", err.status === 413 ? "Request body is too large" : "Request rejected"), err.status);
    }
    const requestId = c.get("requestId") ?? "unknown";
    logger.log("error", "unhandled error", { requestId, error: err instanceof Error ? err.message : String(err) });
    return c.json(errorBody("internal", `Internal error (request ${requestId})`), 500);
  };
}

/** Type of the assembled app, for typed clients. */
export type AppType = ReturnType<typeof createApp>;

// ------------------------------------------------------------------------ SPA
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Serves files from webDir; unknown extensionless paths get index.html so the
 * client router can take over. Never answers /api/*. Paths are decoded,
 * normalized and checked to stay inside webDir.
 */
export function createSpaHandler(webDir: string | null) {
  const root = webDir ? resolve(webDir) : null;
  return async (c: Context) => {
    const path = c.req.path;
    if (!root || path === "/api" || path.startsWith("/api/")) return c.json(errorBody("not_found", "Not found"), 404);
    if (path.includes("\0") || path.includes("\\")) return c.json(errorBody("not_found", "Not found"), 404);
    const rel = normalize(path).replace(/^([/\\])+/, "");
    const target = resolve(root, rel);
    const inside = target === root || target.startsWith(root + sep);
    const hidden = rel.split("/").some((seg) => seg.startsWith("."));
    if (inside && !hidden && rel && (await isFile(target))) {
      const file = Bun.file(target);
      const immutable = rel.startsWith("fonts/");
      c.header("content-type", file.type || "application/octet-stream");
      c.header("cache-control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
      return c.req.method === "HEAD" ? c.body(null) : c.body(file.stream());
    }
    if (extname(rel)) return c.json(errorBody("not_found", "Not found"), 404);
    const index = join(root, "index.html");
    if (!(await isFile(index))) return c.json(errorBody("not_found", "Not found"), 404);
    c.header("content-type", "text/html; charset=utf-8");
    c.header("cache-control", "no-cache");
    return c.req.method === "HEAD" ? c.body(null) : c.body(Bun.file(index).stream());
  };
}
