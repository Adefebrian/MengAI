// Standalone landing preview (not shipped). Builds preview/entry.tsx with
// Bun.build into an out directory outside the repo tree, then serves it:
//   /          the landing
//   /app*      a plain stub, so the landing's app links resolve
//   /fonts/*   the vendored faces from packages/ui/src/fonts
//   bun apps/web/src/landing/preview/serve.ts [port] [outdir]
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = import.meta.dir;
const fonts = join(here, "..", "..", "..", "..", "..", "packages", "ui", "src", "fonts");
const port = Number(process.argv[2] ?? process.env.PORT ?? 4310);
const outdir = process.argv[3] ?? join(tmpdir(), "mengai-landing-preview");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
const res = await Bun.build({
  entrypoints: [join(here, "entry.tsx")],
  outdir,
  target: "browser",
  minify: true,
  external: ["/fonts/*"],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!res.success) {
  for (const log of res.logs) console.error(log);
  process.exit(1);
}

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/" || pathname === "/index.html") return new Response(Bun.file(join(here, "index.html")));
    if (pathname === "/app" || pathname.startsWith("/app/")) {
      return new Response("<!doctype html><title>MengAI app</title><p>The app lives here in the full web build.</p>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (/^\/fonts\/[A-Za-z0-9-]+\.woff2$/.test(pathname)) {
      return new Response(Bun.file(join(fonts, pathname.slice("/fonts/".length))), { headers: { "content-type": "font/woff2" } });
    }
    if (/^\/[A-Za-z0-9._-]+\.(js|css|map)$/.test(pathname)) {
      const file = Bun.file(join(outdir, pathname.slice(1)));
      return file.size > 0 ? new Response(file) : new Response("not found", { status: 404 });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`landing preview on http://127.0.0.1:${server.port}/ (out ${outdir})`);
