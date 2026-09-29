// /api/runs routes: validate with zod, delegate to the service, no logic.
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { HttpError, parseBody } from "../../lib/http";
import type { RunsServiceImpl } from "./service";

const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);

// budgets: 0 means unlimited; a real token limit starts at 1,000
const budgetTokens = z
  .number()
  .int()
  .min(0)
  .max(100_000_000)
  .refine((v) => v === 0 || v >= 1000, "0 (unlimited) or at least 1000");
const budgetUsd = z
  .number()
  .min(0)
  .max(10_000)
  .refine((v) => v === 0 || v >= 0.01, "0 (unlimited) or at least 0.01");

export const createRunSchema = z
  .object({
    projectId: id,
    goal: z.string().trim().min(3).max(4000),
    budgetTokens: budgetTokens.optional(),
    budgetUsd: budgetUsd.optional(),
  })
  .strict();

export const estimateSchema = z.object({ projectId: id, goal: z.string().trim().min(3).max(4000) }).strict();

export const messageSchema = z.object({ text: z.string().trim().min(1).max(4000), agentId: id.optional() }).strict();

export const budgetSchema = z
  .object({
    budgetTokens: budgetTokens.optional(),
    budgetUsd: budgetUsd.optional(),
  })
  .strict()
  .refine((b) => b.budgetTokens !== undefined || b.budgetUsd !== undefined, { message: "set budgetTokens or budgetUsd" });

export const taskPatchSchema = z
  .object({
    status: z.enum(["queued", "cancelled"]).optional(),
    assigneeId: id.nullable().optional(),
    priority: z.number().int().min(-1000).max(1000).optional(),
  })
  .strict()
  .refine((p) => p.status !== undefined || p.assigneeId !== undefined || p.priority !== undefined, { message: "nothing to change" });

function param(c: Context, name: string): string {
  const r = id.safeParse(c.req.param(name));
  if (!r.success) throw new HttpError(422, "invalid_param", `${name}: invalid id`);
  return r.data;
}

export function createRunsRoutes(service: RunsServiceImpl): Hono {
  const r = new Hono();
  r.get("/", async (c) => c.json(await service.list()));
  r.post("/", async (c) => c.json(await service.create(await parseBody(c, createRunSchema)), 201));
  r.post("/estimate", async (c) => c.json(await service.estimate(await parseBody(c, estimateSchema))));
  r.get("/:id", async (c) => c.json(await service.snapshot(param(c, "id"))));
  r.post("/:id/pause", async (c) => c.json(await service.pause(param(c, "id"))));
  r.post("/:id/resume", async (c) => c.json(await service.resume(param(c, "id"))));
  r.post("/:id/stop", async (c) => c.json(await service.stop(param(c, "id"))));
  r.post("/:id/message", async (c) => {
    const runId = param(c, "id");
    await service.message(runId, await parseBody(c, messageSchema));
    return c.json({ ok: true as const });
  });
  r.patch("/:id/budget", async (c) => {
    const runId = param(c, "id");
    return c.json(await service.setBudget(runId, await parseBody(c, budgetSchema)));
  });
  r.patch("/:id/tasks/:taskId", async (c) => {
    const runId = param(c, "id");
    const taskId = param(c, "taskId");
    return c.json(await service.patchTask(runId, taskId, await parseBody(c, taskPatchSchema)));
  });
  r.post("/:id/agents/:agentId/stop", async (c) => c.json(await service.stopAgent(param(c, "id"), param(c, "agentId"))));
  r.get("/:id/calls", async (c) => c.json(await service.calls(param(c, "id"))));
  r.get("/:id/tools/:callId", async (c) => c.json(await service.toolCall(param(c, "id"), param(c, "callId"))));
  r.get("/:id/xray/:agentId", async (c) => c.json(await service.xray(param(c, "id"), param(c, "agentId"))));
  r.get("/:id/agents/:agentId/mind", async (c) => c.json(await service.mind(param(c, "id"), param(c, "agentId"))));
  return r;
}
