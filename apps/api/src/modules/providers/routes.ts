// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// /api/providers and /api/routing. Validation, rate limits and status codes
// only; every decision lives in the service.
import { AGENT_ROLES, PROVIDER_CAPS, REASONING_EFFORTS, TIERS, type AgentRole, type ModelRouting, type Tier } from "@mengai/shared";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { consumeLimit, TooManyRequestsError, type LimitResult } from "../../core/hardening";
import type { Kv } from "../../core/ports/kv";
import { notFound, parseBody } from "../../lib/http";
import type { ProvidersModuleService } from "./service";

const Id = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
/** printable ASCII without spaces; empty string clears the key on PATCH */
const ApiKey = z.string().max(4096).regex(/^[\x21-\x7e]*$/, "API key must be printable ASCII without spaces");
const Label = z.string().trim().max(80);
const BaseUrl = z.string().trim().max(500);
const ModelId = z.string().trim().min(1).max(200);

const ProviderModelSchema = z
  .object({
    id: ModelId,
    label: z.string().max(200).optional(),
    contextWindow: z.number().int().positive().max(100_000_000).optional(),
    caps: z.array(z.enum(PROVIDER_CAPS)).max(PROVIDER_CAPS.length).optional(),
  })
  .strict();

export const CreateProviderSchema = z
  .object({
    preset: z.string().trim().min(1).max(64),
    label: Label.optional(),
    baseUrl: BaseUrl.optional(),
    apiKey: ApiKey.optional(),
    models: z.array(ProviderModelSchema).max(200).optional(),
  })
  .strict();

export const UpdateProviderSchema = z
  .object({
    label: Label.optional(),
    baseUrl: BaseUrl.optional(),
    apiKey: ApiKey.optional(),
    models: z.array(ProviderModelSchema).max(200).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "nothing to update");

const Mapping = z.object({ providerId: Id.nullable(), model: ModelId.nullable() }).strict();

export const RoutingSchema = z
  .object({
    tiers: z
      .array(
        z
          .object({
            tier: z.enum(TIERS),
            providerId: Id.nullable(),
            model: ModelId.nullable(),
            /** missing means default; kept for a tier without its own provider too */
            reasoning: z.enum(REASONING_EFFORTS).optional(),
          })
          .strict(),
      )
      .max(TIERS.length)
      .refine((ts) => new Set(ts.map((t) => t.tier)).size === ts.length, "each tier at most once"),
    roleTiers: z
      .record(z.string(), z.enum(TIERS))
      .refine((r) => Object.keys(r).every((k) => (AGENT_ROLES as readonly string[]).includes(k)), "unknown role"),
    image: Mapping,
    video: Mapping,
  })
  .strict();

export interface RouteOptions {
  kv: Kv;
}

/**
 * Stricter per-route limit on top of the global one, keyed on the client ip
 * that core/hardening requestContext resolved (trustProxy aware). Fails open
 * on a kv error like the global limiter; 429 + Retry-After via the core
 * error handler.
 */
async function limit(c: Context, o: RouteOptions, name: string, max: number, windowSec: number): Promise<void> {
  let r: LimitResult;
  try {
    r = await consumeLimit(o.kv, `${name}:${c.get("clientIp") ?? "unknown"}`, max, windowSec);
  } catch {
    return;
  }
  if (!r.allowed) throw new TooManyRequestsError(r.retryAfterSec);
}

function idParam(c: Context): string {
  const r = Id.safeParse(c.req.param("id"));
  if (!r.success) throw notFound("provider");
  return r.data;
}

export function providersRoutes(service: ProvidersModuleService, o: RouteOptions): Hono {
  return new Hono()
    .get("/", async (c) => c.json(await service.list()))
    .get("/presets", (c) => c.json(service.presets()))
    .post("/", async (c) => {
      await limit(c, o, "providers.write", 30, 60);
      const body = await parseBody(c, CreateProviderSchema);
      return c.json(await service.create(body), 201);
    })
    .patch("/:id", async (c) => {
      const id = idParam(c);
      await limit(c, o, "providers.write", 30, 60);
      const body = await parseBody(c, UpdateProviderSchema);
      return c.json(await service.update(id, body));
    })
    .delete("/:id", async (c) => {
      await service.remove(idParam(c));
      return c.json({ ok: true as const });
    })
    .post("/:id/test", async (c) => {
      const id = idParam(c);
      await limit(c, o, "providers.test", 10, 60);
      return c.json(await service.test(id, c.req.raw.signal));
    });
}

export function routingRoutes(service: ProvidersModuleService): Hono {
  return new Hono()
    .get("/", async (c) => c.json(await service.routing()))
    .put("/", async (c) => {
      const body = await parseBody(c, RoutingSchema);
      const routing: ModelRouting = { ...body, roleTiers: body.roleTiers as Partial<Record<AgentRole, Tier>> };
      return c.json(await service.setRouting(routing));
    });
}

/** Both segments in one app, mounted by core/app.ts with mountPath "" at /api. */
export function providersApi(service: ProvidersModuleService, o: RouteOptions): Hono {
  return new Hono().route("/providers", providersRoutes(service, o)).route("/routing", routingRoutes(service));
}
