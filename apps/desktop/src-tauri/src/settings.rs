//! Owner settings for the shell: `settings.json` in the app data dir
//! (`~/Library/Application Support/id.mengai.app/settings.json`).
//!
//! ```json
//! { "siteUrl": "https://mengai.example", "port": 4190 }
//! ```
//!
//! `siteUrl` becomes MENGAI_SITE_URL for the sidecar, so the pairing link it
//! prints points at the owner's website; null or "" leaves it unset and the
//! engine uses its own default. `port` becomes MENGAI_PORT (default 4190, the
//! address the website app talks to after pairing).
//!
//! A missing file means defaults and a template is written. A file that
//! exists but does not parse or validate stops startup with a dialog (JEV
//! sec.shell_hardening settings_invalid fatal 0.98): a wrong site would be
//! handed a pairing token that grants full control of this runtime.
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::Path;

use serde::Deserialize;
use tauri::Url;

pub const FILE_NAME: &str = "settings.json";
pub const DEFAULT_PORT: u16 = 4190;
const MIN_PORT: u64 = 1024;
const MAX_FILE: u64 = 16 * 1024;
const MAX_URL: usize = 2048;
pub const TEMPLATE: &str = "{\n  \"siteUrl\": null,\n  \"port\": 4190\n}\n";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    /// Normalized origin (`https://host[:port]`, no trailing slash), or None for the engine default.
    pub site_url: Option<String>,
    pub port: u16,
}

impl Default for Settings {
    fn default() -> Self {
        Self { site_url: None, port: DEFAULT_PORT }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Raw {
    #[serde(rename = "siteUrl", default)]
    site_url: Option<String>,
    #[serde(default)]
    port: Option<u64>,
}

/// Parses and validates the file text. Err is the reason shown to the owner.
pub fn parse(text: &str) -> Result<Settings, String> {
    let raw: Raw = serde_json::from_str(text).map_err(|e| format!("it is not valid settings JSON: {e}"))?;
    let site_url = match raw.site_url.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(s) => Some(site_origin(s)?),
    };
    let port = match raw.port {
        None => DEFAULT_PORT,
        Some(p) if (MIN_PORT..=u16::MAX as u64).contains(&p) => p as u16,
        Some(p) => return Err(format!("\"port\" is {p}, it must be between {MIN_PORT} and 65535")),
    };
    Ok(Settings { site_url, port })
}

/// `siteUrl` must be a bare origin: https anywhere, http only on loopback (a dev web server).
pub fn site_origin(s: &str) -> Result<String, String> {
    if s.len() > MAX_URL {
        return Err("\"siteUrl\" is too long".into());
    }
    let url = Url::parse(s).map_err(|e| format!("\"siteUrl\" is not a URL ({e})"))?;
    check_web_url(&url).map_err(|e| format!("\"siteUrl\" {e}"))?;
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err(
            "\"siteUrl\" must be the site origin only, like https://mengai.example (no path, query or fragment)".into(),
        );
    }
    Ok(url.origin().ascii_serialization())
}

/// Shared by siteUrl and the pairing link: https, or http on 127.0.0.1, localhost or [::1]; no credentials.
pub fn check_web_url(url: &Url) -> Result<(), String> {
    match url.scheme() {
        "https" => {}
        "http" if is_loopback(url) => {}
        "http" => return Err("must use https (http is allowed only for 127.0.0.1, localhost or [::1])".into()),
        other => return Err(format!("must use https, not {other}")),
    }
    if url.host_str().map_or(true, str::is_empty) {
        return Err("has no host".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("must not carry a user name or password".into());
    }
    Ok(())
}

/// The URL parser lowercases hosts and normalizes IP literals, so exact matches are enough.
fn is_loopback(url: &Url) -> bool {
    matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
}

/// Ok(None) when the file does not exist. Err covers unreadable, oversized and invalid files.
pub fn read(path: &Path) -> Result<Option<Settings>, String> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("it could not be read ({e})")),
    };
    let meta = file.metadata().map_err(|e| format!("it could not be read ({e})"))?;
    if !meta.is_file() {
        return Err("it is not a regular file".into());
    }
    if meta.len() > MAX_FILE {
        return Err(format!("it is larger than {} KB", MAX_FILE / 1024));
    }
    let mut text = String::new();
    file.take(MAX_FILE).read_to_string(&mut text).map_err(|e| format!("it could not be read as UTF-8 ({e})"))?;
    parse(&text).map(Some)
}

/// Writes the default template (0600) unless a file is already there.
pub fn write_template(path: &Path) -> io::Result<()> {
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    match opts.open(path) {
        Ok(mut f) => f.write_all(TEMPLATE.as_bytes()),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(e),
    }
}

/// Settings for this launch plus whether the file was missing. Err is the owner-facing reason.
pub fn load(path: &Path) -> Result<(Settings, bool), String> {
    match read(path)? {
        Some(s) => Ok((s, false)),
        None => Ok((Settings::default(), true)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn remove(path: &Path) {
        let _ = fs::remove_file(path);
    }

    #[test]
    fn template_parses_to_the_defaults() {
        assert_eq!(parse(TEMPLATE).unwrap(), Settings::default());
        assert_eq!(parse("{}").unwrap(), Settings { site_url: None, port: 4190 });
        assert_eq!(parse("{\"siteUrl\":\"  \"}").unwrap().site_url, None);
    }

    #[test]
    fn site_url_is_normalized_to_its_origin() {
        let s = parse("{\"siteUrl\":\"https://MengAI.Example/\",\"port\":5000}").unwrap();
        assert_eq!(s, Settings { site_url: Some("https://mengai.example".into()), port: 5000 });
        assert_eq!(site_origin("https://mengai.example:8443").unwrap(), "https://mengai.example:8443");
        assert_eq!(site_origin("https://mengai.example:443").unwrap(), "https://mengai.example");
        assert_eq!(site_origin("http://localhost:5173").unwrap(), "http://localhost:5173");
        assert_eq!(site_origin("http://127.0.0.1:5173").unwrap(), "http://127.0.0.1:5173");
        assert_eq!(site_origin("http://[::1]:5173").unwrap(), "http://[::1]:5173");
    }

    #[test]
    fn unsafe_site_urls_are_refused() {
        for bad in [
            "http://mengai.example",
            "http://localhost.evil.example",
            "http://127.0.0.2",
            "ftp://mengai.example",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "https://user:pw@mengai.example",
            "https://mengai.example/app",
            "https://mengai.example/?x=1",
            "https://mengai.example/#pair=x",
            "mengai.example",
        ] {
            assert!(site_origin(bad).is_err(), "{bad} must be refused");
        }
        assert!(site_origin(&format!("https://{}.example", "a".repeat(MAX_URL))).is_err());
    }

    #[test]
    fn broken_files_are_errors_not_defaults() {
        assert!(parse("").is_err());
        assert!(parse("{\"siteUrl\": 5}").is_err());
        assert!(parse("{\"siteURL\": \"https://x.example\"}").is_err(), "unknown keys are refused");
        assert!(parse("{\"port\": 80}").is_err());
        assert!(parse("{\"port\": 70000}").is_err());
        assert!(parse("{\"port\": \"4190\"}").is_err());
        assert!(parse("[1]").is_err());
    }

    #[test]
    fn read_write_roundtrip() {
        let dir = std::env::temp_dir().join(format!("mengai-settings-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE_NAME);
        remove(&path);
        assert_eq!(load(&path).unwrap(), (Settings::default(), true));
        write_template(&path).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        assert_eq!(load(&path).unwrap(), (Settings::default(), false));
        fs::write(&path, "{\"siteUrl\":\"https://site.example\"}").unwrap();
        write_template(&path).unwrap(); // never overwrites the owner's file
        assert_eq!(load(&path).unwrap().0.site_url.as_deref(), Some("https://site.example"));
        fs::write(&path, "{\"siteUrl\":\"http://site.example\"}").unwrap();
        assert!(load(&path).is_err());
        fs::write(&path, vec![b' '; MAX_FILE as usize + 1]).unwrap();
        assert!(load(&path).unwrap_err().contains("larger"));
        remove(&path);
        let _ = fs::remove_dir(&dir);
    }
}
