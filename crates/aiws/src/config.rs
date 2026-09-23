use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Root of all local state (`~/.aiws`); `AIWS_HOME` overrides it so several daemons can share a machine in tests.
pub fn home() -> PathBuf {
    std::env::var_os("AIWS_HOME").map(PathBuf::from).unwrap_or_else(|| user_home().join(".aiws"))
}

pub fn user_home() -> PathBuf {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).expect("HOME is not set")
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub server: String,
    pub token: String,
    pub machine_id: String,
    pub owner_name: String,
    /// SHA-256 of the server's leaf certificate, pinned at login (https servers only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cert_sha256: Option<String>,
}

impl Config {
    fn path() -> PathBuf {
        home().join("config.json")
    }

    pub fn load() -> Result<Option<Config>> {
        match std::fs::read_to_string(Self::path()) {
            Ok(s) => Ok(Some(serde_json::from_str(&s).context("corrupt config.json")?)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::path();
        std::fs::create_dir_all(path.parent().unwrap())?;
        std::fs::write(&path, serde_json::to_vec_pretty(self)?)?;
        restrict_permissions(&path)
    }

    pub fn remove() -> Result<()> {
        match std::fs::remove_file(Self::path()) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }

    /// `http(s)://host` → `ws(s)://host/ws/daemon`
    pub fn ws_url(&self) -> String {
        format!("{}/ws/daemon", self.server.trim_end_matches('/').replacen("http", "ws", 1))
    }
}

/// Local preferences kept across unbinding, in `<home>/settings.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Off = the persistent form of `AIWS_NO_AUTO_UPGRADE=1`.
    pub auto_upgrade: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { auto_upgrade: true }
    }
}

impl Settings {
    pub fn load(home: &Path) -> Result<Settings> {
        match std::fs::read_to_string(home.join("settings.json")) {
            Ok(s) => Ok(serde_json::from_str(&s).context("corrupt settings.json")?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save(&self, home: &Path) -> Result<()> {
        std::fs::create_dir_all(home)?;
        std::fs::write(home.join("settings.json"), serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }
}

#[cfg(unix)]
fn restrict_permissions(path: &std::path::Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_permissions(_: &std::path::Path) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Settings;

    #[test]
    fn settings_default_to_auto_upgrade_and_round_trip() {
        let home = tempfile::tempdir().unwrap();
        assert!(Settings::load(home.path()).unwrap().auto_upgrade);
        Settings { auto_upgrade: false }.save(home.path()).unwrap();
        assert!(!Settings::load(home.path()).unwrap().auto_upgrade);
    }
}
