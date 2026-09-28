//! Wire types mirrored from `packages/protocol/src/{common,daemon}.ts`.
//! `tests/contract.rs` round-trips every shared JSON fixture to keep both sides aligned.
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;

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
            Approval::Ask => "每次询问",
            Approval::Allowlist => "白名单自动",
            Approval::All => "全部自动",
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
    pub appends_applied: u32,
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

/// Ordered name/value pairs so repeated headers (set-cookie) survive.
pub type TunnelHeaders = Vec<(String, String)>;

/// JSON payload of a tunnel `open` frame (see `tunnel.rs`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelOpen {
    pub preview_id: String,
    pub port: u16,
    pub method: String,
    pub path: String,
    pub headers: TunnelHeaders,
    pub upgrade: bool,
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
    #[serde(rename = "workspace.diff.result", rename_all = "camelCase")]
    WorkspaceDiffResult {
        request_id: String,
        patch: Option<String>,
        base: Option<String>,
        branch: Option<String>,
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
    #[serde(rename = "previews.sync")]
    PreviewsSync { previews: Vec<PreviewPort> },
}
