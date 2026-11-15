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
