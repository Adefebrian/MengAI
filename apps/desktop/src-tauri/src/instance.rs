// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! One MengAI per computer.
//!
//! First line: tauri-plugin-single-instance, registered first in the builder.
//! A second launch connects to the running instance, which shows and focuses
//! its window (`on_second_launch`), and the second process exits before its
//! own setup runs, so it never probes a port or starts an engine.
//!
//! Backstop: the plugin launches normally when its socket (a named mutex on
//! Windows) fails for any other reason (for example a stale socket owned by
//! another user). So the shell also holds an exclusive lock on
//! `<data dir>/shell.lock` for its whole life, taken before any port probe or
//! spawn: std `File::try_lock`, which is flock(2) on macOS and LockFileEx on
//! Windows. A second shell on the same data dir stops with a dialog instead of
//! starting a second engine on it (JEV sec.shell_hardening datadir_lock 0.92).
//! The kernel drops the lock when the process dies, so a crash never leaves a
//! stale lock behind.
use std::fs::{File, OpenOptions, TryLockError};
use std::io;
use std::path::Path;

pub const LOCK_FILE: &str = "shell.lock";

/// Held for the life of the shell; dropping it closes the file and releases the lock.
#[derive(Debug)]
pub struct InstanceLock {
    _file: File,
}

#[derive(Debug)]
pub enum LockError {
    /// Another process holds the lock: MengAI already runs on this data dir.
    Held,
    Io(io::Error),
}

/// Takes the data dir lock without waiting.
pub fn lock(data_dir: &Path) -> Result<InstanceLock, LockError> {
    let mut opts = OpenOptions::new();
    opts.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let file = opts.open(data_dir.join(LOCK_FILE)).map_err(LockError::Io)?;
    match file.try_lock() {
        Ok(()) => Ok(InstanceLock { _file: file }),
        Err(TryLockError::WouldBlock) => Err(LockError::Held),
        Err(TryLockError::Error(e)) => Err(LockError::Io(e)),
    }
}

/// What the running instance does when another launch hands off to it: bring
/// the main window to the front. Generic so the handoff is testable without a
/// Tauri runtime; returns whether there was a window to show (there is none
/// while the engine is still starting, and the window opens on its own then).
pub fn raise<W: Raise>(window: Option<&W>) -> bool {
    match window {
        Some(w) => {
            w.unminimize();
            w.show();
            w.set_focus();
            true
        }
        None => false,
    }
}

/// The three window calls a handoff needs.
pub trait Raise {
    fn unminimize(&self);
    fn show(&self);
    fn set_focus(&self);
}

impl<R: tauri::Runtime> Raise for tauri::WebviewWindow<R> {
    fn unminimize(&self) {
        let _ = tauri::WebviewWindow::unminimize(self);
    }
    fn show(&self) {
        let _ = tauri::WebviewWindow::show(self);
    }
    fn set_focus(&self) {
        let _ = tauri::WebviewWindow::set_focus(self);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::fs;

    #[derive(Default)]
    struct FakeWindow {
        calls: RefCell<Vec<&'static str>>,
    }

    impl Raise for FakeWindow {
        fn unminimize(&self) {
            self.calls.borrow_mut().push("unminimize");
        }
        fn show(&self) {
            self.calls.borrow_mut().push("show");
        }
        fn set_focus(&self) {
            self.calls.borrow_mut().push("set_focus");
        }
    }

    #[test]
    fn the_handoff_shows_and_focuses_the_window() {
        let w = FakeWindow::default();
        assert!(raise(Some(&w)));
        assert_eq!(*w.calls.borrow(), vec!["unminimize", "show", "set_focus"]);
        assert!(!raise::<FakeWindow>(None), "no window yet: nothing to show, nothing started");
    }

    #[test]
    fn a_second_shell_on_the_same_data_dir_is_refused() {
        let dir = std::env::temp_dir().join(format!("mengai-instance-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let first = lock(&dir).expect("first lock");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.join(LOCK_FILE)).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        // The lock belongs to the open file (flock on macOS, the handle on Windows), so a second
        // open in this process conflicts like another process would.
        assert!(matches!(lock(&dir), Err(LockError::Held)));
        drop(first);
        // Other tests fork children in parallel; a fork shares the open file until its exec
        // closes it (O_CLOEXEC), so allow a short moment for the release.
        let again = (0..50).find_map(|_| match lock(&dir) {
            Ok(l) => Some(l),
            Err(_) => {
                std::thread::sleep(std::time::Duration::from_millis(20));
                None
            }
        });
        assert!(again.is_some(), "released when the holder closes");
        drop(again);
        let _ = fs::remove_file(dir.join(LOCK_FILE));
        let _ = fs::remove_dir(&dir);
    }

    #[test]
    fn an_unusable_data_dir_is_an_io_error() {
        let missing = std::env::temp_dir().join(format!("mengai-instance-missing-{}", std::process::id())).join("nope");
        assert!(matches!(lock(&missing), Err(LockError::Io(_))));
    }
}
