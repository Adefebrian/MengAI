// Static checks for the desktop shell: config JSON is valid and wired to the
// sidecar contract, the sidecar file name matches the target triple the api
// build emits, and the Rust constants agree with packages/shared. No network,
// no cargo, no tauri build.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BUN_TO_RUST_TRIPLE,
  HANDS_BIN_NAME,
  MIGRATIONS_RESOURCE,
  SIDECAR_NAME,
  SIDECAR_PLACEHOLDER_MARKER,
  assertMigrations,
  desktopDir,
  isMachO,
  parseSidecarScript,
  readSidecarScript,
  repoRoot,
  sidecarPath,
  sqliteMigrationsDir,
  tauriDir,
} from "./lib";

const read = (rel: string) => Bun.file(join(tauriDir, rel)).text();
const json = async <T = any>(rel: string): Promise<T> => JSON.parse(await read(rel)) as T;

describe("tauri.conf.json", () => {
  test("is valid JSON with the product identity", async () => {
    const conf = await json("tauri.conf.json");
    expect(conf.identifier).toBe("id.mengai.app");
    expect(conf.productName).toBe("MengAI");
    expect(conf.app.withGlobalTauri).toBe(true);
    // The window is created in Rust after the ready line, never from config.
    expect(conf.app.windows).toEqual([]);
    expect(conf.app.security.capabilities).toEqual(["main"]);
  });

  test("bundles the sidecar, the web dist, the hands placeholder and the sqlite migrations", async () => {
    const conf = await json("tauri.conf.json");
    expect(conf.bundle.externalBin).toEqual([`binaries/${SIDECAR_NAME}`]);
    expect(conf.bundle.resources).toEqual({
      "resources/web/": "web/",
      "resources/hands/": "hands/",
      [MIGRATIONS_RESOURCE.from]: MIGRATIONS_RESOURCE.to,
    });
    expect(existsSync(join(tauriDir, "resources", "web"))).toBe(true);
    expect(existsSync(join(tauriDir, "resources", "hands", "README.md"))).toBe(true);
    for (const icon of conf.bundle.icon as string[]) expect(existsSync(join(tauriDir, icon))).toBe(true);
    expect(existsSync(join(tauriDir, "icons", "tray.png"))).toBe(true);
  });

  test("CSP matches the API baseline and allows only Tauri IPC on top", async () => {
    const csp = (await json("tauri.conf.json")).app.security.csp as Record<string, string>;
    expect(csp["default-src"]).toBe("'self'");
    expect(csp["frame-ancestors"]).toBe("'none'");
    expect(csp["object-src"]).toBe("'none'");
    expect(csp["base-uri"]).toBe("'none'");
    expect(csp["connect-src"]).toBe("'self' ipc: http://ipc.localhost");
    const all = Object.values(csp).join(" ");
    expect(all).not.toContain("unsafe-inline");
    expect(all).not.toContain("unsafe-eval");
    expect(all).not.toContain("*");
  });

  test("macOS signing inputs exist: hardened runtime, entitlements, usage strings", async () => {
    const mac = (await json("tauri.conf.json")).bundle.macOS;
    expect(mac.hardenedRuntime).toBe(true);
    expect(mac.signingIdentity).toBeNull();
    const entitlements = await read(mac.entitlements);
    for (const key of [
      "com.apple.security.cs.allow-jit",
      "com.apple.security.cs.allow-unsigned-executable-memory",
      "com.apple.security.network.client",
    ]) {
      expect(entitlements).toContain(`<key>${key}</key>`);
    }
    const plist = await read("Info.plist");
    expect(plist).toContain("<key>NSAccessibilityUsageDescription</key>");
    expect(plist).toContain("<key>NSScreenCaptureUsageDescription</key>");
  });
});

describe("migrations", () => {
  // A compiled sidecar resolves its default migrations path inside $bunfs, so without
  // the bundled folder and MENGAI_MIGRATIONS_DIR it exits 1 before the ready line.
  test("the bundle resource points at the repo sqlite migrations, which hold .sql files", () => {
    expect(resolve(tauriDir, MIGRATIONS_RESOURCE.from)).toBe(sqliteMigrationsDir);
    const files = assertMigrations();
    expect(files).toContain("0001_init.sql");
    for (const f of files) expect(f).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  test("the shell passes the bundled folder as MENGAI_MIGRATIONS_DIR and refuses to start without it", async () => {
    const main = await read("src/main.rs");
    expect(main).toContain(`const MIGRATIONS_DIR: &str = "${MIGRATIONS_RESOURCE.to.split("/")[0]}";`);
    expect(main).toContain("migrations_dir: resources.join(MIGRATIONS_DIR)");
    expect(main).toContain('has_sql_files(&paths.migrations_dir.join("sqlite"))');
    // The dialect folder name the sidecar joins onto MENGAI_MIGRATIONS_DIR.
    expect(MIGRATIONS_RESOURCE.to).toBe("migrations/sqlite/");
    const env = await Bun.file(join(repoRoot, "packages", "config", "src", "env.ts")).text();
    expect(env).toMatch(/MENGAI_MIGRATIONS_DIR:\s*optionalString/);
  });

  test("assertMigrations fails loudly on a missing or empty folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "mengai-migrations-"));
    try {
      expect(() => assertMigrations(join(dir, "nope"))).toThrow(/missing/);
      expect(() => assertMigrations(dir)).toThrow(/no \.sql files/);
      writeFileSync(join(dir, "0001_init.sql"), "select 1;");
      expect(assertMigrations(dir)).toEqual(["0001_init.sql"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("build and dev check the migrations before bundling", async () => {
    for (const script of ["build.ts", "dev.ts"]) {
      const text = await Bun.file(join(desktopDir, "scripts", script)).text();
      expect(text).toContain("assertMigrations()");
    }
  });
});

describe("capabilities", () => {
  test("every capability file is valid JSON; the page gets no remote grant from disk", async () => {
    const files = readdirSync(join(tauriDir, "capabilities")).filter((f) => f.endsWith(".json"));
    expect(files).toEqual(["main.json"]);
    const main = await json("capabilities/main.json");
    expect(main.identifier).toBe("main");
    expect(main.windows).toEqual(["main"]);
    // The sidecar origin is granted at runtime for the exact port (window.rs).
    expect(main.remote).toBeUndefined();
    const perms = JSON.stringify(main.permissions);
    for (const banned of ["shell:", "fs:", "opener:", "dialog:", "global-shortcut:"]) expect(perms).not.toContain(banned);
  });

  test("the runtime grant is exactly allow-pick-folder on the exact origin", async () => {
    const win = await read("src/window.rs");
    expect(win).toContain('.permission("allow-pick-folder")');
    expect(win).toContain(".remote(origin(port))");
    expect(win).toContain('format!("http://127.0.0.1:{port}")');
    const build = await read("build.rs");
    expect(build).toContain('commands(&["pick_folder"])');
  });
});

describe("sidecar naming", () => {
  test("apps/api build:sidecar emits the file Tauri resolves for this target triple", async () => {
    const script = await readSidecarScript();
    expect(BUN_TO_RUST_TRIPLE[script.bunTarget]).toBe(script.triple);
    expect(script.triple).toBe("aarch64-apple-darwin");
    expect(script.outfile).toBe(sidecarPath(script.triple));
    expect(script.outfile.endsWith(`/binaries/${SIDECAR_NAME}-${script.triple}`)).toBe(true);
  });

  test("Rust constants agree with the config and the scripts", async () => {
    const main = await read("src/main.rs");
    expect(main).toContain(`const SIDECAR_NAME: &str = "${SIDECAR_NAME}";`);
    expect(main).toContain(`const HANDS_BIN: &str = "hands/${HANDS_BIN_NAME}";`);
    expect(main).toContain('const WEB_DIR: &str = "web";');
    const build = await read("build.rs");
    expect(build).toContain(`format!("${SIDECAR_NAME}-{target}")`);
    expect(build).toContain(`const PLACEHOLDER_MARKER: &str = "${SIDECAR_PLACEHOLDER_MARKER}";`);
  });

  test("parser rejects unknown targets and missing flags", () => {
    expect(() => parseSidecarScript("bun build --compile src/local.ts")).toThrow();
    expect(() => parseSidecarScript("bun build --target=bun-linux-x64 --outfile x")).toThrow();
    const ok = parseSidecarScript("bun build --compile --target=bun-darwin-x64 src/local.ts --outfile ../desktop/src-tauri/binaries/mengai-api-x86_64-apple-darwin");
    expect(ok.triple).toBe("x86_64-apple-darwin");
    expect(ok.outfile).toBe(sidecarPath("x86_64-apple-darwin"));
  });

  test("Mach-O check tells a real binary from the placeholder script", () => {
    expect(isMachO(new Uint8Array([0xcf, 0xfa, 0xed, 0xfe]))).toBe(true);
    expect(isMachO(new Uint8Array([0xca, 0xfe, 0xba, 0xbe]))).toBe(true);
    expect(isMachO(new TextEncoder().encode("#!/bin/sh"))).toBe(false);
  });
});

describe("shared contract", () => {
  test("control header and kill switch route match packages/shared", async () => {
    const api = await Bun.file(join(repoRoot, "packages", "shared", "src", "api.ts")).text();
    const header = /CONTROL_TOKEN_HEADER\s*=\s*"([^"]+)"/.exec(api)?.[1];
    expect(header).toBe("x-mengai-control");
    expect(api).toContain('"POST /api/killswitch"');
    expect(api).toMatch(/KillSwitchBody\s*\{\s*by\?:\s*"user"\s*\|\s*"shortcut"\s*\|\s*"tray"/);
    const control = await read("src/control.rs");
    expect(control).toContain(`pub const CONTROL_TOKEN_HEADER: &str = "${header}";`);
    expect(control).toContain('pub const KILLSWITCH_PATH: &str = "/api/killswitch";');
  });

  test("the shell passes the contract env vars and owns each one", async () => {
    const sidecar = await read("src/sidecar.rs");
    const owned = /const ENV_OWNED: &\[&str\] =\s*&\[([^\]]*)\]/.exec(sidecar)?.[1] ?? "";
    for (const name of ["MENGAI_MODE", "MENGAI_DATA_DIR", "MENGAI_WEB_DIR", "MENGAI_HANDS_BIN", "MENGAI_MIGRATIONS_DIR", "MENGAI_PORT", "MENGAI_SITE_URL"]) {
      expect(sidecar).toContain(`env.push(("${name}".into()`);
      expect(owned).toContain(`"${name}"`);
    }
    expect(sidecar).toContain('("MENGAI_MIGRATIONS_DIR".into(), paths.migrations_dir.clone().into_os_string())');
    expect(sidecar).toContain('("MENGAI_MODE".into(), "local".into())');
    expect(sidecar).toContain('("MENGAI_PORT".into(), settings.port.to_string().into())');
  });

  test("settings.json feeds MENGAI_SITE_URL and the fixed runtime port the website app talks to", async () => {
    const settings = await read("src/settings.rs");
    expect(settings).toContain('pub const FILE_NAME: &str = "settings.json";');
    expect(settings).toContain("pub const DEFAULT_PORT: u16 = 4190;");
    const template = /pub const TEMPLATE: &str = "((?:[^"\\]|\\.)*)";/.exec(settings)?.[1];
    expect(template).toBeDefined();
    expect(JSON.parse(JSON.parse(`"${template}"`))).toEqual({ siteUrl: null, port: 4190 });
    // The root dev runtime and the Mac app answer on the same local address.
    const root = await Bun.file(join(repoRoot, "package.json")).json();
    expect(root.scripts.dev).toContain("MENGAI_PORT=4190");
  });

  test("Open in browser opens only the checked pairing link from the ready line", async () => {
    const api = await Bun.file(join(repoRoot, "packages", "shared", "src", "api.ts")).text();
    expect(api).toContain('"POST /api/auth/pair"');
    const sidecar = await read("src/sidecar.rs");
    expect(sidecar).toContain('#[serde(rename = "pairUrl")]');
    const main = await read("src/main.rs");
    expect(main).toContain('"Open in browser"');
    expect(main).toContain("pair::check(ready.pair_url.as_deref(), settings.site_url.as_deref())");
    const opens = [...main.matchAll(/\.open_url\(([^,]+),/g)].map((m) => m[1]!.trim());
    expect(opens).toEqual(["link.as_str()"]);
    const pair = await read("src/pair.rs");
    expect(pair).toContain("if !token_ok(token)");
    expect(pair).toContain("if origin != site");
  });
});

describe("dependencies and house rules", () => {
  test("Rust direct dependencies stay inside the audited set", async () => {
    const cargo = await read("Cargo.toml");
    const deps = [...cargo.matchAll(/^([a-z0-9_-]+)\s*=\s*(?:"|\{)/gm)]
      .map((m) => m[1]!)
      .filter((name) => !["name", "version", "description", "license", "edition", "path", "rust-version", "codegen-units", "lto", "opt-level", "strip", "publish", "authors", "max_width"].includes(name));
    const audited = new Set([
      "tauri",
      "tauri-build",
      "tauri-plugin-shell",
      "tauri-plugin-dialog",
      "tauri-plugin-opener",
      "tauri-plugin-global-shortcut",
      "serde",
      "serde_json",
      "libc",
    ]);
    for (const d of deps) expect(audited.has(d)).toBe(true);
    for (const needed of ["tauri", "tauri-plugin-shell", "tauri-plugin-dialog", "tauri-plugin-opener", "tauri-plugin-global-shortcut"]) {
      expect(deps).toContain(needed);
    }
  });

  test("no em-dash or emoji in desktop sources", async () => {
    // Built from a code point so this file never contains the character it bans.
    const EM_DASH = new RegExp(String.fromCodePoint(0x2014));
    const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
    const skip = /(^|\/)(node_modules|target|gen|binaries|icons)(\/|$)|resources\/web\//;
    const bad: string[] = [];
    for await (const rel of new Bun.Glob("**/*.{ts,rs,json,toml,md,plist}").scan({ cwd: desktopDir, dot: false })) {
      if (skip.test(rel)) continue;
      const text = await Bun.file(join(desktopDir, rel)).text();
      if (EM_DASH.test(text) || PICTOGRAPHIC.test(text)) bad.push(rel);
    }
    expect(bad).toEqual([]);
  });
});
