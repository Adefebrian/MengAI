//! Append-only app log at ~/Library/Logs/id.mengai.app/mengai.log.
//!
//! Sidecar stdout and stderr land here line by line. Every line is scrubbed:
//! control characters removed, length capped, the per-launch tokens and
//! common API key shapes replaced with [redacted]. One rotation (.1) at 5 MB.
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BYTES: u64 = 5 * 1024 * 1024;
pub const MAX_LINE: usize = 8 * 1024;
const REDACTED: &str = "[redacted]";
/// Prefixes of well-known provider key formats; the token after them is masked.
const KEY_PREFIXES: &[&str] =
    &["sk-", "sk_", "AIza", "ghp_", "gho_", "github_pat_", "xoxb-", "xoxp-", "hf_", "r8_", "fal_", "Bearer "];
const MIN_SECRET_LEN: usize = 16;

pub struct AppLog {
    path: Option<PathBuf>,
    file: Mutex<Option<File>>,
    secrets: RwLock<Vec<String>>,
}

impl AppLog {
    /// Opens (or creates) the log file. A missing log dir only disables the file sink; stderr still gets every line.
    pub fn open(dir: Option<PathBuf>) -> Self {
        let path = dir.and_then(|d| fs::create_dir_all(&d).ok().map(|_| d.join("mengai.log")));
        let file = path.as_ref().and_then(|p| open_append(p.as_path()));
        Self { path, file: Mutex::new(file), secrets: RwLock::new(Vec::new()) }
    }

    /// Registers an exact value that must never be written (launch and control tokens).
    pub fn add_secret(&self, value: &str) {
        if value.len() >= 8 {
            if let Ok(mut s) = self.secrets.write() {
                s.push(value.to_owned());
            }
        }
    }

    pub fn info(&self, source: &str, msg: &str) {
        self.write("info", source, msg);
    }

    pub fn warn(&self, source: &str, msg: &str) {
        self.write("warn", source, msg);
    }

    pub fn error(&self, source: &str, msg: &str) {
        self.write("error", source, msg);
    }

    fn write(&self, level: &str, source: &str, msg: &str) {
        let secrets = self.secrets.read().map(|s| s.clone()).unwrap_or_default();
        let line = format_line(now_ms(), level, source, &redact(msg, &secrets));
        eprint!("{line}");
        let Ok(mut guard) = self.file.lock() else { return };
        if let (Some(path), Some(file)) = (&self.path, guard.as_ref()) {
            if file.metadata().map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
                let _ = fs::rename(path, path.with_extension("log.1"));
                *guard = open_append(path);
            }
        }
        if let Some(file) = guard.as_mut() {
            let _ = file.write_all(line.as_bytes());
        }
    }
}

fn open_append(path: &Path) -> Option<File> {
    let mut opts = OpenOptions::new();
    opts.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path).ok()
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// `<epoch ms> <level> <source> <message>\n`, message stripped of control characters and capped.
pub fn format_line(ts_ms: u128, level: &str, source: &str, msg: &str) -> String {
    let mut clean: String = msg.chars().map(|c| if c == '\t' { ' ' } else { c }).filter(|c| !c.is_control()).collect();
    if clean.len() > MAX_LINE {
        let mut cut = MAX_LINE;
        while !clean.is_char_boundary(cut) {
            cut -= 1;
        }
        clean.truncate(cut);
        clean.push_str(" [truncated]");
    }
    format!("{ts_ms} {level} {source} {clean}\n")
}

/// Masks exact known secrets, then any token that follows a known key prefix.
pub fn redact(msg: &str, secrets: &[String]) -> String {
    let mut out = msg.to_owned();
    for s in secrets {
        if !s.is_empty() {
            out = out.replace(s.as_str(), REDACTED);
        }
    }
    for prefix in KEY_PREFIXES {
        let mut result = String::with_capacity(out.len());
        let mut rest = out.as_str();
        while let Some(i) = rest.find(prefix) {
            let after = &rest[i + prefix.len()..];
            let len = after
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'))
                .unwrap_or(after.len());
            result.push_str(&rest[..i + prefix.len()]);
            if len >= MIN_SECRET_LEN {
                result.push_str(REDACTED);
            } else {
                result.push_str(&after[..len]);
            }
            rest = &after[len..];
        }
        result.push_str(rest);
        out = result;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_known_tokens_and_key_shapes() {
        let secrets = vec!["launch-token-abcdef123".to_owned()];
        let out = redact("t=launch-token-abcdef123 key sk-proj-ABCDEFGHIJKLMNOPQRST short sk-abc", &secrets);
        assert_eq!(out, "t=[redacted] key sk-[redacted] short sk-abc");
        assert_eq!(redact("Authorization: Bearer abcdefghijklmnopqrstuvwxyz", &[]), "Authorization: Bearer [redacted]");
    }

    #[test]
    fn format_strips_control_and_caps_length() {
        let line = format_line(1, "info", "sidecar", "a\u{1b}[31mb\tc\r");
        assert_eq!(line, "1 info sidecar a[31mb c\n");
        let long = "x".repeat(MAX_LINE + 50);
        let capped = format_line(1, "info", "s", &long);
        assert!(capped.ends_with(" [truncated]\n"));
        assert!(capped.len() < MAX_LINE + 64);
    }
}
