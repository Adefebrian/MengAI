// apps/web/server.ts - serves the SPA built by build.ts. Plain Hono +
// hono/bun static serving, no Vite dev server, no Next.js.
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { secureHeaders } from "hono/secure-headers";

const app = new Hono();

// The API origin the SPA talks to. apps/web/src/client.ts reads the same
// API_URL name and falls back to the same http://localhost:3001 (apps/api's
// port), so the CSP and the client cannot drift apart: point the client at a
// deployed API and this allowlist follows it from the same env var.
const apiOrigin = process.env.API_URL ?? "http://localhost:3001";

// This is the HTML origin, so it is the only place a CSP or an X-Frame-Options
// has any effect at all (apps/api serves JSON and is hardened separately).
// Registered before both serveStatic calls below so it covers the bundle, the
// stylesheet, index.html and the SPA fallback alike.
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      // 'unsafe-inline' is load-bearing, not laziness: packages/ui's BarChart
      // draws each bar with an inline style={{ width }} and Icon forwards a
      // style prop, so a strict style-src silently flattens every chart. A
      // nonce cannot cover React's inline style attributes (CSP nonces apply
      // to <style>/<link>, never to a style="" attribute).
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'"],
      // Without the API origin here, the browser blocks every typed `hc` call
      // in src/client.ts and the app loads but shows no data.
      connectSrc: ["'self'", apiOrigin],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      // Belt and braces with X-Frame-Options: DENY below, for the browsers
      // that honour only one of the two.
      frameAncestors: ["'none'"],
    },
    xFrameOptions: "DENY",
    xContentTypeOptions: true,
    referrerPolicy: "strict-origin-when-cross-origin",
  }),
);

// hono/bun's serveStatic resolves `root`/`path` relative to process.cwd(),
// not relative to this file. Use an absolute path (import.meta.dir) so the
// server behaves the same whether it is started from apps/web, from the
// repo root (a `bun test` run that imports this module), or from a Docker
// image's WORKDIR.
const distDir = `${import.meta.dir}/dist`;

// The vendored fonts (dist/fonts, copied by build.ts) never change under a
// name, so they cache for a year; everything else keeps the default.
app.use("/fonts/*", async (c, next) => {
  await next();
  if (c.res.status === 200 && c.res.headers.get("content-type")?.startsWith("font/")) {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  }
});

app.use("/*", serveStatic({ root: distDir }));
// A missing font is a 404, never the SPA's index.html.
app.get("/fonts/*", (c) => c.notFound());
// SPA fallback: any route not matched by a static file (client-side routes)
// resolves to index.html instead of a 404.
//
// `path` must be a filename relative to `root`, not `distDir`'s own
// absolute path. hono's serve-static join() strips the leading slash off
// an absolute `path` when `root` defaults to "./" (verified against
// hono@4.13.3's src/middleware/serve-static/path.js), which quietly turns
// this into a request for a relative path that never exists and this
// fallback into a silent 404 instead of index.html. Passing the same
// absolute `root` here sidesteps that join() edge case entirely.
app.get("*", serveStatic({ root: distDir, path: "index.html" }));

// This file never calls Bun.serve itself. Read this before changing the export
// below, it encodes two real Bun behaviors that fought each other.
//
// 1. When Bun runs a file as the process entrypoint and that file's default
//    export looks like a server config (it carries a `fetch`), Bun auto-serves
//    it. A Hono app is exactly that shape. So the template's original
//    `export default app` PLUS an explicit `Bun.serve` in the same file bound
//    the port twice and the process died with EADDRINUSE on boot.
// 2. Removing the explicit `Bun.serve` is not enough on its own. Bun's
//    auto-serve path calls `Bun.serve(entryNamespace.default)` directly, and a
//    bare Hono instance is not a valid server config, so `bun server.ts` exited
//    1 without ever listening, and `WEB_PORT` was ignored.
//
// Attaching `port` to the app satisfies both. The default export is still the
// same Hono instance, so apps/web/src/server.test.ts and smoke.test.ts keep
// working with `const { default: app } = await import("../server")` and
// `app.request(...)`, and it is now ALSO a valid Bun server config, so
// `WEB_PORT=3000 bun server.ts` starts and honors the port.
//
// ./serve.ts remains the canonical entrypoint (it is what the `serve` script and
// infra/Dockerfile.web run) because an explicit `Bun.serve` logs the bound port
// and fails loudly instead of silently. Both paths now work.
const port = Number(process.env.WEB_PORT ?? 3000);

export default Object.assign(app, { port });
