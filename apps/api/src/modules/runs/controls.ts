// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Argument parsing for the control tools the runs module executes inline.
// The tools module owns the JSON schemas the model sees; models still drift
// (a string where a list is expected, "description" instead of "spec"), so
// these parsers accept the common variants and normalize them. A parse
// failure goes back to the model as a tool error, never as an exception.
import { AGENT_ROLES, SEVERITIES, type AgentRole, type Severity } from "@mengai/shared";
import { z } from "zod";

export const CONTROL_TOOLS = [
  "finish",
  "note",
  "ask_human",
  "handoff",
  "create_tasks",
  "update_task",
  "list_tasks",
  "crew_status",
  "submit_review",
  "report_issue",
] as const;
export type ControlTool = (typeof CONTROL_TOOLS)[number];

export function isControlTool(name: string): name is ControlTool {
  return (CONTROL_TOOLS as readonly string[]).includes(name);
}

const text = z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v.join("\n") : v));

const list = z
  .union([z.array(z.string()), z.string()])
  .transform((v) =>
    (typeof v === "string" ? v.split(/\n+/) : v).map((s) => s.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean),
  );

const role = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.enum(AGENT_ROLES));

const idLike = z.union([z.string(), z.number()]).transform((v) => String(v).trim());

export const finishArgs = z
  .object({
    summary: text.optional(),
    result: text.optional(),
    text: text.optional(),
    files: list.optional(),
    outcome: z.string().optional(),
  })
  .passthrough()
  .transform((a) => ({
    summary: a.summary ?? a.result ?? a.text ?? "",
    files: (a.files ?? []).slice(0, 50),
    blocked: a.outcome?.trim().toLowerCase() === "blocked",
  }));

export const noteArgs = z
  .object({ text: text.optional(), note: text.optional(), status: text.optional(), message: text.optional() })
  .passthrough()
  .transform((a) => ({ text: a.text ?? a.note ?? a.status ?? a.message ?? "" }))
  .refine((a) => a.text.trim().length > 0, { message: "text is required" });

export const askHumanArgs = z
  .object({ question: text.optional(), text: text.optional(), message: text.optional(), options: list.optional() })
  .passthrough()
  .transform((a) => {
    const q = a.question ?? a.text ?? a.message ?? "";
    const options = (a.options ?? []).slice(0, 6);
    return { question: options.length ? `${q}\nOptions: ${options.join(" | ")}` : q };
  })
  .refine((a) => a.question.trim().length > 0, { message: "question is required" });

export const handoffArgs = z
  .object({
    to_role: role.optional(),
    role: role.optional(),
    to: role.optional(),
    title: z.string().optional(),
    spec: text.optional(),
    task: text.optional(),
    description: text.optional(),
    acceptance: list.optional(),
    summary: text.optional(),
    context: text.optional(),
    role_title: z.string().optional().catch(undefined),
    roleTitle: z.string().optional().catch(undefined),
  })
  .passthrough()
  .transform((a) => {
    const spec = a.spec ?? a.task ?? a.description ?? "";
    return {
      toRole: (a.to_role ?? a.role ?? a.to) as AgentRole | undefined,
      title: (a.title ?? "").trim() || spec.trim().split("\n")[0]!.slice(0, 80),
      spec,
      acceptance: a.acceptance ?? [],
      summary: a.summary ?? a.context ?? "",
      /** a specialist title on top of toRole ("Launch tester"): a dynamic role */
      roleTitle: (a.role_title ?? a.roleTitle ?? "").trim() || null,
    };
  })
  .refine((a) => !!a.toRole, { message: "to_role is required" })
  .refine((a) => a.title.length > 0, { message: "title or spec is required" });

const depRef = z.union([z.string(), z.number()]);

const taskItem = z
  .object({
    id: idLike.optional(),
    key: idLike.optional(),
    title: z.string().trim().min(1).max(200),
    spec: text.optional(),
    description: text.optional(),
    details: text.optional(),
    acceptance: list.optional(),
    acceptance_criteria: list.optional(),
    role,
    deps: z.array(depRef).optional(),
    depends_on: z.array(depRef).optional(),
    dependencies: z.array(depRef).optional(),
    review: z.boolean().optional().catch(undefined),
    priority: z.number().optional().catch(undefined),
    role_title: z.string().optional().catch(undefined),
    roleTitle: z.string().optional().catch(undefined),
  })
  .passthrough()
  .transform((t) => ({
    key: t.key ?? t.id ?? null,
    title: t.title,
    spec: t.spec ?? t.description ?? t.details ?? "",
    acceptance: t.acceptance ?? t.acceptance_criteria ?? [],
    role: t.role as AgentRole,
    deps: (t.deps ?? t.depends_on ?? t.dependencies ?? []) as Array<string | number>,
    review: t.review ?? false,
    priority: Math.max(-1000, Math.min(1000, Math.round(t.priority ?? 0))),
    /** a specialist title on top of role ("Launch tester"): a dynamic role */
    roleTitle: (t.role_title ?? t.roleTitle ?? "").trim() || null,
  }));

export type PlannedTask = z.output<typeof taskItem>;

export const createTasksArgs = z.object({ tasks: z.array(taskItem).min(1) }).passthrough();

export const updateTaskArgs = z
  .object({
    task_id: idLike.optional(),
    id: idLike.optional(),
    task: idLike.optional(),
    status: z.string().optional(),
    priority: z.number().optional(),
    title: z.string().optional(),
    spec: text.optional(),
    acceptance: list.optional(),
    note: text.optional(),
  })
  .passthrough()
  .transform((a) => ({
    ref: a.task_id ?? a.id ?? a.task ?? "",
    status: a.status?.trim().toLowerCase(),
    priority: a.priority,
    title: a.title?.trim(),
    spec: a.spec,
    acceptance: a.acceptance,
    note: a.note,
  }))
  .refine((a) => a.ref.length > 0, { message: "task_id is required" });

export const listTasksArgs = z
  .object({ status: z.string().optional() })
  .passthrough()
  .transform((a) => ({ status: a.status?.trim().toLowerCase() }));

const PASS = new Set(["pass", "passed", "approve", "approved", "accept", "accepted", "ok", "lgtm", "yes"]);
const FAIL = new Set(["fail", "failed", "reject", "rejected", "changes_requested", "request_changes", "needs_work", "no"]);

const issueItem = z.union([
  z.string(),
  z
    .object({ title: z.string().optional(), detail: z.string().optional(), description: z.string().optional(), severity: z.string().optional() })
    .passthrough()
    .transform((i) => [i.severity ? `[${i.severity}]` : "", i.title ?? "", i.detail ?? i.description ?? ""].filter(Boolean).join(" ")),
]);

export const submitReviewArgs = z
  .object({
    verdict: z.string().optional(),
    approved: z.boolean().optional(),
    passed: z.boolean().optional(),
    notes: z.union([text, list]).optional(),
    summary: text.optional(),
    comments: text.optional(),
    issues: z.array(issueItem).optional(),
  })
  .passthrough()
  .transform((a) => {
    const v = a.verdict?.trim().toLowerCase().replace(/\s+/g, "_");
    const verdict: "pass" | "fail" | null =
      v && PASS.has(v) ? "pass" : v && FAIL.has(v) ? "fail" : a.approved ?? a.passed ? "pass" : a.approved === false || a.passed === false ? "fail" : null;
    const notes = [
      ...(Array.isArray(a.notes) ? a.notes : a.notes ? [a.notes] : []),
      ...(a.summary ? [a.summary] : []),
      ...(a.comments ? [a.comments] : []),
      ...(a.issues ?? []),
    ]
      .map((s) => s.trim())
      .filter(Boolean);
    return { verdict, notes };
  })
  .refine((a) => a.verdict !== null, { message: "verdict must be pass or fail" });

export const reportIssueArgs = z
  .object({
    title: z.string().optional(),
    detail: text.optional(),
    description: text.optional(),
    severity: z.string().optional(),
    file: z.string().optional(),
    line: z.number().optional(),
    fix: text.optional(),
  })
  .passthrough()
  .transform((a) => {
    const sev = a.severity?.trim().toLowerCase();
    const base = a.detail ?? a.description ?? "";
    const detail = a.fix ? `${base}\nFix: ${a.fix}` : base;
    return {
      title: (a.title ?? "").trim() || detail.trim().split("\n")[0]!.slice(0, 120),
      detail,
      severity: ((SEVERITIES as readonly string[]).includes(sev ?? "") ? sev : "medium") as Severity,
      where: a.file ? `${a.file}${a.line ? `:${a.line}` : ""}` : null,
    };
  })
  .refine((a) => a.title.length > 0, { message: "title is required" });

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** JSON-decode then validate; the error text is written for the model to fix its call. */
export function parseArgs<S extends z.ZodTypeAny>(tool: string, schema: S, raw: string): ParseResult<z.output<S>> {
  let data: unknown;
  try {
    data = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return { ok: false, error: `Invalid arguments for ${tool}: not valid JSON.` };
  }
  const res = schema.safeParse(data ?? {});
  if (!res.success) {
    const issue = res.error.issues[0];
    const where = issue?.path.join(".") || "arguments";
    return { ok: false, error: `Invalid arguments for ${tool}: ${where}: ${issue?.message ?? "invalid"}.` };
  }
  return { ok: true, value: res.data };
}

/**
 * Resolve create_tasks dependency references to task ids. A reference can be
 * a key given in the same call, a 1-based position in the call, an existing
 * task id, or an exact title (same call first, then the run).
 */
export function resolveDeps(
  planned: PlannedTask[],
  newIds: string[],
  existing: Array<{ id: string; title: string }>,
): { ok: true; deps: string[][] } | { ok: false; error: string } {
  const byKey = new Map<string, number>();
  planned.forEach((p, i) => {
    if (p.key) byKey.set(p.key.toLowerCase(), i);
  });
  const byTitle = new Map<string, number>();
  planned.forEach((p, i) => byTitle.set(p.title.toLowerCase(), i));
  const existingIds = new Set(existing.map((e) => e.id));
  const existingByTitle = new Map(existing.map((e) => [e.title.toLowerCase(), e.id] as const));

  const out: string[][] = [];
  for (let i = 0; i < planned.length; i++) {
    const deps = new Set<string>();
    for (const ref of planned[i]!.deps) {
      let target: string | undefined;
      if (typeof ref === "number") {
        const idx = ref >= 1 && ref <= planned.length ? ref - 1 : ref === 0 ? 0 : -1;
        if (idx >= 0) target = newIds[idx];
      } else {
        const r = ref.trim();
        const low = r.toLowerCase();
        if (byKey.has(low)) target = newIds[byKey.get(low)!];
        else if (existingIds.has(r)) target = r;
        else if (/^\d+$/.test(r) && Number(r) >= 1 && Number(r) <= planned.length) target = newIds[Number(r) - 1];
        else if (byTitle.has(low)) target = newIds[byTitle.get(low)!];
        else if (existingByTitle.has(low)) target = existingByTitle.get(low);
      }
      if (!target) return { ok: false, error: `Unknown dependency "${String(ref)}" in task "${planned[i]!.title}". Use a key from this call, a position, or an existing task id.` };
      if (target !== newIds[i]) deps.add(target);
    }
    out.push([...deps]);
  }
  // cycle check inside the batch (existing tasks cannot depend on new ones)
  const index = new Map(newIds.map((id, i) => [id, i] as const));
  const state = new Array<number>(planned.length).fill(0);
  const visit = (i: number): boolean => {
    if (state[i] === 1) return false;
    if (state[i] === 2) return true;
    state[i] = 1;
    for (const d of out[i]!) {
      const j = index.get(d);
      if (j !== undefined && !visit(j)) return false;
    }
    state[i] = 2;
    return true;
  };
  for (let i = 0; i < planned.length; i++) {
    if (!visit(i)) return { ok: false, error: "The dependencies form a cycle. Every task must depend only on earlier work." };
  }
  return { ok: true, deps: out };
}
