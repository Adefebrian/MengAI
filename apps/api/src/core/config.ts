// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Builds the runtime configuration from the validated env. AppConfig (see
// module.ts) is what modules see; BootConfig adds the infra settings only the
// entrypoints and the container need (URLs, KEK, setup code, log level).
import { homedir } from "node:os";
import { join, resolve, win32 } from "node:path";
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
  /** local mode: websites (exact https origins) that serve a static copy of the UI and may call this engine */
  siteOrigins: string[];
}

export const APP_VERSION: string = pkg.version;

/** The official MengAI website, allowed by default so it can reach the engine on this Mac. */
export const OFFICIAL_SITE_ORIGIN = "https://mengai.adefebrian.com";
export const KEYCHAIN_SERVICE = "id.mengai.app";
export const SERVER_DEFAULT_PORT = 3001;

/** Default data dir for the desktop app: Application Support on macOS, %LOCALAPPDATA% on Windows. */
export function defaultLocalDataDir(home: string = homedir(), platform: NodeJS.Platform = process.platform, env: Record<string, string | undefined> = process.env): string {
  if (platform === "win32") return win32.join(env.LOCALAPPDATA && win32.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : win32.join(home, "AppData", "Local"), "MengAI");
  return join(home, "Library", "Application Support", "MengAI");
}

/** 32 random bytes, base64url, no padding. */
export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Buffer.from(buf).toString("base64url");
}

export function buildConfig(env: Env, opts: { home?: string; version?: string; platform?: NodeJS.Platform } = {}): BootConfig {
  const mode = env.MENGAI_MODE;
  const home = opts.home ?? homedir();
  const version = opts.version ?? APP_VERSION;

  const dataDir = resolve(env.MENGAI_DATA_DIR ?? env.DATA_DIR ?? (mode === "local" ? defaultLocalDataDir(home, opts.platform) : "/data"));
  const workspacesDir = resolve(
    env.MENGAI_WORKSPACES_DIR ?? env.WORKSPACES_DIR ?? (mode === "local" ? join(home, "MengAI") : join(dataDir, "workspaces")),
  );
  const webDirRaw = env.MENGAI_WEB_DIR ?? env.WEB_DIR;
  const webDir = webDirRaw ? resolve(webDirRaw) : null;

  // local mode: the exact Origin allowlist besides the engine's own origins
  // (those follow allowedHosts): the site origins and the UI dev origin.
  // Server mode: ALLOWED_ORIGINS, with credentials for cookie clients.
  // Unset means the official website; "none" turns every website off.
  const siteOrigins =
    mode !== "local"
      ? []
      : env.MENGAI_SITE_ORIGINS === undefined
        ? [OFFICIAL_SITE_ORIGIN]
        : env.MENGAI_SITE_ORIGINS.trim() === "none"
          ? []
          : parseOrigins(env.MENGAI_SITE_ORIGINS);
  const allowedOrigins =
    mode === "local" ? [...new Set([...siteOrigins, ...(env.MENGAI_UI_ORIGIN ? [env.MENGAI_UI_ORIGIN] : [])])] : parseOrigins(env.ALLOWED_ORIGINS);

  const app: AppConfig = {
    mode,
    version,
    dataDir,
    workspacesDir,
    webDir,
    allowedOrigins,
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
    siteOrigins,
  };
}

/** Host header values the local API accepts (DNS rebinding defense). */
export function localHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

/** The engine's own origins for those hosts (always on the Origin allowlist in local mode). */
export function localOrigins(port: number): string[] {
  return localHosts(port).map((host) => `http://${host}`);
}
