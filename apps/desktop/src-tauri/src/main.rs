//! MengAI macOS shell (Tauri 2).
//!
//! Spawns the compiled Bun API sidecar, waits for its ready line, opens the
//! main window on http://127.0.0.1:<port>/#launch=<token>, and owns the kill
//! switch (tray item and Cmd+Shift+Escape). Every startup failure and every
//! failure to reach the engine is loud: an error dialog and a clean stop,
//! never a panic and never a silent fallback.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod applog;
mod control;
mod sidecar;
mod signals;
mod window;

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, OnceLock};
use std::thread;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_shell::ShellExt;

use applog::AppLog;
use control::Trigger;
use sidecar::{Event, Paths, Sidecar};

/// externalBin name in tauri.conf.json (the file on disk carries the target triple).
const SIDECAR_NAME: &str = "mengai-api";
/// Resource paths inside Contents/Resources (see bundle.resources).
const WEB_DIR: &str = "web";
const HANDS_BIN: &str = "hands/mengai-hands";
/// Holds `sqlite/*.sql` (bundle.resources maps the repo migrations/sqlite there).
const MIGRATIONS_DIR: &str = "migrations";

struct Shell {
    log: Arc<AppLog>,
    sidecar: OnceLock<Arc<Sidecar>>,
    quitting: AtomicBool,
    kill_in_flight: AtomicBool,
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
    });
    if let Err(message) = start(app, &log) {
        spawn_fatal(app, message);
    }
}

/// Tray, shortcut, paths, then the sidecar and its supervisor. Err is the dialog text.
fn start(app: &AppHandle, log: &Arc<AppLog>) -> Result<(), String> {
    build_tray(app).map_err(|e| format!("MengAI could not create its menu bar item ({e})."))?;
    if let Err(e) = app.global_shortcut().register(kill_shortcut()) {
        log.error("shell", &format!("global kill shortcut Cmd+Shift+Escape is unavailable ({e}); the tray item and the header button still work"));
    }

    let data_dir = app.path().app_data_dir().map_err(|e| format!("MengAI could not locate its data folder ({e})."))?;
    create_private_dir(&data_dir)
        .map_err(|e| format!("MengAI could not create its data folder at {} ({e}).", data_dir.display()))?;
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
    let sidecar = Sidecar::spawn(cmd, &paths, log.clone(), tx)
        .map_err(|e| format!("MengAI could not start its engine ({e}). Details are in the app log."))?;
    log.info("shell", &format!("sidecar spawned, pid {}", sidecar.pid));
    let _ = app.state::<Shell>().sidecar.set(sidecar);
    let handle = app.clone();
    // On error the sidecar is already registered, so the fatal path stops its group.
    thread::Builder::new()
        .name("sidecar-supervisor".into())
        .spawn(move || supervise(handle, rx))
        .map_err(|e| format!("MengAI could not watch its engine ({e})."))?;
    Ok(())
}

/// True when `dir` holds at least one `.sql` file (what the sidecar migrates from).
fn has_sql_files(dir: &Path) -> bool {
    fs::read_dir(dir)
        .map(|entries| entries.flatten().any(|e| e.path().extension().is_some_and(|x| x == "sql")))
        .unwrap_or(false)
}

/// Waits for the ready line (30 s), opens the window, then watches for an unexpected exit.
fn supervise(app: AppHandle, rx: Receiver<Event>) {
    match rx.recv_timeout(sidecar::READY_TIMEOUT) {
        Ok(Event::Ready(ready)) => {
            if let Some(sc) = app.state::<Shell>().sidecar.get() {
                sc.set_ready(&ready);
            }
            if let Err(e) = window::open_main(&app, ready.port, &ready.launch_token) {
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
            Some((port, token)) => match control::post_killswitch(port, &token, by, control::DEADLINE) {
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
            let _ = signals::kill_group(sc.pid);
        }
        shell.kill_in_flight.store(false, Ordering::SeqCst);
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show MengAI", true, None::<&str>)?;
    let kill = MenuItem::with_id(app, "killswitch", "Kill switch", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit MengAI", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &kill, &quit])?;
    TrayIconBuilder::with_id("mengai")
        .icon(tauri::include_image!("icons/tray.png"))
        .icon_as_template(true)
        .tooltip("MengAI")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => window::show_main(app),
            "killswitch" => trigger_killswitch(app, Trigger::Tray),
            "quit" => {
                if let Some(shell) = app.try_state::<Shell>() {
                    shell.quitting.store(true, Ordering::SeqCst);
                }
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// SIGTERM, 3 s grace, then the process group. Runs on RunEvent::Exit.
fn shutdown(app: &AppHandle) {
    let Some(shell) = app.try_state::<Shell>() else { return };
    shell.quitting.store(true, Ordering::SeqCst);
    if let Some(sc) = shell.sidecar.get() {
        shell.log.info("shell", "quitting: stopping the engine");
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
