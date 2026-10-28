//! Wire types mirrored from `packages/protocol/src/{common,daemon}.ts`.
//! `tests/contract.rs` round-trips every shared JSON fixture to keep both sides aligned.
pub use crate::agent_settings::{AgentSettings, CliSettingsSnapshot, RunSettingsSnapshot};
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
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    pub used: u64,
    pub size: u64,
    /// Tokens at which the agent compacts by itself, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compact_at: Option<u64>,
    /// Auto-compaction is off: the agent stops here until compacted by hand.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_at: Option<u64>,
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
    /// Uncommitted files of the root work tree; absent from older daemons.
    #[serde(default, rename = "dirtyCount", skip_serializing_if = "Option::is_none")]
    pub dirty_count: Option<u32>,
    /// Uncommitted added/deleted lines, including untracked files; absent from older daemons.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub additions: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deletions: Option<u32>,
    /// When the status was taken (RFC 3339); absent from older daemons.
    #[serde(default, rename = "checkedAt", skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<String>,
    pub workspace: WorkspaceKind,
    /// Submodules and nested repos (not the root), outermost first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub repos: Vec<RepoStatus>,
    /// The root repo's HEAD short hash; None on an unborn branch, or from older daemons (as the next three).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    /// What stopped midway; None when nothing is in progress.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ongoing: Option<GitOngoingKind>,
    /// Unmerged paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflicts: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stashes: Option<u32>,
}

/// A merge, rebase, cherry-pick or revert that stopped midway (conflicts, or a commit left to make).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GitOngoingKind {
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepoKind {
    Root,
    Submodule,
    Nested,
    /// An additional directory of the session; its repo's path is the directory's absolute path.
    Extra,
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

/// A merged team skill for the run; its files are fetched by `version_id` and cached by `digest`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRef {
    pub name: String,
    pub version_id: String,
    pub digest: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillEncoding {
    #[default]
    Utf8,
    Base64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillFile {
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub encoding: SkillEncoding,
}

/// `GET /api/daemon/skills/:versionId`
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DaemonSkillRes {
    pub files: Vec<SkillFile>,
}

/// A plugin enabled for the run; its files are fetched by `version_id` and cached by `digest`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRef {
    pub name: String,
    pub version_id: String,
    pub digest: String,
}

/// `GET /api/daemon/plugins/:versionId`
pub type DaemonPluginRes = DaemonSkillRes;

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
    /// Aligned with `options` by index; empty = plain options (left off the wire).
    #[serde(rename = "optionMeta", default, skip_serializing_if = "Vec::is_empty")]
    pub option_meta: Vec<OptionMeta>,
}

/// A design-enhanced option: a short description, colour swatches (`#rrggbb`), an image (workspace-relative path).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OptionMeta {
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub swatch: Vec<String>,
    #[serde(default)]
    pub image: Option<String>,
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
pub struct RepoFind {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub repo: RepoSpec,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoFound {
    pub request_id: String,
    pub managed_path: String,
    pub paths: Vec<String>,
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
    /// The bot's overrides of `bot_override` agent settings (field id → value).
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub agent_settings: std::collections::BTreeMap<String, String>,
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
    /// 禁止直推基准分支: pushing to `repo.branch` always asks the owner.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub protect_base: bool,
    /// Absolute paths the session may also work in (ACP additionalDirectories); not shared by sync.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_dirs: Vec<String>,
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
pub struct SessionFork {
    pub request_id: String,
    pub agent: AgentKind,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    pub session_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOpen {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    pub app: String,
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
pub struct FilesFind {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    pub name: String,
    pub limit: u32,
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

/// git.refs: local and remote-tracking branches, and the remotes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRefs {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    /// A repo of the workspace as GitStatus.repos reports it; None = the root repo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
}

/// git.log: newest first from `ref` (None = HEAD; a range like `main..feat` too), narrowed by `filter`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLog {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub r#ref: Option<String>,
    pub skip: u32,
    pub limit: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<GitLogFilter>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitLogOrder {
    Date,
    Topo,
}

/// git.log filters, all combined. `all`: every branch, remote branch and tag instead of `ref`; `text`: the message, a
/// fixed string unless `regexp` (extended), case-insensitive unless `match_case`; `since`/`until`: ISO dates; `path`:
/// work-tree-relative, a file's history following renames.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogFilter {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub all: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regexp: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_case: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_parent: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_merges: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<GitLogOrder>,
}

/// git.show: one commit's whole message, its committer and the branches containing it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitShow {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub commit: String,
}

/// git.tree: one directory of `ref`'s tree, the work tree untouched.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTree {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub r#ref: Option<String>,
    pub path: String,
}

/// git.read: one file of `ref`'s tree, the work tree untouched.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRead {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub r#ref: Option<String>,
    pub path: String,
    pub max_bytes: u64,
}

/// git.compare: paths that differ from `from` to `to` (None = the work tree, uncommitted changes included).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCompare {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub from: String,
    pub to: Option<String>,
}

/// git.diff: the unified patch from `from` to `to` (None = the work tree, untracked files included), of `path` only
/// when given, cut at `max_bytes`. Never touches the work tree or the index.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub from: String,
    pub to: Option<String>,
    pub path: Option<String>,
    pub max_bytes: u64,
    /// `-w`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignore_whitespace: Option<bool>,
    /// Context lines (`-U`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<u32>,
    /// [`FEATURE_GIT_OPS4`]: a rename's source, diffed with `path` as one file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    /// [`FEATURE_GIT_OPS4`], over `ignore_whitespace`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub whitespace: Option<GitWhitespace>,
}

/// IDEA's whitespace modes of a diff: trim = `-b`, ignore = `-w`, ignore-blank = `-w --ignore-blank-lines`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GitWhitespace {
    Trim,
    Ignore,
    IgnoreBlank,
}

/// git.changes: the work tree against HEAD as a commit would take it, unmerged paths apart, what stopped midway and
/// HEAD's commit. Never touches the index.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChanges {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
}

/// git.blame: who last changed each line of `path` at `ref` (None = the work tree, uncommitted lines included).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlame {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub r#ref: Option<String>,
    pub path: String,
}

/// git.stashes: the stash list, newest first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashes {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
}

/// git.conflict: an unmerged path's base, ours and theirs (each up to `max_bytes`) and git's diff3 merge of them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictRead {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub path: String,
    pub max_bytes: u64,
}

/// git.refresh: sends the current git status as workspace.state, after `git fetch --prune --all` when `fetch`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRefresh {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    pub fetch: bool,
}

/// All but the first four came with [`FEATURE_GIT_OPS3`]; add, ignore, apply and restore with [`FEATURE_GIT_OPS4`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GitActionKind {
    Checkout,
    Pull,
    Commit,
    Push,
    BranchCreate,
    BranchRename,
    BranchDelete,
    Merge,
    Rebase,
    CherryPick,
    Revert,
    Reset,
    Discard,
    Stash,
    Unstash,
    StashDrop,
    TagCreate,
    TagDelete,
    TagPush,
    Continue,
    Abort,
    Skip,
    Resolve,
    Add,
    Ignore,
    Apply,
    Restore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitConflictPick {
    Ours,
    Theirs,
}

/// git.action parameters beyond branch/remote/message/paths; each action reads its own (see [`GitAction`]).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitActionArgs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub onto: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commits: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detach: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkout: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amend: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_commit: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub untracked: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stash: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pop: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<GitConflictPick>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expect: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_added: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_commits: Option<GitLocalCommits>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub todo: Option<Vec<GitRebaseStep>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reverse: Option<bool>,
}

/// One line of an interactive rebase's todo; `message` for reword and squash.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitRebaseStep {
    pub action: GitRebaseAction,
    pub commit: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitRebaseAction {
    Pick,
    Reword,
    Squash,
    Fixup,
    Drop,
}

/// What a checkout of a remote branch does with the commits its local one has of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitLocalCommits {
    Rebase,
    Drop,
}

/// [`FEATURE_GIT_OPS4`]: what an action's outcome needs beyond its text (see GitActionDetail in daemon.ts).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct GitActionDetail {
    pub code: Option<GitActionCode>,
    pub paths: Vec<String>,
    /// diverged: the local branch's own commits, and the remote one's.
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    /// What a pull brought in.
    pub updated: Option<GitUpdated>,
    #[serde(default)]
    pub commands: Option<Vec<GitCommandRecord>>,
}

/// One process run by a manual git action, in execution order. Environment and stdin never enter this audit record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommandRecord {
    pub command: String,
    pub started_at: String,
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitActionCode {
    Overwritten,
    Diverged,
    Conflicts,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitUpdated {
    pub from: String,
    pub to: String,
    pub commits: u32,
    pub files: u32,
}

/// git.action: a manual write, refused (`busy`) while a turn holds the directory; commits are made as `identity`.
/// What each action reads is spelled out on GitAction in packages/protocol (daemon.ts). Pushes are only ever forced
/// with `args.force` (--force-with-lease).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAction {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    /// A repo of the workspace as GitStatus.repos reports it; None = the root repo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub action: GitActionKind,
    pub branch: Option<String>,
    pub remote: Option<String>,
    pub message: Option<String>,
    /// commit, discard, stash: only these work-tree-relative paths; None = every change. Older servers never send it.
    /// add, ignore, apply, restore: the paths they act on; resolve: more conflicted paths to take a side for.
    #[serde(default)]
    pub paths: Option<Vec<String>>,
    pub identity: Option<GitIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<GitActionArgs>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitBranchKind {
    Local,
    Remote,
}

/// A local branch, or a remote-tracking one (`name` = `origin/feat`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitBranch {
    pub name: String,
    pub kind: GitBranchKind,
    pub current: bool,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub commit: String,
    pub subject: String,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitRemote {
    pub name: String,
    pub url: String,
}

/// `commit`: the commit it points at (an annotated tag peeled); `subject`/`at`: that commit's.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitTag {
    pub name: String,
    pub commit: String,
    pub annotated: bool,
    pub subject: String,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub email: String,
    pub at: String,
    pub subject: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    pub path: String,
    pub change: GitChangeKind,
    pub old_path: Option<String>,
}

/// A change of the work tree against HEAD; `add`/`del` lines, None for binary files.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkChange {
    pub path: String,
    pub change: GitChangeKind,
    pub old_path: Option<String>,
    /// Not tracked by git yet.
    pub untracked: bool,
    pub add: Option<u32>,
    pub del: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitConflictSide {
    Modified,
    Added,
    Deleted,
}

/// An unmerged path and what each side did to it (`ours` = HEAD).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitConflict {
    pub path: String,
    pub ours: GitConflictSide,
    pub theirs: GitConflictSide,
}

/// What stopped midway: `subject` is what is merged, picked or reverted, or the branch being rebased; `step` of
/// `total` a rebase's progress; `message` the one git prepared for the commit that finishes it (MERGE_MSG).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitOngoing {
    pub kind: GitOngoingKind,
    pub subject: Option<String>,
    pub step: Option<u32>,
    pub total: Option<u32>,
    pub message: Option<String>,
}

/// HEAD's commit, to amend; `pushed` = already on a remote-tracking branch.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHeadCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub pushed: bool,
}

/// Lines `start` (1-based) to `start + count - 1` were last changed by `commit` ('' = not committed yet).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitBlameRange {
    pub start: u32,
    pub count: u32,
    pub commit: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub email: String,
    pub at: String,
    pub subject: String,
}

/// `stash@{index}`; `branch` None when made on a detached HEAD; `untracked`: it holds untracked files too.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitStash {
    pub index: u32,
    pub hash: String,
    pub message: String,
    pub branch: Option<String>,
    pub at: String,
    pub untracked: bool,
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
    #[serde(default)]
    pub skills: Vec<SkillRef>,
    /// Only sent to daemons announcing [`FEATURE_PLUGINS`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub plugins: Vec<PluginRef>,
    /// An agent command sent verbatim as the prompt instead of the composed group context.
    #[serde(default)]
    pub command: Option<String>,
    /// Force groups only.
    #[serde(default)]
    pub sync: Option<RunSyncStart>,
    /// Resolved secrets: env of the adapter process, kept in memory only.
    #[serde(default)]
    pub env: SecretEnv,
}

/// Secret env vars; `Debug` prints names only so a logged `RunStart` never carries a value.
#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SecretEnv(pub std::collections::BTreeMap<String, String>);

impl std::fmt::Debug for SecretEnv {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(self.0.keys()).finish()
    }
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
    /// A context compaction, sent when it starts and when it ends.
    #[serde(rename_all = "camelCase")]
    Compaction {
        compaction_id: String,
        status: CompactionStatus,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        trigger: Option<CompactionTrigger>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pre_tokens: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        post_tokens: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
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
pub enum CompactionStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompactionTrigger {
    Manual,
    Auto,
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
    #[serde(default)]
    pub reason: ApprovalReason,
    pub options: Vec<PermissionOption>,
    /// Rules an allow_always answer adds to the bot's `always_allow`; empty → don't offer it.
    #[serde(default)]
    pub remember: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalReason {
    HighRisk,
    ProtectedBase,
    Network,
    Write,
    Unparsed,
    #[default]
    NotAllowed,
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
    Terminal {
        terminal: Box<TerminalOpen>,
    },
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
/// Web terminals: hello `terminals`, the `terminate` open action, and stale cursors resuming from retained output.
pub const FEATURE_TERMINAL: &str = "terminal-v2";
pub const FEATURE_PROVIDERS: &str = "providers";
pub const FEATURE_CC_SWITCH: &str = "ccSwitch";
pub const FEATURE_SYNC: &str = "sync";
pub const FEATURE_SESSION_FORK: &str = "sessionFork";
pub const FEATURE_AGENT_SETTINGS: &str = "agentSettings";
pub const FEATURE_REPROBE: &str = "reprobe";
pub const FEATURE_PLUGINS: &str = "plugins";
pub const FEATURE_GIT_OPS: &str = "gitOps";
/// git.diff, git.refresh and commit `paths`: without it a server must not send paths, or everything gets committed.
pub const FEATURE_GIT_OPS2: &str = "gitOps2";
/// `repo` of git.refs / git.action: without it a server's request would act on the root repo instead.
pub const FEATURE_GIT_REPOS: &str = "gitRepos";
/// git.changes / show / blame / stashes / conflict, `repo` on every git read, log filters, diff options, tags and
/// recent branches in git.refs, the GitStatus extras, and the git.action kinds past push with their `args`.
pub const FEATURE_GIT_OPS3: &str = "gitOps3";
/// Pushes to `args.target` as explicit refs (an older daemon pushes the same name), stash `args.expect`, discard
/// `args.keepAdded` / `args.patch`, the add / ignore actions, git.diff `old_path` / `whitespace`, checkout
/// `args.localCommits`, pull `args.from`, branch-create `args.force`: without it a server must not send them. Answers
/// git.action with `detail`.
pub const FEATURE_GIT_OPS4: &str = "gitOps4";

pub const TERMINAL_IDLE_MS: u64 = 24 * 60 * 60 * 1000;
pub const TERMINAL_REPLAY_BYTES: usize = 1024 * 1024;
pub const TERMINAL_REPLAY_CHUNKS: usize = 4096;
pub const TERMINAL_MAX_PER_MACHINE: usize = 8;
pub const TERMINAL_MAX_PER_USER: usize = 4;
pub const TERMINAL_MAX_BUFFERED_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalStatus {
    Running,
    Exited,
    Closed,
    DaemonRestart,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalEndReason {
    User,
    Exited,
    IdleTimeout,
    Revoked,
    DaemonRestart,
    Shutdown,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOpen {
    pub action: TerminalOpenAction,
    pub session_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    pub cols: u16,
    pub rows: u16,
    pub after: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalOpenAction {
    Create,
    Attach,
    /// Ends the session and answers with its exit head; needs no attached stream.
    Terminate,
}

/// A shell this daemon still runs, reported at hello so the server can adopt or forget sessions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalLive {
    pub session_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub cols: u16,
    pub rows: u16,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalHead {
    pub session_id: String,
    pub status: TerminalStatus,
    pub cols: u16,
    pub rows: u16,
    pub next: u64,
    pub created_at: String,
    pub last_active_at: String,
    pub exit_code: Option<i32>,
    pub reason: Option<TerminalEndReason>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum TerminalClientControl {
    Resize { session_id: String, cols: u16, rows: u16 },
    Terminate { session_id: String },
    Ping { session_id: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum TerminalDaemonControl {
    State {
        session_id: String,
        state: TerminalStatus,
        next: u64,
        exit_code: Option<i32>,
        reason: Option<TerminalEndReason>,
    },
    Exit {
        session_id: String,
        state: TerminalStatus,
        next: u64,
        exit_code: Option<i32>,
        reason: Option<TerminalEndReason>,
    },
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
        #[serde(default)]
        terminals: Vec<TerminalLive>,
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
    #[serde(rename = "apps.list.result", rename_all = "camelCase")]
    AppsListResult { request_id: String, apps: Vec<String> },
    #[serde(rename = "workspace.open.result", rename_all = "camelCase")]
    WorkspaceOpenResult { request_id: String, error: Option<String> },
    #[serde(rename = "session.fork.result", rename_all = "camelCase")]
    SessionForkResult { request_id: String, session_id: Option<String>, error: Option<String> },
    #[serde(rename = "repo.found")]
    RepoFound(RepoFound),
    #[serde(rename = "files.result", rename_all = "camelCase")]
    FilesResult { request_id: String, entries: Vec<FileEntry>, error: Option<String> },
    #[serde(rename = "files.tree.result", rename_all = "camelCase")]
    FilesTreeResult { request_id: String, entries: Vec<TreeEntry>, truncated: bool, error: Option<String> },
    #[serde(rename = "files.find.result", rename_all = "camelCase")]
    FilesFindResult { request_id: String, paths: Vec<String>, error: Option<String> },
    #[serde(rename = "files.read.result", rename_all = "camelCase")]
    FilesReadResult {
        request_id: String,
        size: u64,
        binary: bool,
        mime: String,
        text: Option<String>,
        error: Option<String>,
    },
    #[serde(rename = "git.refs.result", rename_all = "camelCase")]
    GitRefsResult {
        request_id: String,
        branches: Vec<GitBranch>,
        remotes: Vec<GitRemote>,
        /// Newest first.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        tags: Vec<GitTag>,
        /// Up to 5 local branches checked out lately, latest first.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        recent: Vec<String>,
        error: Option<String>,
    },
    #[serde(rename = "git.log.result", rename_all = "camelCase")]
    GitLogResult { request_id: String, commits: Vec<GitCommit>, has_more: bool, error: Option<String> },
    #[serde(rename = "git.show.result", rename_all = "camelCase")]
    GitShowResult {
        request_id: String,
        commit: Option<GitCommit>,
        /// The whole message, subject included.
        body: String,
        committer: String,
        committer_email: String,
        committed_at: String,
        /// Local and remote-tracking branches containing it, at most 100.
        branches: Vec<String>,
        error: Option<String>,
    },
    #[serde(rename = "git.changes.result", rename_all = "camelCase")]
    GitChangesResult {
        request_id: String,
        changes: Vec<GitWorkChange>,
        conflicts: Vec<GitConflict>,
        ongoing: Option<GitOngoing>,
        head: Option<GitHeadCommit>,
        error: Option<String>,
    },
    #[serde(rename = "git.blame.result", rename_all = "camelCase")]
    GitBlameResult {
        request_id: String,
        ranges: Vec<GitBlameRange>,
        commits: Vec<GitBlameCommit>,
        error: Option<String>,
    },
    #[serde(rename = "git.stashes.result", rename_all = "camelCase")]
    GitStashesResult { request_id: String, stashes: Vec<GitStash>, error: Option<String> },
    /// None = absent on that side, or binary; `merged` (diff3 markers) only when all three are text.
    #[serde(rename = "git.conflict.result", rename_all = "camelCase")]
    GitConflictResult {
        request_id: String,
        base: Option<String>,
        ours: Option<String>,
        theirs: Option<String>,
        merged: Option<String>,
        binary: bool,
        error: Option<String>,
    },
    #[serde(rename = "git.tree.result", rename_all = "camelCase")]
    GitTreeResult { request_id: String, entries: Vec<TreeEntry>, truncated: bool, error: Option<String> },
    #[serde(rename = "git.read.result", rename_all = "camelCase")]
    GitReadResult {
        request_id: String,
        size: u64,
        binary: bool,
        mime: String,
        text: Option<String>,
        error: Option<String>,
    },
    #[serde(rename = "git.compare.result", rename_all = "camelCase")]
    GitCompareResult { request_id: String, changes: Vec<GitChange>, error: Option<String> },
    #[serde(rename = "git.diff.result", rename_all = "camelCase")]
    GitDiffResult { request_id: String, patch: Option<String>, truncated: bool, error: Option<String> },
    /// Sent after the refreshed workspace.state.
    #[serde(rename = "git.refresh.result", rename_all = "camelCase")]
    GitRefreshResult { request_id: String, error: Option<String> },
    #[serde(rename = "git.action.result", rename_all = "camelCase")]
    GitActionResult {
        request_id: String,
        ok: bool,
        busy: bool,
        output: Option<String>,
        error: Option<String>,
        #[serde(default)]
        detail: Option<GitActionDetail>,
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
    /// The agent went on by itself after `run_id` ended: asks for a run to report it under (`run.continued`).
    #[serde(rename = "run.continue", rename_all = "camelCase")]
    RunContinue { request_id: String, run_id: String },
    #[serde(rename = "session.config", rename_all = "camelCase")]
    SessionConfig {
        run_id: String,
        model: Option<String>,
        effort: Option<String>,
        /// Claude: what the run's settings came from.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        settings: Option<RunSettingsSnapshot>,
    },
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
    #[serde(rename = "agents.reprobe.result", rename_all = "camelCase")]
    AgentsReprobeResult { request_id: String, ok: bool, error: Option<String> },
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
    #[serde(rename = "releaseNotes", default, skip_serializing_if = "Option::is_none")]
    pub release_notes: Option<String>,
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
    /// The run opened for a `run.continue`, already running; None = refused.
    #[serde(rename = "run.continued", rename_all = "camelCase")]
    RunContinued { request_id: String, run_id: Option<String> },
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
    #[serde(rename = "files.find")]
    FilesFind(FilesFind),
    #[serde(rename = "git.refs")]
    GitRefs(GitRefs),
    #[serde(rename = "git.log")]
    GitLog(GitLog),
    #[serde(rename = "git.show")]
    GitShow(GitShow),
    #[serde(rename = "git.changes")]
    GitChanges(GitChanges),
    #[serde(rename = "git.blame")]
    GitBlame(GitBlame),
    #[serde(rename = "git.stashes")]
    GitStashes(GitStashes),
    #[serde(rename = "git.conflict")]
    GitConflict(GitConflictRead),
    #[serde(rename = "git.tree")]
    GitTree(GitTree),
    #[serde(rename = "git.read")]
    GitRead(GitRead),
    #[serde(rename = "git.compare")]
    GitCompare(GitCompare),
    #[serde(rename = "git.diff")]
    GitDiff(GitDiff),
    #[serde(rename = "git.refresh")]
    GitRefresh(GitRefresh),
    #[serde(rename = "git.action")]
    GitAction(Box<GitAction>),
    #[serde(rename = "workspace.diff")]
    WorkspaceDiff(WorkspaceDiff),
    #[serde(rename = "dir.list", rename_all = "camelCase")]
    DirList { request_id: String, path: Option<String> },
    #[serde(rename = "apps.list", rename_all = "camelCase")]
    AppsList { request_id: String },
    #[serde(rename = "workspace.open")]
    WorkspaceOpen(WorkspaceOpen),
    #[serde(rename = "session.fork")]
    SessionFork(SessionFork),
    #[serde(rename = "repo.find")]
    RepoFind(RepoFind),
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
    #[serde(rename = "agents.reprobe", rename_all = "camelCase")]
    AgentsReprobe { request_id: String, kind: AgentKind },
    #[serde(rename = "sync.result", rename_all = "camelCase")]
    SyncResult { group_id: String, bot_id: String, submit_id: String, result: SyncSubmitResult },
    #[serde(rename = "sync.available", rename_all = "camelCase")]
    SyncAvailable { group_id: String, version: u64 },
    #[serde(rename = "sync.action", rename_all = "camelCase")]
    SyncAction { group_id: String, bot_id: String, action: SyncActionKind },
    #[serde(rename = "sync.init", rename_all = "camelCase")]
    SyncInit { group_id: String, bot_id: String, role: SyncRole, force: bool, repo_id: Option<String> },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_find_fixtures_parse() {
        let ask: ServerToDaemon =
            serde_json::from_str(include_str!("../../../packages/protocol/fixtures/s2d.files.find.json")).unwrap();
        assert!(matches!(ask, ServerToDaemon::FilesFind(ref f) if f.name == "Markdown.tsx" && f.limit == 20));
        let answer: DaemonToServer =
            serde_json::from_str(include_str!("../../../packages/protocol/fixtures/d2s.files.find.result.json"))
                .unwrap();
        assert!(matches!(answer, DaemonToServer::FilesFindResult { ref paths, .. } if paths.len() == 2));
    }

    #[test]
    fn git_diff_refresh_and_commit_paths_fixtures_parse() {
        let fixture = |raw: &str| serde_json::from_str::<ServerToDaemon>(raw).unwrap();
        let ServerToDaemon::GitDiff(diff) =
            fixture(include_str!("../../../packages/protocol/fixtures/s2d.git.diff.json"))
        else {
            panic!()
        };
        assert_eq!((diff.from.as_str(), diff.to, diff.path.as_deref()), ("HEAD", None, Some("src/refund.ts")));
        assert_eq!(diff.max_bytes, 1_048_576);
        let refresh = fixture(include_str!("../../../packages/protocol/fixtures/s2d.git.refresh.json"));
        assert!(matches!(refresh, ServerToDaemon::GitRefresh(ref r) if r.fetch));
        let commit = fixture(include_str!("../../../packages/protocol/fixtures/s2d.git.action.json"));
        assert!(matches!(commit, ServerToDaemon::GitAction(ref a) if a.paths.as_ref().is_some_and(|p| p.len() == 2)));
        // An older server never sends `paths`.
        let push = fixture(include_str!("../../../packages/protocol/fixtures/s2d.git.action.push.json"));
        assert!(matches!(push, ServerToDaemon::GitAction(ref a) if a.paths.is_none()));

        let answer = |raw: &str| serde_json::from_str::<DaemonToServer>(raw).unwrap();
        let result = answer(include_str!("../../../packages/protocol/fixtures/d2s.git.diff.result.json"));
        assert!(
            matches!(result, DaemonToServer::GitDiffResult { ref patch, truncated: false, error: None, .. } if patch.as_ref().is_some_and(|p| p.starts_with("diff --git")))
        );
        let result = answer(include_str!("../../../packages/protocol/fixtures/d2s.git.refresh.result.json"));
        assert!(matches!(result, DaemonToServer::GitRefreshResult { error: None, .. }));
    }

    #[test]
    fn git_ops4_fixtures_parse() {
        let action = |raw: &str| match serde_json::from_str::<ServerToDaemon>(raw).unwrap() {
            ServerToDaemon::GitAction(a) => *a,
            other => panic!("unexpected {other:?}"),
        };
        let push = action(include_str!("../../../packages/protocol/fixtures/s2d.git.action.push.target.json"));
        assert_eq!((push.action, push.branch.as_deref()), (GitActionKind::Push, Some("feat/refund")));
        assert_eq!(push.args.unwrap().target.as_deref(), Some("feat/refund-v2"));
        let add = action(include_str!("../../../packages/protocol/fixtures/s2d.git.action.add.json"));
        assert_eq!((add.action, add.paths), (GitActionKind::Add, Some(vec!["notes/todo.md".to_string()])));
        let ignore = action(include_str!("../../../packages/protocol/fixtures/s2d.git.action.ignore.json"));
        assert_eq!((ignore.action, ignore.paths.map(|p| p.len())), (GitActionKind::Ignore, Some(2)));
        let discard = action(include_str!("../../../packages/protocol/fixtures/s2d.git.action.discard.keep.json"));
        assert_eq!((discard.action, discard.args.unwrap().keep_added), (GitActionKind::Discard, Some(true)));
        let drop = action(include_str!("../../../packages/protocol/fixtures/s2d.git.action.stash-drop.expect.json"));
        let args = drop.args.unwrap();
        assert_eq!(
            (drop.action, args.stash, args.expect.as_deref()),
            (GitActionKind::StashDrop, Some(1), Some("5f2c9e1a"))
        );
    }

    #[test]
    fn git_ops4_detail_fixtures_parse() {
        let ServerToDaemon::GitDiff(diff) =
            serde_json::from_str(include_str!("../../../packages/protocol/fixtures/s2d.git.diff.rename.json")).unwrap()
        else {
            panic!()
        };
        assert_eq!(
            (diff.path.as_deref(), diff.old_path.as_deref(), diff.whitespace),
            (Some("src/new.ts"), Some("src/old.ts"), Some(GitWhitespace::IgnoreBlank))
        );

        let action = |raw: &str| match serde_json::from_str::<ServerToDaemon>(raw).unwrap() {
            ServerToDaemon::GitAction(a) => (a.action, a.branch.clone(), a.args.unwrap()),
            other => panic!("unexpected {other:?}"),
        };
        let (kind, _, args) =
            action(include_str!("../../../packages/protocol/fixtures/s2d.git.action.discard.patch.json"));
        assert_eq!(kind, GitActionKind::Discard);
        assert!(args.patch.unwrap().starts_with("diff --git a/src/a.ts b/src/a.ts\n"));
        let (kind, branch, args) =
            action(include_str!("../../../packages/protocol/fixtures/s2d.git.action.checkout.drop.json"));
        assert_eq!(
            (kind, branch.as_deref(), args.local_commits),
            (GitActionKind::Checkout, Some("origin/feat"), Some(GitLocalCommits::Drop))
        );
        let (kind, _, args) = action(include_str!("../../../packages/protocol/fixtures/s2d.git.action.pull.from.json"));
        assert_eq!(
            (kind, args.mode.as_deref(), args.from.as_deref()),
            (GitActionKind::Pull, Some("rebase"), Some("origin/feat"))
        );
        let (kind, branch, args) =
            action(include_str!("../../../packages/protocol/fixtures/s2d.git.action.branch-create.force.json"));
        assert_eq!(
            (kind, branch.as_deref(), args.from.as_deref(), args.checkout, args.force),
            (GitActionKind::BranchCreate, Some("feat/x"), Some("origin/feat/x"), Some(true), Some(true))
        );

        let detail = |raw: &str| match serde_json::from_str::<DaemonToServer>(raw).unwrap() {
            DaemonToServer::GitActionResult { ok, detail, .. } => (ok, detail.unwrap()),
            other => panic!("unexpected {other:?}"),
        };
        let (ok, overwritten) =
            detail(include_str!("../../../packages/protocol/fixtures/d2s.git.action.result.overwritten.json"));
        assert!(!ok);
        assert_eq!(
            overwritten,
            GitActionDetail {
                code: Some(GitActionCode::Overwritten),
                paths: vec!["src/a.ts".into(), "README.md".into()],
                ..GitActionDetail::default()
            }
        );
        let (ok, updated) =
            detail(include_str!("../../../packages/protocol/fixtures/d2s.git.action.result.updated.json"));
        assert!(ok);
        let to = GitUpdated { from: "1a2b3c4".into(), to: "5d6e7f8".into(), commits: 2, files: 3 };
        assert_eq!(updated, GitActionDetail { updated: Some(to), ..GitActionDetail::default() });

        // Every field goes out, null when unset; an older daemon's answer has no detail.
        let none = serde_json::to_value(GitActionDetail::default()).unwrap();
        assert_eq!(
            none,
            serde_json::json!({"code": null, "paths": [], "ahead": null, "behind": null, "updated": null, "commands": null})
        );
        let result = DaemonToServer::GitActionResult {
            request_id: "q1".into(),
            ok: true,
            busy: false,
            output: None,
            error: None,
            detail: None,
        };
        assert_eq!(serde_json::to_value(&result).unwrap()["detail"], serde_json::Value::Null);
        let older = r#"{"t":"git.action.result","requestId":"q1","ok":true,"busy":false,"output":"x","error":null}"#;
        assert!(matches!(serde_json::from_str(older).unwrap(), DaemonToServer::GitActionResult { detail: None, .. }));
    }

    #[test]
    fn git_ops4_r4_fixtures_parse() {
        let action = |raw: &str| match serde_json::from_str::<ServerToDaemon>(raw).unwrap() {
            ServerToDaemon::GitAction(a) => (a.action, a.paths.clone(), a.args.unwrap()),
            other => panic!("unexpected {other:?}"),
        };
        let (kind, _, args) =
            action(include_str!("../../../packages/protocol/fixtures/s2d.git.action.rebase.todo.json"));
        assert_eq!((kind, args.onto.as_deref()), (GitActionKind::Rebase, Some("0f1e2d3c")));
        let step = |action, commit: &str, message: Option<&str>| GitRebaseStep {
            action,
            commit: commit.into(),
            message: message.map(String::from),
        };
        assert_eq!(
            args.todo.unwrap(),
            [
                step(GitRebaseAction::Pick, "a1b2c3d4", None),
                step(GitRebaseAction::Reword, "b2c3d4e5", Some("修复退款金额")),
                step(GitRebaseAction::Fixup, "c3d4e5f6", None),
                step(GitRebaseAction::Drop, "d4e5f6a7", None),
            ]
        );
        let (kind, paths, args) =
            action(include_str!("../../../packages/protocol/fixtures/s2d.git.action.resolve.paths.json"));
        assert_eq!(
            (kind, paths, args.path.as_deref(), args.side),
            (
                GitActionKind::Resolve,
                Some(vec!["src/a.ts".into(), "src/b.ts".into()]),
                Some("src/a.ts"),
                Some(GitConflictPick::Theirs)
            )
        );
        let (kind, paths, args) = action(include_str!("../../../packages/protocol/fixtures/s2d.git.action.apply.json"));
        assert_eq!(
            (kind, paths, args.commit.as_deref(), args.reverse),
            (GitActionKind::Apply, Some(vec!["src/a.ts".into()]), Some("a1b2c3d4"), Some(true))
        );
        let (kind, paths, args) =
            action(include_str!("../../../packages/protocol/fixtures/s2d.git.action.restore.json"));
        assert_eq!(
            (kind, paths, args.commit.as_deref(), args.reverse),
            (GitActionKind::Restore, Some(vec!["src/a.ts".into(), "README.md".into()]), Some("a1b2c3d4"), None)
        );
    }

    #[test]
    fn git_ops4_up_to_and_expect_head_fixtures_parse() {
        let action = |raw: &str| match serde_json::from_str::<ServerToDaemon>(raw).unwrap() {
            ServerToDaemon::GitAction(a) => (a.action, a.branch.clone(), a.args.unwrap()),
            other => panic!("unexpected {other:?}"),
        };
        let (kind, branch, args) =
            action(include_str!("../../../packages/protocol/fixtures/s2d.git.action.push.commit.json"));
        assert_eq!(
            (kind, branch.as_deref(), args.commit.as_deref(), args.target),
            (GitActionKind::Push, Some("feat/refund"), Some("a1b2c3d4e5f6"), None)
        );
        let (kind, _, args) =
            action(include_str!("../../../packages/protocol/fixtures/s2d.git.action.reset.expect.json"));
        assert_eq!(
            (kind, args.commit.as_deref(), args.mode.as_deref(), args.expect.as_deref()),
            (GitActionKind::Reset, Some("0f1e2d3c4b5a"), Some("soft"), Some("a1b2c3d4e5f6"))
        );
    }
}
