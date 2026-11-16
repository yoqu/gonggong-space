use super::*;
use AgentKind::{Claude, Codebuddy, Codex, Deepseek, Gemini, Pi};
use ApiProtocol::{Anthropic, Openai};

const KEY: &str = "sk-secret-0123456789abcd";

fn kimi(store: &mut Store) -> String {
    store.add(Provider::from_preset(&preset("kimi-coding").unwrap(), KEY.into())).unwrap()
}

fn custom(protocol: ApiProtocol) -> Provider {
    Provider::custom(protocol, "x".into(), "https://x.test".into(), KEY.into())
}

fn selected(p: &Provider, agent: AgentKind) -> Selection {
    Selection::of(p, agent).unwrap()
}

#[test]
fn process_env_is_the_proxy_then_the_endpoints_env() {
    let mut p = custom(Openai);
    p.endpoints[0].env.insert("FOO".into(), "1".into());
    assert_eq!(p.process_env(&p.endpoints[0]), BTreeMap::from([("FOO".into(), "1".into())]), "no proxy: direct");

    p.proxy = Some("http://127.0.0.1:7890".into());
    p.endpoints[0].env.insert("no_proxy".into(), "corp.cn, 10.0.0.0/8".into());
    p.endpoints[0].env.insert("HTTPS_PROXY".into(), "http://other:8080".into());
    let env = p.process_env(&p.endpoints[0]);
    assert_eq!(env["HTTP_PROXY"], "http://127.0.0.1:7890");
    assert_eq!(env["http_proxy"], "http://127.0.0.1:7890");
    assert_eq!(env["https_proxy"], "http://127.0.0.1:7890");
    assert_eq!(env["HTTPS_PROXY"], "http://other:8080", "the endpoint's own variables win");
    assert_eq!(env["NO_PROXY"], "localhost,127.0.0.1,::1,corp.cn, 10.0.0.0/8", "loopback stays direct");
    assert_eq!(env["no_proxy"], env["NO_PROXY"]);
    assert_eq!(env["FOO"], "1");
    assert_eq!(selected(&p, Codex).process_env(), env);
}

#[test]
fn a_proxy_must_be_an_http_url() {
    let mut p = custom(Openai);
    p.proxy = Some("127.0.0.1:7890".into());
    assert!(Store::default().add(p.clone()).is_err());
    p.proxy = Some("socks5://127.0.0.1:7890".into());
    assert!(Store::default().add(p.clone()).is_err());
    p.proxy = Some("http://user:pw@127.0.0.1:7890".into());
    Store::default().add(p).unwrap();
}

#[test]
fn bundled_presets_are_vendors_with_an_endpoint_per_protocol() {
    assert!(presets_source().starts_with("cc-switch@"));
    let all = presets(None);
    let mut ids: Vec<_> = all.iter().map(|p| &p.id).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), all.len(), "one vendor per id");
    for p in &all {
        assert!(!p.endpoints.is_empty(), "{}", p.id);
        let mut protocols: Vec<_> = p.endpoints.iter().map(|e| e.protocol).collect();
        protocols.dedup();
        assert_eq!(protocols.len(), p.endpoints.len(), "{}: one endpoint per protocol", p.id);
    }
    let kimi = preset("kimi-coding").unwrap();
    let (a, o) = (kimi.endpoint(Anthropic).unwrap(), kimi.endpoint(Openai).unwrap());
    assert_eq!((a.base_url.as_str(), a.api_key_field.as_deref()), ("https://api.kimi.com/coding/", Some(AUTH_TOKEN)));
    assert_eq!(o.wire_api.as_deref(), Some(WIRE_RESPONSES));
    assert!(a.model_options.len() > 1, "claude endpoints get the vendor's models listed by the other apps");
    assert_eq!(a.model_options, o.model_options);
    let claude = presets(Some(Claude));
    assert!(claude.iter().all(|p| p.endpoint(Anthropic).is_some_and(|e| e.api_key_field.is_some())));
    assert!(presets(Some(Codex)).iter().all(|p| p.endpoint(Openai).is_some()));
    assert_eq!(preset("google").unwrap().endpoint(ApiProtocol::Gemini).unwrap().base_url, GOOGLE_GEMINI_URL);
    let openrouter = preset("openrouter").unwrap();
    assert!(openrouter.endpoint(ApiProtocol::Gemini).unwrap().model_options.iter().all(|m| m.contains("gemini")));
    assert_eq!(openrouter.endpoints.len(), 3, "claude, codex and gemini copies merged");
    let codebuddy = preset("codebuddy-cn").unwrap();
    assert_eq!(codebuddy.endpoint(ApiProtocol::Codebuddy).unwrap().env["CODEBUDDY_INTERNET_ENVIRONMENT"], "internal");
    let deepseek = preset("deepseek").unwrap();
    assert_eq!(deepseek.endpoint(Anthropic).unwrap().base_url, "https://api.deepseek.com/anthropic");
    assert!(presets(Some(Deepseek)).iter().any(|p| p.id == "deepseek"));
    assert!(presets(Some(Pi)).is_empty(), "pi keeps its own logins");
    assert!(presets(Some(Gemini)).len() < all.len() && presets(Some(Codebuddy)).len() == 2);
    let zhipu = preset("zhipu").unwrap();
    assert_eq!(zhipu.name, "智谱 GLM");
    assert!(zhipu.endpoint(Openai).unwrap().model_options.contains(&"glm-5.3".to_string()));
    assert!(preset("xai").unwrap().endpoint(Anthropic).is_none(), "xAI is codex-only");
    let mut urls = all.iter().flat_map(|p| [&p.website_url, &p.api_key_url]).flatten();
    assert!(
        urls.all(|u| !u.contains("aff=") && !u.contains("ref=") && !u.contains("track_id=")),
        "referral params stripped"
    );
}

#[test]
fn plugin_presets_replace_built_ins_by_id_and_follow_them() {
    let builtin = presets(None);
    let mut kimi = preset("kimi").unwrap();
    kimi.endpoints[0].base_url = "https://kimi.example.com".into();
    let mut extra = kimi.clone();
    extra.id = "acme".into();
    let out = merged(&builtin, &[extra.clone(), kimi.clone()]);
    assert_eq!(out.len(), builtin.len() + 1);
    let at = builtin.iter().position(|p| p.id == "kimi").unwrap();
    assert_eq!(out[at], kimi, "replaced in place");
    assert_eq!(out.last(), Some(&extra), "new ones follow the built-ins");
}

#[test]
fn the_overlay_is_kept_on_disk_and_cleared_by_an_empty_sync() {
    // Only a same-id replacement, so the other tests' counts hold while it is set.
    let home = tempfile::tempdir().unwrap();
    let mut kimi = preset("kimi").unwrap();
    let original = kimi.clone();
    kimi.name = "Kimi（插件）".into();
    set_overlay(home.path(), vec![kimi.clone()]).unwrap();
    assert_eq!(preset("kimi"), Some(kimi.clone()));
    *OVERLAY.write().unwrap() = vec![];
    load_overlay(home.path());
    assert_eq!(preset("kimi"), Some(kimi), "reloaded after a restart");
    set_overlay(home.path(), vec![]).unwrap();
    assert!(!home.path().join(OVERLAY_FILE).exists());
    assert_eq!(preset("kimi"), Some(original));
}

#[test]
fn from_preset_copies_every_endpoint_and_add_assigns_id() {
    let mut store = Store::default();
    let id = kimi(&mut store);
    let p = store.get(&id).unwrap();
    assert!(id.starts_with("kimi-coding-"));
    assert_eq!((p.revision, p.preset_id.as_deref()), (1, Some("kimi-coding")));
    let a = p.endpoint_for(Claude).unwrap();
    assert_eq!(a.base_url, "https://api.kimi.com/coding/");
    assert_eq!(a.env.get("CLAUDE_CODE_MAX_CONTEXT_TOKENS").map(String::as_str), Some("262144"));
    assert_eq!(p.endpoint_for(Codex).unwrap().protocol, Openai);
    assert!(p.endpoint_for(Gemini).is_none() && p.endpoint_for(Pi).is_none());
    assert_eq!(p.endpoint_for(Deepseek), Some(a), "every agent taking a protocol may use its endpoint");
    let empty = Provider::custom(Openai, "X".into(), "https://x.test/v1".into(), " ".into());
    assert!(store.add(empty).is_err());
    let bad = Provider::custom(Openai, "X".into(), "ftp://x.test".into(), KEY.into());
    assert!(store.add(bad).is_err());
    let mut twice = custom(Openai);
    twice.endpoints.push(Endpoint::new(Openai, "https://y.test".into()));
    assert!(store.add(twice).is_err(), "one endpoint per protocol");
    assert!(store.add(Provider::new("X".into(), KEY.into(), vec![])).is_err(), "at least one endpoint");
    let mut args = custom(Openai);
    args.endpoints[0].args = vec!["--debug".into()];
    assert!(store.add(args).is_err(), "arguments are Claude Code's");
}

#[test]
fn a_local_profile_serves_claude_code_only_and_alone() {
    let dir = tempfile::tempdir().unwrap();
    let mut profile = Provider::custom(Anthropic, "Local".into(), String::new(), String::new());
    profile.endpoints[0].config_dir = Some(dir.path().display().to_string());
    let mut store = Store::default();
    let id = store.add(profile.clone()).unwrap();
    let p = store.get(&id).unwrap();
    assert!(p.endpoint_for(Claude).is_some());
    assert!(p.endpoint_for(Deepseek).is_none(), "a profile is Claude Code's own login");
    assert!(store.use_machine(Deepseek, &id, None).is_err());
    let mut more = profile.clone();
    more.endpoints.push(Endpoint::new(Openai, "https://x.test".into()));
    assert!(store.add(more).is_err());
    let mut keyed = profile.clone();
    keyed.api_key = KEY.into();
    assert!(store.add(keyed).is_err());
    let mut codex = profile;
    codex.endpoints[0].protocol = Openai;
    assert!(store.add(codex).is_err());
}

#[test]
fn store_round_trips_privately_and_atomically() {
    let home = tempfile::tempdir().unwrap();
    assert_eq!(Store::load(home.path()).unwrap(), Store::default());
    let mut store = Store::default();
    let id = kimi(&mut store);
    store.use_machine(Claude, &id, Some("kimi-for-coding-highspeed".into())).unwrap();
    store.use_bot("bot-1", Claude, OFFICIAL).unwrap();
    store.pin("sess-1", Claude, "g1", "bot-1", &Selection::Official(Default::default()));
    store.save(home.path()).unwrap();
    assert_eq!(Store::load(home.path()).unwrap(), store);
    let raw: serde_json::Value = serde_json::from_slice(&std::fs::read(Store::path(home.path())).unwrap()).unwrap();
    assert_eq!(raw["version"], VERSION);
    assert_eq!(raw["machine"]["claude"]["provider"], id.as_str());
    assert_eq!(raw["machine"]["claude"]["model"], "kimi-for-coding-highspeed");
    assert_eq!(raw["sessions"]["sess-1"]["provider"], OFFICIAL);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(Store::path(home.path())).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
    // No temp files left behind; a failed write leaves the previous file intact.
    let names: Vec<_> = std::fs::read_dir(home.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(names, vec![std::ffi::OsString::from("providers.json")]);
    std::fs::create_dir(home.path().join(format!("providers.json.{}.tmp", std::process::id()))).unwrap();
    assert!(Store::default().save(home.path()).is_err());
    assert_eq!(Store::load(home.path()).unwrap(), store);
}

#[test]
fn update_persists_changes_under_lock() {
    let home = tempfile::tempdir().unwrap();
    let id = Store::update(home.path(), |s| Ok(kimi(s))).unwrap();
    Store::update(home.path(), |s| s.use_machine(Codex, &id, None)).unwrap();
    assert_eq!(Store::load(home.path()).unwrap().machine[&Codex].provider, id);
    assert!(Store::update(home.path(), |s| s.use_machine(Gemini, &id, None)).is_err(), "no gemini endpoint");
}

#[test]
fn the_official_selection_carries_the_agents_extras() {
    let mut store = Store::default();
    let o = Official {
        env: BTreeMap::from([("A".into(), "1".into())]),
        proxy: Some("http://p.test:1".into()),
        ..Default::default()
    };
    store.set_official(Claude, o.clone()).unwrap();
    assert_eq!(store.effective(Claude, "b").unwrap(), Selection::Official(o.clone()));
    assert_eq!(store.effective(Codex, "b").unwrap(), Selection::Official(Official::default()));
    assert_eq!(store.resolve_run(Claude, "b", Some("legacy")).unwrap(), RunPlan::Resume(Selection::Official(o)));
    let env = store.official(Claude).process_env();
    assert_eq!((env["A"].as_str(), env["HTTPS_PROXY"].as_str()), ("1", "http://p.test:1"));
    assert_eq!(env["NO_PROXY"], "localhost,127.0.0.1,::1");
    store.set_official(Claude, Official::default()).unwrap();
    assert!(store.official.is_empty(), "nothing stored for an empty one");
}

#[test]
fn effective_precedence_is_bot_then_machine_then_official() {
    let mut store = Store::default();
    assert_eq!(store.effective(Claude, "b").unwrap(), Selection::Official(Default::default()));
    let a = kimi(&mut store);
    let b = kimi(&mut store);
    store.use_machine(Claude, &a, None).unwrap();
    assert_eq!(store.effective(Claude, "b").unwrap().key(), a);
    store.use_bot("b", Claude, &b).unwrap();
    assert_eq!(store.effective(Claude, "b").unwrap().key(), b);
    assert_eq!(store.effective(Claude, "other").unwrap().key(), a);
    store.use_bot("b", Claude, OFFICIAL).unwrap();
    assert_eq!(store.effective(Claude, "b").unwrap(), Selection::Official(Default::default()));
    store.use_bot("b", Claude, INHERIT).unwrap();
    assert_eq!(store.effective(Claude, "b").unwrap().key(), a);
    assert_eq!(store.effective(Codex, "b").unwrap(), Selection::Official(Default::default()));
    assert!(store.use_bot("b", Gemini, &a).is_err(), "the provider must serve the bot's agent");
    store.use_bot("c", Codex, &a).unwrap();
    assert_eq!(store.effective(Codex, "c").unwrap().provider().unwrap().1.protocol, Openai, "the codex endpoint");
    assert!(store.use_machine(Claude, "nope", None).is_err());
}

#[test]
fn the_machine_defaults_model_goes_to_bots_inheriting_it() {
    let mut store = Store::default();
    let a = kimi(&mut store);
    store.use_machine(Claude, &a, Some(" k3 ".into())).unwrap();
    assert_eq!(store.machine[&Claude].model.as_deref(), Some("k3"));
    assert_eq!(store.inherited_model(Claude, "b", &a).as_deref(), Some("k3"));
    assert_eq!(store.inherited_model(Claude, "b", OFFICIAL), None, "a session pinned to another provider");
    store.use_bot("b", Claude, &a).unwrap();
    assert_eq!(store.inherited_model(Claude, "b", &a), None, "a bot with its own provider");
    store.use_machine(Claude, &a, Some(String::new())).unwrap();
    assert_eq!(store.inherited_model(Claude, "c", &a), None);
}

#[test]
fn defaults_a_provider_no_longer_serves_fall_back_to_official() {
    let mut store = Store::default();
    let a = kimi(&mut store);
    store.use_machine(Claude, &a, None).unwrap();
    store.use_machine(Codex, &a, None).unwrap();
    store.edit(&a, |p| p.endpoints.retain(|e| e.protocol != Openai)).unwrap();
    assert!(store.machine.contains_key(&Claude) && !store.machine.contains_key(&Codex));
    assert!(store.edit(&a, |p| p.endpoints.clear()).is_err());
}

#[test]
fn session_pin_survives_default_changes() {
    let mut store = Store::default();
    let a = kimi(&mut store);
    let b = kimi(&mut store);
    store.use_machine(Claude, &a, None).unwrap();
    let RunPlan::New { selection, provider_removed: false } = store.resolve_run(Claude, "bot", None).unwrap() else {
        panic!("new session expected")
    };
    store.pin("s1", Claude, "g", "bot", &selection);
    store.use_machine(Claude, &b, None).unwrap();
    store.use_bot("bot", Claude, OFFICIAL).unwrap();
    let RunPlan::Resume(Selection::Provider { provider, .. }) = store.resolve_run(Claude, "bot", Some("s1")).unwrap()
    else {
        panic!("resume with the pinned provider expected")
    };
    assert_eq!(provider.id, a);
    // Editing the pinned provider keeps the pin; the run sees the new revision.
    store.edit(&a, |p| p.api_key = "sk-rotated-000000000000".into()).unwrap();
    let RunPlan::Resume(Selection::Provider { provider, .. }) = store.resolve_run(Claude, "bot", Some("s1")).unwrap()
    else {
        panic!()
    };
    assert_eq!(provider.revision, 2);
    assert_eq!(
        store.resolve_run(Claude, "bot", Some("legacy")).unwrap(),
        RunPlan::Resume(Selection::Official(Default::default()))
    );
    let stale = store.stale().unwrap();
    assert_eq!(stale.len(), 1);
    assert_eq!((stale[0].session.as_str(), stale[0].effective.as_str()), ("Kimi For Coding", OFFICIAL_NAME));
    store.pin("s2", Claude, "g", "bot", &Selection::Official(Default::default()));
    store.sessions.get_mut("s2").unwrap().pinned_at += 1;
    assert!(store.stale().unwrap().is_empty(), "only the latest session of a (group, bot) counts");
}

#[test]
fn removing_a_pinned_provider_or_its_endpoint_starts_a_new_session() {
    let mut store = Store::default();
    let a = kimi(&mut store);
    store.use_machine(Claude, &a, None).unwrap();
    store.use_bot("bot", Claude, &a).unwrap();
    store.pin("s1", Claude, "g", "bot", &store.effective(Claude, "bot").unwrap());
    store.pin("s2", Codex, "g", "codex-bot", &store.effective(Codex, "codex-bot").unwrap());
    store.use_machine(Codex, &a, None).unwrap();
    store.pin("s3", Codex, "g2", "codex-bot", &store.effective(Codex, "codex-bot").unwrap());
    store.edit(&a, |p| p.endpoints.retain(|e| e.protocol != Openai)).unwrap();
    assert!(matches!(
        store.resolve_run(Codex, "codex-bot", Some("s3")).unwrap(),
        RunPlan::New { provider_removed: true, .. }
    ));
    assert!(store.stale().unwrap().is_empty(), "sessions of a provider no longer serving the agent are left out");
    store.remove(&a).unwrap();
    assert!(store.machine.is_empty() && store.bots.is_empty());
    assert_eq!(
        store.resolve_run(Claude, "bot", Some("s1")).unwrap(),
        RunPlan::New { selection: Selection::Official(Default::default()), provider_removed: true }
    );
    assert!(store.stale().unwrap().is_empty());
    assert!(store.remove(&a).is_err());
}

#[test]
fn old_pins_beyond_the_latest_few_of_each_group_and_bot_are_dropped() {
    let mut store = Store::default();
    let a = kimi(&mut store);
    let provider = selected(store.get(&a).unwrap(), Claude);
    let long_ago = chrono::Utc::now().timestamp_millis() - PIN_TTL_MS - 10_000;
    for i in 0..1000 {
        let (bot, selection) =
            if i % 2 == 0 { ("b1", &provider) } else { ("b2", &Selection::Official(Default::default())) };
        let id = format!("s{i}");
        store.pin(&id, Claude, "g", bot, selection);
        store.sessions.get_mut(&id).unwrap().pinned_at = long_ago + i;
    }
    assert_eq!(store.sessions.len(), 2 * PINS_KEPT);
    assert!(!store.sessions.contains_key("s0"));
    assert_eq!(store.resolve_run(Claude, "b1", Some("s998")).unwrap(), RunPlan::Resume(provider));
    assert!(store.sessions.contains_key("s999"));
    let latest: Vec<_> = store.view().sessions.into_iter().map(|s| (s.bot_id, s.provider)).collect();
    assert_eq!(latest, [("b1".into(), a), ("b2".into(), OFFICIAL.into())]);

    for i in 0..2 * PINS_KEPT {
        store.pin(&format!("recent{i}"), Claude, "g", "b3", &Selection::Official(Default::default()));
    }
    assert_eq!(store.sessions.values().filter(|p| p.bot_id == "b3").count(), 2 * PINS_KEPT, "recent ones stay");
}

#[test]
fn edit_bumps_revision_only_on_change() {
    let mut store = Store::default();
    let a = kimi(&mut store);
    store.edit(&a, |_| {}).unwrap();
    assert_eq!(store.get(&a).unwrap().revision, 1);
    store.edit(&a, |p| p.endpoints[0].model = Some("k3".into())).unwrap();
    assert_eq!(store.get(&a).unwrap().revision, 2);
    assert!(store.edit(&a, |p| p.endpoints[0].base_url = "nope".into()).is_err());
    assert_eq!(store.get(&a).unwrap().revision, 2);
}

#[test]
fn a_stored_value_no_longer_accepted_does_not_block_other_changes() {
    let mut store = Store::default();
    let a = kimi(&mut store);
    let stored = store.providers.iter_mut().find(|p| p.id == a).unwrap();
    stored.endpoints[0].env.insert("ENABLE_TOOL_SEARCH".into(), "on".into());
    store.edit(&a, |p| p.endpoints[0].model = Some("k3".into())).unwrap();
    assert!(store.edit(&a, |p| _ = p.endpoints[0].env.insert("ENABLE_TOOL_SEARCH".into(), "off".into())).is_err());
    store.edit(&a, |p| _ = p.endpoints[0].env.insert("ENABLE_TOOL_SEARCH".into(), "auto:10".into())).unwrap();
    let mut again =
        Provider { endpoints: vec![store.get(&a).unwrap().endpoints[0].clone()], ..store.get(&a).unwrap().clone() };
    store.providers.iter_mut().find(|p| p.id == a).unwrap().endpoints[0]
        .env
        .insert("API_TIMEOUT_MS".into(), "0".into());
    again.endpoints[0].env.insert("API_TIMEOUT_MS".into(), "0".into());
    again.endpoints[0].model = Some("k4".into());
    assert_eq!(store.upsert(again).unwrap(), a, "only what the import changes is checked");
    assert_eq!(store.get(&a).unwrap().endpoints[0].model.as_deref(), Some("k4"));
}

#[test]
fn upsert_dedupes_by_source_then_endpoint_then_vendor() {
    let mut store = Store::default();
    let mut p = Provider::custom(Openai, "A".into(), "https://a.test/v1/".into(), KEY.into());
    p.source = Some(Source { kind: SourceKind::CcSwitch, id: Some("cc-1".into()) });
    let id = store.upsert(p.clone()).unwrap();
    assert_eq!(store.upsert(p.clone()).unwrap(), id);
    assert_eq!(store.get(&id).unwrap().revision, 1, "unchanged import keeps the revision");
    p.endpoints[0].base_url = "https://a.test/v2".into();
    assert_eq!(store.upsert(p.clone()).unwrap(), id, "same source id");
    assert_eq!(store.get(&id).unwrap().revision, 2);
    let manual = Provider::custom(Openai, "B".into(), "https://a.test/v2/".into(), KEY.into());
    assert_eq!(store.upsert(manual).unwrap(), id, "same key + base URL + protocol");
    assert_eq!((store.get(&id).unwrap().revision, store.get(&id).unwrap().name.as_str()), (3, "B"));

    // The same vendor's other protocol joins it as an endpoint; its name stays.
    let claude = Provider::custom(Anthropic, "A for Claude".into(), "https://a.test/anthropic".into(), KEY.into());
    assert_eq!(store.upsert(claude).unwrap(), id);
    let p = store.get(&id).unwrap();
    assert_eq!((p.endpoints.len(), p.name.as_str(), p.revision), (2, "B", 4));
    let elsewhere = Provider::custom(Anthropic, "Other".into(), "https://b.test/anthropic".into(), KEY.into());
    assert_ne!(store.upsert(elsewhere).unwrap(), id, "another host");
    let other_key = Provider::custom(Openai, "C".into(), "https://a.test/v2".into(), "sk-another-key-xxxx".into());
    assert_ne!(store.upsert(other_key).unwrap(), id);
    assert_eq!(store.providers.len(), 3);
}

#[test]
fn view_never_contains_the_key() {
    let mut store = Store::default();
    let a = kimi(&mut store);
    let view = store.view();
    let json = serde_json::to_string(&view).unwrap();
    assert!(!json.contains(KEY) && !json.contains("0123456789"));
    let p = &view.providers[0];
    assert_eq!((p.api_key.as_str(), p.id.as_str()), ("****abcd", a.as_str()));
    assert!(p.endpoints[0].model_options.contains(&"kimi-for-coding".to_string()), "the preset's models");
    assert_eq!(mask_key("sk-12345"), "****");
    assert_eq!(mask_key("密钥密钥密钥密钥密钥"), "****密钥密钥");
}

#[test]
fn agent_settings_default_to_inheriting_the_cli_and_view_masks_secret_env() {
    let store: Store =
        serde_json::from_str(r#"{"agentSettings":{"claude":{"values":{"language":"chinese"}}}}"#).unwrap();
    assert!(store.agent_settings(Claude).inherit_cli, "absent = inherit");
    assert_eq!(store.agent_settings(Codex), AgentSettings::default());
    let mut store = Store::default();
    let id = kimi(&mut store);
    store.edit(&id, |p| _ = p.endpoints[0].env.insert("GITHUB_TOKEN".into(), "ghp-0123456789wxyz".into())).unwrap();
    let view = store.view();
    let env = &view.providers[0].endpoints[0].env;
    assert_eq!((env["GITHUB_TOKEN"].as_str(), env["CLAUDE_CODE_MAX_CONTEXT_TOKENS"].as_str()), ("****wxyz", "262144"));
    let stored = &store.get(&id).unwrap().endpoints[0].env;
    assert_eq!(unmask_env(env.clone(), stored), *stored, "the masked value sent back = unchanged");
    let mut changed = env.clone();
    changed.insert("GITHUB_TOKEN".into(), "ghp-new".into());
    assert_eq!(unmask_env(changed, stored)["GITHUB_TOKEN"], "ghp-new");
}

#[test]
fn view_masks_the_proxy_password() {
    let mut store = Store::default();
    let id = kimi(&mut store);
    store.edit(&id, |p| p.proxy = Some("http://bob:s3cret@10.0.0.2:3128".into())).unwrap();
    let view = store.view();
    assert_eq!(view.providers[0].proxy.as_deref(), Some("http://bob:****@10.0.0.2:3128"));
    assert!(!serde_json::to_string(&view).unwrap().contains("s3cret"));
    assert_eq!(mask_proxy("http://127.0.0.1:7890"), "http://127.0.0.1:7890");
}

#[test]
fn host_tells_vendors_apart() {
    assert_eq!(host("https://API.kimi.com/coding/"), "api.kimi.com");
    assert_eq!(host("https://api.kimi.com/coding/v1"), host("https://api.kimi.com/anthropic"));
    assert_eq!(host("http://10.0.0.2:8080/v1"), "10.0.0.2:8080");
    assert_ne!(host("https://a.test"), host("https://b.test"));
}
