//! Agent page: Node.js, Claude Code and Codex as managed tools (design §4.1): versions, the latest on the mirror,
//! and installs / upgrades streamed line by line to the page.
use super::Result;
use crate::host::Host;
use gonggong::local::LocalSettings;
use gonggong::tools::{self, ToolKind, ToolStatus};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

/// Carries each output line of a `run_tool` (`onToolProgress` in `src/ipc.ts`).
const PROGRESS_EVENT: &str = "tools://progress";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressLine<'a> {
    op_id: &'a str,
    line: &'a str,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolOp {
    Install,
    Upgrade,
}

/// Detection runs the CLIs and the latest check hits the mirror, so off the async workers the daemon shares.
#[tauri::command]
pub async fn tools(host: State<'_, Host>) -> Result<Vec<ToolStatus>> {
    let home = host.home.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let local = LocalSettings::load(&home).map_err(|e| format!("{e:#}"))?;
        Ok(tauri::async_runtime::block_on(tools::status(&home, &local)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 安装 / 升级 / 安装共工托管版; afterwards the new detection reaches the server like 重新检测.
#[tauri::command]
pub async fn run_tool(
    op: ToolOp,
    kind: ToolKind,
    op_id: String,
    app: AppHandle,
    host: State<'_, Host>,
) -> Result<ToolStatus> {
    let progress = |line: &str| {
        let _ = app.emit(PROGRESS_EVENT, ProgressLine { op_id: &op_id, line });
    };
    let result = match op {
        ToolOp::Install => tools::install(&host.home, kind, None, &progress).await,
        ToolOp::Upgrade => tools::upgrade(&host.home, kind, &progress).await,
    };
    if let Ok(local) = LocalSettings::load(&host.home) {
        host.report_agents(gonggong::agents::detect(&host.home, &local));
    }
    result.map_err(|e| format!("{e:#}"))
}
