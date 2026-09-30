// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What the preview module exposes and what it needs. The service is
// injected by core/container.ts into the projects module, which owns the
// /api/projects/:id/preview and /reveal routes and hands over the project's
// realpath workspace root. Process spawn, HTTP probes, port checks, the
// static server and the file manager opener are ports, so the tests drive
// fakes and the service never touches Bun.spawn or Bun.serve directly.
import type { PlatformFeatures, PreviewDTO } from "@mengai/shared";

export interface PreviewService {
  /** current state; when nothing runs, what Start would do (or why nothing is previewable) */
  status(projectId: string, root: string): Promise<PreviewDTO>;
  /** starts the preview; a no-op while one is active unless restart is true */
  start(projectId: string, root: string, opts?: { restart?: boolean }): Promise<PreviewDTO>;
  stop(projectId: string): Promise<PreviewDTO>;
  /** the project was deleted: stop its preview and drop its state */
  forget(projectId: string): Promise<void>;
  /** opens this folder (the caller passes the workspace root) in the OS file manager */
  reveal(root: string): Promise<void>;
  /** kill switch: stops every preview, returns how many were running */
  stopAll(): Promise<number>;
  close(): Promise<void>;
}

/** One dev server or install process, in its own process group. */
export interface PreviewProcess {
  readonly pid: number;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  /** exit code; null when a signal ended it */
  readonly exited: Promise<number | null>;
  /** signals the whole process group */
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export type PreviewSpawner = (argv: string[], opts: { cwd: string; env: Record<string, string> }) => PreviewProcess;

/** A readiness probe answer: any HTTP status means the server is up. */
export interface ProbeResponse {
  status: number;
  body?: ReadableStream<Uint8Array> | null;
}

export type PreviewFetch = (url: string, init: { method: "GET"; redirect: "manual"; signal: AbortSignal }) => Promise<ProbeResponse>;

export interface StaticServer {
  readonly port: number;
  stop(): Promise<void>;
}

/** binds a static file server for dir on 127.0.0.1:port; throws when the port is taken */
export type StaticServe = (dir: string, port: number) => StaticServer;

/** true when nothing listens on 127.0.0.1:port */
export type PortFree = (port: number) => Promise<boolean>;

/** runs the file manager command; resolves with its exit code */
export type FolderOpener = (argv: string[]) => Promise<number | null>;

export interface PreviewLimits {
  /** previews running at once; starting one more stops the oldest */
  maxActive: number;
  /** spawn to first HTTP answer */
  startTimeoutMs: number;
  installTimeoutMs: number;
  pollMs: number;
  /** SIGTERM to SIGKILL */
  stopGraceMs: number;
  /** inclusive port range for previews */
  ports: readonly [number, number];
}

export interface PreviewOptions {
  spawn?: PreviewSpawner;
  fetch?: PreviewFetch;
  portFree?: PortFree;
  serveStatic?: StaticServe;
  open?: FolderOpener;
  platform?: NodeJS.Platform;
  /** boot-time platform features (lib/platform.ts): scriptPreview off fails every script preview with the coming soon reason; absent keeps every feature on */
  features?: PlatformFeatures;
  /** resolves a command on PATH (Bun.which by default) */
  which?: (command: string, path: string) => string | null;
  /** where PATH and LANG come from (process.env by default); nothing else is read */
  env?: Record<string, string | undefined>;
  home?: string;
  limits?: Partial<PreviewLimits>;
}
