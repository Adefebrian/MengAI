# @mengai/desktop

The MengAI macOS app: a Tauri 2 shell around the compiled Bun API sidecar.
The shell owns the window, the tray, the global kill shortcut and the
process lifecycle. All product logic lives in the sidecar (apps/api) and the
web app (apps/web); the shell never renders its own UI.

## How it starts

1. `setup` spawns `mengai-api` (resolved by tauri-plugin-shell from
   `bundle.externalBin`) in its own process group with a cleared
   environment. It passes only HOME, USER, LOGNAME, TMPDIR, PATH, LANG,
   SHELL, TZ, `LC_*`, any `MENGAI_*` passthrough (for example `MENGAI_PORT`),
   and the five contract variables:
   - `MENGAI_MODE=local`
   - `MENGAI_DATA_DIR` = `~/Library/Application Support/id.mengai.app` (mode 0700)
   - `MENGAI_WEB_DIR` = `MengAI.app/Contents/Resources/web`
   - `MENGAI_HANDS_BIN` = `MengAI.app/Contents/Resources/hands/mengai-hands` (may not exist yet)
   - `MENGAI_MIGRATIONS_DIR` = `MengAI.app/Contents/Resources/migrations`
     (holds `sqlite/*.sql`, bundled straight from the repo `migrations/sqlite`;
     a compiled sidecar cannot find migrations on its own). The shell refuses
     to start, with a dialog, if that folder has no `.sql` file.
2. The shell reads stdout until the ready line
   `{"event":"ready","port":n,"launchToken":"..","controlToken":".."}`
   (30 s deadline). Tokens must be 16 to 512 URL-safe characters.
3. It grants the page one IPC permission, `allow-pick-folder`, for the exact
   origin `http://127.0.0.1:<port>` only, then opens the main window at
   `http://127.0.0.1:<port>/#launch=<launchToken>`. Navigation off that origin
   is refused; http(s) and mailto links open in the default browser.
4. The control token stays in shell memory for the kill switch. Both tokens
   are masked in the app log.

Every sidecar stdout and stderr line after that goes to
`~/Library/Logs/id.mengai.app/mengai.log` (0600, control characters
stripped, 8 KB per line, one rotation at 5 MB, known key shapes masked).

## Kill switch

Tray item "Kill switch" and the global shortcut Cmd+Shift+Escape send
`POST /api/killswitch` with header `x-mengai-control: <controlToken>` and
body `{"by":"tray"}` or `{"by":"shortcut"}`, with a 3 s connect, write and
read deadline. A non-2xx answer or no answer fails closed: the shell kills
the sidecar's whole process group (the hands helper lives in it), shows an
error dialog and quits.

## Failure behavior (loud, never silent)

| Case | What the shell does |
|---|---|
| tray, data folder, resource folder or supervisor thread unavailable | error dialog, quit |
| bundled sqlite migrations missing | error dialog, quit (the sidecar is never spawned) |
| sidecar cannot spawn | error dialog, quit |
| no ready line within 30 s | SIGTERM, 3 s, kill group, error dialog, quit |
| malformed ready line | same as above |
| sidecar exits before or after ready | kill group, error dialog, quit |
| kill switch not confirmed | kill group now, error dialog, quit |
| global shortcut already taken | logged as an error; tray item and the in-app header button still work |

Quit (tray, Cmd+Q) sends SIGTERM to the sidecar, waits up to 3 s, then
SIGKILLs its process group. Closing the window only hides it; the crew keeps
working and the tray brings it back. If the shell itself dies, the sidecar
sees stdin close and exits.

## Develop

```sh
bun run dev        # builds apps/web and the sidecar, stages them, runs tauri dev
bun test           # config and contract checks (no network, no cargo)
cd src-tauri && cargo check && cargo test   # Rust unit tests, incl. real process-group kills
bun run scripts/icons.ts                     # regenerate icons from the vector mark
```

`cargo check` on a fresh clone writes a placeholder
`src-tauri/binaries/mengai-api-<triple>` (a shell script that exits 78 with a
message) so tauri-build can run. A release build refuses to start with the
placeholder or with no sidecar. `scripts/build.ts` also checks the staged
sidecar is a real Mach-O before bundling.

The sidecar target is fixed by `apps/api` `build:sidecar`
(`--target=bun-darwin-arm64`, so `aarch64-apple-darwin`). `bun test` fails if
that script and `bundle.externalBin` disagree.

## Build a release

```sh
bun run build                        # web, sidecar, stage, tauri build --target aarch64-apple-darwin
bun run build -- --bundles app       # extra args go to tauri build
```

Output: `src-tauri/target/aarch64-apple-darwin/release/bundle/{macos,dmg}`.

## Signing and notarization

Nothing secret lives in this repo. `tauri.conf.json` keeps
`signingIdentity: null`; the identity and notarization credentials come from
the environment of the machine or CI job that runs `bun run build`.

Signing (Developer ID Application certificate):

| Variable | Meaning |
|---|---|
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <Name> (<TEAMID>)`, from `security find-identity -v -p codesigning` |
| `APPLE_CERTIFICATE` | CI only: base64 of the exported .p12, imported into a temporary keychain by the Tauri bundler |
| `APPLE_CERTIFICATE_PASSWORD` | CI only: password of that .p12 |

Notarization, pick one:

| Option | Variables |
|---|---|
| App Store Connect API key (preferred for CI) | `APPLE_API_ISSUER`, `APPLE_API_KEY` (key id), `APPLE_API_KEY_PATH` (path to the .p8, kept outside the repo) |
| Apple ID | `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID` |

With those set, `tauri build` signs the app and the `mengai-api` sidecar (an
externalBin, signed as an executable) with the hardened runtime and
`src-tauri/entitlements.plist` (JIT and unsigned executable memory for the
Bun runtime, network client), then notarizes and staples. Confirm the sidecar
carries the JIT entitlements after the first signed build (second command
below); without them the Bun runtime crashes at launch under the hardened
runtime. Resources are not signed by the bundler, so `scripts/build.ts`
signs `resources/hands/mengai-hands` itself when `APPLE_SIGNING_IDENTITY` is
set.

Verify a signed build:

```sh
APP=src-tauri/target/aarch64-apple-darwin/release/bundle/macos/MengAI.app
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -d --entitlements - "$APP/Contents/MacOS/mengai-api"
spctl -a -vvv -t exec "$APP"
xcrun stapler validate "$APP"
```

Keep certificates, .p12 and .p8 files out of the tree (the root .gitignore
already ignores `*.p12`, `*.pem` and `*.key`).

## Privacy strings

`src-tauri/Info.plist` carries `NSAccessibilityUsageDescription` and
`NSScreenCaptureUsageDescription` for the automation helper. macOS attributes
those grants to MengAI.app; nothing asks for them until the owner turns on a
capability.

## Dependencies

Tauri 2 and its shell, dialog, opener and global-shortcut plugins, serde,
serde_json, and libc (kill and killpg only, already in the lockfile through
Tauri). The HTTP client for the kill switch and the log writer are small
in-house modules. `bun test` fails if a new direct crate appears.
