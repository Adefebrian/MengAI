// Module wiring contract. Every domain module exports one factory from its
// index.ts: `createXModule(ctx, deps) => MountedModule & { service }`.
// core/container.ts builds the ports for the current mode, then creates the
// modules in dependency order and mounts their routes under /api.
import type { Mode } from "@mengai/shared";
import type { Hono } from "hono";
import type { BlobStore } from "./ports/blob";
import type { Clock } from "./ports/clock";
import type { Db } from "./ports/db";
import type { EventSink } from "./ports/events";
import type { Kv } from "./ports/kv";
import type { Logger } from "./ports/logger";
import type { Vault } from "./ports/vault";

export interface AppConfig {
  mode: Mode;
  version: string;
  /** local: ~/Library/Application Support/MengAI, server: /data */
  dataDir: string;
  /** default parent folder for new project workspaces */
  workspacesDir: string;
  /** built SPA folder served at / */
  webDir: string | null;
  /** exact origins allowed to call the API (same origin is always allowed) */
  allowedOrigins: string[];
  /** local mode: the only Host header values accepted (DNS rebinding defense) */
  allowedHosts: string[];
  /** local mode: token the desktop shell uses for tray and shortcut calls */
  controlToken: string | null;
}

export interface ModuleContext {
  config: AppConfig;
  db: Db;
  kv: Kv;
  blob: BlobStore;
  vault: Vault;
  clock: Clock;
  logger: Logger;
  events: EventSink;
}

export interface MountedModule {
  name: string;
  /** mounted at /api/<mountPath>; omit for service-only modules */
  routes?: Hono;
  mountPath?: string;
  /** called on shutdown (stop timers, abort work) */
  close?(): Promise<void>;
}
