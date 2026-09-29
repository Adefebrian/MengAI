// Typed env schema shared by every app in the monorepo.
//
// Validation is fail-fast, but deliberately NOT run at module import time:
// importing this file must never throw, so that test files (which import
// apps' route modules, which in turn may import this file) can run with
// zero environment configured and no live Postgres, Redis, or S3 endpoint.
//
// Call `loadEnv()` explicitly at the one place that actually needs a fully
// validated environment: the real server entrypoint's `if (import.meta.main)`
// block, never from a route handler or from the top of a module.
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url().default("postgres://user:password@localhost:5432/app"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  S3_ENDPOINT: z.string().url().default("https://s3.datacenter.jalgroup.id"),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(1).default("app"),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Parse and validate `process.env` against the shared schema. Throws a
 * readable error on the first call if something required is malformed.
 * Safe to call more than once, the result is cached after the first parse.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = result.data;
  return cached;
}

/** Split a comma-separated CORS_ORIGINS value into a clean allowlist. */
export function parseCorsOrigins(value: string): string[] {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
