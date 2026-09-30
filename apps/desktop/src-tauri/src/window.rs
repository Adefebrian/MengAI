//! Main window on the sidecar origin, pinned there.
//!
//! The window loads http://127.0.0.1:<port>/app straight from the engine (local
//! mode has no auth, so no token rides along). The page is a remote origin to
//! Tauri, so it gets exactly one IPC grant, `allow-pick-folder`, scoped at
//! runtime to http://127.0.0.1:<exact port> (JEV sec.shell_hardening
//! runtime_exact_origin 0.64); the IPC key is injected into the main frame only.
//!
//! Live previews of what the crew built run on other loopback ports. The
//! navigation handler cannot tell frames apart, so it lets http 127.0.0.1 and
//! localhost URLs on other ports through for the preview frame; a top-level
//! page that commits anywhere but the engine origin is opened in the default
//! browser and the window goes back to /app (JEV sec.shell_hardening
//! preview_frames allow_loopback_frames_bounce_top 0.64). Every other
//! navigation is refused; http(s) and mailto links open in the default browser.
use tauri::ipc::CapabilityBuilder;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

pub const MAIN_WINDOW: &str = "main";
/// Path of the web app on the engine.
pub const APP_PATH: &str = "/app";

pub fn origin(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

pub fn app_url(port: u16) -> String {
    format!("{}{APP_PATH}", origin(port))
}

pub fn is_sidecar_url(url: &Url, port: u16) -> bool {
    url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(port)
}

/// A crew preview server: plain http on 127.0.0.1 or localhost, any explicit port except the engine's.
pub fn is_preview_url(url: &Url, port: u16) -> bool {
    url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1" | "localhost"))
        && url.port().is_some_and(|p| p != port)
        && url.username().is_empty()
        && url.password().is_none()
}

pub fn is_external_link(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

/// What the navigation handler does with a URL.
#[derive(Debug, PartialEq, Eq)]
pub enum Nav {
    /// Load it in the webview (the engine, or a preview frame).
    Allow,
    /// Cancel it and hand it to the default browser.
    External,
    /// Cancel it silently.
    Deny,
}

pub fn navigation(url: &Url, port: u16) -> Nav {
    if is_sidecar_url(url, port) || is_preview_url(url, port) {
        Nav::Allow
    } else if is_external_link(url) {
        Nav::External
    } else {
        Nav::Deny
    }
}

/// True when the top-level page left the engine origin and the window must go back to /app.
pub fn must_bounce(top: &Url, port: u16) -> bool {
    !is_sidecar_url(top, port)
}

fn open_external(app: &AppHandle, url: &Url, port: u16) {
    if is_external_link(url) && !is_sidecar_url(url, port) {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

pub fn open_main(app: &AppHandle, port: u16) -> tauri::Result<()> {
    app.add_capability(
        CapabilityBuilder::new("sidecar-origin")
            .remote(origin(port))
            .window(MAIN_WINDOW)
            .permission("allow-pick-folder"),
    )?;
    let home = Url::parse(&app_url(port)).map_err(tauri::Error::InvalidUrl)?;
    let nav_app = app.clone();
    let popup_app = app.clone();
    let load_app = app.clone();
    WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::External(home.clone()))
        .title("MengAI")
        .inner_size(1280.0, 820.0)
        .min_inner_size(960.0, 640.0)
        .center()
        .disable_drag_drop_handler()
        .on_navigation(move |url| match navigation(url, port) {
            Nav::Allow => true,
            Nav::External => {
                open_external(&nav_app, url, port);
                false
            }
            Nav::Deny => false,
        })
        .on_page_load(move |window, payload| {
            // Main frame only: a preview (or anything else) took over the whole window.
            if payload.event() == PageLoadEvent::Started && must_bounce(payload.url(), port) {
                open_external(&load_app, payload.url(), port);
                let _ = window.navigate(home.clone());
            }
        })
        .on_new_window(move |url, _features| {
            open_external(&popup_app, &url, port);
            NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        s.parse().unwrap()
    }

    #[test]
    fn pins_navigation_to_the_exact_origin() {
        let port = 4190;
        assert!(is_sidecar_url(&url("http://127.0.0.1:4190/app/runs/1"), port));
        assert!(!is_sidecar_url(&url("http://127.0.0.1:4191/"), port));
        assert!(!is_sidecar_url(&url("http://localhost:4190/"), port));
        assert!(!is_sidecar_url(&url("https://127.0.0.1:4190/"), port));
        assert!(is_external_link(&url("https://example.com")));
        assert!(!is_external_link(&url("file:///etc/passwd")));
        assert!(!is_external_link(&url("javascript:alert(1)")));
    }

    #[test]
    fn preview_frames_load_in_place_everything_else_leaves() {
        let port = 4190;
        assert_eq!(navigation(&url("http://127.0.0.1:4190/app"), port), Nav::Allow);
        assert_eq!(navigation(&url("http://127.0.0.1:5173/"), port), Nav::Allow);
        assert_eq!(navigation(&url("http://localhost:3000/index.html"), port), Nav::Allow);
        // Not a preview: the engine under another name, TLS, other loopback names, no port, credentials.
        assert_eq!(navigation(&url("http://localhost:4190/app"), port), Nav::External);
        assert_eq!(navigation(&url("https://127.0.0.1:5173/"), port), Nav::External);
        assert_eq!(navigation(&url("http://127.0.0.2:5173/"), port), Nav::External);
        assert_eq!(navigation(&url("http://[::1]:5173/"), port), Nav::External);
        assert_eq!(navigation(&url("http://127.0.0.1/"), port), Nav::External);
        assert_eq!(navigation(&url("http://u:p@127.0.0.1:5173/"), port), Nav::External);
        assert_eq!(navigation(&url("https://mengai.example/app"), port), Nav::External);
        assert_eq!(navigation(&url("mailto:hi@mengai.example"), port), Nav::External);
        assert_eq!(navigation(&url("file:///etc/passwd"), port), Nav::Deny);
        assert_eq!(navigation(&url("about:blank"), port), Nav::Deny);
    }

    #[test]
    fn a_preview_that_takes_over_the_window_is_bounced() {
        let port = 4190;
        assert!(!must_bounce(&url("http://127.0.0.1:4190/app/projects/p1"), port));
        assert!(must_bounce(&url("http://127.0.0.1:5173/"), port));
        assert!(must_bounce(&url("http://localhost:4190/app"), port));
    }

    #[test]
    fn app_url_matches_the_contract() {
        assert_eq!(app_url(4190), "http://127.0.0.1:4190/app");
        assert!(is_sidecar_url(&url(&app_url(4312)), 4312));
    }
}
