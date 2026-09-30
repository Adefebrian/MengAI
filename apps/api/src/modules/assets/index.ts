// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Public surface of the assets module: the factory and its types only.
import type { ModuleContext, MountedModule } from "../../core/module";
import { clip } from "../../lib/redact";
import { assetsRoutes } from "./routes";
import { createAssetsService, type AssetsDeps, type AssetsModuleService } from "./service";

export type { AssetsDeps, AssetsModuleService, PollPolicy, Sleep } from "./service";

export function createAssetsModule(ctx: ModuleContext, deps: AssetsDeps): MountedModule & { service: AssetsModuleService } {
  const service = createAssetsService(ctx, deps);
  if (deps.resumeOnStart !== false) {
    service.resumePending().catch((err) => {
      ctx.logger.log("warn", "could not resume queued videos", { error: clip(err instanceof Error ? err.message : String(err), 200) });
    });
  }
  return {
    name: "assets",
    mountPath: "assets",
    routes: assetsRoutes(service, { kv: ctx.kv }),
    service,
    close: () => service.close(),
  };
}
