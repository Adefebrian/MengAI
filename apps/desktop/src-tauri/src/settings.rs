// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! Owner settings for the shell: `settings.json` in the app data dir
//! (`~/Library/Application Support/id.mengai.app/settings.json`).
//!
//! ```json
//! { "siteOrigins": ["https://mengai.example"], "port": 4190 }
//! ```
//!
//! `siteOrigins` becomes MENGAI_SITE_ORIGINS (a comma list) for the sidecar:
//! the exact https origins of websites that serve the MengAI UI and may call
//! this engine. Empty keeps only the engine's own origins. `port` becomes
//! MENGAI_PORT (default 4190, the address the website UI talks to).
//!
//! A missing file means defaults and a template is written. A file that
//! exists but does not parse or validate stops startup with a dialog (JEV
//! sec.shell_hardening settings_invalid fatal 0.98): an origin in this list
//! can drive the crew on this Mac. The old `siteUrl` key is migrated into
//! `siteOrigins` and the file is rewritten; an old http loopback value is
//! dropped with a warning (JEV sec.shell_hardening legacy_loopback_site
//! drop_warn_rewrite 0.61), since loopback origins are refused here.
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::net::Ipv4Addr;
use std::path::Path;

use serde::Deserialize;
use tauri::Url;

pub const FILE_NAME: &str = "settings.json";
pub const DEFAULT_PORT: u16 = 4190;
const MIN_PORT: u64 = 1024;
const MAX_FILE: u64 = 16 * 1024;
const MAX_URL: usize = 2048;
pub const MAX_ORIGINS: usize = 16;
pub const TEMPLATE: &str = "{\n  \"siteOrigins\": [],\n  \"port\": 4190\n}\n";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    /// Normalized exact origins (`https://host[:port]`, no trailing slash), deduplicated, in file order.
    pub site_origins: Vec<String>,
    pub port: u16,
}

impl Default for Settings {
    fn default() -> Self {
        Self { site_origins: Vec::new(), port: DEFAULT_PORT }
    }
}

/// Parse result. `migration` is set when the file still used `siteUrl`; it holds what to tell the owner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parsed {
    pub settings: Settings,
    pub migration: Option<Migration>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Migration {
    /// The old value that was dropped and why, when it could not become a site origin.
    pub dropped: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Raw {
    #[serde(rename = "siteOrigins", default)]
    site_origins: Option<Vec<String>>,
    /// Legacy single origin (pairing era); migrated into siteOrigins.
    #[serde(rename = "siteUrl", default)]
    site_url: Option<String>,
    #[serde(default)]
    port: Option<u64>,
}

/// Parses and validates the file text. Err is the reason shown to the owner.
pub fn parse(text: &str) -> Result<Parsed, String> {
    let invalid = |e: serde_json::Error| format!("it is not valid settings JSON: {e}");
    let value: serde_json::Value = serde_json::from_str(text).map_err(invalid)?;
    // Present even when null or "": the rewrite then drops the old key.
    let has_legacy = value.get("siteUrl").is_some();
    let raw: Raw = serde_json::from_value(value).map_err(invalid)?;
    let legacy = raw.site_url.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let migrated = |dropped: Option<String>| Some(Migration { dropped });
    let (site_origins, migration) = match (raw.site_origins, legacy) {
        (Some(_), Some(_)) => {
            return Err("it has both \"siteOrigins\" and the old \"siteUrl\"; keep only \"siteOrigins\"".into());
        }
        (Some(list), None) => {
            if list.len() > MAX_ORIGINS {
                return Err(format!("\"siteOrigins\" lists {} origins, at most {MAX_ORIGINS} are allowed", list.len()));
            }
            let mut out: Vec<String> = Vec::with_capacity(list.len());
            for entry in &list {
                let origin = site_origin(entry.trim())?;
                if !out.contains(&origin) {
                    out.push(origin);
                }
            }
            (out, if has_legacy { migrated(None) } else { None })
        }
        (None, Some(old)) => match exact_origin(old, "the old \"siteUrl\"") {
            Ok(origin) => (vec![origin], migrated(None)),
            Err(_) if is_loopback_origin(old) => (
                Vec::new(),
                migrated(Some(format!(
                    "the old \"siteUrl\" {} was dropped: a loopback origin cannot be a site origin (the engine already allows its own UI dev origin)",
                    shown(old)
                ))),
            ),
            Err(reason) => return Err(reason),
        },
        (None, None) => (Vec::new(), if has_legacy { migrated(None) } else { None }),
    };
    let port = match raw.port {
        None => DEFAULT_PORT,
        Some(p) if (MIN_PORT..=u16::MAX as u64).contains(&p) => p as u16,
        Some(p) => return Err(format!("\"port\" is {p}, it must be between {MIN_PORT} and 65535")),
    };
    Ok(Parsed { settings: Settings { site_origins, port }, migration })
}

/// One `siteOrigins` entry: an exact https origin of a public host. No path, query,
/// fragment, credentials, wildcard or loopback host (the crew's preview apps run on loopback ports).
pub fn site_origin(s: &str) -> Result<String, String> {
    exact_origin(s, "\"siteOrigins\" entry")
}

fn exact_origin(s: &str, label: &str) -> Result<String, String> {
    let bad = |why: &str| format!("{label} {} {why}", shown(s));
    if s.len() > MAX_URL {
        return Err(bad("is too long"));
    }
    if s.contains('*') {
        return Err(bad("must not contain a wildcard"));
    }
    let url = Url::parse(s).map_err(|e| bad(&format!("is not a URL ({e})")))?;
    if url.scheme() != "https" {
        return Err(bad("must use https, like https://mengai.example"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(bad("must not carry a user name or password"));
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err(bad("must be an origin only, like https://mengai.example (no path, query or fragment)"));
    }
    let host = url.host_str().unwrap_or_default();
    if host.is_empty() {
        return Err(bad("has no host"));
    }
    if is_loopback_host(host) {
        return Err(bad("must not be a loopback host; only public website origins belong here"));
    }
    let domain_ok = host.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.');
    let ipv6 = host.starts_with('[') && host.ends_with(']');
    if !domain_ok && !ipv6 {
        return Err(bad("has an invalid host"));
    }
    Ok(url.origin().ascii_serialization())
}

/// Hosts that resolve to this Mac. The URL parser lowercases hosts and normalizes IP literals.
fn is_loopback_host(host: &str) -> bool {
    if host == "localhost" || host.ends_with(".localhost") || host == "[::1]" || host == "[::]" {
        return true;
    }
    match host.parse::<Ipv4Addr>() {
        Ok(ip) => ip.is_loopback() || ip.is_unspecified(),
        Err(_) => false,
    }
}

fn is_loopback_origin(s: &str) -> bool {
    Url::parse(s).ok().and_then(|u| u.host_str().map(is_loopback_host)).unwrap_or(false)
}

/// Owner-facing echo of a value, capped so a huge entry does not flood the dialog.
fn shown(s: &str) -> String {
    let cut: String = s.chars().take(80).collect();
    if cut.len() < s.len() {
        format!("\"{cut}...\"")
    } else {
        format!("\"{cut}\"")
    }
}

/// The file text for these settings (what a migration writes), keys in template order.
pub fn render(settings: &Settings) -> String {
    let quoted: Vec<String> =
        settings.site_origins.iter().map(|o| serde_json::to_string(o).unwrap_or_else(|_| "\"\"".into())).collect();
    let list = if quoted.is_empty() { "[]".to_string() } else { format!("[\n    {}\n  ]", quoted.join(",\n    ")) };
    format!("{{\n  \"siteOrigins\": {list},\n  \"port\": {}\n}}\n", settings.port)
}

/// Ok(None) when the file does not exist. Err covers unreadable, oversized and invalid files.
pub fn read(path: &Path) -> Result<Option<Parsed>, String> {
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

fn private_file(path: &Path, create_new: bool) -> io::Result<File> {
    let mut opts = OpenOptions::new();
    opts.write(true);
    if create_new {
        opts.create_new(true);
    } else {
        opts.create(true).truncate(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path)
}

/// Writes the default template (0600) unless a file is already there.
pub fn write_template(path: &Path) -> io::Result<()> {
    match private_file(path, true) {
        Ok(mut f) => f.write_all(TEMPLATE.as_bytes()),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(e),
    }
}

/// Replaces the file with `settings` in the current shape: 0600 temp file in the same folder, then rename.
pub fn rewrite(path: &Path, settings: &Settings) -> io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    let _ = fs::remove_file(&tmp);
    let written = private_file(&tmp, true).and_then(|mut f| {
        f.write_all(render(settings).as_bytes())?;
        f.sync_all()
    });
    match written.and_then(|()| fs::rename(&tmp, path)) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// What `load` found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Loaded {
    pub settings: Settings,
    /// The file did not exist (defaults in use; the caller writes the template).
    pub missing: bool,
    pub migration: Option<Migration>,
}

/// Settings for this launch. Err is the owner-facing reason.
pub fn load(path: &Path) -> Result<Loaded, String> {
    match read(path)? {
        Some(p) => Ok(Loaded { settings: p.settings, missing: false, migration: p.migration }),
        None => Ok(Loaded { settings: Settings::default(), missing: true, migration: None }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(text: &str) -> Settings {
        parse(text).unwrap().settings
    }

    #[test]
    fn template_parses_to_the_defaults() {
        assert_eq!(parse(TEMPLATE).unwrap(), Parsed { settings: Settings::default(), migration: None });
        assert_eq!(settings("{}"), Settings { site_origins: vec![], port: 4190 });
        assert_eq!(settings("{\"siteOrigins\":null}"), Settings::default());
        assert_eq!(render(&Settings::default()), TEMPLATE);
    }

    #[test]
    fn site_origins_are_normalized_and_deduplicated() {
        let s = settings(
            "{\"siteOrigins\":[\"https://MengAI.Example/\",\" https://app.example:8443 \",\"https://mengai.example:443\"],\"port\":5000}",
        );
        assert_eq!(
            s,
            Settings {
                site_origins: vec!["https://mengai.example".into(), "https://app.example:8443".into()],
                port: 5000
            }
        );
        assert_eq!(site_origin("https://xn--mnchen-3ya.example").unwrap(), "https://xn--mnchen-3ya.example");
        assert_eq!(site_origin("https://m\u{fc}nchen.example").unwrap(), "https://xn--mnchen-3ya.example");
        assert_eq!(site_origin("https://203.0.113.9").unwrap(), "https://203.0.113.9");
    }

    #[test]
    fn unsafe_site_origins_are_refused() {
        for bad in [
            "http://mengai.example",
            "http://localhost:5173",
            "https://localhost:8443",
            "https://app.localhost",
            "https://127.0.0.1:8443",
            "https://127.1.2.3",
            "https://0.0.0.0",
            "https://[::1]:8443",
            "https://*.mengai.example",
            "ftp://mengai.example",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "https://user:pw@mengai.example",
            "https://mengai.example/app",
            "https://mengai.example/?x=1",
            "https://mengai.example/#x",
            "mengai.example",
            "",
        ] {
            assert!(site_origin(bad).is_err(), "{bad} must be refused");
        }
        assert!(site_origin(&format!("https://{}.example", "a".repeat(MAX_URL))).is_err());
        let many: Vec<String> = (0..=MAX_ORIGINS).map(|i| format!("\"https://s{i}.example\"")).collect();
        assert!(parse(&format!("{{\"siteOrigins\":[{}]}}", many.join(","))).unwrap_err().contains("at most"));
        assert!(parse("{\"siteOrigins\":[\"https://ok.example\",\"http://bad.example\"]}").is_err());
    }

    #[test]
    fn old_site_url_is_migrated() {
        let p = parse("{\"siteUrl\":\"https://MengAI.example/\",\"port\":4191}").unwrap();
        assert_eq!(p.settings, Settings { site_origins: vec!["https://mengai.example".into()], port: 4191 });
        assert_eq!(p.migration, Some(Migration { dropped: None }));
        let p = parse("{\"siteUrl\":null,\"port\":4190}").unwrap();
        assert_eq!(p.settings, Settings::default());
        assert_eq!(p.migration, Some(Migration { dropped: None }));
        // A loopback dev origin was valid for siteUrl; it is dropped with a reason, not fatal.
        for old in ["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"] {
            let p = parse(&format!("{{\"siteUrl\":\"{old}\"}}")).unwrap();
            assert!(p.settings.site_origins.is_empty());
            assert!(p.migration.unwrap().dropped.unwrap().contains(old));
        }
        // Anything the old rules refused is still refused.
        assert!(parse("{\"siteUrl\":\"http://site.example\"}").unwrap_err().contains("siteUrl"));
        assert!(parse("{\"siteUrl\":\"https://site.example\",\"siteOrigins\":[]}").unwrap_err().contains("both"));
    }

    #[test]
    fn broken_files_are_errors_not_defaults() {
        assert!(parse("").is_err());
        assert!(parse("{\"siteOrigins\": \"https://x.example\"}").is_err());
        assert!(parse("{\"siteOrigins\": [5]}").is_err());
        assert!(parse("{\"siteUrl\": 5}").is_err());
        assert!(parse("{\"siteorigins\": []}").is_err(), "unknown keys are refused");
        assert!(parse("{\"port\": 80}").is_err());
        assert!(parse("{\"port\": 70000}").is_err());
        assert!(parse("{\"port\": \"4190\"}").is_err());
        assert!(parse("[1]").is_err());
    }

    #[test]
    fn read_write_roundtrip_and_rewrite() {
        let dir = std::env::temp_dir().join(format!("mengai-settings-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE_NAME);
        let _ = fs::remove_file(&path);
        assert_eq!(load(&path).unwrap(), Loaded { settings: Settings::default(), missing: true, migration: None });
        write_template(&path).unwrap();
        let mode = |p: &Path| {
            use std::os::unix::fs::PermissionsExt;
            fs::metadata(p).unwrap().permissions().mode() & 0o777
        };
        assert_eq!(mode(&path), 0o600);
        assert_eq!(load(&path).unwrap(), Loaded { settings: Settings::default(), missing: false, migration: None });
        fs::write(&path, "{\"siteUrl\":\"https://site.example\",\"port\":4192}").unwrap();
        write_template(&path).unwrap(); // never overwrites the owner's file
        let old = load(&path).unwrap();
        assert_eq!(old.settings.site_origins, vec!["https://site.example".to_string()]);
        assert!(old.migration.is_some());
        rewrite(&path, &old.settings).unwrap();
        assert_eq!(mode(&path), 0o600);
        assert!(!path.with_extension("json.tmp").exists());
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"siteOrigins\"") && !text.contains("siteUrl"));
        assert_eq!(load(&path).unwrap(), Loaded { settings: old.settings.clone(), missing: false, migration: None });
        fs::write(&path, "{\"siteOrigins\":[\"http://site.example\"]}").unwrap();
        assert!(load(&path).is_err());
        fs::write(&path, vec![b' '; MAX_FILE as usize + 1]).unwrap();
        assert!(load(&path).unwrap_err().contains("larger"));
        let _ = fs::remove_file(&path);
        let _ = fs::remove_dir(&dir);
    }
}
