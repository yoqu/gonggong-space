//! Bot page: the machine's bots with their 本机设置 (command approval) and the server-side 并发上限.
use super::{Result, client, local};
use crate::host::Host;
use gonggong::bots::Bot;
use gonggong::local::{Approval, BotSettings, LocalSettings};
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
    settings.bots.insert(id.to_string(), BotSettings { approval: change.approval, allowlist });
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
    fn saving_trims_and_dedups_the_allowlist() {
        let mut s = LocalSettings::default();
        let change = BotChange {
            approval: Approval::Allowlist,
            allowlist: vec!["go build".into(), " go build ".into(), "".into(), "npm test".into()],
            concurrency: None,
        };
        apply(&mut s, "b1", &change);
        assert_eq!(
            s.bot("b1"),
            BotSettings { approval: Approval::Allowlist, allowlist: vec!["go build".into(), "npm test".into()] }
        );
        s.validate().unwrap();
    }

    #[test]
    fn cards_serialize_flat_for_the_page() {
        let bot: Bot = serde_json::from_str(
            r#"{"id":"b1","name":"小王的 Claude","agentKind":"claude","binding":"bound","presence":"online","concurrency":2}"#,
        )
        .unwrap();
        let local = BotSettings { approval: Approval::All, allowlist: vec![] };
        let json = serde_json::to_value(BotCard { bot, local }).unwrap();
        assert_eq!((json["concurrency"].as_u64(), json["approval"].as_str()), (Some(2), Some("all")));
    }
}
