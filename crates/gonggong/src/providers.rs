//! Machine-local model providers (design §4.2/§4.3, v2 in docs/plan/Agent管理重构-施工设计.md §3): vendors with an
//! endpoint per API protocol and their keys in `<home>/providers.json` (0600), the machine default (and model) per
//! agent, per-bot overrides and the provider each ACP session was started with. Never sent anywhere unmasked: whatever
//! leaves the machine goes through [`Store::view`].
use crate::agent_settings::{self, AgentSettings, CliSettingsSnapshot};
use crate::claude_args::ClaudeArgs;
use crate::protocol::{AgentKind, ApiProtocol};
use crate::t;
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The CLI's own login and user-level config: nothing is injected.
pub const OFFICIAL: &str = "official";
/// A bot without an override follows the machine default.
pub const INHERIT: &str = "inherit";
pub const OFFICIAL_NAME: &str = "官方登录";
pub const AUTH_TOKEN: &str = "ANTHROPIC_AUTH_TOKEN";
pub const API_KEY: &str = "ANTHROPIC_API_KEY";
pub const WIRE_RESPONSES: &str = "responses";
/// Google's own Gemini endpoint: there Gemini CLI uses its plain API-key login instead of a gateway.
pub const GOOGLE_GEMINI_URL: &str = "https://generativelanguage.googleapis.com";
/// The `version` of the current providers.json layout; files without one are v1 ([`crate::providers_migrate`]).
pub const VERSION: u32 = 2;
/// Session pins kept per (group, bot) however old: only its current session is resumed.
const PINS_KEPT: usize = 5;
/// Younger pins are kept anyway.
const PIN_TTL_MS: i64 = 30 * 24 * 3600 * 1000;

mod presets;
#[cfg(test)]
use presets::{OVERLAY, OVERLAY_FILE, merged};
pub use presets::{
    ModelMap, Preset, PresetEndpoint, PresetGroup, load_overlay, preset, presets, presets_source, set_overlay,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceKind {
    CcSwitch,
    Link,
}

/// Where an imported provider came from; CC Switch ids let a re-import update it instead of duplicating it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Source {
    pub kind: SourceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// What a provider serves on one protocol.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub protocol: ApiProtocol,
    /// Empty for a local Claude profile.
    #[serde(default)]
    pub base_url: String,
    /// Anthropic only: which variable carries the key ([`AUTH_TOKEN`] or [`API_KEY`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub models: Option<ModelMap>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    /// Claude Code command-line arguments as typed, one per line ([`ClaudeArgs`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    /// OpenAI only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wire_api: Option<String>,
    /// OpenAI only: `model_reasoning_effort`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    /// A local Claude profile: its own `CLAUDE_CONFIG_DIR` (with its own login) instead of a URL and key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
}

impl Endpoint {
    pub fn new(protocol: ApiProtocol, base_url: String) -> Endpoint {
        Endpoint {
            protocol,
            base_url,
            api_key_field: (protocol == ApiProtocol::Anthropic).then(|| AUTH_TOKEN.into()),
            model: None,
            models: None,
            env: BTreeMap::new(),
            args: vec![],
            wire_api: (protocol == ApiProtocol::Openai).then(|| WIRE_RESPONSES.into()),
            effort: None,
            config_dir: None,
            executable_path: None,
        }
    }

    pub fn from_preset(e: &PresetEndpoint) -> Endpoint {
        Endpoint {
            model: e.model.clone(),
            models: e.models.clone(),
            env: e.env.clone(),
            api_key_field: e.api_key_field.clone(),
            wire_api: e.wire_api.clone(),
            effort: e.effort.clone(),
            ..Endpoint::new(e.protocol, e.base_url.clone())
        }
    }

    pub fn claude_profile(&self) -> Option<&Path> {
        self.config_dir.as_deref().map(Path::new)
    }

    /// A local Claude profile in the CLI's own default directory: started without `CLAUDE_CONFIG_DIR`, so the CLI
    /// still reads the user-level state kept beside it (`~/.claude.json`: user MCP servers, login).
    pub fn uses_default_dir(&self) -> bool {
        self.claude_profile().is_some_and(|d| same_dir(d, &crate::config::default_claude_dir()))
    }

    /// The parsed arguments; the stored lines were validated when saved.
    pub fn claude_args(&self) -> Result<ClaudeArgs> {
        ClaudeArgs::parse(&self.args)
    }

    pub fn same_url(&self, url: &str) -> bool {
        self.base_url.trim_end_matches('/') == url.trim_end_matches('/')
    }

    fn validate(&self, before: Option<&Endpoint>) -> Result<()> {
        if !self.args.is_empty() && self.protocol != ApiProtocol::Anthropic {
            bail!(t!("命令行参数仅支持 Claude Code"));
        }
        ClaudeArgs::parse(&self.args)?;
        match self.claude_profile() {
            Some(dir) if self.protocol != ApiProtocol::Anthropic || !dir.is_absolute() => {
                bail!(t!("Claude 配置目录必须是存在的绝对路径"))
            }
            Some(dir) if !dir.is_dir() => bail!(profile_missing(dir, &crate::config::default_claude_dir())),
            Some(_) if !self.base_url.is_empty() => {
                bail!(t!("本机 Claude 配置目录不能与 Base URL、API Key 或预设同时使用"))
            }
            Some(_) => {
                if let Some(exe) = &self.executable_path
                    && (!Path::new(exe).is_absolute() || !Path::new(exe).is_file())
                {
                    bail!(t!("Claude 可执行文件必须是存在的绝对路径"));
                }
            }
            None if self.executable_path.is_some() => bail!(t!("Claude 可执行文件只能与本机配置目录一起使用")),
            None if !(self.base_url.starts_with("https://") || self.base_url.starts_with("http://")) => {
                bail!(t!("Base URL 必须以 http:// 或 https:// 开头"))
            }
            None => {}
        }
        validate_env(protocol_agent(self.protocol), &self.env, before.map(|b| &b.env))
    }

    fn view(&self, preset: Option<&Preset>) -> EndpointView {
        EndpointView {
            protocol: self.protocol,
            base_url: self.base_url.clone(),
            api_key_field: self.api_key_field.clone(),
            wire_api: self.wire_api.clone(),
            model: self.model.clone(),
            models: self.models.clone(),
            effort: self.effort.clone(),
            env: mask_env(&self.env),
            args: self.args.clone(),
            config_dir: self.config_dir.clone(),
            executable_path: self.executable_path.clone(),
            model_options: preset.and_then(|p| p.endpoint(self.protocol)).map_or(vec![], |e| e.model_options.clone()),
        }
    }
}

/// The same directory however written: symlinks, a trailing separator, Windows case and `\\?\` prefixes.
pub fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        #[cfg(windows)]
        (Ok(a), Ok(b)) => a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase(),
        #[cfg(not(windows))]
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// Why a profile directory that does not exist cannot be used; the default one needs Claude Code run once first.
pub fn profile_missing(dir: &Path, default: &Path) -> String {
    match same_dir(dir, default) {
        true => t!(
            "默认 Claude 配置目录 {dir} 还不存在，请先在这台电脑上运行一次 Claude Code 完成登录或初始化",
            dir = dir.display()
        ),
        false => t!("Claude 配置目录不可用：{dir}", dir = dir.display()),
    }
}

/// The agent whose settings rules an endpoint's env follows.
pub fn protocol_agent(protocol: ApiProtocol) -> AgentKind {
    match protocol {
        ApiProtocol::Anthropic => AgentKind::Claude,
        ApiProtocol::Openai => AgentKind::Codex,
        ApiProtocol::Gemini => AgentKind::Gemini,
        ApiProtocol::Codebuddy => AgentKind::Codebuddy,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset_id: Option<String>,
    /// Bumped on every change so running adapters can tell they must restart.
    pub revision: u32,
    /// Empty for a local Claude profile.
    #[serde(default)]
    pub api_key: String,
    /// `http(s)://[user:pass@]host:port` the agent reaches the provider through; `None` = direct.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
    pub endpoints: Vec<Endpoint>,
}

impl Provider {
    /// A new provider (no id yet) with every endpoint of the preset; later preset updates never touch it.
    pub fn from_preset(preset: &Preset, api_key: String) -> Provider {
        Provider {
            preset_id: Some(preset.id.clone()),
            ..Provider::new(preset.name.clone(), api_key, preset.endpoints.iter().map(Endpoint::from_preset).collect())
        }
    }

    pub fn new(name: String, api_key: String, endpoints: Vec<Endpoint>) -> Provider {
        Provider {
            id: String::new(),
            name,
            preset_id: None,
            revision: 0,
            api_key,
            proxy: None,
            source: None,
            endpoints,
        }
    }

    /// One endpoint by hand.
    pub fn custom(protocol: ApiProtocol, name: String, base_url: String, api_key: String) -> Provider {
        Provider::new(name, api_key, vec![Endpoint::new(protocol, base_url)])
    }

    /// The endpoint `agent` runs on: the first whose protocol it takes (a local profile only for Claude Code).
    pub fn endpoint_for(&self, agent: AgentKind) -> Option<&Endpoint> {
        self.endpoints
            .iter()
            .find(|e| agent.takes(e.protocol) && (e.config_dir.is_none() || agent == AgentKind::Claude))
    }

    pub fn endpoint(&self, protocol: ApiProtocol) -> Option<&Endpoint> {
        self.endpoints.iter().find(|e| e.protocol == protocol)
    }

    pub fn endpoint_mut(&mut self, protocol: ApiProtocol) -> Option<&mut Endpoint> {
        self.endpoints.iter_mut().find(|e| e.protocol == protocol)
    }

    /// The preset's endpoint for `protocol`, if the provider came from one.
    pub fn preset_endpoint(&self, protocol: ApiProtocol) -> Option<PresetEndpoint> {
        preset(self.preset_id.as_deref()?)?.endpoint(protocol).cloned()
    }

    /// `before`: the stored version, whose unchanged setting values are not checked again.
    fn validate(&self, before: Option<&Provider>) -> Result<()> {
        if self.name.trim().is_empty() {
            bail!(t!("供应商名称不能为空"));
        }
        if self.endpoints.is_empty() {
            bail!(t!("供应商至少需要一种协议的端点"));
        }
        for (i, e) in self.endpoints.iter().enumerate() {
            if self.endpoints[..i].iter().any(|o| o.protocol == e.protocol) {
                bail!(t!("同一供应商的每种协议只能有一个端点"));
            }
            e.validate(before.and_then(|b| b.endpoint(e.protocol)))?;
        }
        let profile = self.endpoints.iter().any(|e| e.config_dir.is_some());
        if profile && (!self.api_key.is_empty() || self.preset_id.is_some() || self.endpoints.len() > 1) {
            bail!(t!("本机 Claude 配置目录不能与 Base URL、API Key 或预设同时使用"));
        }
        if !profile && self.api_key.trim().is_empty() {
            bail!(t!("API Key 不能为空"));
        }
        validate_proxy(self.proxy.as_deref())
    }

    /// The agent process's env for endpoint `e`: the proxy, then the endpoint's own variables.
    pub fn process_env(&self, e: &Endpoint) -> BTreeMap<String, String> {
        process_env(&e.env, self.proxy.as_deref())
    }

    pub fn view(&self) -> ProviderView {
        let preset = self.preset_id.as_deref().and_then(preset);
        ProviderView {
            id: self.id.clone(),
            name: self.name.clone(),
            preset_id: self.preset_id.clone(),
            revision: self.revision,
            api_key: mask_key(&self.api_key),
            proxy: self.proxy.as_deref().map(mask_proxy),
            source: self.source.clone(),
            endpoints: self.endpoints.iter().map(|e| e.view(preset.as_ref())).collect(),
        }
    }
}

/// The agent process's env as if exported in a terminal: the proxy (both cases, loopback direct so the agent still
/// reaches the daemon's local MCP endpoint), then the user's own variables.
fn process_env(vars: &BTreeMap<String, String>, proxy: Option<&str>) -> BTreeMap<String, String> {
    let mut env = vars.clone();
    if let Some(url) = proxy {
        for k in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] {
            env.entry(k.into()).or_insert_with(|| url.into());
        }
        let user = vars.get("NO_PROXY").or(vars.get("no_proxy"));
        let bypass = ["localhost", "127.0.0.1", "::1"].into_iter().chain(user.map(String::as_str)).collect::<Vec<_>>();
        env.insert("NO_PROXY".into(), bypass.join(","));
        env.insert("no_proxy".into(), bypass.join(","));
    }
    env
}

fn validate_args(agent: AgentKind, args: &[String]) -> Result<()> {
    if !args.is_empty() && agent != AgentKind::Claude {
        bail!(t!("命令行参数仅支持 Claude Code"));
    }
    ClaudeArgs::parse(args).map(drop)
}

fn validate_env(
    agent: AgentKind,
    env: &BTreeMap<String, String>,
    before: Option<&BTreeMap<String, String>>,
) -> Result<()> {
    if let Some(k) = env.keys().find(|k| !env_name(k)) {
        bail!(t!("环境变量名不合法：{name}", name = k));
    }
    agent_settings::validate_env(agent, env, before)
}

fn validate_proxy(proxy: Option<&str>) -> Result<()> {
    if proxy.is_some_and(|u| !(u.starts_with("http://") || u.starts_with("https://"))) {
        bail!(t!("代理地址必须以 http:// 或 https:// 开头"));
    }
    Ok(())
}

/// What an agent's official login runs with besides the CLI's own config: extra variables and a proxy.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Official {
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<String>,
    /// Claude Code command-line arguments as typed, one per line ([`ClaudeArgs`]).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
}

impl Official {
    pub fn is_empty(&self) -> bool {
        self.env.is_empty() && self.proxy.is_none() && self.args.is_empty()
    }

    /// The parsed arguments; the stored lines were validated when saved.
    pub fn claude_args(&self) -> Result<ClaudeArgs> {
        ClaudeArgs::parse(&self.args)
    }

    pub fn process_env(&self) -> BTreeMap<String, String> {
        process_env(&self.env, self.proxy.as_deref())
    }

    /// Password masked, as for a provider.
    pub fn view(&self) -> OfficialView {
        OfficialView { env: mask_env(&self.env), proxy: self.proxy.as_deref().map(mask_proxy), args: self.args.clone() }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfficialView {
    pub env: BTreeMap<String, String>,
    pub proxy: Option<String>,
    pub args: Vec<String>,
}

/// Keys leave the machine as their last 4 characters at most; short ones not at all.
pub fn mask_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 8 {
        return "****".into();
    }
    format!("****{}", chars[chars.len() - 4..].iter().collect::<String>())
}

/// Secret-looking variables ([`agent_settings::secret_env`]) masked like the key.
pub fn mask_env(env: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    env.iter().map(|(k, v)| (k.clone(), if agent_settings::secret_env(k) { mask_key(v) } else { v.clone() })).collect()
}

/// `input` as sent back from a view: a secret variable still carrying its masked value keeps the stored one.
pub fn unmask_env(input: BTreeMap<String, String>, stored: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    input
        .into_iter()
        .map(|(k, v)| match stored.get(&k) {
            Some(old) if agent_settings::secret_env(&k) && v == mask_key(old) => (k, old.clone()),
            _ => (k, v),
        })
        .collect()
}

pub fn env_name(k: &str) -> bool {
    k.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// A proxy leaves the machine with its password masked.
pub fn mask_proxy(proxy: &str) -> String {
    match url::Url::parse(proxy) {
        Ok(mut u) if u.password().is_some() => {
            let _ = u.set_password(Some("****"));
            u.to_string().trim_end_matches('/').to_string()
        }
        _ => proxy.to_string(),
    }
}

/// The host (and explicit port) of a URL, what tells one vendor from another; the URL itself when unparsable.
pub fn host(url: &str) -> String {
    match url::Url::parse(url.trim()) {
        Ok(u) => match (u.host_str(), u.port()) {
            (Some(h), Some(p)) => format!("{}:{p}", h.to_ascii_lowercase()),
            (Some(h), None) => h.to_ascii_lowercase(),
            _ => url.trim().to_string(),
        },
        Err(_) => url.trim().trim_end_matches('/').to_string(),
    }
}

/// [`Endpoint`] with its secret variables masked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointView {
    pub protocol: ApiProtocol,
    pub base_url: String,
    pub api_key_field: Option<String>,
    pub wire_api: Option<String>,
    pub model: Option<String>,
    pub models: Option<ModelMap>,
    pub effort: Option<String>,
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub config_dir: Option<String>,
    #[serde(default)]
    pub executable_path: Option<String>,
    /// The preset's model list for this protocol, if it came from one.
    #[serde(default)]
    pub model_options: Vec<String>,
}

/// [`Provider`] without the key, for the server, the Web and the logs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    pub id: String,
    pub name: String,
    pub preset_id: Option<String>,
    pub revision: u32,
    pub api_key: String,
    pub proxy: Option<String>,
    pub source: Option<Source>,
    pub endpoints: Vec<EndpointView>,
}

/// A machine default: a provider id or [`OFFICIAL`], and the model (`None` = the endpoint's, else the adapter's).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentDefault {
    pub provider: String,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreView {
    pub machine: BTreeMap<AgentKind, AgentDefault>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub official: BTreeMap<AgentKind, OfficialView>,
    pub bots: BTreeMap<String, String>,
    pub providers: Vec<ProviderView>,
    /// Machine defaults per agent kind; absent = Claude Code's defaults, CLI config inherited.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub agent_settings: BTreeMap<AgentKind, AgentSettings>,
    /// The CLI's own user-level config per agent kind ([`Store::view_with_cli`]); absent = none found / not read.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub cli: BTreeMap<AgentKind, CliSettingsSnapshot>,
    /// Latest session of each (group, bot), so a switch can say which groups keep the old provider.
    pub sessions: Vec<SessionView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub group_id: String,
    pub bot_id: String,
    pub agent: AgentKind,
    /// A provider id or [`OFFICIAL`].
    pub provider: String,
}

/// The provider a new ACP session was started with; resuming it keeps using it (§4.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPin {
    /// A provider id or [`OFFICIAL`].
    pub provider: String,
    pub agent: AgentKind,
    pub group_id: String,
    pub bot_id: String,
    pub pinned_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selection {
    /// Carries the agent's [`Official`] extras so a change to them restarts the adapter like a provider edit.
    Official(Official),
    /// The provider and the endpoint the agent runs on ([`Provider::endpoint_for`]).
    Provider { provider: Box<Provider>, endpoint: Box<Endpoint> },
}

impl Selection {
    /// `p` for `agent`; None when no endpoint of it serves the agent.
    pub fn of(p: &Provider, agent: AgentKind) -> Option<Selection> {
        let endpoint = p.endpoint_for(agent)?.clone();
        Some(Selection::Provider { provider: Box::new(p.clone()), endpoint: Box::new(endpoint) })
    }

    /// What `machine`, `bots` and session pins store.
    pub fn key(&self) -> &str {
        match self {
            Selection::Official(_) => OFFICIAL,
            Selection::Provider { provider, .. } => &provider.id,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Selection::Official(_) => OFFICIAL_NAME,
            Selection::Provider { provider, .. } => &provider.name,
        }
    }

    pub fn provider(&self) -> Option<(&Provider, &Endpoint)> {
        match self {
            Selection::Official(_) => None,
            Selection::Provider { provider, endpoint } => Some((provider, endpoint)),
        }
    }

    pub fn claude_profile(&self) -> Option<&Path> {
        self.provider().and_then(|(_, e)| e.claude_profile())
    }

    /// The proxy and extra variables of the official login or the provider's endpoint.
    pub fn process_env(&self) -> BTreeMap<String, String> {
        match self {
            Selection::Official(o) => o.process_env(),
            Selection::Provider { provider, endpoint } => provider.process_env(endpoint),
        }
    }

    pub fn claude_args(&self) -> Result<ClaudeArgs> {
        match self {
            Selection::Official(o) => o.claude_args(),
            Selection::Provider { endpoint, .. } => endpoint.claude_args(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunPlan {
    /// Resume the session with the provider it was pinned to, whatever the settings say now.
    Resume(Selection),
    /// Start a new session with the effective provider (then [`Store::pin`] it). `provider_removed`: the session to
    /// resume was pinned to a provider that no longer exists or no longer serves the agent
    /// (`newSessionReason = 'provider_removed'`).
    New { selection: Selection, provider_removed: bool },
}

/// A (group, bot) whose current session uses another provider than a new session would.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stale {
    pub group_id: String,
    pub bot_id: String,
    pub session_id: String,
    pub session: String,
    pub effective: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Store {
    /// Machine default per agent; absent = official.
    pub machine: BTreeMap<AgentKind, AgentDefault>,
    /// Official login extras per agent; absent = none.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub official: BTreeMap<AgentKind, Official>,
    /// Per-bot override: a provider id or [`OFFICIAL`]; absent = inherit the machine default.
    pub bots: BTreeMap<String, String>,
    pub providers: Vec<Provider>,
    /// Machine defaults per agent kind; absent = defaults.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub agent_settings: BTreeMap<AgentKind, AgentSettings>,
    /// ACP session id → pin.
    pub sessions: BTreeMap<String, SessionPin>,
}

#[derive(Serialize)]
struct Versioned<'a> {
    version: u32,
    #[serde(flatten)]
    store: &'a Store,
}

impl Store {
    pub fn path(home: &Path) -> PathBuf {
        home.join("providers.json")
    }

    /// A v1 file is migrated in memory only ([`Store::migrate_file`] writes it).
    pub fn load(home: &Path) -> Result<Store> {
        match std::fs::read(Self::path(home)) {
            Ok(bytes) => Ok(crate::providers_migrate::parse(&bytes)?.0),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Store::default()),
            Err(e) => Err(e.into()),
        }
    }

    /// Upgrades a v1 providers.json to v2 in place, keeping the original byte for byte (D4); see
    /// [`crate::providers_migrate::load_migrated`]. None: already v2 (or no file).
    pub fn migrate_file(home: &Path) -> Result<Option<crate::providers_migrate::Report>> {
        let _lock = lock(home)?;
        Ok(crate::providers_migrate::load_migrated(home)?.1)
    }

    /// Atomic (temp file + rename) and owner-only from the first byte.
    pub fn save(&self, home: &Path) -> Result<()> {
        std::fs::create_dir_all(home)?;
        let path = Self::path(home);
        let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        // A leftover from a crashed write under a reused pid.
        let _ = std::fs::remove_file(&tmp);
        let written = (|| {
            let mut file = options.open(&tmp)?;
            file.write_all(&serde_json::to_vec_pretty(&Versioned { version: VERSION, store: self })?)?;
            file.sync_all()?;
            std::fs::rename(&tmp, &path)?;
            anyhow::Ok(())
        })();
        if written.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        written
    }

    /// Load, change and save under `<home>/providers.lock`, so the CLI, the desktop app and the daemon never lose
    /// each other's writes. A v1 file is backed up before it is first written over.
    pub fn update<T>(home: &Path, f: impl FnOnce(&mut Store) -> Result<T>) -> Result<T> {
        let _lock = lock(home)?;
        let mut store = crate::providers_migrate::load_migrated(home)?.0;
        let out = f(&mut store)?;
        store.save(home)?;
        Ok(out)
    }

    pub fn get(&self, id: &str) -> Option<&Provider> {
        self.providers.iter().find(|p| p.id == id)
    }

    fn get_for(&self, agent: AgentKind, id: &str) -> Result<Selection> {
        let p = self.get(id).with_context(|| t!("供应商 {id} 不存在", id = id))?;
        Selection::of(p, agent).with_context(|| {
            t!("供应商 {name} 没有 {agent} 能用的协议端点", name = p.name, agent = crate::bots::agent_label(agent))
        })
    }

    /// Stores a new provider under a fresh id (returned) at revision 1.
    pub fn add(&mut self, mut p: Provider) -> Result<String> {
        p.validate(None)?;
        let base = slug(p.preset_id.as_deref().unwrap_or(&p.name));
        p.id = loop {
            let id = format!("{base}-{}", &uuid::Uuid::new_v4().simple().to_string()[..4]);
            if self.get(&id).is_none() {
                break id;
            }
        };
        p.revision = 1;
        self.providers.push(p);
        Ok(self.providers.last().unwrap().id.clone())
    }

    /// Edits in place; the revision goes up when anything changed. Machine defaults the provider no longer serves
    /// fall back to official.
    pub fn edit(&mut self, id: &str, f: impl FnOnce(&mut Provider)) -> Result<()> {
        let p = self.providers.iter_mut().find(|p| p.id == id).with_context(|| t!("供应商 {id} 不存在", id = id))?;
        let mut next = p.clone();
        f(&mut next);
        next.validate(Some(p))?;
        if next != *p {
            next.revision = p.revision + 1;
            *p = next;
        }
        self.drop_unserved_defaults();
        Ok(())
    }

    fn drop_unserved_defaults(&mut self) {
        let served = |agent: &AgentKind, d: &AgentDefault| {
            d.provider == OFFICIAL || self.get(&d.provider).is_some_and(|p| p.endpoint_for(*agent).is_some())
        };
        let kept = self.machine.iter().filter(|(a, d)| served(a, d)).map(|(a, d)| (*a, d.clone())).collect();
        self.machine = kept;
    }

    /// Defaults and overrides pointing at it fall back (official / inherit); sessions pinned to it keep the id so
    /// [`Store::resolve_run`] reports it as removed.
    pub fn remove(&mut self, id: &str) -> Result<Provider> {
        let i = self.providers.iter().position(|p| p.id == id).with_context(|| t!("供应商 {id} 不存在", id = id))?;
        self.machine.retain(|_, d| d.provider != id);
        self.bots.retain(|_, v| v != id);
        Ok(self.providers.remove(i))
    }

    /// The stored provider a one-endpoint import `p` belongs to: the same CC Switch source serving its protocol, else
    /// the same key + Base URL + protocol, else the same key, host and proxy lacking that protocol (the vendor it adds
    /// an endpoint to).
    pub fn duplicate_of(&self, p: &Provider) -> Option<&Provider> {
        let e = p.endpoints.first()?;
        let same_source = |q: &&Provider| {
            p.source.as_ref().is_some_and(|s| s.id.is_some() && q.source.as_ref() == Some(s))
                && q.endpoint(e.protocol).is_some()
        };
        let same_endpoint = |q: &&Provider| {
            q.api_key == p.api_key
                && q.endpoint(e.protocol).is_some_and(|o| {
                    // Profiles sharing a directory differ by their own `--settings`.
                    o.config_dir == e.config_dir
                        && o.same_url(&e.base_url)
                        && (e.config_dir.is_none() || o.args == e.args)
                })
        };
        let same_vendor = |q: &&Provider| {
            e.config_dir.is_none()
                && q.api_key == p.api_key
                && q.proxy == p.proxy
                && q.endpoint(e.protocol).is_none()
                && q.endpoints.iter().all(|o| o.config_dir.is_none() && host(&o.base_url) == host(&e.base_url))
        };
        let find = |f: &dyn Fn(&&Provider) -> bool| self.providers.iter().find(f);
        find(&same_source).or_else(|| find(&same_endpoint)).or_else(|| find(&same_vendor))
    }

    /// Adds the one-endpoint `p`, or puts its endpoint into its [`Store::duplicate_of`] (replacing the one of that
    /// protocol); a provider of that endpoint alone also takes its name, source and proxy.
    pub fn upsert(&mut self, p: Provider) -> Result<String> {
        let Some(id) = self.duplicate_of(&p).map(|q| q.id.clone()) else { return self.add(p) };
        let Provider { name, api_key, proxy, source, endpoints, .. } = p;
        let endpoint = endpoints.into_iter().next().expect("duplicate_of takes one endpoint");
        self.edit(&id, |q| {
            match q.endpoint_mut(endpoint.protocol) {
                Some(e) => *e = endpoint,
                None => q.endpoints.push(endpoint),
            }
            q.api_key = api_key;
            if q.endpoints.len() == 1 {
                (q.name, q.proxy, q.source) = (name, proxy, source);
            }
        })?;
        Ok(id)
    }

    /// `choice`: a provider id serving this agent or [`OFFICIAL`]; `model` None = the endpoint's (else the
    /// adapter's) default.
    pub fn use_machine(&mut self, agent: AgentKind, choice: &str, model: Option<String>) -> Result<()> {
        if choice != OFFICIAL {
            self.get_for(agent, choice)?;
        }
        let model = model.map(|m| m.trim().to_string()).filter(|m| !m.is_empty());
        self.machine.insert(agent, AgentDefault { provider: choice.into(), model });
        Ok(())
    }

    /// `agent` is the bot's `agentKind`; `choice`: a provider id serving that agent, [`OFFICIAL`] or [`INHERIT`].
    pub fn use_bot(&mut self, bot_id: &str, agent: AgentKind, choice: &str) -> Result<()> {
        match choice {
            INHERIT => {
                self.bots.remove(bot_id);
                return Ok(());
            }
            OFFICIAL => {}
            id => {
                self.get_for(agent, id)?;
            }
        }
        self.bots.insert(bot_id.into(), choice.into());
        Ok(())
    }

    pub fn official(&self, agent: AgentKind) -> Official {
        self.official.get(&agent).cloned().unwrap_or_default()
    }

    pub fn set_official(&mut self, agent: AgentKind, official: Official) -> Result<()> {
        let before = self.official.get(&agent).map(|o| &o.env);
        validate_env(agent, &official.env, before)?;
        validate_proxy(official.proxy.as_deref())?;
        validate_args(agent, &official.args)?;
        if official.is_empty() {
            self.official.remove(&agent);
        } else {
            self.official.insert(agent, official);
        }
        Ok(())
    }

    pub fn agent_settings(&self, agent: AgentKind) -> AgentSettings {
        self.agent_settings.get(&agent).cloned().unwrap_or_default()
    }

    /// Replaces the machine defaults of `agent`; running sessions pick them up from their next turn.
    pub fn set_agent_settings(&mut self, agent: AgentKind, settings: AgentSettings) -> Result<()> {
        settings.validate(agent)?;
        if settings == AgentSettings::default() {
            self.agent_settings.remove(&agent);
        } else {
            self.agent_settings.insert(agent, settings);
        }
        Ok(())
    }

    fn select(&self, agent: AgentKind, key: &str) -> Result<Selection> {
        match key {
            OFFICIAL => Ok(Selection::Official(self.official(agent))),
            id => self.get_for(agent, id),
        }
    }

    pub fn machine_default(&self, agent: AgentKind) -> Result<Selection> {
        self.select(agent, self.machine.get(&agent).map_or(OFFICIAL, |d| d.provider.as_str()))
    }

    /// Bot override, else the machine default, else official.
    pub fn effective(&self, agent: AgentKind, bot_id: &str) -> Result<Selection> {
        match self.bots.get(bot_id) {
            Some(key) => self.select(agent, key),
            None => self.machine_default(agent),
        }
    }

    /// The machine default's model, for a bot that inherits the machine default and runs on it (`selection`: the
    /// run's provider id or [`OFFICIAL`]); the server's model (message, group, bot) comes first.
    pub fn inherited_model(&self, agent: AgentKind, bot_id: &str, selection: &str) -> Option<String> {
        let d = self.machine.get(&agent).filter(|d| d.provider == selection && !self.bots.contains_key(bot_id))?;
        d.model.clone()
    }

    /// Which provider a run uses. `resume`: the ACP session the run continues, if any.
    pub fn resolve_run(&self, agent: AgentKind, bot_id: &str, resume: Option<&str>) -> Result<RunPlan> {
        let Some(session) = resume else {
            return Ok(RunPlan::New { selection: self.effective(agent, bot_id)?, provider_removed: false });
        };
        Ok(match self.sessions.get(session).map(|pin| pin.provider.as_str()) {
            // Sessions started before providers existed ran on the official login.
            None | Some(OFFICIAL) => RunPlan::Resume(Selection::Official(self.official(agent))),
            Some(id) => match self.get(id).and_then(|p| Selection::of(p, agent)) {
                Some(selection) => RunPlan::Resume(selection),
                None => RunPlan::New { selection: self.effective(agent, bot_id)?, provider_removed: true },
            },
        })
    }

    /// Also drops the pins beyond the newest [`PINS_KEPT`] of each (group, bot) older than [`PIN_TTL_MS`]: the file is
    /// read every turn. Resuming a session whose pin is gone falls back to the official login.
    pub fn pin(&mut self, session_id: &str, agent: AgentKind, group_id: &str, bot_id: &str, selection: &Selection) {
        let now = chrono::Utc::now().timestamp_millis();
        let pin = SessionPin {
            provider: selection.key().into(),
            agent,
            group_id: group_id.into(),
            bot_id: bot_id.into(),
            pinned_at: now,
        };
        self.sessions.insert(session_id.into(), pin);
        let mut by_pair: BTreeMap<(&str, &str), Vec<(i64, &str)>> = BTreeMap::new();
        for (id, pin) in &self.sessions {
            by_pair.entry((&pin.group_id, &pin.bot_id)).or_default().push((pin.pinned_at, id));
        }
        let old: Vec<String> = by_pair
            .into_values()
            .flat_map(|mut pins| {
                pins.sort_unstable_by(|a, b| b.cmp(a));
                pins.into_iter().skip(PINS_KEPT).filter(|(at, _)| now - at > PIN_TTL_MS).map(|(_, id)| id.to_string())
            })
            .collect();
        for id in old {
            self.sessions.remove(&id);
        }
    }

    /// The latest session (id, pin) of each (group, bot).
    fn latest_sessions(&self) -> Vec<(&String, &SessionPin)> {
        let mut latest: BTreeMap<(&str, &str), (&String, &SessionPin)> = BTreeMap::new();
        for (id, pin) in &self.sessions {
            let slot = latest.entry((&pin.group_id, &pin.bot_id)).or_insert((id, pin));
            if pin.pinned_at > slot.1.pinned_at {
                *slot = (id, pin);
            }
        }
        latest.into_values().collect()
    }

    /// The latest session of each (group, bot) whose provider differs from what a new session would use. Sessions
    /// pinned to a removed provider (or one no longer serving the agent) are left out: their next run starts a new
    /// session anyway.
    pub fn stale(&self) -> Result<Vec<Stale>> {
        let mut out = vec![];
        for (id, pin) in self.latest_sessions() {
            let Ok(session) = self.select(pin.agent, &pin.provider) else { continue };
            let effective = self.effective(pin.agent, &pin.bot_id)?;
            if session.key() != effective.key() {
                out.push(Stale {
                    group_id: pin.group_id.clone(),
                    bot_id: pin.bot_id.clone(),
                    session_id: id.clone(),
                    session: session.name().into(),
                    effective: effective.name().into(),
                });
            }
        }
        Ok(out)
    }

    pub fn view(&self) -> StoreView {
        StoreView {
            machine: self.machine.clone(),
            official: self.official.iter().map(|(a, o)| (*a, o.view())).collect(),
            bots: self.bots.clone(),
            providers: self.providers.iter().map(Provider::view).collect(),
            agent_settings: self.agent_settings.clone(),
            cli: BTreeMap::new(),
            sessions: self
                .latest_sessions()
                .into_iter()
                .map(|(_, pin)| SessionView {
                    group_id: pin.group_id.clone(),
                    bot_id: pin.bot_id.clone(),
                    agent: pin.agent,
                    provider: pin.provider.clone(),
                })
                .collect(),
        }
    }

    /// [`Store::view`] with the CLI's own config: `home` is gonggong's (for the CLI version), `user_home` the one
    /// `~/.claude` lives in.
    pub fn view_with_cli(&self, home: &Path, user_home: &Path) -> StoreView {
        StoreView { cli: agent_settings::cli_snapshots(home, user_home), ..self.view() }
    }
}

/// `<home>/providers.lock`, held while reading, changing and writing providers.json.
fn lock(home: &Path) -> Result<std::fs::File> {
    std::fs::create_dir_all(home)?;
    let lock =
        std::fs::OpenOptions::new().write(true).create(true).truncate(false).open(home.join("providers.lock"))?;
    lock.lock()?;
    Ok(lock)
}

pub(crate) fn slug(s: &str) -> String {
    let slug: String = s
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() { "provider".into() } else { slug }
}

#[cfg(test)]
mod tests;
