//! Agents that speak ACP themselves (Gemini CLI, CodeBuddy) against the mock agent acting like them.
#[path = "../support/provider_rig.rs"]
mod provider_rig;

use gonggong::protocol::*;
use gonggong::providers::OFFICIAL;
use provider_rig::*;
use serde_json::Value;
use std::time::Duration;

fn gemini(run_id: &str, text: &str) -> RunStart {
    let mut s = start(run_id, AgentKind::Gemini);
    s.prompt.text = text.into();
    s
}

#[tokio::test]
async fn a_provider_run_gets_its_own_home_with_the_instructions_and_the_key_in_the_env() {
    let mut r = rig(Duration::from_secs(60));
    let id = r.add(AgentKind::Gemini, "openrouter", true);
    r.run(gemini("r1", "mock:echo"));
    let done = r.finish("r1").await;
    let e = echo(&done);
    let g = &e["gemini"];
    let home = r.home().join("gemini/g1-b1");
    assert_eq!(g["home"], home.to_str().unwrap());
    assert_eq!(g["trust"], "true");
    assert_eq!((g["apiKey"].as_str(), g["baseUrl"].as_str()), (Some(KEY), Some("https://openrouter.ai/api")));
    assert_eq!(g["model"], "gemini-3.6-flash");
    let memory = g["memory"].as_str().unwrap();
    assert!(memory.contains("小王") && memory.contains("只改 server/"), "{memory}");
    assert_eq!(g["settings"]["security"]["auth"]["selectedType"], "gemini-api-key");
    let gonggong = &g["settings"]["mcpServers"]["gonggong"];
    assert!(gonggong["httpUrl"].as_str().unwrap().starts_with("http://127.0.0.1:"));
    assert!(gonggong["timeout"].as_u64().unwrap() > 24 * 3600 * 1000);
    assert_eq!(e["mcpServers"], Value::Array(vec![]), "the gonggong server comes with the settings, not ACP");
    assert_eq!(e["mode"], "autoEdit");
    assert!(!g["settings"].to_string().contains(KEY), "the key stays in the process env");
    assert_eq!(r.pinned(done.session_id.as_deref().unwrap()), id);
    assert_eq!(r.configs, vec![("r1".into(), Some("gemini-3.6-flash".into()))]);
}

#[tokio::test]
async fn the_official_login_picks_the_bots_model_the_older_way_and_resumes_by_load() {
    let mut r = rig(Duration::from_millis(200));
    let mut s = gemini("r1", "mock:echo");
    s.bot.model = Some("gemini-3.8-flash".into());
    s.bot.tier = Tier::Full;
    r.run(s.clone());
    let first = r.finish("r1").await;
    let e = echo(&first);
    assert_eq!((e["model"].as_str(), e["mode"].as_str()), (Some("gemini-3.8-flash"), Some("yolo")));
    assert_eq!(e["configSets"], serde_json::json!(["model=gemini-3.8-flash"]));
    assert_eq!(e["gemini"]["apiKey"], Value::Null);
    assert_eq!(e["gemini"]["settings"]["security"], Value::Null, "the user's own login");
    assert_eq!(r.configs.last().unwrap().1.as_deref(), Some("gemini-3.8-flash"));
    assert_eq!(r.pinned(first.session_id.as_deref().unwrap()), OFFICIAL);

    // The process was reaped: the next one loads the session in the same home.
    tokio::time::sleep(Duration::from_millis(600)).await;
    r.run(RunStart { resume_session_id: first.session_id.clone(), run_id: "r2".into(), ..s });
    let second = r.finish("r2").await;
    assert_ne!(echo(&second)["pid"], e["pid"]);
    assert_eq!(
        (second.session_id.as_deref(), second.new_session_reason.as_deref()),
        (first.session_id.as_deref(), None)
    );
}

#[tokio::test]
async fn shell_commands_are_judged_by_their_title_and_gonggong_tools_by_the_server_in_meta() {
    let mut r = rig(Duration::from_secs(60));
    // `finish` would time out on an approval request: both are answered without the owner.
    r.run(gemini("r1", "mock:exec rg -n TODO ."));
    let done = r.finish("r1").await;
    assert_eq!(done.reply, "ran");
    r.run(RunStart { resume_session_id: done.session_id.clone(), ..gemini("r2", "mock:tool list_messages {}") });
    let done = r.finish("r2").await;
    assert_ne!(done.reply, "ask denied");
}

#[tokio::test]
async fn the_probe_reads_the_models_gemini_offers() {
    let r = rig(Duration::from_secs(60));
    let catalog = r.probe(AgentKind::Gemini).await;
    let models: Vec<_> = catalog.models.iter().map(|m| m.choice.value.as_str()).collect();
    assert_eq!(models, ["gemini-2.5-pro", "gemini-3.8-flash"]);
    assert_eq!(catalog.current.as_deref(), Some("gemini-2.5-pro"));
    assert!(r.home().join("gemini/probe/.gemini/settings.json").is_file());
}

#[tokio::test]
async fn codebuddy_gets_the_instructions_and_plugins_with_its_process_and_the_key_in_its_env() {
    let mut r = rig(Duration::from_secs(60));
    r.add(AgentKind::Codebuddy, "codebuddy-cn", true);
    let mut s = start("c1", AgentKind::Codebuddy);
    s.bot.tier = Tier::Full;
    r.run(s);
    let e = echo(&r.finish("c1").await);
    let args: Vec<String> = serde_json::from_value(e["args"].clone()).unwrap();
    let prompt = args.iter().position(|a| a == "--append-system-prompt").map(|i| &args[i + 1]).unwrap();
    assert!(prompt.contains("小王") && prompt.contains("只改 server/"), "{prompt}");
    assert!(!args.contains(&"--plugin-dir".to_string()), "no skills or plugins this turn");
    let c = &e["codebuddy"];
    assert_eq!((c["apiKey"].as_str(), c["environment"].as_str()), (Some(KEY), Some("internal")));
    assert_eq!(c["baseUrl"], Value::Null, "CodeBuddy's own service: no model gateway");
    assert!(c["mcpTimeout"].as_str().unwrap().parse::<u64>().unwrap() > 24 * 3600 * 1000);
    assert_eq!(e["mode"], "bypassPermissions");
    assert!(e["mcpServers"].as_array().unwrap().iter().any(|m| m["name"] == "gonggong"));
}
