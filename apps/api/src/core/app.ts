// Assembles the Hono app: hardening middleware, health check, and every
// domain module, each wired with the core port adapters it needs. This is
// the one place in the codebase that is allowed to know both "modules" and
// "adapters" at once; a module itself never reaches for an adapter or a raw
// infra client directly (see ../modules/example and tools/check-boundaries.ts).
//
// The route registrations below are chained (`.get(...).route(...)`) rather
// than called as separate statements. Hono's RPC typing (`hc<AppType>`, see
// apps/web/src/client.ts) only accumulates a route's schema into the type of
// the variable that the call is assigned to; a bare `app.get(...)` statement
// whose return value is discarded still registers the route at runtime but
// leaves the compile-time type of `app` unchanged. Chaining is required for
// AppType to actually describe the routes.
import { Hono } from "hono";
import { createRedisCacheAdapter } from "./adapters/redis";
import { applyHardening } from "./hardening";
import { createExampleModule } from "../modules/example";

const base = new Hono();

applyHardening(base);

const app = base
  .get("/health", (c) => c.json({ ok: true }))
  .route("/example", createExampleModule({ cache: createRedisCacheAdapter() }));

export { app };
export type AppType = typeof app;
