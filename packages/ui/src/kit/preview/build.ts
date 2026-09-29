// Kit preview build: bundles both pages with Bun.build into preview/dist.
//   bun packages/ui/src/kit/preview/build.ts
// React and react-dom resolve from the workspace web app so the bundle holds
// exactly one React (packages/ui carries react for types only).
//
// Page B (motion-entry.tsx) needs the opt-in motion module's dependencies
// (lenis, gsap, @gsap/react), which the repo never installs. Point
// KIT_PREVIEW_DEPS at a directory whose node_modules holds them (a scratch
// `bun add lenis gsap @gsap/react`); without it only page A is built and
// /motion answers with how to enable it.
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { BunPlugin } from "bun";

const here = import.meta.dir;
const web = join(here, "..", "..", "..", "..", "..", "apps", "web");
const ui = join(here, "..", "..", "index.ts");
const motionModule = join(here, "..", "..", "..", "..", "..", "..", "modules", "motion", "src", "index.ts");

export function motionDeps(): string | null {
  const dir = process.env.KIT_PREVIEW_DEPS;
  if (!dir) return null;
  return existsSync(join(dir, "node_modules", "lenis")) && existsSync(join(dir, "node_modules", "gsap")) ? dir : null;
}

function plugin(deps: string | null): BunPlugin {
  return {
    name: "kit-preview-resolve",
    setup(build) {
      build.onResolve({ filter: /^@kit-preview\/react-dom-client$/ }, () => ({ path: Bun.resolveSync("react-dom/client", web) }));
      build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => ({ path: Bun.resolveSync(args.path, web) }));
      build.onResolve({ filter: /^@crew\/ui$/ }, () => ({ path: ui }));
      build.onResolve({ filter: /^@kit-preview\/motion$/ }, () => ({ path: motionModule }));
      if (deps) {
        build.onResolve({ filter: /^(lenis|gsap|@gsap\/react)(\/.*)?$/ }, (args) => ({ path: Bun.resolveSync(args.path, deps) }));
      }
    },
  };
}

export interface PreviewBuild {
  motion: boolean;
  /** Minified, gzipped bytes per output file. */
  sizes: Record<string, { bytes: number; gzip: number }>;
}

export async function buildPreview(): Promise<PreviewBuild> {
  const outdir = join(here, "dist");
  await rm(outdir, { recursive: true, force: true });
  const deps = motionDeps();
  const entrypoints = [join(here, "entry.tsx")];
  if (deps) entrypoints.push(join(here, "motion-entry.tsx"));
  const res = await Bun.build({
    entrypoints,
    outdir,
    target: "browser",
    minify: true,
    splitting: true,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [plugin(deps)],
  });
  if (!res.success) {
    for (const log of res.logs) console.error(log);
    throw new Error("kit preview build failed");
  }
  const sizes: PreviewBuild["sizes"] = {};
  for (const out of res.outputs) {
    const bytes = new Uint8Array(await out.arrayBuffer());
    sizes[out.path.slice(outdir.length + 1)] = { bytes: bytes.length, gzip: Bun.gzipSync(bytes).length };
  }
  return { motion: Boolean(deps), sizes };
}

if (import.meta.main) {
  const { motion, sizes } = await buildPreview();
  console.log("kit preview built:", join(here, "dist"), motion ? "(pages A and B)" : "(page A; set KIT_PREVIEW_DEPS for page B)");
  for (const [f, s] of Object.entries(sizes)) console.log(`  ${f}: ${(s.bytes / 1024).toFixed(1)} KB, ${(s.gzip / 1024).toFixed(1)} KB gzip`);
}
