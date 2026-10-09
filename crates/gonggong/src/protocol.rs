//! Wire types mirrored from `packages/protocol/src/{common,daemon}.ts`.
//! `tests/contract.rs` round-trips every shared JSON fixture to keep both sides aligned.
pub use crate::ccswitch::CandidateView;
pub use crate::config::Mirror;
pub use crate::providers::{ModelMap, Preset, StoreView};
pub use crate::tools::{ToolKind, ToolStatus as ToolState};
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;

/// A translatable text (`I18nText`): the Chinese source template and its params, rendered in each viewer's language.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct I18nText {
    pub key: String,
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub params: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Claude,
    Codex,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Tier {
    Full,
    Workspace,
    ReadOnly,
}

/// 命令审批: what happens to permission requests beyond the bot's tier; set by the bot owner on the Web (plan J8).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Approval {
    /// 每次询问: every request goes to the bot owner.
    #[default]
    Ask,
    /// 白名单自动: commands starting with an allowlisted prefix are approved here.
    Allowlist,
    /// 全部自动: every request is approved here.
    All,
}

impl Approval {
    pub fn label(self) -> &'static str {
        match self {
            Approval::Ask => crate::t!("每次询问"),
            Approval::Allowlist => crate::t!("白名单自动"),
            Approval::All => crate::t!("全部自动"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Queued,
    OfflineWait,
    Forbidden,
    Running,
    AwaitingApproval,
    AwaitingAnswer,
    Completed,
    Interrupted,
    Expired,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
}

/// Context window occupancy of an ACP session (usage_update).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextUsage {
    pub used: u64,
    pub size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceKind {
    Managed,
    Cd,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub dirty: bool,
    pub workspace: WorkspaceKind,
    /// Submodules and nested repos (not the root), outermost first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub repos: Vec<RepoStatus>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepoKind {
    Root,
    Submodule,
    Nested,
}

/// Git state of a non-root repo; `path` is relative to the workspace root.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepoStatus {
    pub path: String,
    pub kind: RepoKind,
    pub branch: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub dirty: bool,
}

/// One repo's share of a workspace patch ('' = the root repo).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiffRepo {
    pub path: String,
    pub kind: RepoKind,
    pub branch: Option<String>,
    /// Main branch this repo is compared against; None when on it or the scope has no base.
    pub base: Option<String>,
    /// The patch hit its size cap before (all of) this repo's changes.
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Choice {
    pub value: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// A model and the thought levels it offers (they depend on the model in both adapters).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelChoice {
    #[serde(flatten)]
    pub choice: Choice,
    pub efforts: Vec<Choice>,
    /// The thought level the model starts with.
    pub effort: Option<String>,
}

/// What an adapter offers, without its "default" rows: `None` model/effort already means the adapter's default.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentCatalog {
    pub models: Vec<ModelChoice>,
    /// The model a fresh session starts with; `None` = the adapter's unnamed default.
    pub current: Option<String>,
    /// Thought levels of that model and the one it starts with.
    pub efforts: Vec<Choice>,
    pub effort: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub os_version: Option<String>,
    pub kernel: Option<String>,
    pub cpu_model: Option<String>,
    pub cpu_cores: Option<u32>,
    pub memory_bytes: Option<u64>,
    pub mac_address: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineInfo {
    pub name: String,
    pub os: String,
    pub arch: String,
    #[serde(default)]
    pub hardware_id: Option<String>,
    #[serde(default)]
    pub system: Option<SystemInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DaemonLoginReq {
    pub code: String,
    pub machine: MachineInfo,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonLoginRes {
    pub token: String,
    pub machine_id: String,
    pub owner_name: String,
    #[serde(default)]
    pub restored: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub mime: String,
    pub message_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextMessage {
    pub seq: u64,
    pub author: String,
    /// "user" | "bot"
    pub kind: String,
    pub body: String,
    pub at: String,
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "transport", rename_all = "lowercase")]
pub enum McpServer {
    Stdio { name: String, command: String, args: Vec<String>, env: std::collections::BTreeMap<String, String> },
    Http { name: String, url: String, headers: std::collections::BTreeMap<String, String> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Quote {
    pub author: String,
    pub body: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuestionType {
    Single,
    Multi,
    Yesno,
    Text,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Question {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: QuestionType,
    pub title: String,
    pub options: Vec<String>,
    pub recommended: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub question_id: String,
    pub choices: Vec<u32>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentCommand {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub dir: bool,
    pub uncommitted: bool,
}

/// One entry of a files.tree listing (mtime in ms since epoch).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TreeEntry {
    pub name: String,
    pub dir: bool,
    pub size: u64,
    pub mtime: u64,
    pub uncommitted: bool,
    pub ignored: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub git: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DirGit {
    pub root: String,
    pub remotes: Vec<String>,
    pub branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirResult {
    pub request_id: String,
    pub path: String,
    pub entries: Vec<DirEntry>,
    pub git: Option<DirGit>,
    pub unusable: Option<String>,
    #[serde(default)]
    pub roots: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunBot {
    pub id: String,
    pub name: String,
    pub agent_kind: AgentKind,
    pub system_prompt: String,
    pub tier: Tier,
    /// Resolved by the server; `None` = the adapter's default.
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub approval: Approval,
    /// Command prefixes auto-approved in `allowlist` mode, e.g. `go build`.
    #[serde(default)]
    pub allowlist: Vec<String>,
    /// Rules the owner chose 始终允许 for, applied in `ask` and `allowlist` mode: command prefixes or `tool:<title>`.
    #[serde(default)]
    pub always_allow: Vec<String>,
    /// Author and committer of the agent's git commits; `None` = the machine's git config.
    #[serde(default)]
    pub git: Option<GitIdentity>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitIdentity {
    pub name: String,
    pub email: String,
}

/// The bot owner's preferred protocol: tried first, then the other one (ssh ↔ https).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitProtocol {
    #[default]
    Auto,
    Ssh,
    Https,
}

/// Why the machine cannot use a repo; git cannot tell "no access" from "no such repo", both are `Denied`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepoAccessReason {
    Denied,
    BranchMissing,
    Network,
    Timeout,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepoSpec {
    pub id: String,
    pub url: String,
    pub branch: String,
    #[serde(default)]
    pub protocol: GitProtocol,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoProbe {
    pub request_id: String,
    pub url: String,
    pub branch: String,
    pub protocol: GitProtocol,
}

pub const REPO_BRANCHES_MAX: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoProbeResult {
    pub request_id: String,
    pub ok: bool,
    pub reason: Option<RepoAccessReason>,
    pub used_url: Option<String>,
    pub default_branch: Option<String>,
    pub branches: Vec<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSpec {
    pub repo: Option<RepoSpec>,
    pub cd_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesList {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    pub query: String,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesTree {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    pub path: String,
    pub show_ignored: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesRead {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    pub path: String,
    pub max_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffScope {
    Turn,
    Uncommitted,
    Base,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiff {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    pub scope: DiffScope,
    pub run_id: Option<String>,
}

/// Response of `POST /api/daemon/runs/:runId/tools/:name` (an gonggong MCP tool answered by the server).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRes {
    pub text: String,
    pub is_error: bool,
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPrompt {
    pub text: String,
    pub triggered_by: String,
    pub context: Vec<ContextMessage>,
    /// Messages since the last @ left out of `context`; the agent reads them with the gonggong tools.
    #[serde(default)]
    pub omitted: u32,
    pub fallback_context: Vec<ContextMessage>,
    pub attachments: Vec<Attachment>,
    pub quote: Option<Quote>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStart {
    pub run_id: String,
    pub group_id: String,
    #[serde(default)]
    pub group_name: String,
    pub bot: RunBot,
    pub workspace: WorkspaceSpec,
    pub resume_session_id: Option<String>,
    pub new_session_reason: Option<String>,
    pub prompt: RunPrompt,
    pub mcp_servers: Vec<McpServer>,
    /// An agent command sent verbatim as the prompt instead of the composed group context.
    #[serde(default)]
    pub command: Option<String>,
    /// Force groups only.
    #[serde(default)]
    pub sync: Option<RunSyncStart>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

/// An MCP tool call: its server and tool, arguments as compact JSON and the head of its result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpCall {
    pub server: String,
    pub tool: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunEvent {
    Status {
        status: RunStatus,
        step: String,
    },
    #[serde(rename_all = "camelCase")]
    Text {
        delta: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Thought {
        delta: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Tool {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent_id: Option<String>,
        tool_call_id: String,
        title: String,
        tool_kind: String,
        status: ToolStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mcp: Option<McpCall>,
    },
    Usage {
        usage: Usage,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        context: Option<ContextUsage>,
    },
    #[serde(rename_all = "camelCase")]
    Subagent {
        agent_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        parent_id: Option<String>,
        name: String,
        task: String,
        state: SubagentState,
    },
    #[serde(rename_all = "camelCase")]
    Task {
        task_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_call_id: Option<String>,
        name: String,
        task_type: String,
        state: TaskState,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        output_path: Option<String>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        can_stop: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SubagentState {
    Running,
    Completed,
    Failed,
    Cancelled,
    Disconnected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskState {
    Running,
    Paused,
    Completed,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunOutcome {
    Completed,
    Interrupted,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDone {
    pub run_id: String,
    pub outcome: RunOutcome,
    pub reply: String,
    pub files_changed: u32,
    pub usage: Option<Usage>,
    pub session_id: Option<String>,
    pub new_session_reason: Option<String>,
    pub error: Option<String>,
    pub git: Option<GitStatus>,
    pub patch: Option<String>,
    /// The repos `patch` spans, root first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub repos: Vec<DiffRepo>,
    pub appends_applied: u32,
    /// Force groups only.
    #[serde(default)]
    pub sync: Option<RunSyncDone>,
}

pub const PATCH_MAX_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub option_id: String,
    pub name: String,
    pub kind: PermissionKind,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub run_id: String,
    pub request_id: String,
    pub title: String,
    pub tool_kind: String,
    pub detail: String,
    pub options: Vec<PermissionOption>,
    /// Rules an allow_always answer adds to the bot's `always_allow`; empty → don't offer it.
    #[serde(default)]
    pub remember: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceStateKind {
    Cloning,
    Ready,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    pub group_id: String,
    pub bot_id: String,
    pub request_id: Option<String>,
    pub state: WorkspaceStateKind,
    pub path: Option<String>,
    pub git: Option<GitStatus>,
    pub error: Option<String>,
    #[serde(default)]
    pub reason: Option<RepoAccessReason>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub remotes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEnsure {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub repo: Option<RepoSpec>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCd {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub repo: Option<RepoSpec>,
    pub path: Option<String>,
    /// The owner confirmed `path` although it is not a work tree of `repo`.
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceStatus {
    Starting,
    Running,
    Exited,
    Failed,
}

/// A process hosted for a (group, bot) workspace by the built-in `service_start` tool.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    pub id: String,
    pub group_id: String,
    pub bot_id: String,
    pub run_id: Option<String>,
    pub name: String,
    pub command: String,
    pub cwd: String,
    pub port: Option<u16>,
    pub status: ServiceStatus,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PreviewPort {
    pub id: String,
    pub port: u16,
}

/// A window gg-cast publishes for a watched live preview.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CastTarget {
    pub preview_id: String,
    #[serde(flatten)]
    pub source: CastSource,
    /// Changes while it runs: the running gg-cast is told, not restarted.
    #[serde(default = "default_fps")]
    pub fps: u32,
}

fn default_fps() -> u32 {
    30
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CastSource {
    /// A hosted service's id: its process tree's largest window.
    Service { service: String },
    /// A mini program project's absolute dir: its simulator in the machine's WeChat devtools.
    Miniprogram { miniprogram: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CastPhase {
    Starting,
    Live,
    Failed,
}

/// What the machine owner must do in the WeChat devtools before a mini program shows (`wechatide::Error::blocker`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DevtoolsBlocker {
    Port,
    Auth,
    Trust,
}

/// macOS privacy permissions the desktop previews need; see `permission.rs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    ScreenRecording,
    Accessibility,
}

/// Ordered name/value pairs so repeated headers (set-cookie) survive.
pub type TunnelHeaders = Vec<(String, String)>;

/// JSON payload of a tunnel `open` frame (see `tunnel.rs`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelOpen {
    #[serde(flatten)]
    pub target: TunnelTarget,
    pub method: String,
    pub path: String,
    pub headers: TunnelHeaders,
    pub upgrade: bool,
}

/// Where a tunnel stream goes: an open preview's loopback port, the read-only files of a (group, bot) workspace, or a
/// first-screen PNG of an open preview.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TunnelTarget {
    #[serde(rename_all = "camelCase")]
    Preview {
        preview_id: String,
        port: u16,
    },
    Files {
        files: WorkspaceFiles,
    },
    Snapshot {
        snapshot: SnapshotTarget,
    },
}

/// A web page on an open preview's port (headless Chrome), or a mini program project's simulator (WeChat devtools).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SnapshotTarget {
    #[serde(rename_all = "camelCase")]
    Page { preview_id: String, port: u16 },
    #[serde(rename_all = "camelCase")]
    Miniprogram {
        preview_id: String,
        miniprogram: String,
        /// `Some(false)`: devtools not running stay closed (a background retake).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        launch: Option<bool>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFiles {
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TunnelHead {
    pub status: u16,
    pub headers: TunnelHeaders,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TunnelReset {
    pub reason: String,
}

pub const FEATURE_TOOLS: &str = "tools";
pub const FEATURE_PROVIDERS: &str = "providers";
pub const FEATURE_CC_SWITCH: &str = "ccSwitch";
pub const FEATURE_SYNC: &str = "sync";

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
}

/// Adds (no `id`) or edits a provider; absent fields keep the stored (or preset) value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub agent: AgentKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub models: Option<ModelMap>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<std::collections::BTreeMap<String, String>>,
    /// Empty = direct; the masked one from the view = unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<ProviderInput>,
    /// For `official`, with `agent`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub official: Option<OfficialInput>,
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

// ── Force sync (docs/plan/强制同步-开发计划.md) ──────────────────────────────
pub const SYNC_FILE_MAX_BYTES: u64 = 50 * 1024 * 1024;
pub const SYNC_VERSION_MAX_BYTES: u64 = 200 * 1024 * 1024;
pub const SYNC_CHANGED_MAX: usize = 20;
pub const SYNC_FILES_MAX: usize = 50;
pub const SYNC_MISSING_MAX: usize = 1000;
pub const SYNC_SUBMIT_CHANGES_MAX: usize = 200_000;

/// A path's state in a version: `hash` (sha256 hex) `None` = deleted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncEntry {
    pub path: String,
    pub hash: Option<String>,
    pub exec: bool,
}

/// `base_hash`: the path's hash at the replica's base version, `None` = it did not exist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncChange {
    pub path: String,
    pub hash: Option<String>,
    pub exec: bool,
    pub base_hash: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncSubmitKind {
    Init,
    Run,
    Local,
    Interrupted,
    Merge,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSubmit {
    pub group_id: String,
    pub bot_id: String,
    pub submit_id: String,
    pub run_id: Option<String>,
    pub base_version: u64,
    pub kind: SyncSubmitKind,
    pub merged: bool,
    pub changes: Vec<SyncChange>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncReplicaIssue {
    Drift,
    Held,
    Dirty,
    Error,
    Lost,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncRejectReason {
    BlobsMissing,
    TooLarge,
    NotParticipating,
    BadBase,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum SyncSubmitResult {
    Accepted {
        version: u64,
    },
    #[serde(rename_all = "camelCase")]
    Conflict {
        head_version: u64,
        conflicts: Vec<SyncEntry>,
    },
    Rejected {
        reason: SyncRejectReason,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncChoice {
    Mine,
    Theirs,
    Bot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncDecision {
    pub path: String,
    pub choice: SyncChoice,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DriftChoice {
    Submit,
    Discard,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SyncActionKind {
    Drift { choice: DriftChoice },
    Conflict { decisions: Vec<SyncDecision> },
    Discard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncRole {
    Base,
    Align,
    Leave,
}

/// run.start in a force group: catch up to `head_version` first; `changed` since this bot's last turn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSyncStart {
    pub head_version: u64,
    pub last_version: Option<u64>,
    pub changed: Vec<String>,
    pub changed_total: u32,
    /// A merge turn: the held change's decisions, applied before the turn; its submit is kind `merge`.
    #[serde(default)]
    pub resolve: Option<Vec<SyncDecision>>,
}

/// Why a turn did not start: the replica waits for its local edits or held conflict to be settled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncWaitIssue {
    Drift,
    Held,
}

/// How a force-group turn's submit settled before run.done.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "lowercase")]
pub enum RunSyncDone {
    Accepted {
        version: u64,
        merged: bool,
    },
    Unchanged {
        version: u64,
    },
    Held {
        files: u32,
    },
    Error {
        reason: String,
        #[serde(rename = "reasonI18n", default)]
        reason_i18n: Option<I18nText>,
    },
    Waiting {
        issue: SyncWaitIssue,
    },
    /// /stop left `files` changed and unsubmitted (F21): kept or discarded by the initiator.
    Stopped {
        files: u32,
    },
}

/// Response of `POST /api/daemon/sync/:groupId/blobs/missing`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncMissingRes {
    pub missing: Vec<String>,
}

/// Response of `GET /api/daemon/sync/:groupId/changes?from=N`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncChangesRes {
    pub head_version: u64,
    pub entries: Vec<SyncEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t")]
pub enum DaemonToServer {
    #[serde(rename = "hello", rename_all = "camelCase")]
    Hello {
        protocol: u32,
        token: String,
        daemon_version: String,
        machine: MachineInfo,
        agents: Vec<AgentInfo>,
        #[serde(default)]
        active_runs: Vec<String>,
        #[serde(default)]
        services: Vec<ServiceInfo>,
        /// Optional capabilities: [`FEATURE_TOOLS`], [`FEATURE_PROVIDERS`], [`FEATURE_CC_SWITCH`], [`FEATURE_SYNC`].
        #[serde(default)]
        features: Vec<String>,
    },
    #[serde(rename = "heartbeat")]
    Heartbeat,
    #[serde(rename = "run.event", rename_all = "camelCase")]
    RunEvent { run_id: String, event: RunEvent },
    #[serde(rename = "run.done")]
    RunDone(RunDone),
    #[serde(rename = "workspace.state")]
    WorkspaceState(WorkspaceState),
    #[serde(rename = "approval.request")]
    ApprovalRequest(ApprovalRequest),
    #[serde(rename = "agents.update")]
    AgentsUpdate { agents: Vec<AgentInfo> },
    #[serde(rename = "commands.update", rename_all = "camelCase")]
    CommandsUpdate { group_id: String, bot_id: String, commands: Vec<AgentCommand> },
    #[serde(rename = "dir.result")]
    DirResult(DirResult),
    #[serde(rename = "files.result", rename_all = "camelCase")]
    FilesResult { request_id: String, entries: Vec<FileEntry>, error: Option<String> },
    #[serde(rename = "files.tree.result", rename_all = "camelCase")]
    FilesTreeResult { request_id: String, entries: Vec<TreeEntry>, truncated: bool, error: Option<String> },
    #[serde(rename = "files.read.result", rename_all = "camelCase")]
    FilesReadResult {
        request_id: String,
        size: u64,
        binary: bool,
        mime: String,
        text: Option<String>,
        error: Option<String>,
    },
    #[serde(rename = "workspace.diff.result", rename_all = "camelCase")]
    WorkspaceDiffResult {
        request_id: String,
        patch: Option<String>,
        base: Option<String>,
        branch: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        repos: Vec<DiffRepo>,
        error: Option<String>,
    },
    #[serde(rename = "question.ask", rename_all = "camelCase")]
    QuestionAsk { run_id: String, request_id: String, questions: Vec<Question> },
    #[serde(rename = "question.withdraw", rename_all = "camelCase")]
    QuestionWithdraw { run_id: String, request_id: String },
    #[serde(rename = "run.discarded", rename_all = "camelCase")]
    RunDiscarded { run_id: String, ok: bool, files: u32, error: Option<String> },
    #[serde(rename = "session.config", rename_all = "camelCase")]
    SessionConfig { run_id: String, model: Option<String>, effort: Option<String> },
    #[serde(rename = "repo.probe.result")]
    RepoProbeResult(RepoProbeResult),
    #[serde(rename = "service.state")]
    ServiceState { service: ServiceInfo },
    #[serde(rename = "service.restart.result", rename_all = "camelCase")]
    ServiceRestartResult { request_id: String, error: Option<String> },
    #[serde(rename = "cast.state", rename_all = "camelCase")]
    CastState {
        preview_id: String,
        state: CastPhase,
        error: Option<String>,
        #[serde(default)]
        missing: Vec<Permission>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        devtools: Option<DevtoolsBlocker>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        retry_in: Option<u64>,
    },
    #[serde(rename = "tools.progress", rename_all = "camelCase")]
    ToolsProgress { request_id: String, line: String },
    #[serde(rename = "tools.result", rename_all = "camelCase")]
    ToolsResult { request_id: String, ok: bool, error: Option<String>, tools: Vec<ToolState>, settings: ToolsSettings },
    #[serde(rename = "providers.result")]
    ProvidersResult(ProvidersResult),
    #[serde(rename = "ccswitch.result", rename_all = "camelCase")]
    CcSwitchResult {
        request_id: String,
        ok: bool,
        error: Option<String>,
        candidates: Vec<CandidateView>,
        imported: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        view: Option<StoreView>,
    },
    #[serde(rename = "bots.providerState")]
    BotsProviderState { items: Vec<ProviderStateItem> },
    #[serde(rename = "sync.submit")]
    SyncSubmit(SyncSubmit),
    #[serde(rename = "sync.applied", rename_all = "camelCase")]
    SyncApplied { group_id: String, bot_id: String, version: u64, root_hash: String },
    #[serde(rename = "sync.state", rename_all = "camelCase")]
    SyncState {
        group_id: String,
        bot_id: String,
        state: SyncReplicaIssue,
        files: Vec<String>,
        total: u32,
        reason: Option<String>,
        #[serde(default)]
        reason_i18n: Option<I18nText>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpgradeInfo {
    pub version: String,
    pub url: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RejectReason {
    Protocol,
    Revoked,
    Unauthorized,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t")]
pub enum ServerToDaemon {
    #[serde(rename = "welcome", rename_all = "camelCase")]
    Welcome {
        machine_id: String,
        heartbeat_sec: u64,
        upgrade: Option<UpgradeInfo>,
        #[serde(default)]
        tunnel: bool,
        /// The server publishes a build for this platform: upgrades come from it only, never from GitHub.
        #[serde(default)]
        release: bool,
    },
    #[serde(rename = "reject", rename_all = "camelCase")]
    Reject {
        reason: RejectReason,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        min_protocol: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        upgrade: Option<UpgradeInfo>,
    },
    #[serde(rename = "run.start")]
    RunStart(Box<RunStart>),
    #[serde(rename = "run.cancel", rename_all = "camelCase")]
    RunCancel { run_id: String },
    #[serde(rename = "task.stop", rename_all = "camelCase")]
    TaskStop { run_id: String, task_id: String },
    #[serde(rename = "run.tier", rename_all = "camelCase")]
    RunTier { run_id: String, tier: Tier },
    #[serde(rename = "workspace.ensure")]
    WorkspaceEnsure(WorkspaceEnsure),
    #[serde(rename = "workspace.cd")]
    WorkspaceCd(WorkspaceCd),
    #[serde(rename = "approval.decision", rename_all = "camelCase")]
    ApprovalDecision { run_id: String, request_id: String, option_id: Option<String> },
    #[serde(rename = "run.discard", rename_all = "camelCase")]
    RunDiscard { run_id: String },
    #[serde(rename = "files.list")]
    FilesList(FilesList),
    #[serde(rename = "files.tree")]
    FilesTree(FilesTree),
    #[serde(rename = "files.read")]
    FilesRead(FilesRead),
    #[serde(rename = "workspace.diff")]
    WorkspaceDiff(WorkspaceDiff),
    #[serde(rename = "dir.list", rename_all = "camelCase")]
    DirList { request_id: String, path: Option<String> },
    #[serde(rename = "question.answer", rename_all = "camelCase")]
    QuestionAnswer {
        run_id: String,
        request_id: String,
        answers: Option<Vec<Answer>>,
        attachments: Vec<Attachment>,
        answered_by: Option<String>,
    },
    #[serde(rename = "run.append", rename_all = "camelCase")]
    RunAppend { run_id: String, text: String, from: String, attachments: Vec<Attachment> },
    #[serde(rename = "repo.probe")]
    RepoProbe(RepoProbe),
    #[serde(rename = "service.stop", rename_all = "camelCase")]
    ServiceStop { service_id: String },
    #[serde(rename = "service.restart", rename_all = "camelCase")]
    ServiceRestart { request_id: String, service_id: String },
    #[serde(rename = "previews.sync")]
    PreviewsSync { previews: Vec<PreviewPort> },
    #[serde(rename = "cast.sync")]
    CastSync { casts: Vec<CastTarget> },
    #[serde(rename = "cast.retry", rename_all = "camelCase")]
    CastRetry { preview_id: String },
    #[serde(rename = "tools.cmd")]
    ToolsCmd(ToolsCmd),
    #[serde(rename = "providers.cmd")]
    ProvidersCmd(Box<ProvidersCmd>),
    #[serde(rename = "ccswitch.read", rename_all = "camelCase")]
    CcSwitchRead { request_id: String },
    #[serde(rename = "ccswitch.apply", rename_all = "camelCase")]
    CcSwitchApply { request_id: String, keys: Vec<String>, set_default: bool },
    #[serde(rename = "sync.result", rename_all = "camelCase")]
    SyncResult { group_id: String, bot_id: String, submit_id: String, result: SyncSubmitResult },
    #[serde(rename = "sync.available", rename_all = "camelCase")]
    SyncAvailable { group_id: String, version: u64 },
    #[serde(rename = "sync.action", rename_all = "camelCase")]
    SyncAction { group_id: String, bot_id: String, action: SyncActionKind },
    #[serde(rename = "sync.init", rename_all = "camelCase")]
    SyncInit { group_id: String, bot_id: String, role: SyncRole, force: bool, repo_id: Option<String> },
}
