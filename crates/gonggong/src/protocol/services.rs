use super::*;

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

/// A web page on an open preview's port (headless Chrome).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SnapshotTarget {
    #[serde(rename_all = "camelCase")]
    Page { preview_id: String, port: u16 },
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
