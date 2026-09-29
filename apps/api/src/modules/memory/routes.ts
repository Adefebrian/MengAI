// /api/memory routes (see @mengai/shared Routes). Parse and validate only;
// every rule lives in the service. Errors are HttpError, rendered by core/app.ts:
// 400 invalid_json, 422 invalid_query / invalid_param / invalid_body, 404 not_found.
// Lists are newest first; `before=<createdAt>,<id>` (taken from the last row
// of a page) returns the next page, a page shorter than `limit` is the last.
import { AGENT_ROLES, LESSON_SCOPES, LESSON_STATUSES } from "@mengai/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { HttpError, parseBody, parseQuery } from "../../lib/http";
import type { MemoryModuleService } from "./service";

const idParam = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

function paramId(c: Context): string {
  const parsed = idParam.safeParse(c.req.param("id"));
  if (!parsed.success) throw new HttpError(422, "invalid_param", "id: invalid");
  return parsed.data;
}

const limit = z.coerce.number().int().min(1).max(500).optional();

/** Keyset cursor "<createdAt>,<id>": epoch ms and the id of the last row seen. */
export const CursorParam = z
  .string()
  .regex(/^\d{1,16},[A-Za-z0-9-]{1,64}$/, "expected <createdAt>,<id>")
  .transform((raw) => {
    const comma = raw.indexOf(",");
    return { createdAt: Number(raw.slice(0, comma)), id: raw.slice(comma + 1) };
  })
  .refine((c) => Number.isSafeInteger(c.createdAt), "createdAt out of range");

export const ListLessonsQuery = z.object({
  status: z.enum(LESSON_STATUSES).optional(),
  scope: z.enum(LESSON_SCOPES).optional(),
  projectId: idParam.optional(),
  role: z.enum(AGENT_ROLES).optional(),
  before: CursorParam.optional(),
  limit,
});

export const LessonPatchBody = z
  .object({
    status: z.enum(LESSON_STATUSES).optional(),
    text: z.string().trim().min(1).max(400).optional(),
  })
  .strict()
  .refine((b) => b.status !== undefined || b.text !== undefined, { message: "status or text is required" });

export const ListSkillsQuery = z.object({
  role: z.enum(AGENT_ROLES).optional(),
  before: CursorParam.optional(),
  limit,
});

export function memoryRoutes(service: MemoryModuleService): Hono {
  const app = new Hono();

  app.get("/lessons", async (c) => {
    const q = parseQuery(c, ListLessonsQuery);
    return c.json(await service.listLessons(q));
  });

  app.patch("/lessons/:id", async (c) => {
    const id = paramId(c);
    const body = await parseBody(c, LessonPatchBody);
    return c.json(await service.patchLesson(id, body));
  });

  app.delete("/lessons/:id", async (c) => {
    await service.deleteLesson(paramId(c));
    return c.json({ ok: true as const });
  });

  app.get("/skills", async (c) => {
    const q = parseQuery(c, ListSkillsQuery);
    return c.json(await service.listSkills(q));
  });

  app.delete("/skills/:id", async (c) => {
    await service.deleteSkill(paramId(c));
    return c.json({ ok: true as const });
  });

  return app;
}
