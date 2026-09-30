//! Process tree of the sidecar, for the quit and force stop sweep.
//!
//! The engine starts live previews, runner commands and connectors detached
//! (their own session and process group), so a SIGKILL to the sidecar's group
//! does not reach them. The shell snapshots the sidecar's descendants with
//! `/bin/ps` before it signals anything and again before it forces, then kills
//! every one still alive once the sidecar is gone (JEV sec.shell_hardening
//! orphan_sweep ps_snapshot 0.97). A process is only killed when its pid and
//! its start time both still match the snapshot, so a reused pid is never hit.
//! No FFI beyond kill(2) and killpg(2) in signals.rs.
use std::collections::{HashMap, HashSet};
use std::io::{self, Read};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub const PS: &str = "/bin/ps";
pub const PS_DEADLINE: Duration = Duration::from_secs(2);
const MAX_PS_OUTPUT: u64 = 16 * 1024 * 1024;

/// One `ps` row. `started` is the `lstart` column, compared as text.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Proc {
    pub pid: u32,
    pub ppid: u32,
    pub pgid: u32,
    pub started: String,
}

/// Parses `ps -axo pid=,ppid=,pgid=,lstart=` output; malformed rows are skipped.
pub fn parse_ps(out: &str) -> Vec<Proc> {
    out.lines()
        .filter_map(|line| {
            let mut rest = line.trim_start();
            let mut num = || -> Option<u32> {
                let end = rest.find(char::is_whitespace)?;
                let n = rest[..end].parse().ok()?;
                rest = rest[end..].trim_start();
                Some(n)
            };
            let (pid, ppid, pgid) = (num()?, num()?, num()?);
            let started = rest.trim_end();
            (!started.is_empty()).then(|| Proc { pid, ppid, pgid, started: started.to_string() })
        })
        .collect()
}

/// Every process below `root` (children, grandchildren, ...), found through ppid links.
pub fn descendants(table: &[Proc], root: u32) -> Vec<Proc> {
    let mut children: HashMap<u32, Vec<&Proc>> = HashMap::new();
    for p in table {
        if p.pid != p.ppid {
            children.entry(p.ppid).or_default().push(p);
        }
    }
    let mut out = Vec::new();
    let mut seen = HashSet::from([root]);
    let mut queue = vec![root];
    while let Some(pid) = queue.pop() {
        for child in children.get(&pid).into_iter().flatten() {
            if seen.insert(child.pid) {
                out.push((*child).clone());
                queue.push(child.pid);
            }
        }
    }
    out
}

/// Runs `/bin/ps` once with a cleared env and a 2 s deadline.
pub fn snapshot() -> io::Result<Vec<Proc>> {
    let mut child = Command::new(PS)
        .args(["-axo", "pid=,ppid=,pgid=,lstart="])
        .env_clear()
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let stdout = child.stdout.take().ok_or_else(|| io::Error::other("ps stdout not piped"))?;
    // Read on a thread: a full pipe would otherwise stall ps until the deadline.
    let reader = thread::Builder::new().name("ps-reader".into()).spawn(move || {
        let mut text = String::new();
        stdout.take(MAX_PS_OUTPUT).read_to_string(&mut text).map(|_| text)
    })?;
    let deadline = Instant::now() + PS_DEADLINE;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::new(io::ErrorKind::TimedOut, "ps did not answer within 2 s"));
        }
        thread::sleep(Duration::from_millis(5));
    };
    let text = reader.join().map_err(|_| io::Error::other("ps reader panicked"))??;
    if !status.success() {
        return Err(io::Error::other(format!("ps exited with {status}")));
    }
    Ok(parse_ps(&text))
}

/// The tracked processes that are still the same processes in `now` (pid and start time match).
pub fn still_alive<'a>(tracked: &'a [Proc], now: &[Proc]) -> Vec<&'a Proc> {
    let live: HashSet<(u32, &str)> = now.iter().map(|p| (p.pid, p.started.as_str())).collect();
    tracked.iter().filter(|p| live.contains(&(p.pid, p.started.as_str()))).collect()
}

/// What to SIGKILL for the survivors: groups they lead, then the pids themselves.
/// Never pid or pgid <= 1, never the shell itself or its own group, never the sidecar's group (killed already).
pub fn kill_plan(
    survivors: &[&Proc],
    shell_pid: u32,
    shell_pgid: Option<u32>,
    sidecar_pgid: u32,
) -> (Vec<u32>, Vec<u32>) {
    let mut groups: Vec<u32> = Vec::new();
    let mut pids: Vec<u32> = Vec::new();
    for p in survivors {
        if p.pid <= 1 || p.pid == shell_pid {
            continue;
        }
        let own_group = shell_pgid == Some(p.pgid);
        if p.pgid == p.pid && p.pgid != sidecar_pgid && !own_group && !groups.contains(&p.pgid) {
            groups.push(p.pgid);
        }
        if !pids.contains(&p.pid) {
            pids.push(p.pid);
        }
    }
    (groups, pids)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, ppid: u32, pgid: u32) -> Proc {
        Proc { pid, ppid, pgid, started: format!("Wed Sep 30 10:00:{:02} 2026", pid % 60) }
    }

    #[test]
    fn parses_ps_rows() {
        let out =
            "    1     0     1 Mon Sep 28 08:00:01 2026\n  512     1   512 Wed Sep 30 10:00:02 2026\ngarbage\n 9 8\n";
        let rows = parse_ps(out);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1], Proc { pid: 512, ppid: 1, pgid: 512, started: "Wed Sep 30 10:00:02 2026".into() });
    }

    #[test]
    fn walks_the_whole_tree_and_nothing_else() {
        // 100 sidecar; 101 in its group; 200 detached preview leading its group; 201 its dev server; 300 unrelated.
        let table =
            vec![p(1, 0, 1), p(100, 1, 100), p(101, 100, 100), p(200, 100, 200), p(201, 200, 200), p(300, 1, 300)];
        let mut pids: Vec<u32> = descendants(&table, 100).iter().map(|p| p.pid).collect();
        pids.sort();
        assert_eq!(pids, vec![101, 200, 201]);
        assert!(descendants(&table, 999).is_empty());
    }

    #[test]
    fn a_reused_pid_is_not_a_survivor() {
        let tracked = vec![p(200, 100, 200), p(201, 200, 200)];
        let mut reused = p(201, 1, 201);
        reused.started = "Wed Sep 30 11:59:59 2026".into();
        let now = vec![p(200, 1, 200), reused];
        let alive: Vec<u32> = still_alive(&tracked, &now).iter().map(|p| p.pid).collect();
        assert_eq!(alive, vec![200]);
    }

    #[test]
    fn plan_never_targets_the_shell_or_init() {
        let rows = [p(1, 0, 1), p(50, 1, 40), p(60, 1, 40), p(100, 50, 100), p(200, 100, 200), p(201, 200, 200)];
        let refs: Vec<&Proc> = rows.iter().collect();
        let (groups, pids) = kill_plan(&refs, 50, Some(40), 100);
        assert_eq!(groups, vec![200]);
        assert_eq!(pids, vec![60, 100, 200, 201]);
        let leader_of_own = [p(40, 1, 40)];
        let (groups, _) = kill_plan(&leader_of_own.iter().collect::<Vec<_>>(), 50, Some(40), 100);
        assert!(groups.is_empty());
    }

    #[test]
    fn real_snapshot_sees_this_test() {
        let table = snapshot().expect("ps");
        let me = std::process::id();
        assert!(table.iter().any(|p| p.pid == me && !p.started.is_empty()));
    }
}
