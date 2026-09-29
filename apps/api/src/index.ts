import { loadEnv } from "@mengai/config";
import { app } from "./core/app";

export { app };
export type { AppType } from "./core/app";
// Fail-fast env validation and the actual listen call only happen when this
// file is executed directly (the real runtime entrypoint), never when it is
// imported (e.g. by index.test.ts via `app.request(...)`). This keeps
// `bun test` fully independent of live Postgres/Redis/S3/OpenAI.
if (import.meta.main) {
  const env = loadEnv();
  Bun.serve({ fetch: app.fetch, port: env.PORT });
  // eslint-disable-next-line no-console
  console.log(`api listening on :${env.PORT}`);
}
