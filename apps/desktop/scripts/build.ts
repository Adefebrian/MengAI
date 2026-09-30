// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Release build of the desktop app. Bun only. On Windows it builds the NSIS
// installer instead (scripts/windows.ts); everything below is the macOS path.
//   1. apps/web  -> dist (Bun.build)
//   2. apps/api  -> compiled sidecar (build:sidecar, bun build --compile), then
//      booted once on a temp data dir: ready line, /api/health, embedded migrations
//   3. copy the web dist and the hands helper into src-tauri/resources; check
//      migrations/sqlite (bundled straight from the repo, see bundle.resources)
//   4. tauri build (MengAI.app and the dmg). Signs with APPLE_SIGNING_IDENTITY
//      and notarizes when the APPLE_* credentials are set; otherwise ad-hoc
//      signs (hardened runtime and JIT entitlements still applied). See README.md.
//   5. verify: codesign on the app, runtime flag and JIT entitlement on the
//      sidecar, the sidecar smoke against the bundled app, hdiutil verify
//   6. copy the dmg to apps/desktop/dist/<productName>_<version>_<arch>.dmg
// Extra args are passed to `tauri build`, e.g. `bun run build -- --bundles app`.
import { existsSync } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  apiDir,
  assertMigrations,
  assertRealSidecar,
  bundleDir,
  capture,
  desktopPlatform,
  distDir,
  dmgName,
  JIT_ENTITLEMENT,
  readSidecarScript,
  readTauriConf,
  releaseSigning,
  run,
  SIDECAR_NAME,
  sidecarPath,
  stageHands,
  syncDir,
  tauri,
  tauriDir,
  webDir,
} from "./lib";
import { checkSidecar, smokeApp } from "./smoke";
import { buildWindows } from "./windows";

const passthrough = process.argv.slice(2);
if (desktopPlatform() === "win32") await buildWindows(passthrough);
else await buildMac(passthrough);

async function buildMac(passthrough: string[]): Promise<void> {
  const sidecar = await readSidecarScript();
  if (sidecar.outfile !== sidecarPath(sidecar.triple)) {
    throw new Error(`apps/api build:sidecar writes ${sidecar.outfile}, the shell expects ${sidecarPath(sidecar.triple)}`);
  }
  const conf = await readTauriConf();
  const signing = releaseSigning();
  console.log(
    signing.adhoc
      ? "signing: ad-hoc (no APPLE_SIGNING_IDENTITY). Runs on this Mac; not notarized, Gatekeeper blocks it elsewhere"
      : `signing: ${signing.identity}${signing.notarize ? ", notarizing" : ", no notarization credentials"}`,
  );
  const migrations = assertMigrations();
  console.log(`bundling ${migrations.length} sqlite migrations`);

  await run([process.execPath, "run", "build"], webDir);
  await run([process.execPath, "run", "build:sidecar"], apiDir);
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
    stop: "sigterm",
  });
  await rm(pre.dataDir, { recursive: true, force: true });
  console.log(`compiled sidecar boots: ready in ${pre.readyMs} ms, embedded migrations ${pre.versions.join(" ")}`);

  await stageHands(sidecar.triple, signing.identity);

  const out = bundleDir(sidecar.triple);
  const app = join(out, "macos", `${conf.productName}.app`);
  const dmgFile = dmgName(conf.productName, conf.version, sidecar.triple);
  const dmg = join(out, "dmg", dmgFile);
  // A stale dmg must never pass for this build's output.
  await rm(dmg, { force: true });

  await tauri(["build", "--target", sidecar.triple, ...passthrough], signing.env);

  // codesign: the whole bundle seals, and the Bun sidecar carries the hardened runtime and JIT.
  const verify = await capture(["codesign", "--verify", "--deep", "--strict", "--verbose=2", app]);
  if (verify.code !== 0) throw new Error(`codesign --verify failed for ${app}:\n${verify.out}`);
  const sidecarBin = join(app, "Contents", "MacOS", SIDECAR_NAME);
  const info = await capture(["codesign", "-d", "--verbose=2", sidecarBin]);
  const ents = await capture(["codesign", "-d", "--entitlements", "-", "--xml", sidecarBin]);
  if (!/flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)/.test(info.out)) throw new Error(`${sidecarBin} is not signed with the hardened runtime:\n${info.out}`);
  if (!ents.out.includes(JIT_ENTITLEMENT)) throw new Error(`${sidecarBin} lacks ${JIT_ENTITLEMENT}; the Bun runtime would crash at launch`);
  console.log(`codesign ok: ${app} (sidecar: hardened runtime, ${JIT_ENTITLEMENT})`);

  for (const r of await smokeApp(app)) {
    console.log(`bundled sidecar ${r.label}: ready in ${r.readyMs} ms, health 200, migrations ${r.versions.join(" ")}, exit ${r.exitCode}`);
  }

  const wantsDmg = !passthrough.some((a) => a === "--bundles" || a === "-b" || a.startsWith("--bundles="));
  if (existsSync(dmg)) {
    const check = await capture(["hdiutil", "verify", dmg]);
    if (check.code !== 0) throw new Error(`hdiutil verify failed for ${dmg}:\n${check.out}`);
    await mkdir(distDir, { recursive: true });
    const final = join(distDir, dmgFile);
    await copyFile(dmg, final);
    const size = (await stat(final)).size;
    const sha = new Bun.CryptoHasher("sha256").update(await Bun.file(final).arrayBuffer()).digest("hex");
    console.log(`dmg: ${final} (${(size / 1024 / 1024).toFixed(1)} MB, sha256 ${sha}), hdiutil verify ok`);
  } else if (wantsDmg) {
    throw new Error(`tauri build finished but ${dmg} is missing`);
  }
  console.log(`bundle: ${out}`);
}
