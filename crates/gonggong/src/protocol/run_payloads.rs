use super::*;

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
    /// Its MCP servers (needs [`FEATURE_PLUGIN_MCP`]): `{node}` and `{pkg}` in stdio ones are filled in by the daemon.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp: Vec<McpServer>,
}

/// `GET /api/daemon/plugins/:versionId`
pub type DaemonPluginRes = DaemonSkillRes;

/// A hosted artifact the run checks out before the agent starts (needs [`FEATURE_ARTIFACTS`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonArtifactRef {
    pub id: String,
    /// `design/<slug>` relative to the workspace.
    pub dir: String,
    /// None until the first version arrives.
    pub head_version_id: Option<String>,
    /// [`crate::sync::root_hash`] of the head's files with `exec` false.
    pub digest: Option<String>,
    /// Its plugin (name): the turn's copy of it gives the shell screenshots are framed in.
    #[serde(default)]
    pub plugin: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactFile {
    pub path: String,
    pub hash: String,
    pub size: u64,
}

/// `GET /api/daemon/artifacts/:id/versions/:versionId`
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactManifestRes {
    pub version_id: String,
    pub files: Vec<ArtifactFile>,
}

/// `POST /api/daemon/runs/:runId/artifacts/:id/versions`, sent once every blob is uploaded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSubmitReq {
    pub parent_version_id: Option<String>,
    /// `Local`: changes found on the machine before the run, uploaded before the head is checked out.
    #[serde(default)]
    pub source: ArtifactSubmitSource,
    /// Retries reuse it: the server answers with the version it already has.
    pub submit_key: String,
    pub files: Vec<ArtifactFile>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactSubmitSource {
    #[default]
    Run,
    Local,
    /// A hosted site's upload (machine routes).
    Host,
}

/// `head` false with `stale` true: kept as a candidate, the head moved on meanwhile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSubmitRes {
    pub version_id: String,
    pub n: u32,
    pub head: bool,
    pub stale: bool,
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
    /// ms since epoch.
    #[serde(default)]
    pub modified: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirPlaceKind {
    Home,
    Desktop,
    Documents,
    Downloads,
    Volume,
}

/// A quick location of the directory picker's sidebar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DirPlace {
    pub kind: DirPlaceKind,
    pub name: String,
    pub path: String,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub names: Option<WorkspaceNames>,
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
    #[serde(default)]
    pub places: Vec<DirPlace>,
    /// This daemon answers dir.create.
    #[serde(default)]
    pub can_create: bool,
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
    /// 帮我审批: the rules trust more on their own (`local::Rules`), or the agent's own reviewer decides.
    #[serde(default)]
    pub ai_review: bool,
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
    /// The group's extra repos: each cloned to its own managed path, and added to the session like `extra_dirs`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_repos: Vec<RepoSpec>,
}
