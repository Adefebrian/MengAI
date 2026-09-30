// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Cats preview server: bundles preview/app.tsx with Bun.build in memory,
// then serves it with the JAL Core stylesheets and the vendored fonts.
//   bun packages/cats/preview/serve.ts [port]      (default 4191)
//   /?reduce=1 previews reduced motion without an OS switch.
//   /office is the living office on a scripted company day.
//   /tracker is the DeliveryTracker on a scripted run, studio and fund.
import { join } from "node:path";

const here = import.meta.dir;
const ui = join(here, "..", "..", "ui", "src");
const port = Number(process.argv[2] ?? process.env.PORT ?? 4191);

const build = await Bun.build({
  entrypoints: [join(here, "entry.ts")],
  target: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!build.success) {
  for (const log of build.logs) console.error(log);
  throw new Error("cats preview build failed");
}

const assets = new Map<string, { body: Blob; type: string }>();
for (const out of build.outputs) {
  const name = out.path.replace(/^.*[\\/]/, "");
  const type = name.endsWith(".css") ? "text/css" : "text/javascript";
  if (name.startsWith("entry.")) assets.set(`/app.${name.split(".").pop()}`, { body: out, type });
}

const css: Record<string, string> = {
  "/css/tokens.css": join(ui, "tokens.css"),
  "/css/ui.css": join(ui, "ui.css"),
  "/css/kit.css": join(ui, "kit.css"),
  "/css/fonts/fonts.css": join(ui, "fonts", "fonts.css"),
};

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/" || /^\/(office|tracker)\/?$/.test(pathname)) return new Response(Bun.file(join(here, "index.html")));
    if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
    const asset = assets.get(pathname);
    if (asset) return new Response(asset.body, { headers: { "content-type": asset.type } });
    if (css[pathname]) return new Response(Bun.file(css[pathname]), { headers: { "content-type": "text/css" } });
    if (/^\/fonts\/[A-Za-z0-9-]+\.woff2$/.test(pathname)) {
      return new Response(Bun.file(join(ui, pathname)), { headers: { "content-type": "font/woff2" } });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`cats preview on http://127.0.0.1:${server.port}/`);
