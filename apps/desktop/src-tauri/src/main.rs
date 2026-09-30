// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! MengAI macOS shell (Tauri 2).
//!
//! Spawns the compiled Bun API sidecar, waits for its ready line, opens the
//! main window on http://127.0.0.1:<port>/app (local mode has no auth, so no
//! token rides along), and owns the kill switch (tray item and
//! Cmd+Shift+Escape). The window is the UI; the owner's website reaches the
//! same engine once its origin is listed in settings.json. Quitting stops the
//! engine and everything it started, live previews included. Every startup
//! failure and every failure to reach the engine is loud: an error dialog and
//! a clean stop, never a panic and never a silent fallback.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod applog;
mod control;
mod procs;
mod settings;
mod sidecar;
mod signals;
mod window;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, OnceLock};
use std::thread;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::ShellExt;

use applog::AppLog;
use control::Trigger;
use settings::Settings;
use sidecar::{Event, Paths, Sidecar};

/// externalBin name in tauri.conf.json (the file on disk carries the target triple).
const SIDECAR_NAME: &str = "mengai-api";
/// Resource paths inside Contents/Resources (see bundle.resources).
const WEB_DIR: &str = "web";
const HANDS_BIN: &str = "hands/mengai-hands";
/// Holds `sqlite/*.sql` (bundle.resources maps the repo migrations/sqlite there).
const MIGRATIONS_DIR: &str = "migrations";

/// Menu ids, shared by the tray menu and the app menu (one global handler).
const MENU_SHOW: &str = "show";
const MENU_SETTINGS: &str = "settings";
const MENU_KILLSWITCH: &str = "killswitch";
const MENU_QUIT: &str = "quit";

struct Shell {
    log: Arc<AppLog>,
    sidecar: OnceLock<Arc<Sidecar>>,
    quitting: AtomicBool,
    kill_in_flight: AtomicBool,
    /// `<app data dir>/settings.json`, once the data dir is known.
    settings_path: OnceLock<PathBuf>,
}

fn kill_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Escape)
}

fn main() {
    let kill_id = kill_shortcut().id();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut.id() == kill_id && event.state() == ShortcutState::Pressed {
                        trigger_killswitch(app, Trigger::Shortcut);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![pick_folder])
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .setup(|app| {
            setup(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the MengAI shell");

    app.run(|app, event| match event {
        RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { api, .. }, .. }
            if label == window::MAIN_WINDOW =>
        {
            // Closing the window keeps the crew working from the tray; Quit stops everything.
            let quitting = app.try_state::<Shell>().map(|s| s.quitting.load(Ordering::SeqCst)).unwrap_or(true);
            if !quitting {
                api.prevent_close();
                if let Some(w) = app.get_webview_window(window::MAIN_WINDOW) {
                    let _ = w.hide();
                }
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => window::show_main(app),
        RunEvent::ExitRequested { .. } => {
            if let Some(shell) = app.try_state::<Shell>() {
                shell.quitting.store(true, Ordering::SeqCst);
            }
        }
        RunEvent::Exit => shutdown(app),
        _ => {}
    });
}

/// Never fails the Tauri builder: every startup error becomes an error dialog and a clean quit.
fn setup(app: &AppHandle) {
    let log = Arc::new(AppLog::open(app.path().app_log_dir().ok()));
    log.info("shell", &format!("MengAI {} starting", app.package_info().version));
    app.manage(Shell {
        log: log.clone(),
        sidecar: OnceLock::new(),
        quitting: AtomicBool::new(false),
        kill_in_flight: AtomicBool::new(false),
        settings_path: OnceLock::new(),
    });
    if let Err(message) = start(app, &log) {
        spawn_fatal(app, message);
    }
}

/// Menus, shortcut, paths, settings, then the sidecar and its supervisor. Err is the dialog text.
fn start(app: &AppHandle, log: &Arc<AppLog>) -> Result<(), String> {
    build_tray(app).map_err(|e| format!("MengAI could not create its menu bar item ({e})."))?;
    build_app_menu(app).map_err(|e| format!("MengAI could not create its app menu ({e})."))?;
    if let Err(e) = app.global_shortcut().register(kill_shortcut()) {
        log.error("shell", &format!("global kill shortcut Cmd+Shift+Escape is unavailable ({e}); the tray item and the header button still work"));
    }

    let data_dir = app.path().app_data_dir().map_err(|e| format!("MengAI could not locate its data folder ({e})."))?;
    create_private_dir(&data_dir)
        .map_err(|e| format!("MengAI could not create its data folder at {} ({e}).", data_dir.display()))?;
    let settings = load_settings(app, log, &data_dir)?;
    if !sidecar::port_available(settings.port) {
        return Err(format!(
            "Port {} on 127.0.0.1 is already in use, often by another MengAI engine such as `bun run dev`. Quit it, or set another \"port\" in {}, then open MengAI again.",
            settings.port,
            data_dir.join(settings::FILE_NAME).display()
        ));
    }
    let resources =
        app.path().resource_dir().map_err(|e| format!("MengAI could not locate its bundled resources ({e})."))?;
    let paths = Paths {
        data_dir,
        web_dir: resources.join(WEB_DIR),
        hands_bin: resources.join(HANDS_BIN),
        migrations_dir: resources.join(MIGRATIONS_DIR),
    };
    if !has_sql_files(&paths.migrations_dir.join("sqlite")) {
        return Err(format!(
            "MengAI is missing its database migrations at {}. Reinstall MengAI; for a dev build rerun `bun run dev`.",
            paths.migrations_dir.join("sqlite").display()
        ));
    }
    if !paths.web_dir.join("index.html").exists() {
        log.warn("shell", &format!("bundled web app missing at {}", paths.web_dir.display()));
    }
    if !paths.hands_bin.exists() {
        log.info("shell", "hands helper is not bundled; automation stays unavailable");
    }

    let cmd: std::process::Command = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|e| format!("MengAI could not find its engine ({e}). Details are in the app log."))?
        .into();
    let (tx, rx) = mpsc::channel();
    let sidecar = Sidecar::spawn(cmd, &paths, &settings, log.clone(), tx)
        .map_err(|e| format!("MengAI could not start its engine ({e}). Details are in the app log."))?;
    log.info("shell", &format!("sidecar spawned, pid {}", sidecar.pid));
    let _ = app.state::<Shell>().sidecar.set(sidecar);
    let handle = app.clone();
    // On error the sidecar is already registered, so the fatal path stops its group.
    thread::Builder::new()
        .name("sidecar-supervisor".into())
        .spawn(move || supervise(handle, rx, settings))
        .map_err(|e| format!("MengAI could not watch its engine ({e})."))?;
    Ok(())
}

/// True when `dir` holds at least one `.sql` file (what the sidecar migrates from).
fn has_sql_files(dir: &Path) -> bool {
    fs::read_dir(dir)
        .map(|entries| entries.flatten().any(|e| e.path().extension().is_some_and(|x| x == "sql")))
        .unwrap_or(false)
}

/// settings.json from the data dir: missing means defaults plus a template; invalid is fatal;
/// the old `siteUrl` shape is migrated and rewritten.
fn load_settings(app: &AppHandle, log: &AppLog, data_dir: &Path) -> Result<Settings, String> {
    let path = data_dir.join(settings::FILE_NAME);
    let _ = app.state::<Shell>().settings_path.set(path.clone());
    let loaded = settings::load(&path).map_err(|reason| {
        format!(
            "MengAI could not use its settings file at {}: {reason}. Fix the file or delete it to go back to the defaults, then open MengAI again.",
            path.display()
        )
    })?;
    if loaded.missing {
        if let Err(e) = settings::write_template(&path) {
            log.warn(
                "settings",
                &format!("could not write the default settings file at {} ({e}); using the defaults", path.display()),
            );
        }
    }
    if let Some(migration) = &loaded.migration {
        if let Some(dropped) = &migration.dropped {
            log.warn("settings", dropped);
        }
        match settings::rewrite(&path, &loaded.settings) {
            Ok(()) => log.info("settings", "moved the old \"siteUrl\" into \"siteOrigins\""),
            Err(e) => log.warn(
                "settings",
                &format!("could not rewrite {} in the new shape ({e}); using the migrated values", path.display()),
            ),
        }
    }
    let settings = loaded.settings;
    let sites = if settings.site_origins.is_empty() { "none".to_string() } else { settings.site_origins.join(", ") };
    log.info("settings", &format!("site origins {sites}, port {}", settings.port));
    Ok(settings)
}

/// Waits for the ready line (30 s), opens the window, then watches for an unexpected exit.
fn supervise(app: AppHandle, rx: Receiver<Event>, settings: Settings) {
    match rx.recv_timeout(sidecar::READY_TIMEOUT) {
        Ok(Event::Ready(ready)) => {
            let shell = app.state::<Shell>();
            if let Some(sc) = shell.sidecar.get() {
                sc.set_ready(&ready);
            }
            if ready.port != settings.port {
                shell.log.warn(
                    "shell",
                    &format!(
                        "engine listens on {} instead of the configured port {}; the website may not find it",
                        ready.port, settings.port
                    ),
                );
            }
            if ready.control_token.is_none() {
                shell.log.info("shell", "engine sent no control token; the kill switch posts without one");
            }
            if let Err(e) = window::open_main(&app, ready.port) {
                return fatal(&app, &format!("MengAI could not open its window ({e})."), false);
            }
        }
        Ok(Event::Broken(reason)) => {
            return fatal(
                &app,
                &format!("The MengAI engine sent an invalid ready signal ({reason}). Details are in the app log."),
                false,
            );
        }
        Ok(Event::Exited(code)) => {
            return fatal(
                &app,
                &format!(
                    "The MengAI engine stopped before it was ready ({}). Details are in the app log.",
                    exit_text(code)
                ),
                false,
            );
        }
        Err(RecvTimeoutError::Timeout) => {
            return fatal(
                &app,
                "The MengAI engine did not report ready within 30 seconds. Details are in the app log.",
                false,
            );
        }
        Err(RecvTimeoutError::Disconnected) => {
            return fatal(
                &app,
                "Lost contact with the MengAI engine during startup. Details are in the app log.",
                false,
            );
        }
    }
    while let Ok(event) = rx.recv() {
        if let Event::Exited(code) = event {
            if !app.state::<Shell>().quitting.load(Ordering::SeqCst) {
                fatal(
                    &app,
                    &format!(
                        "The MengAI engine stopped unexpectedly ({}). MengAI will close; details are in the app log.",
                        exit_text(code)
                    ),
                    false,
                );
            }
            return;
        }
    }
}

fn exit_text(code: Option<i32>) -> String {
    code.map(|c| format!("exit code {c}")).unwrap_or_else(|| "killed by a signal".into())
}

/// Stops the engine, tells the user, quits. Must run off the main thread (blocking dialog).
fn fatal(app: &AppHandle, message: &str, force: bool) {
    let Some(shell) = app.try_state::<Shell>() else {
        app.exit(1);
        return;
    };
    shell.log.error("shell", message);
    shell.quitting.store(true, Ordering::SeqCst);
    if let Some(sc) = shell.sidecar.get() {
        sc.stop(force, &shell.log);
    }
    app.dialog().message(message).title("MengAI").kind(MessageDialogKind::Error).blocking_show();
    app.exit(1);
}

fn spawn_fatal(app: &AppHandle, message: String) {
    let handle = app.clone();
    if thread::Builder::new().name("fatal".into()).spawn(move || fatal(&handle, &message, true)).is_err() {
        app.exit(1);
    }
}

/// Tray and shortcut kill switch. Fail closed: if the engine cannot confirm
/// within 3 s, its whole process group is force stopped and the app closes
/// (JEV sec.shell_hardening fail_closed 1.0).
fn trigger_killswitch(app: &AppHandle, by: Trigger) {
    let Some(shell) = app.try_state::<Shell>() else { return };
    if shell.kill_in_flight.swap(true, Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    let spawned = thread::Builder::new().name("killswitch".into()).spawn(move || {
        let shell = handle.state::<Shell>();
        match shell.sidecar.get().and_then(|s| s.control()) {
            None => shell.log.warn("killswitch", "pressed before the engine was ready; nothing is running yet"),
            Some((port, token)) => match control::post_killswitch(port, token.as_deref(), by, control::DEADLINE) {
                Ok(out) => shell.log.info("killswitch", &format!("accepted from {} (HTTP {}): {}", by.as_str(), out.status, out.body)),
                Err(reason) => {
                    let message = format!(
                        "The kill switch could not reach the MengAI engine ({reason}). The engine and every process it started were force stopped. MengAI will now close."
                    );
                    fatal(&handle, &message, true);
                }
            },
        }
        shell.kill_in_flight.store(false, Ordering::SeqCst);
    });
    if spawned.is_err() {
        shell.log.error("killswitch", "could not start the kill switch thread; force stopping the engine");
        if let Some(sc) = shell.sidecar.get() {
            sc.stop(true, &shell.log);
        }
        shell.kill_in_flight.store(false, Ordering::SeqCst);
    }
}

fn settings_item(app: &AppHandle) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(app, MENU_SETTINGS, "Show settings file", true, None::<&str>)
}

/// Tray menu. Clicks go to `on_menu`.
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, MENU_SHOW, "Show MengAI", true, None::<&str>)?;
    let settings = settings_item(app)?;
    let kill = MenuItem::with_id(app, MENU_KILLSWITCH, "Kill switch", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit MengAI", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &settings, &kill, &quit])?;
    TrayIconBuilder::with_id("mengai")
        .icon(tauri::include_image!("icons/tray.png"))
        .icon_as_template(true)
        .tooltip("MengAI")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .build(app)?;
    Ok(())
}

/// The macOS default app menu with "Show settings file" under About.
fn build_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::default(app)?;
    let settings = settings_item(app)?;
    let separator = PredefinedMenuItem::separator(app)?;
    match menu.items()?.first().and_then(|item| item.as_submenu()) {
        // [About, separator, ...]: insert after them.
        Some(app_menu) => app_menu.insert_items(&[&settings, &separator], 2)?,
        None => menu.prepend(&Submenu::with_items(app, "MengAI", true, &[&settings])?)?,
    }
    app.set_menu(menu)?;
    Ok(())
}

/// One handler for the tray and the app menu (Tauri delivers both to global menu listeners).
fn on_menu(app: &AppHandle, id: &str) {
    match id {
        MENU_SHOW => window::show_main(app),
        MENU_SETTINGS => show_settings_file(app),
        MENU_KILLSWITCH => trigger_killswitch(app, Trigger::Tray),
        MENU_QUIT => {
            if let Some(shell) = app.try_state::<Shell>() {
                shell.quitting.store(true, Ordering::SeqCst);
            }
            app.exit(0);
        }
        _ => {}
    }
}

/// Reveals settings.json in Finder, writing the default template first when it is missing.
fn show_settings_file(app: &AppHandle) {
    let Some(shell) = app.try_state::<Shell>() else { return };
    let outcome = match shell.settings_path.get() {
        None => Err("MengAI has not located its data folder yet.".to_string()),
        Some(path) => settings::write_template(path)
            .map_err(|e| format!("MengAI could not create {} ({e}).", path.display()))
            .and_then(|()| {
                app.opener()
                    .reveal_item_in_dir(path)
                    .map_err(|e| format!("MengAI could not show {} in Finder ({e}).", path.display()))
            }),
    };
    if let Err(message) = outcome {
        shell.log.warn("settings", &message);
        notice(app, &message);
    }
}

/// Non-blocking warning dialog; safe on the main thread (menu handlers run there).
fn notice(app: &AppHandle, message: &str) {
    app.dialog().message(message).title("MengAI").kind(MessageDialogKind::Warning).show(|_| {});
}

/// SIGTERM (the engine stops its live previews and other children), 3 s grace, then the
/// process group, then any descendant that outlived the engine. Runs on RunEvent::Exit.
fn shutdown(app: &AppHandle) {
    let Some(shell) = app.try_state::<Shell>() else { return };
    shell.quitting.store(true, Ordering::SeqCst);
    if let Some(sc) = shell.sidecar.get() {
        shell.log.info("shell", "quitting: stopping the engine and its previews");
        sc.stop(false, &shell.log);
    }
    shell.log.info("shell", "stopped");
}

fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Native folder picker for the web app (`window.__TAURI__.core.invoke("pick_folder")`).
/// Only the sidecar origin may call it (runtime capability in window.rs).
#[tauri::command]
async fn pick_folder(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    let picked = window.dialog().file().set_title("Choose a project folder").set_parent(&window).blocking_pick_folder();
    match picked {
        None => Ok(None),
        Some(path) => path.into_path().map(|p| Some(p.to_string_lossy().into_owned())).map_err(|e| e.to_string()),
    }
}
