//! Agent and Bot pages: this machine's model providers (design §4.2–§4.5), read and written locally in
//! `providers.json`. Keys only come in (on save); what goes back to the page is masked.
use super::Result;
use crate::host::Host;
use anyhow::Context;
use gonggong::ccswitch::{self, CandidateView};
use gonggong::config::{Config, user_home};
use gonggong::protocol::AgentKind;
use gonggong::providers::{self, ModelMap, Preset, Provider, ProviderView, Stale, Store, StoreView};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

fn err(e: anyhow::Error) -> String {
    format!("{e:#}")
}

fn cc_switch_dir() -> PathBuf {
    user_home().join(".cc-switch")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Providers {
    #[serde(flatten)]
    store: StoreView,
    /// This machine has a CC Switch to import from.
    cc_switch: bool,
}

#[tauri::command]
pub fn providers(host: State<'_, Host>) -> Result<Providers> {
    let store = Store::load(&host.home).map_err(err)?;
    Ok(Providers { store: store.view(), cc_switch: cc_switch_dir().is_dir() })
}

#[tauri::command]
pub fn provider_presets() -> Vec<Preset> {
    providers::presets(None).cloned().collect()
}

/// The provider form. No `Debug`: it may carry a key.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    /// Editing this provider; a new one otherwise.
    id: Option<String>,
    agent: AgentKind,
    preset_id: Option<String>,
    name: String,
    base_url: String,
    /// Empty keeps the stored key when editing.
    #[serde(default)]
    api_key: String,
    model: Option<String>,
    models: Option<ModelMap>,
    #[serde(default)]
    env: BTreeMap<String, String>,
}

fn some(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn env_name(k: &str) -> bool {
    k.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

impl Draft {
    fn fill(self, p: &mut Provider) {
        p.name = self.name.trim().to_string();
        p.base_url = self.base_url.trim().to_string();
        p.model = some(self.model);
        p.models = self
            .models
            .map(|m| ModelMap { haiku: some(m.haiku), sonnet: some(m.sonnet), opus: some(m.opus) })
            .filter(|m| *m != ModelMap::default());
        p.env = self.env;
        let key = self.api_key.trim();
        if !key.is_empty() {
            p.api_key = key.to_string();
        }
    }
}

/// Adds or edits a provider; returns its id.
fn save(store: &mut Store, draft: Draft) -> anyhow::Result<String> {
    if let Some(k) = draft.env.keys().find(|k| !env_name(k)) {
        anyhow::bail!("环境变量名不合法：{k}");
    }
    if let Some(id) = draft.id.clone() {
        store.edit(&id, |p| draft.fill(p))?;
        return Ok(id);
    }
    let mut p = match &draft.preset_id {
        Some(pid) => Provider::from_preset(
            providers::preset(draft.agent, pid).with_context(|| format!("没有预设 {pid}"))?,
            String::new(),
        ),
        None => Provider::custom(draft.agent, String::new(), String::new(), String::new()),
    };
    draft.fill(&mut p);
    store.add(p)
}

#[tauri::command]
pub fn save_provider(draft: Draft, host: State<'_, Host>) -> Result<String> {
    Store::update(&host.home, |s| save(s, draft)).map_err(err)
}

/// Sessions pinned to it start a new session on their next turn (§4.3).
#[tauri::command]
pub fn remove_provider(id: String, host: State<'_, Host>) -> Result<()> {
    Store::update(&host.home, |s| s.remove(&id).map(drop)).map_err(err)
}

/// `bot`: that bot's override (`choice` may be `inherit`); otherwise the machine default of `agent`.
fn choose(store: &mut Store, agent: AgentKind, choice: &str, bot: Option<&str>) -> anyhow::Result<()> {
    match bot {
        Some(bot) => store.use_bot(bot, agent, choice),
        None => store.use_machine(agent, choice),
    }
}

#[tauri::command]
pub fn choose_provider(agent: AgentKind, choice: String, bot: Option<String>, host: State<'_, Host>) -> Result<()> {
    Store::update(&host.home, |s| choose(s, agent, &choice, bot.as_deref())).map_err(err)
}

/// The (group, bot) sessions that keep their provider after the change although new sessions would switch.
fn affected(store: &Store, agent: AgentKind, choice: &str, bot: Option<&str>) -> anyhow::Result<Vec<Stale>> {
    let mut next = store.clone();
    choose(&mut next, agent, choice, bot)?;
    let mut out = vec![];
    for s in next.stale()? {
        let pin = &next.sessions[&s.session_id];
        if store.effective(pin.agent, &pin.bot_id)?.key() != next.effective(pin.agent, &pin.bot_id)?.key() {
            out.push(s);
        }
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Impact {
    group: String,
    bot: String,
    /// Provider name the session keeps.
    from: String,
    /// Provider name a new session gets.
    to: String,
}

/// What 「N 个群的会话仍在使用 X，开启新会话后才会切换到 Y」 lists before a switch; names come from the server,
/// ids stand in when it is unreachable.
#[tauri::command]
pub async fn provider_impact(
    agent: AgentKind,
    choice: String,
    bot: Option<String>,
    host: State<'_, Host>,
) -> Result<Vec<Impact>> {
    let stale = affected(&Store::load(&host.home).map_err(err)?, agent, &choice, bot.as_deref()).map_err(err)?;
    if stale.is_empty() {
        return Ok(vec![]);
    }
    let pairs = match Config::load().ok().flatten() {
        Some(config) => gonggong::workspace::fetch_pairs(&config).await.unwrap_or_default(),
        None => vec![],
    };
    Ok(stale
        .into_iter()
        .map(|s| {
            let pair = pairs.iter().find(|p| p.group_id == s.group_id && p.bot_id == s.bot_id);
            Impact {
                group: pair.map_or(s.group_id, |p| p.group_name.clone()),
                bot: pair.map_or(s.bot_id, |p| p.bot_name.clone()),
                from: s.session,
                to: s.effective,
            }
        })
        .collect())
}

#[tauri::command]
pub fn ccswitch_preview(host: State<'_, Host>) -> Result<Vec<CandidateView>> {
    let candidates = ccswitch::read(&cc_switch_dir()).map_err(err)?;
    Ok(ccswitch::preview(&candidates, &Store::load(&host.home).map_err(err)?))
}

/// Imports the chosen candidates (by `key`); making one the default goes through the confirmed switch instead.
#[tauri::command]
pub fn ccswitch_import(keys: Vec<String>, host: State<'_, Host>) -> Result<Vec<String>> {
    let candidates = ccswitch::read(&cc_switch_dir()).map_err(err)?;
    Store::update(&host.home, |s| ccswitch::apply(&candidates, &keys, false, s)).map_err(err)
}

fn import_link(home: &Path, link: &str) -> anyhow::Result<ProviderView> {
    let p = ccswitch::parse_link(link)?;
    Store::update(home, |s| {
        let id = s.upsert(p)?;
        Ok(s.get(&id).expect("just stored").view())
    })
}

/// 粘贴链接导入: a `ccswitch://v1/import?…` link.
#[tauri::command]
pub fn import_provider_link(link: String, host: State<'_, Host>) -> Result<ProviderView> {
    import_link(&host.home, &link).map_err(err)
}

/// 获取 Key: the preset's key page (else its website) in the default browser; only preset URLs are opened.
#[tauri::command]
pub fn open_key_page(agent: AgentKind, preset_id: String, app: AppHandle) -> Result<()> {
    let preset = providers::preset(agent, &preset_id).ok_or_else(|| format!("没有预设 {preset_id}"))?;
    let url = preset.api_key_url.as_ref().or(preset.website_url.as_ref()).ok_or("该厂商没有提供获取 Key 的地址")?;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use AgentKind::{Claude, Codex};
    use gonggong::providers::{OFFICIAL, Selection};

    const KEY: &str = "sk-secret-0123456789abcd";

    fn draft(over: serde_json::Value) -> Draft {
        let mut base = serde_json::json!({
            "agent": "claude", "presetId": "kimi-coding", "name": "Kimi", "baseUrl": "https://api.kimi.com/coding/",
            "apiKey": KEY, "model": "kimi-for-coding", "models": null, "env": {}
        });
        base.as_object_mut().unwrap().extend(over.as_object().unwrap().clone());
        serde_json::from_value(base).unwrap()
    }

    #[test]
    fn saves_a_preset_provider_and_keeps_the_key_when_edited_blank() {
        let mut store = Store::default();
        let id = save(
            &mut store,
            draft(serde_json::json!({ "models": { "haiku": " ", "sonnet": "k2", "opus": null }, "env": { "ENABLE_TOOL_SEARCH": "1" } })),
        )
        .unwrap();
        let p = store.get(&id).unwrap();
        assert_eq!((p.preset_id.as_deref(), p.api_key.as_str()), (Some("kimi-coding"), KEY));
        assert_eq!(p.api_key_field.as_deref(), Some(providers::AUTH_TOKEN), "preset values kept");
        assert_eq!(p.models, Some(ModelMap { haiku: None, sonnet: Some("k2".into()), opus: None }));
        assert_eq!(p.env.get("ENABLE_TOOL_SEARCH").map(String::as_str), Some("1"));

        save(&mut store, draft(serde_json::json!({ "id": id, "apiKey": "", "name": "Kimi 2", "model": "" }))).unwrap();
        let p = store.get(&id).unwrap();
        assert_eq!((p.name.as_str(), p.api_key.as_str(), p.model.as_deref(), p.revision), ("Kimi 2", KEY, None, 2));
        save(&mut store, draft(serde_json::json!({ "id": id, "apiKey": "sk-rotated-000000000000" }))).unwrap();
        assert_eq!(store.get(&id).unwrap().api_key, "sk-rotated-000000000000");
    }

    #[test]
    fn rejects_new_providers_without_key_and_bad_env_names() {
        let mut store = Store::default();
        assert!(save(&mut store, draft(serde_json::json!({ "apiKey": "  " }))).is_err());
        assert!(save(&mut store, draft(serde_json::json!({ "env": { "A=B": "1" } }))).is_err());
        assert!(save(&mut store, draft(serde_json::json!({ "presetId": "nope" }))).is_err());
        let custom =
            serde_json::json!({ "agent": "codex", "presetId": null, "name": "中转", "baseUrl": "https://r.test/v1" });
        let id = save(&mut store, draft(custom)).unwrap();
        assert_eq!(store.get(&id).unwrap().wire_api.as_deref(), Some(providers::WIRE_RESPONSES));
        assert!(store.providers.iter().all(|p| p.agent == Codex));
    }

    #[test]
    fn impact_lists_only_sessions_whose_next_provider_changes() {
        let mut store = Store::default();
        let kimi = save(&mut store, draft(serde_json::json!({}))).unwrap();
        store.pin("s1", Claude, "g1", "inherits", &Selection::Official);
        store.pin("s2", Claude, "g2", "overridden", &Selection::Official);
        store.use_bot("overridden", Claude, OFFICIAL).unwrap();
        store.pin("s3", Codex, "g1", "codex-bot", &Selection::Official);

        let machine = affected(&store, Claude, &kimi, None).unwrap();
        assert_eq!(machine.len(), 1);
        assert_eq!((machine[0].group_id.as_str(), machine[0].bot_id.as_str()), ("g1", "inherits"));
        assert_eq!((machine[0].session.as_str(), machine[0].effective.as_str()), (providers::OFFICIAL_NAME, "Kimi"));
        assert_eq!(affected(&store, Claude, &kimi, Some("overridden")).unwrap().len(), 1);
        assert!(affected(&store, Claude, OFFICIAL, None).unwrap().is_empty(), "no change");
        assert!(affected(&store, Codex, &kimi, None).is_err(), "claude provider for codex");
        assert!(store.machine.is_empty(), "the store itself is untouched");
    }

    #[test]
    fn imports_a_link_and_returns_it_masked() {
        let home = tempfile::tempdir().unwrap();
        let link = format!(
            "ccswitch://v1/import?resource=provider&app=claude&name=Relay&endpoint=https://relay.test&apiKey={KEY}"
        );
        let view = import_link(home.path(), &link).unwrap();
        assert_eq!((view.name.as_str(), view.api_key.as_str()), ("Relay", "****abcd"));
        assert_eq!(import_link(home.path(), &link).unwrap().id, view.id, "re-import updates it");
        assert!(import_link(home.path(), "https://example.com").is_err());
    }
}
