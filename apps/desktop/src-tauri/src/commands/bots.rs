//! Bot page: the machine's bots with their 本机设置 (model, command approval) and the server-side 并发上限.
use super::{Result, client, local};
use crate::host::Host;
use aiws::bots::Bot;
use aiws::local::{Approval, BotSettings, LocalSettings};
use serde::{Deserialize, Serialize};
use tauri::State;

/// What the page offers; the server accepts up to 8.
const MAX_CONCURRENCY: u32 = 4;

#[derive(Debug, Serialize)]
pub struct BotCard {
    #[serde(flatten)]
    bot: Bot,
    #[serde(flatten)]
    local: BotSettings,
}

#[tauri::command]
pub async fn bots(host: State<'_, Host>) -> Result<Vec<BotCard>> {
    let list = client()?.list().await.map_err(|e| e.to_string())?;
    let local = LocalSettings::load(&host.home).map_err(|e| format!("{e:#}"))?;
    Ok(list.into_iter().map(|bot| BotCard { local: local.bot(&bot.id), bot }).collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotChange {
    /// `None` = follow the agent's default.
    model: Option<String>,
    approval: Approval,
    allowlist: Vec<String>,
    /// Only when changed.
    concurrency: Option<u32>,
}

fn apply(settings: &mut LocalSettings, id: &str, change: &BotChange) {
    let mut allowlist: Vec<String> = vec![];
    for c in change.allowlist.iter().map(|c| c.trim()).filter(|c| !c.is_empty()) {
        if !allowlist.iter().any(|a| a == c) {
            allowlist.push(c.to_string());
        }
    }
    let model = change.model.clone().filter(|m| !m.trim().is_empty());
    settings.bots.insert(id.to_string(), BotSettings { model, approval: change.approval, allowlist });
}

/// Local settings apply from the bot's next turn; the concurrency goes to the server.
#[tauri::command]
pub async fn save_bot(id: String, change: BotChange, host: State<'_, Host>) -> Result<()> {
    if change.concurrency.is_some_and(|n| !(1..=MAX_CONCURRENCY).contains(&n)) {
        return Err(format!("并发上限为 1–{MAX_CONCURRENCY}"));
    }
    local(&host.home, |s| apply(s, &id, &change))?;
    if let Some(n) = change.concurrency {
        client()?.set_concurrency(&id, n).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saving_trims_and_dedups_the_allowlist_and_clears_blank_models() {
        let mut s = LocalSettings::default();
        let change = BotChange {
            model: Some(" ".into()),
            approval: Approval::Allowlist,
            allowlist: vec!["go build".into(), " go build ".into(), "".into(), "npm test".into()],
            concurrency: None,
        };
        apply(&mut s, "b1", &change);
        assert_eq!(
            s.bot("b1"),
            BotSettings {
                model: None,
                approval: Approval::Allowlist,
                allowlist: vec!["go build".into(), "npm test".into()]
            }
        );
        s.validate().unwrap();
    }

    #[test]
    fn cards_serialize_flat_for_the_page() {
        let bot: Bot = serde_json::from_str(
            r#"{"id":"b1","name":"小王的 Claude","agentKind":"claude","binding":"bound","presence":"online","concurrency":2}"#,
        )
        .unwrap();
        let local = BotSettings { model: Some("haiku".into()), approval: Approval::All, allowlist: vec![] };
        let json = serde_json::to_value(BotCard { bot, local }).unwrap();
        assert_eq!(json["concurrency"], 2);
        assert_eq!((json["model"].as_str(), json["approval"].as_str()), (Some("haiku"), Some("all")));
    }
}
