//! The Bun API sidecar: spawn, ready handshake, output draining, shutdown.
//!
//! Contract (docs/architecture.md section 17): env MENGAI_MODE=local,
//! MENGAI_DATA_DIR, MENGAI_WEB_DIR, MENGAI_HANDS_BIN, MENGAI_MIGRATIONS_DIR
//! (the bundled folder holding sqlite/*.sql; the sidecar embeds the same SQL
//! and uses this folder as an explicit override), optional MENGAI_PORT;
//! exactly one stdout line `{"event":"ready","port":n,"launchToken":..,"controlToken":..}`;
//! exits on SIGTERM or stdin close. The shell sends SIGTERM on quit and kills
//! the process group after 3 s.
use std::ffi::{OsStr, OsString};
use std::io::{self, BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::applog::{AppLog, MAX_LINE};
use crate::signals;

pub const READY_TIMEOUT: Duration = Duration::from_secs(30);
pub const TERM_GRACE: Duration = Duration::from_secs(3);

/// Parent env vars the sidecar may see. Everything else (cloud credentials,
/// tokens exported in a dev terminal) is dropped. JEV sec.shell_hardening allowlist 1.0.
const ENV_ALLOWLIST: &[&str] = &["HOME", "USER", "LOGNAME", "TMPDIR", "PATH", "LANG", "SHELL", "TZ"];
const ENV_OWNED: &[&str] =
    &["MENGAI_MODE", "MENGAI_DATA_DIR", "MENGAI_WEB_DIR", "MENGAI_HANDS_BIN", "MENGAI_MIGRATIONS_DIR"];

pub struct Paths {
    pub data_dir: PathBuf,
    pub web_dir: PathBuf,
    pub hands_bin: PathBuf,
    /// Holds `sqlite/*.sql`; passed as MENGAI_MIGRATIONS_DIR.
    pub migrations_dir: PathBuf,
}

/// What the ready line hands the shell. The launch token only goes into the window URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ready {
    pub port: u16,
    pub launch_token: String,
    pub control_token: String,
}

#[derive(Deserialize)]
struct RawLine {
    event: Option<String>,
    port: Option<u64>,
    #[serde(rename = "launchToken")]
    launch_token: Option<String>,
    #[serde(rename = "controlToken")]
    control_token: Option<String>,
}

/// None: not the ready line (log it). Some(Err): a ready line that breaks the contract (fatal).
pub fn parse_ready(line: &str) -> Option<Result<Ready, String>> {
    let trimmed = line.trim();
    if !trimmed.starts_with('{') {
        return None;
    }
    let raw: RawLine = serde_json::from_str(trimmed).ok()?;
    if raw.event.as_deref() != Some("ready") {
        return None;
    }
    let port = match raw.port {
        Some(p) if (1..=u16::MAX as u64).contains(&p) => p as u16,
        _ => return Some(Err("ready line has no valid port".into())),
    };
    let launch_token = match raw.launch_token {
        Some(t) if token_ok(&t) => t,
        _ => return Some(Err("ready line has a missing or malformed launchToken".into())),
    };
    let control_token = match raw.control_token {
        Some(t) if token_ok(&t) => t,
        _ => return Some(Err("ready line has a missing or malformed controlToken".into())),
    };
    Some(Ok(Ready { port, launch_token, control_token }))
}

/// Tokens end up in a URL fragment and an HTTP header: URL-safe characters only.
pub fn token_ok(t: &str) -> bool {
    (16..=512).contains(&t.len())
        && t.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~'))
}

/// Env for the sidecar: allowlisted parent vars, LC_*, MENGAI_* passthrough (e.g. MENGAI_PORT), then the owned vars.
pub fn build_env<I, K, V>(parent: I, paths: &Paths) -> Vec<(OsString, OsString)>
where
    I: IntoIterator<Item = (K, V)>,
    K: AsRef<OsStr>,
    V: AsRef<OsStr>,
{
    let mut env: Vec<(OsString, OsString)> = parent
        .into_iter()
        .filter(|(k, _)| {
            let Some(k) = k.as_ref().to_str() else { return false };
            ENV_ALLOWLIST.contains(&k) || k.starts_with("LC_") || (k.starts_with("MENGAI_") && !ENV_OWNED.contains(&k))
        })
        .map(|(k, v)| (k.as_ref().to_owned(), v.as_ref().to_owned()))
        .collect();
    env.push(("MENGAI_MODE".into(), "local".into()));
    env.push(("MENGAI_DATA_DIR".into(), paths.data_dir.clone().into_os_string()));
    env.push(("MENGAI_WEB_DIR".into(), paths.web_dir.clone().into_os_string()));
    env.push(("MENGAI_HANDS_BIN".into(), paths.hands_bin.clone().into_os_string()));
    env.push(("MENGAI_MIGRATIONS_DIR".into(), paths.migrations_dir.clone().into_os_string()));
    env
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
    ready: OnceLock<(u16, String)>,
    stop_done: Mutex<bool>,
}

impl Sidecar {
    /// Spawns the sidecar in its own process group with piped stdio and starts the drain and monitor threads.
    pub fn spawn(mut cmd: Command, paths: &Paths, log: Arc<AppLog>, events: Sender<Event>) -> io::Result<Arc<Self>> {
        use std::os::unix::process::CommandExt;
        cmd.env_clear()
            .envs(build_env(std::env::vars_os(), paths))
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
    pub fn control(&self) -> Option<(u16, String)> {
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

    /// Graceful: SIGTERM, wait up to 3 s, then SIGKILL the process group (stragglers such as the hands helper).
    /// Forced: SIGKILL the group now. Idempotent; a second caller waits for the first to finish.
    pub fn stop(&self, force: bool, log: &AppLog) {
        let Ok(mut done) = self.stop_done.lock() else { return };
        if *done {
            return;
        }
        if !force && !self.has_exited() {
            if let Err(e) = signals::terminate(self.pid) {
                log.warn("sidecar", &format!("SIGTERM failed: {e}"));
            }
            if !self.wait_exit(TERM_GRACE) {
                log.warn("sidecar", "did not exit within 3 s of SIGTERM, killing its process group");
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
        // Closing stdin is the sidecar's second exit signal; drop it last.
        if let Ok(mut stdin) = self.stdin.lock() {
            stdin.take();
        }
        *done = true;
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
                            // The tokens are registered before any later line can be logged.
                            log.add_secret(&ready.launch_token);
                            log.add_secret(&ready.control_token);
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

    const LT: &str = "launch_0123456789abcdef";
    const CT: &str = "control_0123456789abcdef";

    #[test]
    fn parses_the_contract_ready_line() {
        let line = format!("{{\"event\":\"ready\",\"port\":51234,\"launchToken\":\"{LT}\",\"controlToken\":\"{CT}\"}}");
        let ready = parse_ready(&line).unwrap().unwrap();
        assert_eq!(ready, Ready { port: 51234, launch_token: LT.into(), control_token: CT.into() });
    }

    #[test]
    fn ignores_other_lines_and_rejects_broken_ready() {
        assert!(parse_ready("listening soon").is_none());
        assert!(parse_ready("{\"level\":\"info\",\"msg\":\"boot\"}").is_none());
        assert!(parse_ready("{not json").is_none());
        let bad_port =
            format!("{{\"event\":\"ready\",\"port\":70000,\"launchToken\":\"{LT}\",\"controlToken\":\"{CT}\"}}");
        assert!(parse_ready(&bad_port).unwrap().is_err());
        let injected =
            format!("{{\"event\":\"ready\",\"port\":1,\"launchToken\":\"{LT}&x=<y>\",\"controlToken\":\"{CT}\"}}");
        assert!(parse_ready(&injected).unwrap().is_err());
        let crlf =
            format!("{{\"event\":\"ready\",\"port\":1,\"launchToken\":\"{LT}\",\"controlToken\":\"{CT}\\r\\nx: y\"}}");
        assert!(parse_ready(&crlf).unwrap().is_err());
        let short = "{\"event\":\"ready\",\"port\":1,\"launchToken\":\"short\",\"controlToken\":\"short\"}";
        assert!(parse_ready(short).unwrap().is_err());
    }

    #[test]
    fn env_is_allowlisted_and_owned_vars_win() {
        let paths =
            Paths { data_dir: "/d".into(), web_dir: "/w".into(), hands_bin: "/h".into(), migrations_dir: "/m".into() };
        let parent = vec![
            ("HOME", "/Users/x"),
            ("PATH", "/usr/bin"),
            ("LC_ALL", "en_US.UTF-8"),
            ("AWS_SECRET_ACCESS_KEY", "nope"),
            ("OPENAI_API_KEY", "nope"),
            ("MENGAI_PORT", "4312"),
            ("MENGAI_DATA_DIR", "/evil"),
            ("MENGAI_MIGRATIONS_DIR", "/evil-sql"),
        ];
        let env = build_env(parent, &paths);
        let get = |k: &str| env.iter().rev().find(|(ek, _)| ek == k).map(|(_, v)| v.to_string_lossy().into_owned());
        assert_eq!(get("HOME").as_deref(), Some("/Users/x"));
        assert_eq!(get("LC_ALL").as_deref(), Some("en_US.UTF-8"));
        assert_eq!(get("MENGAI_PORT").as_deref(), Some("4312"));
        assert_eq!(get("MENGAI_MODE").as_deref(), Some("local"));
        assert_eq!(get("MENGAI_DATA_DIR").as_deref(), Some("/d"));
        assert_eq!(get("MENGAI_WEB_DIR").as_deref(), Some("/w"));
        assert_eq!(get("MENGAI_HANDS_BIN").as_deref(), Some("/h"));
        assert_eq!(get("MENGAI_MIGRATIONS_DIR").as_deref(), Some("/m"));
        assert!(get("AWS_SECRET_ACCESS_KEY").is_none());
        assert!(get("OPENAI_API_KEY").is_none());
        for owned in ENV_OWNED {
            assert_eq!(env.iter().filter(|(k, _)| k == owned).count(), 1, "{owned} set exactly once");
        }
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

    fn fake_sidecar(script: &str) -> (Arc<Sidecar>, std::sync::mpsc::Receiver<Event>, Arc<AppLog>) {
        let dir = std::env::temp_dir().join(format!("mengai-desktop-test-{}", std::process::id()));
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
        let sc = Sidecar::spawn(cmd, &paths, log.clone(), tx).expect("spawn fake sidecar");
        (sc, rx, log)
    }

    #[test]
    fn handshake_then_graceful_stop() {
        let script = format!(
            "trap 'exit 0' TERM; echo boot; echo '{{\"event\":\"ready\",\"port\":40001,\"launchToken\":\"{LT}\",\"controlToken\":\"{CT}\"}}'; while true; do sleep 0.05; done"
        );
        let (sc, rx, log) = fake_sidecar(&script);
        let ready = match rx.recv_timeout(Duration::from_secs(5)).expect("event") {
            Event::Ready(r) => r,
            _ => panic!("expected ready"),
        };
        assert_eq!(ready.port, 40001);
        sc.set_ready(&ready);
        assert_eq!(sc.control(), Some((40001, CT.to_string())));
        let started = Instant::now();
        sc.stop(false, &log);
        assert!(sc.has_exited());
        assert!(started.elapsed() < TERM_GRACE + Duration::from_secs(2));
        sc.stop(false, &log); // idempotent
    }

    #[test]
    fn stubborn_sidecar_is_killed_with_its_group() {
        let script = format!(
            "trap '' TERM; sleep 30 & echo '{{\"event\":\"ready\",\"port\":40002,\"launchToken\":\"{LT}\",\"controlToken\":\"{CT}\"}}'; while true; do sleep 0.05; done"
        );
        let (sc, rx, log) = fake_sidecar(&script);
        assert!(matches!(rx.recv_timeout(Duration::from_secs(5)).expect("event"), Event::Ready(_)));
        let started = Instant::now();
        sc.stop(false, &log);
        assert!(started.elapsed() >= TERM_GRACE);
        assert!(sc.has_exited());
        // The background `sleep 30` shared the group. SIGKILL delivery and reaping are
        // asynchronous, so poll for the empty group (ESRCH) for up to 1 s.
        let deadline = Instant::now() + Duration::from_secs(1);
        let gone = loop {
            // SAFETY: signal 0 only probes for existence; the pgid is the child we spawned (> 1).
            let rc = unsafe { libc::killpg(sc.pid as libc::pid_t, 0) };
            if rc == -1 && io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
                break true;
            }
            if Instant::now() >= deadline {
                break false;
            }
            thread::sleep(Duration::from_millis(10));
        };
        assert!(gone, "process group {} still has members 1 s after stop()", sc.pid);
    }

    #[test]
    fn early_exit_is_reported() {
        let (_sc, rx, _log) = fake_sidecar("echo 'crash' >&2; exit 3");
        match rx.recv_timeout(Duration::from_secs(5)).expect("event") {
            Event::Exited(code) => assert_eq!(code, Some(3)),
            _ => panic!("expected exit"),
        }
    }
}
