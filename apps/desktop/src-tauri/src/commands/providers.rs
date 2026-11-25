//! Agent page: this machine's providers, official logins and agent settings in `providers.json`. Every change goes
//! through the daemon's own `providers.cmd` / `ccswitch.*` handling ([`Manage`]), so the desktop app and the Web
//! (relayed by the server) behave the same; keys only ever arrive, what leaves is masked.
use super::{Result, manage, relay};
use crate::host::Host;
use crate::i18n::tr;
use gonggong::ccswitch::CandidateView;
use gonggong::manage::Manage;
use gonggong::protocol::{DaemonToServer, ProvidersCmd, ProvidersResult};
use gonggong::providers::StoreView;
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

/// DaemonFeature values of this machine's client (the page shows what the daemon supports, like on the Web).
#[tauri::command]
pub fn agent_features(host: State<'_, Host>) -> Vec<String> {
    manage(&host.home).features()
}

/// One `providers.cmd` (presets, list, save, remove, use, official, agentSettings, importLink…).
#[tauri::command]
pub async fn providers_cmd(cmd: ProvidersCmd, host: State<'_, Host>) -> Result<ProvidersResult> {
    providers(&manage(&host.home), cmd).await
}

async fn providers(m: &Manage, cmd: ProvidersCmd) -> Result<ProvidersResult> {
    let r = relay(
        |out| m.providers(cmd, out),
        |msg| match msg {
            DaemonToServer::ProvidersResult(r) => Some(r),
            _ => None,
        },
    )
    .await?;
    match r.ok {
        true => Ok(r),
        false => Err(r.error.unwrap_or_default()),
    }
}

/// CC Switch's providers that 导入 would add or update.
#[tauri::command]
pub async fn ccswitch_preview(host: State<'_, Host>) -> Result<Vec<CandidateView>> {
    let m = manage(&host.home);
    ccswitch(|out| m.ccswitch_read(String::new(), out)).await.map(|r| r.candidates)
}

#[derive(Debug, Serialize)]
pub struct Imported {
    imported: Vec<String>,
    view: Option<StoreView>,
}

/// Imports the chosen CC Switch providers; the default is switched afterwards like any other switch.
#[tauri::command]
pub async fn ccswitch_apply(keys: Vec<String>, host: State<'_, Host>) -> Result<Imported> {
    let m = manage(&host.home);
    ccswitch(|out| m.ccswitch_apply(String::new(), keys, false, out))
        .await
        .map(|r| Imported { imported: r.imported, view: r.view })
}

struct CcSwitch {
    candidates: Vec<CandidateView>,
    imported: Vec<String>,
    view: Option<StoreView>,
}

async fn ccswitch(send: impl FnOnce(&gonggong::service::Outbox)) -> Result<CcSwitch> {
    relay(send, |msg| match msg {
        DaemonToServer::CcSwitchResult { error, candidates, imported, view, .. } => Some(match error {
            Some(e) => Err(e),
            None => Ok(CcSwitch { candidates, imported, view }),
        }),
        _ => None,
    })
    .await?
}

/// Hidden Claude directories in the home (`~/.claude-work`), offered as local profiles; not the official `~/.claude`.
#[tauri::command]
pub fn claude_dirs() -> Vec<String> {
    claude_dirs_in(&gonggong::config::user_home())
}

fn claude_dirs_in(home: &Path) -> Vec<String> {
    let mut dirs: Vec<String> = std::fs::read_dir(home)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let profile = name.starts_with('.') && name.to_lowercase().contains("claude") && name != ".claude";
            profile.then(|| e.path().to_string_lossy().into_owned())
        })
        .collect();
    dirs.sort();
    dirs
}

/// The CLI's own default config directory, filled in by 使用默认目录; it may not exist before Claude Code first ran.
#[derive(Debug, Serialize, PartialEq)]
pub struct ClaudeDefaultDir {
    path: String,
    exists: bool,
}

#[tauri::command]
pub fn claude_default_dir() -> ClaudeDefaultDir {
    let dir = gonggong::config::default_claude_dir();
    ClaudeDefaultDir { exists: dir.is_dir(), path: dir.to_string_lossy().into_owned() }
}

/// 选择配置目录 of a local Claude profile, with the system folder dialog; None when cancelled.
#[tauri::command]
pub async fn pick_dir(start: Option<String>, app: AppHandle) -> Result<Option<String>> {
    let mut dialog = app.dialog().file().set_title(tr!("选择配置目录"));
    if let Some(start) = start {
        dialog = dialog.set_directory(start);
    }
    let Some(picked) = dialog.blocking_pick_folder() else { return Ok(None) };
    Ok(Some(picked.into_path().map_err(|e| e.to_string())?.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use gonggong::protocol::{AgentKind, ApiProtocol, EndpointInput, ProviderInput, ProvidersAction};

    fn cmd(action: ProvidersAction) -> ProvidersCmd {
        ProvidersCmd {
            request_id: String::new(),
            action,
            agent: None,
            bot_id: None,
            id: None,
            choice: None,
            model: None,
            provider: None,
            official: None,
            agent_settings: None,
            link: None,
            set_default: None,
        }
    }

    /// Both homes temporary: the real `~/.gonggong` and `~/.claude` are never touched.
    fn run(home: &Path, c: ProvidersCmd) -> Result<ProvidersResult> {
        let m = Manage::new(home.join("gg"), home.to_path_buf());
        tauri::async_runtime::block_on(providers(&m, c))
    }

    #[test]
    fn saves_a_vendor_with_two_protocols_and_makes_it_a_default_with_a_model() {
        let home = tempfile::tempdir().unwrap();
        let endpoint =
            |protocol, url: &str| EndpointInput { base_url: Some(url.into()), ..EndpointInput::new(protocol) };
        let saved = run(
            home.path(),
            ProvidersCmd {
                provider: Some(ProviderInput {
                    name: Some("Kimi".into()),
                    api_key: Some("sk-0123456789abcd".into()),
                    endpoints: Some(vec![
                        endpoint(ApiProtocol::Anthropic, "https://k.test/anthropic"),
                        endpoint(ApiProtocol::Openai, "https://k.test/v1"),
                    ]),
                    ..Default::default()
                }),
                ..cmd(ProvidersAction::Save)
            },
        )
        .unwrap();
        let id = saved.id.unwrap();
        let view = saved.view.unwrap();
        assert_eq!(view.providers[0].endpoints.len(), 2);
        assert_eq!(view.providers[0].api_key, "****abcd", "keys leave masked");

        let used = run(
            home.path(),
            ProvidersCmd {
                agent: Some(AgentKind::Codex),
                choice: Some(id.clone()),
                model: Some("kimi-k2".into()),
                ..cmd(ProvidersAction::Use)
            },
        )
        .unwrap();
        let d = serde_json::to_value(&used.view.unwrap().machine).unwrap();
        assert_eq!(d["codex"], serde_json::json!({ "provider": id, "model": "kimi-k2" }));

        let removed = run(home.path(), ProvidersCmd { id: Some(id), ..cmd(ProvidersAction::Remove) }).unwrap();
        assert!(removed.view.unwrap().providers.is_empty());
    }

    #[test]
    fn errors_reach_the_page_as_the_message() {
        let home = tempfile::tempdir().unwrap();
        let err = run(home.path(), ProvidersCmd { id: Some("nope".into()), ..cmd(ProvidersAction::Catalog) });
        assert!(err.unwrap_err().contains("nope"));
    }

    #[test]
    fn claude_dirs_are_the_hidden_profiles_but_the_official_one() {
        let home = tempfile::tempdir().unwrap();
        for d in [".claude", ".claude-work", ".Claude-Team", "claude-visible", ".codex"] {
            std::fs::create_dir(home.path().join(d)).unwrap();
        }
        std::fs::write(home.path().join(".claude.json"), "{}").unwrap();
        let p = |n: &str| home.path().join(n).to_string_lossy().into_owned();
        assert_eq!(claude_dirs_in(home.path()), vec![p(".Claude-Team"), p(".claude-work")]);
    }
}
