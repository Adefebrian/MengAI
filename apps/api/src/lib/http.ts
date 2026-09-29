// Route helpers shared by every module: one error shape, zod body parsing,
// typed ids. Handlers throw HttpError; core/app.ts turns it into JSON.
import type { Context } from "hono";
import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 501 | 503,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, code = "bad_request") => new HttpError(400, code, message);
export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);
export const conflict = (message: string) => new HttpError(409, "conflict", message);
export const forbidden = (message: string) => new HttpError(403, "forbidden", message);
export const unavailable = (message: string) => new HttpError(503, "unavailable", message);

/** Parse and validate a JSON body; throws 400/422 with the first issue. */
export async function parseBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Body must be JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join(".") || "body";
    throw new HttpError(422, "invalid_body", `${where}: ${issue?.message ?? "invalid"}`);
  }
  return result.data;
}

/** Parse query params with a zod schema (strings in, coerced out). */
export function parseQuery<S extends z.ZodTypeAny>(c: Context, schema: S): z.infer<S> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(422, "invalid_query", `${issue?.path.join(".") || "query"}: ${issue?.message ?? "invalid"}`);
  }
  return result.data;
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}
