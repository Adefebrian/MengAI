// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// /api/crew-skills (see @mengai/shared Routes). Parse and validate only;
// every rule lives in the service. Errors are HttpError, rendered by
// core/app.ts: 400 invalid_json, 422 invalid_param / invalid_body,
// 404 not_found, 409 conflict, 429 rate_limited (with Retry-After).
//   GET    /             built-in pack first (fixed order), then the owner's skills newest first
//   POST   /             201 a new owner skill
//   PATCH  /:id          owner skill fields; built-in skills accept only { enabled }
//   DELETE /:id          owner skills only (409 for a built-in: switch it off instead)
// Every write is limited per client (the trust-proxy-aware clientIp from
// core/hardening requestContext, never raw X-Forwarded-For) on top of the
// global limiter; when the shared kv fails, an in-process counter keeps
// the limit on.
import { AGENT_ROLES, COMPANY_KINDS } from "@mengai/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { createMemoryKv } from "../../core/adapters/kv-memory";
import { consumeLimit, TooManyRequestsError, type LimitResult } from "../../core/hardening";
import type { Kv } from "../../core/ports/kv";
import { HttpError, parseBody } from "../../lib/http";
import { CREW_SKILL_MAX_CHARS } from "../context";
import type { CrewSkillsService } from "./ports";

export const WRITE_LIMIT_PER_WINDOW = 30;
export const WRITE_WINDOW_SEC = 60;

const idParam = z.string().regex(/^[A-Za-z0-9-]{1,80}$/);

/** A single line of printable text (no control characters, no line breaks). */
const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "must be a single line of text");

const roles = z
  .array(z.enum(AGENT_ROLES))
  .min(1, "list at least one role, or null for every role")
  .max(AGENT_ROLES.length)
  .nullable();
const kinds = z
  .array(z.enum(COMPANY_KINDS))
  .min(1, "list at least one company kind, or null for all")
  .max(COMPANY_KINDS.length)
  .nullable();
const body = z
  .string()
  .max(CREW_SKILL_MAX_CHARS, `at most ${CREW_SKILL_MAX_CHARS} characters`)
  .refine((s) => s.trim().length > 0, "required")
  .refine((s) => !/\u0000/.test(s), "must be text");

export const CreateCrewSkillSchema = z
  .object({
    name: line(80).pipe(z.string().min(1, "required")),
    summary: line(200).optional(),
    body,
    roles: roles.optional(),
    kinds: kinds.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const UpdateCrewSkillSchema = z
  .object({
    name: line(80).pipe(z.string().min(1, "required")).optional(),
    summary: line(200).optional(),
    body: body.optional(),
    roles: roles.optional(),
    kinds: kinds.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "nothing to change" });

function paramId(c: Context): string {
  const parsed = idParam.safeParse(c.req.param("id"));
  if (!parsed.success) throw new HttpError(422, "invalid_param", "id: invalid");
  return parsed.data;
}

function writeLimiter(kv: Kv) {
  const fallback = createMemoryKv({ maxEntries: 5_000 });
  return async (c: Context): Promise<void> => {
    const key = `crew-skills.write:${c.get("clientIp") ?? "unknown"}`;
    let r: LimitResult;
    try {
      r = await consumeLimit(kv, key, WRITE_LIMIT_PER_WINDOW, WRITE_WINDOW_SEC);
    } catch {
      r = await consumeLimit(fallback, key, WRITE_LIMIT_PER_WINDOW, WRITE_WINDOW_SEC);
    }
    if (!r.allowed) throw new TooManyRequestsError(r.retryAfterSec, "Too many skill changes, retry later");
  };
}

export function crewSkillRoutes(service: CrewSkillsService, kv: Kv): Hono {
  const limit = writeLimiter(kv);
  return new Hono()
    .get("/", async (c) => c.json(await service.list()))
    .post("/", async (c) => {
      await limit(c);
      const input = await parseBody(c, CreateCrewSkillSchema);
      return c.json(await service.create(input), 201);
    })
    .patch("/:id", async (c) => {
      const id = paramId(c);
      await limit(c);
      const input = await parseBody(c, UpdateCrewSkillSchema);
      return c.json(await service.update(id, input));
    })
    .delete("/:id", async (c) => {
      const id = paramId(c);
      await limit(c);
      await service.remove(id);
      return c.json({ ok: true as const });
    });
}
