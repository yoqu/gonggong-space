use super::Result;
use crate::host::Host;
use gonggong::config::{Mirror, Settings};
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    auto_upgrade: bool,
    launch_at_login: bool,
    mirror: Mirror,
}

#[tauri::command]
pub fn get_settings(app: AppHandle, host: State<'_, Host>) -> Result<SettingsDto> {
    let settings = Settings::load(&host.home).map_err(|e| e.to_string())?;
    Ok(SettingsDto {
        auto_upgrade: settings.auto_upgrade,
        launch_at_login: app.autolaunch().is_enabled().map_err(|e| e.to_string())?,
        mirror: settings.mirror,
    })
}

#[tauri::command]
pub fn set_auto_upgrade(on: bool, host: State<'_, Host>) -> Result<()> {
    let mut settings = Settings::load(&host.home).map_err(|e| e.to_string())?;
    settings.auto_upgrade = on;
    settings.save(&host.home).map_err(|e| e.to_string())
}

fn http_url(s: &str) -> Result<String> {
    let s = s.trim();
    match tauri::Url::parse(s) {
        Ok(u) if matches!(u.scheme(), "http" | "https") && u.has_host() => Ok(s.to_string()),
        _ => Err(format!("不是有效的 http(s) 地址：{s}")),
    }
}

fn save_mirror(home: &Path, mirror: Mirror) -> Result<()> {
    let mirror = match mirror {
        Mirror::Custom { registry, node } => Mirror::Custom { registry: http_url(&registry)?, node: http_url(&node)? },
        other => other,
    };
    let mut settings = Settings::load(home).map_err(|e| e.to_string())?;
    settings.mirror = mirror;
    settings.save(home).map_err(|e| e.to_string())
}

/// 镜像源: where Node.js and the agent CLIs are installed from.
#[tauri::command]
pub fn set_mirror(mirror: Mirror, host: State<'_, Host>) -> Result<()> {
    save_mirror(&host.home, mirror)
}

#[tauri::command]
pub fn set_launch_at_login(on: bool, app: AppHandle) -> Result<()> {
    let autostart = app.autolaunch();
    if on { autostart.enable() } else { autostart.disable() }.map_err(|e| e.to_string())
}

/// Best effort: the local unbind proceeds even when the server can't be told.
#[tauri::command]
pub async fn unbind(host: State<'_, Host>) -> Result<()> {
    if let Ok(Some(config)) = gonggong::config::Config::load()
        && let Err(e) = gonggong::bind::logout(&config).await
    {
        tracing::warn!("logout not reported to the server: {e:#}");
    }
    host.unbind();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_mirrors_need_http_urls() {
        let home = tempfile::tempdir().unwrap();
        let custom = |registry: &str| Mirror::Custom { registry: registry.into(), node: "https://n.test/node/".into() };
        assert!(save_mirror(home.path(), custom("registry.test")).is_err());
        assert!(save_mirror(home.path(), custom("ftp://r.test")).is_err());
        assert_eq!(Settings::load(home.path()).unwrap().mirror, Mirror::Npmmirror);
        save_mirror(home.path(), custom(" https://r.test/ ")).unwrap();
        assert_eq!(Settings::load(home.path()).unwrap().mirror, custom("https://r.test/"));
        save_mirror(home.path(), Mirror::Official).unwrap();
        let settings = Settings::load(home.path()).unwrap();
        assert_eq!((settings.mirror, settings.auto_upgrade), (Mirror::Official, true), "other settings kept");
    }
}
