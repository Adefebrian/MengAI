// Builds the runtime configuration from the validated env. AppConfig (see
// module.ts) is what modules see; BootConfig adds the infra settings only the
// entrypoints and the container need (URLs, KEK, setup code, log level).
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { decodeBase64, parseOrigins, type Env } from "@mengai/config";
import pkg from "../../package.json";
import type { AppConfig } from "./module";
import type { LogLevel } from "./ports/logger";

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string | null;
}

export interface BootConfig {
  app: AppConfig;
  host: string;
  /** 0 means a random free port (local mode default) */
  port: number;
  /** postgres://... or sqlite://<path> */
  databaseUrl: string;
  redisUrl: string | null;
  s3: S3Config | null;
  /** raw 32 byte key encryption key for the envelope vault; null in local mode */
  vaultKek: Uint8Array | null;
  setupCode: string | null;
  logLevel: LogLevel;
  handsBin: string | null;
  trustProxy: number;
  migrationsDir: string | null;
}

export const APP_VERSION: string = pkg.version;
export const KEYCHAIN_SERVICE = "id.mengai.app";
export const SERVER_DEFAULT_PORT = 3001;

/** Default data dir on macOS for the desktop app. */
export function defaultLocalDataDir(home: string = homedir()): string {
  return join(home, "Library", "Application Support", "MengAI");
}

/** 32 random bytes, base64url, no padding. */
export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Buffer.from(buf).toString("base64url");
}

export function buildConfig(env: Env, opts: { home?: string; version?: string } = {}): BootConfig {
  const mode = env.MENGAI_MODE;
  const home = opts.home ?? homedir();
  const version = opts.version ?? APP_VERSION;

  const dataDir = resolve(env.MENGAI_DATA_DIR ?? env.DATA_DIR ?? (mode === "local" ? defaultLocalDataDir(home) : "/data"));
  const workspacesDir = resolve(
    env.MENGAI_WORKSPACES_DIR ?? env.WORKSPACES_DIR ?? (mode === "local" ? join(home, "MengAI") : join(dataDir, "workspaces")),
  );
  const webDirRaw = env.MENGAI_WEB_DIR ?? env.WEB_DIR;
  const webDir = webDirRaw ? resolve(webDirRaw) : null;

  const app: AppConfig = {
    mode,
    version,
    dataDir,
    workspacesDir,
    webDir,
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    // local mode: filled with 127.0.0.1:<port> and localhost:<port> once listening
    allowedHosts: [],
    controlToken: mode === "local" ? randomToken() : null,
  };

  const s3 =
    env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? {
          endpoint: env.S3_ENDPOINT,
          bucket: env.S3_BUCKET,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          region: env.S3_REGION ?? null,
        }
      : null;

  return {
    app,
    host: mode === "local" ? "127.0.0.1" : (env.HOST ?? "0.0.0.0"),
    port: mode === "local" ? (env.MENGAI_PORT ?? env.PORT ?? 0) : (env.PORT ?? env.MENGAI_PORT ?? SERVER_DEFAULT_PORT),
    databaseUrl: env.DATABASE_URL ?? `sqlite://${join(dataDir, "app.db")}`,
    // local mode always uses the in-memory kv and the local blob dir
    redisUrl: mode === "server" ? (env.REDIS_URL ?? null) : null,
    s3: mode === "server" ? s3 : null,
    vaultKek: mode === "server" && env.VAULT_KEK ? decodeBase64(env.VAULT_KEK) : null,
    setupCode: mode === "server" ? (env.SETUP_CODE ?? null) : null,
    logLevel: env.LOG_LEVEL,
    handsBin: mode === "local" ? (env.MENGAI_HANDS_BIN ?? null) : null,
    trustProxy: mode === "local" ? 0 : env.TRUST_PROXY,
    migrationsDir: env.MENGAI_MIGRATIONS_DIR ? resolve(env.MENGAI_MIGRATIONS_DIR) : null,
  };
}

/** Host header values the local API accepts (DNS rebinding defense). */
export function localHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}
