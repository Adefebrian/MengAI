// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Development run: build the web app and the sidecar once, stage them, then
// `tauri dev` (debug shell, Rust hot rebuild). Rerun after web or api changes;
// the shell always talks to the compiled sidecar, like the release app. On
// Windows the sidecar is compiled for bun-windows-x64 and there is no hands helper.
import { join } from "node:path";
import { apiDir, assertMigrations, assertRealSidecar, desktopPlatform, run, sidecarBuild, stageHands, syncDir, tauri, tauriDir, webDir } from "./lib";

const platform = desktopPlatform();
const sidecar = await sidecarBuild(platform);
assertMigrations();
await run([process.execPath, "run", "build"], webDir);
await run(sidecar.cmd, apiDir);
await assertRealSidecar(sidecar.outfile);
await syncDir(join(webDir, "dist"), join(tauriDir, "resources", "web"), { keep: [".gitkeep"] });
if (platform === "darwin") await stageHands(sidecar.triple, null);

// No devUrl: the window loads the sidecar, so the CLI's static dev server is off.
await tauri(["dev", "--no-dev-server", "--no-dev-server-wait", ...process.argv.slice(2)]);
