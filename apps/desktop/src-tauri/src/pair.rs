//! Browser pairing link from the sidecar ready line (`pairUrl`).
//!
//! Tray and app menu item "Open in browser" hands it to the default browser.
//! The link carries a one-time pairing token that the page exchanges at
//! POST /api/auth/pair for a full session on this runtime, so it is checked
//! before it is ever opened (JEV sec.shell_hardening pair_url_check 0.9):
//! https (http only on loopback), no credentials, a `pair=<token>` fragment
//! with a URL-safe token, and, when settings.json names a site, exactly that
//! origin. Anything else is refused with a dialog, never opened and never
//! silently skipped. The in-app window does not depend on this link.
use tauri::Url;

use crate::settings;
use crate::sidecar::token_ok;

/// Owner-facing reason when the engine sends no link at all.
pub const MISSING: &str =
    "This MengAI engine did not send a browser pairing link, so MengAI cannot open it in your browser. The MengAI window keeps working.";

/// The token after `pair=` in `raw`, when it looks like one; used to mask it in the log before anything is parsed.
pub fn token_in(raw: &str) -> Option<&str> {
    let (_, after) = raw.split_once("pair=")?;
    let end = after.find(['&', '#', '?', ' ']).unwrap_or(after.len());
    let token = &after[..end];
    (!token.is_empty()).then_some(token)
}

/// Validated, normalized link to open. `site` is the settings.json origin when the owner set one.
pub fn check(raw: Option<&str>, site: Option<&str>) -> Result<String, String> {
    let raw = raw.ok_or_else(|| MISSING.to_string())?;
    let refuse = |why: &str| format!("MengAI refused the browser pairing link from its engine: it {why}.");
    if raw.len() > 4096 {
        return Err(refuse("is too long"));
    }
    let url = Url::parse(raw).map_err(|_| refuse("is not a valid URL"))?;
    settings::check_web_url(&url).map_err(|e| refuse(&e))?;
    let fragment = url.fragment().ok_or_else(|| refuse("has no #pair= token"))?;
    let token =
        fragment.split('&').find_map(|kv| kv.strip_prefix("pair=")).ok_or_else(|| refuse("has no #pair= token"))?;
    if !token_ok(token) {
        return Err(refuse("carries a malformed pairing token"));
    }
    let origin = url.origin().ascii_serialization();
    if let Some(site) = site {
        if origin != site {
            return Err(refuse(&format!("points at {origin}, but settings.json names {site}")));
        }
    }
    Ok(url.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOK: &str = "pair_0123456789abcdefXYZ";

    #[test]
    fn accepts_the_contract_link() {
        let raw = format!("https://mengai.example/app#pair={TOK}");
        assert_eq!(check(Some(&raw), None).unwrap(), raw);
        assert_eq!(check(Some(&raw), Some("https://mengai.example")).unwrap(), raw);
        let extra = format!("https://mengai.example/app#pair={TOK}&runtime=http%3A%2F%2F127.0.0.1%3A4190");
        assert!(check(Some(&extra), Some("https://mengai.example")).is_ok());
        let local = format!("http://127.0.0.1:4190/app#pair={TOK}");
        assert!(check(Some(&local), None).is_ok());
    }

    #[test]
    fn refuses_anything_else_with_a_reason() {
        assert_eq!(check(None, None).unwrap_err(), MISSING);
        let other = format!("https://evil.example/app#pair={TOK}");
        assert!(check(Some(&other), Some("https://mengai.example"))
            .unwrap_err()
            .contains("settings.json names https://mengai.example"));
        for bad in [
            format!("http://mengai.example/app#pair={TOK}"),
            format!("https://user:pw@mengai.example/app#pair={TOK}"),
            format!("file:///tmp/app#pair={TOK}"),
            format!("javascript:alert(1)//#pair={TOK}"),
            "https://mengai.example/app".to_string(),
            "https://mengai.example/app#pair=short".to_string(),
            format!("https://mengai.example/app#pair={TOK}<script>"),
            format!("https://mengai.example/app#launch={TOK}"),
            "not a url".to_string(),
        ] {
            assert!(check(Some(&bad), None).is_err(), "{bad} must be refused");
        }
    }

    #[test]
    fn finds_the_token_to_mask() {
        assert_eq!(token_in(&format!("https://s.example/app#pair={TOK}&x=1")), Some(TOK));
        assert_eq!(token_in(&format!("Pair: https://s.example/app#pair={TOK} now")), Some(TOK));
        assert_eq!(token_in("https://s.example/app"), None);
        assert_eq!(token_in("https://s.example/app#pair="), None);
    }
}
