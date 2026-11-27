use super::*;
use crate::local::CachedCatalog;
use crate::protocol::{AgentKind, ApiProtocol, OfficialInput};
use ApiProtocol::{Anthropic, Openai};
use std::time::Duration;

const KEY: &str = "sk-test-0123456789abcd";

fn cmd(action: ProvidersAction) -> ProvidersCmd {
    ProvidersCmd {
        request_id: "r".into(),
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

/// A provider input with one endpoint of `protocol`, changed by `f`.
fn input(protocol: ApiProtocol, f: impl FnOnce(&mut EndpointInput)) -> ProviderInput {
    let mut e = EndpointInput::new(protocol);
    f(&mut e);
    ProviderInput { endpoints: Some(vec![e]), ..Default::default() }
}

fn edit(id: &str) -> ProviderInput {
    ProviderInput { id: Some(id.into()), ..Default::default() }
}

#[test]
fn saves_a_claude_providers_command_line_arguments() {
    let home = tempfile::tempdir().unwrap();
    let save = |provider: ProviderInput| {
        let mut c = cmd(ProvidersAction::Save);
        c.provider = Some(provider);
        providers_op(home.path(), home.path(), c, &[])
    };
    let new = |protocol: ApiProtocol, args: &[&str]| ProviderInput {
        name: Some("K".into()),
        api_key: Some(KEY.into()),
        ..input(protocol, |e| {
            e.base_url = Some("https://k.example".into());
            e.args = Some(args.iter().map(|a| a.to_string()).collect());
        })
    };
    let r = save(new(Anthropic, &["--debug", " ", " --settings ~/team.json "])).unwrap();
    assert_eq!(r.view.unwrap().providers[0].endpoints[0].args, ["--debug", "--settings ~/team.json"]);
    assert!(save(new(Anthropic, &["--permission-mode bypassPermissions"])).is_err());
    assert!(save(new(Openai, &["--debug"])).is_err());
    let id = r.id.unwrap();
    let args = |home: &Path| Store::load(home).unwrap().get(&id).unwrap().endpoints[0].args.clone();
    save(edit(&id)).unwrap();
    assert_eq!(args(home.path()).len(), 2, "absent = unchanged");
    save(ProviderInput { id: Some(id.clone()), ..input(Anthropic, |e| e.args = Some(vec![])) }).unwrap();
    assert!(args(home.path()).is_empty(), "cleared");
}

#[test]
fn creates_a_local_claude_profile_without_a_key() {
    let home = tempfile::tempdir().unwrap();
    let mut store = Store::default();
    let dir = home.path().to_string_lossy().to_string();
    let profile =
        ProviderInput { name: Some("Local".into()), ..input(Anthropic, |e| e.config_dir = Some(dir.clone())) };
    let id = save(&mut store, profile).unwrap();
    let p = store.get(&id).unwrap();
    assert_eq!(p.endpoints[0].config_dir.as_deref(), home.path().to_str());
    assert!(p.api_key.is_empty() && p.endpoints[0].api_key_field.is_none());
    let invalid = ProviderInput { name: Some("Bad".into()), ..input(Openai, |e| e.config_dir = Some(dir.clone())) };
    assert!(save(&mut store, invalid).is_err());
}

#[test]
fn a_local_claude_profile_excludes_url_key_and_preset() {
    let home = tempfile::tempdir().unwrap();
    let dir = home.path().to_string_lossy().to_string();
    let mut store = Store::default();
    let profile = |f: &dyn Fn(&mut ProviderInput)| {
        let mut i =
            ProviderInput { name: Some("Local".into()), ..input(Anthropic, |e| e.config_dir = Some(dir.clone())) };
        f(&mut i);
        i
    };
    let url = |i: &mut ProviderInput| i.endpoints.as_mut().unwrap()[0].base_url = Some("https://x.test".into());
    let codex = |i: &mut ProviderInput| {
        i.endpoints
            .as_mut()
            .unwrap()
            .push(EndpointInput { base_url: Some("https://x.test".into()), ..EndpointInput::new(Openai) })
    };
    for mixed in [
        profile(&url),
        profile(&|i| i.api_key = Some("sk-x".into())),
        profile(&|i| i.preset_id = Some(providers::presets(Some(AgentKind::Claude))[0].id.clone())),
        profile(&codex),
    ] {
        assert!(save(&mut store, mixed).is_err());
    }
    let stray = ProviderInput {
        name: Some("Stray".into()),
        api_key: Some("sk-x".into()),
        ..input(Anthropic, |e| {
            e.base_url = Some("https://x.test".into());
            e.executable_path = Some("/bin/sh".into());
        })
    };
    assert!(save(&mut store, stray).is_err(), "an executable without a profile would be ignored");

    let keyed = ProviderInput {
        name: Some("Keyed".into()),
        api_key: Some("sk-x".into()),
        ..input(Anthropic, |e| e.base_url = Some("https://x.test".into()))
    };
    let id = save(&mut store, keyed).unwrap();
    let mut convert = profile(&|_| {});
    convert.id = Some(id);
    assert!(save(&mut store, convert).is_err(), "a keyed provider is not silently turned into a profile");
}

#[test]
fn saves_the_proxy_keeping_it_when_the_masked_one_comes_back() {
    let home = tempfile::tempdir().unwrap();
    let save = |provider: ProviderInput| {
        let mut c = cmd(ProvidersAction::Save);
        c.provider = Some(provider);
        providers_op(home.path(), home.path(), c, &[])
    };
    let new = ProviderInput {
        name: Some("K".into()),
        api_key: Some(KEY.into()),
        ..input(Openai, |e| e.base_url = Some("https://k.example".into()))
    };
    assert!(save(ProviderInput { proxy: Some("127.0.0.1:7890".into()), ..new.clone() }).is_err());
    let r = save(ProviderInput { proxy: Some(" http://bob:pw@10.0.0.2:3128 ".into()), ..new }).unwrap();
    let id = r.id.unwrap();
    assert_eq!(r.view.unwrap().providers[0].proxy.as_deref(), Some("http://bob:****@10.0.0.2:3128"));
    let proxy = |home: &Path| Store::load(home).unwrap().get(&id).unwrap().proxy.clone();

    let edit = |proxy: &str| ProviderInput { proxy: Some(proxy.into()), ..edit(&id) };
    save(edit("http://bob:****@10.0.0.2:3128")).unwrap();
    assert_eq!(proxy(home.path()).as_deref(), Some("http://bob:pw@10.0.0.2:3128"), "masked = unchanged");
    save(edit(" ")).unwrap();
    assert_eq!(proxy(home.path()), None, "empty = direct");
}

#[test]
fn sets_the_official_logins_env_and_proxy_per_agent() {
    let home = tempfile::tempdir().unwrap();
    let set = |env: Option<&[(&str, &str)]>, proxy: Option<&str>| {
        let mut c = cmd(ProvidersAction::Official);
        c.agent = Some(AgentKind::Claude);
        c.official = Some(OfficialInput {
            env: env.map(|e| e.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()),
            proxy: proxy.map(String::from),
            args: None,
        });
        providers_op(home.path(), home.path(), c, &[])
    };
    assert!(set(Some(&[("BAD-NAME", "1")]), None).is_err());
    assert!(set(None, Some("127.0.0.1:7890")).is_err());
    let view = set(Some(&[("DISABLE_TELEMETRY", "1")]), Some("http://bob:pw@10.0.0.2:3128")).unwrap().view.unwrap();
    let o = &view.official[&AgentKind::Claude];
    assert_eq!(o.proxy.as_deref(), Some("http://bob:****@10.0.0.2:3128"));
    assert_eq!(o.env["DISABLE_TELEMETRY"], "1");
    assert!(!view.official.contains_key(&AgentKind::Codex));

    set(None, Some("http://bob:****@10.0.0.2:3128")).unwrap();
    let stored = Store::load(home.path()).unwrap().official(AgentKind::Claude);
    assert_eq!(stored.proxy.as_deref(), Some("http://bob:pw@10.0.0.2:3128"), "masked = unchanged");
    assert_eq!(stored.env.len(), 1, "absent env = unchanged");

    let view = set(Some(&[]), Some("")).unwrap().view.unwrap();
    assert!(view.official.is_empty(), "cleared");

    let view = set(Some(&[("MY_API_KEY", "sk-official-0123456789")]), None).unwrap().view.unwrap();
    assert_eq!(view.official[&AgentKind::Claude].env["MY_API_KEY"], "****6789");
    set(Some(&[("MY_API_KEY", "****6789"), ("CLAUDE_CODE_DISABLE_THINKING", "1")]), None).unwrap();
    let stored = Store::load(home.path()).unwrap().official(AgentKind::Claude);
    assert_eq!(stored.env["MY_API_KEY"], "sk-official-0123456789", "masked = unchanged");
    assert!(set(Some(&[("CLAUDE_CODE_DISABLE_THINKING", "0")]), None).is_err(), "a flag is '1' or absent");
}

#[test]
fn sets_the_official_logins_command_line_arguments_for_claude_only() {
    let home = tempfile::tempdir().unwrap();
    let set = |agent: AgentKind, args: &[&str]| {
        let mut c = cmd(ProvidersAction::Official);
        c.agent = Some(agent);
        c.official =
            Some(OfficialInput { env: None, proxy: None, args: Some(args.iter().map(|a| a.to_string()).collect()) });
        providers_op(home.path(), home.path(), c, &[])
    };
    let view = set(AgentKind::Claude, &["--debug", "  ", " --settings ~/team.json "]).unwrap().view.unwrap();
    assert_eq!(view.official[&AgentKind::Claude].args, ["--debug", "--settings ~/team.json"]);
    assert!(set(AgentKind::Claude, &["--permission-mode bypassPermissions"]).is_err());
    assert!(set(AgentKind::Codex, &["--debug"]).is_err());
    let stored = Store::load(home.path()).unwrap().official(AgentKind::Claude);
    assert_eq!(stored.args.len(), 2, "a refused change keeps what was saved");
    assert!(set(AgentKind::Claude, &[]).unwrap().view.unwrap().official.is_empty(), "cleared");
}

#[test]
fn agent_settings_are_validated_saved_and_reported_with_the_cli_config() {
    let home = tempfile::tempdir().unwrap();
    std::fs::create_dir(home.path().join(".claude")).unwrap();
    let cli = r#"{"language":"english","env":{"CLAUDE_CODE_EFFORT_LEVEL":"high","ANTHROPIC_AUTH_TOKEN":"sk-cli"}}"#;
    std::fs::write(home.path().join(".claude/settings.json"), cli).unwrap();
    let set = |values: &[(&str, &str)], inherit_cli: bool| {
        let mut c = cmd(ProvidersAction::AgentSettings);
        c.agent = Some(AgentKind::Claude);
        c.agent_settings = Some(crate::protocol::AgentSettings {
            values: values.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            inherit_cli,
        });
        providers_op(home.path(), home.path(), c, &[])
    };
    assert!(set(&[("contextWindow", "200000")], true).is_err(), "a provider field");
    assert!(set(&[("bashTimeout", "soon")], true).is_err());
    let view = set(&[("language", "chinese"), ("bashTimeout", "300000")], false).unwrap().view.unwrap();
    let saved = &view.agent_settings[&AgentKind::Claude];
    assert_eq!((saved.values.len(), saved.inherit_cli), (2, false));
    let cli = &view.cli[&AgentKind::Claude];
    assert_eq!(cli.values["language"], "english");
    assert_eq!(cli.conflicts, vec!["CLAUDE_CODE_EFFORT_LEVEL".to_string()]);
    assert!(!serde_json::to_string(&view).unwrap().contains("sk-cli"));
    let list = providers_op(home.path(), home.path(), cmd(ProvidersAction::List), &[]).unwrap().view.unwrap();
    assert_eq!(list.agent_settings, view.agent_settings);
    assert!(set(&[], true).unwrap().view.unwrap().agent_settings.is_empty(), "back to the defaults");
}

#[test]
fn saves_from_a_preset_and_only_masked_keys_come_back() {
    let home = tempfile::tempdir().unwrap();
    let mut save = cmd(ProvidersAction::Save);
    (save.set_default, save.agent) = (Some(true), Some(AgentKind::Claude));
    let env = [("HTTP_TIMEOUT", "30"), ("ENABLE_TOOL_SEARCH", "true"), ("GITHUB_TOKEN", "ghp-secret-wxyz")];
    save.provider = Some(ProviderInput {
        preset_id: Some("kimi-coding".into()),
        api_key: Some(KEY.into()),
        ..input(Anthropic, |e| e.env = Some(env.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()))
    });
    let r = providers_op(home.path(), home.path(), save, &[]).unwrap();
    let id = r.id.clone().unwrap();
    let view = r.view.clone().unwrap();
    assert_eq!(view.machine[&AgentKind::Claude], providers::AgentDefault { provider: id.clone(), model: None });
    let p = &view.providers[0];
    assert_eq!((p.api_key.as_str(), p.preset_id.as_deref()), ("****abcd", Some("kimi-coding")));
    assert_eq!(p.endpoints.iter().map(|e| e.protocol).collect::<Vec<_>>(), [Anthropic, Openai], "the preset's");
    let env = &p.endpoints[0].env;
    assert_eq!(env.keys().collect::<Vec<_>>(), vec!["ENABLE_TOOL_SEARCH", "GITHUB_TOKEN", "HTTP_TIMEOUT"]);
    assert_eq!(env["GITHUB_TOKEN"], "****wxyz");
    let masked_env = env.clone();
    let json = serde_json::to_string(&DaemonToServer::ProvidersResult(r)).unwrap();
    assert!(!json.contains(KEY) && !json.contains("ghp-secret"));

    let run = |provider: ProviderInput| {
        let mut c = cmd(ProvidersAction::Save);
        c.provider = Some(provider);
        providers_op(home.path(), home.path(), c, &[])
    };
    // The view's env sent back as is: the masked secret stays what it was.
    run(ProviderInput { id: Some(id.clone()), ..input(Anthropic, |e| e.env = Some(masked_env)) }).unwrap();
    let stored = Store::load(home.path()).unwrap();
    let p = stored.get(&id).unwrap();
    assert_eq!((p.endpoints[0].env["GITHUB_TOKEN"].as_str(), p.revision), ("ghp-secret-wxyz", 1));

    let window = [("CLAUDE_CODE_MAX_CONTEXT_TOKENS", "200000"), ("CLAUDE_CODE_AUTO_COMPACT_WINDOW", "262144")];
    let window = window.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    let invalid = ProviderInput { id: Some(id.clone()), ..input(Anthropic, |e| e.env = Some(window)) };
    assert!(run(invalid).is_err(), "auto-compact beyond the window");

    run(ProviderInput { id: Some(id.clone()), ..input(Openai, |e| e.model = Some("k2".into())) }).unwrap();
    let stored = Store::load(home.path()).unwrap();
    let p = stored.get(&id).unwrap();
    let models = (p.endpoints[0].model.as_deref(), p.endpoints[1].model.as_deref());
    assert_eq!((p.api_key.as_str(), models, p.revision), (KEY, (Some("kimi-for-coding"), Some("k2")), 2), "key kept");

    let bad_env = ProviderInput {
        id: Some(id.clone()),
        ..input(Anthropic, |e| e.env = Some([("A-B".to_string(), "1".to_string())].into()))
    };
    assert!(run(bad_env).is_err());

    // Another protocol joins with the preset's endpoint, removing one leaves the rest.
    let removed = ProviderInput { remove_protocols: Some(vec![Openai]), ..edit(&id) };
    let view = run(removed).unwrap().view.unwrap();
    assert_eq!(view.providers[0].endpoints.len(), 1);
    let view = run(ProviderInput { id: Some(id.clone()), ..input(Openai, |_| {}) }).unwrap().view.unwrap();
    assert_eq!(view.providers[0].endpoints[1].base_url, "https://api.kimi.com/coding/v1", "from the preset");
    assert!(run(ProviderInput { remove_protocols: Some(vec![Anthropic, Openai]), ..edit(&id) }).is_err());
    let gemini = ProviderInput { id: Some(id.clone()), ..input(ApiProtocol::Gemini, |_| {}) };
    assert!(run(gemini).is_err(), "a protocol the preset lacks needs a URL");
}

#[test]
fn saves_a_vendor_by_hand_with_an_endpoint_per_protocol() {
    let mut store = Store::default();
    let both = ProviderInput {
        name: Some("Relay".into()),
        api_key: Some(KEY.into()),
        endpoints: Some(vec![
            EndpointInput { base_url: Some("https://relay.test/anthropic".into()), ..EndpointInput::new(Anthropic) },
            EndpointInput {
                base_url: Some("https://relay.test/v1".into()),
                model: Some("gpt-5".into()),
                ..EndpointInput::new(Openai)
            },
        ]),
        ..Default::default()
    };
    let id = save(&mut store, both).unwrap();
    let p = store.get(&id).unwrap();
    assert_eq!(p.endpoint_for(AgentKind::Claude).unwrap().api_key_field.as_deref(), Some(AUTH_TOKEN));
    assert_eq!(p.endpoint_for(AgentKind::Codex).unwrap().wire_api.as_deref(), Some(providers::WIRE_RESPONSES));
    let no_url = ProviderInput { name: Some("X".into()), api_key: Some(KEY.into()), ..input(Openai, |_| {}) };
    assert!(save(&mut store, no_url).is_err());
    let nothing = ProviderInput { name: Some("X".into()), api_key: Some(KEY.into()), ..Default::default() };
    assert!(save(&mut store, nothing).is_err());
}

#[test]
fn uses_machine_and_bot_choices_and_reports_stale_sessions() {
    let home = tempfile::tempdir().unwrap();
    let id = Store::update(home.path(), |s| {
        let id = s.add(Provider::custom(Anthropic, "Kimi".into(), "https://k.example".into(), KEY.into()))?;
        s.pin("sess-1", AgentKind::Claude, "g1", "b1", &providers::Selection::Official(Default::default()));
        Ok(id)
    })
    .unwrap();

    let mut bot = cmd(ProvidersAction::Use);
    (bot.agent, bot.bot_id, bot.choice) = (Some(AgentKind::Claude), Some("b1".into()), Some(id.clone()));
    let view = providers_op(home.path(), home.path(), bot, &[]).unwrap().view.unwrap();
    assert_eq!(view.bots.get("b1"), Some(&id));
    assert_eq!(view.sessions[0].provider, providers::OFFICIAL);

    let (out, mut rx) = Outbox::channel();
    let manage = Manage::new(home.path().into(), home.path().join("none"));
    manage.report_now(&out);
    let DaemonToServer::BotsProviderState { items } = rx.try_recv().unwrap() else { panic!() };
    assert_eq!(
        items,
        vec![ProviderStateItem {
            group_id: "g1".into(),
            bot_id: "b1".into(),
            session: providers::OFFICIAL_NAME.into(),
            effective: "Kimi".into()
        }]
    );
    manage.report_now(&out);
    assert!(rx.try_recv().is_err(), "unchanged state is not sent again");
    manage.connected();
    manage.report_now(&out);
    assert!(rx.try_recv().is_ok(), "a new connection gets it again");

    let mut inherit = cmd(ProvidersAction::Use);
    (inherit.agent, inherit.choice) = (Some(AgentKind::Claude), Some(INHERIT.into()));
    assert!(providers_op(home.path(), home.path(), inherit, &[]).is_err(), "the machine default cannot inherit");
    let mut codex = cmd(ProvidersAction::Use);
    (codex.agent, codex.choice) = (Some(AgentKind::Codex), Some(id.clone()));
    assert!(providers_op(home.path(), home.path(), codex, &[]).is_err(), "no openai endpoint for codex");
    let mut deepseek = cmd(ProvidersAction::Use);
    (deepseek.agent, deepseek.choice, deepseek.model) = (Some(AgentKind::Deepseek), Some(id.clone()), Some("m".into()));
    let view = providers_op(home.path(), home.path(), deepseek, &[]).unwrap().view.unwrap();
    assert_eq!(
        view.machine[&AgentKind::Deepseek],
        providers::AgentDefault { provider: id, model: Some("m".into()) },
        "DeepSeek Harness speaks anthropic too"
    );
}

#[test]
fn catalog_lists_an_endpoints_declared_models_once() {
    let home = tempfile::tempdir().unwrap();
    let mut p = Provider::custom(Anthropic, "K".into(), "https://k.example".into(), KEY.into());
    p.endpoints[0].model = Some("a".into());
    p.endpoints[0].models = Some(ModelMap { haiku: Some("b".into()), sonnet: Some("a".into()), opus: None });
    let c = catalog(&p, &p.endpoints[0]);
    assert_eq!(c.models.iter().map(|m| m.choice.value.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
    assert_eq!(c.current.as_deref(), Some("a"));

    let id = Store::update(home.path(), |s| {
        s.add(Provider::from_preset(&providers::preset("kimi-coding").unwrap(), KEY.into()))
    })
    .unwrap();
    let ask = |agent: AgentKind| {
        let mut c = cmd(ProvidersAction::Catalog);
        (c.agent, c.id) = (Some(agent), Some(id.clone()));
        providers_op(home.path(), home.path(), c, &[])
    };
    assert_eq!(ask(AgentKind::Codex).unwrap().catalog.unwrap().effort.as_deref(), Some("high"), "the openai endpoint");
    assert_eq!(ask(AgentKind::Claude).unwrap().catalog.unwrap().effort, None);
    assert!(ask(AgentKind::Codex).unwrap().catalog.unwrap().models.len() > 1, "the preset's options");
    assert!(ask(AgentKind::Gemini).is_err());
}

#[tokio::test]
async fn bot_catalog_follows_what_a_new_session_would_use() {
    let home = tempfile::tempdir().unwrap();
    let official = AgentCatalog {
        current: Some("opus".into()),
        models: vec![ModelChoice {
            choice: Choice { name: "Opus".into(), value: "opus".into(), description: None },
            efforts: vec![],
            effort: None,
        }],
        ..Default::default()
    };
    let claude = AgentState {
        kind: AgentKind::Claude,
        available: true,
        version: Some("2.1.0".into()),
        path: None,
        min_version: None,
        catalog: Some(official.clone()),
        latest: None,
        managed: false,
        upgrade_command: None,
        install_command: None,
        login_state: None,
        login_label: None,
        login_flow: None,
    };
    let manage = Manage::new(home.path().into(), home.path().into());
    manage.watch_agents(watch::channel(vec![claude]).0);
    let (out, mut rx) = Outbox::channel();
    let mut ask = async |bot: Option<&str>| {
        let mut c = cmd(ProvidersAction::BotCatalog);
        (c.agent, c.bot_id) = (Some(AgentKind::Claude), bot.map(Into::into));
        manage.providers(c, &out);
        let DaemonToServer::ProvidersResult(r) = rx.recv().await.unwrap() else { panic!() };
        assert!(r.ok, "{:?}", r.error);
        r.catalog
    };
    assert_eq!(ask(Some("b1")).await, Some(official.clone()), "official: the adapter's catalog");

    Store::update(home.path(), |s| {
        let mut p = Provider::custom(Anthropic, "Kimi".into(), "https://k.example".into(), KEY.into());
        p.endpoints[0].model = Some("kimi-for-coding".into());
        let id = s.add(p)?;
        s.use_machine(AgentKind::Claude, &id, None)?;
        s.use_bot("b2", AgentKind::Claude, providers::OFFICIAL)
    })
    .unwrap();
    let third = ask(Some("b1")).await.unwrap();
    assert_eq!(third.models.iter().map(|m| m.choice.value.as_str()).collect::<Vec<_>>(), vec!["kimi-for-coding"]);
    assert_eq!(ask(None).await, Some(third), "a new bot gets the machine default");
    assert_eq!(ask(Some("b2")).await, Some(official), "the bot's override wins");
}

#[tokio::test]
async fn a_local_claude_profile_offers_its_probed_catalog_else_the_official_one() {
    let (home, profile) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    std::fs::write(profile.path().join("settings.json"), r#"{"env":{"ANTHROPIC_BASE_URL":"https://gw.test"}}"#)
        .unwrap();
    let official = AgentCatalog {
        current: Some("opus".into()),
        models: vec![ModelChoice {
            choice: Choice { name: "Opus".into(), value: "opus".into(), description: None },
            efforts: vec![],
            effort: None,
        }],
        ..Default::default()
    };
    let claude = AgentState {
        kind: AgentKind::Claude,
        available: true,
        version: Some("2.1.0".into()),
        path: None,
        min_version: None,
        catalog: Some(official.clone()),
        latest: None,
        managed: false,
        upgrade_command: None,
        install_command: None,
        login_state: None,
        login_label: None,
        login_flow: None,
    };
    let dir = profile.path().to_string_lossy().to_string();
    let id = Store::update(home.path(), |s| {
        let id = save(
            s,
            ProviderInput { name: Some("Local".into()), ..input(Anthropic, |e| e.config_dir = Some(dir.clone())) },
        )?;
        s.use_bot("b1", AgentKind::Claude, &id)?;
        Ok(id)
    })
    .unwrap();
    let manage = Manage::new(home.path().into(), home.path().into());
    manage.watch_agents(watch::channel(vec![claude]).0);
    let probes = manage.profile_probes();
    let (out, mut rx) = Outbox::channel();
    let mut ask = async |action: ProvidersAction| {
        let mut c = cmd(action);
        (c.agent, c.bot_id, c.id) = (Some(AgentKind::Claude), Some("b1".into()), Some(id.clone()));
        manage.providers(c, &out);
        let DaemonToServer::ProvidersResult(r) = rx.recv().await.unwrap() else { panic!() };
        assert!(r.ok, "{:?}", r.error);
        r.catalog
    };
    assert_eq!(ask(ProvidersAction::BotCatalog).await, Some(official.clone()), "not probed yet: the same CLI's");
    tokio::time::timeout(Duration::from_secs(1), probes.notified()).await.expect("the prober is woken");

    let unprobed = crate::agents::unprobed_profiles(home.path(), Some("2.1.0")).unwrap();
    assert_eq!(unprobed.len(), 1);
    let (selection, key) = &unprobed[0];
    assert_eq!(selection.claude_profile(), Some(profile.path()));
    let probed = AgentCatalog {
        current: Some("claude-opus-5-5".into()),
        models: vec![ModelChoice {
            choice: Choice { name: "Opus 5.5".into(), value: "claude-opus-5-5".into(), description: None },
            efforts: vec![],
            effort: None,
        }],
        ..Default::default()
    };
    crate::local::save_profile_catalog(home.path(), &id, CachedCatalog { key: key.clone(), catalog: probed.clone() })
        .unwrap();
    assert!(crate::agents::unprobed_profiles(home.path(), Some("2.1.0")).unwrap().is_empty());
    assert_eq!(ask(ProvidersAction::BotCatalog).await, Some(probed.clone()));
    assert_eq!(ask(ProvidersAction::Catalog).await, Some(probed));

    std::fs::write(profile.path().join("settings.json"), "{}").unwrap();
    assert_eq!(ask(ProvidersAction::Catalog).await, Some(official), "its settings changed: probed again");
    assert_eq!(crate::agents::unprobed_profiles(home.path(), Some("2.1.0")).unwrap().len(), 1);
    assert_eq!(crate::agents::unprobed_profiles(home.path(), Some("2.2.0")).unwrap().len(), 1, "a Claude upgrade");
    manage.providers(cmd(ProvidersAction::List), &out);
    let DaemonToServer::ProvidersResult(listed) = rx.recv().await.unwrap() else { panic!() };
    assert_eq!(listed.view.unwrap().providers[0].endpoints[0].model_options, vec!["opus"]);
}

#[tokio::test]
async fn a_profile_with_its_own_settings_offers_only_its_own_probed_catalog() {
    let (home, dir) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let one = |value: &str| AgentCatalog {
        current: Some(value.into()),
        models: vec![ModelChoice {
            choice: Choice { name: value.into(), value: value.into(), description: None },
            efforts: vec![],
            effort: None,
        }],
        ..Default::default()
    };
    let claude = AgentState {
        kind: AgentKind::Claude,
        available: true,
        version: Some("2.1.0".into()),
        path: None,
        min_version: None,
        catalog: None,
        latest: None,
        managed: false,
        upgrade_command: None,
        install_command: None,
        login_state: None,
        login_label: None,
        login_flow: None,
    };
    crate::local::save_catalog(
        home.path(),
        AgentKind::Claude,
        CachedCatalog { key: crate::agents::catalog_key(AgentKind::Claude, Some("2.1.0")), catalog: one("opus") },
    )
    .unwrap();
    let id = Store::update(home.path(), |s| {
        let mut p = Provider::custom(Anthropic, "GLM".into(), String::new(), String::new());
        p.endpoints[0].config_dir = Some(dir.path().display().to_string());
        p.endpoints[0].args = vec![r#"--settings {"model":"glm-5"}"#.into()];
        let id = s.add(p)?;
        s.use_bot("b1", AgentKind::Claude, &id)?;
        Ok(id)
    })
    .unwrap();
    let manage = Manage::new(home.path().into(), home.path().into());
    manage.watch_agents(watch::channel(vec![claude]).0);
    let (out, mut rx) = Outbox::channel();
    let mut ask = async || {
        let mut c = cmd(ProvidersAction::BotCatalog);
        (c.agent, c.bot_id) = (Some(AgentKind::Claude), Some("b1".into()));
        manage.providers(c, &out);
        let DaemonToServer::ProvidersResult(r) = rx.recv().await.unwrap() else { panic!() };
        assert!(r.ok, "{:?}", r.error);
        r.catalog
    };
    assert_eq!(ask().await, None, "not probed yet: not the official login's");

    let (_, key) = crate::agents::unprobed_profiles(home.path(), Some("2.1.0")).unwrap().remove(0);
    let before = key.strip_suffix(crate::agents::PROFILE_PROBE).unwrap().to_string();
    crate::local::save_profile_catalog(home.path(), &id, CachedCatalog { key: before, catalog: one("opus") }).unwrap();
    assert_eq!(ask().await, None, "probed before its settings reached the probe: probed again");
    assert_eq!(crate::agents::unprobed_profiles(home.path(), Some("2.1.0")).unwrap().len(), 1);

    crate::local::save_profile_catalog(home.path(), &id, CachedCatalog { key, catalog: one("glm-5") }).unwrap();
    assert_eq!(ask().await, Some(one("glm-5")));
}

#[test]
fn features_include_cc_switch_only_when_present() {
    let home = tempfile::tempdir().unwrap();
    let without = Manage::new(home.path().into(), home.path().into());
    assert_eq!(
        without.features(),
        vec![
            "tools",
            "providers",
            "sync",
            "sessionFork",
            "agentSettings",
            "reprobe",
            "plugins",
            "pluginMcp",
            "presetSync",
            "artifacts",
            "artifactSnapshot",
            "siteHost",
            "artifactActivity",
            "gitOps",
            "gitOps2",
            "gitRepos",
            "gitOps3",
            "gitOps4",
            "machineAdmin",
            "storageAdmin",
            "claudeArgs",
            "claudeProfile",
            "providerArgs",
            "claudeDefaultDir",
            "gitAccess",
            "diag",
            "gemini",
            "codebuddy",
            "approvalGates",
            "builtinReview",
            "pi",
            "deepseek",
            "antigravity",
            "opencode",
            "qwen",
            "kimi",
            "goose",
            "copilot",
            "agentState",
            "protocolProviders",
            "threadSessions",
            "connectors",
            "agent_login"
        ]
    );
    std::fs::create_dir(home.path().join(".cc-switch")).unwrap();
    assert_eq!(
        without.features(),
        vec![
            "tools",
            "providers",
            "sync",
            "sessionFork",
            "agentSettings",
            "reprobe",
            "plugins",
            "pluginMcp",
            "presetSync",
            "artifacts",
            "artifactSnapshot",
            "siteHost",
            "artifactActivity",
            "gitOps",
            "gitOps2",
            "gitRepos",
            "gitOps3",
            "gitOps4",
            "machineAdmin",
            "storageAdmin",
            "claudeArgs",
            "claudeProfile",
            "providerArgs",
            "claudeDefaultDir",
            "gitAccess",
            "diag",
            "gemini",
            "codebuddy",
            "approvalGates",
            "builtinReview",
            "pi",
            "deepseek",
            "antigravity",
            "opencode",
            "qwen",
            "kimi",
            "goose",
            "copilot",
            "agentState",
            "protocolProviders",
            "threadSessions",
            "connectors",
            "agent_login",
            "ccSwitch"
        ]
    );
    std::fs::write(home.path().join("settings.json"), r#"{"autoUpgrade":false}"#).unwrap();
    assert_eq!(without.features().last().map(String::as_str), Some("noAutoUpgrade"));
}

#[tokio::test]
async fn tools_settings_change_the_mirror_and_answer_with_the_status() {
    let home = tempfile::tempdir().unwrap();
    let manage = Manage::new(home.path().into(), home.path().into());
    let (out, mut rx) = Outbox::channel();
    // Unreachable mirror: the status is answered without update hints, and fast.
    let mirror = Mirror::Custom { registry: "http://127.0.0.1:9/npm".into(), node: "http://127.0.0.1:9/node".into() };
    let settings = ToolsCmd {
        request_id: "t1".into(),
        action: ToolsAction::Settings,
        kind: None,
        version: None,
        mirror: Some(mirror.clone()),
    };
    manage.tools(settings, &out);
    let DaemonToServer::ToolsResult { request_id, ok, tools, node, agents, settings, .. } = rx.recv().await.unwrap()
    else {
        panic!()
    };
    assert_eq!((request_id.as_str(), ok, settings.mirror), ("t1", true, mirror));
    assert!(tools.is_empty(), "the legacy list is for older servers only");
    assert_eq!(agents.len(), AgentKind::ALL.len());
    assert!(agents.iter().all(|a| a.latest.is_none()) && node.unwrap().latest.is_none());

    let bad = ToolsCmd {
        request_id: "t2".into(),
        action: ToolsAction::Install,
        kind: Some(tools::ToolKind::Claude),
        version: Some("1.0; rm -rf /".into()),
        mirror: None,
    };
    manage.tools(bad, &out);
    let DaemonToServer::ToolsResult { ok, error, .. } = rx.recv().await.unwrap() else { panic!() };
    assert!(!ok && error.unwrap().contains("版本号格式不正确"));
}

#[tokio::test]
async fn git_access_answers_with_the_view_even_when_the_command_fails() {
    let home = tempfile::tempdir().unwrap();
    let manage = Manage::new(home.path().join("gg"), home.path().into());
    let (out, mut rx) = Outbox::channel();
    let cmd = |action, host: Option<&str>| GitAccessCmd {
        request_id: "g1".into(),
        action,
        token: None,
        host: host.map(String::from),
        url: None,
    };
    manage.git_access(cmd(crate::protocol::GitAccessAction::GenKey, None), &out);
    let DaemonToServer::GitAccessResult { request_id, ok, view, .. } = rx.recv().await.unwrap() else { panic!() };
    assert_eq!((request_id.as_str(), ok), ("g1", true));
    assert_eq!(view.unwrap().ssh_keys.len(), 1);

    manage.git_access(cmd(crate::protocol::GitAccessAction::RemoveToken, Some("bad host")), &out);
    let DaemonToServer::GitAccessResult { ok, error, view, .. } = rx.recv().await.unwrap() else { panic!() };
    assert!(!ok && error.unwrap().contains("主机名无效"));
    assert_eq!(view.unwrap().ssh_keys.len(), 1);
}

#[tokio::test]
async fn diag_answers_with_every_check() {
    let home = tempfile::tempdir().unwrap();
    let manage = Manage::new(home.path().into(), home.path().into());
    let (out, mut rx) = Outbox::channel();
    manage.diag("d1".into(), None, &out);
    let DaemonToServer::DiagResult { request_id, checks } = rx.recv().await.unwrap() else { panic!() };
    assert_eq!(request_id, "d1");
    assert_eq!(checks[0].kind, crate::diag::CheckKind::Server);
    assert_eq!(checks[0].status, crate::diag::Status::Error);
    assert!(checks.iter().any(|c| c.kind == crate::diag::CheckKind::Git));
}

#[test]
fn clips_on_char_boundaries() {
    assert_eq!(clip("安装完成", 4), "安");
    assert_eq!(clip("ok", 10), "ok");
}
