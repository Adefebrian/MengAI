//! kill(2) and killpg(2) for the sidecar. The std library can only SIGKILL a
//! single child; the shutdown contract needs SIGTERM first and a process
//! group kill after 3 s (the group also holds the hands helper).
use std::io;

fn guard(pid: u32) -> io::Result<libc::pid_t> {
    // Never signal pid 0 or 1 (our own group, or everything): only a real child pid.
    let pid =
        libc::pid_t::try_from(pid).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "pid out of range"))?;
    if pid <= 1 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "refusing to signal pid <= 1"));
    }
    Ok(pid)
}

fn check(rc: libc::c_int) -> io::Result<()> {
    if rc == 0 {
        return Ok(());
    }
    let err = io::Error::last_os_error();
    // Already gone is success for a shutdown path.
    if err.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(err)
    }
}

/// SIGTERM to the sidecar process itself.
pub fn terminate(pid: u32) -> io::Result<()> {
    let pid = guard(pid)?;
    // SAFETY: plain syscall with a validated positive pid; no memory is shared.
    check(unsafe { libc::kill(pid, libc::SIGTERM) })
}

/// SIGKILL to every process in the sidecar's group (pgid == sidecar pid via process_group(0)).
pub fn kill_group(pgid: u32) -> io::Result<()> {
    let pgid = guard(pgid)?;
    // SAFETY: plain syscall with a validated pgid > 1, never our own group.
    check(unsafe { libc::killpg(pgid, libc::SIGKILL) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_dangerous_pids() {
        assert!(terminate(0).is_err());
        assert!(terminate(1).is_err());
        assert!(kill_group(0).is_err());
        assert!(kill_group(1).is_err());
    }

    #[test]
    fn terminates_and_kills_a_real_group() {
        use std::os::unix::process::CommandExt;
        let mut child =
            std::process::Command::new("/bin/sleep").arg("30").process_group(0).spawn().expect("spawn sleep");
        kill_group(child.id()).expect("killpg");
        let status = child.wait().expect("wait");
        assert!(!status.success());
        // Signalling a reaped group is ESRCH, which the shutdown path treats as done.
        assert!(kill_group(child.id()).is_ok());
    }
}
