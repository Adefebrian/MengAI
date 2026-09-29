// Hono router for the example module. Parses and validates the request,
// calls the service, shapes the response. No business logic lives here.
//
// The three routes are chained into one expression, with no explicit
// return-type annotation on this function, so that Hono's route schema
// accumulates onto the inferred return type. That inferred type is what
// flows through modules/example/index.ts into core/app.ts's `AppType`,
// which is what apps/web/src/client.ts's `hc<AppType>()` needs to produce a
// typed client. Splitting these into separate `router.get(...)` statements,
// or annotating `: Hono`, would erase the schema and the RPC client would
// see no routes.
import { Hono } from "hono";
import type { ExampleService } from "./service";

export function createExampleRoutes(service: ExampleService) {
  return new Hono()
    .get("/", (c) => c.json(service.list()))
    .post("/", async (c) => {
      const body = await c.req.json<{ name?: string }>().catch((): { name?: string } => ({}));
      if (!body.name || typeof body.name !== "string") {
        return c.json({ error: "name is required" }, 400);
      }
      const item = service.create(body.name);
      return c.json(item, 201);
    })
    .get("/:id/views", async (c) => {
      const views = await service.recordView(c.req.param("id"));
      return c.json({ views });
    });
}
