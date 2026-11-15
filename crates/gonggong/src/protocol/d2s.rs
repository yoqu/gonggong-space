use super::*;

pub const FEATURE_TOOLS: &str = "tools";

/// Web terminals: hello `terminals`, the `terminate` open action, and stale cursors resuming from retained output.
pub const FEATURE_TERMINAL: &str = "terminal-v2";

/// Machine terminals: a `cwd` on the terminal open names the directory instead of a bot workspace.
pub const FEATURE_TERMINAL_DIR: &str = "terminal-dir";

pub const FEATURE_PROVIDERS: &str = "providers";

pub const FEATURE_CC_SWITCH: &str = "ccSwitch";

pub const FEATURE_SYNC: &str = "sync";

pub const FEATURE_SESSION_FORK: &str = "sessionFork";

pub const FEATURE_AGENT_SETTINGS: &str = "agentSettings";

/// `args` of the official login: Claude Code command-line arguments.
pub const FEATURE_CLAUDE_ARGS: &str = "claudeArgs";

/// A provider's `configDir` / `executablePath`: a local Claude profile.
pub const FEATURE_CLAUDE_PROFILE: &str = "claudeProfile";

/// A provider's `args`: Claude Code command-line arguments.
pub const FEATURE_PROVIDER_ARGS: &str = "providerArgs";

/// gitaccess.cmd: ssh keys, HTTPS tokens, access tests and host keys from the web.
pub const FEATURE_GIT_ACCESS: &str = "gitAccess";

/// diag.run: `gg doctor` from the web.
pub const FEATURE_DIAG: &str = "diag";

/// Not a capability: the daemon runs in a container (GONGGONG_CONTAINER=1).
pub const FEATURE_CONTAINER: &str = "container";

/// Not a capability: the daemon never upgrades itself.
pub const FEATURE_NO_AUTO_UPGRADE: &str = "noAutoUpgrade";

/// upgrade.start: a Linux CLI daemon that upgrades itself, started from the web.
pub const FEATURE_UPGRADE: &str = "upgrade";

/// Runs Gemini CLI bots: a daemon without it cannot read a run.start for one.
pub const FEATURE_GEMINI: &str = "gemini";

/// Runs CodeBuddy (WorkBuddy) bots: a daemon without it cannot read a run.start for one.
pub const FEATURE_CODEBUDDY: &str = "codebuddy";

/// 帮我审批's rules (开发常用命令, workspace edits, AI pre-review that only stops risks).
pub const FEATURE_APPROVAL_GATES: &str = "approvalGates";

/// 帮我审批 hands approvals to the agent's own reviewer (Claude `auto`, Codex `agent` on an official login).
pub const FEATURE_BUILTIN_REVIEW: &str = "builtinReview";

/// Runs pi bots: a daemon without it cannot read a run.start for one.
pub const FEATURE_PI: &str = "pi";

/// Runs DeepSeek Harness bots: a daemon without it cannot read a run.start for one.
pub const FEATURE_DEEPSEEK: &str = "deepseek";

/// Runs Antigravity CLI bots: a daemon without it cannot read a run.start for one.
pub const FEATURE_ANTIGRAVITY: &str = "antigravity";

pub const FEATURE_REPROBE: &str = "reprobe";

pub const FEATURE_PLUGINS: &str = "plugins";

/// `PluginRef.mcp`: the plugins' MCP servers join the run's (plan 插件扩展点 S1).
pub const FEATURE_PLUGIN_MCP: &str = "pluginMcp";

/// `presets.sync`, artifact `plugin` and manifest `artifact.kit` (plan 插件扩展点 S2).
pub const FEATURE_PRESET_SYNC: &str = "presetSync";

/// Hosted artifacts: `RunStart.artifacts` / `artifactExclude` and the artifact version routes.
pub const FEATURE_ARTIFACTS: &str = "artifacts";

/// `artifact.snapshot`: screenshots of artifact versions this machine did not make.
pub const FEATURE_ARTIFACT_SNAPSHOT: &str = "artifactSnapshot";

/// 机器与 Bot on the web: logs.get, workspaces.list and workspace.delete.
pub const FEATURE_MACHINE_ADMIN: &str = "machineAdmin";

/// 空间: workspace.gc, `lastUsedAt` / `changes` / `disk` in workspaces.result, and deletes that skip busy dirs.
pub const FEATURE_STORAGE_ADMIN: &str = "storageAdmin";

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
    #[serde(rename = "approval.ai_approved")]
    ApprovalAiApproved(ApprovalAiApproved),
    #[serde(rename = "agents.update")]
    AgentsUpdate { agents: Vec<AgentInfo> },
    #[serde(rename = "commands.update", rename_all = "camelCase")]
    CommandsUpdate { group_id: String, bot_id: String, commands: Vec<AgentCommand> },
    #[serde(rename = "dir.result")]
    DirResult(DirResult),
    #[serde(rename = "dir.create.result", rename_all = "camelCase")]
    DirCreateResult { request_id: String, path: Option<String>, error: Option<String> },
    #[serde(rename = "apps.list.result", rename_all = "camelCase")]
    AppsListResult { request_id: String, apps: Vec<String> },
    #[serde(rename = "logs.result", rename_all = "camelCase")]
    LogsResult { request_id: String, lines: Vec<crate::logs::LogLine>, error: Option<String> },
    #[serde(rename = "workspaces.result", rename_all = "camelCase")]
    WorkspacesResult {
        request_id: String,
        entries: Vec<crate::workspace::Entry>,
        /// The volume holding the daemon home ([`FEATURE_STORAGE_ADMIN`]).
        #[serde(default)]
        disk: Option<crate::workspace::Disk>,
        error: Option<String>,
    },
    #[serde(rename = "workspace.delete.result", rename_all = "camelCase")]
    WorkspaceDeleteResult { request_id: String, error: Option<String> },
    #[serde(rename = "workspace.gc.result", rename_all = "camelCase")]
    WorkspaceGcResult { request_id: String, before: u64, after: u64, error: Option<String> },
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
    #[serde(rename = "gitaccess.result", rename_all = "camelCase")]
    GitAccessResult {
        request_id: String,
        ok: bool,
        error: Option<String>,
        view: Option<GitAccessView>,
        test: Option<GitAccessTest>,
    },
    #[serde(rename = "diag.result", rename_all = "camelCase")]
    DiagResult { request_id: String, checks: Vec<DiagCheck> },
    #[serde(rename = "upgrade.result", rename_all = "camelCase")]
    UpgradeResult { request_id: String, state: UpgradeState },
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

/// Answer to upgrade.start.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpgradeState {
    /// Downloading; restarts once verified and idle.
    Downloading,
    /// Downloaded and verified; restarts once idle.
    Ready,
    /// Not newer than this build.
    Current,
    /// Failed verification or installation before.
    Refused,
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
