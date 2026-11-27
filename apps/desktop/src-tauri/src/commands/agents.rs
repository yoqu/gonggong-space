//! Agent page, what only this machine tells about an agent: a path picked by hand (更换路径…), the CLI's login and
//! the bundled ACP adapter's version.
use super::Result;
use crate::host::Host;
use crate::i18n::tr;
use gonggong::local::{LocalSettings, LocalStore};
use gonggong::protocol::{AgentKind, DaemonToServer};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Tauri event streaming `DaemonToServer::AgentLogin*` JSON payloads during interactive ACP login.
const AGENT_LOGIN_EVENT: &str = "agent-login-event";

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLocal {
    /// The path comes from 更换路径 rather than detection.
    custom_path: bool,
    /// e.g. 已登录 · Claude Max; `None` when unknown or not installed.
    login: Option<String>,
    /// `None` when the CLI speaks ACP itself.
    adapter_version: Option<&'static str>,
}

fn adapter_version(kind: AgentKind) -> Option<&'static str> {
    gonggong::engine::ADAPTERS
        .iter()
        .find(|(k, ..)| *k == kind)
        .map(|(.., v)| *v)
        .or_else(|| gonggong::adapters::get(kind)?.adapter_version())
}

fn agent_local_of(
    home: &Path,
    local: &LocalSettings,
    kind: AgentKind,
    login: impl Fn(AgentKind, &Path) -> Option<String>,
) -> AgentLocal {
    let cli = gonggong::agents::locate(home, kind, local).filter(|p| p.is_file());
    AgentLocal {
        custom_path: local.agent(kind).path.is_some(),
        login: cli.and_then(|p| login(kind, &p)),
        adapter_version: adapter_version(kind),
    }
}

/// Runs the CLI (login status), so off the async runtime.
#[tauri::command]
pub async fn agent_local(kind: AgentKind, host: State<'_, Host>) -> Result<AgentLocal> {
    let home = host.home.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let local = LocalSettings::load(&home).map_err(|e| format!("{e:#}"))?;
        Ok(agent_local_of(&home, &local, kind, gonggong::agents::login_status))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn set_path(home: &Path, kind: AgentKind, path: Option<PathBuf>) -> Result<()> {
    if let Some(p) = &path
        && !p.is_file()
    {
        return Err(tr!("找不到 {path}", path = p.display()));
    }
    LocalStore::open(home.to_path_buf())
        .and_then(|store| {
            store.update(|s| s.agents.entry(kind).or_default().path = path.map(|p| p.to_string_lossy().into_owned()))
        })
        .map(drop)
        .map_err(|e| format!("{e:#}"))
}

/// 更换路径 / 手动指定路径: picks the CLI with the system file dialog. Returns false when cancelled.
#[tauri::command]
pub async fn pick_agent_path(kind: AgentKind, app: AppHandle, host: State<'_, Host>) -> Result<bool> {
    let title = tr!("选择 {agent} 可执行文件", agent = gonggong::bots::agent_label(kind));
    let Some(picked) = app.dialog().file().set_title(title).blocking_pick_file() else { return Ok(false) };
    set_path(&host.home, kind, Some(picked.into_path().map_err(|e| e.to_string())?))?;
    Ok(true)
}

/// 恢复自动检测: back to detection on PATH.
#[tauri::command]
pub fn reset_agent_path(kind: AgentKind, host: State<'_, Host>) -> Result<()> {
    set_path(&host.home, kind, None)
}

/// Names of the groups this machine's bots are in, for the sessions a provider switch leaves behind; empty when the
/// server cannot be reached (ids stand in then).
#[tauri::command]
pub async fn group_names() -> BTreeMap<String, String> {
    let Some(config) = gonggong::config::Config::load().ok().flatten() else { return BTreeMap::new() };
    gonggong::workspace::fetch_pairs(&config)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|p| (p.group_id, p.group_name))
        .collect()
}

/// Starts an interactive ACP login flow for `kind`, emitting `agent-login-event` updates (`DaemonToServer::AgentLogin*`).
/// Returns the generated `opId` so the UI can correlate events and cancel the operation.
#[tauri::command]
pub async fn agent_login_start(
    app: AppHandle,
    host: State<'_, Host>,
    kind: AgentKind,
    method_id: Option<String>,
    open_browser: Option<bool>,
) -> Result<String> {
    let op_id = gonggong::agent_login::new_op_id();
    let home = host.home.clone();
    let engine = host.engine().unwrap_or_else(|| {
        gonggong::engine::Engine::new(gonggong::engine::EngineConfig {
            home: home.clone(),
            user_home: gonggong::config::user_home(),
            adapter_cmd: None,
            idle: std::time::Duration::from_secs(60),
            reap: std::time::Duration::from_secs(60),
            cancel_grace: std::time::Duration::from_secs(5),
            continuation: Default::default(),
            api: None,
        })
    });
    let open_browser = open_browser.unwrap_or(false);
    let emit_app = app.clone();
    let emit: Arc<dyn Fn(DaemonToServer) + Send + Sync> = Arc::new(move |msg| {
        let _ = emit_app.emit(AGENT_LOGIN_EVENT, msg);
    });
    let done_app = app.clone();
    let done_home = home.clone();
    let on_success: gonggong::agent_login::OnSuccessFn = Box::new(move || {
        Box::pin(async move {
            let h = done_home.clone();
            if let Ok(Ok(agents)) = tauri::async_runtime::spawn_blocking(move || {
                LocalSettings::load(&h).map(|local| gonggong::agents::detect(&h, &local))
            })
            .await
            {
                let host = done_app.state::<Host>();
                host.report_agents(agents);
                host.reprobe_agent(kind);
            }
        })
    });
    let config_fut = async move { engine.login_config(kind).await };
    host.agent_login().start(home, op_id.clone(), kind, method_id, open_browser, config_fut, emit, Some(on_success));
    Ok(op_id)
}

#[tauri::command]
pub async fn agent_login_cancel(host: State<'_, Host>, op_id: String) -> Result<()> {
    host.agent_login().cancel(&op_id);
    Ok(())
}

/// Opens a native terminal window with managed Node + tools prepended to `PATH` and runs `kind`'s login command.
#[tauri::command]
pub async fn agent_launch_login(host: State<'_, Host>, kind: AgentKind) -> Result<()> {
    let home = host.home.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let local = LocalSettings::load(&home).map_err(|e| format!("{e:#}"))?;
        let custom_path = local.agent(kind).path;
        gonggong::open_apps::launch_agent_login_terminal(&home, kind, custom_path.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use gonggong::local::AgentSettings;

    #[test]
    fn local_info_merges_the_custom_path_login_and_adapter() {
        let home = tempfile::tempdir().unwrap();
        let exe = std::env::current_exe().unwrap();
        let mut local = LocalSettings::default();
        local.agents.insert(AgentKind::Claude, AgentSettings { path: Some(exe.to_string_lossy().into()) });
        local.agents.insert(AgentKind::Codex, AgentSettings { path: Some("/nope/codex".into()) });
        let login = |kind: AgentKind, _: &Path| Some(format!("{kind:?} ok"));
        assert_eq!(
            agent_local_of(home.path(), &local, AgentKind::Claude, login),
            AgentLocal { custom_path: true, login: Some("Claude ok".into()), adapter_version: Some("0.81.0") }
        );
        let codex = agent_local_of(home.path(), &local, AgentKind::Codex, login);
        assert!(codex.custom_path);
        assert_eq!(codex.login, None, "no login asked of a CLI that is not there");
        let json = serde_json::to_value(&codex).unwrap();
        assert_eq!(json["adapterVersion"], "2.12.0");
    }

    #[test]
    fn paths_must_exist_and_can_be_reset() {
        let home = tempfile::tempdir().unwrap();
        let exe = std::env::current_exe().unwrap();
        assert!(set_path(home.path(), AgentKind::Codex, Some("/nope/codex".into())).is_err());
        set_path(home.path(), AgentKind::Codex, Some(exe.clone())).unwrap();
        let path = LocalSettings::load(home.path()).unwrap().agent(AgentKind::Codex).path;
        assert_eq!(path, Some(exe.to_string_lossy().into_owned()));
        set_path(home.path(), AgentKind::Codex, None).unwrap();
        assert_eq!(LocalSettings::load(home.path()).unwrap().agent(AgentKind::Codex).path, None);
    }
}
