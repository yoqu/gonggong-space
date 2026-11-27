use super::Result;
use crate::host::{Host, Snapshot};
use crate::i18n::tr;
use gonggong::config::Config;
use gonggong::protocol::{AgentKind, MachineInfo, PROTOCOL_VERSION};
use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: &'static str,
    protocol: u32,
    machine: MachineInfo,
    /// `None` until bound.
    owner_name: Option<String>,
    server: Option<String>,
    workspaces_dir: String,
    backups_dir: String,
    adapters: Vec<Adapter>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Adapter {
    kind: AgentKind,
    package: &'static str,
    version: &'static str,
}

#[tauri::command]
pub fn app_info(host: State<'_, Host>) -> Result<AppInfo> {
    let config = Config::load().map_err(|e| e.to_string())?;
    Ok(AppInfo {
        version: gonggong::upgrade::CURRENT,
        protocol: PROTOCOL_VERSION,
        machine: gonggong::bind::machine_info(),
        owner_name: config.as_ref().map(|c| c.owner_name.clone()),
        server: config.as_ref().map(|c| c.server.clone()),
        workspaces_dir: host.home.join("workspaces").display().to_string(),
        backups_dir: host.home.join("backups").display().to_string(),
        adapters: gonggong::engine::ADAPTERS
            .iter()
            .map(|&(kind, package, version)| Adapter { kind, package, version })
            .collect(),
    })
}

/// The frontend's language (`gg.locale`), sent at startup: native texts and the in-process daemon follow it.
#[tauri::command]
pub fn set_locale(locale: String, app: AppHandle) -> Result<()> {
    gonggong::i18n::set_locale(gonggong::i18n::resolve(&locale));
    crate::localize(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn snapshot(host: State<'_, Host>) -> Snapshot {
    host.snapshot()
}

/// 已连接 pill: the bound server's web app in the default browser (its own sign-in, no token handed over).
#[tauri::command]
pub fn open_web(app: AppHandle) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let config = Config::load().map_err(|e| e.to_string())?.ok_or(tr!("尚未绑定"))?;
    app.opener().open_url(format!("{}/", config.server.trim_end_matches('/')), None::<&str>).map_err(|e| e.to_string())
}

fn validate_external_url(url: &str) -> Result<String> {
    gonggong::agent_login::validate_http_url(url).ok_or_else(|| tr!("仅支持打开 http/https 链接").to_string())
}

/// Opens an external `http://` or `https://` URL (e.g. an agent OAuth login page) in the system browser.
#[tauri::command]
pub fn open_external_url(url: String, app: AppHandle) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let valid = validate_external_url(&url)?;
    app.opener().open_url(valid, None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::validate_external_url;

    #[test]
    fn external_url_rejects_non_http_and_malformed_inputs() {
        assert_eq!(
            validate_external_url("https://copilot.tencent.com/oauth?state=1").as_deref(),
            Ok("https://copilot.tencent.com/oauth?state=1")
        );
        assert!(validate_external_url("http://127.0.0.1:8080/cb").is_ok());
        assert!(validate_external_url("file:///etc/passwd").is_err());
        assert!(validate_external_url("javascript:alert(1)").is_err());
        assert!(validate_external_url("https://").is_err());
        assert!(validate_external_url("https://example.com/a b").is_err());
        assert!(validate_external_url("https://example.com/\r\ncalc").is_err());
        assert!(validate_external_url("https://example.com/\"&calc").is_err());
    }
}
