//! Agent and Bot pages: this machine's model providers (design §4.2–§4.5), read locally from `providers.json`
//! with keys masked. Adding and editing them is the Web's (机器 → 供应商); here only the defaults are chosen.
use super::Result;
use crate::host::Host;
use crate::i18n::tr;
use gonggong::config::Config;
use gonggong::protocol::AgentKind;
use gonggong::providers::{Stale, Store, StoreView};
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

fn err(e: anyhow::Error) -> String {
    format!("{e:#}")
}

#[tauri::command]
pub fn providers(host: State<'_, Host>) -> Result<StoreView> {
    Ok(Store::load(&host.home).map_err(err)?.view())
}

fn web_url(server: &str, machine_id: &str) -> String {
    format!("{}/machine/{machine_id}?tab=providers", server.trim_end_matches('/'))
}

/// 在 Web 中管理: this machine's 供应商 tab in the default browser.
#[tauri::command]
pub fn open_providers_in_web(app: AppHandle) -> Result<()> {
    let config = Config::load().map_err(|e| e.to_string())?.ok_or(tr!("尚未绑定"))?;
    app.opener().open_url(web_url(&config.server, &config.machine_id), None::<&str>).map_err(|e| e.to_string())
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

#[cfg(test)]
mod tests {
    use super::*;
    use AgentKind::{Claude, Codex};
    use gonggong::providers::{self, OFFICIAL, Provider, Selection};

    #[test]
    fn web_url_opens_this_machines_providers_tab() {
        assert_eq!(web_url("https://gg.test/", "m1"), "https://gg.test/machine/m1?tab=providers");
    }

    #[test]
    fn impact_lists_only_sessions_whose_next_provider_changes() {
        let mut store = Store::default();
        let kimi = store
            .add(Provider::custom(Claude, "Kimi".into(), "https://k.test".into(), "sk-0123456789abcd".into()))
            .unwrap();
        store.pin("s1", Claude, "g1", "inherits", &Selection::Official(Default::default()));
        store.pin("s2", Claude, "g2", "overridden", &Selection::Official(Default::default()));
        store.use_bot("overridden", Claude, OFFICIAL).unwrap();
        store.pin("s3", Codex, "g1", "codex-bot", &Selection::Official(Default::default()));

        let machine = affected(&store, Claude, &kimi, None).unwrap();
        assert_eq!(machine.len(), 1);
        assert_eq!((machine[0].group_id.as_str(), machine[0].bot_id.as_str()), ("g1", "inherits"));
        assert_eq!((machine[0].session.as_str(), machine[0].effective.as_str()), (providers::OFFICIAL_NAME, "Kimi"));
        assert_eq!(affected(&store, Claude, &kimi, Some("overridden")).unwrap().len(), 1);
        assert!(affected(&store, Claude, OFFICIAL, None).unwrap().is_empty(), "no change");
        assert!(affected(&store, Codex, &kimi, None).is_err(), "claude provider for codex");
        assert!(store.machine.is_empty(), "the store itself is untouched");
    }
}
