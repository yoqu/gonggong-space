//! Native ACP interactive login runner (`initialize` -> `auth_methods` -> `authenticate`) and structured ACP auth
//! error classification. Shared by both the daemon WebSocket handler (`s2d: agent.login`) and the Desktop Tauri app.
use crate::protocol::{
    AgentAuthMethod, AgentKind, AgentLoginAuth, AgentLoginMethods, AgentLoginProgress, AgentLoginResult,
    DaemonToServer, RunErrorKind,
};
use crate::t;
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{AuthenticateRequest, ErrorCode, InitializeRequest, Meta};
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Client, ConnectionTo, Handled, UntypedMessage};
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Notify;

/// Maximum time an interactive browser OAuth flow may stay pending before timing out (matches CodeBuddy's 5-min poll).
pub const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub type EmitFn = Arc<dyn Fn(DaemonToServer) + Send + Sync>;
pub type OnSuccessFn = Box<dyn FnOnce() -> Pin<Box<dyn Future<Output = ()> + Send>> + Send>;

pub fn new_op_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[derive(Clone, Default)]
pub struct AgentLoginManager {
    active: Arc<Mutex<HashMap<String, Arc<Notify>>>>,
}

impl AgentLoginManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Cancels an in-flight login operation by `op_id`. Returns `true` if a running operation was found.
    pub fn cancel(&self, op_id: &str) -> bool {
        if let Some(notify) = self.active.lock().unwrap().get(op_id).cloned() {
            notify.notify_one();
            true
        } else {
            false
        }
    }

    pub fn is_active(&self, op_id: &str) -> bool {
        self.active.lock().unwrap().contains_key(op_id)
    }

    /// Spawns an ACP `initialize` + `authenticate` login flow, streaming `agent.login.*` messages through `emit`.
    #[allow(clippy::too_many_arguments)]
    pub fn start<F>(
        &self,
        home: PathBuf,
        op_id: String,
        kind: AgentKind,
        method_id: Option<String>,
        open_browser: bool,
        config_fut: F,
        emit: EmitFn,
        on_success: Option<OnSuccessFn>,
    ) where
        F: Future<Output = anyhow::Result<AcpAgentConfig>> + Send + 'static,
    {
        self.start_with_timeout(home, op_id, kind, method_id, open_browser, LOGIN_TIMEOUT, config_fut, emit, on_success);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn start_with_timeout<F>(
        &self,
        home: PathBuf,
        op_id: String,
        kind: AgentKind,
        method_id: Option<String>,
        open_browser: bool,
        timeout: Duration,
        config_fut: F,
        emit: EmitFn,
        on_success: Option<OnSuccessFn>,
    ) where
        F: Future<Output = anyhow::Result<AcpAgentConfig>> + Send + 'static,
    {
        let cancel = Arc::new(Notify::new());
        if let Some(prev) = self.active.lock().unwrap().insert(op_id.clone(), cancel.clone()) {
            prev.notify_one();
        }
        let active = self.active.clone();
        tokio::spawn(async move {
            emit(DaemonToServer::AgentLoginProgress(AgentLoginProgress {
                op_id: op_id.clone(),
                kind,
                stage: "starting".into(),
                line: None,
            }));
            let outcome = tokio::select! {
                res = run_acp_login(&home, &op_id, kind, method_id, open_browser, config_fut, &emit) => res,
                _ = cancel.notified() => Err(t!("已取消登录").to_string()),
                _ = tokio::time::sleep(timeout) => Err(t!("登录已超时，请重试").to_string()),
            };
            {
                let mut map = active.lock().unwrap();
                if map.get(&op_id).is_some_and(|n| Arc::ptr_eq(n, &cancel)) {
                    map.remove(&op_id);
                }
            }
            match outcome {
                Ok(user) => {
                    if let Some(cb) = on_success {
                        cb().await;
                    }
                    emit(DaemonToServer::AgentLoginResult(AgentLoginResult {
                        op_id,
                        kind,
                        ok: true,
                        error: None,
                        user,
                    }));
                }
                Err(error) => {
                    emit(DaemonToServer::AgentLoginResult(AgentLoginResult {
                        op_id,
                        kind,
                        ok: false,
                        error: Some(error),
                        user: None,
                    }));
                }
            }
        });
    }
}

async fn run_acp_login<F>(
    home: &Path,
    op_id: &str,
    kind: AgentKind,
    requested_method: Option<String>,
    open_browser: bool,
    config_fut: F,
    emit: &EmitFn,
) -> Result<Option<String>, String>
where
    F: Future<Output = anyhow::Result<AcpAgentConfig>> + Send,
{
    let mut config = config_fut.await.map_err(|e| format!("{e:#}"))?;
    if !open_browser
        && let Some(noop) = noop_browser_cmd(home)
    {
        config = config.env("BROWSER", noop);
    }
    let expected_notif = crate::adapters::get(kind)
        .and_then(|a| a.spec.login.acp_auth_url_notification.clone());
    let chosen_shared: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(requested_method.clone()));
    let emit_notif = emit.clone();
    let op_notif = op_id.to_string();
    let chosen_notif = chosen_shared.clone();
    let op_run = op_id.to_string();
    let emit_run = emit.clone();

    Client
        .builder()
        .on_receive_notification(
            async move |n: UntypedMessage, cx: ConnectionTo<Agent>| {
                let matched = expected_notif.as_deref().is_some_and(|m| m == n.method)
                    || (expected_notif.is_none() && n.method.ends_with("/authUrl"));
                if !matched {
                    return Ok(Handled::No { message: (n, cx), retry: false });
                }
                if let Some(url) = extract_auth_url(&n.params) {
                    let method_id = chosen_notif.lock().unwrap().clone();
                    emit_notif(DaemonToServer::AgentLoginAuth(AgentLoginAuth {
                        op_id: op_notif.clone(),
                        kind,
                        url,
                        method_id,
                    }));
                    emit_notif(DaemonToServer::AgentLoginProgress(AgentLoginProgress {
                        op_id: op_notif.clone(),
                        kind,
                        stage: "awaiting_auth".into(),
                        line: None,
                    }));
                }
                Ok(Handled::Yes)
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .connect_with(AcpAgent::new(config), async move |cx: ConnectionTo<Agent>| {
            let init = cx.send_request(InitializeRequest::new(ProtocolVersion::V1)).block_task().await?;
            let methods: Vec<AgentAuthMethod> = init
                .auth_methods
                .iter()
                .map(|m| AgentAuthMethod {
                    id: m.id().0.to_string(),
                    name: m.name().to_string(),
                    description: m.description().map(String::from),
                })
                .collect();
            emit_run(DaemonToServer::AgentLoginMethods(AgentLoginMethods {
                op_id: op_run.clone(),
                kind,
                methods: methods.clone(),
            }));
            let Some(chosen) = choose_method(kind, requested_method.as_deref(), &methods) else {
                return Err(agent_client_protocol::Error::invalid_params()
                    .data(t!("该 Agent 不支持通过 ACP 登录").to_string()));
            };
            *chosen_shared.lock().unwrap() = Some(chosen.clone());
            emit_run(DaemonToServer::AgentLoginProgress(AgentLoginProgress {
                op_id: op_run.clone(),
                kind,
                stage: "authenticating".into(),
                line: None,
            }));
            let res = cx.send_request(AuthenticateRequest::new(chosen)).block_task().await?;
            Ok(extract_user(res.meta.as_ref()))
        })
        .await
        .map_err(|e| describe_acp_error(&e))
}

fn describe_acp_error(e: &agent_client_protocol::Error) -> String {
    let detail = e.data.as_ref().map(|d| d.get("data").unwrap_or(d));
    match detail {
        Some(serde_json::Value::String(d)) if !d.is_empty() => d.clone(),
        Some(d) => format!("{}: {d}", e.message),
        None => e.message.clone(),
    }
}

/// Harmless no-op executable for `BROWSER` so the CLI does not pop a browser tab on the daemon host when driven
/// remotely (`open_browser == false`) or when Desktop opens the URL itself.
fn noop_browser_cmd(home: &Path) -> Option<String> {
    #[cfg(unix)]
    {
        let _ = home;
        if Path::new("/usr/bin/true").is_file() {
            Some("/usr/bin/true".into())
        } else {
            Some("true".into())
        }
    }
    #[cfg(windows)]
    {
        let run_dir = home.join("run");
        if std::fs::create_dir_all(&run_dir).is_ok() {
            let script = run_dir.join("noop-browser.cmd");
            if !script.is_file() {
                let _ = std::fs::write(&script, "@exit /b 0\r\n");
            }
            if script.is_file() {
                return Some(script.to_string_lossy().into_owned());
            }
        }
        Some("NUL".into())
    }
}

pub fn choose_method(kind: AgentKind, requested: Option<&str>, methods: &[AgentAuthMethod]) -> Option<String> {
    if let Some(id) = requested.map(str::trim).filter(|s| !s.is_empty()) {
        return Some(id.to_string());
    }
    if methods.len() == 1 {
        return Some(methods[0].id.clone());
    }
    if kind == AgentKind::Codebuddy && methods.iter().any(|m| m.id == "internal") {
        return Some("internal".into());
    }
    methods.first().map(|m| m.id.clone())
}

/// Validates an external OAuth/browser URL: only `http://` or `https://` with a non-empty host and no control
/// characters, whitespace, or quotes.
pub fn validate_http_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.chars().any(|c| c.is_control() || c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>'))
    {
        return None;
    }
    let parsed = reqwest::Url::parse(trimmed).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none_or(str::is_empty) {
        return None;
    }
    Some(trimmed.to_string())
}

pub fn extract_auth_url(params: &serde_json::Value) -> Option<String> {
    let url = params.get("authUrl").or_else(|| params.get("url")).and_then(|v| v.as_str())?;
    validate_http_url(url)
}

pub fn extract_user(meta: Option<&Meta>) -> Option<String> {
    let info = meta?.get("codebuddy.ai/userinfo")?;
    for key in ["userNickname", "userName", "nickname", "name", "userId"] {
        if let Some(s) = info.get(key).and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()) {
            return Some(s.to_string());
        }
    }
    None
}

/// True when an ACP JSON-RPC error indicates the agent is unauthenticated or its session expired.
pub fn is_auth_error(e: &agent_client_protocol::Error) -> bool {
    e.code == ErrorCode::AuthRequired
        || e.data.as_ref().is_some_and(|d| {
            d.get("category").and_then(|v| v.as_str()) == Some("auth")
                || d.get("data").and_then(|v| v.get("category")).and_then(|v| v.as_str()) == Some("auth")
        })
}

pub fn auth_error_message(kind: AgentKind) -> String {
    t!(
        "{agent} 尚未登录或登录已过期，请先登录官方账号或在供应商中配置 API Key",
        agent = crate::bots::agent_label(kind)
    )
}

pub(crate) fn session_open_error(
    kind: AgentKind,
    e: &agent_client_protocol::Error,
    described: &str,
) -> (String, Option<RunErrorKind>) {
    if is_auth_error(e) {
        (auth_error_message(kind), Some(RunErrorKind::Auth))
    } else {
        (t!("无法建立 agent 会话：{e}", e = described), None)
    }
}

pub(crate) fn prompt_error(
    kind: AgentKind,
    e: &agent_client_protocol::Error,
    described: &str,
) -> (String, Option<RunErrorKind>) {
    if is_auth_error(e) {
        (auth_error_message(kind), Some(RunErrorKind::Auth))
    } else {
        (described.to_string(), None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn chooses_method_explicit_else_codebuddy_internal_else_first() {
        let methods = vec![
            AgentAuthMethod { id: "external".into(), name: "Google/Github".into(), description: None },
            AgentAuthMethod { id: "internal".into(), name: "WeChat".into(), description: None },
        ];
        assert_eq!(choose_method(AgentKind::Codebuddy, Some("external"), &methods).as_deref(), Some("external"));
        assert_eq!(choose_method(AgentKind::Codebuddy, None, &methods).as_deref(), Some("internal"));
        assert_eq!(choose_method(AgentKind::Gemini, None, &methods).as_deref(), Some("external"));
        assert_eq!(choose_method(AgentKind::Codebuddy, None, &[]), None);
    }

    #[test]
    fn extracts_auth_url_and_userinfo() {
        assert_eq!(
            extract_auth_url(&json!({ "authUrl": "https://copilot.tencent.com/oauth?s=1" })).as_deref(),
            Some("https://copilot.tencent.com/oauth?s=1")
        );
        assert_eq!(extract_auth_url(&json!({ "url": "http://127.0.0.1:9/auth" })).as_deref(), Some("http://127.0.0.1:9/auth"));
        assert_eq!(extract_auth_url(&json!({ "authUrl": "javascript:alert(1)" })), None);
        assert_eq!(extract_auth_url(&json!({ "authUrl": "file:///etc/passwd" })), None);
        assert_eq!(extract_auth_url(&json!({ "authUrl": "https://" })), None);
        assert_eq!(extract_auth_url(&json!({ "authUrl": "https://example.com/a b" })), None);
        assert_eq!(extract_auth_url(&json!({ "authUrl": "https://example.com/a\nb" })), None);
        assert_eq!(extract_auth_url(&json!({ "authUrl": "https://example.com/\"&calc" })), None);

        let mut meta = Meta::new();
        meta.insert("codebuddy.ai/userinfo".into(), json!({ "userName": "alice", "userNickname": "Alice" }));
        assert_eq!(extract_user(Some(&meta)).as_deref(), Some("Alice"));
        let mut meta2 = Meta::new();
        meta2.insert("codebuddy.ai/userinfo".into(), json!({ "userName": "bob" }));
        assert_eq!(extract_user(Some(&meta2)).as_deref(), Some("bob"));
    }

    #[test]
    fn detects_acp_auth_errors_by_code_or_category() {
        let by_code = agent_client_protocol::Error::auth_required();
        assert!(is_auth_error(&by_code));
        let (msg, kind) = session_open_error(AgentKind::Codebuddy, &by_code, "Authentication required");
        assert_eq!(kind, Some(RunErrorKind::Auth));
        assert!(msg.contains("尚未登录或登录已过期"), "{msg}");

        let by_data = agent_client_protocol::Error::internal_error().data(json!({ "category": "auth" }));
        assert!(is_auth_error(&by_data));
        let (msg2, kind2) = prompt_error(AgentKind::Codebuddy, &by_data, "Internal error");
        assert_eq!(kind2, Some(RunErrorKind::Auth));
        assert!(msg2.contains("尚未登录或登录已过期"), "{msg2}");

        let other = agent_client_protocol::Error::internal_error().data(json!({ "category": "network" }));
        assert!(!is_auth_error(&other));
        assert_eq!(session_open_error(AgentKind::Codebuddy, &other, "boom").1, None);
    }
}
