// Local sidecar entrypoint (desktop app). The Tauri shell spawns the
// compiled binary with MENGAI_MODE=local, MENGAI_DATA_DIR, MENGAI_WEB_DIR,
// MENGAI_HANDS_BIN and optional MENGAI_PORT. Once listening on 127.0.0.1 it
// prints exactly one NDJSON line to stdout:
//   {"event":"ready","port":<n>,"launchToken":"<one-time>","controlToken":"<per-launch>"}
// Logs go to stderr. It exits on SIGTERM, SIGINT, or when stdin closes.
import { parseEnv } from "@mengai/config";
import { bootstrap, type BootstrapOptions, type Platform } from "./core/bootstrap";
import { buildConfig, localHosts, type BootConfig } from "./core/config";
import { createAppLogger } from "./core/logger";
import { serve } from "./index";

export interface StartLocalOptions {
  /** env source; defaults to process.env. MENGAI_MODE is forced to local. */
  env?: Record<string, string | undefined>;
  home?: string;
  overrides?: BootstrapOptions["overrides"];
  logger?: BootstrapOptions["logger"];
}

export interface LocalHandle {
  port: number;
  url: string;
  launchToken: string;
  controlToken: string;
  boot: BootConfig;
  platform: Platform;
  stop(): Promise<void>;
}

export interface ReadyLine {
  event: "ready";
  port: number;
  launchToken: string;
  controlToken: string;
}

export function readyLine(h: Pick<LocalHandle, "port" | "launchToken" | "controlToken">): string {
  const line: ReadyLine = { event: "ready", port: h.port, launchToken: h.launchToken, controlToken: h.controlToken };
  return JSON.stringify(line);
}

export async function startLocal(opts: StartLocalOptions = {}): Promise<LocalHandle> {
  const env = parseEnv({ ...(opts.env ?? process.env), MENGAI_MODE: "local" });
  const boot = buildConfig(env, { home: opts.home });
  const platform = await bootstrap({ boot, overrides: opts.overrides, logger: opts.logger });
  let server: ReturnType<typeof serve>;
  try {
    server = serve(platform, boot);
  } catch (err) {
    await platform.close();
    throw err;
  }
  const port = server.port ?? 0;
  // DNS rebinding defense: only these Host values are accepted from now on
  boot.app.allowedHosts.splice(0, boot.app.allowedHosts.length, ...localHosts(port));
  const launchToken = platform.modules.auth.service.issueLaunchToken();
  let stopping: Promise<void> | null = null;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    launchToken,
    controlToken: boot.app.controlToken!,
    boot,
    platform,
    stop() {
      stopping ??= (async () => {
        await server.stop(true);
        await platform.close();
      })();
      return stopping;
    },
  };
}

/** Runs the sidecar: start, print the ready line, wait for SIGTERM or stdin close. */
export async function runLocalMain(): Promise<void> {
  let handle: LocalHandle;
  try {
    handle = await startLocal();
  } catch (err) {
    createAppLogger("error").log("error", "local api failed to start", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
  process.stdout.write(readyLine(handle) + "\n");
  const exit = () => void handle.stop().finally(() => process.exit(0));
  process.on("SIGTERM", exit);
  process.on("SIGINT", exit);
  // the shell holds our stdin open; EOF means the parent is gone
  void (async () => {
    try {
      const reader = Bun.stdin.stream().getReader();
      while (!(await reader.read()).done) {
        // input is ignored
      }
    } catch {
      // stdin unreadable: treat as closed
    }
    exit();
  })();
}

if (import.meta.main) {
  await runLocalMain();
}
