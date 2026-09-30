// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Release build of the Windows app (NSIS installer, per-user, no admin). Bun only,
// run on Windows by scripts/build.ts.
//   1. apps/web  -> dist (Bun.build)
//   2. apps/api  -> compiled sidecar for bun-windows-x64, named for externalBin
//      (binaries/mengai-api-x86_64-pc-windows-msvc.exe), then booted once on a
//      temp data dir: ready line, /api/health on a free port, embedded migrations
//   3. copy the web dist into src-tauri/resources; check migrations/sqlite. The
//      hands helper is macOS only, so the Windows app ships without automation
//   4. tauri build for x86_64-pc-windows-msvc; tauri.windows.conf.json makes the
//      NSIS installer the only bundle. Unsigned beta: SmartScreen warns on first run
//   5. smoke the bundled mengai-api.exe from the build output folder (the same
//      layout the installer writes): embedded, shell and restart checks
//   6. copy the installer to apps/desktop/dist/<productName>_<version>_x64-setup.exe
// Extra args are passed to `tauri build`.
import { existsSync } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  apiDir,
  assertMigrations,
  assertRealSidecar,
  bundleDir,
  cargoTargetDir,
  distDir,
  isPE,
  nsisName,
  readTauriConf,
  run,
  sidecarBuild,
  syncDir,
  tauri,
  tauriDir,
  webDir,
} from "./lib";
import { checkSidecar, smokeWindowsDir } from "./smoke";

export async function buildWindows(passthrough: string[]): Promise<void> {
  const sidecar = await sidecarBuild("win32");
  const conf = await readTauriConf();
  console.log("signing: none (unsigned beta). Windows SmartScreen asks the user to confirm on first run");
  const migrations = assertMigrations();
  console.log(`bundling ${migrations.length} sqlite migrations`);

  await run([process.execPath, "run", "build"], webDir);
  await run(sidecar.cmd, apiDir);
  await assertRealSidecar(sidecar.outfile);

  const webFiles = await syncDir(join(webDir, "dist"), join(tauriDir, "resources", "web"), {
    keep: [".gitkeep"],
    skip: (rel) => rel.endsWith(".map"),
  });
  if (webFiles === 0) throw new Error("apps/web/dist is empty; the web build produced nothing");
  console.log(`staged ${webFiles} web files`);

  // Fail before the slow Rust build when the compiled sidecar cannot boot or migrate on its own.
  const pre = await checkSidecar({
    label: "compiled",
    bin: sidecar.outfile,
    webDir: join(tauriDir, "resources", "web"),
    migrationsDir: null,
    expect: migrations,
    stop: "stdin",
  });
  await rm(pre.dataDir, { recursive: true, force: true });
  console.log(`compiled sidecar boots: ready in ${pre.readyMs} ms, embedded migrations ${pre.versions.join(" ")}`);
  console.log("hands helper: macOS only, the Windows app ships without automation");

  const installerFile = nsisName(conf.productName, conf.version, sidecar.triple);
  const installer = join(bundleDir(sidecar.triple), "nsis", installerFile);
  // A stale installer must never pass for this build's output.
  await rm(installer, { force: true });

  await tauri(["build", "--target", sidecar.triple, ...passthrough]);

  const release = join(cargoTargetDir(), sidecar.triple, "release");
  for (const r of await smokeWindowsDir(release)) {
    console.log(`bundled sidecar ${r.label}: ready in ${r.readyMs} ms, health 200, migrations ${r.versions.join(" ")}, exit ${r.exitCode}`);
  }

  if (!existsSync(installer)) throw new Error(`tauri build finished but ${installer} is missing`);
  const head = new Uint8Array(await Bun.file(installer).slice(0, 2).arrayBuffer());
  if (!isPE(head)) throw new Error(`${installer} is not a Windows executable`);
  await mkdir(distDir, { recursive: true });
  const final = join(distDir, installerFile);
  await copyFile(installer, final);
  const size = (await stat(final)).size;
  const sha = new Bun.CryptoHasher("sha256").update(await Bun.file(final).arrayBuffer()).digest("hex");
  console.log(`installer: ${final} (${(size / 1024 / 1024).toFixed(1)} MB, sha256 ${sha})`);
  console.log(`bundle: ${bundleDir(sidecar.triple)}`);
}
