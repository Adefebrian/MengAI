//! Main window on the sidecar origin, pinned there.
//!
//! The page is a remote origin to Tauri, so it gets exactly one IPC grant,
//! `allow-pick-folder`, scoped at runtime to http://127.0.0.1:<exact port>
//! (JEV sec.shell_hardening runtime_exact_origin 0.64). Navigation away from
//! that origin is refused; http(s) and mailto links open in the system browser.
use tauri::ipc::CapabilityBuilder;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

pub const MAIN_WINDOW: &str = "main";

pub fn origin(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

pub fn launch_url(port: u16, launch_token: &str) -> String {
    format!("{}/#launch={launch_token}", origin(port))
}

pub fn is_sidecar_url(url: &Url, port: u16) -> bool {
    url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(port)
}

pub fn is_external_link(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

fn open_external(app: &AppHandle, url: &Url, port: u16) {
    if is_external_link(url) && !is_sidecar_url(url, port) {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

pub fn open_main(app: &AppHandle, port: u16, launch_token: &str) -> tauri::Result<()> {
    app.add_capability(
        CapabilityBuilder::new("sidecar-origin")
            .remote(origin(port))
            .window(MAIN_WINDOW)
            .permission("allow-pick-folder"),
    )?;
    let url = Url::parse(&launch_url(port, launch_token)).map_err(tauri::Error::InvalidUrl)?;
    let nav_app = app.clone();
    let popup_app = app.clone();
    WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::External(url))
        .title("MengAI")
        .inner_size(1280.0, 820.0)
        .min_inner_size(960.0, 640.0)
        .center()
        .disable_drag_drop_handler()
        .on_navigation(move |url| {
            if is_sidecar_url(url, port) {
                return true;
            }
            open_external(&nav_app, url, port);
            false
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

    #[test]
    fn pins_navigation_to_the_exact_origin() {
        let port = 51234;
        assert!(is_sidecar_url(&"http://127.0.0.1:51234/app/runs/1".parse().unwrap(), port));
        assert!(!is_sidecar_url(&"http://127.0.0.1:51235/".parse().unwrap(), port));
        assert!(!is_sidecar_url(&"http://localhost:51234/".parse().unwrap(), port));
        assert!(!is_sidecar_url(&"https://127.0.0.1:51234/".parse().unwrap(), port));
        assert!(is_external_link(&"https://example.com".parse().unwrap()));
        assert!(!is_external_link(&"file:///etc/passwd".parse().unwrap()));
        assert!(!is_external_link(&"javascript:alert(1)".parse().unwrap()));
    }

    #[test]
    fn launch_url_matches_the_contract() {
        assert_eq!(launch_url(4312, "tok_abc"), "http://127.0.0.1:4312/#launch=tok_abc");
    }
}
