use super::*;
use agent_client_protocol::schema::v1::{HttpHeader, McpServerHttp, ToolCallUpdateFields, ToolKind};

fn a(kind: AgentKind) -> &'static Adapter {
    get(kind).unwrap()
}

#[test]
fn reads_the_built_in_manifests() {
    let ids: Vec<_> = all().iter().map(|a| (a.kind, a.plugin)).collect();
    assert_eq!(
        ids,
        [
            (AgentKind::Gemini, "agent-gemini"),
            (AgentKind::Codebuddy, "agent-codebuddy"),
            (AgentKind::Pi, "agent-pi"),
            (AgentKind::Deepseek, "agent-deepseek"),
            (AgentKind::Antigravity, "agent-antigravity"),
            (AgentKind::Opencode, "agent-opencode"),
            (AgentKind::Qwen, "agent-qwen"),
            (AgentKind::Kimi, "agent-kimi"),
            (AgentKind::Goose, "agent-goose"),
            (AgentKind::Copilot, "agent-copilot"),
        ]
    );
    assert!(get(AgentKind::Claude).is_none() && get(AgentKind::Codex).is_none(), "code adapters");
    // Off npm: the hint is the maker's install command.
    let agy = a(AgentKind::Antigravity);
    assert_eq!(agy.spec.install.npm, None);
    assert!(agy.missing().contains("curl -fsSL https://antigravity.google/cli/install.sh | bash"));
    assert!(a(AgentKind::Gemini).missing().contains("npm install -g @google/gemini-cli"));
    assert_eq!(a(AgentKind::Pi).adapter_version(), Some("0.0.34"));
    assert_eq!(a(AgentKind::Deepseek).spec.install.min_node, "24.9.0");
    assert_eq!(a(AgentKind::Gemini).spec.install.min_node, "22.0.0", "the default");
    assert!(a(AgentKind::Deepseek).restarts_on_tier() && !a(AgentKind::Gemini).restarts_on_tier());
    assert_eq!(a(AgentKind::Pi).tier(Tier::Full).map(|t| t.mode.clone()), None);
    assert_eq!(a(AgentKind::Deepseek).tier(Tier::ReadOnly).unwrap().env["DSH_PERMISSION_MODE"], "read-only");
    assert_eq!(steering_dirs().collect::<Vec<_>>(), [".gemini", ".opencode", ".qwen", ".kimi-code"]);
    assert!(a(AgentKind::Goose).missing().contains("download_cli.sh | CONFIGURE=false bash"));
    assert_eq!(a(AgentKind::Kimi).spec.install.min_node, "22.19.0");
    assert_eq!(mcp_meta_keys().collect::<Vec<_>>(), ["gemini-cli"]);
    assert_eq!(error_meta_keys().collect::<Vec<_>>(), ["codebuddy.ai/errorMessage"]);
}

#[test]
fn writes_the_plugin_folder_once_per_content() {
    let home = tempfile::tempdir().unwrap();
    let pkg = a(AgentKind::Pi).pkg_dir(home.path()).unwrap();
    assert!(pkg.join("contrib/agents/pi/gonggong.ts").is_file());
    assert!(pkg.join("gonggong-plugin.json").is_file());
    assert_eq!(a(AgentKind::Pi).pkg_dir(home.path()).unwrap(), pkg);
}

#[test]
fn fills_arguments_and_lists_plugin_dirs_one_per_argument() {
    let vars = Vars { prompt: "hi", state: Some(Path::new("/s")), cli: Some("/bin/x"), ..Default::default() };
    assert_eq!(vars.fill("{prompt} {state}/a {cli} {pkg}"), "hi /s/a /bin/x ");
    // The bot's own words go in verbatim, braces and all.
    let code = Vars { prompt: "run {cli} in {pkg}", cli: Some("/bin/x"), ..Default::default() };
    assert_eq!(code.fill("--append-system-prompt={prompt}"), "--append-system-prompt=run {cli} in {pkg}");
    let args = vec!["--plugin-dir".to_string(), "{pluginDirs}".to_string()];
    assert!(with_dirs(&args, &[], &vars).is_empty());
    let dirs = [PathBuf::from("/a"), PathBuf::from("/b")];
    assert_eq!(with_dirs(&args, &dirs, &vars), ["--plugin-dir", "/a", "/b"]);
}

#[test]
fn codebuddy_sets_a_base_url_only_for_a_third_party_service() {
    let c = a(AgentKind::Codebuddy);
    assert_eq!(c.base_url("https://copilot.tencent.com/"), None);
    assert_eq!(c.base_url("https://www.codebuddy.ai"), None);
    assert_eq!(c.base_url("https://openrouter.ai/api/v1/"), Some("https://openrouter.ai/api/v1"));
    assert_eq!(a(AgentKind::Gemini).base_url("https://g.test"), Some("https://g.test"));
}

#[test]
fn tells_the_logins_from_env_and_files() {
    let home = tempfile::tempdir().unwrap();
    let none = |_: &str| None;
    let key = |n: &str| (n == "GEMINI_API_KEY" || n == "DEEPSEEK_API_KEY").then(|| "k".to_string());
    let gemini = a(AgentKind::Gemini);
    assert_eq!(gemini.login_status(home.path(), &none).as_deref(), Some("未登录"));
    assert_eq!(gemini.login_status(home.path(), &key).as_deref(), Some("已登录 · API key"));
    std::fs::create_dir_all(home.path().join(".gemini")).unwrap();
    std::fs::write(home.path().join(".gemini/.env"), "# key\nexport GEMINI_API_KEY=\"\"\n").unwrap();
    assert_eq!(gemini.login_status(home.path(), &none).as_deref(), Some("未登录"), "an empty value");
    std::fs::write(home.path().join(".env"), "GEMINI_API_KEY=AIza-x\n").unwrap();
    assert_eq!(gemini.login_status(home.path(), &none).as_deref(), Some("已登录 · API key"));
    let vertex = "{ // vertex\n \"security\": { \"auth\": { \"selectedType\": \"vertex-ai\" } } }";
    std::fs::write(home.path().join(".gemini/settings.json"), vertex).unwrap();
    assert_eq!(gemini.login_status(home.path(), &none).as_deref(), Some("已登录 · Vertex AI"));
    // Google sign-in wins over any key: Gemini CLI then opens the browser, and it no longer works.
    let google = r#"{ "security": { "auth": { "selectedType": "oauth-personal" } } }"#;
    std::fs::write(home.path().join(".gemini/settings.json"), google).unwrap();
    let google_out = Some("未登录 · Google 账号登录已不支持");
    assert_eq!(gemini.login_status(home.path(), &key).as_deref(), google_out);
    std::fs::write(home.path().join(".gemini/settings.json"), r#"{"selectedAuthType":"oauth-personal"}"#).unwrap();
    assert_eq!(gemini.login_status(home.path(), &none).as_deref(), google_out, "the older settings key");
    std::fs::remove_file(home.path().join(".gemini/settings.json")).unwrap();

    let codebuddy = a(AgentKind::Codebuddy);
    assert_eq!(codebuddy.login_status(home.path(), &none), None, "it cannot tell");
    let cb = |n: &str| (n == "CODEBUDDY_API_KEY").then(|| "k".to_string());
    assert_eq!(codebuddy.login_status(home.path(), &cb).as_deref(), Some("已登录 · API key"));

    let dir = tempfile::tempdir().unwrap();
    let at = |n: &str| (n == "PI_CODING_AGENT_DIR" || n == "DSH_HOME").then(|| dir.path().to_string_lossy().into());
    let pi = a(AgentKind::Pi);
    assert_eq!(pi.login_status(home.path(), &at), None);
    std::fs::write(dir.path().join("auth.json"), "{}").unwrap();
    assert_eq!(pi.login_status(home.path(), &at), None);
    std::fs::write(dir.path().join("auth.json"), r#"{"anthropic":{"type":"oauth"},"openai":{"key":"k"}}"#).unwrap();
    assert_eq!(pi.login_status(home.path(), &at).as_deref(), Some("已登录 · anthropic, openai"));

    let dsh = a(AgentKind::Deepseek);
    assert_eq!(dsh.login_status(home.path(), &at).as_deref(), Some("未登录"));
    assert_eq!(dsh.login_status(home.path(), &key).as_deref(), Some("已登录 · API key"));
    std::fs::write(dir.path().join(".credentials.yaml"), "DEEPSEEK_API_KEY: ''\n").unwrap();
    assert_eq!(dsh.login_status(home.path(), &at).as_deref(), Some("未登录"), "an empty value");
    std::fs::write(dir.path().join(".credentials.yaml"), "DEEPSEEK_API_KEY: sk-x\n").unwrap();
    assert_eq!(dsh.login_status(home.path(), &at).as_deref(), Some("已登录 · API key"));
}

fn confirm(message: &str) -> acp::ToolCallUpdate {
    let raw = json!({ "method": "confirm", "title": "bash", "message": message });
    acp::ToolCallUpdate::new("pi-ui-7", ToolCallUpdateFields::new().title("bash").kind(ToolKind::Other).raw_input(raw))
}

#[test]
fn makes_a_gonggong_approval_request_one_for_its_tool_call() {
    let message = json!({ "gonggong": { "toolCallId": "call_1", "input": { "command": "rm -rf build" } } });
    let mut call = confirm(&message.to_string());
    own_request(&mut call);
    assert_eq!(call.tool_call_id.0.as_ref(), "call_1");
    assert_eq!(call.fields.title, None, "the tool keeps the title the adapter gave it");
    assert_eq!(call.fields.kind, None);
    assert_eq!(call.fields.raw_input, Some(json!({ "command": "rm -rf build" })));
    let message = json!({ "gonggong": { "toolCallId": "c2", "title": "mcp__gonggong__list_messages", "input": {} } });
    let mut call = confirm(&message.to_string());
    own_request(&mut call);
    assert_eq!(call.fields.title.as_deref(), Some("mcp__gonggong__list_messages"));
    let mut other = confirm("Allow rm -rf?");
    own_request(&mut other);
    assert_eq!(other.tool_call_id.0.as_ref(), "pi-ui-7");
}

fn ask() -> acp::McpServer {
    acp::McpServer::Http(
        McpServerHttp::new("gonggong", "http://127.0.0.1:1/s").headers(vec![HttpHeader::new("x-k", "v")]),
    )
}

#[test]
fn hands_the_runs_mcp_servers_and_gonggongs_as_a_map() {
    let servers = vec![
        McpServer::Stdio {
            name: "fs".into(),
            command: "npx".into(),
            args: vec!["-y".into(), "fs-mcp".into()],
            env: BTreeMap::from([("K".into(), "v".into())]),
        },
        McpServer::Http {
            name: "docs".into(),
            url: "https://docs.example.com/mcp".into(),
            headers: BTreeMap::from([("Authorization".into(), "Bearer t".into())]),
        },
    ];
    let env: Value = serde_json::from_str(&mcp_map(&servers, Some(&ask()), &a(AgentKind::Pi).spec.mcp.extra)).unwrap();
    assert_eq!(env["fs"]["command"], "npx");
    assert_eq!(env["fs"]["env"]["K"], "v");
    assert_eq!(env["docs"]["headers"]["Authorization"], "Bearer t");
    assert_eq!(env["gonggong"]["url"], "http://127.0.0.1:1/s");
    assert_eq!(env["gonggong"]["headers"]["x-k"], "v");
    assert_eq!(env["gonggong"]["exposure"], "direct");
    assert_eq!(env["gonggong"]["timeout"], 90_000);
}

#[test]
fn strips_json_comments_but_not_strings() {
    let text = "{ // c\n \"a\": \"//x\", /* b */ \"c\": 1 /*/ y */ }";
    let v: Value = serde_json::from_str(&strip_comments(text)).unwrap();
    assert_eq!(v, json!({ "a": "//x", "c": 1 }));
}

async fn launch(kind: AgentKind, home: &Path, input: Value) -> Result<Launch, String> {
    let pkg = a(kind).pkg_dir(home).unwrap();
    let script = pkg.join(a(kind).spec.launch_script.as_ref().unwrap());
    run_script(Path::new("node"), &script, &input).await
}

#[tokio::test]
async fn a_failing_or_silent_script_fails_the_launch() {
    let dir = tempfile::tempdir().unwrap();
    let bad = dir.path().join("bad.mjs");
    std::fs::write(&bad, "console.error('boom'); process.exit(3)").unwrap();
    let e = run_script(Path::new("node"), &bad, &json!({})).await.unwrap_err();
    assert!(e.contains("boom"), "{e}");
    let echo = dir.path().join("echo.mjs");
    std::fs::write(&echo, "process.stdin.on('data', (d) => process.stdout.write(JSON.stringify({ env: { IN: String(JSON.parse(d).x) }, args: ['-a'] })))").unwrap();
    let out = run_script(Path::new("node"), &echo, &json!({ "x": 7 })).await.unwrap();
    assert_eq!(out, Launch { env: BTreeMap::from([("IN".into(), "7".into())]), args: vec!["-a".into()] });
}

#[tokio::test]
async fn gemini_gets_a_home_with_the_instructions_the_login_and_the_gonggong_server() {
    let (home, user) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let own = user.path().join(".gemini");
    std::fs::create_dir_all(own.join("extensions")).unwrap();
    std::fs::write(
        own.join("settings.json"),
        "{ // mine\n \"context\": { \"fileName\": [\"AGENTS.md\", \"GEMINI.md\"] } }",
    )
    .unwrap();
    std::fs::write(own.join("AGENTS.md"), "user rules").unwrap();
    std::fs::write(own.join("oauth_creds.json"), "{}").unwrap();
    let state = home.path().join("gemini/g1-b1");
    let (_, gonggong) = gonggong(&ask()).unwrap();
    let input = json!({
        "state": state, "userHome": user.path(), "systemPrompt": "bot rules",
        "provider": { "baseUrl": "https://g.test", "model": null }, "gonggong": gonggong,
    });
    let out = launch(AgentKind::Gemini, home.path(), input).await.unwrap();
    assert_eq!(out.env["GEMINI_CLI_HOME"], state.to_string_lossy());
    let ours = state.join(".gemini");
    let settings: Value = serde_json::from_str(&std::fs::read_to_string(ours.join("settings.json")).unwrap()).unwrap();
    assert_eq!(settings["security"]["auth"]["selectedType"], "gemini-api-key");
    assert_eq!(settings["mcpServers"]["gonggong"]["httpUrl"], "http://127.0.0.1:1/s");
    assert_eq!(settings["mcpServers"]["gonggong"]["headers"]["x-k"], "v");
    assert_eq!(settings["mcpServers"]["gonggong"]["timeout"], 90_000_000);
    assert_eq!(std::fs::read_to_string(ours.join("AGENTS.md")).unwrap(), "bot rules\n\nuser rules");
    assert!(!ours.join("GEMINI.md").exists(), "one memory file");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(ours.join("settings.json")).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        assert_eq!(std::fs::read_link(ours.join("oauth_creds.json")).unwrap(), own.join("oauth_creds.json"));
        assert!(ours.join("extensions").is_dir());
    }
    // The user's login file gone: so is the link; the official login keeps the user's own settings.
    std::fs::remove_file(own.join("oauth_creds.json")).unwrap();
    let input =
        json!({ "state": state, "userHome": user.path(), "systemPrompt": "", "provider": null, "gonggong": null });
    launch(AgentKind::Gemini, home.path(), input).await.unwrap();
    assert!(ours.join("oauth_creds.json").symlink_metadata().is_err());
    let settings: Value = serde_json::from_str(&std::fs::read_to_string(ours.join("settings.json")).unwrap()).unwrap();
    assert_eq!(settings["security"], Value::Null);
    assert_eq!(settings["mcpServers"], Value::Null);
}

#[cfg(unix)]
#[tokio::test]
async fn pi_gets_a_wrapper_that_runs_it_with_the_extension_and_the_adapters_arguments() {
    let home = tempfile::tempdir().unwrap();
    let data = home.path().join("pi");
    let input = json!({ "data": data, "node": "/bin/echo", "cli": "/x/pi", "cliScript": "cli.js", "bin": "pi" });
    let out = launch(AgentKind::Pi, home.path(), input).await.unwrap();
    let wrapper = data.join("pi-gonggong");
    assert_eq!(out.env["PI_ACP_PI_COMMAND"], wrapper.to_string_lossy());
    assert_eq!((out.env["GG_PI_EXE"].as_str(), out.env["GG_PI_SCRIPT"].as_str()), ("/bin/echo", "cli.js"));
    let extension = out.env["GG_PI_EXTENSION"].clone();
    assert!(Path::new(&extension).is_file());
    let run = std::process::Command::new(&wrapper).args(["--mode", "rpc"]).envs(&out.env).output().unwrap();
    assert_eq!(String::from_utf8_lossy(&run.stdout), format!("cli.js --approve -e {extension} --mode rpc\n"));
    // A native build runs as it is; without a CLI (a test's agent stands in) its name.
    let input = json!({ "data": data, "node": "/n", "cli": null, "cliScript": null, "bin": "pi" });
    let out = launch(AgentKind::Pi, home.path(), input).await.unwrap();
    assert_eq!(out.env["GG_PI_EXE"], "pi");
    assert!(!out.env.contains_key("GG_PI_SCRIPT"));
}

#[cfg(unix)]
#[tokio::test]
async fn kimi_and_goose_get_a_home_of_links_with_the_instructions_before_the_users() {
    let (home, user) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    for (kind, own, memory, env, config) in [
        (AgentKind::Kimi, ".kimi-code", "AGENTS.md", "KIMI_CODE_HOME", "home"),
        (AgentKind::Goose, ".config/goose", ".goosehints", "GOOSE_PATH_ROOT", "config"),
    ] {
        let own = user.path().join(own);
        std::fs::create_dir_all(own.join("sessions")).unwrap();
        std::fs::write(own.join("config.yaml"), "x").unwrap();
        std::fs::write(own.join(memory), "user rules").unwrap();
        let state = home.path().join(format!("{kind:?}/g1-b1"));
        let input = json!({ "state": state, "home": own, "systemPrompt": "bot rules" });
        let out = launch(kind, home.path(), input.clone()).await.unwrap();
        let ours = state.join(config);
        let root = if kind == AgentKind::Kimi { &ours } else { &state };
        assert_eq!(out.env[env], root.to_string_lossy());
        assert_eq!(std::fs::read_to_string(ours.join(memory)).unwrap(), "bot rules\n\nuser rules");
        assert_eq!(std::fs::read_link(ours.join("config.yaml")).unwrap(), own.join("config.yaml"));
        assert_eq!(std::fs::read_link(ours.join("sessions")).unwrap(), own.join("sessions"));
        // The user's file gone: so is the link; the bot's instructions alone.
        std::fs::remove_file(own.join("config.yaml")).unwrap();
        std::fs::remove_file(own.join(memory)).unwrap();
        launch(kind, home.path(), input).await.unwrap();
        assert!(ours.join("config.yaml").symlink_metadata().is_err());
        assert_eq!(std::fs::read_to_string(ours.join(memory)).unwrap(), "bot rules");
    }
}

#[tokio::test]
async fn opencode_and_copilot_get_the_instructions_as_a_file_they_are_pointed_to() {
    let home = tempfile::tempdir().unwrap();
    let state = home.path().join("opencode/g1-b1");
    let out =
        launch(AgentKind::Opencode, home.path(), json!({ "state": state, "systemPrompt": "bot rules" })).await.unwrap();
    let config: Value = serde_json::from_str(&out.env["OPENCODE_CONFIG_CONTENT"]).unwrap();
    let file = config["instructions"][0].as_str().unwrap();
    assert_eq!(std::fs::read_to_string(file).unwrap(), "bot rules");
    let state = home.path().join("copilot/g1-b1");
    let out =
        launch(AgentKind::Copilot, home.path(), json!({ "state": state, "systemPrompt": "bot rules" })).await.unwrap();
    let dir = Path::new(&out.env["COPILOT_CUSTOM_INSTRUCTIONS_DIRS"]).to_path_buf();
    assert_eq!(std::fs::read_to_string(dir.join("AGENTS.md")).unwrap(), "bot rules");
}

#[tokio::test]
async fn deepseek_gets_its_persona_patch() {
    let home = tempfile::tempdir().unwrap();
    let state = home.path().join("deepseek/g1-b1");
    let out =
        launch(AgentKind::Deepseek, home.path(), json!({ "state": state, "systemPrompt": "bot rules" })).await.unwrap();
    let file = state.join("system-prompt.yml");
    assert_eq!(out.args, ["--patch".to_string(), file.to_string_lossy().into_owned()]);
    let patch: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
    assert_eq!(
        patch[0]["config"]["personaPrefix"],
        "You are a coding agent powered by the {{model}} model.\n\nbot rules"
    );
}
