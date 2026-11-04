//! Skill page: the owner's personal skills and the market, read-only; they are managed on the Web (plan Skill市场-M4
//! D14). Passed through as JSON: the page reads them with the protocol's types.
use super::Result;
use crate::i18n::tr;
use gonggong::config::Config;
use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

fn config() -> Result<Config> {
    Ok(Config::load().map_err(|e| e.to_string())?.ok_or(tr!("尚未绑定"))?)
}

/// GET `path` on the bound server with the machine token; a failure carries the server's `{ message }`.
async fn get(path: &str) -> Result<Value> {
    let config = config()?;
    let res = gonggong::tls::http(&config)
        .map_err(|e| e.to_string())?
        .get(format!("{}{path}", config.server.trim_end_matches('/')))
        .bearer_auth(&config.token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or_default();
    if status.is_success() {
        return Ok(body);
    }
    Err(body["message"].as_str().map_or_else(|| status.to_string(), str::to_owned))
}

#[tauri::command]
pub async fn market_installs() -> Result<Value> {
    get("/api/daemon/me/installs").await
}

#[tauri::command]
pub async fn market_listings() -> Result<Value> {
    get("/api/daemon/market").await
}

fn web_url(server: &str, listing: Option<&str>) -> String {
    let base = format!("{}/market", server.trim_end_matches('/'));
    match listing {
        Some(id) => format!("{base}?listing={id}"),
        None => base,
    }
}

/// 在网页中打开: the market on the bound server, or one listing's detail there, in the default browser.
#[tauri::command]
pub fn open_market_in_web(listing: Option<String>, app: AppHandle) -> Result<()> {
    let url = web_url(&config()?.server, listing.as_deref());
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn opens_the_market_of_the_bound_server() {
        assert_eq!(super::web_url("https://gg.example.com/", None), "https://gg.example.com/market");
        assert_eq!(
            super::web_url("https://gg.example.com", Some("l1")),
            "https://gg.example.com/market?listing=l1"
        );
    }
}
