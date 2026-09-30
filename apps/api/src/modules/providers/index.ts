// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// providers module: BYOK registry, tier and media routing, JEV transport.
// Owns two top-level segments, /api/providers and /api/routing, so it
// returns one Hono app with mountPath "" (core/app.ts mounts it at /api).
//
// Key warm-up: the factory starts service.warm() so stored keys reach the
// redactor early, and core/container.ts must `await module.service.warm()`
// (idempotent) before the server listens, so no log line precedes it.
import type { MountedModule, ModuleContext } from "../../core/module";
import { redact } from "../../lib/redact";
import { providersApi } from "./routes";
import { createProvidersService, type ProvidersDeps, type ProvidersModuleService } from "./service";

export type { ProvidersDeps, ProvidersModuleService } from "./service";
export { defaultRouting, normalizeRouting, TIER_FALLBACK } from "./service";

export function createProvidersModule(ctx: ModuleContext, deps: ProvidersDeps): MountedModule & { service: ProvidersModuleService } {
  const service = createProvidersService(ctx, deps);
  service.warm().catch((e) => ctx.logger.log("warn", "provider key warm-up failed", { error: redact(String(e)) }));
  return {
    name: "providers",
    mountPath: "",
    routes: providersApi(service, { kv: ctx.kv }),
    service,
  };
}
