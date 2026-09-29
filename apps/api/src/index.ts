// Server entrypoint (self-hosted web). Validates env, applies migrations,
// wires the platform and listens. Importing this file has no side effects:
// the listen only happens when it is run directly.
import { loadEnv } from "@mengai/config";
import { bootstrap, type Platform } from "./core/bootstrap";
import { buildConfig, type BootConfig } from "./core/config";
import { UPLOAD_BODY_LIMIT_BYTES } from "./core/hardening";
import { createAppLogger } from "./core/logger";

export { createApp } from "./core/app";
export type { AppType } from "./core/app";
export { bootstrap } from "./core/bootstrap";

export interface ServerHandle {
  platform: Platform;
  server: ReturnType<typeof Bun.serve>;
  stop(): Promise<void>;
}

export function serve(platform: Platform, boot: BootConfig): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: boot.host,
    port: boot.port,
    // SSE sends a heartbeat every 15 s, well inside this
    idleTimeout: 30,
    // second line of defense behind the per-route body cap
    maxRequestBodySize: UPLOAD_BODY_LIMIT_BYTES + 1024 * 1024,
    fetch: (req, server) => platform.app.fetch(req, { server }),
  });
}

export async function startServer(boot: BootConfig): Promise<ServerHandle> {
  const platform = await bootstrap({ boot });
  const server = serve(platform, boot);
  platform.ctx.logger.log("info", "api listening", { host: boot.host, port: server.port, mode: boot.app.mode });
  let stopping: Promise<void> | null = null;
  return {
    platform,
    server,
    stop() {
      stopping ??= (async () => {
        await server.stop(true);
        await platform.close();
      })();
      return stopping;
    },
  };
}

if (import.meta.main) {
  const env = loadEnv();
  if (env.MENGAI_MODE === "local") {
    const { runLocalMain } = await import("./local");
    await runLocalMain();
  } else {
    const boot = buildConfig(env);
    try {
      const handle = await startServer(boot);
      const exit = () => void handle.stop().finally(() => process.exit(0));
      process.on("SIGTERM", exit);
      process.on("SIGINT", exit);
    } catch (err) {
      createAppLogger("error").log("error", "api failed to start", { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    }
  }
}
