//! Agent page: Node.js and the agents (detection, versions, the latest on the mirror) and their installs / upgrades,
//! streamed line by line to the page. Runs the daemon's own `tools.cmd` handling ([`gonggong::manage::Manage`]).
use super::{Result, manage, relay};
use crate::host::Host;
use gonggong::manage::Manage;
use gonggong::protocol::{AgentState, DaemonToServer, RuntimeState, ToolKind, ToolsAction, ToolsCmd, ToolsSettings};
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

/// The Web's MachineAgentsDto.
#[derive(Debug, Serialize)]
pub struct MachineAgents {
    node: Option<RuntimeState>,
    agents: Vec<AgentState>,
    settings: ToolsSettings,
}

async fn tools_cmd(
    m: &Manage,
    action: ToolsAction,
    kind: Option<ToolKind>,
    progress: impl Fn(&str),
) -> Result<MachineAgents> {
    let cmd = ToolsCmd { request_id: String::new(), action, kind, version: None, mirror: None };
    relay(
        |out| m.tools(cmd, out),
        |msg| match msg {
            DaemonToServer::ToolsProgress { line, .. } => {
                progress(&line);
                None
            }
            DaemonToServer::ToolsResult { error: Some(e), .. } => Some(Err(e)),
            DaemonToServer::ToolsResult { node, agents, settings, .. } => {
                Some(Ok(MachineAgents { node, agents, settings }))
            }
            _ => None,
        },
    )
    .await?
}

/// Every call is a 重新检测: a changed detection reaches the server right away, updating the bots' presence.
#[tauri::command]
pub async fn tools(host: State<'_, Host>) -> Result<MachineAgents> {
    let state = tools_cmd(&manage(&host.home), ToolsAction::Status, None, |_| {}).await?;
    host.report_agents(state.agents.clone());
    Ok(state)
}

/// 安装 / 升级 / 改用共工空间托管安装; afterwards the new detection reaches the server like 重新检测.
#[tauri::command]
pub async fn run_tool(
    op: ToolOp,
    kind: ToolKind,
    op_id: String,
    app: AppHandle,
    host: State<'_, Host>,
) -> Result<MachineAgents> {
    let action = match op {
        ToolOp::Install => ToolsAction::Install,
        ToolOp::Upgrade => ToolsAction::Upgrade,
    };
    let progress = |line: &str| {
        let _ = app.emit(PROGRESS_EVENT, ProgressLine { op_id: &op_id, line });
    };
    let state = tools_cmd(&manage(&host.home), action, Some(kind), progress).await;
    if let Ok(local) = gonggong::local::LocalSettings::load(&host.home) {
        host.report_agents(gonggong::agents::detect(&host.home, &local));
    }
    state
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A temporary home whose mirror refuses at once, so no test reaches the network.
    fn offline() -> (tempfile::TempDir, Manage) {
        let home = tempfile::tempdir().unwrap();
        let mut settings = gonggong::config::Settings::default();
        let refused = "http://127.0.0.1:9/".to_string();
        settings.mirror = gonggong::config::Mirror::Custom { registry: refused.clone(), node: refused };
        settings.save(home.path()).unwrap();
        let m = Manage::new(home.path().to_path_buf(), home.path().to_path_buf());
        (home, m)
    }

    #[test]
    fn status_lists_every_agent_of_the_registry_with_the_mirror() {
        let (_home, m) = offline();
        let state = tauri::async_runtime::block_on(tools_cmd(&m, ToolsAction::Status, None, |_| {})).unwrap();
        assert!(state.agents.iter().any(|a| a.kind == gonggong::protocol::AgentKind::Claude));
        let json = serde_json::to_value(&state).unwrap();
        assert_eq!(json["settings"]["mirror"]["kind"], "custom");
    }

    #[test]
    fn a_failed_op_rejects_with_its_error() {
        let (_home, m) = offline();
        let err = tauri::async_runtime::block_on(tools_cmd(&m, ToolsAction::Install, None, |_| {}));
        assert!(err.is_err());
    }
}
