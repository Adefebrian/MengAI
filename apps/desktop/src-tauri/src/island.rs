// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! The island: a small black window on the MacBook notch that shows the crew at
//! work in real time (macOS only; Windows has no island).
//!
//! Contract with the web page (apps/web, route `/island`), both sides exact:
//! - window label `island`, loading `http://127.0.0.1:<engine port>/island`,
//!   the engine origin, so the API and the SSE stream work and writes carry the
//!   engine origin.
//! - three commands, granted only to this window and only for the exact engine
//!   origin (runtime capability `island-origin`; the main window keeps its own
//!   grant, allow-pick-folder, and cannot call these):
//!   - `island_geometry()` -> `{ hasNotch, notchWidth, notchHeight, menuBarHeight, scale }`
//!     in logical points.
//!   - `island_set_state({ state, width, height })`, state `collapsed`, `peek`
//!     or `expanded`: sets the native frame at once to exactly that size, top
//!     centered on the notch (or centered just under the menu bar). Nothing is
//!     animated natively; the page animates inside, so the window is always the
//!     visible size and clicks next to it reach the menu bar.
//!   - `island_open_main({ path })`: shows and focuses the main window and routes
//!     it to that path, which must start with `/app`.
//!
//! The window is transparent, borderless, shadowless and fixed size, on every
//! Space and over full screen apps, above the menu bar. It never activates the
//! app when it appears (ordered in with orderFrontRegardless, never made key);
//! it takes focus only when the owner clicks it, and accept-first-mouse lets
//! that click reach Approve, Deny or Open. WKWebView tracks the pointer only in
//! the key window, so hover (the peek) would wait for a click; the island copies
//! WebKit's tracking areas as always active, with public AppKit calls only (JEV
//! be.native_workaround retarget_tracking_areas 1.0). The geometry comes from the display
//! with a notch (NSScreen safeAreaInsets and the auxiliary top areas, macOS
//! 12+), else the primary display with a pill under its menu bar. A display
//! change (lid closed, display plugged or unplugged, main display changed)
//! re-reads it; when what the page sizes itself from changed, the page reloads
//! and asks again.
// The geometry math and the runtime state are used by the AppKit side only; on
// Windows the commands answer that the island is macOS only.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::ipc::CapabilityBuilder;
use tauri::menu::CheckMenuItem;
use tauri::{AppHandle, Manager, Url, WebviewWindow, Wry};

use crate::applog::AppLog;
use crate::window;

pub const ISLAND_WINDOW: &str = "island";
/// Page of the island on the engine.
pub const ISLAND_PATH: &str = "/island";
/// Runtime capability of the island window.
pub const CAPABILITY: &str = "island-origin";
/// The commands of the contract and their generated allow permissions (build.rs app manifest).
#[cfg(test)]
pub const COMMANDS: [&str; 3] = ["island_geometry", "island_set_state", "island_open_main"];
pub const PERMISSIONS: [&str; 3] = ["allow-island-geometry", "allow-island-set-state", "allow-island-open-main"];
/// Tray check item id.
pub const MENU_ISLAND: &str = "show-island";
/// Space between the menu bar and the pill on a display without a notch.
pub const PILL_GAP: f64 = 6.0;
/// Menu bar height used when a display reports none (menu bar set to hide automatically).
pub const FALLBACK_MENU_BAR: f64 = 24.0;
/// Size before the page reports one, on a display without a notch.
pub const DEFAULT_PILL: (f64, f64) = (200.0, 32.0);
/// Upper bounds of a page request, so a broken page can never cover the screen.
pub const MAX_WIDTH: f64 = 640.0;
pub const MAX_HEIGHT: f64 = 480.0;
pub const MIN_SIDE: f64 = 8.0;
const MAX_PATH: usize = 2048;
#[cfg(not(target_os = "macos"))]
const MAC_ONLY: &str = "the island is only available on macOS";

// ---------------------------------------------------------------- geometry

/// A rectangle in points, Cocoa global coordinates: origin at the bottom left of
/// the primary display, y up (what NSScreen and NSWindow frames use).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self { x, y, width, height }
    }
    pub fn max_x(&self) -> f64 {
        self.x + self.width
    }
    pub fn max_y(&self) -> f64 {
        self.y + self.height
    }
    fn is_empty(&self) -> bool {
        !(self.width > 0.0 && self.height > 0.0)
    }
}

/// One display as AppKit reports it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Screen {
    pub frame: Rect,
    /// frame minus the menu bar and the Dock.
    pub visible: Rect,
    /// safeAreaInsets.top: the notch height on a display with a notch, 0 elsewhere.
    pub safe_top: f64,
    /// auxiliaryTopLeftArea and auxiliaryTopRightArea: the menu bar on either side of
    /// the notch; empty on a display without one.
    pub aux_left: Rect,
    pub aux_right: Rect,
    /// backingScaleFactor.
    pub scale: f64,
}

/// What `island_geometry` answers, in logical points.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub has_notch: bool,
    pub notch_width: f64,
    pub notch_height: f64,
    pub menu_bar_height: f64,
    pub scale: f64,
}

/// Width of the notch: the gap between the two auxiliary top areas. The gap is the
/// same whether AppKit reports them in screen or global coordinates.
fn notch_width(s: &Screen) -> Option<f64> {
    if s.safe_top.is_nan() || s.safe_top <= 0.0 || s.aux_left.is_empty() || s.aux_right.is_empty() {
        return None;
    }
    let gap = s.aux_right.x - s.aux_left.max_x();
    (gap > 0.0 && gap < s.frame.width).then_some(gap)
}

fn menu_bar_height(s: &Screen, fallback: f64) -> f64 {
    let bar = s.frame.max_y() - s.visible.max_y();
    if bar > 0.0 && bar < s.frame.height / 4.0 {
        bar
    } else {
        fallback
    }
}

fn scale(s: &Screen) -> f64 {
    if s.scale.is_finite() && s.scale >= 1.0 {
        s.scale
    } else {
        1.0
    }
}

pub fn geometry(s: &Screen) -> Geometry {
    match notch_width(s) {
        Some(width) => Geometry {
            has_notch: true,
            notch_width: width,
            notch_height: s.safe_top,
            menu_bar_height: menu_bar_height(s, s.safe_top),
            scale: scale(s),
        },
        None => Geometry {
            has_notch: false,
            notch_width: 0.0,
            notch_height: 0.0,
            menu_bar_height: menu_bar_height(s, FALLBACK_MENU_BAR),
            scale: scale(s),
        },
    }
}

/// The display the island lives on: the one with a notch (the built-in display
/// with its lid open), else the primary display (first in NSScreen.screens).
pub fn pick(screens: &[Screen]) -> Option<&Screen> {
    screens.iter().find(|s| notch_width(s).is_some()).or_else(|| screens.first())
}

/// Size before the page reports one: the notch itself, or the default pill.
pub fn default_size(g: &Geometry) -> (f64, f64) {
    if g.has_notch {
        (g.notch_width, g.notch_height)
    } else {
        DEFAULT_PILL
    }
}

/// Validates a page request and bounds it to the island limits and the display. Err is the reason.
pub fn bounded_size(s: &Screen, width: f64, height: f64) -> Result<(f64, f64), String> {
    if !(width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0) {
        return Err(format!("the island size {width} x {height} is not a positive number of points"));
    }
    let max_w = MAX_WIDTH.min(s.frame.width).max(MIN_SIDE);
    let max_h = MAX_HEIGHT.min(s.frame.height / 2.0).max(MIN_SIDE);
    Ok((width.clamp(MIN_SIDE, max_w), height.clamp(MIN_SIDE, max_h)))
}

fn snap(v: f64, scale: f64) -> f64 {
    (v * scale).round() / scale
}

/// The window frame for an island of `width` x `height` points: its top on the top
/// edge of the display, centered on the notch, or centered just under the menu bar.
/// The origin is snapped to device pixels and kept on the display.
pub fn frame(s: &Screen, width: f64, height: f64) -> Rect {
    let g = geometry(s);
    let width = width.min(s.frame.width);
    let height = height.min(s.frame.height);
    let (center, top) = match notch_width(s) {
        Some(notch) => (s.frame.x + s.aux_left.width + notch / 2.0, s.frame.max_y()),
        None => (s.frame.x + s.frame.width / 2.0, s.frame.max_y() - g.menu_bar_height - PILL_GAP),
    };
    let x = snap(center - width / 2.0, g.scale).clamp(s.frame.x, s.frame.max_x() - width);
    let y = snap(top - height, g.scale);
    Rect::new(x, y, width, height)
}

/// NSTrackingAreaOptions bits (AppKit, stable since 10.5).
pub mod tracking {
    pub const ENTERED_AND_EXITED: usize = 0x01;
    pub const MOUSE_MOVED: usize = 0x02;
    pub const WHEN_FIRST_RESPONDER: usize = 0x10;
    pub const IN_KEY_WINDOW: usize = 0x20;
    pub const IN_ACTIVE_APP: usize = 0x40;
    pub const ALWAYS: usize = 0x80;
}

/// Options for a copy of a WebKit tracking area that keeps working while the island
/// is not the key window: the same events, active always instead of only in the
/// key window, the active app or the first responder. None when the area is
/// already always active or tracks no pointer movement.
pub fn always_active(options: usize) -> Option<usize> {
    use tracking::*;
    let gated = WHEN_FIRST_RESPONDER | IN_KEY_WINDOW | IN_ACTIVE_APP;
    let pointer = ENTERED_AND_EXITED | MOUSE_MOVED;
    (options & pointer != 0 && options & ALWAYS == 0).then_some((options & !gated) | ALWAYS)
}

// ---------------------------------------------------------------- contract

/// The island states the page reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IslandState {
    Collapsed,
    Peek,
    Expanded,
    /// Nothing to show and no notch to sit in: the window leaves the screen until a run or a request.
    Hidden,
}

pub fn island_url(port: u16) -> String {
    format!("{}{ISLAND_PATH}", window::origin(port))
}

/// The only pages the island window may load: /island on the exact engine origin.
pub fn is_island_url(url: &Url, port: u16) -> bool {
    window::is_sidecar_url(url, port)
        && (url.path() == ISLAND_PATH || url.path().starts_with(&format!("{ISLAND_PATH}/")))
        && url.username().is_empty()
        && url.password().is_none()
}

fn under_app(path: &str) -> bool {
    path == window::APP_PATH || path.starts_with(&format!("{}/", window::APP_PATH))
}

/// An `island_open_main` path: an app path under /app, returned normalized (dot
/// segments resolved) with its query and fragment. Err is the reason.
pub fn main_path(path: &str) -> Result<String, String> {
    let bad = |why: &str| {
        let shown: String = path.chars().filter(|c| !c.is_control()).take(80).collect();
        format!("the path \"{shown}\" {why}")
    };
    if path.len() > MAX_PATH {
        return Err(bad("is too long"));
    }
    if path.chars().any(|c| c.is_control() || c.is_whitespace() || c == '\\') {
        return Err(bad("contains a control character, a space or a backslash"));
    }
    let rest = path.strip_prefix(window::APP_PATH).ok_or_else(|| bad("does not start with /app"))?;
    if !(rest.is_empty() || rest.starts_with(['/', '?', '#'])) {
        return Err(bad("does not start with /app"));
    }
    let base = Url::parse("http://127.0.0.1/").map_err(|e| bad(&e.to_string()))?;
    let url = base.join(path).map_err(|e| bad(&format!("is not a valid path ({e})")))?;
    if url.origin() != base.origin() || !under_app(url.path()) {
        return Err(bad("leaves /app"));
    }
    let mut out = url.path().to_string();
    if let Some(q) = url.query() {
        out.push('?');
        out.push_str(q);
    }
    if let Some(f) = url.fragment() {
        out.push('#');
        out.push_str(f);
    }
    Ok(out)
}

/// Client side routing in a main window that already shows the app: the web
/// router (apps/web/src/router.tsx) follows popstate. `path` comes from `main_path`
/// and is passed as a JSON string, never spliced raw.
pub fn route_script(path: &str) -> String {
    let literal = serde_json::to_string(path).unwrap_or_else(|_| "\"/app\"".into());
    format!(
        "(function(p){{if(location.pathname+location.search+location.hash!==p){{history.pushState(null,\"\",p)}}dispatchEvent(new PopStateEvent(\"popstate\"))}})({literal})"
    )
}

/// Only the island window may run the island commands (the capability already
/// scopes them; this is the second check).
pub fn caller_allowed(label: &str) -> bool {
    label == ISLAND_WINDOW
}

fn only_island(window: &WebviewWindow) -> Result<(), String> {
    if caller_allowed(window.label()) {
        Ok(())
    } else {
        Err("only the island window may call this".into())
    }
}

/// The island window's grant: the three commands, for the exact engine origin, for
/// the island window only, never for local content.
pub fn capability(port: u16) -> CapabilityBuilder {
    PERMISSIONS.iter().fold(
        CapabilityBuilder::new(CAPABILITY).remote(window::origin(port)).local(false).window(ISLAND_WINDOW),
        |cap, permission| cap.permission(*permission),
    )
}

// ---------------------------------------------------------------- runtime

/// Island state for this run of the shell.
pub struct Island {
    log: Arc<AppLog>,
    /// Engine port once it reported ready; the island opens only then.
    port: OnceLock<u16>,
    /// Whether the island is on for this session: the setting, then the tray item and the kill switch.
    on: AtomicBool,
    /// The tray check item "Show island".
    item: OnceLock<CheckMenuItem<Wry>>,
    /// Last state and size the page asked for, reapplied when the displays change.
    last: Mutex<Option<(IslandState, f64, f64)>>,
    /// Geometry the page last saw; a display change that alters it reloads the page.
    seen: Mutex<Option<Geometry>>,
    /// The display change observer is registered once.
    observing: AtomicBool,
}

impl Island {
    pub fn new(log: Arc<AppLog>) -> Self {
        Self {
            log,
            port: OnceLock::new(),
            on: AtomicBool::new(false),
            item: OnceLock::new(),
            last: Mutex::new(None),
            seen: Mutex::new(None),
            observing: AtomicBool::new(false),
        }
    }

    fn set_item(&self, on: bool) {
        if let Some(item) = self.item.get() {
            let _ = item.set_checked(on);
        }
    }
}

/// The tray check item "Show island" (macOS only), unchecked until the settings are read.
pub fn tray_item(app: &AppHandle) -> tauri::Result<Option<CheckMenuItem<Wry>>> {
    if !cfg!(target_os = "macos") {
        return Ok(None);
    }
    let item = CheckMenuItem::with_id(app, MENU_ISLAND, "Show island", true, false, None::<&str>)?;
    if let Some(island) = app.try_state::<Island>() {
        let _ = island.item.set(item.clone());
    }
    Ok(Some(item))
}

/// The saved setting, read at startup. The island itself opens once the engine is ready.
pub fn apply_setting(app: &AppHandle, on: bool) {
    let Some(island) = app.try_state::<Island>() else { return };
    let on = on && cfg!(target_os = "macos");
    island.on.store(on, Ordering::SeqCst);
    island.set_item(on);
}

/// The engine is ready: grant the island window its commands for this exact
/// origin (once per run), then remember the port (the island never opens without
/// the grant), and open the island when it is on.
pub fn engine_ready(app: &AppHandle, port: u16) {
    let Some(island) = app.try_state::<Island>() else { return };
    if !cfg!(target_os = "macos") || island.port.get().is_some() {
        return;
    }
    if let Err(e) = app.add_capability(capability(port)) {
        island.on.store(false, Ordering::SeqCst);
        island.set_item(false);
        island.log.error("island", &format!("could not grant the island its commands ({e}); the island stays off"));
        return;
    }
    let _ = island.port.set(port);
    if island.on.load(Ordering::SeqCst) {
        open(app);
    }
}

/// Tray item clicked: flips the island for this session and returns the new value,
/// which the caller saves to settings.json.
pub fn toggle(app: &AppHandle) -> bool {
    let Some(island) = app.try_state::<Island>() else { return false };
    let on = !island.on.load(Ordering::SeqCst);
    island.on.store(on, Ordering::SeqCst);
    island.set_item(on);
    island.log.info("island", if on { "turned on from the tray" } else { "turned off from the tray" });
    if on {
        open(app);
    } else {
        close(app);
    }
    on
}

/// Kill switch: the island closes for the rest of this session. The saved setting
/// is left alone, so it is back on the next launch; the tray item turns it on again.
pub fn stop_for_session(app: &AppHandle) {
    if let Some(island) = app.try_state::<Island>() {
        if island.on.swap(false, Ordering::SeqCst) {
            island.log.info("island", "closed by the kill switch for this session");
        }
        island.set_item(false);
    }
    close(app);
}

/// Closes the island window if it is open (quit, kill switch, tray item off).
pub fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(ISLAND_WINDOW) {
        let _ = w.destroy();
    }
    if let Some(island) = app.try_state::<Island>() {
        *island.last.lock().unwrap_or_else(|e| e.into_inner()) = None;
        *island.seen.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

#[cfg(target_os = "macos")]
fn open(app: &AppHandle) {
    native::open(app);
}

#[cfg(not(target_os = "macos"))]
fn open(_app: &AppHandle) {}

// ---------------------------------------------------------------- commands

/// `island_geometry()`: the notch (or the menu bar) of the display the island lives on.
#[tauri::command]
pub fn island_geometry(app: AppHandle, window: WebviewWindow) -> Result<Geometry, String> {
    only_island(&window)?;
    #[cfg(target_os = "macos")]
    {
        native::geometry_now(&app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err(MAC_ONLY.into())
    }
}

/// `island_set_state({ state, width, height })`: the native frame, at once, exactly that size.
#[tauri::command]
pub fn island_set_state(
    app: AppHandle,
    window: WebviewWindow,
    state: IslandState,
    width: f64,
    height: f64,
) -> Result<(), String> {
    only_island(&window)?;
    if !(width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0) {
        return Err(format!("the island size {width} x {height} is not a positive number of points"));
    }
    #[cfg(target_os = "macos")]
    {
        native::set_state(&app, window, state, width, height)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, state);
        Err(MAC_ONLY.into())
    }
}

/// `island_open_main({ path })`: shows and focuses the main window on an app path under /app.
#[tauri::command]
pub fn island_open_main(app: AppHandle, window: WebviewWindow, path: String) -> Result<(), String> {
    only_island(&window)?;
    let path = main_path(&path)?;
    let port = app.try_state::<Island>().and_then(|i| i.port.get().copied()).ok_or("the engine is not ready yet")?;
    let main = app.get_webview_window(window::MAIN_WINDOW).ok_or("the main window is not open yet")?;
    let url = Url::parse(&format!("{}{path}", window::origin(port))).map_err(|e| e.to_string())?;
    let routed = main.url().ok().is_some_and(|now| window::is_sidecar_url(&now, port) && under_app(now.path()));
    if routed {
        main.eval(route_script(&path)).map_err(|e| e.to_string())?;
    } else {
        main.navigate(url).map_err(|e| e.to_string())?;
    }
    crate::instance::raise(Some(&main));
    Ok(())
}

// ---------------------------------------------------------------- AppKit

#[cfg(target_os = "macos")]
mod native {
    use std::ptr::NonNull;
    use std::sync::atomic::Ordering;
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::runtime::NSObjectProtocol;
    use objc2::{sel, AnyThread, MainThreadMarker};
    use objc2_app_kit::{
        NSApplicationDidChangeScreenParametersNotification, NSMainMenuWindowLevel, NSScreen, NSTrackingArea,
        NSTrackingAreaOptions, NSView, NSWindow, NSWindowAnimationBehavior, NSWindowCollectionBehavior,
    };
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSOperationQueue, NSPoint, NSRect, NSSize};
    use tauri::webview::NewWindowResponse;
    use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

    use super::{
        always_active, bounded_size, default_size, frame, geometry, is_island_url, island_url, pick, Geometry, Island,
        IslandState, Rect, Screen, DEFAULT_PILL, ISLAND_WINDOW,
    };

    /// Levels above the main menu (24): over the menu bar and status items (25),
    /// under pop-up menus (101), so a menu opened from the menu bar still covers it.
    const LEVELS_ABOVE_MENU_BAR: isize = 3;
    /// How long a call from a worker thread waits for the main thread.
    const MAIN_DEADLINE: Duration = Duration::from_secs(2);
    /// How deep the view walk goes looking for the web view's tracking areas.
    const VIEW_DEPTH: usize = 8;

    /// Runs `f` on the main thread: at once when already there (sync commands and
    /// menu handlers), else dispatched and awaited with a deadline.
    fn on_main<T: Send + 'static>(
        app: &AppHandle,
        f: impl FnOnce(MainThreadMarker) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        if let Some(mtm) = MainThreadMarker::new() {
            return f(mtm);
        }
        let (tx, rx) = mpsc::channel();
        app.run_on_main_thread(move || {
            if let Some(mtm) = MainThreadMarker::new() {
                let _ = tx.send(f(mtm));
            }
        })
        .map_err(|e| e.to_string())?;
        rx.recv_timeout(MAIN_DEADLINE).map_err(|_| "the main thread did not answer in time".to_string())?
    }

    /// Borrows the NSWindow behind a Tauri window on the main thread.
    fn with_ns<R>(window: &WebviewWindow, _mtm: MainThreadMarker, f: impl FnOnce(&NSWindow) -> R) -> Result<R, String> {
        let ptr = window.ns_window().map_err(|e| e.to_string())?.cast::<NSWindow>();
        let ns = NonNull::new(ptr).ok_or("the island window has no native window")?;
        // SAFETY: Tauri hands out the NSWindow of a live window; `window` keeps it
        // alive for this borrow and the marker proves we are on the main thread,
        // where AppKit objects may be used.
        Ok(f(unsafe { ns.as_ref() }))
    }

    fn rect(r: NSRect) -> Rect {
        Rect::new(r.origin.x, r.origin.y, r.size.width, r.size.height)
    }

    fn ns_rect(r: Rect) -> NSRect {
        NSRect::new(NSPoint::new(r.x, r.y), NSSize::new(r.width, r.height))
    }

    /// Every display, in NSScreen.screens order (the primary display first).
    fn screens(mtm: MainThreadMarker) -> Vec<Screen> {
        NSScreen::screens(mtm)
            .iter()
            .map(|s| {
                // macOS 12+ (the app needs 13); checked anyway so an older system gets the pill, not a crash.
                let notch_api = s.respondsToSelector(sel!(safeAreaInsets))
                    && s.respondsToSelector(sel!(auxiliaryTopLeftArea))
                    && s.respondsToSelector(sel!(auxiliaryTopRightArea));
                let (safe_top, aux_left, aux_right) = if notch_api {
                    (s.safeAreaInsets().top, rect(s.auxiliaryTopLeftArea()), rect(s.auxiliaryTopRightArea()))
                } else {
                    (0.0, Rect::default(), Rect::default())
                };
                Screen {
                    frame: rect(s.frame()),
                    visible: rect(s.visibleFrame()),
                    safe_top,
                    aux_left,
                    aux_right,
                    scale: s.backingScaleFactor(),
                }
            })
            .collect()
    }

    pub fn geometry_now(app: &AppHandle) -> Result<Geometry, String> {
        let app2 = app.clone();
        on_main(app, move |mtm| {
            let all = screens(mtm);
            let screen = pick(&all).ok_or("no display is connected")?;
            let g = geometry(screen);
            if let Some(island) = app2.try_state::<Island>() {
                *island.seen.lock().unwrap_or_else(|e| e.into_inner()) = Some(g);
            }
            Ok(g)
        })
    }

    pub fn set_state(
        app: &AppHandle,
        window: WebviewWindow,
        state: IslandState,
        width: f64,
        height: f64,
    ) -> Result<(), String> {
        let app2 = app.clone();
        on_main(app, move |mtm| {
            let all = screens(mtm);
            let screen = pick(&all).ok_or("no display is connected")?;
            let (w, h) = bounded_size(screen, width, height)?;
            if state == IslandState::Hidden {
                with_ns(&window, mtm, |ns| ns.orderOut(None))?;
            } else {
                // back on screen without activating the app or taking focus
                with_ns(&window, mtm, |ns| {
                    ns.setFrame_display(ns_rect(frame(screen, w, h)), true);
                    if !ns.isVisible() {
                        ns.orderFrontRegardless();
                    }
                })?;
            }
            if let Some(island) = app2.try_state::<Island>() {
                *island.last.lock().unwrap_or_else(|e| e.into_inner()) = Some((state, w, h));
            }
            Ok(())
        })
    }

    /// Level, Spaces, no shadow, no move, no hide with the app, out of the Window menu and Cmd+`.
    fn configure(ns: &NSWindow) {
        ns.setLevel(NSMainMenuWindowLevel + LEVELS_ABOVE_MENU_BAR);
        ns.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        ns.setHasShadow(false);
        ns.setMovable(false);
        ns.setCanHide(false);
        ns.setHidesOnDeactivate(false);
        ns.setExcludedFromWindowsMenu(true);
        ns.setAnimationBehavior(NSWindowAnimationBehavior::None);
    }

    /// Replaces every pointer tracking area in the island's views that only works in the
    /// key window or the active app (WKWebView's own) with an always active copy: same
    /// owner, rect and user info. The owner is WebKit's tracking observer, which lives
    /// exactly as long as the web view that holds the area. Idempotent.
    fn track_always(view: &NSView, depth: usize) {
        for area in view.trackingAreas().iter() {
            let Some(bits) = always_active(area.options().0) else { continue };
            let Some(owner) = area.owner() else { continue };
            let options = NSTrackingAreaOptions(bits);
            let copied = view
                .trackingAreas()
                .iter()
                .any(|a| a.options() == options && a.owner().is_some_and(|o| std::ptr::eq(&*o, &*owner)));
            view.removeTrackingArea(&area);
            if !copied {
                // SAFETY: owner and user info are the ones AppKit already dispatched to for
                // this view; the area does not retain its owner, like the one it replaces.
                let copy = unsafe {
                    NSTrackingArea::initWithRect_options_owner_userInfo(
                        NSTrackingArea::alloc(),
                        area.rect(),
                        options,
                        Some(&owner),
                        area.userInfo().as_deref(),
                    )
                };
                view.addTrackingArea(&copy);
            }
        }
        if depth < VIEW_DEPTH {
            for sub in view.subviews().iter() {
                track_always(&sub, depth + 1);
            }
        }
    }

    /// Places the window on the island display at the last size the page asked for
    /// (or the default), then orders it in without activating the app or making it key.
    fn present(app: &AppHandle, window: &WebviewWindow, mtm: MainThreadMarker) -> Result<(), String> {
        let island = app.state::<Island>();
        let all = screens(mtm);
        let Some(screen) = pick(&all) else {
            with_ns(window, mtm, |ns| ns.orderOut(None))?;
            return Err("no display is connected".into());
        };
        let g = geometry(screen);
        let last = *island.last.lock().unwrap_or_else(|e| e.into_inner());
        let (w, h) = last.map(|(_, w, h)| (w, h)).unwrap_or_else(|| default_size(&g));
        let (w, h) = bounded_size(screen, w, h).unwrap_or(DEFAULT_PILL);
        with_ns(window, mtm, |ns| {
            configure(ns);
            if let Some(content) = ns.contentView() {
                track_always(&content, 0);
            }
            ns.setFrame_display(ns_rect(frame(screen, w, h)), true);
            ns.orderFrontRegardless();
        })
    }

    fn build(app: &AppHandle, port: u16) -> tauri::Result<WebviewWindow> {
        let url = Url::parse(&island_url(port)).map_err(tauri::Error::InvalidUrl)?;
        WebviewWindowBuilder::new(app, ISLAND_WINDOW, WebviewUrl::External(url))
            .title("MengAI island")
            .inner_size(DEFAULT_PILL.0, DEFAULT_PILL.1)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(false)
            .skip_taskbar(true)
            .visible_on_all_workspaces(true)
            .always_on_top(true)
            // Hidden until placed; `present` orders it in without making it key.
            .visible(false)
            .focused(false)
            // The owner's first click on an inactive app lands on Approve, Deny or Open.
            .accept_first_mouse(true)
            .disable_drag_drop_handler()
            .on_navigation(move |url| is_island_url(url, port))
            .on_new_window(|_url, _features| NewWindowResponse::Deny)
            .build()
    }

    /// Creates the window when it does not exist, grants its capability, places and shows it,
    /// and starts following display changes. Any failure is logged and turns the island off;
    /// the app itself keeps working.
    pub fn open(app: &AppHandle) {
        let island = app.state::<Island>();
        let Some(&port) = island.port.get() else { return };
        let window = match app.get_webview_window(ISLAND_WINDOW) {
            Some(w) => Ok(w),
            None => build(app, port),
        };
        let shown = window.map_err(|e| e.to_string()).and_then(|w| {
            let app2 = app.clone();
            on_main(app, move |mtm| present(&app2, &w, mtm))
        });
        match shown {
            Ok(()) => island.log.info("island", &format!("shown, loading {}", island_url(port))),
            Err(e) => {
                island.log.error("island", &format!("could not show the island ({e}); the app works without it"));
                island.on.store(false, Ordering::SeqCst);
                island.set_item(false);
                super::close(app);
                return;
            }
        }
        if !island.observing.swap(true, Ordering::SeqCst) {
            let app2 = app.clone();
            if let Err(e) = on_main(app, move |_mtm| {
                observe_displays(app2);
                Ok(())
            }) {
                island.observing.store(false, Ordering::SeqCst);
                island.log.warn("island", &format!("display changes are not followed ({e})"));
            }
        }
    }

    /// NSApplicationDidChangeScreenParametersNotification on the main queue: a
    /// display added or removed, the lid closed, the arrangement or the main display
    /// changed. Registered once for the life of the app.
    fn observe_displays(app: AppHandle) {
        let block = RcBlock::new(move |_note: NonNull<NSNotification>| displays_changed(&app));
        let center = NSNotificationCenter::defaultCenter();
        let queue = NSOperationQueue::mainQueue();
        // SAFETY: the name is an AppKit constant, no sender object is passed, the
        // block only captures a Send + Sync AppHandle and runs on the main queue.
        let token = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSApplicationDidChangeScreenParametersNotification),
                None,
                Some(&queue),
                &block,
            )
        };
        // The center keeps the block until the observer is removed, which is never:
        // it lives as long as the app. Dropping the token would not unregister it either.
        std::mem::forget(token);
    }

    fn displays_changed(app: &AppHandle) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let Some(island) = app.try_state::<Island>() else { return };
        let Some(window) = app.get_webview_window(ISLAND_WINDOW) else { return };
        let all = screens(mtm);
        let Some(screen) = pick(&all) else {
            let _ = with_ns(&window, mtm, |ns| ns.orderOut(None));
            island.log.warn("island", "no display is connected; hiding the island");
            return;
        };
        let g = geometry(screen);
        let before = island.seen.lock().unwrap_or_else(|e| e.into_inner()).replace(g);
        if before.is_some_and(|b| b != g) {
            // What the page sized itself from changed: back to the default size, reload, it asks again.
            *island.last.lock().unwrap_or_else(|e| e.into_inner()) = None;
            let what = if g.has_notch {
                format!("notch {} x {} pt", g.notch_width, g.notch_height)
            } else {
                format!("no notch, pill under a {} pt menu bar", g.menu_bar_height)
            };
            island.log.info("island", &format!("displays changed ({what}); reloading the island"));
            let _ = window.reload();
        }
        if let Err(e) = present(app, &window, mtm) {
            island.log.warn("island", &format!("could not place the island after a display change ({e})"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::RuntimeCapability;
    use tauri::utils::acl::capability::CapabilityFile;

    /// MacBook Pro 14 inch at its default scaled resolution: notch 185 x 32 pt, menu bar 37 pt.
    fn notched() -> Screen {
        Screen {
            frame: Rect::new(0.0, 0.0, 1512.0, 982.0),
            visible: Rect::new(0.0, 70.0, 1512.0, 875.0),
            safe_top: 32.0,
            aux_left: Rect::new(0.0, 950.0, 663.5, 32.0),
            aux_right: Rect::new(848.5, 950.0, 663.5, 32.0),
            scale: 2.0,
        }
    }

    /// A 1440 x 900 display without a notch, 24 pt menu bar, scale 1, left of the primary.
    fn plain(x: f64) -> Screen {
        Screen {
            frame: Rect::new(x, 0.0, 1440.0, 900.0),
            visible: Rect::new(x, 0.0, 1440.0, 876.0),
            safe_top: 0.0,
            aux_left: Rect::default(),
            aux_right: Rect::default(),
            scale: 1.0,
        }
    }

    #[test]
    fn a_notched_display_reports_the_gap_between_the_auxiliary_areas() {
        let g = geometry(&notched());
        assert_eq!(
            g,
            Geometry { has_notch: true, notch_width: 185.0, notch_height: 32.0, menu_bar_height: 37.0, scale: 2.0 }
        );
        // Probed on a MacBook Pro 16 inch at 1800 x 1169: notch 220 x 38, menu bar 39.
        let pro16 = Screen {
            frame: Rect::new(0.0, 0.0, 1800.0, 1169.0),
            visible: Rect::new(0.0, 0.0, 1800.0, 1130.0),
            safe_top: 38.0,
            aux_left: Rect::new(0.0, 1131.0, 790.0, 38.0),
            aux_right: Rect::new(1010.0, 1131.0, 790.0, 38.0),
            scale: 2.0,
        };
        assert_eq!(
            geometry(&pro16),
            Geometry { has_notch: true, notch_width: 220.0, notch_height: 38.0, menu_bar_height: 39.0, scale: 2.0 }
        );
        assert_eq!(frame(&pro16, 220.0, 38.0), Rect::new(790.0, 1131.0, 220.0, 38.0));
        // AppKit in global coordinates on a display right of the primary: same gap.
        let mut moved = notched();
        moved.frame.x = 1440.0;
        moved.visible.x = 1440.0;
        moved.aux_left.x = 1440.0;
        moved.aux_right.x = 1440.0 + 848.5;
        assert_eq!(geometry(&moved).notch_width, 185.0);
    }

    #[test]
    fn no_notch_means_a_pill_under_the_menu_bar() {
        let g = geometry(&plain(0.0));
        assert_eq!(
            g,
            Geometry { has_notch: false, notch_width: 0.0, notch_height: 0.0, menu_bar_height: 24.0, scale: 1.0 }
        );
        // A safe area without auxiliary areas is not a notch.
        let mut odd = plain(0.0);
        odd.safe_top = 24.0;
        assert!(!geometry(&odd).has_notch);
        // Menu bar set to hide: the visible frame reaches the top, the fallback applies.
        let mut hidden = plain(0.0);
        hidden.visible.height = 900.0;
        assert_eq!(geometry(&hidden).menu_bar_height, FALLBACK_MENU_BAR);
        let mut hidden_notch = notched();
        hidden_notch.visible.height = 912.0;
        assert_eq!(geometry(&hidden_notch).menu_bar_height, 32.0, "falls back to the notch height");
        // A nonsense scale never breaks the math.
        let mut zero = plain(0.0);
        zero.scale = 0.0;
        assert_eq!(geometry(&zero).scale, 1.0);
    }

    #[test]
    fn the_island_sits_on_the_notch_or_under_the_menu_bar() {
        // Notch: the top touches the top edge, centered on the notch.
        let f = frame(&notched(), 300.0, 40.0);
        assert_eq!(f, Rect::new(606.0, 942.0, 300.0, 40.0));
        assert_eq!(f.x + f.width / 2.0, 663.5 + 185.0 / 2.0);
        assert_eq!(f.max_y(), 982.0);
        // Collapsed at the notch size covers exactly the notch.
        assert_eq!(frame(&notched(), 185.0, 32.0), Rect::new(663.5, 950.0, 185.0, 32.0));
        // No notch: centered, just under the 24 pt menu bar with the gap.
        let p = frame(&plain(0.0), 200.0, 32.0);
        assert_eq!(p, Rect::new(620.0, 900.0 - 24.0 - PILL_GAP - 32.0, 200.0, 32.0));
        // A display left of the primary (negative x) keeps its own center.
        let left = frame(&plain(-1440.0), 200.0, 32.0);
        assert_eq!(left.x, -1440.0 + 620.0);
    }

    #[test]
    fn origins_snap_to_device_pixels_for_the_scale() {
        // Odd width on a scale 1 display: the half point rounds to a whole pixel.
        let p = frame(&plain(0.0), 201.0, 33.0);
        assert_eq!(p.x, 620.0);
        assert_eq!(p.x.fract(), 0.0);
        // Scale 2 keeps half points.
        let n = frame(&notched(), 201.0, 33.0);
        assert_eq!(n.x * 2.0, (n.x * 2.0).round());
        assert_eq!(n.x, 655.5);
    }

    #[test]
    fn sizes_are_validated_and_bounded() {
        let s = notched();
        assert_eq!(bounded_size(&s, 360.0, 120.0), Ok((360.0, 120.0)));
        assert_eq!(bounded_size(&s, 5000.0, 5000.0), Ok((MAX_WIDTH, MAX_HEIGHT)));
        assert_eq!(bounded_size(&s, 1.0, 1.0), Ok((MIN_SIDE, MIN_SIDE)));
        for (w, h) in [(0.0, 10.0), (10.0, -1.0), (f64::NAN, 10.0), (10.0, f64::INFINITY)] {
            assert!(bounded_size(&s, w, h).is_err(), "{w} x {h}");
        }
        // A small display bounds the island to itself.
        let mut tiny = plain(0.0);
        tiny.frame = Rect::new(0.0, 0.0, 400.0, 300.0);
        assert_eq!(bounded_size(&tiny, 600.0, 400.0), Ok((400.0, 150.0)));
        // The frame never leaves the display even when asked for more.
        let f = frame(&tiny, 900.0, 40.0);
        assert!(f.x >= 0.0 && f.max_x() <= 400.0);
    }

    #[test]
    fn the_notched_display_wins_else_the_primary() {
        let screens = [plain(-1440.0), notched()];
        assert!(pick(&screens).map(|s| geometry(s).has_notch).unwrap_or(false));
        // Lid closed: only external displays remain, the first one (primary) is used.
        let externals = [plain(0.0), plain(1440.0)];
        assert_eq!(pick(&externals).map(|s| s.frame.x), Some(0.0));
        assert!(pick(&[]).is_none());
        assert_eq!(default_size(&geometry(&notched())), (185.0, 32.0));
        assert_eq!(default_size(&geometry(&plain(0.0))), DEFAULT_PILL);
    }

    #[test]
    fn webkit_tracking_areas_become_always_active() {
        // What a WKWebView registers (probed on macOS 26): pointer tracking in the key
        // window only, and entered/exited in the active app only.
        assert_eq!(always_active(0x227), Some(0x287));
        assert_eq!(always_active(0x241), Some(0x281));
        assert_eq!(always_active(0x213), Some(0x283), "first responder gating goes too");
        // Already always active, or no pointer tracking (cursor updates only): left alone.
        assert_eq!(always_active(0x287), None);
        assert_eq!(always_active(0x224), None);
        // Applying it twice changes nothing.
        assert_eq!(always_active(always_active(0x227).unwrap()), None);
    }

    #[test]
    fn open_main_accepts_app_paths_only() {
        for (input, out) in [
            ("/app", "/app"),
            ("/app/", "/app/"),
            ("/app/runs/r1", "/app/runs/r1"),
            ("/app/trading?order=o1", "/app/trading?order=o1"),
            ("/app#top", "/app#top"),
            ("/app/runs/r1/../r2", "/app/runs/r2"),
        ] {
            assert_eq!(main_path(input).as_deref(), Ok(out), "{input}");
        }
        for bad in [
            "",
            "/",
            "app",
            "/apps",
            "/application",
            "/api/killswitch",
            "/island",
            "//evil.example/app",
            "https://evil.example/app",
            "javascript:alert(1)",
            "/app/../api/killswitch",
            "/app/%2e%2e/api",
            "/app/..",
            "/app\\..\\api",
            "/app/runs\n1",
            "/app/runs 1",
            "/app/\u{0}",
        ] {
            assert!(main_path(bad).is_err(), "{bad:?} must be refused");
        }
        assert!(main_path(&format!("/app/{}", "a".repeat(MAX_PATH))).is_err());
    }

    #[test]
    fn the_route_script_passes_the_path_as_a_json_string() {
        let js = route_script("/app/runs/r1?x=\"1\"");
        assert!(js.ends_with("(\"/app/runs/r1?x=\\\"1\\\"\")"));
        assert!(js.contains("history.pushState(null,\"\",p)"));
        assert!(js.contains("new PopStateEvent(\"popstate\")"));
    }

    #[test]
    fn the_island_loads_only_its_page_on_the_exact_engine_origin() {
        let port = 4280;
        assert_eq!(island_url(port), "http://127.0.0.1:4280/island");
        let url = |s: &str| s.parse::<Url>().unwrap();
        assert!(is_island_url(&url(&island_url(port)), port));
        assert!(is_island_url(&url("http://127.0.0.1:4280/island/peek?x=1"), port));
        for bad in [
            "http://127.0.0.1:4280/app",
            "http://127.0.0.1:4280/islands",
            "http://127.0.0.1:4281/island",
            "http://localhost:4280/island",
            "https://127.0.0.1:4280/island",
            "http://127.0.0.1:5173/island",
            "https://mengai.example/island",
        ] {
            assert!(!is_island_url(&url(bad), port), "{bad}");
        }
    }

    #[test]
    fn the_capability_is_the_island_window_only_with_its_three_commands() {
        let CapabilityFile::Capability(cap) = capability(4280).build() else { panic!("one capability") };
        assert_eq!(cap.identifier, CAPABILITY);
        assert_eq!(cap.windows, vec![ISLAND_WINDOW.to_string()]);
        assert!(cap.webviews.is_empty());
        assert!(!cap.local, "never for local content");
        assert_eq!(cap.remote.map(|r| r.urls), Some(vec!["http://127.0.0.1:4280".to_string()]));
        let perms: Vec<&str> = cap.permissions.iter().map(|p| p.identifier().get()).collect();
        assert_eq!(perms, PERMISSIONS.to_vec());
        assert!(!perms.contains(&"allow-pick-folder"));
        for (command, permission) in COMMANDS.iter().zip(PERMISSIONS) {
            assert_eq!(format!("allow-{}", command.replace('_', "-")), permission);
        }
        // The main window's grant stays pick-folder only and never names the island commands.
        let CapabilityFile::Capability(main) = window::main_capability(4280).build() else { panic!("one capability") };
        assert_eq!(main.windows, vec![window::MAIN_WINDOW.to_string()]);
        let main_perms: Vec<&str> = main.permissions.iter().map(|p| p.identifier().get()).collect();
        assert_eq!(main_perms, vec!["allow-pick-folder"]);
        // And the commands refuse any other caller.
        assert!(caller_allowed("island"));
        assert!(!caller_allowed("main"));
        assert!(!caller_allowed(""));
    }

    #[test]
    fn states_parse_from_the_contract_words_only() {
        for (word, state) in
            [("collapsed", IslandState::Collapsed), ("peek", IslandState::Peek), ("expanded", IslandState::Expanded), ("hidden", IslandState::Hidden)]
        {
            assert_eq!(serde_json::from_str::<IslandState>(&format!("\"{word}\"")).unwrap(), state);
        }
        for bad in ["\"Collapsed\"", "\"open\"", "1", "null"] {
            assert!(serde_json::from_str::<IslandState>(bad).is_err(), "{bad}");
        }
        let json = serde_json::to_value(geometry(&notched())).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "hasNotch": true, "notchWidth": 185.0, "notchHeight": 32.0, "menuBarHeight": 37.0, "scale": 2.0 })
        );
    }
}
