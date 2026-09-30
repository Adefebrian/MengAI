// /api/connectors: validate with zod, rate limit the writes, delegate to the
// service. Secrets are accepted once and never returned.
import { AGENT_ROLES, CONNECTOR_KINDS } from "@mengai/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { consumeLimit, TooManyRequestsError, type LimitResult } from "../../core/hardening";
import type { Kv } from "../../core/ports/kv";
import { notFound, parseBody } from "../../lib/http";
import type { ConnectorsService } from "./ports";
import { LABEL_RE } from "./risk";

const Id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const Label = z.string().trim().min(1).max(24).regex(LABEL_RE, "lowercase letters, digits, - and single _");
const Roles = z.array(z.enum(AGENT_ROLES)).min(1).max(AGENT_ROLES.length).nullable();
const Target = z.string().trim().min(1).max(2000);
const Secret = z.string().max(8000);
const AuthHeader = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "a header name like Authorization or X-API-KEY");
const OpenApi = z.string().max(900_000);

export const createConnectorSchema = z
  .object({
    kind: z.enum(CONNECTOR_KINDS),
    label: Label,
    target: Target,
    secret: Secret.optional(),
    authHeader: AuthHeader.optional(),
    openapi: OpenApi.optional(),
    roles: Roles.optional(),
  })
  .strict();

export const updateConnectorSchema = z
  .object({
    label: Label.optional(),
    target: Target.optional(),
    secret: Secret.optional(),
    authHeader: AuthHeader.or(z.literal("")).optional(),
    openapi: OpenApi.optional(),
    roles: Roles.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "nothing to change" });

async function limit(c: Context, kv: Kv, name: string, max: number, windowSec: number): Promise<void> {
  let r: LimitResult;
  try {
    r = await consumeLimit(kv, `${name}:${c.get("clientIp") ?? "unknown"}`, max, windowSec);
  } catch {
    return;
  }
  if (!r.allowed) throw new TooManyRequestsError(r.retryAfterSec);
}

function idParam(c: Context): string {
  const r = Id.safeParse(c.req.param("id"));
  if (!r.success) throw notFound("connector");
  return r.data;
}

export function createConnectorsRoutes(service: ConnectorsService, o: { kv: Kv }): Hono {
  return new Hono()
    .get("/", async (c) => c.json(await service.list()))
    .post("/", async (c) => {
      await limit(c, o.kv, "connectors.write", 20, 60);
      const body = await parseBody(c, createConnectorSchema);
      return c.json(await service.create(body), 201);
    })
    .patch("/:id", async (c) => {
      const id = idParam(c);
      await limit(c, o.kv, "connectors.write", 20, 60);
      const body = await parseBody(c, updateConnectorSchema);
      return c.json(await service.update(id, body));
    })
    .delete("/:id", async (c) => {
      await service.remove(idParam(c));
      return c.json({ ok: true as const });
    })
    .post("/:id/test", async (c) => {
      const id = idParam(c);
      await limit(c, o.kv, "connectors.test", 10, 60);
      return c.json(await service.test(id));
    });
}
