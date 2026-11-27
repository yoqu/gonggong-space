use super::{ADAPTER_DEFAULT, named};
use crate::protocol::{AgentCatalog, Choice, ModelChoice};

/// A session's models as `models` reports them.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Models {
    pub(super) current: String,
    /// The one the session was opened with.
    pub(super) initial: String,
    pub(super) choices: Vec<Choice>,
}

impl Models {
    pub(super) fn of(raw: &serde_json::Value) -> Option<Models> {
        let models = raw.get("models")?;
        let current = models["currentModelId"].as_str()?.to_string();
        let choices = models["availableModels"]
            .as_array()?
            .iter()
            .filter_map(|m| {
                let value = m["modelId"].as_str()?.to_string();
                let name = m["name"].as_str().map_or_else(|| value.clone(), String::from);
                Some(Choice { name, value, description: m["description"].as_str().map(String::from) })
            })
            .collect();
        Some(Models { initial: current.clone(), current, choices })
    }

    pub(super) fn catalog(self) -> AgentCatalog {
        let models =
            named(self.choices).into_iter().map(|choice| ModelChoice { choice, efforts: vec![], effort: None });
        AgentCatalog {
            models: models.collect(),
            current: Some(self.current).filter(|v| v != ADAPTER_DEFAULT),
            ..Default::default()
        }
    }
}
