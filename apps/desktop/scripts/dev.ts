// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Development run: build the web app and the sidecar once, stage them, then
// `tauri dev` (debug shell, Rust hot rebuild). Rerun after web or api changes;
// the shell always talks to the compiled sidecar, like the release app.
import { join } from "node:path";
import { apiDir, assertMigrations, assertRealSidecar, readSidecarScript, run, stageHands, syncDir, tauri, tauriDir, webDir } from "./lib";

const sidecar = await readSidecarScript();
assertMigrations();
await run([process.execPath, "run", "build"], webDir);
await run([process.execPath, "run", "build:sidecar"], apiDir);
await assertRealSidecar(sidecar.outfile);
await syncDir(join(webDir, "dist"), join(tauriDir, "resources", "web"), { keep: [".gitkeep"] });
await stageHands(sidecar.triple, null);

// No devUrl: the window loads the sidecar, so the CLI's static dev server is off.
await tauri(["dev", "--no-dev-server", "--no-dev-server-wait", ...process.argv.slice(2)]);
