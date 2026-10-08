use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Root of all local state (`~/.gonggong`); `GONGGONG_HOME` overrides it so several daemons can share a machine in tests.
pub fn home() -> PathBuf {
    std::env::var_os("GONGGONG_HOME").map(PathBuf::from).unwrap_or_else(|| user_home().join(".gonggong"))
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

    pub fn tunnel_url(&self) -> String {
        format!("{}/tunnel", self.ws_url())
    }
}

/// Local preferences kept across unbinding, in `<home>/settings.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Off = the persistent form of `GONGGONG_NO_AUTO_UPGRADE=1`.
    pub auto_upgrade: bool,
    /// Where Node and the agent CLIs are downloaded from.
    pub mirror: Mirror,
    /// Extra environment of the agent processes and npm.
    pub env: BTreeMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { auto_upgrade: true, mirror: Mirror::default(), env: BTreeMap::new() }
    }
}

/// Download source of the managed tools (npm registry and Node binaries); npmmirror by default since the official
/// ones are often unreachable in China.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Mirror {
    #[default]
    Npmmirror,
    Official,
    Custom {
        registry: String,
        node: String,
    },
}

impl Mirror {
    /// npm registry base URL, without a trailing slash.
    pub fn registry(&self) -> &str {
        match self {
            Mirror::Npmmirror => "https://registry.npmmirror.com",
            Mirror::Official => "https://registry.npmjs.org",
            Mirror::Custom { registry, .. } => registry.trim_end_matches('/'),
        }
    }

    /// Base URL of the Node distribution (`<base>/index.json`, `<base>/v<ver>/…`), without a trailing slash.
    pub fn node_dist(&self) -> &str {
        match self {
            Mirror::Npmmirror => "https://npmmirror.com/mirrors/node",
            Mirror::Official => "https://nodejs.org/dist",
            Mirror::Custom { node, .. } => node.trim_end_matches('/'),
        }
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

    /// The user's variables for child processes.
    pub fn child_env(&self) -> Vec<(String, String)> {
        self.env.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
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
    use super::{Mirror, Settings};

    #[test]
    fn settings_default_to_auto_upgrade_and_round_trip() {
        let home = tempfile::tempdir().unwrap();
        assert!(Settings::load(home.path()).unwrap().auto_upgrade);
        Settings { auto_upgrade: false, ..Settings::default() }.save(home.path()).unwrap();
        assert!(!Settings::load(home.path()).unwrap().auto_upgrade);
    }

    #[test]
    fn mirror_defaults_to_npmmirror_and_round_trips() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(home.path().join("settings.json"), r#"{"autoUpgrade":false}"#).unwrap();
        let settings = Settings::load(home.path()).unwrap();
        assert_eq!(settings.mirror, Mirror::Npmmirror);
        assert_eq!(settings.mirror.registry(), "https://registry.npmmirror.com");
        assert_eq!(settings.mirror.node_dist(), "https://npmmirror.com/mirrors/node");
        assert_eq!(Mirror::Official.registry(), "https://registry.npmjs.org");
        assert_eq!(Mirror::Official.node_dist(), "https://nodejs.org/dist");

        let custom = Mirror::Custom { registry: "http://r.local/".into(), node: "http://n.local/node/".into() };
        assert_eq!(custom.registry(), "http://r.local");
        assert_eq!(custom.node_dist(), "http://n.local/node");
        Settings { mirror: custom.clone(), ..settings }.save(home.path()).unwrap();
        assert_eq!(Settings::load(home.path()).unwrap().mirror, custom);
    }

    #[test]
    fn child_env_carries_the_user_variables_and_ignores_a_former_global_proxy() {
        let home = tempfile::tempdir().unwrap();
        let old = r#"{"autoUpgrade":true,"proxy":{"url":"http://127.0.0.1:7890"},"env":{"FOO":"1"}}"#;
        std::fs::write(home.path().join("settings.json"), old).unwrap();
        let settings = Settings::load(home.path()).unwrap();
        assert_eq!(settings.child_env(), vec![("FOO".to_string(), "1".to_string())]);
    }
}
