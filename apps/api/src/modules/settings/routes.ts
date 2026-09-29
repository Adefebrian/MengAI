// GET /api/settings, PATCH /api/settings. Validation only, no logic.
import type { OwnerSettings } from "@mengai/shared";
import { Hono } from "hono";
import { parseBody } from "../../lib/http";
import type { SettingsService } from "../../core/services";
import { settingsPatchSchema } from "./schema";

export function createSettingsRoutes(service: SettingsService): Hono {
  return new Hono()
    .get("/", async (c) => c.json<OwnerSettings>(await service.get()))
    .patch("/", async (c) => {
      const body = await parseBody(c, settingsPatchSchema);
      return c.json<OwnerSettings>(await service.patch(body));
    });
}
