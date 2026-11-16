use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitAccessAction {
    Status,
    GenKey,
    SaveToken,
    RemoveToken,
    Test,
    TrustHost,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitTokenInput {
    pub host: String,
    pub username: String,
    pub secret: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAccessCmd {
    pub request_id: String,
    pub action: GitAccessAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<GitTokenInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyView {
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub fingerprint: String,
    pub public_key: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitTokenView {
    pub host: String,
    pub username: String,
    pub masked: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAccessView {
    pub ssh_keys: Vec<SshKeyView>,
    pub tokens: Vec<GitTokenView>,
    pub helper: Option<String>,
    pub known_hosts: Vec<String>,
}

/// One `gg doctor` check as the web sees it (its label comes from the web's own language).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiagCheck {
    pub kind: crate::diag::CheckKind,
    pub status: crate::diag::Status,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostKey {
    pub host: String,
    pub fingerprints: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAccessTest {
    pub url: String,
    pub ok: bool,
    pub reason: Option<RepoAccessReason>,
    pub detail: Option<String>,
    pub host_key: Option<HostKey>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolsSettings {
    pub mirror: Mirror,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolsAction {
    Status,
    Install,
    Upgrade,
    Settings,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsCmd {
    pub request_id: String,
    pub action: ToolsAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<ToolKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mirror: Option<Mirror>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProvidersAction {
    Presets,
    List,
    Save,
    Remove,
    Use,
    ImportLink,
    Catalog,
    BotCatalog,
    Official,
    AgentSettings,
}

/// One protocol of a provider being saved; absent fields keep what is there (or the preset's value).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointInput {
    pub protocol: ApiProtocol,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub models: Option<ModelMap>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<std::collections::BTreeMap<String, String>>,
    /// Claude Code command-line arguments, one per line; absent = unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
}

impl EndpointInput {
    pub fn new(protocol: ApiProtocol) -> EndpointInput {
        EndpointInput {
            protocol,
            base_url: None,
            api_key_field: None,
            model: None,
            models: None,
            env: None,
            args: None,
            effort: None,
            config_dir: None,
            executable_path: None,
        }
    }
}

/// Adds (no `id`) or edits a provider; absent fields keep the stored (or preset) value. An endpoint replaces the one
/// of its protocol and leaves the others; `removeProtocols` drops endpoints.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    /// Empty = direct; the masked one from the view = unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoints: Option<Vec<EndpointInput>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remove_protocols: Option<Vec<ApiProtocol>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvidersCmd {
    pub request_id: String,
    pub action: ProvidersAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<AgentKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bot_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choice: Option<String>,
    /// `use` of a machine default: its model; absent / null = the endpoint's (else the adapter's) default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<ProviderInput>,
    /// For `official`, with `agent`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub official: Option<OfficialInput>,
    /// For `agentSettings`, with `agent`: replaces that agent kind's machine defaults.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_settings: Option<AgentSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub set_default: Option<bool>,
}

/// The official login's extras; absent fields keep what is stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfficialInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<std::collections::BTreeMap<String, String>>,
    /// Empty = direct; the masked one from the view = unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy: Option<String>,
    /// Claude Code command-line arguments, one per line; absent = unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvidersResult {
    pub request_id: String,
    pub ok: bool,
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<StoreView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presets: Option<Vec<Preset>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog: Option<AgentCatalog>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// A (group, bot) whose session keeps another provider than a new session would use; names only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStateItem {
    pub group_id: String,
    pub bot_id: String,
    pub session: String,
    pub effective: String,
}

// ── Force sync (docs/archive/2026-11/强制同步-开发计划.md) ──────────────────────────────
pub const SYNC_FILE_MAX_BYTES: u64 = 50 * 1024 * 1024;

pub const SYNC_VERSION_MAX_BYTES: u64 = 200 * 1024 * 1024;

pub const SYNC_CHANGED_MAX: usize = 20;

pub const SYNC_FILES_MAX: usize = 50;

pub const SYNC_MISSING_MAX: usize = 1000;

pub const SYNC_SUBMIT_CHANGES_MAX: usize = 200_000;
