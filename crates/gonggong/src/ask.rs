//! Built-in `gonggong` MCP server: a minimal MCP server (Streamable HTTP, JSON responses only) on loopback. Every session
//! gets its own secret URL. 「向群成员提问」 (spec §8.8) is answered here and blocks until the group answers or it
//! times out; the chat-history tools (`gonggong-tools.json`) are forwarded to the server for the session's live run.
use crate::attachments;
use crate::config::Config;
use crate::hosted::{Scope, Services, StartArgs};
use crate::protocol::{Answer, Attachment, Question, QuestionType, ToolCallRes};
use crate::tls;
use agent_client_protocol::schema::v1::{McpServer, McpServerHttp};
use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, Weak};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

pub const SERVER_NAME: &str = "gonggong";
pub const TOOL: &str = "ask_group_members";
pub const NO_ANSWER: &str = "无人回答，请按推荐项或最佳判断继续，并在最终回复里列出你做的假设";
const MAX_QUESTIONS: usize = 4;
const MAX_OPTIONS: usize = 10;
const PROTOCOL_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const YES_NO: [&str; 2] = ["是", "否"];
/// Tools answered by the server, generated from `packages/protocol/src/tools.ts`.
const SERVER_TOOLS: &str = include_str!("../../../packages/protocol/gonggong-tools.json");
/// Hosted-service tools answered here (`hosted.rs`), generated from the same file.
const DAEMON_TOOLS: &str = include_str!("../../../packages/protocol/gonggong-daemon-tools.json");
/// Runs an arbitrary command, so it goes through the bot's approval like the agent's own shell (plan P10).
const NEEDS_APPROVAL: &str = "service_start";
const NOT_RUNNING: &str = "当前不在运行中，无法查询";

/// The conversation behind a session's URL: relays questions to the group and scopes the server tools to its run.
pub trait Asker: Send + Sync {
    /// Resolves with the tool's text result; a dropped sender means the question was withdrawn (stop / append).
    fn ask(&self, questions: Vec<Question>) -> Result<oneshot::Receiver<String>, String>;
    /// The run in progress and its workspace.
    fn active_run(&self) -> Option<(String, PathBuf)>;
    /// The run in progress as hosted services see it.
    fn scope(&self) -> Option<Scope>;
}

fn server_tools() -> Vec<Value> {
    serde_json::from_str(SERVER_TOOLS).expect("gonggong-tools.json is a JSON array")
}

fn daemon_tools() -> Vec<Value> {
    serde_json::from_str(DAEMON_TOOLS).expect("gonggong-daemon-tools.json is a JSON array")
}

fn is_server_tool(name: &str) -> bool {
    server_tools().iter().any(|t| t["name"] == name)
}

fn is_daemon_tool(name: &str) -> bool {
    daemon_tools().iter().any(|t| t["name"] == name)
}

/// Whether a permission request is for one of these tools that needs no owner call: all of them read the group, ask
/// it or manage what `service_start` (which does need one) already started.
pub fn is_builtin(title: &str) -> bool {
    title.contains(TOOL)
        || title.contains(SERVER_NAME)
            && !title.contains(NEEDS_APPROVAL)
            && [server_tools(), daemon_tools()]
                .concat()
                .iter()
                .filter_map(|t| t["name"].as_str())
                .any(|n| title.contains(n))
}

type Routes = Arc<Mutex<HashMap<String, Weak<dyn Asker>>>>;

#[derive(Clone)]
pub struct AskServer {
    base: String,
    routes: Routes,
}

#[derive(Clone)]
struct Backends {
    /// Where the server tools are forwarded; `None` (tests) answers them with an error.
    api: Arc<Option<Config>>,
    services: Services,
}

impl AskServer {
    /// `api`: where the server tools are forwarded; `None` (tests) answers them with an error.
    pub async fn start(api: Option<Config>, services: Services) -> std::io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let base = format!("http://{}/mcp/", listener.local_addr()?);
        let routes = Routes::default();
        tokio::spawn(accept(listener, routes.clone(), Backends { api: Arc::new(api), services }));
        Ok(AskServer { base, routes })
    }

    /// Registers an asker under a fresh secret path; returns the MCP server entry for `session/new`.
    pub fn register(&self, asker: Weak<dyn Asker>) -> McpServer {
        let secret = uuid::Uuid::new_v4().simple().to_string();
        self.routes.lock().unwrap().insert(secret.clone(), asker);
        McpServer::Http(McpServerHttp::new(SERVER_NAME, format!("{}{secret}", self.base)))
    }
}

async fn accept(listener: TcpListener, routes: Routes, backends: Backends) {
    loop {
        let stream = match listener.accept().await {
            Ok((stream, _)) => stream,
            Err(e) => {
                tracing::warn!("ask server accept failed: {e}");
                continue;
            }
        };
        let (routes, backends) = (routes.clone(), backends.clone());
        tokio::spawn(async move {
            let service = service_fn(move |req| handle(routes.clone(), backends.clone(), req));
            if let Err(e) = http1::Builder::new().serve_connection(TokioIo::new(stream), service).await {
                tracing::debug!("ask server connection: {e}");
            }
        });
    }
}

fn reply(status: StatusCode, body: Option<Value>) -> Result<Response<Full<Bytes>>, Infallible> {
    let bytes = body.map(|b| Bytes::from(b.to_string())).unwrap_or_default();
    let mut res = Response::new(Full::new(bytes));
    *res.status_mut() = status;
    if status == StatusCode::OK {
        res.headers_mut().insert("content-type", "application/json".parse().unwrap());
    }
    Ok(res)
}

async fn handle(
    routes: Routes,
    backends: Backends,
    req: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let asker = req
        .uri()
        .path()
        .strip_prefix("/mcp/")
        .and_then(|secret| routes.lock().unwrap().get(secret).and_then(Weak::upgrade));
    let Some(asker) = asker else { return reply(StatusCode::NOT_FOUND, None) };
    // No server-initiated stream (GET) and no sessions to end (DELETE).
    if req.method() != Method::POST {
        return reply(StatusCode::METHOD_NOT_ALLOWED, None);
    }
    let Ok(body) = req.into_body().collect().await else { return reply(StatusCode::BAD_REQUEST, None) };
    let Ok(msg) = serde_json::from_slice::<Value>(&body.to_bytes()) else {
        return reply(StatusCode::BAD_REQUEST, Some(error(Value::Null, -32700, "parse error")));
    };
    // Notifications and responses need no answer.
    let Some(id) = msg.get("id").cloned().filter(|_| msg.get("method").is_some()) else {
        return reply(StatusCode::ACCEPTED, None);
    };
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    let body = match msg["method"].as_str().unwrap_or_default() {
        "initialize" => {
            let asked = params["protocolVersion"].as_str().unwrap_or_default();
            let version = PROTOCOL_VERSIONS.iter().find(|v| **v == asked).unwrap_or(&PROTOCOL_VERSIONS[1]);
            result(
                id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") },
                }),
            )
        }
        "ping" => result(id, json!({})),
        "tools/list" => {
            let tools: Vec<Value> = [vec![tool()], server_tools(), daemon_tools()].concat();
            result(id, json!({ "tools": tools }))
        }
        "tools/call" => {
            let (name, args) = (params["name"].as_str().unwrap_or_default(), &params["arguments"]);
            let out = if name == TOOL {
                Some(call(asker.as_ref(), args).await)
            } else if is_server_tool(name) {
                Some(forward(backends.api.as_ref().as_ref(), asker.as_ref(), name, args).await)
            } else if is_daemon_tool(name) {
                Some(hosted(&backends, asker.as_ref(), name, args).await)
            } else {
                None
            };
            match out {
                Some(Ok(text)) => result(id, tool_result(&text, false)),
                Some(Err(e)) => result(id, tool_result(&e, true)),
                None => error(id, -32602, "unknown tool"),
            }
        }
        _ => error(id, -32601, "method not found"),
    };
    reply(StatusCode::OK, Some(body))
}

fn result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn tool_result(text: &str, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
}

fn tool() -> Value {
    json!({
        "name": TOOL,
        "title": "向群成员提问",
        // Claude Code otherwise defers MCP tools behind ToolSearch and the agent never sees this description.
        "_meta": { "anthropic/alwaysLoad": true },
        "description": "向群成员提问：需要触发人拍板的问题（方案取舍、范围、缺失信息）用它问，不要猜。\
            一次最多 4 个问题；题型 single（单选）、multi（多选）、yesno（是/否）、text（自由文本）。\
            选择题可用 recommended（选项下标，从 0 开始）标出一个推荐项；群成员总能选「其他，我来补充」。\
            调用会一直等到有人回答或超时；超时则按推荐项或最佳判断继续，并在最终回复里列出你做的假设。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "questions": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_QUESTIONS,
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": { "type": "string", "enum": ["single", "multi", "yesno", "text"] },
                            "title": { "type": "string" },
                            "options": { "type": "array", "items": { "type": "string" }, "maxItems": MAX_OPTIONS },
                            "recommended": { "type": "integer", "minimum": 0 },
                        },
                        "required": ["type", "title"],
                    },
                },
            },
            "required": ["questions"],
        },
    })
}

#[derive(Deserialize)]
struct Input {
    questions: Vec<InputQuestion>,
}

#[derive(Deserialize)]
struct InputQuestion {
    #[serde(rename = "type")]
    kind: QuestionType,
    title: String,
    #[serde(default)]
    options: Vec<String>,
    recommended: Option<u32>,
}

async fn call(asker: &dyn Asker, args: &Value) -> Result<String, String> {
    let questions = parse(args)?;
    let rx = asker.ask(questions)?;
    rx.await.map_err(|_| "提问已作废（运行被停止或被打断），请不要再等待回答。".to_string())
}

/// Asks the server on behalf of the live run; attachments it names are written into the run's workspace.
async fn forward(api: Option<&Config>, asker: &dyn Asker, name: &str, args: &Value) -> Result<String, String> {
    let api = api.ok_or("未连接服务器，无法查询")?;
    let (run_id, cwd) = asker.active_run().ok_or(NOT_RUNNING)?;
    let url = format!("{}/api/daemon/runs/{run_id}/tools/{name}", api.server.trim_end_matches('/'));
    let send = async {
        let res = tls::client(api)?
            .post(url)
            .bearer_auth(&api.token)
            .json(&json!({ "arguments": args }))
            .send()
            .await?
            .error_for_status()?;
        anyhow::Ok(res.json::<ToolCallRes>().await?)
    };
    let res = send.await.map_err(|e| format!("查询失败：{e:#}"))?;
    if res.is_error {
        return Err(res.text);
    }
    if res.attachments.is_empty() {
        return Ok(res.text);
    }
    attachments::fetch(api, &cwd, &res.attachments).await?;
    Ok(format!("{}\n{}", res.text, attachment_note(&res.attachments)).trim_end().into())
}

#[derive(Deserialize)]
struct NameArgs {
    name: String,
    tail: Option<usize>,
}

#[derive(Deserialize)]
struct StaticArgs {
    #[serde(default)]
    dir: String,
    title: String,
    path: Option<String>,
}

/// `static-<dir>` as a service name (lowercase ascii, dashes, at most 32).
fn static_name(dir: &str) -> String {
    let slug: String =
        dir.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let slug = slug.split('-').filter(|s| !s.is_empty()).collect::<Vec<_>>().join("-");
    let name = if slug.is_empty() { "static".to_string() } else { format!("static-{slug}") };
    name.chars().take(32).collect::<String>().trim_end_matches('-').into()
}

/// The hosted-service tools, scoped to the live run's (group, bot).
async fn hosted(backends: &Backends, asker: &dyn Asker, name: &str, args: &Value) -> Result<String, String> {
    let services = &backends.services;
    let scope = asker.scope().ok_or(NOT_RUNNING)?;
    let invalid = |e: serde_json::Error| format!("参数无效：{e}");
    if name == "preview_static" {
        let a = StaticArgs::deserialize(args).map_err(invalid)?;
        let port = services.start_static(scope, &static_name(&a.dir), &a.dir).await?;
        // By port: the server may not have recorded the new service yet.
        let mut expose = json!({ "port": port, "title": a.title });
        if let Some(path) = a.path {
            expose["path"] = json!(path);
        }
        return forward(backends.api.as_ref().as_ref(), asker, "preview_expose", &expose).await;
    }
    if name == "service_start" {
        return services.start(scope, StartArgs::deserialize(args).map_err(invalid)?).await;
    }
    let (group, bot) = (scope.group_id.as_str(), scope.bot_id.as_str());
    if name == "service_list" {
        return Ok(services.list(group, bot));
    }
    let a = NameArgs::deserialize(args).map_err(invalid)?;
    match name {
        "service_logs" => services.logs(group, bot, &a.name, a.tail),
        "service_stop" => services.stop(group, bot, &a.name).await,
        _ => Err(format!("未知工具 {name}")),
    }
}

/// Validates the tool input into wire questions (ids q1..q4; yes/no options are fixed).
pub fn parse(args: &Value) -> Result<Vec<Question>, String> {
    let input = Input::deserialize(args).map_err(|e| format!("参数无效：{e}"))?;
    if input.questions.is_empty() || input.questions.len() > MAX_QUESTIONS {
        return Err(format!("questions 需要 1 到 {MAX_QUESTIONS} 个问题"));
    }
    input
        .questions
        .into_iter()
        .enumerate()
        .map(|(i, q)| {
            let n = i + 1;
            if q.title.trim().is_empty() {
                return Err(format!("第 {n} 个问题缺少 title"));
            }
            let options = match q.kind {
                QuestionType::Yesno => YES_NO.map(String::from).to_vec(),
                QuestionType::Text => vec![],
                QuestionType::Single | QuestionType::Multi => {
                    if !(2..=MAX_OPTIONS).contains(&q.options.len()) {
                        return Err(format!("第 {n} 个问题是选择题，需要 2 到 {MAX_OPTIONS} 个 options"));
                    }
                    q.options
                }
            };
            let recommended = q.recommended.filter(|r| (*r as usize) < options.len());
            Ok(Question { id: format!("q{n}"), kind: q.kind, title: q.title, options, recommended })
        })
        .collect()
}

const fn type_label(kind: QuestionType) -> &'static str {
    match kind {
        QuestionType::Single => "单选",
        QuestionType::Multi => "多选",
        QuestionType::Yesno => "是/否",
        QuestionType::Text => "自由文本",
    }
}

/// Tool result for the agent: each question with its answer, then attachments placed in the workspace.
pub fn format_answers(
    questions: &[Question],
    answers: Option<&[Answer]>,
    attachments: &[Attachment],
    answered_by: Option<&str>,
) -> String {
    let Some(answers) = answers else { return NO_ANSWER.into() };
    let mut out = format!("{} 的回答：\n", answered_by.unwrap_or("群成员"));
    for (i, q) in questions.iter().enumerate() {
        let a = answers.iter().find(|a| a.question_id == q.id);
        let mut parts: Vec<String> = a
            .map(|a| a.choices.iter().filter_map(|c| q.options.get(*c as usize).cloned()).collect())
            .unwrap_or_default();
        if let Some(text) = a.and_then(|a| a.text.as_deref()).map(str::trim).filter(|t| !t.is_empty()) {
            parts.push(if q.kind == QuestionType::Text { text.into() } else { format!("其他：{text}") });
        }
        let answer = if parts.is_empty() { "（未作答）".into() } else { parts.join("、") };
        out.push_str(&format!("{}. {}（{}）→ {answer}\n", i + 1, q.title, type_label(q.kind)));
    }
    out.push_str(&attachment_note(attachments));
    out.trim_end().into()
}

/// Lists attachments by their workspace path (the daemon writes them there, spec §8.7).
pub fn attachment_note(attachments: &[Attachment]) -> String {
    if attachments.is_empty() {
        return String::new();
    }
    let paths: String = attachments.iter().map(|a| format!("- {}\n", crate::attachments::rel_path(a))).collect();
    format!("附件（已放入工作区）：\n{paths}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(kind: QuestionType, options: &[&str], recommended: Option<u32>) -> Question {
        Question {
            id: "q1".into(),
            kind,
            title: "用哪种语言？".into(),
            options: options.iter().map(|s| s.to_string()).collect(),
            recommended,
        }
    }

    #[test]
    fn parses_and_validates_questions() {
        let args = json!({ "questions": [
            { "type": "single", "title": "用哪种语言？", "options": ["Python", "Go"], "recommended": 0 },
            { "type": "yesno", "title": "改 fixture 吗？", "recommended": 1 },
            { "type": "text", "title": "还有什么？", "options": ["ignored"], "recommended": 0 },
            { "type": "multi", "title": "哪些渠道？", "options": ["微信", "支付宝"], "recommended": 5 },
        ]});
        let qs = parse(&args).unwrap();
        assert_eq!(qs[0], Question { id: "q1".into(), ..q(QuestionType::Single, &["Python", "Go"], Some(0)) });
        assert_eq!((qs[1].options.clone(), qs[1].recommended), (vec!["是".into(), "否".into()], Some(1)));
        assert_eq!((qs[2].id.as_str(), qs[2].options.len(), qs[2].recommended), ("q3", 0, None));
        assert_eq!(qs[3].recommended, None);

        assert!(parse(&json!({ "questions": [] })).is_err());
        let five = json!({ "questions": vec![json!({ "type": "text", "title": "x" }); 5] });
        assert!(parse(&five).is_err());
        assert!(parse(&json!({ "questions": [{ "type": "single", "title": "x", "options": ["a"] }] })).is_err());
        assert!(parse(&json!({ "questions": [{ "type": "text", "title": " " }] })).is_err());
        assert!(parse(&json!({ "questions": [{ "type": "essay", "title": "x" }] })).is_err());
    }

    #[test]
    fn formats_answers_and_the_timeout_instruction() {
        let qs = vec![
            q(QuestionType::Single, &["Python", "Go"], Some(0)),
            Question {
                id: "q2".into(),
                title: "哪些渠道？".into(),
                ..q(QuestionType::Multi, &["微信", "支付宝"], None)
            },
            Question { id: "q3".into(), title: "还有什么？".into(), ..q(QuestionType::Text, &[], None) },
        ];
        let answers = vec![
            Answer { question_id: "q1".into(), choices: vec![1], text: None },
            Answer { question_id: "q2".into(), choices: vec![0], text: Some("银联".into()) },
            Answer { question_id: "q3".into(), choices: vec![], text: Some("注意幂等".into()) },
        ];
        let att = Attachment {
            id: "a1".into(),
            name: "shot.png".into(),
            size: 1,
            mime: "image/png".into(),
            message_id: "qs1".into(),
        };
        assert_eq!(
            format_answers(&qs, Some(&answers), &[att], Some("王磊")),
            "王磊 的回答：\n1. 用哪种语言？（单选）→ Go\n2. 哪些渠道？（多选）→ 微信、其他：银联\n3. 还有什么？（自由文本）→ 注意幂等\n附件（已放入工作区）：\n- .gonggong/attachments/qs1/shot.png"
        );
        assert_eq!(
            format_answers(&qs, Some(&[]), &[], None).lines().nth(1),
            Some("1. 用哪种语言？（单选）→ （未作答）")
        );
        assert_eq!(format_answers(&qs, None, &[], None), NO_ANSWER);
    }

    #[derive(Default)]
    struct Fake(Mutex<Option<oneshot::Sender<String>>>, Mutex<Vec<Question>>, Option<(String, PathBuf)>);

    impl Asker for Fake {
        fn ask(&self, questions: Vec<Question>) -> Result<oneshot::Receiver<String>, String> {
            let (tx, rx) = oneshot::channel();
            *self.0.lock().unwrap() = Some(tx);
            *self.1.lock().unwrap() = questions;
            Ok(rx)
        }

        fn active_run(&self) -> Option<(String, PathBuf)> {
            self.2.clone()
        }

        fn scope(&self) -> Option<Scope> {
            let (run_id, root) = self.2.clone()?;
            let out = crate::service::Outbox::channel().0;
            Some(Scope { group_id: "g".into(), bot_id: "b".into(), run_id: Some(run_id), root, out })
        }
    }

    fn services() -> Services {
        Services::new(&std::env::temp_dir().join(format!("gg-ask-{}", uuid::Uuid::new_v4())))
    }

    async fn rpc(http: &reqwest::Client, url: &str, body: Value) -> (u16, Option<Value>) {
        let res =
            http.post(url).header("accept", "application/json, text/event-stream").json(&body).send().await.unwrap();
        let status = res.status().as_u16();
        (status, res.json().await.ok())
    }

    #[tokio::test]
    async fn serves_the_ask_tool_over_streamable_http() {
        let server = AskServer::start(None, services()).await.unwrap();
        let fake = Arc::new(Fake::default());
        let McpServer::Http(entry) = server.register(Arc::downgrade(&fake) as Weak<dyn Asker>) else { panic!() };
        assert_eq!(entry.name, "gonggong");
        let (url, http) = (entry.url.as_str(), reqwest::Client::new());

        let init = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "t", "version": "1" } } });
        let (status, body) = rpc(&http, url, init).await;
        assert_eq!(status, 200);
        assert_eq!(body.unwrap()["result"]["protocolVersion"], "2025-06-18");
        let (status, _) = rpc(&http, url, json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).await;
        assert_eq!(status, 202);
        let (_, body) = rpc(&http, url, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).await;
        let tools = body.unwrap()["result"]["tools"].clone();
        // Claude Code defers MCP tools behind ToolSearch; the agent must see this one to ask instead of guessing.
        assert_eq!(tools[0]["_meta"]["anthropic/alwaysLoad"], true);
        let names: Vec<String> =
            serde_json::from_value(tools.as_array().unwrap().iter().map(|t| t["name"].clone()).collect()).unwrap();
        assert_eq!(
            names,
            [
                TOOL,
                "list_messages",
                "search_messages",
                "get_group_info",
                "get_run",
                "list_questions",
                "fetch_attachments",
                "preview_expose",
                "preview_close",
                "service_start",
                "service_list",
                "service_logs",
                "service_stop",
                "preview_static"
            ]
        );

        let args = json!({ "questions": [{ "type": "single", "title": "用哪种语言？", "options": ["Python", "Go"], "recommended": 0 }] });
        let call =
            json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": TOOL, "arguments": args } });
        let pending = tokio::spawn({
            let (http, url) = (http.clone(), url.to_string());
            async move { rpc(&http, &url, call).await }
        });
        let tx = loop {
            if let Some(tx) = fake.0.lock().unwrap().take() {
                break tx;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        };
        assert_eq!(fake.1.lock().unwrap()[0].options, vec!["Python", "Go"]);
        tx.send("王磊 的回答：Go".into()).unwrap();
        let (_, body) = pending.await.unwrap();
        let result = &body.unwrap()["result"];
        assert_eq!(
            (result["content"][0]["text"].as_str(), result["isError"].as_bool()),
            (Some("王磊 的回答：Go"), Some(false))
        );

        // Invalid input is a tool error the agent can fix; unknown secrets and GET streams are refused.
        let bad = json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": TOOL, "arguments": { "questions": [] } } });
        assert_eq!(rpc(&http, url, bad).await.1.unwrap()["result"]["isError"], true);
        let other = url.rsplit_once('/').unwrap().0.to_string() + "/nope";
        assert_eq!(rpc(&http, &other, json!({ "jsonrpc": "2.0", "id": 5, "method": "ping" })).await.0, 404);
        assert_eq!(http.get(url).send().await.unwrap().status().as_u16(), 405);
    }

    /// Answers each request by path: the tool call with `tool`, attachment downloads with their name; records them.
    async fn fake_server(tool: &'static str) -> (String, Arc<Mutex<Vec<String>>>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(vec![]));
        let log = seen.clone();
        tokio::spawn(async move {
            loop {
                let (mut s, _) = listener.accept().await.unwrap();
                let mut buf = vec![0u8; 16384];
                let n = s.read(&mut buf).await.unwrap();
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let body = if req.starts_with("POST") { tool.to_string() } else { "PDF".to_string() };
                log.lock().unwrap().push(req);
                let res = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                s.write_all(res.as_bytes()).await.unwrap();
            }
        });
        (url, seen)
    }

    fn config(server: String) -> Config {
        Config { server, token: "mt_1".into(), machine_id: "m".into(), owner_name: "王磊".into(), cert_sha256: None }
    }

    #[tokio::test]
    async fn forwards_server_tools_for_the_live_run_and_places_attachments() {
        let res = r##"{"text":"#12 的附件：","isError":false,"attachments":[{"id":"a1","name":"spec.pdf","size":3,"mime":"application/pdf","messageId":"m12"}]}"##;
        let (base, seen) = fake_server(res).await;
        let dir = tempfile::tempdir().unwrap();
        let live = Fake(Mutex::default(), Mutex::default(), Some(("r1".into(), dir.path().to_path_buf())));
        let args = json!({ "message": 12 });

        let text = forward(Some(&config(base.clone())), &live, "fetch_attachments", &args).await.unwrap();
        assert_eq!(text, "#12 的附件：\n附件（已放入工作区）：\n- .gonggong/attachments/m12/spec.pdf");
        assert_eq!(std::fs::read_to_string(dir.path().join(".gonggong/attachments/m12/spec.pdf")).unwrap(), "PDF");
        let reqs = seen.lock().unwrap().clone();
        assert!(reqs[0].starts_with("POST /api/daemon/runs/r1/tools/fetch_attachments HTTP/1.1"));
        assert!(reqs[0].to_ascii_lowercase().contains("authorization: bearer mt_1"));
        assert!(reqs[0].ends_with(r#"{"arguments":{"message":12}}"#));

        let (base, _) = fake_server(r#"{"text":"无权读取该群","isError":true,"attachments":[]}"#).await;
        let err = forward(Some(&config(base)), &live, "list_messages", &json!({})).await;
        assert_eq!(err, Err("无权读取该群".into()));
        let idle = Fake::default();
        assert_eq!(
            forward(Some(&config("http://x".into())), &idle, "list_messages", &json!({})).await,
            Err(NOT_RUNNING.into())
        );
    }

    #[tokio::test]
    async fn answers_hosted_service_tools_for_the_live_run() {
        let server = AskServer::start(None, services()).await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let live = Arc::new(Fake(Mutex::default(), Mutex::default(), Some(("r1".into(), dir.path().to_path_buf()))));
        let McpServer::Http(entry) = server.register(Arc::downgrade(&live) as Weak<dyn Asker>) else { panic!() };
        let http = reqwest::Client::new();
        let call = |id: u32, name: &str, args: Value| json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": name, "arguments": args } });
        let start = call(1, "service_start", json!({ "name": "echo", "command": "echo hi; sleep 30" }));
        let result = rpc(&http, &entry.url, start).await.1.unwrap()["result"].clone();
        assert_eq!(result["isError"], false, "{result}");
        let list = rpc(&http, &entry.url, call(2, "service_list", json!({}))).await.1.unwrap();
        assert!(list["result"]["content"][0]["text"].as_str().unwrap().contains("echo · 运行中"), "{list}");
        let stop = rpc(&http, &entry.url, call(3, "service_stop", json!({ "name": "echo" }))).await.1.unwrap();
        assert_eq!(stop["result"]["isError"], false, "{stop}");
        let logs = rpc(&http, &entry.url, call(4, "service_logs", json!({}))).await.1.unwrap();
        assert_eq!(logs["result"]["isError"], true, "missing name is the agent's to fix: {logs}");
    }

    #[tokio::test]
    async fn publishes_a_static_dir_through_preview_expose_by_port() {
        let (base, seen) = fake_server(r#"{"text":"已发布预览「报告」","isError":false,"attachments":[]}"#).await;
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("out/report")).unwrap();
        std::fs::write(dir.path().join("out/report/index.html"), "ok").unwrap();
        let live = Fake(Mutex::default(), Mutex::default(), Some(("r1".into(), dir.path().to_path_buf())));
        let services = services();
        let args = json!({ "dir": "out/report", "title": "报告" });
        let backends = Backends { api: Arc::new(Some(config(base))), services: services.clone() };
        let text = hosted(&backends, &live, "preview_static", &args).await.unwrap();
        assert_eq!(text, "已发布预览「报告」");
        let running = services.list_infos("g", "b");
        assert_eq!(running[0].name, "static-out-report");
        let port = running[0].port.unwrap();
        let req = seen.lock().unwrap()[0].clone();
        assert!(req.starts_with("POST /api/daemon/runs/r1/tools/preview_expose HTTP/1.1"), "{req}");
        assert!(req.ends_with(&format!(r#"{{"arguments":{{"port":{port},"title":"报告"}}}}"#)), "{req}");
        assert_eq!(reqwest::get(format!("http://127.0.0.1:{port}/")).await.unwrap().text().await.unwrap(), "ok");
    }

    #[test]
    fn names_static_sites_after_their_dir() {
        assert_eq!(static_name(""), "static");
        assert_eq!(static_name("./dist/"), "static-dist");
        assert_eq!(static_name("Docs/报告 2026"), "static-docs-2026");
        assert!(static_name("a/very/long/path/that/goes/on/and/on").len() <= 32);
    }

    #[test]
    fn recognizes_its_tools_in_permission_titles() {
        assert!(is_builtin("mcp__gonggong__ask_group_members"));
        assert!(is_builtin("mcp__gonggong__list_messages"));
        assert!(is_builtin("mcp__gonggong__preview_expose"));
        assert!(is_builtin("mcp__gonggong__service_logs"));
        assert!(!is_builtin("mcp__gonggong__service_start"), "runs a command: the owner decides");
        assert!(!is_builtin("mcp__wiki__list_messages"));
        assert!(!is_builtin("Bash"));
    }
}
