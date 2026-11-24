//! What a run's agent process starts with, and the PATH the CLI connectors give it.
use super::Inner;
use agent_client_protocol::AcpAgentConfig;
use agent_client_protocol::schema::v1 as acp;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// What a run's agent process starts with besides the bot and its provider (read by the manifest agents).
#[derive(Default)]
pub(crate) struct Process<'a> {
    /// The (group, bot) pair `<group>-<bot>` (its `{state}`), or [`crate::adapters::PROBE`].
    pub key: &'a str,
    /// The team skills folder and the group's plugins (`skills.via: arg`).
    pub plugin_dirs: &'a [PathBuf],
    /// The workspace (`chdir`, and the launch script's `cwd`).
    pub cwd: Option<&'a Path>,
    /// The run's MCP servers and the built-in gonggong one (`mcp.via: env`, the launch script).
    pub mcp_servers: &'a [crate::protocol::McpServer],
    pub ask: Option<&'a acp::McpServer>,
    /// The turn originator's CLI connector profiles.
    pub cli_profiles: &'a [crate::protocol::RunCliProfile],
}

impl Inner {
    /// The agent's PATH with the originator's CLI connector profiles shimmed in front, the managed connector CLIs
    /// behind.
    pub(super) async fn cli_path(
        &self,
        config: AcpAgentConfig,
        profiles: &[crate::protocol::RunCliProfile],
    ) -> anyhow::Result<AcpAgentConfig> {
        let base = config.environment().get("PATH").map(std::ffi::OsString::from).or_else(|| std::env::var_os("PATH"));
        let mut real = HashMap::new();
        for p in profiles.iter().filter(|p| !p.profile.is_default()) {
            if let Some(cli) = self.connectors.locate(p.driver).await {
                real.insert(p.driver, cli);
            }
        }
        let path = crate::connectors::run_path(&self.config.home, &base.unwrap_or_default(), profiles, |d| {
            real.get(&d).cloned()
        })?;
        Ok(config.env("PATH", path.to_string_lossy()))
    }
}
