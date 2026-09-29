// Kit preview server: builds, then serves
//   /            the compare board (page A in three directions, page B)
//   /landing     page A, ?d=D1 (default D1), ?reduce=1 previews reduced motion
//   /motion      page B with the motion module, ?d=D9 (default D9)
//   /fonts/*     the vendored woff2 files, long-cached (fonts.css points here)
// Port from argv or PORT, default 4190.
//   KIT_PREVIEW_DEPS=<dir with lenis and gsap> bun packages/ui/src/kit/preview/serve.ts [port]
import { join } from "node:path";
import { buildPreview } from "./build";

const here = import.meta.dir;
const src = join(here, "..", "..");
const motionCss = join(here, "..", "..", "..", "..", "..", "..", "modules", "motion", "src", "motion.css");
const port = Number(process.argv[2] ?? process.env.PORT ?? 4190);

const { motion } = await buildPreview();

const css: Record<string, string> = {
  "/css/tokens.css": join(src, "tokens.css"),
  "/css/ui.css": join(src, "ui.css"),
  "/css/kit.css": join(src, "kit.css"),
  "/css/preview.css": join(here, "preview.css"),
  "/css/motion.css": motionCss,
};

const LONG_CACHE = "public, max-age=31536000, immutable";

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/") return new Response(Bun.file(join(here, "compare.html")));
    if (pathname === "/landing") return new Response(Bun.file(join(here, "index.html")));
    if (pathname === "/motion") {
      if (!motion) return new Response("page B needs the motion module deps: set KIT_PREVIEW_DEPS to a directory with lenis and gsap installed", { status: 503 });
      return new Response(Bun.file(join(here, "motion.html")));
    }
    if (css[pathname]) return new Response(Bun.file(css[pathname]));
    // tokens.css imports ./fonts/fonts.css; the faces load from /fonts.
    if (pathname === "/css/fonts/fonts.css") return new Response(Bun.file(join(src, "fonts", "fonts.css")));
    if (/^\/fonts\/[A-Za-z0-9-]+\.woff2$/.test(pathname)) {
      return new Response(Bun.file(join(src, pathname)), { headers: { "cache-control": LONG_CACHE, "content-type": "font/woff2" } });
    }
    if (pathname.startsWith("/dist/") && !pathname.includes("..")) return new Response(Bun.file(join(here, pathname)));
    return new Response("not found", { status: 404 });
  },
});

console.log(`kit preview on http://127.0.0.1:${server.port}/ (page B ${motion ? "on" : "off"})`);
