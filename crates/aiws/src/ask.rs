//! Built-in 「向群成员提问」 tool (spec §8.8): a minimal MCP server (Streamable HTTP, JSON responses only) on
//! loopback. Every session gets its own secret URL; a tool call blocks until the group answers or it times out.
use crate::protocol::{Answer, Attachment, Question, QuestionType};
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
use std::sync::{Arc, Mutex, Weak};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

pub const SERVER_NAME: &str = "aiws";
pub const TOOL: &str = "ask_group_members";
pub const NO_ANSWER: &str = "无人回答，请按推荐项或最佳判断继续，并在最终回复里列出你做的假设";
const MAX_QUESTIONS: usize = 4;
const MAX_OPTIONS: usize = 10;
const PROTOCOL_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const YES_NO: [&str; 2] = ["是", "否"];

/// The side that relays questions to the group (a conversation's active run).
pub trait Asker: Send + Sync {
    /// Resolves with the tool's text result; a dropped sender means the question was withdrawn (stop / append).
    fn ask(&self, questions: Vec<Question>) -> Result<oneshot::Receiver<String>, String>;
}

type Routes = Arc<Mutex<HashMap<String, Weak<dyn Asker>>>>;

#[derive(Clone)]
pub struct AskServer {
    base: String,
    routes: Routes,
}

impl AskServer {
    pub async fn start() -> std::io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let base = format!("http://{}/mcp/", listener.local_addr()?);
        let routes = Routes::default();
        tokio::spawn(accept(listener, routes.clone()));
        Ok(AskServer { base, routes })
    }

    /// Registers an asker under a fresh secret path; returns the MCP server entry for `session/new`.
    pub fn register(&self, asker: Weak<dyn Asker>) -> McpServer {
        let secret = uuid::Uuid::new_v4().simple().to_string();
        self.routes.lock().unwrap().insert(secret.clone(), asker);
        McpServer::Http(McpServerHttp::new(SERVER_NAME, format!("{}{secret}", self.base)))
    }
}

async fn accept(listener: TcpListener, routes: Routes) {
    loop {
        let stream = match listener.accept().await {
            Ok((stream, _)) => stream,
            Err(e) => {
                tracing::warn!("ask server accept failed: {e}");
                continue;
            }
        };
        let routes = routes.clone();
        tokio::spawn(async move {
            let service = service_fn(move |req| handle(routes.clone(), req));
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

async fn handle(routes: Routes, req: Request<Incoming>) -> Result<Response<Full<Bytes>>, Infallible> {
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
        "tools/list" => result(id, json!({ "tools": [tool()] })),
        "tools/call" if params["name"] == TOOL => match call(asker.as_ref(), &params["arguments"]).await {
            Ok(text) => result(id, tool_result(&text, false)),
            Err(e) => result(id, tool_result(&e, true)),
        },
        "tools/call" => error(id, -32602, "unknown tool"),
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
    let paths: String =
        attachments.iter().map(|a| format!("- .aiws/attachments/{}/{}\n", a.message_id, a.name)).collect();
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
            "王磊 的回答：\n1. 用哪种语言？（单选）→ Go\n2. 哪些渠道？（多选）→ 微信、其他：银联\n3. 还有什么？（自由文本）→ 注意幂等\n附件（已放入工作区）：\n- .aiws/attachments/qs1/shot.png"
        );
        assert_eq!(
            format_answers(&qs, Some(&[]), &[], None).lines().nth(1),
            Some("1. 用哪种语言？（单选）→ （未作答）")
        );
        assert_eq!(format_answers(&qs, None, &[], None), NO_ANSWER);
    }

    struct Fake(Mutex<Option<oneshot::Sender<String>>>, Mutex<Vec<Question>>);

    impl Asker for Fake {
        fn ask(&self, questions: Vec<Question>) -> Result<oneshot::Receiver<String>, String> {
            let (tx, rx) = oneshot::channel();
            *self.0.lock().unwrap() = Some(tx);
            *self.1.lock().unwrap() = questions;
            Ok(rx)
        }
    }

    async fn rpc(http: &reqwest::Client, url: &str, body: Value) -> (u16, Option<Value>) {
        let res =
            http.post(url).header("accept", "application/json, text/event-stream").json(&body).send().await.unwrap();
        let status = res.status().as_u16();
        (status, res.json().await.ok())
    }

    #[tokio::test]
    async fn serves_the_ask_tool_over_streamable_http() {
        let server = AskServer::start().await.unwrap();
        let fake = Arc::new(Fake(Mutex::default(), Mutex::default()));
        let McpServer::Http(entry) = server.register(Arc::downgrade(&fake) as Weak<dyn Asker>) else { panic!() };
        assert_eq!(entry.name, "aiws");
        let (url, http) = (entry.url.as_str(), reqwest::Client::new());

        let init = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "t", "version": "1" } } });
        let (status, body) = rpc(&http, url, init).await;
        assert_eq!(status, 200);
        assert_eq!(body.unwrap()["result"]["protocolVersion"], "2025-06-18");
        let (status, _) = rpc(&http, url, json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).await;
        assert_eq!(status, 202);
        let (_, body) = rpc(&http, url, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).await;
        assert_eq!(body.unwrap()["result"]["tools"][0]["name"], TOOL);

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
}
