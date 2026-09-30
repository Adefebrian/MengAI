// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! Which loopback port the engine starts on.
//!
//! The configured port (settings.json `port`, default 4280) wins when it is
//! free. When it is busy and lies inside 4280..4289, the engine starts on the
//! first free port of that range instead; the web app probes the same range.
//! An explicit port outside the range is honoured as is: busy means a dialog,
//! never a silent move. This runs only after the single-instance handoff and
//! the data dir lock (instance.rs), so a busy port is never this app's own
//! engine; it is another program, often a root `bun run dev` engine. The
//! health probe only tells the two apart for the log.
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::ops::RangeInclusive;
use std::time::{Duration, Instant};

use crate::control::parse_status;

/// Ports the engine may fall back to. Must match RUNTIME_PORTS in apps/web/src/api/runtime.ts.
pub const FALLBACK_RANGE: RangeInclusive<u16> = 4280..=4289;
pub const HEALTH_PATH: &str = "/api/health";
pub const HEALTH_DEADLINE: Duration = Duration::from_secs(1);
const MAX_RESPONSE: usize = 64 * 1024;

/// Where the engine will listen and why.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pick {
    pub port: u16,
    /// The configured port that was busy, when this is a fallback.
    pub busy: Option<u16>,
}

/// No port to start on. Each case is the text of a dialog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NoPort {
    /// An explicit port outside the fallback range is busy (no fallback by design).
    Busy(u16),
    /// Every port of the range is busy.
    RangeBusy { first: u16, last: u16 },
}

/// The configured port when `free` says so, else the first free port of the fallback range.
pub fn choose(configured: u16, free: impl FnMut(u16) -> bool) -> Result<Pick, NoPort> {
    pick(configured, FALLBACK_RANGE, free)
}

/// `choose` over any range (tests use their own).
pub fn pick(configured: u16, range: RangeInclusive<u16>, mut free: impl FnMut(u16) -> bool) -> Result<Pick, NoPort> {
    if free(configured) {
        return Ok(Pick { port: configured, busy: None });
    }
    if !range.contains(&configured) {
        return Err(NoPort::Busy(configured));
    }
    let (first, last) = (*range.start(), *range.end());
    range
        .filter(|&p| p != configured)
        .find(|&p| free(p))
        .map(|port| Pick { port, busy: Some(configured) })
        .ok_or(NoPort::RangeBusy { first, last })
}

/// Who holds a busy port, as far as a health read can tell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Holder {
    /// `GET /api/health` answered 200 with JSON `"mode":"local"`: another MengAI engine.
    Engine,
    /// Anything else, including no answer within the deadline.
    Other,
}

impl Holder {
    pub fn describe(self) -> &'static str {
        match self {
            Holder::Engine => "another MengAI engine (for example `bun run dev` from the repo)",
            Holder::Other => "another program",
        }
    }
}

pub fn health_request(port: u16) -> Vec<u8> {
    format!(
        "GET {HEALTH_PATH} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    )
    .into_bytes()
}

/// A MengAI engine answer: HTTP 200 and a JSON object with `"mode":"local"`.
/// The body is read between the first `{` and the last `}`, which also covers one chunk of a chunked reply.
pub fn is_engine_health(response: &[u8]) -> bool {
    if parse_status(response) != Some(200) {
        return false;
    }
    let text = String::from_utf8_lossy(response);
    let Some((_, body)) = text.split_once("\r\n\r\n") else { return false };
    let (Some(start), Some(end)) = (body.find('{'), body.rfind('}')) else { return false };
    if end < start {
        return false;
    }
    serde_json::from_str::<serde_json::Value>(&body[start..=end])
        .ok()
        .is_some_and(|v| v.get("mode").and_then(|m| m.as_str()) == Some("local"))
}

/// One loopback `GET /api/health`: connect and write deadlines, and one overall read deadline
/// (a holder that keeps the connection open or drips bytes cannot stall startup). Never errors:
/// no answer is `Other`.
pub fn probe_holder(port: u16, deadline: Duration) -> Holder {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let read = || -> std::io::Result<Vec<u8>> {
        let mut stream = TcpStream::connect_timeout(&addr, deadline)?;
        stream.set_write_timeout(Some(deadline))?;
        stream.write_all(&health_request(port))?;
        let started = Instant::now();
        let mut response = Vec::new();
        let mut chunk = [0u8; 4096];
        while response.len() < MAX_RESPONSE {
            let left = deadline.saturating_sub(started.elapsed());
            if left.is_zero() {
                break;
            }
            stream.set_read_timeout(Some(left))?;
            match stream.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => response.extend_from_slice(&chunk[..n]),
            }
        }
        Ok(response)
    };
    match read() {
        Ok(response) if is_engine_health(&response) => Holder::Engine,
        _ => Holder::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn a_free_configured_port_is_used_as_is() {
        assert_eq!(choose(4280, |_| true), Ok(Pick { port: 4280, busy: None }));
        assert_eq!(choose(5000, |_| true), Ok(Pick { port: 5000, busy: None }));
    }

    #[test]
    fn busy_4190_falls_back_to_4191() {
        assert_eq!(choose(4280, |p| p != 4280), Ok(Pick { port: 4281, busy: Some(4280) }));
        // The first free port of the range, skipping every busy one.
        assert_eq!(choose(4280, |p| p >= 4284), Ok(Pick { port: 4284, busy: Some(4280) }));
        // A configured port inside the range falls back to the range start when that is free.
        assert_eq!(choose(4285, |p| p != 4285), Ok(Pick { port: 4280, busy: Some(4285) }));
    }

    #[test]
    fn all_ten_busy_is_an_error_naming_the_range() {
        let seen = RefCell::new(Vec::new());
        let out = choose(4280, |p| {
            seen.borrow_mut().push(p);
            false
        });
        assert_eq!(out, Err(NoPort::RangeBusy { first: 4280, last: 4289 }));
        assert_eq!(*seen.borrow(), (4280..=4289).collect::<Vec<u16>>(), "each port probed once, in order");
    }

    #[test]
    fn an_explicit_port_outside_the_range_has_no_fallback() {
        let seen = RefCell::new(Vec::new());
        let out = choose(5000, |p| {
            seen.borrow_mut().push(p);
            p != 5000
        });
        assert_eq!(out, Err(NoPort::Busy(5000)));
        assert_eq!(*seen.borrow(), vec![5000], "no port of the range is probed");
        assert_eq!(choose(4189, |p| p != 4189), Err(NoPort::Busy(4189)));
        assert_eq!(choose(4200, |p| p != 4200), Err(NoPort::Busy(4200)));
    }

    #[test]
    fn real_listeners_are_skipped() {
        // Two held ports as the start of a range of their own (4280..4289 may be in use on this Mac);
        // the third slot stands for a free port, so no other parallel test can race for it.
        let a = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let b = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let held = [a.local_addr().unwrap().port(), b.local_addr().unwrap().port()];
        let out = pick(0, 0..=2u16, |i| match held.get(i as usize) {
            Some(&p) => crate::sidecar::port_available(p),
            None => true,
        });
        assert_eq!(out, Ok(Pick { port: 2, busy: Some(0) }));
        drop((a, b));
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
    fn a_mengai_engine_is_told_apart_from_another_program() {
        let (port, handle) = serve_once(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"ok\":true,\"mode\":\"local\",\"version\":\"0.1.0\"}",
        );
        assert_eq!(probe_holder(port, HEALTH_DEADLINE), Holder::Engine);
        let req = handle.join().unwrap();
        assert!(req.starts_with("GET /api/health HTTP/1.1\r\n"));
        assert!(req.contains(&format!("\r\nHost: 127.0.0.1:{port}\r\n")));
        assert!(!req.to_ascii_lowercase().contains("\r\norigin:"));

        let (port, handle) = serve_once("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<!doctype html><p>{}</p>");
        assert_eq!(probe_holder(port, HEALTH_DEADLINE), Holder::Other);
        handle.join().unwrap();

        let free = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert_eq!(probe_holder(free, Duration::from_millis(300)), Holder::Other);
    }

    #[test]
    fn a_holder_that_keeps_the_socket_open_cannot_stall_startup() {
        for reply in [Some("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"mode\":\"local\"}"), None] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let (done, wait) = std::sync::mpsc::channel::<()>();
            let handle = thread::spawn(move || {
                let (mut sock, _) = listener.accept().unwrap();
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf);
                if let Some(r) = reply {
                    sock.write_all(r.as_bytes()).unwrap();
                }
                let _ = wait.recv(); // keep the socket open until the probe gave up
            });
            let started = std::time::Instant::now();
            let holder = probe_holder(port, Duration::from_millis(400));
            assert!(started.elapsed() < Duration::from_secs(2), "the read deadline is overall");
            assert_eq!(holder, if reply.is_some() { Holder::Engine } else { Holder::Other });
            done.send(()).unwrap();
            handle.join().unwrap();
        }
    }

    #[test]
    fn health_answers_are_checked_strictly() {
        let ok = b"HTTP/1.1 200 OK\r\n\r\n{\"mode\":\"local\"}";
        assert!(is_engine_health(ok));
        assert!(is_engine_health(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n10\r\n{\"mode\":\"local\"}\r\n0\r\n\r\n"
        ));
        assert!(!is_engine_health(b"HTTP/1.1 200 OK\r\n\r\n{\"mode\":\"server\"}"));
        assert!(!is_engine_health(b"HTTP/1.1 403 Forbidden\r\n\r\n{\"mode\":\"local\"}"));
        assert!(!is_engine_health(b"HTTP/1.1 200 OK\r\n\r\n}{"));
        assert!(!is_engine_health(b"garbage"));
    }
}
