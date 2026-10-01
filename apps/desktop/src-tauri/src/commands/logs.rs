use super::Result;
use crate::host::Host;
use crate::i18n::tr;
use gonggong::config::Config;
use gonggong::diag::{self, Check};
use gonggong::logs::{LogLevel, LogLine, Logs};
use gonggong::net::NetResult;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

fn config() -> Option<Config> {
    Config::load().ok().flatten()
}

#[tauri::command]
pub async fn diagnostics(host: State<'_, Host>) -> Result<Vec<Check>> {
    Ok(diag::run(&host.home, config().as_ref()).await)
}

/// 测量延迟与带宽: measured and reported to the server.
#[tauri::command]
pub async fn measure_net() -> Result<NetResult> {
    let config = config().ok_or(tr!("尚未绑定"))?;
    gonggong::net::run(&config).await.map_err(|e| format!("{e:#}"))
}

/// 导出诊断包: asks where to save; `None` when cancelled.
#[tauri::command]
pub async fn export_diagnostics(app: AppHandle, host: State<'_, Host>) -> Result<Option<String>> {
    let default = diag::default_bundle_path();
    let mut dialog = app.dialog().file().add_filter("zip", &["zip"]);
    if let Some(dir) = default.parent() {
        dialog = dialog.set_directory(dir);
    }
    if let Some(name) = default.file_name() {
        dialog = dialog.set_file_name(name.to_string_lossy());
    }
    let Some(dest) = dialog.blocking_save_file() else { return Ok(None) };
    let dest = dest.into_path().map_err(|e| e.to_string())?;
    let config = config();
    let checks = diag::run(&host.home, config.as_ref()).await;
    diag::bundle(&host.home, config.as_ref(), &checks, &dest).map_err(|e| format!("{e:#}"))?;
    Ok(Some(dest.to_string_lossy().into_owned()))
}

/// Recent lines of this app's own log (the ring `gonggong::logs::init` set up in `main`).
#[tauri::command]
pub fn recent_logs(level: LogLevel, limit: usize, logs: State<'_, Logs>) -> Vec<LogLine> {
    logs.recent(level, limit)
}
