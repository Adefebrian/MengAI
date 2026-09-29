// Build script: makes sure the externalBin path exists so `cargo check` works
// on a fresh clone (tauri-build refuses to run without it), then runs
// tauri-build with an app ACL manifest so `pick_folder` is gated by a
// capability instead of being open to every origin.
//
// The placeholder only ever exists in debug builds. A release build with no
// real sidecar, or with the placeholder still in place, fails here, loudly.
use std::{env, fs, path::PathBuf};

const PLACEHOLDER_MARKER: &str = "MENGAI_SIDECAR_PLACEHOLDER";

fn main() {
    ensure_sidecar();
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["pick_folder"])),
    )
    .expect("tauri-build failed");
}

fn ensure_sidecar() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let target = env::var("TARGET").expect("TARGET");
    let release = env::var("PROFILE").map(|p| p == "release").unwrap_or(false);
    let path = manifest_dir.join("binaries").join(format!("mengai-api-{target}"));
    println!("cargo:rerun-if-changed={}", path.display());

    let is_placeholder = fs::read(&path)
        .map(|bytes| {
            let head = &bytes[..bytes.len().min(4096)];
            String::from_utf8_lossy(head).contains(PLACEHOLDER_MARKER)
        })
        .ok();

    match (is_placeholder, release) {
        (Some(false), _) => {}
        (Some(true), false) => {
            println!("cargo:warning=mengai-api sidecar is the placeholder; run `bun run dev` in apps/desktop to build the real one");
        }
        (Some(true), true) | (None, true) => {
            panic!(
                "release build needs the real sidecar at {}: run `bun run build` in apps/desktop (it runs apps/api build:sidecar)",
                path.display()
            );
        }
        (None, false) => {
            fs::create_dir_all(path.parent().expect("binaries dir")).expect("create binaries dir");
            let script = format!(
                "#!/bin/sh\n# {PLACEHOLDER_MARKER}: written by build.rs so cargo check works without a sidecar build.\necho 'mengai-api sidecar is a placeholder: run `bun run dev` in apps/desktop' >&2\nexit 78\n"
            );
            fs::write(&path, script).expect("write sidecar placeholder");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("chmod placeholder");
            }
            println!("cargo:warning=wrote a placeholder mengai-api sidecar at {}", path.display());
        }
    }
}
