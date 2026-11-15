use super::*;

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
    Gemini,
    Codebuddy,
    Pi,
    Deepseek,
    Antigravity,
}

impl AgentKind {
    pub const ALL: [AgentKind; 7] = [
        AgentKind::Claude,
        AgentKind::Codex,
        AgentKind::Gemini,
        AgentKind::Codebuddy,
        AgentKind::Pi,
        AgentKind::Deepseek,
        AgentKind::Antigravity,
    ];

    /// Finds team and plugin skills through links in `<cwd>/.agents/skills/` (Claude loads them as plugins, the
    /// manifest agents say how: `skills.via`).
    pub fn links_skills(self) -> bool {
        self == AgentKind::Codex
            || crate::adapters::get(self).is_some_and(|a| a.spec.skills.via == crate::adapters::SkillsVia::Link)
    }
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
/// Estimated make-up of a session's context at the end of a run, from what the daemon saw of it (tokens guessed
/// from text length). The rest of `ContextUsage::used` is the agent's own (system prompt, tool definitions, ...).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBreakdown {
    /// Tool calls (arguments and results) by tool, largest first.
    pub tools: Vec<ToolTokens>,
    /// Prompts and replies of each turn, oldest first.
    pub turns: Vec<u64>,
    /// Earlier parts were not seen (session resumed by a restarted daemon, or the agent compacted or cleared some).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub partial: bool,
    /// Prompt cache of the run's last prompt, as reported by the agent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache: Option<CacheUsage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolTokens {
    /// The agent's tool name when known (Claude, MCP tools); else only `kind` tells it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// ACP ToolKind.
    pub kind: String,
    pub count: u32,
    pub tokens: u64,
}

/// `read` of `total` input tokens came from the prompt cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CacheUsage {
    pub read: u64,
    pub total: u64,
}

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
