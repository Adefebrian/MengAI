// apps/web/serve.ts - the process entrypoint that actually listens.
//
// Deliberately separate from ./server.ts. Bun auto-serves the default export of
// whichever file it runs as the entrypoint when that export carries a `fetch`
// method, and a Hono app does. server.ts must keep its default export, because
// apps/web/src/server.test.ts and smoke.test.ts import it and drive it through
// app.request(). Putting the listen here instead means server.ts is never the
// entrypoint, so nothing is ever bound twice.
//
// This file has no default export on purpose. Adding one would reintroduce the
// exact double-bind (EADDRINUSE) this split exists to prevent.
import app from "./server";

const port = Number(process.env.WEB_PORT ?? 3000);

Bun.serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`web listening on :${port}`);
