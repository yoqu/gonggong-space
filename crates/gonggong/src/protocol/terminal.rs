use super::*;

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
    /// A machine terminal's own absolute directory (its group and bot ids are both its space id); none = the bot's
    /// workspace.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
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
