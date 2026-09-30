// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// settings module: owner preferences (settings table). Public surface only.
import type { ModuleContext, MountedModule } from "../../core/module";
import type { SettingsService } from "../../core/services";
import { createSettingsRepo } from "./repo";
import { createSettingsRoutes } from "./routes";
import { createSettingsService } from "./service";

export { DEFAULT_SETTINGS } from "./schema";

export function createSettingsModule(ctx: ModuleContext, _deps: Record<string, never> = {}): MountedModule & { service: SettingsService } {
  const service = createSettingsService(createSettingsRepo(ctx.db), ctx.clock);
  return { name: "settings", mountPath: "settings", routes: createSettingsRoutes(service), service };
}
