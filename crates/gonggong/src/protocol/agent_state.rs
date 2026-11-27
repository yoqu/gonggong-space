use super::*;

/// The API an endpoint speaks (`packages/protocol/src/agents.ts` `API_PROTOCOLS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApiProtocol {
    Anthropic,
    Openai,
    Gemini,
    Codebuddy,
}

impl AgentKind {
    /// Provider protocols the agent takes (the registry's `protocols`): the bundled agents by build, manifest agents
    /// from their `provider.protocols`; empty when it keeps its own login.
    pub fn protocols(self) -> &'static [ApiProtocol] {
        match self {
            AgentKind::Claude => &[ApiProtocol::Anthropic],
            AgentKind::Codex => &[ApiProtocol::Openai],
            _ => crate::adapters::get(self).and_then(|a| a.spec.provider.as_ref()).map_or(&[], |p| &p.protocols),
        }
    }

    pub fn takes(self, protocol: ApiProtocol) -> bool {
        self.protocols().contains(&protocol)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentLoginState {
    LoggedIn,
    LoggedOut,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentLoginFlow {
    Acp,
    Terminal,
}

/// One agent on a machine: detection and install in one (hello, agents.update and tools.result).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentState {
    pub kind: AgentKind,
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    #[serde(default)]
    pub min_version: Option<String>,
    #[serde(default)]
    pub catalog: Option<AgentCatalog>,
    /// Latest version on the mirror as last checked (cached); `None` when never checked.
    #[serde(default)]
    pub latest: Option<String>,
    /// Installed by Gonggong under its home.
    #[serde(default)]
    pub managed: bool,
    /// How the user's own install is upgraded; `None` when managed or unknown.
    #[serde(default)]
    pub upgrade_command: Option<String>,
    /// An agent off npm: the maker's install command (Gonggong neither installs nor upgrades it).
    #[serde(default)]
    pub install_command: Option<String>,
    /// Official CLI login state as detected on the machine; omitted by older daemons.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub login_state: Option<AgentLoginState>,
    /// Label of the detected login source (e.g. "API key", "账号登录"); none when logged out or unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub login_label: Option<String>,
    /// Interactive login flow supported for this agent on this machine.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub login_flow: Option<AgentLoginFlow>,
}

/// Node.js, the runtime the managed agents run on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RuntimeState {
    pub installed: bool,
    pub version: Option<String>,
    pub latest: Option<String>,
    pub managed: bool,
    pub path: Option<String>,
}
