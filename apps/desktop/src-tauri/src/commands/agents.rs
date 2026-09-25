//! Agent page: detected CLIs with their local settings (path, default model, effort) and the models each adapter
//! offered. Settings apply from the next turn.
use super::{Result, local};
use crate::host::Host;
use gonggong::local::{AgentModels, LocalSettings, load_models};
use gonggong::protocol::{AgentInfo, AgentKind};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCard {
    #[serde(flatten)]
    info: AgentInfo,
    /// The path comes from 更换路径 rather than detection.
    custom_path: bool,
    default_model: Option<String>,
    effort: Option<String>,
    /// What the adapter offered in its latest new session; `None` until the agent ran once here.
    catalog: Option<AgentModels>,
    /// e.g. 已登录 · Claude Max; `None` when unknown or not installed.
    login: Option<String>,
}

fn cards(
    local: &LocalSettings,
    mut catalog: BTreeMap<AgentKind, AgentModels>,
    login: impl Fn(AgentKind, &Path) -> Option<String>,
) -> Vec<AgentCard> {
    gonggong::agents::detect(local)
        .into_iter()
        .map(|info| {
            let s = local.agent(info.kind);
            let login = info.path.as_deref().filter(|_| info.available).and_then(|p| login(info.kind, Path::new(p)));
            AgentCard {
                custom_path: s.path.is_some(),
                default_model: s.default_model,
                effort: s.effort,
                catalog: catalog.remove(&info.kind),
                login,
                info,
            }
        })
        .collect()
}

/// Runs the CLIs (`--version`, login status), so off the async runtime. Every call is a 重新检测: a changed
/// detection (installed, path set or reset) reaches the server right away, updating the bots' presence.
#[tauri::command]
pub async fn agents(host: State<'_, Host>) -> Result<Vec<AgentCard>> {
    let home = host.home.clone();
    let list = tauri::async_runtime::spawn_blocking(move || {
        let local = LocalSettings::load(&home).map_err(|e| format!("{e:#}"))?;
        Ok::<_, String>(cards(&local, load_models(&home), gonggong::agents::login_status))
    })
    .await
    .map_err(|e| e.to_string())??;
    host.report_agents(list.iter().map(|c| c.info.clone()).collect());
    Ok(list)
}

/// `None` = the adapter's default.
#[tauri::command]
pub fn set_agent_model(kind: AgentKind, model: Option<String>, host: State<'_, Host>) -> Result<()> {
    local(&host.home, |s| s.agents.entry(kind).or_default().default_model = model)
}

/// `None` = the adapter's default.
#[tauri::command]
pub fn set_agent_effort(kind: AgentKind, effort: Option<String>, host: State<'_, Host>) -> Result<()> {
    local(&host.home, |s| s.agents.entry(kind).or_default().effort = effort)
}

fn set_path(home: &Path, kind: AgentKind, path: Option<PathBuf>) -> Result<()> {
    if let Some(p) = &path
        && !p.is_file()
    {
        return Err(format!("找不到 {}", p.display()));
    }
    local(home, |s| s.agents.entry(kind).or_default().path = path.map(|p| p.to_string_lossy().into_owned()))
}

/// 更换路径 / 手动指定路径: picks the CLI with the system file dialog. Returns false when cancelled.
#[tauri::command]
pub async fn pick_agent_path(kind: AgentKind, app: AppHandle, host: State<'_, Host>) -> Result<bool> {
    let title = format!("选择 {} 可执行文件", gonggong::bots::agent_label(kind));
    let Some(picked) = app.dialog().file().set_title(title).blocking_pick_file() else { return Ok(false) };
    set_path(&host.home, kind, Some(picked.into_path().map_err(|e| e.to_string())?))?;
    Ok(true)
}

/// Back to detection on PATH.
#[tauri::command]
pub fn reset_agent_path(kind: AgentKind, host: State<'_, Host>) -> Result<()> {
    set_path(&host.home, kind, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use gonggong::local::{AgentSettings, Choice};

    #[test]
    fn cards_merge_detection_settings_catalog_and_login() {
        let exe = std::env::current_exe().unwrap();
        let mut local = LocalSettings::default();
        let settings = AgentSettings {
            path: Some(exe.to_string_lossy().into()),
            default_model: Some("haiku".into()),
            effort: Some("high".into()),
        };
        local.agents.insert(AgentKind::Claude, settings);
        local.agents.insert(AgentKind::Codex, AgentSettings { path: Some("/nope/codex".into()), ..Default::default() });
        let models = AgentModels {
            models: vec![Choice { value: "haiku".into(), name: "Haiku".into(), description: None }],
            ..Default::default()
        };
        let catalog = BTreeMap::from([(AgentKind::Claude, models.clone())]);
        let list = cards(&local, catalog, |kind, _| Some(format!("{kind:?} ok")));
        let claude = &list[0];
        assert!(claude.info.available && claude.custom_path);
        assert_eq!((claude.default_model.as_deref(), claude.effort.as_deref()), (Some("haiku"), Some("high")));
        assert_eq!(claude.catalog.as_ref(), Some(&models));
        assert_eq!(claude.login.as_deref(), Some("Claude ok"));
        let codex = &list[1];
        assert!(!codex.info.available);
        assert_eq!((codex.login.as_ref(), codex.catalog.as_ref()), (None, None));
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
