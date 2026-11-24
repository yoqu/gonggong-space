//! The agent's PATH for a turn: CLI shims that add the originator's `--profile` first, the CLIs installed for
//! connectors last.
use super::{connectors_dir, managed_bins};
use crate::protocol::RunCliProfile;
use anyhow::Result;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

/// `base` (the agent's PATH) with a shim dir per member profile in front and the managed connector CLIs behind.
/// `real` finds a driver's CLI; a CLI not on the machine gets no shim.
pub fn run_path(
    home: &Path,
    base: &OsStr,
    profiles: &[RunCliProfile],
    real: impl Fn(crate::protocol::ConnectorDriver) -> Option<PathBuf>,
) -> Result<OsString> {
    let mut front = vec![];
    for p in profiles.iter().filter(|p| !p.profile.is_default()) {
        let Some(cli) = real(p.driver) else { continue };
        front.push(write_shim(home, p, &cli)?);
    }
    let rest = std::env::split_paths(base).collect::<Vec<_>>();
    let back = managed_bins(home).into_iter().filter(|b| !rest.contains(b)).collect::<Vec<_>>();
    Ok(std::env::join_paths(front.into_iter().chain(rest).chain(back))?)
}

/// `<home>/tools/connectors/shims/<driver>-<profile>/<driver>`, rewritten each time so it follows the CLI. Written
/// to a temp file and renamed: a concurrent turn never runs half a script.
fn write_shim(home: &Path, p: &RunCliProfile, cli: &Path) -> Result<PathBuf> {
    let bin = p.driver.binary();
    let dir = connectors_dir(home).join("shims").join(format!("{bin}-{}", p.profile));
    std::fs::create_dir_all(&dir)?;
    let (name, body) = script(bin, cli, p.profile.as_str());
    let tmp = dir.join(format!(".{name}.{}", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, body)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
    }
    std::fs::rename(&tmp, dir.join(name))?;
    Ok(dir)
}

#[cfg(unix)]
fn script(bin: &str, cli: &Path, profile: &str) -> (String, String) {
    let quoted = cli.to_string_lossy().replace('\'', r"'\''");
    (bin.to_string(), format!("#!/bin/sh\nexec '{quoted}' \"$@\" --profile {profile}\n"))
}

#[cfg(windows)]
fn script(bin: &str, cli: &Path, profile: &str) -> (String, String) {
    (format!("{bin}.cmd"), format!("@\"{}\" %* --profile {profile}\r\n", cli.display()))
}
