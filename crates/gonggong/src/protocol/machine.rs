use super::*;

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
