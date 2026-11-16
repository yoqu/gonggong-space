//! Agents that speak ACP themselves (Gemini CLI, CodeBuddy, DeepSeek Harness, Antigravity CLI and the third wave:
//! OpenCode, Qwen Code, Kimi Code, Goose, GitHub Copilot CLI) and pi (through pi-acp with gonggong's
//! extension) against the mock agent acting like them.
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

#[tokio::test]
async fn pi_gets_the_extension_the_instructions_and_the_mcp_servers_through_its_env() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("p1", AgentKind::Pi));
    let e = echo(&r.finish("p1").await);
    let pi = &e["pi"];
    assert_eq!(pi["command"], r.home().join("pi/pi-gonggong").to_str().unwrap());
    // The extension ships in the agent-pi plugin.
    let extension = std::path::PathBuf::from(pi["extension"].as_str().unwrap());
    assert!(extension.ends_with("contrib/agents/pi/gonggong.ts") && extension.is_file(), "{extension:?}");
    let prompt = pi["systemPrompt"].as_str().unwrap();
    assert!(prompt.contains("小王") && prompt.contains("只改 server/"), "{prompt}");
    let gonggong = &pi["mcp"]["gonggong"];
    assert!(gonggong["url"].as_str().unwrap().starts_with("http://127.0.0.1:"));
    assert_eq!(gonggong["exposure"], "direct");
    assert_eq!(e["mode"], "medium", "pi's modes are thought levels: the tier picks none");
}

#[tokio::test]
async fn the_pi_extensions_confirm_is_judged_as_the_tool_call_it_is_about() {
    let mut r = rig(Duration::from_secs(60));
    // `finish` would time out on an approval request: both are answered without the owner.
    let pi = |run_id: &str, text: &str| {
        let mut s = start(run_id, AgentKind::Pi);
        s.prompt.text = text.into();
        s
    };
    r.run(pi("p1", "mock:exec rg -n TODO ."));
    let done = r.finish("p1").await;
    assert_eq!(done.reply, "ran");
    r.run(RunStart { resume_session_id: done.session_id.clone(), ..pi("p2", "mock:tool list_messages {}") });
    assert_ne!(r.finish("p2").await.reply, "ask denied");
}

#[tokio::test]
async fn deepseek_runs_the_acp_profile_with_the_instructions_patched_in_and_the_key_in_its_env() {
    let mut r = rig(Duration::from_secs(60));
    r.add(AgentKind::Deepseek, "deepseek", true);
    let mut s = start("d1", AgentKind::Deepseek);
    s.bot.tier = Tier::ReadOnly;
    r.run(s);
    let e = echo(&r.finish("d1").await);
    let d = &e["deepseek"];
    assert_eq!((d["profile"].as_str(), d["permissionMode"].as_str()), (Some("acp"), Some("read-only")));
    assert_eq!((d["apiKey"].as_str(), d["baseUrl"].as_str()), (Some(KEY), Some("https://api.deepseek.com/anthropic")));
    assert_eq!(d["patch"][0]["id"], "system-prompt");
    let persona = d["patch"][0]["config"]["personaPrefix"].as_str().unwrap();
    assert!(persona.starts_with("You are a coding agent powered by the {{model}} model.\n\n"), "{persona}");
    assert!(persona.contains("小王") && persona.contains("只改 server/"), "{persona}");
    assert!(e["mcpServers"].as_array().unwrap().iter().any(|m| m["name"] == "gonggong"));
}

#[tokio::test]
async fn antigravity_runs_agy_acp_with_the_instructions_in_the_session_meta() {
    let mut r = rig(Duration::from_secs(60));
    let mut s = start("a1", AgentKind::Antigravity);
    s.bot.tier = Tier::Full;
    r.run(s);
    let e = echo(&r.finish("a1").await);
    let args: Vec<String> = serde_json::from_value(e["args"].clone()).unwrap();
    assert_eq!(args, ["acp", "--disable-telemetry"]);
    let prompt = e["meta"]["antigravity"]["systemPrompt"]["append"].as_str().unwrap();
    assert!(prompt.contains("小王") && prompt.contains("只改 server/"), "{prompt}");
    assert_eq!(e["systemPrompt"], Value::Null, "not Claude's `_meta.systemPrompt`");
    // agy has no bypass mode: 完全访问 edits freely and the daemon allows the rest.
    assert_eq!(e["mode"], "accept-edits");
    assert!(e["mcpServers"].as_array().unwrap().iter().any(|m| m["name"] == "gonggong"));
}

#[tokio::test]
async fn a_probe_offering_no_models_fails_so_no_empty_list_is_cached() {
    let r = rig(Duration::from_secs(60));
    let dir = r.home().join("probe");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(".mock-no-models"), "").unwrap();
    let err = r.try_probe(AgentKind::Antigravity).await.unwrap_err();
    assert!(err.to_string().contains("没有报告可选模型"), "{err:#}");
}

fn has_bot_prompt(text: &str) {
    assert!(text.contains("小王") && text.contains("只改 server/"), "{text}");
}

#[tokio::test]
async fn opencode_keeps_its_login_and_reads_the_instructions_from_its_inline_config() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("o1", AgentKind::Opencode));
    let e = echo(&r.finish("o1").await);
    assert_eq!(e["args"], serde_json::json!(["acp"]));
    has_bot_prompt(e["agentInstructions"].as_str().unwrap());
    let config: Value = serde_json::from_str(e["agentEnv"]["OPENCODE_CONFIG_CONTENT"].as_str().unwrap()).unwrap();
    assert!(config["instructions"][0].as_str().unwrap().starts_with(r.home().join("opencode/g1-b1").to_str().unwrap()));
    assert!(e["mcpServers"].as_array().unwrap().iter().any(|m| m["name"] == "gonggong"));
}

#[tokio::test]
async fn qwen_takes_an_openai_endpoint_with_its_auth_type_and_the_instructions_as_an_argument() {
    let mut r = rig(Duration::from_secs(60));
    r.add(AgentKind::Qwen, "kimi", true);
    r.run(start("q1", AgentKind::Qwen));
    let e = echo(&r.finish("q1").await);
    let args: Vec<String> = serde_json::from_value(e["args"].clone()).unwrap();
    assert_eq!(args[0], "--acp");
    has_bot_prompt(&args[args.iter().position(|a| a == "--append-system-prompt").unwrap() + 1]);
    assert_eq!(&args[args.len() - 2..], ["--auth-type", "openai"]);
    let env = &e["agentEnv"];
    assert_eq!((env["OPENAI_API_KEY"].as_str(), env["OPENAI_MODEL"].as_str()), (Some(KEY), Some("kimi-k3")));
    assert_eq!(env["OPENAI_BASE_URL"], "https://api.moonshot.cn/v1");
}

#[tokio::test]
async fn kimi_runs_in_a_home_of_its_own_with_the_endpoint_its_protocol_names() {
    let mut r = rig(Duration::from_secs(60));
    r.add(AgentKind::Kimi, "kimi", true);
    let mut s = start("k1", AgentKind::Kimi);
    s.bot.tier = Tier::Full;
    r.run(s);
    let e = echo(&r.finish("k1").await);
    let env = &e["agentEnv"];
    assert_eq!(env["KIMI_CODE_HOME"], r.home().join("kimi/g1-b1/home").to_str().unwrap());
    has_bot_prompt(e["agentInstructions"].as_str().unwrap());
    // The first endpoint Kimi Code takes: Anthropic's.
    assert_eq!(
        (env["KIMI_MODEL_PROVIDER_TYPE"].as_str(), env["KIMI_MODEL_API_KEY"].as_str()),
        (Some("anthropic"), Some(KEY))
    );
    assert_eq!(env["KIMI_MODEL_BASE_URL"], "https://api.moonshot.cn/anthropic");
    assert_eq!(env["KIMI_MODEL_NAME"], "kimi-k2.7-code");
    assert_eq!(e["mode"], "yolo");
}

#[tokio::test]
async fn goose_on_an_openai_endpoint_names_its_provider_and_reads_the_hints_of_its_root() {
    let mut r = rig(Duration::from_secs(60));
    r.add(AgentKind::Goose, "xai", true);
    let mut s = start("g1", AgentKind::Goose);
    s.bot.tier = Tier::ReadOnly;
    r.run(s);
    let e = echo(&r.finish("g1").await);
    let env = &e["agentEnv"];
    assert_eq!(env["GOOSE_PATH_ROOT"], r.home().join("goose/g1-b1").to_str().unwrap());
    has_bot_prompt(e["agentInstructions"].as_str().unwrap());
    assert_eq!((env["GOOSE_PROVIDER"].as_str(), env["GOOSE_MODEL"].as_str()), (Some("openai"), Some("grok-4.5")));
    assert_eq!(
        (env["OPENAI_API_KEY"].as_str(), env["OPENAI_BASE_URL"].as_str()),
        (Some(KEY), Some("https://api.x.ai/v1"))
    );
    assert_eq!(e["mode"], "approve");
}

#[tokio::test]
async fn copilot_needs_the_providers_model_and_reads_the_instructions_from_an_extra_dir() {
    let mut r = rig(Duration::from_secs(60));
    // An endpoint without a model: Copilot CLI would quietly use its GitHub login instead.
    r.add(AgentKind::Copilot, "qwen-coding", true);
    r.run(start("c1", AgentKind::Copilot));
    let done = r.finish("c1").await;
    assert_ne!(done.outcome, RunOutcome::Completed);
    assert!(format!("{:?}", done.error).contains("GitHub Copilot CLI"), "{:?}", done.error);

    r.add(AgentKind::Copilot, "deepseek", true);
    r.run(start("c2", AgentKind::Copilot));
    let e = echo(&r.finish("c2").await);
    let env = &e["agentEnv"];
    has_bot_prompt(e["agentInstructions"].as_str().unwrap());
    assert_eq!(
        (env["COPILOT_PROVIDER_TYPE"].as_str(), env["COPILOT_MODEL"].as_str()),
        (Some("anthropic"), Some("deepseek-v4-pro"))
    );
    assert_eq!(env["COPILOT_PROVIDER_BASE_URL"], "https://api.deepseek.com/anthropic");
    assert_eq!(env["COPILOT_PROVIDER_API_KEY"], KEY);

}
