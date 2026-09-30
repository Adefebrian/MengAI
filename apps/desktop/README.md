# @mengai/desktop

The MengAI macOS app: a Tauri 2 shell around the compiled Bun engine
(sidecar). The shell owns the window, the tray, the global kill shortcut and
the process lifecycle. All product logic lives in the engine (apps/api) and
the web app (apps/web); the shell never renders its own UI.

## Use it

1. Install: open `MengAI_<version>_aarch64.dmg` and drag MengAI to
   Applications.
2. Open MengAI. The engine starts on this Mac at `127.0.0.1:4280` (or the
   first free port up to 4289 when another program holds 4280) and the
   window shows the app. Opening MengAI again only brings that window back.
3. Add a key for the model provider you use. It is stored in the macOS
   keychain on this Mac and only ever sent to that provider.
4. Give the crew a goal. Watch it work, open the live preview of what it
   built, or open its folder in Finder.

The website works too once the app is running: it is a copy of the same UI
that talks to the engine on this Mac. Add the website's origin to
`siteOrigins` in [settings.json](#settings) and open MengAI again. Nothing is
stored on the website; UI preferences stay in that browser's localStorage.

There is no login, token or pairing step. Trust comes from where the engine
listens and from strict request checks in the engine: the Host must be
`127.0.0.1:<port>` or `localhost:<port>`, a request with an `Origin` must
match the allowlist exactly (the engine's own origins, the UI dev origin and
`siteOrigins`), and every mutating request must be JSON. The crew's own
preview apps run on other loopback ports and are never allowed to drive the
engine.

## How it starts

0. One instance per Mac: `tauri-plugin-single-instance` is registered first,
   so a second launch hands off to the running app (which unminimizes, shows
   and focuses its window) and exits before it probes a port or starts an
   engine. Behind it, the shell holds an exclusive flock on
   `<data dir>/shell.lock` for its whole life; if the plugin ever lets a
   second shell through, that one stops with an "already running" dialog.
1. `setup` reads [settings.json](#settings), picks the engine port (below),
   then spawns `mengai-api` (resolved by tauri-plugin-shell from
   `bundle.externalBin`) in its own process group with a cleared
   environment. It passes only HOME, USER, LOGNAME, TMPDIR, PATH, LANG,
   SHELL, TZ, `LC_*`, any other `MENGAI_*` passthrough (for example
   `MENGAI_DEMO`; `MENGAI_SITE_URL`, `MENGAI_UI_ORIGIN` and `MENGAI_DEV_OPEN`
   are always dropped, since the window is the UI and stdin close must stop
   the engine), and the
   contract variables, which the shell owns (a value exported in the parent
   env is dropped):
   - `MENGAI_MODE=local`
   - `MENGAI_DATA_DIR` = `~/Library/Application Support/id.mengai.app` (mode 0700)
   - `MENGAI_WEB_DIR` = `MengAI.app/Contents/Resources/web`
   - `MENGAI_HANDS_BIN` = `MengAI.app/Contents/Resources/hands/mengai-hands` (may not exist yet)
   - `MENGAI_MIGRATIONS_DIR` = `MengAI.app/Contents/Resources/migrations`
     (holds `sqlite/*.sql`, bundled straight from the repo `migrations/sqlite`).
     The sidecar also embeds the same SQL (`apps/api/src/core/migrate.ts`
     `EMBEDDED_MIGRATIONS`) and migrates with no folder at all; the folder is
     an explicit override, so a shipped app and its SQL always match. The
     shell refuses to start, with a dialog, if that folder has no `.sql` file.
   - `MENGAI_PORT` = `port` from settings.json (default 4280) when it is free
     on 127.0.0.1. When it is busy and inside 4280..4289, the first free port
     of that range instead (the log says which port and whether the holder
     answered `/api/health` as a MengAI engine, for example root `bun run
     dev`); the web app probes the same range. An explicit port outside the
     range is used as is, busy means a dialog.
   - `MENGAI_SITE_ORIGINS` = `siteOrigins` from settings.json as a comma
     list, only when it is not empty
2. The shell reads stdout until the ready line
   `{"event":"ready","port":n,"controlToken":".."}` (30 s deadline).
   `controlToken` is optional; when present it must be 16 to 512 URL-safe
   characters. Any other field is ignored. A ready line with a wrong type or
   an invalid port is fatal.
3. It grants the page one IPC permission, `allow-pick-folder`, for the exact
   origin `http://127.0.0.1:<port>` only, then opens the main window at
   `http://127.0.0.1:<port>/app`.
4. The control token, when there is one, stays in shell memory for the kill
   switch and is masked in the app log.

## Window and live preview

The window is pinned to the engine origin. The crew's live previews run on
other loopback ports (`http://127.0.0.1:<preview port>/`), so the window lets
http `127.0.0.1` and `localhost` URLs on any port except the engine's load in
place, for the preview frame inside the app. If a page other than the engine
ever takes over the whole window (a link, or a preview navigating the top
frame), the shell opens that URL in the default browser and brings the window
back to `/app`. Preview origins get no IPC permission (the Tauri IPC key lives
in the main frame only, and the grant is for the exact engine origin), and the
engine rejects their `Origin`. Every other navigation is refused; http(s) and
mailto links open in the default browser, and so do new windows. **Open
folder** is handled by the engine, which reveals the project in Finder.

## Menus

| Item | Where | What it does |
|---|---|---|
| Show MengAI | tray | shows the window |
| Show settings file | tray, MengAI app menu | writes the default settings.json if it is missing, then reveals it in Finder |
| Kill switch | tray | see below |
| Quit MengAI | tray, Cmd+Q | stops the engine, its live previews and everything else it started, then quits |

## Settings

`~/Library/Application Support/id.mengai.app/settings.json`, written as the
template below (mode 0600) on first launch. Changes apply on the next launch.

```json
{
  "siteOrigins": [],
  "port": 4280
}
```

| Key | Meaning |
|---|---|
| `siteOrigins` | Exact origins of websites that serve the MengAI UI and may call this engine, for example `["https://mengai.example"]`. Passed to the engine as `MENGAI_SITE_ORIGINS` (comma list). Each entry must be https with a public host: no path, query, fragment, credentials or wildcard, and no loopback host (`localhost`, `*.localhost`, `127.x`, `[::1]`, `0.0.0.0`). Entries are stored as their bare origin and deduplicated; at most 16. Empty means only the engine's own origins. |
| `port` | Loopback port of the engine, 1024 to 65535, passed as `MENGAI_PORT`. Inside 4280..4289 a busy port falls back to the first free port of that range, which the website UI also probes; outside it the exact port is used (no fallback), so change the web app's runtime address with it. |

An older file with `"siteUrl"` is migrated on launch: an https origin moves
into `siteOrigins`, an http loopback dev origin is dropped with a warning in
the log (the engine already allows its own UI dev origin), and the file is
rewritten in the new shape (temp file and rename, mode 0600). A file with both
keys is refused.

Unknown keys, wrong types, a file over 16 KB or an unsafe origin stop startup
with a dialog naming the file (fail closed: an origin in this list can drive
the crew on this Mac). Deleting the file restores the defaults.

Every sidecar stdout and stderr line after that goes to
`~/Library/Logs/id.mengai.app/mengai.log` (0600, control characters
stripped, 8 KB per line, one rotation at 5 MB, known key shapes and bearer
tokens masked).

## Quit and live previews

The engine starts live previews, runner commands and connectors detached, in
their own process groups, and stops them itself when it gets SIGTERM or its
stdin closes. Quit (tray, Cmd+Q) makes sure nothing is left behind:

1. The shell lists the engine's descendants with `/bin/ps` (pid, parent,
   process group, start time; 2 s deadline).
2. SIGTERM to the engine, then up to 3 s for it to stop its previews and exit.
3. If it is still running: list its descendants again, SIGKILL its process
   group (the hands helper lives there), wait up to 1 s, SIGKILL the group
   once more.
4. Every listed descendant that is still alive with the same pid and start
   time (so a reused pid is never hit) is SIGKILLed, together with the
   process group it leads. Never pid 1, the shell itself or the shell's own
   group. The count is logged.

The same sweep runs on every forced stop (kill switch failure, fatal
startup error). Closing the window only hides it; the crew keeps working and
the tray brings it back. If the shell itself dies, the engine sees stdin
close, stops its children and exits.

## Kill switch

Tray item "Kill switch" and the global shortcut Cmd+Shift+Escape send
`POST /api/killswitch` with `Host: 127.0.0.1:<port>`,
`Content-Type: application/json`, header `x-mengai-control: <controlToken>`
when the engine sent one, and body `{"by":"tray"}` or `{"by":"shortcut"}`,
with a 3 s connect, write and read deadline. A non-2xx answer or no answer
fails closed: the shell force stops the engine and everything it started (see
above), shows an error dialog and quits.

## Failure behavior (loud, never silent)

| Case | What the shell does |
|---|---|
| tray, app menu, data folder, resource folder or supervisor thread unavailable | error dialog, quit |
| settings.json unreadable or invalid | error dialog naming the file, quit (the sidecar is never spawned) |
| old settings.json cannot be rewritten after migration | logged; the migrated values are used |
| MengAI opened again while it runs | the running app shows its window; the second launch exits (no second engine) |
| another shell already holds `shell.lock` in the data dir | error dialog, quit (the sidecar is never spawned) |
| settings port busy (for example by root `bun run dev`) | inside 4280..4289: logged, the engine starts on the first free port of the range; all ten busy, or an explicit port outside the range busy: error dialog, quit (the sidecar is never spawned) |
| bundled sqlite migrations missing | error dialog, quit (the sidecar is never spawned) |
| sidecar cannot spawn | error dialog, quit |
| no ready line within 30 s | SIGTERM, 3 s, kill group and sweep, error dialog, quit |
| malformed ready line | same as above |
| sidecar exits before or after ready | kill group and sweep, error dialog, quit |
| kill switch not confirmed | kill group and sweep now, error dialog, quit |
| `/bin/ps` unavailable during a stop | logged; the group kill still runs |
| global shortcut already taken | logged as an error; tray item and the in-app header button still work |

## Develop

```sh
bun run dev        # builds apps/web and the sidecar, stages them, runs tauri dev
bun test           # config and contract checks (no network, no cargo)
bun run smoke      # sidecar and dmg smoke against the last release build (see below)
cd src-tauri && cargo check && cargo test   # Rust unit tests, incl. real process-group kills
bun run scripts/icons.ts                     # regenerate icons from the vector mark
```

The app and the root `bun run dev` both default to 127.0.0.1:4280. When
`bun run dev` holds it, the app starts its engine on the next free port up to
4289 and the web app finds it there; the root dev engine has no fallback, so
start it first. The dev and release builds share the identifier and
`~/Library/Application Support/id.mengai.app`, so only one of them runs at a
time (the second hands off to the first). `bun run smoke -- --open` finds
the engine port with `lsof`, so a fallback port works there too.

`cargo check` on a fresh clone writes a placeholder
`src-tauri/binaries/mengai-api-<triple>` (a shell script that exits 78 with a
message) so tauri-build can run. A release build refuses to start with the
placeholder or with no sidecar. `scripts/build.ts` also checks the staged
sidecar is a real Mach-O before bundling.

The sidecar target is fixed by `apps/api` `build:sidecar`
(`--target=bun-darwin-arm64`, so `aarch64-apple-darwin`). `bun test` fails if
that script and `bundle.externalBin` disagree.

## Build a release

Needs Bun 1.3.14, Rust with the `aarch64-apple-darwin` target and the Xcode
Command Line Tools (full Xcode and Docker are not needed). From the repo root:

```sh
bun install --frozen-lockfile
bun run --cwd apps/desktop build                      # everything below, ends with the dmg in apps/desktop/dist
bun run --cwd apps/desktop build -- --bundles app     # extra args go to tauri build (no dmg then)
```

`scripts/build.ts` runs, and stops loudly at the first failure:

1. `apps/web` build (`Bun.build`), then `apps/api` `build:sidecar`
   (`bun build --compile --minify --target=bun-darwin-arm64 src/local.ts`)
   into `src-tauri/binaries/mengai-api-aarch64-apple-darwin`.
2. Stages `apps/web/dist` (without source maps) into `src-tauri/resources/web`
   and the hands helper when `services/hands` has been built.
3. Boots the compiled sidecar once on a temp data dir with no migrations
   folder: ready line, `GET /api/health`, `GET /`, and every
   `migrations/sqlite` version recorded in `schema_migrations` from the SQL
   embedded in the binary. This runs before the Rust build, so a broken
   sidecar fails in seconds.
4. `tauri build --target aarch64-apple-darwin` (targets `app` and `dmg`).
5. `codesign --verify --deep --strict` on `MengAI.app`, and checks that
   `Contents/MacOS/mengai-api` carries the hardened runtime flag and
   `com.apple.security.cs.allow-jit`.
6. The sidecar smoke (`scripts/smoke.ts`) against the bundled app, then
   `hdiutil verify` on the dmg.
7. Copies the dmg to `apps/desktop/dist/MengAI_<version>_aarch64.dmg`
   (gitignored by the root `dist/` rule) and prints its size and sha256.

Bundles stay in `src-tauri/target/aarch64-apple-darwin/release/bundle/{macos,dmg}`
(or under `$CARGO_TARGET_DIR` when set; the script follows it).

Two defaults keep the build headless:

- No `APPLE_SIGNING_IDENTITY`: the app is ad-hoc signed (`-`). It still gets
  the hardened runtime and `src-tauri/entitlements.plist`, so it behaves like a
  signed build on this Mac, but it is not notarized and Gatekeeper blocks it
  on any other Mac. Notarization credentials without an identity fail the
  build.
- `CI=true` is set for `tauri build`, which makes the Tauri dmg bundler skip
  its Finder AppleScript (icon layout), the only step that would ask for
  Automation access. The dmg still holds `MengAI.app` and the Applications
  link. On a signed-in desktop, `MENGAI_DMG_LAYOUT=1 bun run build` keeps the
  layout step (macOS asks once to let the terminal control Finder).

Build from a committed state. When the working tree has in-flight changes in
other packages, build a clean export in a separate worktree and copy the dmg
back:

```sh
git worktree add --detach ../mengai-dmg HEAD
cd ../mengai-dmg && bun install --frozen-lockfile
CARGO_TARGET_DIR="$OLDPWD/apps/desktop/src-tauri/target" bun run --cwd apps/desktop build   # reuses the Rust cache
cp apps/desktop/dist/MengAI_*_aarch64.dmg "$OLDPWD/apps/desktop/dist/"
cd "$OLDPWD" && git worktree remove ../mengai-dmg
```

Note: the root `.gitignore` rule `data/` also matches
`apps/web/src/landing/data/`, so a fresh checkout or worktree lacks
`bench.ts` and the web build fails until that rule is anchored (`/data/`) and
the folder is committed. Until then copy the folder into the worktree.

## Smoke test

```sh
bun run smoke                       # mounts dist/MengAI_<version>_aarch64.dmg read-only, tests the app inside, detaches
bun run smoke -- --app <path>       # a MengAI.app instead of the dmg
bun run smoke -- --open             # also launches the app with `open -g`, then quits it
```

The sidecar part runs `Contents/MacOS/mengai-api` the way the shell does
(cleared env, stdin held open, `MENGAI_MODE=local`, temp `MENGAI_DATA_DIR`
and `MENGAI_WORKSPACES_DIR`), three times: embedded migrations stopped with
SIGTERM, the bundled `Contents/Resources/migrations` folder stopped by closing
stdin, and a restart on the first data dir. Each run needs the ready line
within 30 s with a valid port (and a contract-valid `controlToken` when
present), `GET /api/health` 200, `GET /` and `GET /app` serving the bundled
web app, every bundled migration in `schema_migrations`, and exit code 0
within 5 s. Temp folders are removed.

`--open` launches the app in the background, waits for the shell and its
`mengai-api` child, finds the sidecar port with `lsof`, checks
`/api/health`, then sends SIGTERM to the shell and requires both processes
gone within 10 s (the sidecar exits on stdin close). It removes the app's
Application Support, Caches and WebKit folders when this run created them and
keeps `~/Library/Logs/id.mengai.app`. Nothing in the smoke sends Apple Events
or leaves loopback, so it never triggers a macOS permission prompt. It refuses
to run while that app is already open.

## Signing and notarization

Nothing secret lives in this repo. `tauri.conf.json` keeps
`signingIdentity: null`; the identity and notarization credentials come from
the environment of the machine or CI job that runs `bun run build`.

Signing (Developer ID Application certificate):

| Variable | Meaning |
|---|---|
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <Name> (<TEAMID>)`, from `security find-identity -v -p codesigning`. Unset means ad-hoc (`-`) |
| `APPLE_CERTIFICATE` | CI only: base64 of the exported .p12, imported into a temporary keychain by the Tauri bundler |
| `APPLE_CERTIFICATE_PASSWORD` | CI only: password of that .p12 |

Notarization, pick one:

| Option | Variables |
|---|---|
| App Store Connect API key (preferred for CI) | `APPLE_API_ISSUER`, `APPLE_API_KEY` (key id), `APPLE_API_KEY_PATH` (path to the .p8, kept outside the repo) |
| Apple ID | `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID` |

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)"
export APPLE_API_ISSUER=<issuer uuid> APPLE_API_KEY=<key id> APPLE_API_KEY_PATH=$HOME/.private_keys/AuthKey_<key id>.p8
bun run --cwd apps/desktop build
```

With those set, `tauri build` signs the app and the `mengai-api` sidecar (an
externalBin, signed as an executable) with the hardened runtime, a secure
timestamp and `src-tauri/entitlements.plist`, then notarizes and staples.
Resources are not signed by the bundler, so `scripts/build.ts` signs
`resources/hands/mengai-hands` itself (hardened runtime, plus a timestamp
unless ad-hoc).

### JIT entitlements for the Bun sidecar

`mengai-api` is a Bun standalone executable: JavaScriptCore with its JIT.
Under the hardened runtime it crashes at launch unless its own signature
carries:

- `com.apple.security.cs.allow-jit` (MAP_JIT pages for the JIT)
- `com.apple.security.cs.allow-unsigned-executable-memory` (JSC code it writes at run time)
- `com.apple.security.network.client` (outbound calls to the providers the owner configured)

Entitlements are per binary: the sidecar needs them in its own code
signature, not only the shell's. `scripts/build.ts` fails the build when the
bundled sidecar lacks the runtime flag or `allow-jit`, and then boots that
signed sidecar, which also proves the payload `bun build --compile` embeds
survived re-signing. Add Bun's other suggested entitlements
(`disable-executable-page-protection`, `allow-dyld-environment-variables`,
`disable-library-validation`) only if a signed build shows it needs them;
each one widens what the hardened runtime allows.

### Tauri externalBin notarization issue

Tauri signs `externalBin` sidecars itself, and there is an open upstream
report of notarization rejecting apps because of the sidecar's signature
(typical notary log entries against `Contents/MacOS/<sidecar>`: "The
signature of the binary is invalid", "The executable does not have the
hardened runtime enabled", or "The signature does not include a secure
timestamp"). Until it is closed, read the notary log for every release:

```sh
xcrun notarytool history --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER"
xcrun notarytool log <submission-id> --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER"
```

If it names `mengai-api`, sign inside out by hand and notarize outside Tauri:

```sh
APP=src-tauri/target/aarch64-apple-darwin/release/bundle/macos/MengAI.app
ID="$APPLE_SIGNING_IDENTITY"
ENT=src-tauri/entitlements.plist
DMG=dist/MengAI_0.1.0_aarch64.dmg
codesign --force --options runtime --timestamp --entitlements "$ENT" --sign "$ID" "$APP/Contents/MacOS/mengai-api"
codesign --force --options runtime --timestamp --entitlements "$ENT" --sign "$ID" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
ditto -c -k --keepParent "$APP" dist/MengAI.zip
xcrun notarytool submit dist/MengAI.zip --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait
xcrun stapler staple "$APP"
hdiutil create -volname MengAI -srcfolder "$APP" -ov -format UDZO "$DMG"
codesign --force --timestamp --sign "$ID" "$DMG"
xcrun notarytool submit "$DMG" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait
xcrun stapler staple "$DMG"
bun run smoke
```

Sign `Contents/Resources/hands/mengai-hands` the same way before the app when
it is bundled.

Verify a signed build:

```sh
APP=src-tauri/target/aarch64-apple-darwin/release/bundle/macos/MengAI.app
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -d --entitlements - "$APP/Contents/MacOS/mengai-api"
spctl -a -vvv -t exec "$APP"
xcrun stapler validate "$APP"
xcrun stapler validate dist/MengAI_0.1.0_aarch64.dmg
```

An ad-hoc build passes the first two and fails `spctl` and `stapler`, as
expected.

Keep certificates, .p12 and .p8 files out of the tree (the root .gitignore
already ignores `*.p12`, `*.pem` and `*.key`).

## Privacy strings

`src-tauri/Info.plist` carries `NSAccessibilityUsageDescription` and
`NSScreenCaptureUsageDescription` for the automation helper. macOS attributes
those grants to MengAI.app; nothing asks for them until the owner turns on a
capability.

## Dependencies

Tauri 2 and its shell, dialog, opener, global-shortcut and single-instance
plugins, serde, serde_json, and libc (kill, killpg and flock only, already in
the lockfile through Tauri). The HTTP client for the kill switch and the port
probe, the log writer, the settings reader and the process tree sweep
(`/bin/ps`, no FFI) are small in-house modules (URL parsing is `tauri::Url`).
`bun test` fails if a new direct crate appears.
