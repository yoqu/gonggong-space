use super::*;

/// The CLIs the daemon knows how to drive: their commands are built in, never taken from the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum ConnectorDriver {
    #[serde(rename = "lark-cli")]
    LarkCli,
    #[serde(rename = "meegle")]
    Meegle,
}

impl ConnectorDriver {
    pub fn binary(self) -> &'static str {
        match self {
            ConnectorDriver::LarkCli => "lark-cli",
            ConnectorDriver::Meegle => "meegle",
        }
    }
}

/// `default` (the machine owner's own login) or `gg-<userId>` (a member's). Checked on the way in: it becomes a CLI
/// argument and a directory name.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ConnectorProfile(String);

impl ConnectorProfile {
    pub const DEFAULT: &str = "default";

    pub fn default_profile() -> Self {
        ConnectorProfile(Self::DEFAULT.into())
    }

    pub fn is_default(&self) -> bool {
        self.0 == Self::DEFAULT
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ConnectorProfile {
    type Error = String;
    fn try_from(s: String) -> Result<Self, String> {
        let member = s.strip_prefix("gg-").is_some_and(|id| {
            id.len() == 36 && id.bytes().all(|b| b == b'-' || b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        });
        if s == Self::DEFAULT || member { Ok(ConnectorProfile(s)) } else { Err(format!("invalid profile {s:?}")) }
    }
}

impl From<ConnectorProfile> for String {
    fn from(p: ConnectorProfile) -> String {
        p.0
    }
}

impl std::fmt::Display for ConnectorProfile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorCliState {
    Ready,
    NeedsLogin,
    NeedsInit,
    NotInstalled,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorProbe {
    pub connector: String,
    pub driver: ConnectorDriver,
    pub profile: ConnectorProfile,
    pub state: ConnectorCliState,
    pub account: Option<String>,
    pub feishu_user_id: Option<String>,
    pub expires_at: Option<String>,
    pub refresh_expires_at: Option<String>,
    pub version: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectorSpec {
    pub connector: String,
    pub driver: ConnectorDriver,
    pub npm: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectorsAction {
    Detect,
    Connect,
    Cancel,
    Logout,
    Renew,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorsCmd {
    pub request_id: String,
    pub action: ConnectorsAction,
    pub spec: ConnectorSpec,
    pub profile: ConnectorProfile,
    #[serde(default)]
    pub domains: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectorsStage {
    Node,
    Install,
    Init,
    Login,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectorsAuthStep {
    Init,
    Login,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorsAuth {
    pub request_id: String,
    pub step: ConnectorsAuthStep,
    pub url: String,
    pub user_code: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorsResult {
    pub request_id: String,
    pub ok: bool,
    pub error: Option<String>,
    pub probe: Option<ConnectorProbe>,
}

/// RunStart.cliProfiles: the profile each CLI runs as for the turn's originator.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RunCliProfile {
    pub driver: ConnectorDriver,
    pub profile: ConnectorProfile,
}
