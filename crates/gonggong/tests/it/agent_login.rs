use gonggong::engine::{Engine, EngineConfig};
use gonggong::protocol::{
    AgentKind, AgentLoginCmd, AgentLoginOp, Approval, DaemonToServer, FEATURE_AGENT_LOGIN, RunBot, RunErrorKind,
    RunOutcome, RunPrompt, RunStart, SecretEnv, ServerToDaemon, Tier, WorkspaceSpec,
};
use gonggong::service::{Handler, Outbox, OutboxRx};
use std::path::{Path, PathBuf};
use std::time::Duration;

fn write_mock_acp_agent(dir: &Path, body: &str) -> String {
    let script = dir.join("mock-acp-login.mjs");
    std::fs::write(&script, body).unwrap();
    format!("node {}", script.display())
}

fn test_engine(home: &Path, adapter_cmd: String) -> Engine {
    Engine::new(EngineConfig {
        home: home.to_path_buf(),
        user_home: home.to_path_buf(),
        adapter_cmd: Some(adapter_cmd),
        idle: Duration::from_secs(30),
        reap: Duration::from_secs(30),
        cancel_grace: Duration::from_secs(2),
        continuation: Default::default(),
        api: None,
    })
}

async fn recv_within(rx: &mut OutboxRx) -> DaemonToServer {
    tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("timed out waiting for daemon message")
        .expect("outbox closed")
}

fn mock_login_agent_script(hang_auth: bool) -> String {
    let auth_body = if hang_auth {
        r#"
            send({ jsonrpc: '2.0', method: '_codebuddy.ai/authUrl', params: { authUrl: 'https://copilot.tencent.com/oauth?state=hang' } });
            // Stay pending until killed on cancel.
        "#
    } else {
        r#"
            const browserSet = Boolean(process.env.BROWSER && process.env.BROWSER.length > 0);
            send({ jsonrpc: '2.0', method: '_codebuddy.ai/authUrl', params: { authUrl: `https://copilot.tencent.com/oauth?method=${msg.params.methodId}&noop=${browserSet}` } });
            setTimeout(() => {
                send({ jsonrpc: '2.0', id: msg.id, result: { _meta: { 'codebuddy.ai/userinfo': { userNickname: 'Alice', userName: 'alice' } } } });
            }, 30);
        "#
    };
    format!(
        r#"
import readline from 'node:readline';
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const rl = readline.createInterface({{ input: process.stdin }});
rl.on('line', (line) => {{
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {{
        send({{
            jsonrpc: '2.0',
            id: msg.id,
            result: {{
                protocolVersion: 1,
                agentCapabilities: {{}},
                authMethods: [
                    {{ id: 'internal', name: 'Login with WeChat', description: '中国站微信扫码登录' }},
                    {{ id: 'external', name: 'Login with Google/Github' }}
                ]
            }}
        }});
    }} else if (msg.method === 'authenticate') {{
        {auth_body}
    }}
}});
"#
    )
}

#[tokio::test]
async fn advertises_agent_login_feature_and_runs_acp_auth_flow() {
    let dir = tempfile::tempdir().unwrap();
    let engine = test_engine(dir.path(), write_mock_acp_agent(dir.path(), &mock_login_agent_script(false)));
    assert!(engine.features().iter().any(|f| f == FEATURE_AGENT_LOGIN));

    let (out, mut rx) = Outbox::channel();
    engine.handle(
        ServerToDaemon::AgentLogin(AgentLoginCmd {
            op: AgentLoginOp::Start,
            op_id: "op-login-1".into(),
            kind: AgentKind::Codebuddy,
            method_id: None,
            open_browser: Some(false),
        }),
        &out,
    );

    let mut saw_methods = false;
    let mut saw_auth_url = None;
    let mut result = None;
    while result.is_none() {
        match recv_within(&mut rx).await {
            DaemonToServer::AgentLoginMethods(m) => {
                assert_eq!(m.op_id, "op-login-1");
                assert_eq!(m.kind, AgentKind::Codebuddy);
                assert_eq!(m.methods.len(), 2);
                assert_eq!(m.methods[0].id, "internal");
                assert_eq!(m.methods[0].description.as_deref(), Some("中国站微信扫码登录"));
                saw_methods = true;
            }
            DaemonToServer::AgentLoginAuth(a) => {
                assert_eq!(a.op_id, "op-login-1");
                assert_eq!(a.method_id.as_deref(), Some("internal"), "CodeBuddy defaults to internal");
                saw_auth_url = Some(a.url);
            }
            DaemonToServer::AgentLoginProgress(_) => {}
            DaemonToServer::AgentLoginResult(r) => result = Some(r),
            other => panic!("unexpected message: {other:?}"),
        }
    }
    assert!(saw_methods);
    let url = saw_auth_url.expect("expected authUrl notification");
    assert!(url.contains("method=internal"), "{url}");
    assert!(url.contains("noop=true"), "openBrowser=false must set BROWSER no-op: {url}");
    let res = result.unwrap();
    assert!(res.ok, "{res:?}");
    assert_eq!(res.user.as_deref(), Some("Alice"));
    assert_eq!(res.error, None);
}

#[tokio::test]
async fn cancels_in_flight_acp_login_cleanly() {
    let dir = tempfile::tempdir().unwrap();
    let engine = test_engine(dir.path(), write_mock_acp_agent(dir.path(), &mock_login_agent_script(true)));
    let (out, mut rx) = Outbox::channel();
    engine.handle(
        ServerToDaemon::AgentLogin(AgentLoginCmd {
            op: AgentLoginOp::Start,
            op_id: "op-cancel-1".into(),
            kind: AgentKind::Codebuddy,
            method_id: Some("external".into()),
            open_browser: Some(false),
        }),
        &out,
    );

    // Wait until authUrl arrives so we know the child process is live in authenticate().
    loop {
        match recv_within(&mut rx).await {
            DaemonToServer::AgentLoginAuth(a) => {
                assert_eq!(a.method_id.as_deref(), Some("external"));
                break;
            }
            DaemonToServer::AgentLoginMethods(_) | DaemonToServer::AgentLoginProgress(_) => {}
            other => panic!("unexpected before cancel: {other:?}"),
        }
    }
    engine.handle(
        ServerToDaemon::AgentLogin(AgentLoginCmd {
            op: AgentLoginOp::Cancel,
            op_id: "op-cancel-1".into(),
            kind: AgentKind::Codebuddy,
            method_id: None,
            open_browser: None,
        }),
        &out,
    );
    loop {
        match recv_within(&mut rx).await {
            DaemonToServer::AgentLoginResult(r) => {
                assert_eq!(r.op_id, "op-cancel-1");
                assert!(!r.ok);
                assert_eq!(r.error.as_deref(), Some("已取消登录"));
                break;
            }
            DaemonToServer::AgentLoginProgress(_) => {}
            other => panic!("unexpected after cancel: {other:?}"),
        }
    }
}

fn run_start(run_id: &str, cwd: PathBuf) -> RunStart {
    RunStart {
        run_id: run_id.into(),
        group_id: "g1".into(),
        group_name: "Group".into(),
        thread_root_id: None,
        bot: RunBot {
            id: "b1".into(),
            name: "CB".into(),
            agent_kind: AgentKind::Codebuddy,
            system_prompt: String::new(),
            tier: Tier::Full,
            model: None,
            effort: None,
            approval: Approval::Ask,
            allowlist: vec![],
            always_allow: vec![],
            ai_review: false,
            git: None,
            agent_settings: Default::default(),
        },
        workspace: WorkspaceSpec {
            repo: None,
            cd_path: Some(cwd.to_string_lossy().into()),
            protect_base: false,
            extra_dirs: vec![],
            extra_repos: vec![],
        },
        resume_session_id: None,
        new_session_reason: Some("first".into()),
        prompt: RunPrompt {
            text: "hi".into(),
            triggered_by: "alice".into(),
            context: vec![],
            omitted: 0,
            fallback_context: vec![],
            attachments: vec![],
            quote: None,
        },
        mcp_servers: vec![],
        skills: vec![],
        plugins: vec![],
        cli_profiles: vec![],
        hidden_tools: vec![],
        command: None,
        sync: None,
        artifacts: vec![],
        artifact_exclude: vec![],
        env: SecretEnv::default(),
    }
}

#[tokio::test]
async fn auth_required_on_session_new_sets_error_kind_auth_and_friendly_message() {
    let dir = tempfile::tempdir().unwrap();
    let ws = dir.path().join("ws");
    std::fs::create_dir_all(&ws).unwrap();
    let script = r#"
import readline from 'node:readline';
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
        send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: {} } });
    } else if (msg.method === 'session/new') {
        send({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32000, message: 'Authentication required', data: { category: 'auth' } }
        });
    }
});
"#;
    let engine = test_engine(dir.path(), write_mock_acp_agent(dir.path(), script));
    let (out, mut rx) = Outbox::channel();
    engine.handle(ServerToDaemon::RunStart(Box::new(run_start("run-auth-1", ws))), &out);
    loop {
        if let DaemonToServer::RunDone(done) = recv_within(&mut rx).await {
            assert_eq!(done.run_id, "run-auth-1");
            assert_eq!(done.outcome, RunOutcome::Failed);
            assert_eq!(done.error_kind, Some(RunErrorKind::Auth));
            let err = done.error.unwrap();
            assert!(err.contains("尚未登录或登录已过期"), "expected friendly auth error, got: {err}");
            assert!(!err.contains("{\"category\":\"auth\"}"), "must not leak raw JSON: {err}");
            break;
        }
    }
}
