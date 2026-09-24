use super::Result;
use crate::host::Host;
use aiws::config::Settings;
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    auto_upgrade: bool,
    launch_at_login: bool,
}

#[tauri::command]
pub fn get_settings(app: AppHandle, host: State<'_, Host>) -> Result<SettingsDto> {
    Ok(SettingsDto {
        auto_upgrade: Settings::load(&host.home).map_err(|e| e.to_string())?.auto_upgrade,
        launch_at_login: app.autolaunch().is_enabled().map_err(|e| e.to_string())?,
    })
}

#[tauri::command]
pub fn set_auto_upgrade(on: bool, host: State<'_, Host>) -> Result<()> {
    let mut settings = Settings::load(&host.home).map_err(|e| e.to_string())?;
    settings.auto_upgrade = on;
    settings.save(&host.home).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_launch_at_login(on: bool, app: AppHandle) -> Result<()> {
    let autostart = app.autolaunch();
    if on { autostart.enable() } else { autostart.disable() }.map_err(|e| e.to_string())
}

/// Best effort: the local unbind proceeds even when the server can't be told.
#[tauri::command]
pub async fn unbind(host: State<'_, Host>) -> Result<()> {
    if let Ok(Some(config)) = aiws::config::Config::load()
        && let Err(e) = aiws::bind::logout(&config).await
    {
        tracing::warn!("logout not reported to the server: {e:#}");
    }
    host.unbind();
    Ok(())
}
