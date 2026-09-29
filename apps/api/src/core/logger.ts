// Logger wiring: the JSON-lines adapter plus the per-request access log.
// The access log records the route pattern (not the raw url, which can carry
// query values), status, duration and request id. Health checks and the SSE
// stream log at debug to keep the log quiet.
import type { MiddlewareHandler } from "hono";
import { createJsonLogger } from "./adapters/logger";
import { routePattern } from "./hardening";
import type { LogLevel, Logger } from "./ports/logger";

export { createJsonLogger };

export function createAppLogger(level: LogLevel, fields: Record<string, unknown> = {}): Logger {
  return createJsonLogger({ level, fields: { app: "mengai", ...fields } });
}

const QUIET = new Set(["/api/health", "/api/events"]);

export function accessLog(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    await next();
    const path = c.req.path;
    const isApi = path.startsWith("/api/");
    const status = c.res.status;
    const level: LogLevel = status >= 500 ? "error" : QUIET.has(path) || !isApi ? "debug" : "info";
    logger.log(level, "request", {
      requestId: c.get("requestId"),
      method: c.req.method,
      route: isApi ? routePattern(c) : "static",
      status,
      ms: Math.round(performance.now() - started),
    });
  };
}
