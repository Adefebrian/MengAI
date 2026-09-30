// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! The sidecar's process tree on Windows, for the quit and force stop path.
//!
//! Windows has no process group to SIGKILL and no SIGTERM for a child without a
//! console. So the shell puts the sidecar in a job object right after the spawn,
//! with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE and no breakaway allowed: every
//! process the engine starts stays in the job, detached previews (libuv
//! DETACHED_PROCESS) and their orphans included. Stopping ends the job. If the
//! shell itself dies, the kernel closes its job handle and ends the job anyway,
//! so a crash leaves nothing behind either.
//!
//! When the job cannot be created or joined, the stop falls back to
//! `taskkill /PID <pid> /T /F` (absolute path, no console window) and the log
//! says so: that walks parent links, so it misses a process whose parent has
//! already exited.
//!
//! Five kernel32 calls, declared here (std links kernel32 on Windows); no new
//! crate (JEV be.new_tech build_inhouse 0.41). The one struct handed to the
//! kernel has its x64 size checked at compile time and its layout tested on
//! every platform.
use std::io;

/// CREATE_NEW_PROCESS_GROUP: a Ctrl+C or Ctrl+Break aimed at the shell's console group never reaches the sidecar.
pub const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
/// CREATE_NO_WINDOW: the console subsystem sidecar runs without a console window.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Creation flags for the sidecar (and for taskkill, which only needs the hidden console).
pub const SIDECAR_FLAGS: u32 = CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW;
/// taskkill.exe exit code for "no such process": already gone is success for a shutdown path.
pub const TASKKILL_NOT_FOUND: i32 = 128;

/// taskkill arguments for the whole tree below `pid`, forced. Refuses the idle and System
/// processes (0 and 4) and anything at or below them, like signals.rs refuses pid <= 1.
pub fn taskkill_args(pid: u32) -> io::Result<[String; 4]> {
    if pid <= 4 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "refusing to end a system process tree"));
    }
    Ok(["/PID".into(), pid.to_string(), "/T".into(), "/F".into()])
}

/// The Win32 structs the job object needs, laid out as in the Windows SDK (winnt.h).
/// Compiled on every platform in tests so the layout is checked on any machine.
#[cfg(any(windows, test))]
pub mod layout {
    /// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (winnt.h).
    pub const KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;
    /// JobObjectExtendedLimitInformation (JOBOBJECTINFOCLASS).
    pub const EXTENDED_LIMIT_INFORMATION: i32 = 9;

    /// IO_COUNTERS.
    #[repr(C)]
    #[derive(Default)]
    pub struct IoCounters {
        pub read_operation_count: u64,
        pub write_operation_count: u64,
        pub other_operation_count: u64,
        pub read_transfer_count: u64,
        pub write_transfer_count: u64,
        pub other_transfer_count: u64,
    }

    /// JOBOBJECT_BASIC_LIMIT_INFORMATION. LARGE_INTEGER is an 8 byte aligned i64.
    #[repr(C)]
    #[derive(Default)]
    pub struct BasicLimit {
        pub per_process_user_time_limit: i64,
        pub per_job_user_time_limit: i64,
        pub limit_flags: u32,
        pub minimum_working_set_size: usize,
        pub maximum_working_set_size: usize,
        pub active_process_limit: u32,
        pub affinity: usize,
        pub priority_class: u32,
        pub scheduling_class: u32,
    }

    /// JOBOBJECT_EXTENDED_LIMIT_INFORMATION.
    #[repr(C)]
    #[derive(Default)]
    pub struct ExtendedLimit {
        pub basic: BasicLimit,
        pub io: IoCounters,
        pub process_memory_limit: usize,
        pub job_memory_limit: usize,
        pub peak_process_memory_used: usize,
        pub peak_job_memory_used: usize,
    }

    /// sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION) on x64 and arm64 Windows.
    #[cfg(target_pointer_width = "64")]
    pub const EXTENDED_LIMIT_SIZE: usize = 144;
    #[cfg(target_pointer_width = "64")]
    const _: () = assert!(std::mem::size_of::<ExtendedLimit>() == EXTENDED_LIMIT_SIZE);

    /// Limits for the sidecar's job: end every process in it when the last handle closes.
    /// No breakaway flag, so no process in the job can leave it.
    pub fn kill_on_close() -> ExtendedLimit {
        let mut info = ExtendedLimit::default();
        info.basic.limit_flags = KILL_ON_JOB_CLOSE;
        info
    }
}

#[cfg(windows)]
mod sys {
    use std::ffi::c_void;

    pub type Handle = *mut c_void;

    #[link(name = "kernel32")]
    extern "system" {
        pub fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
        pub fn SetInformationJobObject(job: Handle, class: i32, info: *const c_void, len: u32) -> i32;
        pub fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        pub fn TerminateJobObject(job: Handle, exit_code: u32) -> i32;
        pub fn CloseHandle(handle: Handle) -> i32;
    }
}

/// A kill-on-close job object holding the sidecar and everything it starts.
/// Dropping it closes the handle, which ends every process still in the job.
#[cfg(windows)]
pub struct Job {
    handle: sys::Handle,
}

// SAFETY: the handle is a kernel object reference owned by this value; the job calls used here
// are thread safe on any thread, and the handle is closed exactly once, in Drop.
#[cfg(windows)]
unsafe impl Send for Job {}
// SAFETY: as above; no method mutates Rust-side state.
#[cfg(windows)]
unsafe impl Sync for Job {}

#[cfg(windows)]
impl Job {
    /// An unnamed job with the default security descriptor and the kill-on-close limit.
    pub fn new() -> io::Result<Self> {
        // SAFETY: null attributes and null name are documented inputs (default security, unnamed job).
        let handle = unsafe { sys::CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Job { handle };
        let info = layout::kill_on_close();
        // SAFETY: `info` is a live JOBOBJECT_EXTENDED_LIMIT_INFORMATION (layout tested, size
        // asserted at compile time) and the length passed is its exact size; the kernel only reads it.
        let ok = unsafe {
            sys::SetInformationJobObject(
                job.handle,
                layout::EXTENDED_LIMIT_INFORMATION,
                (&info as *const layout::ExtendedLimit).cast(),
                std::mem::size_of::<layout::ExtendedLimit>() as u32,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }

    /// Puts the spawned sidecar in the job. Called right after the spawn, before the engine
    /// has booted far enough to start anything of its own.
    pub fn assign(&self, child: &std::process::Child) -> io::Result<()> {
        use std::os::windows::io::AsRawHandle;
        // SAFETY: both handles stay open for the whole call: the job is owned by self and the
        // process handle by `child`, which the caller holds.
        let ok = unsafe { sys::AssignProcessToJobObject(self.handle, child.as_raw_handle() as sys::Handle) };
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    /// Ends every process in the job now (exit code 1). An empty job is success.
    pub fn terminate(&self) -> io::Result<()> {
        // SAFETY: the job handle is open for the life of self.
        let ok = unsafe { sys::TerminateJobObject(self.handle, 1) };
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        // SAFETY: the handle came from CreateJobObjectW and is closed only here.
        unsafe {
            sys::CloseHandle(self.handle);
        }
    }
}

/// taskkill.exe from the system folder, never from PATH.
#[cfg(windows)]
fn taskkill_exe() -> std::path::PathBuf {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
    std::path::PathBuf::from(root).join("System32").join("taskkill.exe")
}

/// Fallback stop when there is no job: `taskkill /PID <pid> /T /F`, hidden, 5 s deadline.
#[cfg(windows)]
pub fn taskkill_tree(pid: u32) -> io::Result<()> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let args = taskkill_args(pid)?;
    let mut child = Command::new(taskkill_exe())
        .args(&args)
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::new(io::ErrorKind::TimedOut, "taskkill did not finish within 5 s"));
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    match status.code() {
        Some(0) | Some(TASKKILL_NOT_FOUND) => Ok(()),
        _ => Err(io::Error::other(format!("taskkill exited with {status}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::layout::*;
    use super::*;
    use std::mem::{align_of, offset_of, size_of};

    #[test]
    fn creation_flags_match_the_windows_sdk() {
        assert_eq!(CREATE_NEW_PROCESS_GROUP, 0x200);
        assert_eq!(CREATE_NO_WINDOW, 0x0800_0000);
        assert_eq!(SIDECAR_FLAGS, 0x0800_0200);
        assert_eq!(KILL_ON_JOB_CLOSE, 0x2000);
        assert_eq!(EXTENDED_LIMIT_INFORMATION, 9);
    }

    #[test]
    #[cfg(target_pointer_width = "64")]
    fn job_limit_layout_matches_winnt_h_on_64_bit() {
        assert_eq!(size_of::<IoCounters>(), 48);
        assert_eq!(size_of::<BasicLimit>(), 64);
        assert_eq!(offset_of!(BasicLimit, limit_flags), 16);
        assert_eq!(offset_of!(BasicLimit, minimum_working_set_size), 24);
        assert_eq!(offset_of!(BasicLimit, active_process_limit), 40);
        assert_eq!(offset_of!(BasicLimit, affinity), 48);
        assert_eq!(offset_of!(BasicLimit, priority_class), 56);
        assert_eq!(offset_of!(BasicLimit, scheduling_class), 60);
        assert_eq!(offset_of!(ExtendedLimit, io), 64);
        assert_eq!(offset_of!(ExtendedLimit, process_memory_limit), 112);
        assert_eq!(offset_of!(ExtendedLimit, peak_job_memory_used), 136);
        assert_eq!(size_of::<ExtendedLimit>(), EXTENDED_LIMIT_SIZE);
        assert_eq!(align_of::<ExtendedLimit>(), 8);
    }

    #[test]
    fn the_job_only_sets_kill_on_close() {
        let info = kill_on_close();
        assert_eq!(info.basic.limit_flags, KILL_ON_JOB_CLOSE);
        assert_eq!(info.basic.active_process_limit, 0);
        assert_eq!(info.job_memory_limit, 0);
    }

    #[test]
    fn taskkill_targets_one_tree_and_never_a_system_process() {
        assert_eq!(taskkill_args(4242).unwrap(), ["/PID", "4242", "/T", "/F"].map(String::from));
        for pid in [0, 1, 4] {
            assert!(taskkill_args(pid).is_err(), "pid {pid} must be refused");
        }
        assert_eq!(TASKKILL_NOT_FOUND, 128, "taskkill's code for a process that is already gone");
    }
}
