use super::*;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonLoginReq {
    pub code: String,
    pub machine: MachineInfo,
    /// `gg login --create-bot`: once bound, the server makes a bot of this agent on the machine and a DM with it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub create_bot: Option<CreateBot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBot {
    pub agent: AgentKind,
}

/// The bot (and the DM with it) a `create_bot` login made; absent from older servers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginBot {
    pub id: String,
    pub name: String,
    pub group_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonLoginRes {
    pub token: String,
    pub machine_id: String,
    pub owner_name: String,
    #[serde(default)]
    pub restored: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bot: Option<LoginBot>,
}

/// POST /api/daemon/link-requests: the bind code expired, so the user allows this machine on the Web instead.
/// `code` (the expired one) only tells the server whom to ask first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRequestReq {
    pub machine: MachineInfo,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub create_bot: Option<CreateBot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRequestRes {
    pub id: String,
    pub secret: String,
    pub user_code: String,
    pub url: String,
    pub expires_at: String,
    pub interval_ms: u64,
}

/// POST /api/daemon/link-requests/:id/poll.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkPollReq {
    pub secret: String,
}

/// `Approved` carries what POST /api/daemon/login returns; the machine is bound at that poll, once.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum LinkPollRes {
    Pending,
    Denied,
    Expired,
    Approved(DaemonLoginRes),
}
