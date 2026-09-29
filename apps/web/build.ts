// apps/web/build.ts - bundle the React SPA with Bun.build(). No Vite,
// no webpack, no Next.js: Bun is both the package manager and the bundler.
//
// All paths are resolved against import.meta.dir (this file's own directory)
// rather than left relative, because relative paths resolve against
// process.cwd(), not this file's location. This script is imported
// on-demand by apps/web/src/smoke.test.ts when dist/ is missing, and that
// import can happen while cwd is the monorepo root (e.g. `bun test` run
// from templates/monorepo, exactly what CI does before the build step
// runs). A relative "src/index.tsx" would then resolve to
// templates/monorepo/src/index.tsx, which does not exist, and Bun.build
// fails with FileNotFound. See apps/web/server.ts for the same fix applied
// to hono/bun's serveStatic.
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const here = import.meta.dir;
const outdir = join(here, "dist");
// The vendored faces (packages/ui/src/fonts). fonts.css references them by
// absolute URL (/fonts/<file>.woff2) and the build keeps that URL external,
// so Bun.build never inlines them into index.css as base64 (it inlines any
// file under about 128 KB). They are copied to dist/fonts as real files,
// preloaded from index.html, and served with a one-year immutable cache.
const fontsDir = join(here, "..", "..", "packages", "ui", "src", "fonts");

if (import.meta.main) {
  // Normal path: `bun run build.ts` (turbo's build task, a plain CI/dev
  // invocation) runs this file as the process entrypoint directly.
  await runBuild();
} else {
  // This file is being imported as a module rather than run directly, which
  // only happens from apps/web/src/smoke.test.ts's on-demand build fallback
  // when dist/ is missing. Calling Bun.build() reentrant inside an
  // already-running `bun test` process is unreliable for a multi-package
  // workspace: verified empirically that it can fail to resolve a
  // cross-package auto-injected import (packages/ui's own
  // "react/jsx-runtime"/"react/jsx-dev-runtime") depending on the cwd the
  // outer `bun test` happened to be launched from, a Bun bundler quirk
  // unrelated to path correctness (neither `process.chdir()` nor Bun.build's
  // `root` option changes it). Running the real build in a fresh `bun`
  // subprocess sidesteps that: a brand new process always gets correct,
  // uncontaminated bundler state regardless of the parent test process's cwd.
  const proc = Bun.spawn({
    cmd: [process.execPath, import.meta.path],
    cwd: here,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) process.exit(exitCode);
}

async function runBuild() {
  await rm(outdir, { recursive: true, force: true });

  const res = await Bun.build({
    entrypoints: [join(here, "src/index.tsx")],
    outdir,
    target: "browser",
    minify: true,
    sourcemap: "linked",
    splitting: true,
    publicPath: "/",
    external: ["/fonts/*"],
    loader: { ".glb": "file", ".gltf": "file", ".ktx2": "file", ".hdr": "file", ".wasm": "file", ".bin": "file" },
    plugins: await optionalPlugins(),
  });

  if (!res.success) {
    for (const message of res.logs) console.error(message);
    process.exit(1);
  }

  await Bun.write(join(outdir, "index.html"), await Bun.file(join(here, "src/index.html")).text());
  await copyFonts();

  console.log("web build ok");
}

async function copyFonts() {
  const out = join(outdir, "fonts");
  await mkdir(out, { recursive: true });
  for (const file of await readdir(fontsDir)) {
    if (file.endsWith(".woff2")) await copyFile(join(fontsDir, file), join(out, file));
  }
}

// Tailwind is opt-in: when bun-plugin-tailwind is installed, CSS that
// imports "tailwindcss" is compiled with the JAL @theme
// (packages/ui/src/tailwind.css). Nothing changes for apps without it.
async function optionalPlugins() {
  try {
    // A variable specifier keeps tsc from requiring the optional package.
    const specifier = "bun-plugin-tailwind";
    const mod = (await import(specifier)) as { default: import("bun").BunPlugin };
    return [mod.default];
  } catch {
    return [];
  }
}
