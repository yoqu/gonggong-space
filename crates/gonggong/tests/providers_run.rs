//! Provider injection and session pinning on the run path (design §4.3/§4.4), against the mock ACP agent.
#[path = "support/provider_rig.rs"]
mod provider_rig;

use gonggong::protocol::*;
use gonggong::providers::{OFFICIAL, Store};
use provider_rig::*;
use serde_json::{Value, json};
use std::time::Duration;

#[tokio::test]
async fn claude_gets_a_private_settings_file_named_in_meta_on_new_and_resume() {
    let mut r = rig(Duration::from_millis(200));
    let id = r.add(AgentKind::Claude, "kimi-coding", true);
    r.run(start("r1", AgentKind::Claude));
    let first = r.finish("r1").await;
    let file = r.settings_file(&id);
    let e = echo(&first);
    assert_eq!(e["settings"], file.to_str().unwrap(), "the path, never the object (argv)");
    assert!(e["systemPrompt"].as_str().unwrap().contains("小王"));
    assert_eq!(e["env"], json!({ "MODEL_PROVIDER": null, "GG_PROVIDER_KEY": null, "CODEX_CONFIG": null }));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let settings: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    assert_eq!(
        settings,
        json!({
            "apiKeyHelper": "",
            "env": {
                "ANTHROPIC_BASE_URL": "https://api.kimi.com/coding/",
                "ANTHROPIC_AUTH_TOKEN": KEY,
                "ANTHROPIC_API_KEY": "",
                "ANTHROPIC_MODEL": "kimi-for-coding",
                "ANTHROPIC_DEFAULT_HAIKU_MODEL": "kimi-for-coding",
                "ANTHROPIC_DEFAULT_SONNET_MODEL": "kimi-for-coding",
                "ANTHROPIC_DEFAULT_OPUS_MODEL": "kimi-for-coding",
                "ANTHROPIC_SMALL_FAST_MODEL": "",
                "CLAUDE_CODE_OAUTH_TOKEN": "",
                "ANTHROPIC_CUSTOM_HEADERS": "",
                "ANTHROPIC_BEDROCK_BASE_URL": "",
                "ANTHROPIC_VERTEX_BASE_URL": "",
                "CLAUDE_CODE_USE_BEDROCK": "0",
                "CLAUDE_CODE_USE_VERTEX": "0",
                "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "262144",
                "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "262144",
            }
        })
    );
    let session = first.session_id.clone().unwrap();
    assert_eq!(r.pinned(&session), id, "pinned before the prompt");

    // The adapter was reaped: the resume in a new process must carry the settings again.
    tokio::time::sleep(Duration::from_millis(600)).await;
    r.run(follow_up("r2", &first, AgentKind::Claude));
    let second = r.finish("r2").await;
    assert_ne!(echo(&second)["pid"], e["pid"]);
    assert_eq!((second.session_id.as_deref(), second.new_session_reason.as_deref()), (Some(&*session), None));
    assert_eq!(echo(&second)["settings"], file.to_str().unwrap());
}

#[tokio::test]
async fn codex_gets_the_provider_through_its_process_env() {
    let mut r = rig(Duration::from_secs(60));
    r.add(AgentKind::Codex, "zhipu", true);
    r.run(start("r1", AgentKind::Codex));
    let e = echo(&r.finish("r1").await);
    assert_eq!(e["settings"], Value::Null);
    assert_eq!((e["env"]["MODEL_PROVIDER"].as_str(), e["env"]["GG_PROVIDER_KEY"].as_str()), (Some("gg"), Some(KEY)));
    let config = &e["env"]["CODEX_CONFIG"];
    assert!(config["developer_instructions"].as_str().unwrap().contains("小王"));
    assert_eq!(config["model_provider"], "gg");
    assert_eq!(config["model"], "glm-5.3");
    assert_eq!(config["model_reasoning_effort"], "high");
    assert_eq!(
        config["model_providers"],
        json!({ "gg": {
            "name": "智谱 GLM",
            "base_url": "https://open.bigmodel.cn/api/v1",
            "wire_api": "responses",
            "env_key": "GG_PROVIDER_KEY",
        } })
    );
    assert!(!config.to_string().contains(KEY));
    assert!(!r.home().join("run").exists());
}

#[tokio::test]
async fn official_injects_nothing() {
    let mut r = rig(Duration::from_secs(60));
    r.add(AgentKind::Codex, "zhipu", false);
    r.run(start("r1", AgentKind::Claude));
    let done = r.finish("r1").await;
    let e = echo(&done);
    assert_eq!(e["settings"], Value::Null);
    assert_eq!(e["env"], json!({ "MODEL_PROVIDER": null, "GG_PROVIDER_KEY": null, "CODEX_CONFIG": null }));
    assert_eq!(r.pinned(done.session_id.as_deref().unwrap()), OFFICIAL);

    let codex = start("r2", AgentKind::Codex);
    r.run(RunStart { bot: RunBot { id: "b2".into(), ..codex.bot.clone() }, ..codex });
    let e = echo(&r.finish("r2").await);
    assert_eq!((e["env"]["MODEL_PROVIDER"].clone(), e["env"]["GG_PROVIDER_KEY"].clone()), (Value::Null, Value::Null));
    let config = e["env"]["CODEX_CONFIG"].as_object().unwrap();
    assert_eq!(config.keys().collect::<Vec<_>>(), ["developer_instructions"]);
    assert!(!r.home().join("run").exists());
}

#[tokio::test]
async fn a_resumed_session_keeps_its_pinned_provider_after_the_default_changes() {
    let mut r = rig(Duration::from_secs(60));
    let a = r.add(AgentKind::Claude, "kimi-coding", true);
    r.run(start("r1", AgentKind::Claude));
    let first = r.finish("r1").await;
    let b = r.add(AgentKind::Claude, "zhipu", true);

    r.run(follow_up("r2", &first, AgentKind::Claude));
    let second = r.finish("r2").await;
    assert_eq!(second.session_id, first.session_id);
    assert_eq!(echo(&second)["pid"], echo(&first)["pid"], "same provider: same adapter");
    assert_eq!(echo(&second)["settings"], r.settings_file(&a).to_str().unwrap());

    // /new switches to the effective provider in a fresh adapter.
    r.run(RunStart { new_session_reason: Some("requested".into()), ..start("r3", AgentKind::Claude) });
    let third = r.finish("r3").await;
    assert_ne!(third.session_id, first.session_id);
    assert_ne!(echo(&third)["pid"], echo(&first)["pid"]);
    assert_eq!(echo(&third)["settings"], r.settings_file(&b).to_str().unwrap());
    assert_eq!(r.pinned(third.session_id.as_deref().unwrap()), b);
    assert_eq!(r.pinned(first.session_id.as_deref().unwrap()), a);
}

#[tokio::test]
async fn a_removed_pinned_provider_starts_a_new_session_with_recent_history() {
    let mut r = rig(Duration::from_secs(60));
    let a = r.add(AgentKind::Claude, "kimi-coding", true);
    r.run(start("r1", AgentKind::Claude));
    let first = r.finish("r1").await;
    assert!(r.settings_file(&a).exists());
    Store::update(r.home(), |s| s.remove(&a).map(drop)).unwrap();

    r.run(follow_up("r2", &first, AgentKind::Claude));
    let second = r.finish("r2").await;
    let e = echo(&second);
    assert_eq!(second.new_session_reason.as_deref(), Some("provider_removed"));
    assert_ne!(second.session_id, first.session_id);
    assert_ne!(e["pid"], echo(&first)["pid"]);
    assert_eq!(e["settings"], Value::Null);
    assert!(e["prompt"].as_str().unwrap().starts_with("群聊上下文：\n[#1 2026-09-23 09:00] 王磊: 旧消息\n"));
    assert_eq!(r.pinned(second.session_id.as_deref().unwrap()), OFFICIAL);
    assert!(!r.settings_file(&a).exists(), "the removed provider's key is not left on disk");
}

#[tokio::test]
async fn editing_the_provider_restarts_the_adapter_and_resumes() {
    let mut r = rig(Duration::from_secs(60));
    let a = r.add(AgentKind::Claude, "kimi-coding", true);
    r.run(start("r1", AgentKind::Claude));
    let first = r.finish("r1").await;
    Store::update(r.home(), |s| s.edit(&a, |p| p.api_key = "sk-rotated-key-9876543210".into())).unwrap();

    r.run(follow_up("r2", &first, AgentKind::Claude));
    let second = r.finish("r2").await;
    assert_ne!(echo(&second)["pid"], echo(&first)["pid"]);
    assert_eq!((second.session_id.clone(), second.new_session_reason), (first.session_id.clone(), None));
    let settings: Value = serde_json::from_slice(&std::fs::read(r.settings_file(&a)).unwrap()).unwrap();
    assert_eq!(settings["env"]["ANTHROPIC_AUTH_TOKEN"], "sk-rotated-key-9876543210");
}

#[tokio::test]
async fn a_third_party_provider_runs_its_own_model() {
    let mut r = rig(Duration::from_secs(60));
    let id = r.add(AgentKind::Claude, "kimi-coding", true);
    let with_model =
        |s: RunStart, model: &str| RunStart { bot: RunBot { model: Some(model.into()), ..s.bot.clone() }, ..s };
    // An official model name means nothing to the provider: its own default runs (injected, nothing to switch).
    r.run(with_model(start("r1", AgentKind::Claude), "opus"));
    let first = r.finish("r1").await;
    assert_eq!(echo(&first)["configSets"], json!([]));
    assert_eq!(r.configs.pop(), Some(("r1".into(), Some("kimi-for-coding".into()))));

    // One of the provider's models the adapter offers is switched to.
    Store::update(r.home(), |s| s.edit(&id, |p| p.models.as_mut().unwrap().haiku = Some("haiku".into()))).unwrap();
    r.run(with_model(follow_up("r2", &first, AgentKind::Claude), "haiku"));
    let second = r.finish("r2").await;
    assert_eq!(echo(&second)["configSets"], json!(["model=haiku"]));
    assert_eq!(r.configs.pop(), Some(("r2".into(), Some("haiku".into()))));
}

#[tokio::test]
async fn codex_runs_with_the_providers_proxy_and_env_over_the_users() {
    let mut r = rig(Duration::from_secs(60));
    let id = r.add(AgentKind::Codex, "zhipu", true);
    let env = |pairs: &[(&str, &str)]| pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    Store::update(r.home(), |s| {
        s.edit(&id, |p| {
            p.proxy = Some("http://127.0.0.1:7890".into());
            p.env = env(&[("GG_EXTRA", "provider"), ("NO_PROXY", "corp.cn"), ("GG_PROVIDER_KEY", "nope")]);
        })
    })
    .unwrap();
    let settings = gonggong::config::Settings { env: env(&[("GG_EXTRA", "user")]), ..Default::default() };
    settings.save(r.home()).unwrap();
    r.run(start("r1", AgentKind::Codex));
    let e = echo(&r.finish("r1").await);
    assert_eq!(
        e["settingsEnv"],
        json!({ "HTTPS_PROXY": "http://127.0.0.1:7890", "NO_PROXY": "localhost,127.0.0.1,::1,corp.cn", "GG_EXTRA": "provider" })
    );
    assert_eq!(e["env"]["GG_PROVIDER_KEY"], KEY, "the connection wins over the provider's env");
}

#[tokio::test]
async fn claude_gets_the_providers_proxy_and_env_in_its_settings_file() {
    let mut r = rig(Duration::from_secs(60));
    let id = r.add(AgentKind::Claude, "kimi-coding", true);
    Store::update(r.home(), |s| {
        s.edit(&id, |p| {
            p.proxy = Some("http://127.0.0.1:7890".into());
            p.env.insert("GG_EXTRA".into(), "1".into());
        })
    })
    .unwrap();
    r.run(start("r1", AgentKind::Claude));
    r.finish("r1").await;
    let settings: Value = serde_json::from_slice(&std::fs::read(r.settings_file(&id)).unwrap()).unwrap();
    let env = &settings["env"];
    for k in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] {
        assert_eq!(env[k], "http://127.0.0.1:7890", "{k}");
    }
    assert_eq!(
        (env["NO_PROXY"].as_str(), env["no_proxy"].as_str()),
        (Some("localhost,127.0.0.1,::1"), Some("localhost,127.0.0.1,::1"))
    );
    assert_eq!(env["GG_EXTRA"], "1");
}
