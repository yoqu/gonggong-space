//! Wire types mirrored from `packages/protocol/src/daemon.ts`.
//! `tests/contract.rs` deserializes every shared JSON fixture to keep both sides aligned.
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Claude,
    Codex,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentInfo {
    pub kind: AgentKind,
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MachineInfo {
    pub name: String,
    pub os: String,
    pub arch: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum DaemonToServer {
    #[serde(rename_all = "camelCase")]
    Hello {
        protocol: u32,
        daemon_version: String,
        machine: MachineInfo,
        agents: Vec<AgentInfo>,
    },
    Heartbeat,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RejectReason {
    Protocol,
    Revoked,
    Unauthorized,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum ServerToDaemon {
    #[serde(rename_all = "camelCase")]
    Welcome { machine_id: String, heartbeat_sec: u64 },
    #[serde(rename_all = "camelCase")]
    Reject {
        reason: RejectReason,
        message: String,
        min_protocol: Option<u32>,
    },
}
