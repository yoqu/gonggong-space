use super::Result;
use crate::host::{Host, Snapshot};
use gonggong::config::Config;
use gonggong::protocol::{AgentKind, MachineInfo, PROTOCOL_VERSION};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: &'static str,
    protocol: u32,
    machine: MachineInfo,
    /// `None` until bound.
    owner_name: Option<String>,
    server: Option<String>,
    cert_pinned: bool,
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
        cert_pinned: config.as_ref().is_some_and(|c| c.cert_sha256.is_some()),
        workspaces_dir: host.home.join("workspaces").display().to_string(),
        backups_dir: host.home.join("backups").display().to_string(),
        adapters: gonggong::engine::ADAPTERS
            .iter()
            .map(|&(kind, package, version)| Adapter { kind, package, version })
            .collect(),
    })
}

#[tauri::command]
pub fn snapshot(host: State<'_, Host>) -> Snapshot {
    host.snapshot()
}
