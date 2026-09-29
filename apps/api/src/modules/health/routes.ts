// GET /api/health (public).
import type { HealthDTO } from "@mengai/shared";
import { Hono } from "hono";
import type { HealthService } from "./service";

export function createHealthRoutes(service: HealthService): Hono {
  return new Hono().get("/", async (c) => {
    c.header("cache-control", "no-store");
    return c.json<HealthDTO>(await service.check());
  });
}
