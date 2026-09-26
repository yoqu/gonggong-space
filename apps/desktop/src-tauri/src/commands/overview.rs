use super::workspaces::{entries, summary};
use crate::host::Host;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct WorkspaceStat {
    count: usize,
    detail: String,
}

#[derive(Serialize)]
pub struct Overview {
    workspaces: WorkspaceStat,
}

#[tauri::command]
pub async fn overview(host: State<'_, Host>) -> super::Result<Overview> {
    let (count, detail) = summary(&entries(&host.home).await.0);
    Ok(Overview { workspaces: WorkspaceStat { count, detail } })
}

/// One run's process for the detail view; None once it aged out (or the daemon is not running).
#[tauri::command]
pub fn run_process(host: State<'_, Host>, run_id: String) -> Option<gonggong::status::Process> {
    host.process(&run_id)
}
