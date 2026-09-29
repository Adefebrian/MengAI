// Platform bootstrap (W1). Builds the ports for the mode, applies
// migrations, and wires the platform modules (events, settings, auth,
// health) plus the kill switch into the app. core/container.ts replaces this
// in the integration wave and adds every other module; until then the
// entrypoints and index.test.ts use it.
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AutomationStatus } from "@mengai/shared";
import type { Hono } from "hono";
import { createAuthModule } from "../modules/auth";
import { createEventsModule } from "../modules/events";
import { createHealthModule, type HealthDeps } from "../modules/health";
import { createSettingsModule } from "../modules/settings";
import { createDb } from "./adapters/db-bunsql";
import { createFsBlobStore } from "./adapters/blob-fs";
import { createS3BlobStore } from "./adapters/blob-s3";
import { createMemoryKv } from "./adapters/kv-memory";
import { connectRedisKv, type RedisKv } from "./adapters/kv-redis";
import { createKeychainVault } from "./adapters/vault-keychain";
import { createEnvelopeVault } from "./adapters/vault-envelope";
import { createApp } from "./app";
import { KEYCHAIN_SERVICE, type BootConfig } from "./config";
import { createKillSwitch, type KillSwitchImpl } from "./killswitch";
import { createAppLogger } from "./logger";
import { applyMigrations, MIGRATIONS_ROOT } from "./migrate";
import type { ModuleContext, MountedModule } from "./module";
import type { BlobStore } from "./ports/blob";
import { systemClock, type Clock } from "./ports/clock";
import type { Db } from "./ports/db";
import type { Kv } from "./ports/kv";
import type { Logger } from "./ports/logger";
import type { Vault } from "./ports/vault";

export interface BootstrapOptions {
  boot: BootConfig;
  logger?: Logger;
  /** tests and the desktop build can inject ports */
  overrides?: Partial<{ db: Db; kv: Kv; blob: BlobStore; vault: Vault; clock: Clock }>;
  health?: Partial<HealthDeps>;
  /** apply migrations on boot (default true) */
  migrate?: boolean;
}

export interface Platform {
  app: Hono;
  ctx: ModuleContext;
  modules: {
    events: ReturnType<typeof createEventsModule>;
    settings: ReturnType<typeof createSettingsModule>;
    auth: ReturnType<typeof createAuthModule>;
    health: ReturnType<typeof createHealthModule>;
  };
  killswitch: KillSwitchImpl;
  close(): Promise<void>;
}

const AUTOMATION_OFF: AutomationStatus = {
  available: false,
  reason: "automation module not wired yet",
  permissions: { accessibility: false, screen: false },
  active: false,
};

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function bootstrap(opts: BootstrapOptions): Promise<Platform> {
  const { boot } = opts;
  const config = boot.app;
  const logger = opts.logger ?? createAppLogger(boot.logLevel, { mode: config.mode });
  const clock = opts.overrides?.clock ?? systemClock;

  if (!opts.overrides?.db && boot.databaseUrl.startsWith("sqlite://")) {
    await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  }
  const db = opts.overrides?.db ?? createDb({ url: boot.databaseUrl });

  if (opts.migrate !== false) {
    const root = boot.migrationsDir ?? MIGRATIONS_ROOT;
    if (!(await isDir(join(root, db.dialect)))) throw new Error(`migrations folder not found for ${db.dialect} (set MENGAI_MIGRATIONS_DIR)`);
    const applied = await applyMigrations(db, root);
    if (applied.length) logger.log("info", "migrations applied", { applied });
  }

  let redis: RedisKv | null = null;
  let kv: Kv;
  if (opts.overrides?.kv) kv = opts.overrides.kv;
  else if (config.mode === "server" && boot.redisUrl) {
    redis = await connectRedisKv(boot.redisUrl, logger);
    kv = redis ?? createMemoryKv({ maxEntries: 50_000 });
  } else {
    if (config.mode === "server") logger.log("warn", "REDIS_URL not set, using the in-memory kv (rate limits are per process)");
    kv = createMemoryKv({ maxEntries: 20_000 });
  }

  let blob: BlobStore;
  if (opts.overrides?.blob) blob = opts.overrides.blob;
  else if (config.mode === "server" && boot.s3) blob = createS3BlobStore(boot.s3);
  else {
    if (config.mode === "server") logger.log("warn", "S3 not configured, storing blobs under DATA_DIR/blobs");
    blob = createFsBlobStore(config.dataDir);
  }

  let vault: Vault;
  if (opts.overrides?.vault) vault = opts.overrides.vault;
  else if (config.mode === "local") vault = createKeychainVault(KEYCHAIN_SERVICE);
  else {
    if (!boot.vaultKek) throw new Error("VAULT_KEK is required in server mode");
    vault = await createEnvelopeVault({ db, kek: boot.vaultKek, clock });
  }

  // events first: its service is the EventSink every other module publishes to
  const events = createEventsModule({ db, clock, logger: logger.child({ module: "events" }) });
  const ctx: ModuleContext = { config, db, kv, blob, vault, clock, logger, events: events.service };

  const settings = createSettingsModule(ctx);
  const auth = createAuthModule(ctx, { setupCode: boot.setupCode });
  const health = createHealthModule(ctx, {
    llmConfigured: opts.health?.llmConfigured ?? (() => false),
    jevConfigured: opts.health?.jevConfigured ?? (() => false),
    automationStatus: opts.health?.automationStatus ?? (() => AUTOMATION_OFF),
  });
  const killswitch = createKillSwitch({ events: events.service, logger });

  if (config.mode === "server" && !boot.setupCode) {
    const sessionInfo = await auth.service.sessionInfo(null);
    if (sessionInfo.needsSetup) logger.log("warn", "no owner account yet and SETUP_CODE is not set: setup is disabled");
  }

  const mounted: MountedModule[] = [health, auth, settings, events];
  const app = createApp({ config, modules: mounted, killswitch, auth: auth.sessionAuth, kv, logger, trustProxy: boot.trustProxy });

  return {
    app,
    ctx,
    modules: { events, settings, auth, health },
    killswitch,
    async close() {
      for (const m of mounted) {
        try {
          await m.close?.();
        } catch (err) {
          logger.log("warn", "module close failed", { module: m.name, error: err instanceof Error ? err.message : String(err) });
        }
      }
      redis?.close();
      if (!opts.overrides?.db) await db.close();
    },
  };
}
