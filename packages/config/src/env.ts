// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Typed env schema for the MengAI API (local sidecar and self-hosted server).
//
// Validation is fail-fast but never runs at import time: importing this file
// must not throw, so tests can run with no environment at all. The entrypoints
// call loadEnv() once; tests call parseEnv(source) with an explicit object.
//
// Naming: the desktop shell passes MENGAI_* variables (sidecar contract in
// docs/architecture.md section 17). Server deployments use the plain names.
// When both are set, the MENGAI_* value wins.
import { z } from "zod";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type EnvLogLevel = (typeof LOG_LEVELS)[number];

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const optionalString = z.preprocess(blankToUndefined, z.string().trim().min(1).optional());

const port = z.preprocess(
  blankToUndefined,
  z.coerce.number().int().min(0, "port must be 0..65535").max(65535, "port must be 0..65535").optional(),
);

/** Exact origin: scheme://host[:port], no path, no wildcard. */
export function isExactOrigin(value: string): boolean {
  if (value.includes("*")) return false;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return u.origin === value;
  } catch {
    return false;
  }
}

/** Split a comma separated origin list into a clean allowlist. */
export function parseOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin.length > 0);
}

/** Exact https origin (the public websites that serve the UI). */
export function isHttpsOrigin(value: string): boolean {
  return isExactOrigin(value) && value.startsWith("https://");
}

/** Exact http(s) origin on 127.0.0.1 or localhost with an explicit port. */
export function isLoopbackOrigin(value: string): boolean {
  if (!isExactOrigin(value)) return false;
  const u = new URL(value);
  return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.port !== "";
}

/** Decodes a base64 (or base64url) string; null when it is not valid base64. */
export function decodeBase64(value: string): Uint8Array | null {
  const clean = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  try {
    return Uint8Array.from(atob(clean.padEnd(Math.ceil(clean.length / 4) * 4, "=")), (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

const databaseUrl = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .refine((v) => /^(postgres(ql)?|sqlite):\/\//.test(v), "DATABASE_URL must start with postgres://, postgresql:// or sqlite://")
    .optional(),
);

const redisUrl = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .refine((v) => /^rediss?:\/\//.test(v), "REDIS_URL must start with redis:// or rediss://")
    .optional(),
);

const httpUrl = z.preprocess(blankToUndefined, z.string().trim().url().optional());

export const envSchema = z
  .object({
    MENGAI_MODE: z.preprocess(blankToUndefined, z.enum(["local", "server"]).default("server")),
    PORT: port,
    MENGAI_PORT: port,
    HOST: optionalString,
    DATA_DIR: optionalString,
    MENGAI_DATA_DIR: optionalString,
    WORKSPACES_DIR: optionalString,
    MENGAI_WORKSPACES_DIR: optionalString,
    WEB_DIR: optionalString,
    MENGAI_WEB_DIR: optionalString,
    /** bundled automation helper (local mode, passed by the desktop shell) */
    MENGAI_HANDS_BIN: optionalString,
    /** folder holding migrations/<dialect>/*.sql when the default location does not exist (compiled sidecar) */
    MENGAI_MIGRATIONS_DIR: optionalString,
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    S3_ENDPOINT: httpUrl,
    S3_REGION: optionalString,
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    /** 32 random bytes, base64. Wraps every per-secret data key of the envelope vault. */
    VAULT_KEK: optionalString,
    ALLOWED_ORIGINS: z.preprocess(blankToUndefined, z.string().optional()),
    /**
     * local mode: websites that serve a static copy of the MengAI UI and may
     * call the engine on this machine. Comma separated exact https origins
     * (https://host[:port]), no path, no wildcard. Checked at boot.
     */
    MENGAI_SITE_ORIGINS: z.preprocess(blankToUndefined, z.string().optional()),
    /**
     * local mode, development only: the origin serving the UI when it is not
     * the engine itself (for example http://localhost:3000 from apps/web dev).
     * One exact loopback origin with an explicit port.
     */
    MENGAI_UI_ORIGIN: z.preprocess(
      (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim().replace(/\/+$/, "")) : v),
      z.string().refine(isLoopbackOrigin, "MENGAI_UI_ORIGIN must be one exact loopback origin with a port (http://localhost:<port> or http://127.0.0.1:<port>)").optional(),
    ),
    /** one-time code required to create the owner account on first run (server mode) */
    SETUP_CODE: z.preprocess(blankToUndefined, z.string().trim().min(12, "SETUP_CODE must be at least 12 characters").max(256).optional()),
    LOG_LEVEL: z.preprocess(blankToUndefined, z.enum(LOG_LEVELS).default("info")),
    /** reverse proxy hops to trust for X-Forwarded-For (0 = use the socket peer address) */
    TRUST_PROXY: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(5).default(0)),
  })
  .superRefine((env, ctx) => {
    for (const origin of parseOrigins(env.ALLOWED_ORIGINS)) {
      if (!isExactOrigin(origin)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ALLOWED_ORIGINS"],
          message: `"${origin}" is not an exact origin (scheme://host[:port], no path, no wildcard)`,
        });
      }
    }
    for (const origin of parseOrigins(env.MENGAI_SITE_ORIGINS)) {
      if (!isHttpsOrigin(origin)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["MENGAI_SITE_ORIGINS"],
          message: `"${origin}" is not an exact https origin (https://host[:port], no path, no wildcard)`,
        });
      }
    }
    if (env.VAULT_KEK !== undefined) {
      const bytes = decodeBase64(env.VAULT_KEK);
      if (!bytes || bytes.length !== 32) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["VAULT_KEK"], message: "VAULT_KEK must be 32 bytes, base64 encoded" });
      }
    }
    if (env.MENGAI_MODE === "server") {
      if (env.VAULT_KEK === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["VAULT_KEK"], message: "VAULT_KEK is required in server mode" });
      }
      if (env.DATABASE_URL === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["DATABASE_URL"], message: "DATABASE_URL is required in server mode" });
      }
      const s3 = [env.S3_ENDPOINT, env.S3_BUCKET, env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY];
      const set = s3.filter((v) => v !== undefined).length;
      if (set > 0 && set < s3.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["S3_ENDPOINT"],
          message: "S3 needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY together (or none for the fs fallback)",
        });
      }
    }
    if (env.MENGAI_MODE === "local" && env.HOST !== undefined && !["127.0.0.1", "localhost", "::1"].includes(env.HOST)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["HOST"], message: "local mode only binds to loopback (127.0.0.1)" });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Pure parse, no caching. Throws one readable error listing every issue. Never echoes values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Parse process.env once (entrypoints only). */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  if (!cached) cached = parseEnv(source);
  return cached;
}
