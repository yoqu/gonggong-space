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
    /// For the agents, npm and tool downloads; the team server is always reached directly.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<Proxy>,
    /// Extra environment of the agent processes and npm.
    pub env: BTreeMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { auto_upgrade: true, mirror: Mirror::default(), proxy: None, env: BTreeMap::new() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Proxy {
    /// `http(s)://[user:pass@]host:port`.
    pub url: String,
    /// Comma-separated hosts, domains or CIDRs that bypass the proxy.
    #[serde(default)]
    pub no_proxy: String,
}

impl Proxy {
    /// `no_proxy` with loopback first: the agents reach the daemon's local MCP endpoint there.
    pub fn bypass(&self) -> String {
        let user = self.no_proxy.split(',').map(str::trim).filter(|h| !h.is_empty());
        ["localhost", "127.0.0.1", "::1"].into_iter().chain(user).collect::<Vec<_>>().join(",")
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

    /// Environment for child processes, in order (a later entry wins): the proxy, then the user's variables.
    pub fn child_env(&self) -> Vec<(String, String)> {
        let mut env = Vec::new();
        if let Some(proxy) = &self.proxy {
            for name in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] {
                env.push((name.to_string(), proxy.url.clone()));
            }
            let bypass = proxy.bypass();
            env.push(("NO_PROXY".to_string(), bypass.clone()));
            env.push(("no_proxy".to_string(), bypass));
        }
        env.extend(self.env.iter().map(|(k, v)| (k.clone(), v.clone())));
        env
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
    use super::{Mirror, Proxy, Settings};

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
    fn child_env_carries_the_proxy_then_the_user_variables() {
        assert!(Settings::default().child_env().is_empty());
        let settings = Settings {
            proxy: Some(Proxy { url: "http://127.0.0.1:7890".into(), no_proxy: " corp.cn, ,10.0.0.0/8".into() }),
            env: [("FOO", "1"), ("HTTPS_PROXY", "http://other:8080")].map(|(k, v)| (k.into(), v.into())).into(),
            ..Settings::default()
        };
        let env = settings.child_env();
        let get = |k: &str| env.iter().rev().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
        assert_eq!(get("HTTP_PROXY"), Some("http://127.0.0.1:7890"));
        assert_eq!(get("https_proxy"), Some("http://127.0.0.1:7890"));
        assert_eq!(get("NO_PROXY"), Some("localhost,127.0.0.1,::1,corp.cn,10.0.0.0/8"));
        assert_eq!(get("no_proxy"), get("NO_PROXY"));
        assert_eq!(get("FOO"), Some("1"));
        assert_eq!(get("HTTPS_PROXY"), Some("http://other:8080"), "the user's own variables win");

        let home = tempfile::tempdir().unwrap();
        settings.save(home.path()).unwrap();
        assert_eq!(Settings::load(home.path()).unwrap(), settings);
    }
}
