// Release build of the macOS app. Bun only.
//   1. apps/web  -> dist (Bun.build)
//   2. apps/api  -> compiled sidecar (build:sidecar, bun build --compile)
//   3. copy the web dist and the hands helper into src-tauri/resources; check
//      migrations/sqlite (bundled straight from the repo, see bundle.resources)
//   4. tauri build (bundles MengAI.app and the dmg; signs and notarizes when the
//      APPLE_* env vars are set, see README.md)
// Extra args are passed to `tauri build`, e.g. `bun run build -- --bundles app`.
import { join } from "node:path";
import {
  apiDir,
  assertMigrations,
  assertRealSidecar,
  readSidecarScript,
  run,
  sidecarPath,
  stageHands,
  syncDir,
  tauri,
  tauriDir,
  webDir,
} from "./lib";

const passthrough = process.argv.slice(2);
const sidecar = await readSidecarScript();
if (sidecar.outfile !== sidecarPath(sidecar.triple)) {
  throw new Error(`apps/api build:sidecar writes ${sidecar.outfile}, the shell expects ${sidecarPath(sidecar.triple)}`);
}
console.log(`bundling ${assertMigrations().length} sqlite migrations`);

await run([process.execPath, "run", "build"], webDir);
await run([process.execPath, "run", "build:sidecar"], apiDir);
await assertRealSidecar(sidecar.outfile);

const webFiles = await syncDir(join(webDir, "dist"), join(tauriDir, "resources", "web"), {
  keep: [".gitkeep"],
  skip: (rel) => rel.endsWith(".map"),
});
if (webFiles === 0) throw new Error("apps/web/dist is empty; the web build produced nothing");
console.log(`staged ${webFiles} web files`);
await stageHands(sidecar.triple, true);

await tauri(["build", "--target", sidecar.triple, ...passthrough]);
console.log(`bundle: ${join(tauriDir, "target", sidecar.triple, "release", "bundle")}`);
