// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// /api/projects routes: validate, delegate to the service, shape the reply.
// Live preview and Open folder (local engine only) are rate limited per ip:
// they start processes on the owner's computer.
import type { FileContent, FileNodeDTO, PreviewDTO, ProjectDTO } from "@mengai/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { consumeLimit, TooManyRequestsError, type LimitResult } from "../../core/hardening";
import type { Kv } from "../../core/ports/kv";
import { HttpError, notFound, parseBody, parseQuery } from "../../lib/http";
import type { ProjectsServiceImpl } from "./service";

const createBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    workspacePath: z
      .string()
      .min(1)
      .max(4096)
      .refine((p) => p.startsWith("/") && !p.includes("\0"), "must be an absolute path")
      .optional(),
  })
  .strict();

const filesQuery = z.object({
  path: z.string().max(4096).optional(),
  depth: z.coerce.number().int().min(1).max(6).optional(),
});

const fileQuery = z.object({
  path: z.string().min(1).max(4096),
  from: z.coerce.number().int().min(1).optional(),
  to: z.coerce.number().int().min(1).optional(),
});

const previewBody = z.object({ restart: z.boolean().optional() }).strict();
const emptyBody = z.object({}).strict();

/** PREVIEW_LIMIT starts or reveals per minute per ip */
export const PREVIEW_LIMIT = 20;

const idSchema = z.string().uuid();

/** a JSON body that may be left out entirely; when present it must match the schema */
async function optionalBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  const raw = await c.req.text();
  let parsed: unknown = {};
  if (raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "invalid_json", "Body must be JSON");
    }
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(422, "invalid_body", `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`);
  }
  return result.data;
}

async function limit(c: Context, kv: Kv | undefined, name: string): Promise<void> {
  if (!kv) return;
  let r: LimitResult;
  try {
    r = await consumeLimit(kv, `${name}:${c.get("clientIp") ?? "unknown"}`, PREVIEW_LIMIT, 60);
  } catch {
    return;
  }
  if (!r.allowed) throw new TooManyRequestsError(r.retryAfterSec);
}

function projectId(raw: string): string {
  const r = idSchema.safeParse(raw);
  if (!r.success) throw notFound("project");
  return r.data;
}

export function createProjectsRoutes(service: ProjectsServiceImpl, o: { kv?: Kv } = {}): Hono {
  return new Hono()
    .get("/", async (c) => c.json<ProjectDTO[]>(await service.list()))
    .post("/", async (c) => {
      const body = await parseBody(c, createBody);
      return c.json<ProjectDTO>(await service.create(body));
    })
    .get("/:id", async (c) => c.json<ProjectDTO>(await service.get(projectId(c.req.param("id")))))
    .delete("/:id", async (c) => {
      await service.remove(projectId(c.req.param("id")));
      return c.json({ ok: true as const });
    })
    .get("/:id/files", async (c) => {
      const id = projectId(c.req.param("id"));
      const q = parseQuery(c, filesQuery);
      return c.json<FileNodeDTO[]>(await service.listFiles(id, q.path ?? ".", q.depth ?? 2));
    })
    .get("/:id/file", async (c) => {
      const id = projectId(c.req.param("id"));
      const q = parseQuery(c, fileQuery);
      return c.json<FileContent>(await service.readFile(id, q.path, { from: q.from, to: q.to }));
    })
    .get("/:id/preview", async (c) => c.json<PreviewDTO>(await service.preview(projectId(c.req.param("id")))))
    .post("/:id/preview", async (c) => {
      const id = projectId(c.req.param("id"));
      const body = await optionalBody(c, previewBody);
      await limit(c, o.kv, "projects.preview");
      return c.json<PreviewDTO>(await service.startPreview(id, { restart: body.restart }));
    })
    .delete("/:id/preview", async (c) => c.json<PreviewDTO>(await service.stopPreview(projectId(c.req.param("id")))))
    .post("/:id/reveal", async (c) => {
      const id = projectId(c.req.param("id"));
      await optionalBody(c, emptyBody);
      await limit(c, o.kv, "projects.reveal");
      await service.reveal(id);
      return c.json({ ok: true as const });
    });
}
