// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Composition root. Builds the ports for the mode, applies migrations, then
// creates every module in dependency order (docs/architecture.md section 17)
// and mounts them through core/app.ts. Cross-module wiring happens only here:
// each module receives the services it needs, typed by core/services.ts, and
// is reached only through its index.ts.
//
// Local computer control is not part of this build: automation is null
// everywhere and health reports it unavailable.
//
// Local mode has no login or token: the local guard in core/hardening.ts
// (Host, exact Origin allowlist, JSON-only mutations) is the trust boundary.
//
// Capabilities: connectors (MCP servers and HTTP APIs) feed the tools bridge
// and the trading venue; trading (paper broker, live gate) feeds the tools
// bridge; companies (studio, fund templates) feed the runs engine. The kill
// switch also kills every MCP server process and cancels open orders.
import { mkdir } from "node:fs/promises";
import type { AutomationStatus } from "@mengai/shared";
import type { Hono } from "hono";
import { createAssetsModule } from "../modules/assets";
import { createAuthModule } from "../modules/auth";
import { createCompaniesModule } from "../modules/companies";
import { createConnectorsModule, type ConnectorsOptions } from "../modules/connectors";
import { createContextModule } from "../modules/context";
import { createEvalsModule } from "../modules/evals";
import { createEventsModule } from "../modules/events";
import { createHealthModule, type HealthDeps } from "../modules/health";
import { createJevModule } from "../modules/jev";
import { createMemoryModule } from "../modules/memory";
import { createPreviewModule, type PreviewOptions } from "../modules/preview";
import { createProjectsModule } from "../modules/projects";
import { createProvidersModule } from "../modules/providers";
import { createRunsModule } from "../modules/runs";
import { createSecurityModule } from "../modules/security";
import { createSettingsModule } from "../modules/settings";
import { createToolsModule } from "../modules/tools";
import { createTradingModule } from "../modules/trading";
import { createUsageModule } from "../modules/usage";
import { createWorkspaceModule } from "../modules/workspace";
import { redact } from "../lib/redact";
import { createDb } from "./adapters/db-bunsql";
import { createFsBlobStore } from "./adapters/blob-fs";
import { createS3BlobStore } from "./adapters/blob-s3";
import { createMemoryKv } from "./adapters/kv-memory";
import { connectRedisKv, type RedisKv } from "./adapters/kv-redis";
import { createPlainRunner } from "./adapters/runner-plain";
import { createSeatbeltRunner } from "./adapters/runner-seatbelt";
import { createKeychainVault } from "./adapters/vault-keychain";
import { createEnvelopeVault } from "./adapters/vault-envelope";
import { createApp } from "./app";
import { KEYCHAIN_SERVICE, type BootConfig } from "./config";
import { createDemoRouter, seedDemo, type DemoOptions, type DemoSeed } from "./demo";
import { createKillSwitch, type KillSwitchImpl } from "./killswitch";
import { createAppLogger } from "./logger";
import { applyMigrations } from "./migrate";
import type { ModuleContext, MountedModule } from "./module";
import type { BlobStore } from "./ports/blob";
import { systemClock, type Clock } from "./ports/clock";
import type { Db } from "./ports/db";
import type { Kv } from "./ports/kv";
import type { LlmRouter } from "./ports/llm";
import type { Logger } from "./ports/logger";
import type { Runner } from "./ports/runner";
import type { Vault } from "./ports/vault";
import { ApprovalDeniedError, type AutomationService, type KillSwitch } from "./services";

export interface ContainerOptions {
  boot: BootConfig;
  logger?: Logger;
  /** tests and the desktop build can inject ports */
  overrides?: Partial<{ db: Db; kv: Kv; blob: BlobStore; vault: Vault; clock: Clock; runner: Runner }>;
  health?: Partial<HealthDeps>;
  /** apply migrations on boot (default true) */
  migrate?: boolean;
  /** scripted demo crew instead of the owner's providers for runs (MENGAI_DEMO=1) */
  demo?: boolean | DemoOptions;
  /** tests inject the MCP process spawner, fetch and DNS for connectors */
  connectors?: ConnectorsOptions;
  /** tests inject the dev server spawner, probe fetch and folder opener for live preview */
  preview?: PreviewOptions;
}

export interface Container {
  app: Hono;
  ctx: ModuleContext;
  modules: {
    events: ReturnType<typeof createEventsModule>;
    settings: ReturnType<typeof createSettingsModule>;
    auth: ReturnType<typeof createAuthModule>;
    usage: ReturnType<typeof createUsageModule>;
    providers: ReturnType<typeof createProvidersModule>;
    jev: ReturnType<typeof createJevModule>;
    workspace: ReturnType<typeof createWorkspaceModule>;
    preview: ReturnType<typeof createPreviewModule>;
    projects: ReturnType<typeof createProjectsModule>;
    context: ReturnType<typeof createContextModule>;
    memory: ReturnType<typeof createMemoryModule>;
    assets: ReturnType<typeof createAssetsModule>;
    security: ReturnType<typeof createSecurityModule>;
    tools: ReturnType<typeof createToolsModule>;
    connectors: ReturnType<typeof createConnectorsModule>;
    trading: ReturnType<typeof createTradingModule>;
    companies: ReturnType<typeof createCompaniesModule>;
    runs: ReturnType<typeof createRunsModule>;
    evals: ReturnType<typeof createEvalsModule>;
    health: ReturnType<typeof createHealthModule>;
  };
  killswitch: KillSwitchImpl;
  runner: Runner;
  /** demo mode: what the first boot seeded (null when projects existed); null outside demo mode */
  demo: { seed: DemoSeed | null } | null;
  close(): Promise<void>;
}

export const AUTOMATION_REASON = "not included in this build";

export const AUTOMATION_OFF: AutomationStatus = {
  available: false,
  reason: AUTOMATION_REASON,
  permissions: { accessibility: false, screen: false },
  active: false,
};

/**
 * Stand-in for modules whose deps type does not accept null yet (runs):
 * reports automation unavailable and refuses every action.
 */
const automationUnavailable: AutomationService = {
  status: async () => AUTOMATION_OFF,
  authorize: async () => {
    throw new ApprovalDeniedError(`local automation is ${AUTOMATION_REASON}`, null);
  },
  perform: async () => {
    throw new ApprovalDeniedError(`local automation is ${AUTOMATION_REASON}`, null);
  },
  audit: async () => {
    throw new Error(`local automation is ${AUTOMATION_REASON}`);
  },
};

export type RunnerKind = "seatbelt" | "plain";

/** macOS jails agent commands with Seatbelt; Linux (the server image) uses the plain runner. */
export function runnerKind(platform: NodeJS.Platform = process.platform): RunnerKind {
  return platform === "darwin" ? "seatbelt" : "plain";
}

function createRunner(dataDir: string): Runner {
  return runnerKind() === "seatbelt" ? createSeatbeltRunner({ dataDir }) : createPlainRunner();
}

/**
 * Module kill hooks are namespaced by the container ("runs" becomes
 * "runs.orchestrator"), so a module hook never collides with one the host
 * registers. The runs prefix keeps the count under stoppedRuns.
 */
function namespacedKillSwitch(ks: KillSwitch, suffix: string): KillSwitch {
  return {
    register: (name, hook) => ks.register(`${name}.${suffix}`, hook),
    trigger: (by) => ks.trigger(by),
  };
}

const errText = (e: unknown) => redact(e instanceof Error ? e.message : String(e));

/** MENGAI_DEMO and friends: "1", "true" or "yes" turn a flag on. */
export function envFlag(value: string | undefined): boolean {
  return /^(1|true|yes)$/i.test((value ?? "").trim());
}

export async function createContainer(opts: ContainerOptions): Promise<Container> {
  const { boot } = opts;
  const config = boot.app;
  const logger = opts.logger ?? createAppLogger(boot.logLevel, { mode: config.mode });
  const clock = opts.overrides?.clock ?? systemClock;
  const demoOpts: DemoOptions | null = opts.demo ? (opts.demo === true ? {} : opts.demo) : null;

  // ------------------------------------------------------------- ports
  if (!opts.overrides?.db && boot.databaseUrl.startsWith("sqlite://")) {
    await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  }
  const db = opts.overrides?.db ?? createDb({ url: boot.databaseUrl });
  let redis: RedisKv | null = null;
  let infraClosed = false;
  const closeInfra = async () => {
    if (infraClosed) return;
    infraClosed = true;
    redis?.close();
    if (!opts.overrides?.db) await db.close();
  };

  try {
    if (opts.migrate !== false) {
      // embedded SQL unless MENGAI_MIGRATIONS_DIR points at a folder
      const applied = await applyMigrations(db, boot.migrationsDir);
      if (applied.length) logger.log("info", "migrations applied", { applied });
    }

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

    const runner = opts.overrides?.runner ?? createRunner(config.dataDir);
    const automation: AutomationService | null = null;

    // ----------------------------------------------------------- modules
    // events first: its service is the EventSink every other module publishes to
    const events = createEventsModule({ db, clock, logger: logger.child({ module: "events" }) });
    const ctx: ModuleContext = { config, db, kv, blob, vault, clock, logger, events: events.service };
    const killswitch = createKillSwitch({ events: events.service, logger });

    const settings = createSettingsModule(ctx);
    const auth = createAuthModule(ctx, { setupCode: boot.setupCode });
    const usage = createUsageModule(ctx, { settings: settings.service });
    const providers = createProvidersModule(ctx, { usage: usage.service });
    const jev = createJevModule(ctx, { judge: providers.service.judge });
    const workspace = createWorkspaceModule(ctx, { runner });
    // live preview (local only): the kill switch and shutdown stop every preview
    const preview = createPreviewModule(ctx, { killswitch }, opts.preview);
    const projects = createProjectsModule(ctx, { workspace: workspace.service, preview: preview.service });
    const context = createContextModule(ctx);
    const llm: LlmRouter = demoOpts
      ? createDemoRouter({ charter: (role) => context.service.charter(role), paceMs: demoOpts.paceMs, securityScan: true })
      : providers.service.llm;
    const memory = createMemoryModule(ctx, { llm, decisions: jev.service, usage: usage.service });
    const assets = createAssetsModule(ctx, {
      media: providers.service.media,
      workspace: workspace.service,
      usage: usage.service,
      settings: settings.service,
    });
    const security = createSecurityModule(ctx, {
      workspace: workspace.service,
      decisions: jev.service,
      settings: settings.service,
      projects: projects.service,
    });
    const connectors = createConnectorsModule(ctx, { killswitch }, opts.connectors);
    const trading = createTradingModule(ctx, { venue: connectors.service, killswitch });
    const companies = createCompaniesModule();
    const tools = createToolsModule(ctx, {
      workspace: workspace.service,
      runner,
      memory: memory.service,
      assets: assets.service,
      security: security.service,
      automation,
      settings: settings.service,
      projects: projects.service,
      connectors: connectors.service,
      trading: trading.service,
    });
    const runs = createRunsModule(ctx, {
      projects: projects.service,
      llm,
      usage: usage.service,
      context: context.service,
      memory: memory.service,
      tools: tools.service,
      decisions: jev.service,
      settings: settings.service,
      killswitch: namespacedKillSwitch(killswitch, "orchestrator"),
      automation: automation ?? automationUnavailable,
      workspace: workspace.service,
      eventLog: events.service,
      // the scripted demo crew answers its own brain decisions; real runs ask JEV
      judge: demoOpts ? undefined : providers.service.judge,
      companies: companies.service,
    });
    killswitch.register("runner", () => runner.killAll());
    const evals = createEvalsModule(ctx, { context: context.service, tools: tools.service });
    const health = createHealthModule(ctx, {
      llmConfigured: opts.health?.llmConfigured ?? (() => providers.service.llm.configured()),
      jevConfigured: opts.health?.jevConfigured ?? (() => providers.service.judge.configured()),
      automationStatus: opts.health?.automationStatus ?? (() => AUTOMATION_OFF),
    });

    // every module, in creation order; closed in reverse
    const all: MountedModule[] = [events, settings, auth, usage, providers, jev, workspace, preview, projects, context, memory, assets, security, connectors, trading, companies, tools, runs, evals, health];
    // providers owns two top-level segments and mounts at "" (under /api): mount it after the named segments
    const mounted = [...all.filter((m) => m.routes && m !== providers), providers];
    const app = createApp({
      config,
      modules: mounted,
      killswitch,
      auth: auth.sessionAuth,
      kv,
      logger,
      trustProxy: boot.trustProxy,
    });

    let closing: Promise<void> | null = null;
    const close = () =>
      (closing ??= (async () => {
        for (const m of [...all].reverse()) {
          try {
            await m.close?.();
          } catch (err) {
            logger.log("warn", "module close failed", { module: m.name, error: errText(err) });
          }
        }
        try {
          await runner.killAll();
        } catch (err) {
          logger.log("warn", "runner kill on close failed", { error: errText(err) });
        }
        await closeInfra();
      })());

    try {
      // stored keys reach the redactor before the server listens (providers index.ts contract)
      try {
        await providers.service.warm();
      } catch (err) {
        logger.log("warn", "provider key warm-up failed", { error: errText(err) });
      }
      try {
        await connectors.service.warm();
      } catch (err) {
        logger.log("warn", "connector secret warm-up failed", { error: errText(err) });
      }
      await runs.ready;

      if (config.mode === "server" && !boot.setupCode) {
        const sessionInfo = await auth.service.sessionInfo(null);
        if (sessionInfo.needsSetup) logger.log("warn", "no owner account yet and SETUP_CODE is not set: setup is disabled");
      }

      let demo: Container["demo"] = null;
      if (demoOpts) {
        logger.log("info", "demo mode: runs are played by the scripted demo crew, no model is called");
        demo = { seed: demoOpts.seed === false ? null : await seedDemo({ projects: projects.service, runs: runs.service, logger, fund: demoOpts.fund }) };
      }

      return {
        app,
        ctx,
        modules: { events, settings, auth, usage, providers, jev, workspace, preview, projects, context, memory, assets, security, tools, connectors, trading, companies, runs, evals, health },
        killswitch,
        runner,
        demo,
        close,
      };
    } catch (err) {
      await close();
      throw err;
    }
  } catch (err) {
    // boot failed: release the infra opened so far (a no-op when close() already ran)
    await closeInfra().catch(() => undefined);
    throw err;
  }
}
