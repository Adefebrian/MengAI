// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! Kill switch client: one HTTP/1.1 POST to the sidecar on 127.0.0.1, with the
//! per-launch control token when the engine issued one (local mode has no
//! auth, so it may not). Host is the exact loopback address the engine
//! accepts, the body is JSON, and there is no Origin header. Loopback only,
//! explicit connect, write and read deadlines, no dependency (JEV be.new_tech
//! build_inhouse 0.71). Anything but a 2xx is a failure the caller fails closed on.
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

/// Must match CONTROL_TOKEN_HEADER in packages/shared/src/api.ts.
pub const CONTROL_TOKEN_HEADER: &str = "x-mengai-control";
pub const KILLSWITCH_PATH: &str = "/api/killswitch";
pub const DEADLINE: Duration = Duration::from_secs(3);
const MAX_RESPONSE: usize = 64 * 1024;

/// Who pressed it; mirrors KillSwitchBody.by in packages/shared/src/api.ts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trigger {
    Tray,
    Shortcut,
}

impl Trigger {
    pub fn as_str(self) -> &'static str {
        match self {
            Trigger::Tray => "tray",
            Trigger::Shortcut => "shortcut",
        }
    }
}

#[derive(Debug)]
pub struct KillOutcome {
    pub status: u16,
    pub body: String,
}

pub fn killswitch_request(port: u16, token: Option<&str>, by: Trigger) -> Vec<u8> {
    let body = format!("{{\"by\":\"{}\"}}", by.as_str());
    let auth = token.map(|t| format!("{CONTROL_TOKEN_HEADER}: {t}\r\n")).unwrap_or_default();
    format!(
        "POST {KILLSWITCH_PATH} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nAccept: application/json\r\n{auth}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}

/// Status code from `HTTP/1.x NNN reason`.
pub fn parse_status(response: &[u8]) -> Option<u16> {
    let line_end = response.iter().position(|&b| b == b'\n').unwrap_or(response.len());
    let line = std::str::from_utf8(&response[..line_end]).ok()?.trim_end();
    let mut parts = line.splitn(3, ' ');
    let version = parts.next()?;
    if !version.starts_with("HTTP/1.") {
        return None;
    }
    parts.next()?.parse().ok()
}

fn body_of(response: &[u8]) -> String {
    let text = String::from_utf8_lossy(response);
    text.split_once("\r\n\r\n").map(|(_, b)| b.trim().chars().take(512).collect()).unwrap_or_default()
}

/// POSTs the kill switch. Ok only on a 2xx; any error or other status is a failure the caller must fail closed on.
pub fn post_killswitch(port: u16, token: Option<&str>, by: Trigger, deadline: Duration) -> Result<KillOutcome, String> {
    if token.is_some_and(|t| t.bytes().any(|b| b == b'\r' || b == b'\n')) {
        return Err("control token contains a line break".into());
    }
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&addr, deadline).map_err(|e| format!("connect: {e}"))?;
    stream.set_write_timeout(Some(deadline)).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(deadline)).map_err(|e| e.to_string())?;
    stream.write_all(&killswitch_request(port, token, by)).map_err(|e| format!("write: {e}"))?;
    let mut response = Vec::new();
    stream.take(MAX_RESPONSE as u64).read_to_end(&mut response).map_err(|e| format!("read: {e}"))?;
    let status = parse_status(&response).ok_or_else(|| "no HTTP status line in response".to_string())?;
    let body = body_of(&response);
    if (200..300).contains(&status) {
        Ok(KillOutcome { status, body })
    } else {
        Err(format!("HTTP {status}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn builds_the_contract_request() {
        let req = String::from_utf8(killswitch_request(4312, Some("ctl_abc"), Trigger::Shortcut)).unwrap();
        assert!(req.starts_with("POST /api/killswitch HTTP/1.1\r\n"));
        assert!(req.contains("\r\nHost: 127.0.0.1:4312\r\n"));
        assert!(req.contains("\r\nContent-Type: application/json\r\n"));
        assert!(req.contains("\r\nx-mengai-control: ctl_abc\r\n"));
        assert!(req.contains("\r\nContent-Length: 17\r\n"));
        assert!(req.ends_with("\r\n\r\n{\"by\":\"shortcut\"}"));
        assert!(!req.to_ascii_lowercase().contains("\r\norigin:"));
        let bare = String::from_utf8(killswitch_request(4190, None, Trigger::Tray)).unwrap();
        assert!(!bare.contains(CONTROL_TOKEN_HEADER));
        assert!(bare.contains("\r\nContent-Type: application/json\r\n"));
        assert!(bare.ends_with("\r\n\r\n{\"by\":\"tray\"}"));
    }

    #[test]
    fn parses_status_lines() {
        assert_eq!(parse_status(b"HTTP/1.1 200 OK\r\n\r\n{}"), Some(200));
        assert_eq!(parse_status(b"HTTP/1.1 401 Unauthorized\r\n"), Some(401));
        assert_eq!(parse_status(b"garbage"), None);
    }

    fn serve_once(reply: &'static str) -> (u16, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 2048];
            let n = sock.read(&mut buf).unwrap();
            sock.write_all(reply.as_bytes()).unwrap();
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        (port, handle)
    }

    #[test]
    fn posts_to_a_loopback_server() {
        let (port, handle) = serve_once(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"stoppedRuns\":2,\"killedProcesses\":1}",
        );
        let out = post_killswitch(port, Some("ctl_token_value"), Trigger::Tray, DEADLINE).expect("2xx");
        assert_eq!(out.status, 200);
        assert!(out.body.contains("stoppedRuns"));
        assert!(handle.join().unwrap().contains("x-mengai-control: ctl_token_value"));
    }

    #[test]
    fn non_2xx_and_unreachable_are_failures() {
        let (port, handle) = serve_once("HTTP/1.1 403 Forbidden\r\n\r\n");
        assert!(post_killswitch(port, None, Trigger::Tray, DEADLINE).is_err());
        handle.join().unwrap();
        let free = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert!(post_killswitch(free, None, Trigger::Tray, Duration::from_millis(300)).is_err());
        assert!(post_killswitch(free, Some("bad\r\ntoken"), Trigger::Tray, DEADLINE).is_err());
    }
}
