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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MachineInfo {
    pub name: String,
    pub os: String,
    pub arch: String,
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
#[serde(rename_all = "camelCase")]
pub struct RunBot {
    pub id: String,
    pub name: String,
    pub agent_kind: AgentKind,
    pub system_prompt: String,
    pub tier: Tier,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepoSpec {
    pub id: String,
    pub url: String,
    pub branch: String,
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
pub struct RunPrompt {
    pub text: String,
    pub triggered_by: String,
    pub context: Vec<ContextMessage>,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunEvent {
    Status {
        status: RunStatus,
        step: String,
    },
    Text {
        delta: String,
    },
    Thought {
        delta: String,
    },
    #[serde(rename_all = "camelCase")]
    Tool {
        tool_call_id: String,
        title: String,
        tool_kind: String,
        status: ToolStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
    Usage {
        usage: Usage,
    },
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
    pub repo: RepoSpec,
    pub path: Option<String>,
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
    #[serde(rename = "commands.update", rename_all = "camelCase")]
    CommandsUpdate { group_id: String, bot_id: String, commands: Vec<AgentCommand> },
    #[serde(rename = "files.result", rename_all = "camelCase")]
    FilesResult { request_id: String, entries: Vec<FileEntry>, error: Option<String> },
    #[serde(rename = "question.ask", rename_all = "camelCase")]
    QuestionAsk { run_id: String, request_id: String, questions: Vec<Question> },
    #[serde(rename = "run.discarded", rename_all = "camelCase")]
    RunDiscarded { run_id: String, ok: bool, files: u32, error: Option<String> },
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
    Welcome { machine_id: String, heartbeat_sec: u64, upgrade: Option<UpgradeInfo> },
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
}
