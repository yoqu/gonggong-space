//! Bot page: the machine's bots as the server reports them, read-only; they are managed on the Web (plan J11).
use super::{Result, client};
use gonggong::bots::Bot;
use gonggong::config::Config;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn bots() -> Result<Vec<Bot>> {
    client()?.list().await.map_err(|e| e.to_string())
}

/// 在 Web 中管理 / 确认: the bot's settings on the bound server, in the default browser.
#[tauri::command]
pub fn open_bot_in_web(id: String, app: AppHandle) -> Result<()> {
    let config = Config::load().map_err(|e| e.to_string())?.ok_or("尚未绑定")?;
    app.opener().open_url(gonggong::bots::web_url(&config.server, &id), None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bots_serialize_with_their_server_settings_for_the_page() {
        let bot: Bot = serde_json::from_str(
            r#"{"id":"b1","name":"小王的 Claude","agentKind":"claude","binding":"pending_confirm","presence":"online",
                "concurrency":2,"approval":"allowlist","allowlist":["go build"],"ownerName":"王磊"}"#,
        )
        .unwrap();
        let json = serde_json::to_value(bot).unwrap();
        assert_eq!(json["binding"], "pending_confirm");
        assert_eq!((json["concurrency"].as_u64(), json["approval"].as_str()), (Some(2), Some("allowlist")));
        assert_eq!(json["allowlist"], serde_json::json!(["go build"]));
        assert_eq!(json["avatar"], "role-gong", "older servers send no avatar");
        let mut sent = json;
        sent["avatar"] = "role-sentry".into();
        assert_eq!(serde_json::from_value::<Bot>(sent).unwrap().avatar, "role-sentry");
    }
}
