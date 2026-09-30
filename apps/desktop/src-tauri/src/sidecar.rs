// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! The Bun API sidecar: spawn, ready handshake, output draining, shutdown.
//!
//! Contract (docs/architecture.md section 17): env MENGAI_MODE=local,
//! MENGAI_DATA_DIR, MENGAI_WEB_DIR, MENGAI_HANDS_BIN, MENGAI_MIGRATIONS_DIR
//! (the bundled folder holding sqlite/*.sql; the sidecar embeds the same SQL
//! and uses this folder as an explicit override), MENGAI_PORT and, when the
//! owner listed any in settings.json, MENGAI_SITE_ORIGINS (comma list of
//! exact https origins); exactly one stdout line
//! `{"event":"ready","port":n,"controlToken":..}` (`controlToken` optional
//! now that local mode has no auth; other fields are ignored); exits on
//! SIGTERM or stdin close, stopping its children (live previews included).
//! The shell sends SIGTERM on quit, force stops after 3 s, and then sweeps
//! any descendant that outlived it (procs.rs).
use std::ffi::{OsStr, OsString};
use std::io::{self, BufRead, BufReader, Read};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::applog::{AppLog, MAX_LINE};
use crate::procs::{self, Proc};
use crate::settings::Settings;
use crate::signals;

pub const READY_TIMEOUT: Duration = Duration::from_secs(30);
pub const TERM_GRACE: Duration = Duration::from_secs(3);

/// Parent env vars the sidecar may see. Everything else (cloud credentials,
/// tokens exported in a dev terminal) is dropped. JEV sec.shell_hardening allowlist 1.0.
const ENV_ALLOWLIST: &[&str] = &["HOME", "USER", "LOGNAME", "TMPDIR", "PATH", "LANG", "SHELL", "TZ"];
/// Set by the shell only; a value exported in the parent env is dropped.
const ENV_OWNED: &[&str] = &[
    "MENGAI_MODE",
    "MENGAI_DATA_DIR",
    "MENGAI_WEB_DIR",
    "MENGAI_HANDS_BIN",
    "MENGAI_MIGRATIONS_DIR",
    "MENGAI_PORT",
    "MENGAI_SITE_ORIGINS",
];
/// Never passed through from the parent env: the old single site origin (the site list is
/// settings.json only), a loopback UI dev origin (the window is the UI, and a loopback origin
/// would let a crew preview on that port drive the engine), and the dev flag that keeps the
/// engine serving after stdin closes (the shell relies on stdin close as its exit signal).
const ENV_DROPPED: &[&str] = &["MENGAI_SITE_URL", "MENGAI_UI_ORIGIN", "MENGAI_DEV_OPEN"];

pub struct Paths {
    pub data_dir: PathBuf,
    pub web_dir: PathBuf,
    pub hands_bin: PathBuf,
    /// Holds `sqlite/*.sql`; passed as MENGAI_MIGRATIONS_DIR.
    pub migrations_dir: PathBuf,
}

/// What the ready line hands the shell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ready {
    pub port: u16,
    /// Kill switch credential when the engine still issues one; the header is skipped without it
    /// and a refused kill switch fails closed (JEV sec.shell_hardening missing_control_token 0.9).
    pub control_token: Option<String>,
}

/// Loose on purpose: a ready line with a wrong type is a broken ready line (fatal), never an
/// unrecognized line that would be logged verbatim and time out.
#[derive(Deserialize)]
struct RawLine {
    event: Option<serde_json::Value>,
    port: Option<serde_json::Value>,
    #[serde(rename = "controlToken")]
    control_token: Option<serde_json::Value>,
}

/// None: not the ready line (log it). Some(Err): a ready line that breaks the contract (fatal).
pub fn parse_ready(line: &str) -> Option<Result<Ready, String>> {
    let trimmed = line.trim();
    if !trimmed.starts_with('{') {
        return None;
    }
    let raw: RawLine = serde_json::from_str(trimmed).ok()?;
    if raw.event.as_ref().and_then(|v| v.as_str()) != Some("ready") {
        return None;
    }
    let port = match raw.port.as_ref().and_then(|v| v.as_u64()) {
        Some(p) if (1..=u16::MAX as u64).contains(&p) => p as u16,
        _ => return Some(Err("ready line has no valid port".into())),
    };
    let control_token = match raw.control_token {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(t)) if token_ok(&t) => Some(t),
        Some(_) => return Some(Err("ready line has a malformed controlToken".into())),
    };
    Some(Ok(Ready { port, control_token }))
}

/// The control token goes into an HTTP header: URL-safe characters only.
pub fn token_ok(t: &str) -> bool {
    (16..=512).contains(&t.len())
        && t.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~'))
}

/// Env for the sidecar: allowlisted parent vars, LC_*, MENGAI_* passthrough (e.g. MENGAI_DEMO), then the owned vars.
pub fn build_env<I, K, V>(parent: I, paths: &Paths, settings: &Settings) -> Vec<(OsString, OsString)>
where
    I: IntoIterator<Item = (K, V)>,
    K: AsRef<OsStr>,
    V: AsRef<OsStr>,
{
    let mut env: Vec<(OsString, OsString)> = parent
        .into_iter()
        .filter(|(k, _)| {
            let Some(k) = k.as_ref().to_str() else { return false };
            ENV_ALLOWLIST.contains(&k)
                || k.starts_with("LC_")
                || (k.starts_with("MENGAI_") && !ENV_OWNED.contains(&k) && !ENV_DROPPED.contains(&k))
        })
        .map(|(k, v)| (k.as_ref().to_owned(), v.as_ref().to_owned()))
        .collect();
    env.push(("MENGAI_MODE".into(), "local".into()));
    env.push(("MENGAI_DATA_DIR".into(), paths.data_dir.clone().into_os_string()));
    env.push(("MENGAI_WEB_DIR".into(), paths.web_dir.clone().into_os_string()));
    env.push(("MENGAI_HANDS_BIN".into(), paths.hands_bin.clone().into_os_string()));
    env.push(("MENGAI_MIGRATIONS_DIR".into(), paths.migrations_dir.clone().into_os_string()));
    env.push(("MENGAI_PORT".into(), settings.port.to_string().into()));
    if !settings.site_origins.is_empty() {
        env.push(("MENGAI_SITE_ORIGINS".into(), settings.site_origins.join(",").into()));
    }
    env
}

/// True when nothing answers on 127.0.0.1:<port> and it can be bound. Checked before the
/// spawn so a busy port is a clear dialog instead of an engine that exits before ready.
pub fn port_available(port: u16) -> bool {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    if TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
        return false;
    }
    TcpListener::bind(addr).is_ok()
}

/// Reads one line capped at `max` bytes (the rest of an oversized line is discarded).
/// Ok(None) at EOF, Ok(Some(truncated)) otherwise.
pub fn read_line_bounded<R: BufRead>(reader: &mut R, max: usize, out: &mut Vec<u8>) -> io::Result<Option<bool>> {
    out.clear();
    let mut truncated = false;
    let mut read_any = false;
    loop {
        let available = match reader.fill_buf() {
            Ok(b) => b,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        if available.is_empty() {
            return Ok(read_any.then_some(truncated));
        }
        read_any = true;
        let newline = available.iter().position(|&b| b == b'\n');
        let chunk = &available[..newline.unwrap_or(available.len())];
        let room = max.saturating_sub(out.len());
        if chunk.len() > room {
            truncated = true;
        }
        out.extend_from_slice(&chunk[..chunk.len().min(room)]);
        let used = newline.map(|i| i + 1).unwrap_or(available.len());
        reader.consume(used);
        if newline.is_some() {
            if out.last() == Some(&b'\r') {
                out.pop();
            }
            return Ok(Some(truncated));
        }
    }
}

/// Messages from the sidecar threads to the supervisor.
pub enum Event {
    Ready(Ready),
    Broken(String),
    Exited(Option<i32>),
}

struct ExitSignal {
    status: Mutex<Option<ExitStatus>>,
    cv: Condvar,
}

pub struct Sidecar {
    pub pid: u32,
    stdin: Mutex<Option<ChildStdin>>,
    exit: Arc<ExitSignal>,
    ready: OnceLock<(u16, Option<String>)>,
    stop_done: Mutex<bool>,
}

impl Sidecar {
    /// Spawns the sidecar in its own process group with piped stdio and starts the drain and monitor threads.
    pub fn spawn(
        mut cmd: Command,
        paths: &Paths,
        settings: &Settings,
        log: Arc<AppLog>,
        events: Sender<Event>,
    ) -> io::Result<Arc<Self>> {
        use std::os::unix::process::CommandExt;
        cmd.env_clear()
            .envs(build_env(std::env::vars_os(), paths, settings))
            .current_dir(&paths.data_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0);
        let mut child: Child = cmd.spawn()?;
        let pid = child.id();
        let stdout = child.stdout.take().ok_or_else(|| io::Error::other("sidecar stdout not piped"))?;
        let stderr = child.stderr.take().ok_or_else(|| io::Error::other("sidecar stderr not piped"))?;
        let stdin = child.stdin.take();

        let exit = Arc::new(ExitSignal { status: Mutex::new(None), cv: Condvar::new() });
        let sidecar = Arc::new(Self {
            pid,
            stdin: Mutex::new(stdin),
            exit: exit.clone(),
            ready: OnceLock::new(),
            stop_done: Mutex::new(false),
        });

        let out_log = log.clone();
        let out_events = events.clone();
        thread::Builder::new()
            .name("sidecar-stdout".into())
            .spawn(move || drain_stdout(stdout, out_log, out_events))?;
        let err_log = log.clone();
        thread::Builder::new().name("sidecar-stderr".into()).spawn(move || drain(stderr, err_log, "sidecar.stderr"))?;
        thread::Builder::new().name("sidecar-monitor".into()).spawn(move || {
            let status = child.wait();
            let code = status.as_ref().ok().and_then(|s| s.code());
            match &status {
                Ok(s) => log.info("sidecar", &format!("exited: {s}")),
                Err(e) => log.error("sidecar", &format!("wait failed: {e}")),
            }
            if let Ok(mut slot) = exit.status.lock() {
                *slot = status.ok();
                exit.cv.notify_all();
            }
            let _ = events.send(Event::Exited(code));
        })?;
        Ok(sidecar)
    }

    pub fn set_ready(&self, ready: &Ready) {
        let _ = self.ready.set((ready.port, ready.control_token.clone()));
    }

    /// (port, control token) once the ready line has been accepted.
    pub fn control(&self) -> Option<(u16, Option<String>)> {
        self.ready.get().cloned()
    }

    pub fn has_exited(&self) -> bool {
        self.exit.status.lock().map(|s| s.is_some()).unwrap_or(true)
    }

    fn wait_exit(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let Ok(mut guard) = self.exit.status.lock() else { return false };
        while guard.is_none() {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            match self.exit.cv.wait_timeout(guard, deadline - now) {
                Ok((g, _)) => guard = g,
                Err(_) => return false,
            }
        }
        true
    }

    /// Graceful: SIGTERM (the engine stops its previews and other children), wait up to 3 s,
    /// then SIGKILL the process group (stragglers such as the hands helper).
    /// Forced: SIGKILL the group now. Either way, descendants that live in their own process
    /// groups and outlived the engine are killed last. Idempotent; a second caller waits for the first.
    pub fn stop(&self, force: bool, log: &AppLog) {
        let Ok(mut done) = self.stop_done.lock() else { return };
        if *done {
            return;
        }
        let mut tracked = self.descendants(log);
        if !force && !self.has_exited() {
            if let Err(e) = signals::terminate(self.pid) {
                log.warn("sidecar", &format!("SIGTERM failed: {e}"));
            }
            if !self.wait_exit(TERM_GRACE) {
                log.warn("sidecar", "did not exit within 3 s of SIGTERM, killing its process group");
                // Children started during the grace period are only visible while the engine lives.
                for p in self.descendants(log) {
                    if !tracked.contains(&p) {
                        tracked.push(p);
                    }
                }
            }
        }
        if let Err(e) = signals::kill_group(self.pid) {
            log.warn("sidecar", &format!("process group kill failed: {e}"));
        }
        self.wait_exit(Duration::from_secs(1));
        // A child forked while the first SIGKILL was in flight escapes it; sweep the group once more.
        if let Err(e) = signals::kill_group(self.pid) {
            log.warn("sidecar", &format!("second process group kill failed: {e}"));
        }
        self.sweep(&tracked, log);
        // Closing stdin is the sidecar's second exit signal; drop it last.
        if let Ok(mut stdin) = self.stdin.lock() {
            stdin.take();
        }
        *done = true;
    }
}

impl Sidecar {
    /// The engine's descendants right now; empty (and logged) when ps is unavailable or the engine is gone.
    fn descendants(&self, log: &AppLog) -> Vec<Proc> {
        if self.has_exited() {
            return Vec::new();
        }
        match procs::snapshot() {
            Ok(table) => procs::descendants(&table, self.pid),
            Err(e) => {
                log.warn(
                    "sidecar",
                    &format!("could not list the engine's processes ({e}); detached previews may outlive it"),
                );
                Vec::new()
            }
        }
    }

    /// SIGKILLs every tracked descendant still alive (same pid and start time) and the groups they lead.
    fn sweep(&self, tracked: &[Proc], log: &AppLog) {
        if tracked.is_empty() {
            return;
        }
        let now = match procs::snapshot() {
            Ok(table) => table,
            Err(e) => {
                log.error("sidecar", &format!("could not check for processes that outlived the engine ({e})"));
                return;
            }
        };
        let survivors = procs::still_alive(tracked, &now);
        if survivors.is_empty() {
            return;
        }
        let me = std::process::id();
        let my_group = now.iter().find(|p| p.pid == me).map(|p| p.pgid);
        let (groups, pids) = procs::kill_plan(&survivors, me, my_group, self.pid);
        for pgid in &groups {
            if let Err(e) = signals::kill_group(*pgid) {
                log.warn("sidecar", &format!("could not kill leftover process group {pgid}: {e}"));
            }
        }
        for pid in &pids {
            if let Err(e) = signals::kill_pid(*pid) {
                log.warn("sidecar", &format!("could not kill leftover process {pid}: {e}"));
            }
        }
        log.warn(
            "sidecar",
            &format!("killed {} process(es) in {} group(s) that outlived the engine", pids.len(), groups.len()),
        );
    }
}

fn drain_stdout<R: Read>(stdout: R, log: Arc<AppLog>, events: Sender<Event>) {
    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::with_capacity(1024);
    let mut handshake_done = false;
    loop {
        match read_line_bounded(&mut reader, MAX_LINE, &mut buf) {
            Ok(None) => break,
            Ok(Some(_)) => {
                let line = String::from_utf8_lossy(&buf);
                if !handshake_done {
                    match parse_ready(&line) {
                        Some(Ok(ready)) => {
                            handshake_done = true;
                            // The token is registered before any later line can be logged.
                            if let Some(token) = &ready.control_token {
                                log.add_secret(token);
                            }
                            log.info("sidecar", &format!("ready on 127.0.0.1:{}", ready.port));
                            let _ = events.send(Event::Ready(ready));
                            continue;
                        }
                        Some(Err(reason)) => {
                            handshake_done = true;
                            log.error("sidecar", &format!("broken ready line: {reason}"));
                            let _ = events.send(Event::Broken(reason));
                            continue;
                        }
                        None => {}
                    }
                }
                log.info("sidecar.stdout", &line);
            }
            Err(e) => {
                log.warn("sidecar", &format!("stdout read failed: {e}"));
                break;
            }
        }
    }
}

fn drain<R: Read>(stream: R, log: Arc<AppLog>, source: &'static str) {
    let mut reader = BufReader::new(stream);
    let mut buf = Vec::with_capacity(1024);
    while let Ok(Some(_)) = read_line_bounded(&mut reader, MAX_LINE, &mut buf) {
        log.info(source, &String::from_utf8_lossy(&buf));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const CT: &str = "control_0123456789abcdef";

    #[test]
    fn parses_the_contract_ready_line() {
        let line = format!("{{\"event\":\"ready\",\"port\":4190,\"controlToken\":\"{CT}\"}}");
        assert_eq!(parse_ready(&line).unwrap().unwrap(), Ready { port: 4190, control_token: Some(CT.into()) });
        // No auth in local mode: the token may be absent or null, and old fields are ignored.
        for line in [
            "{\"event\":\"ready\",\"port\":4190}".to_string(),
            "{\"event\":\"ready\",\"port\":4190,\"controlToken\":null}".to_string(),
            "{\"event\":\"ready\",\"port\":4190,\"launchToken\":\"x\",\"pairUrl\":5}".to_string(),
        ] {
            assert_eq!(parse_ready(&line).unwrap().unwrap(), Ready { port: 4190, control_token: None }, "{line}");
        }
    }

    #[test]
    fn ignores_other_lines_and_rejects_broken_ready() {
        assert!(parse_ready("listening soon").is_none());
        assert!(parse_ready("{\"level\":\"info\",\"msg\":\"boot\"}").is_none());
        assert!(parse_ready("{\"event\":5}").is_none());
        assert!(parse_ready("{not json").is_none());
        for bad in [
            format!("{{\"event\":\"ready\",\"port\":70000,\"controlToken\":\"{CT}\"}}"),
            format!("{{\"event\":\"ready\",\"port\":\"4190\",\"controlToken\":\"{CT}\"}}"),
            format!("{{\"event\":\"ready\",\"controlToken\":\"{CT}\"}}"),
            format!("{{\"event\":\"ready\",\"port\":1,\"controlToken\":\"{CT}&x=<y>\"}}"),
            format!("{{\"event\":\"ready\",\"port\":1,\"controlToken\":\"{CT}\\r\\nx: y\"}}"),
            "{\"event\":\"ready\",\"port\":1,\"controlToken\":\"short\"}".to_string(),
            "{\"event\":\"ready\",\"port\":1,\"controlToken\":12345678901234567890}".to_string(),
        ] {
            assert!(parse_ready(&bad).unwrap().is_err(), "{bad} must be a broken ready line");
        }
    }

    fn test_paths() -> Paths {
        Paths { data_dir: "/d".into(), web_dir: "/w".into(), hands_bin: "/h".into(), migrations_dir: "/m".into() }
    }

    #[test]
    fn env_is_allowlisted_and_owned_vars_win() {
        let paths = test_paths();
        let settings = Settings {
            site_origins: vec!["https://site.example".into(), "https://app.example:8443".into()],
            port: 4190,
        };
        let parent = vec![
            ("HOME", "/Users/x"),
            ("PATH", "/usr/bin"),
            ("LC_ALL", "en_US.UTF-8"),
            ("AWS_SECRET_ACCESS_KEY", "nope"),
            ("OPENAI_API_KEY", "nope"),
            ("ALLOWED_ORIGINS", "http://127.0.0.1:5000"),
            ("MENGAI_PORT", "4312"),
            ("MENGAI_SITE_ORIGINS", "https://evil.example"),
            ("MENGAI_SITE_URL", "https://evil.example"),
            ("MENGAI_UI_ORIGIN", "http://127.0.0.1:5173"),
            ("MENGAI_DEV_OPEN", "1"),
            ("MENGAI_DEMO", "1"),
            ("MENGAI_DATA_DIR", "/evil"),
            ("MENGAI_MIGRATIONS_DIR", "/evil-sql"),
        ];
        let env = build_env(parent, &paths, &settings);
        let get = |k: &str| env.iter().rev().find(|(ek, _)| ek == k).map(|(_, v)| v.to_string_lossy().into_owned());
        assert_eq!(get("HOME").as_deref(), Some("/Users/x"));
        assert_eq!(get("LC_ALL").as_deref(), Some("en_US.UTF-8"));
        assert_eq!(get("MENGAI_PORT").as_deref(), Some("4190"));
        assert_eq!(get("MENGAI_SITE_ORIGINS").as_deref(), Some("https://site.example,https://app.example:8443"));
        assert_eq!(get("MENGAI_DEMO").as_deref(), Some("1"));
        assert_eq!(get("MENGAI_MODE").as_deref(), Some("local"));
        assert_eq!(get("MENGAI_DATA_DIR").as_deref(), Some("/d"));
        assert_eq!(get("MENGAI_WEB_DIR").as_deref(), Some("/w"));
        assert_eq!(get("MENGAI_HANDS_BIN").as_deref(), Some("/h"));
        assert_eq!(get("MENGAI_MIGRATIONS_DIR").as_deref(), Some("/m"));
        for dropped in ENV_DROPPED.iter().chain(&["AWS_SECRET_ACCESS_KEY", "OPENAI_API_KEY", "ALLOWED_ORIGINS"]) {
            assert!(get(dropped).is_none(), "{dropped} must not reach the sidecar");
        }
        for owned in ENV_OWNED {
            assert_eq!(env.iter().filter(|(k, _)| k == owned).count(), 1, "{owned} set exactly once");
        }
    }

    #[test]
    fn unset_site_origins_are_not_inherited() {
        let parent = vec![("MENGAI_SITE_ORIGINS", "https://evil.example"), ("MENGAI_SITE_URL", "https://evil.example")];
        let env = build_env(parent, &test_paths(), &Settings::default());
        assert!(env.iter().all(|(k, _)| k != "MENGAI_SITE_ORIGINS" && k != "MENGAI_SITE_URL"));
        assert!(env.iter().any(|(k, v)| k == "MENGAI_PORT" && v == "4190"));
    }

    #[test]
    fn busy_port_is_detected() {
        let held = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = held.local_addr().unwrap().port();
        assert!(!port_available(port));
        drop(held);
        assert!(port_available(port));
    }

    #[test]
    fn bounded_reader_caps_and_splits() {
        let mut r = Cursor::new(b"one\r\ntwo-is-long\nthree".to_vec());
        let mut buf = Vec::new();
        assert_eq!(read_line_bounded(&mut r, 64, &mut buf).unwrap(), Some(false));
        assert_eq!(buf, b"one");
        assert_eq!(read_line_bounded(&mut r, 3, &mut buf).unwrap(), Some(true));
        assert_eq!(buf, b"two");
        assert_eq!(read_line_bounded(&mut r, 64, &mut buf).unwrap(), Some(false));
        assert_eq!(buf, b"three");
        assert_eq!(read_line_bounded(&mut r, 64, &mut buf).unwrap(), None);
    }

    fn fake_sidecar(name: &str, script: &str) -> (Arc<Sidecar>, std::sync::mpsc::Receiver<Event>, Arc<AppLog>) {
        let dir = std::env::temp_dir().join(format!("mengai-desktop-test-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let paths = Paths {
            data_dir: dir.clone(),
            web_dir: dir.join("web"),
            hands_bin: dir.join("hands"),
            migrations_dir: dir.join("migrations"),
        };
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c").arg(script);
        let log = Arc::new(AppLog::open(None));
        let (tx, rx) = std::sync::mpsc::channel();
        let sc = Sidecar::spawn(cmd, &paths, &Settings::default(), log.clone(), tx).expect("spawn fake sidecar");
        (sc, rx, log)
    }

    fn ready_line(port: u16) -> String {
        format!("{{\"event\":\"ready\",\"port\":{port},\"controlToken\":\"{CT}\"}}")
    }

    /// Polls for up to 2 s until `probe` (a signal-0 check) reports ESRCH.
    fn gone(what: &str, probe: impl Fn() -> libc::c_int) -> bool {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if probe() == -1 && io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
                return true;
            }
            if Instant::now() >= deadline {
                eprintln!("{what} still exists 2 s after stop()");
                return false;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn pgid_of(pid: u32) -> Option<u32> {
        procs::snapshot().unwrap().into_iter().find(|p| p.pid == pid).map(|p| p.pgid)
    }

    #[test]
    fn handshake_then_graceful_stop() {
        let script =
            format!("trap 'exit 0' TERM; echo boot; echo '{}'; while true; do sleep 0.05; done", ready_line(40001));
        let (sc, rx, log) = fake_sidecar("graceful", &script);
        let ready = match rx.recv_timeout(Duration::from_secs(5)).expect("event") {
            Event::Ready(r) => r,
            _ => panic!("expected ready"),
        };
        assert_eq!(ready.port, 40001);
        sc.set_ready(&ready);
        assert_eq!(sc.control(), Some((40001, Some(CT.to_string()))));
        let started = Instant::now();
        sc.stop(false, &log);
        assert!(sc.has_exited());
        assert!(started.elapsed() < TERM_GRACE + Duration::from_secs(2));
        sc.stop(false, &log); // idempotent
    }

    #[test]
    fn stubborn_sidecar_is_killed_with_its_group() {
        let script = format!("trap '' TERM; sleep 30 & echo '{}'; while true; do sleep 0.05; done", ready_line(40002));
        let (sc, rx, log) = fake_sidecar("stubborn", &script);
        wait_ready(&rx);
        let started = Instant::now();
        sc.stop(false, &log);
        assert!(started.elapsed() >= TERM_GRACE);
        assert!(sc.has_exited());
        // SAFETY: signal 0 only probes for existence; the pgid is the child we spawned (> 1).
        assert!(gone("sidecar process group", || unsafe { libc::killpg(sc.pid as libc::pid_t, 0) }));
    }

    /// A live preview runs detached (own process group), so the group kill cannot reach it.
    fn detached_preview_script(on_term: &str) -> String {
        format!(
            "trap '{on_term}' TERM; set -m; sleep 30 & echo \"preview=$!\"; set +m; echo '{}'; while true; do sleep 0.05; done",
            ready_line(40003)
        )
    }

    fn wait_ready(rx: &std::sync::mpsc::Receiver<Event>) {
        assert!(matches!(rx.recv_timeout(Duration::from_secs(5)).expect("event"), Event::Ready(_)));
    }

    fn detached_child(sc: &Sidecar) -> u32 {
        let table = procs::snapshot().unwrap();
        let kids = procs::descendants(&table, sc.pid);
        kids.iter()
            .find(|p| p.pgid != sc.pid && p.pgid == p.pid)
            .map(|p| p.pid)
            .expect("a detached child in its own group")
    }

    #[test]
    fn detached_children_are_swept_after_a_forced_stop() {
        let (sc, rx, log) = fake_sidecar("sweep-forced", &detached_preview_script(""));
        wait_ready(&rx);
        let child = detached_child(&sc);
        assert_eq!(pgid_of(child), Some(child), "the preview leads its own group");
        sc.stop(false, &log);
        assert!(sc.has_exited());
        // SAFETY: signal 0 only probes for existence of a pid we started (> 1).
        assert!(gone("detached preview", || unsafe { libc::kill(child as libc::pid_t, 0) }));
    }

    #[test]
    fn detached_children_left_by_a_clean_exit_are_swept() {
        let (sc, rx, log) = fake_sidecar("sweep-clean", &detached_preview_script("exit 0"));
        wait_ready(&rx);
        let child = detached_child(&sc);
        let started = Instant::now();
        sc.stop(false, &log);
        assert!(started.elapsed() < TERM_GRACE, "a clean exit does not wait for the grace period");
        // SAFETY: signal 0 only probes for existence of a pid we started (> 1).
        assert!(gone("detached preview", || unsafe { libc::kill(child as libc::pid_t, 0) }));
    }

    #[test]
    fn early_exit_is_reported() {
        let (_sc, rx, _log) = fake_sidecar("early", "echo 'crash' >&2; exit 3");
        match rx.recv_timeout(Duration::from_secs(5)).expect("event") {
            Event::Exited(code) => assert_eq!(code, Some(3)),
            _ => panic!("expected exit"),
        }
    }
}
