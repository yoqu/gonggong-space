use super::*;

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

/// Group and Bot names a managed workspace's directory is named after when first placed; older servers omit them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceNames {
    pub group: String,
    pub bot: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEnsure {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub repo: Option<RepoSpec>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_repos: Vec<RepoSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub names: Option<WorkspaceNames>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub names: Option<WorkspaceNames>,
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
    ApprovalDecision {
        run_id: String,
        request_id: String,
        option_id: Option<String>,
        /// 本次会话不再问: the request's `remember_session` rules are trusted until the session ends.
        #[serde(default)]
        session: bool,
    },
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
    DirList {
        request_id: String,
        path: Option<String>,
        /// Older servers leave it out.
        #[serde(default)]
        hidden: bool,
    },
    #[serde(rename = "dir.create", rename_all = "camelCase")]
    DirCreate { request_id: String, parent: String, name: String },
    #[serde(rename = "apps.list", rename_all = "camelCase")]
    AppsList { request_id: String },
    /// 机器与 Bot → 日志 (needs [`FEATURE_MACHINE_ADMIN`]).
    #[serde(rename = "logs.get", rename_all = "camelCase")]
    LogsGet { request_id: String, level: crate::logs::LogLevel, limit: usize },
    #[serde(rename = "workspaces.list", rename_all = "camelCase")]
    WorkspacesList { request_id: String },
    #[serde(rename = "workspace.delete", rename_all = "camelCase")]
    WorkspaceDelete { request_id: String, group_id: String, bot_id: String, path: String },
    /// 空间 → 瘦身 (needs [`FEATURE_STORAGE_ADMIN`]).
    #[serde(rename = "workspace.gc", rename_all = "camelCase")]
    WorkspaceGc { request_id: String, group_id: String, bot_id: String, path: String },
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
    /// Screenshot a version this machine did not make (needs [`FEATURE_ARTIFACT_SNAPSHOT`]).
    #[serde(rename = "artifact.snapshot", rename_all = "camelCase")]
    ArtifactSnapshot {
        artifact_id: String,
        version_id: String,
        /// The artifact's plugin, whose installed shell frames the screens.
        #[serde(default)]
        plugin: Option<String>,
    },
    /// Provider presets of platform plugins, over the built-in ones (needs [`FEATURE_PRESET_SYNC`]).
    #[serde(rename = "presets.sync")]
    PresetsSync { presets: Vec<Preset> },
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
    #[serde(rename = "gitaccess.cmd")]
    GitAccessCmd(GitAccessCmd),
    #[serde(rename = "diag.run", rename_all = "camelCase")]
    DiagRun { request_id: String },
    #[serde(rename = "upgrade.start", rename_all = "camelCase")]
    UpgradeStart { request_id: String, upgrade: UpgradeInfo },
    #[serde(rename = "sync.result", rename_all = "camelCase")]
    SyncResult { group_id: String, bot_id: String, submit_id: String, result: SyncSubmitResult },
    #[serde(rename = "sync.available", rename_all = "camelCase")]
    SyncAvailable { group_id: String, version: u64 },
    #[serde(rename = "sync.action", rename_all = "camelCase")]
    SyncAction { group_id: String, bot_id: String, action: SyncActionKind },
    #[serde(rename = "sync.init", rename_all = "camelCase")]
    SyncInit { group_id: String, bot_id: String, role: SyncRole, force: bool, repo_id: Option<String> },
}
