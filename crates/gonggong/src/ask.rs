//! Built-in `gonggong` MCP server: a minimal MCP server (Streamable HTTP, JSON responses only) on loopback. Every session
//! gets its own secret URL. 「向群成员提问」 (spec §8.8) is answered here and blocks until the group answers or it
//! times out; the chat-history tools (`gonggong-tools.json`) are forwarded to the server for the session's live run.
use crate::attachments;
use crate::config::Config;
use crate::hosted::{Scope, Services, StartArgs};
use crate::protocol::{Answer, Attachment, OptionMeta, Question, QuestionType, ToolCallRes};
use crate::tls;
use agent_client_protocol::schema::v1::{McpServer, McpServerHttp};
use futures_util::{StreamExt, stream};
use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, Weak};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

pub const SERVER_NAME: &str = "gonggong";
pub const TOOL: &str = "ask_group_members";
pub const NO_ANSWER: &str = "无人回答，请按推荐项或最佳判断继续，并在最终回复里列出你做的假设";
const MAX_QUESTIONS: usize = 4;
const MAX_OPTIONS: usize = 10;
/// `optionMeta` limits of the wire contract (`packages/protocol/src/common.ts`).
const MAX_DESCRIPTION: usize = 120;
const MAX_SWATCH: usize = 6;
const MAX_IMAGE: usize = 500;
const PROTOCOL_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const YES_NO: [&str; 2] = ["是", "否"];
/// Tools answered by the server, generated from `packages/protocol/src/tools.ts`.
const SERVER_TOOLS: &str = include_str!("../../../packages/protocol/gonggong-tools.json");
/// Hosted-service tools answered here (`hosted.rs`), generated from the same file.
const DAEMON_TOOLS: &str = include_str!("../../../packages/protocol/gonggong-daemon-tools.json");
/// Run code (an arbitrary command; a mini program in the simulator, whose trust prompt is then answered), so they go
/// through the bot's approval like the agent's own shell (plan P10).
/// `client_release_publish` puts a binary on every member's machine.
const NEEDS_APPROVAL: [&str; 3] = ["service_start", "preview_miniprogram", "client_release_publish"];
/// A desktop installer or gg-cast build is tens of MB; the server takes up to 300 MB.
const UPLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);
const NOT_RUNNING: &str = "当前不在运行中，无法查询";
const STILL_OPENING: &str = "微信开发者工具还在启动或打开项目（首次打开需要编译，可能要一两分钟）：卡片会在打开后自动显示模拟器画面，不需要再调用。";
/// Under the agents' own tool timeout (a minute for Claude Code and Codex).
#[cfg(not(test))]
const TOOL_BUDGET: std::time::Duration = std::time::Duration::from_secs(45);
#[cfg(test)]
const TOOL_BUDGET: std::time::Duration = std::time::Duration::from_secs(2);
/// Server tools answer quickly; bounded so that a call which first waited out the 45-second budget (opening the
/// devtools) still returns within the agent's minute.
const FORWARD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const AWAITING_LOGIN: &str = "本机的微信开发者工具还没有登录：卡片上显示了登录二维码，Bot 主人用微信扫码后，卡片会自动打开这个页面，不需要再调用。";

/// The conversation behind a session's URL: relays questions to the group and scopes the server tools to its run.
pub trait Asker: Send + Sync {
    /// The request id and the tool's text result; a dropped sender means the question was withdrawn (stop / append).
    fn ask(&self, questions: Vec<Question>) -> Result<(String, oneshot::Receiver<String>), String>;
    /// The agent stopped waiting (its MCP client timed out and hung up): nobody should answer any more.
    fn abandon(&self, request_id: &str);
    /// The run in progress and its workspace.
    fn active_run(&self) -> Option<(String, PathBuf)>;
    /// The run in progress as hosted services see it.
    fn scope(&self) -> Option<Scope>;
}

/// A tool list and its names, parsed once: every tool call and permission request looks them up.
struct Tools {
    list: Vec<Value>,
    names: HashSet<String>,
}

impl Tools {
    fn parse(json: &str) -> Tools {
        let list: Vec<Value> = serde_json::from_str(json).expect("a JSON array of tools");
        let names = list.iter().filter_map(|t| t["name"].as_str().map(String::from)).collect();
        Tools { list, names }
    }
}

static SERVER: LazyLock<Tools> = LazyLock::new(|| Tools::parse(SERVER_TOOLS));
static DAEMON: LazyLock<Tools> = LazyLock::new(|| Tools::parse(DAEMON_TOOLS));

/// Whether a permission request is for one of these tools that needs no owner call: all of them read the group, ask
/// it or manage what `service_start` (which does need one) already started.
pub fn is_builtin(title: &str) -> bool {
    title.contains(TOOL)
        || title.contains(SERVER_NAME)
            && !NEEDS_APPROVAL.iter().any(|t| title.contains(t))
            && SERVER.names.iter().chain(&DAEMON.names).any(|n| title.contains(n.as_str()))
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
    devtools: &'static crate::wechatide::Shared,
}

impl AskServer {
    /// `api`: where the server tools are forwarded; `None` (tests) answers them with an error.
    pub async fn start(api: Option<Config>, services: Services) -> std::io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let base = format!("http://{}/mcp/", listener.local_addr()?);
        let routes = Routes::default();
        tokio::spawn(accept(
            listener,
            routes.clone(),
            Backends { api: Arc::new(api), services, devtools: crate::wechatide::devtools() },
        ));
        Ok(AskServer { base, routes })
    }

    /// Registers an asker under a fresh secret path; returns the MCP server entry for `session/new`.
    pub fn register(&self, asker: Weak<dyn Asker>) -> McpServer {
        let secret = uuid::Uuid::new_v4().simple().to_string();
        self.routes.lock().unwrap().insert(secret.clone(), asker);
        McpServer::Http(McpServerHttp::new(SERVER_NAME, format!("{}{secret}", self.base)))
    }

    /// Drops the route of an entry `register` returned.
    pub fn unregister(&self, entry: &McpServer) {
        if let McpServer::Http(http) = entry
            && let Some(secret) = http.url.strip_prefix(&self.base)
        {
            self.routes.lock().unwrap().remove(secret);
        }
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
            let tools: Vec<Value> = [vec![tool()], SERVER.list.clone(), DAEMON.list.clone()].concat();
            result(id, json!({ "tools": tools }))
        }
        "tools/call" => {
            let (name, args) = (params["name"].as_str().unwrap_or_default(), &params["arguments"]);
            let out = if name == TOOL {
                Some(call(asker.as_ref(), args).await)
            } else if SERVER.names.contains(name) {
                Some(forward(backends.api.as_ref().as_ref(), asker.as_ref(), name, args).await)
            } else if name == "send_attachments" {
                Some(send_attachments(backends.api.as_ref().as_ref(), asker.as_ref(), args).await)
            } else if name == "client_release_publish" {
                Some(publish_release(backends.api.as_ref().as_ref(), asker.as_ref(), args).await)
            } else if name == "client_release_notes" {
                Some(update_release_notes(backends.api.as_ref().as_ref(), asker.as_ref(), args).await)
            } else if name == "feishu_send_card" {
                Some(send_feishu_card(backends.api.as_ref().as_ref(), asker.as_ref(), args).await)
            } else if DAEMON.names.contains(name) {
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
            需要大家看图、看配色再选时（如设计方向），用 option_meta 按下标给每个选项配：description 一句话说明，\
            swatch 色板（6 位十六进制色值如 #0071e3，最多 6 个），image 预览图（工作区内的相对路径，如 design/x/directions/a.png）。\
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
                            "option_meta": {
                                "type": "array",
                                "maxItems": MAX_OPTIONS,
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "description": { "type": "string", "maxLength": MAX_DESCRIPTION },
                                        "swatch": {
                                            "type": "array",
                                            "items": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
                                            "maxItems": MAX_SWATCH,
                                        },
                                        "image": { "type": "string", "maxLength": MAX_IMAGE },
                                    },
                                },
                            },
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
    #[serde(default, alias = "optionMeta")]
    option_meta: Vec<InputOptionMeta>,
}

#[derive(Deserialize)]
struct InputOptionMeta {
    description: Option<String>,
    #[serde(default)]
    swatch: Vec<String>,
    image: Option<String>,
}

async fn call(asker: &dyn Asker, args: &Value) -> Result<String, String> {
    let questions = parse(args)?;
    let (request_id, rx) = asker.ask(questions)?;
    // Dropped with the request when the client hangs up; a no-op once the question is settled.
    struct Abandon<'a>(&'a dyn Asker, String);
    impl Drop for Abandon<'_> {
        fn drop(&mut self) {
            self.0.abandon(&self.1);
        }
    }
    let _abandon = Abandon(asker, request_id);
    rx.await.map_err(|_| "提问已作废（运行被停止或被打断），请不要再等待回答。".to_string())
}

/// Asks the server on behalf of the live run; attachments it names are written into the run's workspace.
async fn forward(api: Option<&Config>, asker: &dyn Asker, name: &str, args: &Value) -> Result<String, String> {
    let api = api.ok_or("未连接服务器，无法查询")?;
    let (run_id, cwd) = asker.active_run().ok_or(NOT_RUNNING)?;
    let url = format!("{}/api/daemon/runs/{run_id}/tools/{name}", api.server.trim_end_matches('/'));
    let send = async {
        let res = tls::http(api)?
            .post(url)
            .bearer_auth(&api.token)
            .json(&json!({ "arguments": args }))
            .timeout(FORWARD_TIMEOUT)
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
struct SendAttachmentsArgs {
    paths: Vec<String>,
    text: Option<String>,
}

async fn send_attachments(api: Option<&Config>, asker: &dyn Asker, args: &Value) -> Result<String, String> {
    let a = SendAttachmentsArgs::deserialize(args).map_err(|e| format!("参数无效：{e}"))?;
    if !(1..=10).contains(&a.paths.len()) {
        return Err("paths 需要 1 至 10 个工作区文件".into());
    }
    let count = a.paths.len();
    let api = api.ok_or("未连接服务器，无法发送附件")?;
    let (run_id, cwd) = asker.active_run().ok_or(NOT_RUNNING)?;
    let root = cwd.canonicalize().map_err(|e| format!("工作区不可用：{e}"))?;
    let mut paths = vec![];
    for file in a.paths {
        let path = workspace_file(&root, &file).ok_or_else(|| format!("文件 {file} 必须是工作区内已存在的文件"))?;
        paths.push((file, path));
    }
    let mut form = reqwest::multipart::Form::new();
    if let Some(text) = a.text {
        form = form.text("text", text);
    }
    for (file, path) in paths {
        let part = reqwest::multipart::Part::file(&path).await.map_err(|e| format!("读取 {file} 失败：{e}"))?;
        form = form.part("files", part);
    }
    post_form(api, &format!("/api/daemon/runs/{run_id}/attachments"), form)
        .await
        .and_then(|r| r)
        .map_err(|e| format!("附件未发送：{e}"))?;
    Ok(format!("已发送 {count} 个附件到群聊"))
}

#[derive(Deserialize)]
struct ReleaseArgs {
    file: Option<String>,
    dir: Option<String>,
    kind: Option<String>,
}

enum Release {
    File(String),
    Dir(String, bool),
}

impl Release {
    fn parse(args: &Value) -> Result<Release, String> {
        match ReleaseArgs::deserialize(args).map_err(|e| format!("参数无效：{e}"))? {
            ReleaseArgs { file: Some(file), dir: None, kind: None } => Ok(Release::File(file)),
            ReleaseArgs { file: None, dir: Some(dir), kind: None } => Ok(Release::Dir(dir, false)),
            ReleaseArgs { file: None, dir: Some(dir), kind: Some(kind) } if kind == "daemon" => {
                Ok(Release::Dir(dir, true))
            }
            ReleaseArgs { file: Some(_), dir: None, kind: Some(_) } => Err("参数无效：单文件不支持 kind".into()),
            ReleaseArgs { file: None, dir: Some(_), kind: Some(_) } => {
                Err("参数无效：dir 的 kind 仅支持 daemon".into())
            }
            _ => Err("参数无效：file 与 dir 需要且只能给一个".into()),
        }
    }
}

/// What the server's `parseReleaseFile` takes (`packages/protocol/src/web.ts`), plus the notes it reads from
/// `RELEASE_NOTES.md`.
static RELEASE_FILE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(
        r"^(?:(?:gonggong|gg-cast)-\d+\.\d+\.\d+-(?:(?:macos|linux)-(?:x86_64|aarch64)|windows-x86_64\.exe)|Gonggong_\d+\.\d+\.\d+_(?:(?:aarch64|x86_64)\.(?:dmg|app\.tar\.gz(?:\.sig)?)|x64-setup\.exe(?:\.sig)?)|RELEASE_NOTES\.md)$",
    )
    .unwrap()
});
const RELEASE_NOTES: &str = "RELEASE_NOTES.md";
/// File names an approval card lists before「等 N 个」.
const APPROVAL_NAMES: usize = 20;

fn is_release_file(name: &str) -> bool {
    RELEASE_FILE.is_match(name)
}

/// The release files directly in `rel` (inside the canonical `root`) as (name, path), by name with the notes last:
/// the server attaches notes to the release the artifacts before them created.
fn release_files(root: &Path, rel: &str, daemon_only: bool) -> Result<Vec<(String, PathBuf)>, String> {
    let dir = crate::hosted::inside(root, rel)?;
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("读取 {rel} 失败：{e}"))?;
    let mut files: Vec<(String, PathBuf)> = entries
        .filter_map(|e| {
            let name = e.ok()?.file_name().into_string().ok().filter(|n| {
                is_release_file(n) && (!daemon_only || *n == RELEASE_NOTES || !n.starts_with("Gonggong_"))
            })?;
            let path = workspace_file(root, dir.join(&name))?;
            Some((name, path))
        })
        .collect();
    if files.is_empty() {
        return Err(format!("{rel} 里没有可发布的产物"));
    }
    files.sort_by(|a, b| (a.0 == RELEASE_NOTES, &a.0).cmp(&(b.0 == RELEASE_NOTES, &b.0)));
    if daemon_only {
        let version = release_version(files.iter().map(|(name, _)| name.as_str()))?;
        for prefix in ["gonggong", "gg-cast"] {
            for platform in ["macos-aarch64", "macos-x86_64", "linux-x86_64", "linux-aarch64", "windows-x86_64"] {
                let suffix = if platform.starts_with("windows") { ".exe" } else { "" };
                let name = format!("{prefix}-{version}-{platform}{suffix}");
                if !files.iter().any(|(n, _)| *n == name) {
                    return Err(format!("daemon 快速发布缺少 {name}；请先完整发布以生成缓存"));
                }
            }
        }
    }
    Ok(files)
}

fn release_version<'a>(names: impl Iterator<Item = &'a str>) -> Result<String, String> {
    let mut version = None;
    for name in names {
        let Some(rest) = name.strip_prefix("gonggong-").or_else(|| name.strip_prefix("gg-cast-")) else { continue };
        let v = rest.split('-').next().unwrap_or_default();
        if version.is_some_and(|current| current != v) {
            return Err("daemon 快速发布目录中的产物版本不一致".into());
        }
        version = Some(v);
    }
    version.map(String::from).ok_or_else(|| "daemon 快速发布目录里没有 daemon 产物".into())
}

/// What the bot owner approves for a `client_release_publish` call: the file, or every file of the dir.
pub fn release_approval(title: &str, raw_input: Option<&Value>, cwd: &Path) -> Option<String> {
    if !(title.contains(SERVER_NAME) && title.contains("client_release_publish")) {
        return None;
    }
    let (dir, daemon_only) = match Release::parse(crate::mcp_call::arguments(raw_input?)).ok()? {
        Release::File(file) => return Some(crate::t!("发布 {file}", file = file)),
        Release::Dir(dir, daemon_only) => (dir, daemon_only),
    };
    let files = release_files(&cwd.canonicalize().ok()?, &dir, daemon_only).ok()?;
    let names: Vec<&str> = files.iter().take(APPROVAL_NAMES).map(|f| f.0.as_str()).collect();
    let mut detail =
        crate::t!("发布 {dir} 中的 {n} 个文件：", dir = dir, n = files.len()) + &names.join(crate::t!("、"));
    if files.len() > APPROVAL_NAMES {
        detail += &crate::t!(" 等 {n} 个", n = files.len());
    }
    Some(detail)
}

/// Uploads one release artifact, or a dir with four parallel artifact uploads. The server serializes its manifest
/// updates; the notes go last so they attach to the release created by the artifacts.
async fn publish_release(api: Option<&Config>, asker: &dyn Asker, args: &Value) -> Result<String, String> {
    let release = Release::parse(args)?;
    let api = api.ok_or("未连接服务器，无法发布")?;
    let (run_id, cwd) = asker.active_run().ok_or(NOT_RUNNING)?;
    let root = cwd.canonicalize().map_err(|e| format!("工作区不可用：{e}"))?;
    let mb = |size: usize| size as f64 / 1_048_576.0;
    let (dir, daemon_only) = match release {
        Release::Dir(dir, daemon_only) => (dir, daemon_only),
        Release::File(file) => {
            let path = workspace_file(&root, &file).ok_or("文件必须是工作区内已存在的文件")?;
            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let (size, body) = upload_release(api, &run_id, &name, &path).await?;
            let version = body["version"].as_str().unwrap_or_default();
            return Ok(format!("已发布 {name}（{:.1} MB）到当前空间，当前发布版本 {version}", mb(size)));
        }
    };
    let mut files = release_files(&root, &dir, daemon_only)?;
    let count = files.len();
    let notes = if files.last().is_some_and(|(name, _)| name == RELEASE_NOTES) { files.pop() } else { None };
    let mut uploads = stream::iter(files.into_iter().map(|(name, path)| {
        let (api, run_id) = (api.clone(), run_id.clone());
        async move {
            let result = upload_release(&api, &run_id, &name, &path).await;
            (name, result)
        }
    }))
    .buffer_unordered(4);
    let (mut total, mut last, mut failed) = (0, Value::Null, vec![]);
    let mut uploaded = 0;
    while let Some((name, result)) = uploads.next().await {
        match result {
            Ok((size, body)) => {
                total += size;
                last = body;
                uploaded += 1;
            }
            Err(e) => failed.push((name, e)),
        }
    }
    if !failed.is_empty() {
        let mut names = failed.iter().map(|(name, _)| name.as_str()).collect::<Vec<_>>();
        if notes.is_some() {
            names.push(RELEASE_NOTES);
        }
        let mut msg = failed.iter().map(|(_, e)| e.as_str()).collect::<Vec<_>>().join("\n");
        msg += &format!("\n未发布 {} 个文件：{}", names.len(), names.join("、"));
        if uploaded > 0 {
            msg += &format!("\n已上传 {uploaded} 个文件；可直接重试同一目录");
        }
        return Err(msg);
    }
    if let Some((name, path)) = notes {
        let (size, body) = upload_release(api, &run_id, &name, &path).await?;
        total += size;
        last = body;
    }
    let version = last["version"].as_str().unwrap_or_default();
    let mut text =
        format!("已发布 {dir} 中的 {count} 个文件（共 {:.1} MB）到当前空间，当前发布版本 {version}", mb(total));
    if let Some(warning) = last["warning"].as_str() {
        text += &format!("\n{warning}");
    }
    Ok(text)
}

/// Uploads one release file as `name`: its size and the server's release.
async fn upload_release(api: &Config, run_id: &str, name: &str, path: &Path) -> Result<(usize, Value), String> {
    let size = usize::try_from(tokio::fs::metadata(path).await.map_err(|e| format!("读取 {name} 失败：{e}"))?.len())
        .map_err(|_| format!("{name} 太大，无法上传"))?;
    let part = reqwest::multipart::Part::file(path).await.map_err(|e| format!("读取 {name} 失败：{e}"))?;
    let form = reqwest::multipart::Form::new().part("file", part.file_name(name.to_string()));
    let body = post_form(api, &format!("/api/daemon/runs/{run_id}/release-files"), form)
        .await
        .map_err(|e| format!("上传 {name} 失败：{e}"))?
        .map_err(|reason| format!("服务器拒绝了 {name}：{reason}"))?;
    Ok((size, body))
}

#[derive(Deserialize)]
struct ReleaseNotesArgs {
    version: String,
    #[serde(rename = "releaseNotes")]
    release_notes: String,
}

/// Writes the current release's notes on behalf of a run a sysadmin started.
async fn update_release_notes(api: Option<&Config>, asker: &dyn Asker, args: &Value) -> Result<String, String> {
    let a = ReleaseNotesArgs::deserialize(args).map_err(|e| format!("参数无效：{e}"))?;
    if a.release_notes.trim().is_empty() {
        return Err("版本说明不能为空".into());
    }
    let api = api.ok_or("未连接服务器，无法更新版本说明")?;
    let (run_id, _) = asker.active_run().ok_or(NOT_RUNNING)?;
    let body = post_json(
        api,
        &format!("/api/daemon/runs/{run_id}/release-notes"),
        &json!({ "version": a.version, "releaseNotes": a.release_notes }),
    )
    .await
    .map_err(|e| format!("更新版本说明失败：{e}"))?
    .map_err(|reason| format!("服务器拒绝了版本说明：{reason}"))?;
    let version = body["version"].as_str().unwrap_or(&a.version);
    Ok(format!("已更新 {version} 的版本说明（{} 字）", a.release_notes.chars().count()))
}

#[derive(Deserialize)]
struct FeishuCardArgs {
    card: Value,
    #[serde(default)]
    images: BTreeMap<String, String>,
}

/// Sends a custom Feishu card with the workspace images it references; the server uploads them with the bot's app.
async fn send_feishu_card(api: Option<&Config>, asker: &dyn Asker, args: &Value) -> Result<String, String> {
    let a = FeishuCardArgs::deserialize(args).map_err(|e| format!("参数无效：{e}"))?;
    let api = api.ok_or("未连接服务器，无法发送")?;
    let (run_id, cwd) = asker.active_run().ok_or(NOT_RUNNING)?;
    let root = cwd.canonicalize().map_err(|e| format!("工作区不可用：{e}"))?;
    let mut form = reqwest::multipart::Form::new().text("card", a.card.to_string());
    for (key, file) in &a.images {
        let path = workspace_file(&root, file).ok_or_else(|| format!("图片 {file} 必须是工作区内已存在的文件"))?;
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let data = tokio::fs::read(&path).await.map_err(|e| format!("读取 {file} 失败：{e}"))?;
        form = form.part(format!("image.{key}"), reqwest::multipart::Part::bytes(data).file_name(name));
    }
    let body = post_form(api, &format!("/api/daemon/runs/{run_id}/feishu-card"), form)
        .await
        .and_then(|r| r)
        .map_err(|e| format!("飞书卡片未发送：{e}"))?;
    Ok(format!("已发送飞书卡片到飞书群「{}」", body["chat"].as_str().unwrap_or_default()))
}

/// `rel` resolved inside the (canonical) workspace `root`, if it is an existing file there.
fn workspace_file(root: &Path, rel: impl AsRef<Path>) -> Option<PathBuf> {
    root.join(rel).canonicalize().ok().filter(|p| p.starts_with(root) && p.is_file())
}

/// POSTs a multipart form to the server as the machine: Err when it could not be sent, Ok(Err(reason)) when the
/// server refused it.
async fn post_form(api: &Config, path: &str, form: reqwest::multipart::Form) -> Result<Result<Value, String>, String> {
    let url = format!("{}{path}", api.server.trim_end_matches('/'));
    let send = async {
        let res =
            tls::http(api)?.post(url).bearer_auth(&api.token).multipart(form).timeout(UPLOAD_TIMEOUT).send().await?;
        let status = res.status();
        let body: Value = res.json().await.unwrap_or(Value::Null);
        anyhow::Ok((status, body))
    };
    let (status, body) = send.await.map_err(|e| format!("{e:#}"))?;
    if !status.is_success() {
        return Ok(Err(body["message"].as_str().map_or_else(|| status.to_string(), String::from)));
    }
    Ok(Ok(body))
}

/// POSTs JSON as the machine: Err when it could not be sent, Ok(Err(reason)) when the server refused it.
async fn post_json(api: &Config, path: &str, body: &Value) -> Result<Result<Value, String>, String> {
    let url = format!("{}{path}", api.server.trim_end_matches('/'));
    let send = async {
        let res = tls::http(api)?.post(url).bearer_auth(&api.token).json(body).timeout(FORWARD_TIMEOUT).send().await?;
        let status = res.status();
        let body: Value = res.json().await.unwrap_or(Value::Null);
        anyhow::Ok((status, body))
    };
    let (status, body) = send.await.map_err(|e| format!("{e:#}"))?;
    if !status.is_success() {
        return Ok(Err(body["message"].as_str().map_or_else(|| status.to_string(), String::from)));
    }
    Ok(Ok(body))
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

#[derive(Deserialize)]
struct MiniprogramArgs {
    #[serde(default)]
    dir: String,
    page: Option<String>,
    query: Option<String>,
    title: String,
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
    if name == "preview_miniprogram" {
        let a = MiniprogramArgs::deserialize(args).map_err(invalid)?;
        let project = crate::hosted::inside(&scope.root, &a.dir)?;
        let page = a.page.map(|p| a.query.map_or_else(|| p.clone(), |q| format!("{p}?{q}")));
        // Agents give a tool call about a minute: launching the devtools, a first compile or a trust prompt may take
        // longer. The card's snapshot then finishes opening (the same steps, resumed).
        let opened =
            tokio::time::timeout(TOOL_BUDGET, crate::wechatide::open(backends.devtools, &project, page.as_deref()));
        let login = match opened.await {
            Ok(login) => Some(login?),
            Err(_) => None,
        };
        let mut expose = json!({ "miniprogram": project.to_string_lossy(), "title": a.title });
        if let Some(page) = page {
            expose["path"] = json!(format!("/{page}"));
        }
        let published = forward(backends.api.as_ref().as_ref(), asker, "preview_expose", &expose).await?;
        return Ok(match login {
            Some(None) => published,
            // The card shows the code; once scanned, it opens the page by itself.
            Some(Some(_)) => format!("{published}\n{AWAITING_LOGIN}"),
            None => format!("{published}\n{STILL_OPENING}"),
        });
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
            let option_meta = if q.option_meta.is_empty() {
                vec![]
            } else {
                let mut metas = q.option_meta.into_iter();
                (1..=options.len()).map(|o| option_meta(n, o, metas.next())).collect::<Result<_, _>>()?
            };
            Ok(Question { id: format!("q{n}"), kind: q.kind, title: q.title, options, recommended, option_meta })
        })
        .collect()
}

/// Checks one option's meta (`n`: question, `o`: option, 1-based); over-long descriptions and swatches are cut.
fn option_meta(n: usize, o: usize, meta: Option<InputOptionMeta>) -> Result<OptionMeta, String> {
    let Some(m) = meta else { return Ok(OptionMeta::default()) };
    let at = format!("第 {n} 个问题第 {o} 个选项的 option_meta");
    let hex = |c: &String| c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit());
    if let Some(bad) = m.swatch.iter().take(MAX_SWATCH).find(|c| !hex(c)) {
        return Err(format!("{at}.swatch 不是 6 位色值（如 #0071e3）：{bad}"));
    }
    let image = m.image.map(|i| i.trim().to_string()).filter(|i| !i.is_empty());
    if let Some(i) = &image
        && (i.encode_utf16().count() > MAX_IMAGE
            || !Path::new(i).components().all(|c| matches!(c, std::path::Component::Normal(_))))
    {
        return Err(format!("{at}.image 需要是工作区内的相对路径（不超过 {MAX_IMAGE} 字符）：{i}"));
    }
    Ok(OptionMeta {
        description: m.description.map(|d| clip(d.trim(), MAX_DESCRIPTION)).filter(|d| !d.is_empty()),
        swatch: m.swatch.into_iter().take(MAX_SWATCH).collect(),
        image,
    })
}

/// At most `max` UTF-16 units, like the contract's `max()`.
fn clip(s: &str, max: usize) -> String {
    let mut units = 0;
    s.chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= max
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
            option_meta: vec![],
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
    struct Fake(
        Mutex<Option<oneshot::Sender<String>>>,
        Mutex<Vec<Question>>,
        Option<(String, PathBuf)>,
        Mutex<Vec<String>>,
    );

    impl Asker for Fake {
        fn ask(&self, questions: Vec<Question>) -> Result<(String, oneshot::Receiver<String>), String> {
            let (tx, rx) = oneshot::channel();
            *self.0.lock().unwrap() = Some(tx);
            *self.1.lock().unwrap() = questions;
            Ok(("r1/q1".into(), rx))
        }

        fn abandon(&self, request_id: &str) {
            self.3.lock().unwrap().push(request_id.into());
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
                "list_feishu_messages",
                "preview_expose",
                "preview_gui",
                "preview_close",
                "progress_card",
                "hand_off",
                "schedule_create",
                "schedule_list",
                "schedule_update",
                "schedule_delete",
                "skill_list",
                "skill_get",
                "skill_create",
                "skill_update",
                "skill_delete",
                "skill_toggle",
                "skill_versions",
                "skill_rollback",
                "kb_list",
                "kb_get",
                "kb_search",
                "kb_create",
                "kb_update",
                "kb_delete",
                "tab_list",
                "tab_create",
                "mcp_list",
                "mcp_get",
                "mcp_create",
                "mcp_update",
                "mcp_toggle",
                "mcp_delete",
                "secret_list",
                "secret_request",
                "plugin_catalog",
                "creation_propose",
                "send_attachments",
                "service_start",
                "service_list",
                "service_logs",
                "service_stop",
                "preview_static",
                "client_release_publish",
                "client_release_notes",
                "feishu_send_card",
                "preview_miniprogram"
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

    #[tokio::test]
    async fn abandons_the_question_when_the_agent_hangs_up() {
        let server = AskServer::start(None, services()).await.unwrap();
        let fake = Arc::new(Fake::default());
        let McpServer::Http(entry) = server.register(Arc::downgrade(&fake) as Weak<dyn Asker>) else { panic!() };
        let args = json!({ "questions": [{ "type": "text", "title": "发哪个环境？" }] });
        let call =
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": TOOL, "arguments": args } });
        let http = reqwest::Client::builder().timeout(std::time::Duration::from_millis(200)).build().unwrap();
        assert!(http.post(entry.url.as_str()).json(&call).send().await.is_err());
        let abandoned = async {
            while fake.3.lock().unwrap().is_empty() {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        };
        tokio::time::timeout(std::time::Duration::from_secs(2), abandoned).await.unwrap();
        assert_eq!(*fake.3.lock().unwrap(), ["r1/q1"]);
    }

    /// Answers each request by path: the tool call with `tool`, attachment downloads with their name; records them.
    async fn fake_server(tool: &'static str) -> (String, Arc<Mutex<Vec<String>>>) {
        fake_server_with("200 OK", tool).await
    }

    async fn fake_server_with(status: &'static str, tool: &'static str) -> (String, Arc<Mutex<Vec<String>>>) {
        fake_server_by(move |req| (status, if req.starts_with("POST") { tool } else { "PDF" }.to_string())).await
    }

    /// Reads a whole request: replying before a streamed body is sent breaks the client's pipe under load.
    async fn read_request(socket: &mut tokio::net::TcpStream) -> String {
        use tokio::io::AsyncReadExt;
        let mut buf = vec![];
        let mut chunk = [0u8; 16384];
        loop {
            let n = socket.read(&mut chunk).await.unwrap();
            buf.extend_from_slice(&chunk[..n]);
            if let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&buf[..end]).to_ascii_lowercase();
                let body = &buf[end + 4..];
                let length = head.lines().find_map(|l| l.strip_prefix("content-length:")).map(|v| v.trim().parse());
                let done = match length {
                    Some(len) => body.len() >= len.unwrap(),
                    None => !head.contains("transfer-encoding: chunked") || body.ends_with(b"0\r\n\r\n"),
                };
                if done {
                    return String::from_utf8_lossy(&buf).to_string();
                }
            }
            assert!(n > 0, "connection closed mid-request");
        }
    }

    /// Answers each request with `answer(request)`: its status line and body.
    async fn fake_server_by(
        answer: impl Fn(&str) -> (&'static str, String) + Send + 'static,
    ) -> (String, Arc<Mutex<Vec<String>>>) {
        use tokio::io::AsyncWriteExt;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(vec![]));
        let log = seen.clone();
        tokio::spawn(async move {
            loop {
                let (mut s, _) = listener.accept().await.unwrap();
                let req = read_request(&mut s).await;
                let (status, body) = answer(&req);
                log.lock().unwrap().push(req);
                let res = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                s.write_all(res.as_bytes()).await.unwrap();
            }
        });
        (url, seen)
    }

    fn config(server: String) -> Config {
        Config { server, token: "mt_1".into(), machine_id: "m".into(), owner_name: "王磊".into(), tls_trust: None }
    }

    #[tokio::test]
    async fn uploads_workspace_media_as_chat_attachments() {
        let (base, seen) = fake_server(r#"{"id":"m1","kind":"bot","attachments":[]}"#).await;
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("out")).unwrap();
        std::fs::write(dir.path().join("out/shot.png"), "PNG").unwrap();
        let live =
            Fake(Mutex::default(), Mutex::default(), Some(("r1".into(), dir.path().to_path_buf())), Mutex::default());
        let args = json!({ "paths": ["out/shot.png"], "text": "预览" });

        let text = send_attachments(Some(&config(base)), &live, &args).await.unwrap();
        assert_eq!(text, "已发送 1 个附件到群聊");
        let req = seen.lock().unwrap()[0].clone();
        assert!(req.starts_with("POST /api/daemon/runs/r1/attachments HTTP/1.1"), "{req}");
        assert!(req.to_ascii_lowercase().contains("authorization: bearer mt_1"));
        assert!(req.contains(r#"name="text""#) && req.contains("预览"));
        // Part::file streams its body separately; the integration test below checks the received media bytes.
        assert!(req.contains(r#"name="files"; filename="shot.png""#));

        for path in ["../x", "out", "out/missing.png", "/etc/passwd"] {
            let err = send_attachments(Some(&config("http://x".into())), &live, &json!({ "paths": [path] })).await;
            assert!(err.unwrap_err().contains("必须是工作区内已存在的文件"), "{path}");
        }
        assert_eq!(seen.lock().unwrap().len(), 1);
        assert_eq!(
            send_attachments(Some(&config("http://x".into())), &Fake::default(), &args).await,
            Err(NOT_RUNNING.into())
        );
    }

    #[tokio::test]
    async fn forwards_server_tools_for_the_live_run_and_places_attachments() {
        let res = r##"{"text":"#12 的附件：","isError":false,"attachments":[{"id":"a1","name":"spec.pdf","size":3,"mime":"application/pdf","messageId":"m12"}]}"##;
        let (base, seen) = fake_server(res).await;
        let dir = tempfile::tempdir().unwrap();
        let live =
            Fake(Mutex::default(), Mutex::default(), Some(("r1".into(), dir.path().to_path_buf())), Mutex::default());
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
    async fn uploads_a_release_artifact_of_the_workspace_for_the_live_run() {
        let (base, seen) = fake_server(r#"{"version":"0.3.1","builds":{}}"#).await;
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("dist")).unwrap();
        std::fs::write(dir.path().join("dist/gonggong-0.3.1-macos-aarch64"), "daemon").unwrap();
        let live =
            Fake(Mutex::default(), Mutex::default(), Some(("r1".into(), dir.path().to_path_buf())), Mutex::default());
        let api = config(base);
        let args = json!({ "file": "dist/gonggong-0.3.1-macos-aarch64" });

        let text = publish_release(Some(&api), &live, &args).await.unwrap();
        assert_eq!(text, "已发布 gonggong-0.3.1-macos-aarch64（0.0 MB）到当前空间，当前发布版本 0.3.1");
        let req = seen.lock().unwrap()[0].clone();
        assert!(req.starts_with("POST /api/daemon/runs/r1/release-files HTTP/1.1"), "{req}");
        assert!(req.to_ascii_lowercase().contains("authorization: bearer mt_1"));
        assert!(req.contains(r#"filename="gonggong-0.3.1-macos-aarch64""#) && req.contains("daemon"), "{req}");

        for file in ["../x", "dist", "dist/missing"] {
            let err = publish_release(Some(&api), &live, &json!({ "file": file })).await;
            assert_eq!(err, Err("文件必须是工作区内已存在的文件".into()), "{file}");
        }
        assert_eq!(publish_release(Some(&api), &Fake::default(), &args).await, Err(NOT_RUNNING.into()));
        assert!(is_builtin("mcp__gonggong__preview_static") && !is_builtin("mcp__gonggong__client_release_publish"));
    }

    /// A `release.sh` output dir: artifacts of every kind, the notes, and files that are not uploaded.
    fn release_dir(root: &Path) {
        let dir = root.join("dist/0.3.7");
        std::fs::create_dir_all(dir.join("github")).unwrap();
        for name in [
            "gonggong-0.3.7-macos-aarch64",
            "gg-cast-0.3.7-windows-x86_64.exe",
            "Gonggong_0.3.7_x64-setup.exe",
            "Gonggong_0.3.7_aarch64.app.tar.gz.sig",
            "RELEASE_NOTES.md",
            "SHA256SUMS",
            "manifest.json",
            "gonggong-0.3.7-windows-x86_64",
            ".DS_Store",
            "github/manifest.json",
        ] {
            std::fs::write(dir.join(name), format!("data of {name}")).unwrap();
        }
    }

    fn daemon_release_dir(root: &Path) {
        release_dir(root);
        for prefix in ["gonggong", "gg-cast"] {
            for platform in ["macos-aarch64", "macos-x86_64", "linux-x86_64", "linux-aarch64", "windows-x86_64"] {
                let suffix = if platform.starts_with("windows") { ".exe" } else { "" };
                let name = format!("{prefix}-0.3.7-{platform}{suffix}");
                std::fs::write(root.join("dist/0.3.7").join(&name), format!("data of {name}")).unwrap();
            }
        }
    }

    const RELEASE_ORDER: [&str; 5] = [
        "Gonggong_0.3.7_aarch64.app.tar.gz.sig",
        "Gonggong_0.3.7_x64-setup.exe",
        "gg-cast-0.3.7-windows-x86_64.exe",
        "gonggong-0.3.7-macos-aarch64",
        "RELEASE_NOTES.md",
    ];

    fn uploaded(seen: &Mutex<Vec<String>>) -> Vec<String> {
        let reqs = seen.lock().unwrap();
        reqs.iter().map(|r| r.split_once(r#"filename=""#).unwrap().1.split_once('"').unwrap().0.to_string()).collect()
    }

    fn live_in(dir: &Path) -> Fake {
        Fake(Mutex::default(), Mutex::default(), Some(("r1".into(), dir.to_path_buf())), Mutex::default())
    }

    #[tokio::test]
    async fn uploads_a_dir_with_four_parallel_artifacts_and_the_notes_last() {
        let (base, seen) = fake_server(r#"{"version":"0.3.7","builds":{}}"#).await;
        let dir = tempfile::tempdir().unwrap();
        release_dir(dir.path());

        let text =
            publish_release(Some(&config(base)), &live_in(dir.path()), &json!({ "dir": "dist/0.3.7" })).await.unwrap();
        assert_eq!(text, "已发布 dist/0.3.7 中的 5 个文件（共 0.0 MB）到当前空间，当前发布版本 0.3.7");
        let uploaded = uploaded(&seen);
        assert_eq!(uploaded.last().map(String::as_str), Some(RELEASE_NOTES));
        let mut artifacts = uploaded[..uploaded.len() - 1].to_vec();
        artifacts.sort();
        assert_eq!(artifacts, RELEASE_ORDER[..RELEASE_ORDER.len() - 1]);
        let reqs = seen.lock().unwrap().clone();
        assert!(reqs.iter().all(|r| r.starts_with("POST /api/daemon/runs/r1/release-files HTTP/1.1")));
        assert!(reqs.iter().any(|r| r.contains("data of gonggong-0.3.7-macos-aarch64")));
    }

    #[tokio::test]
    async fn publishes_only_complete_daemon_artifacts_with_at_most_four_parallel_uploads() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use tokio::io::AsyncWriteExt;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(vec![]));
        let peak = Arc::new(AtomicUsize::new(0));
        let active = Arc::new(AtomicUsize::new(0));
        tokio::spawn({
            let (seen, peak, active) = (seen.clone(), peak.clone(), active.clone());
            async move {
                loop {
                    let (mut socket, _) = listener.accept().await.unwrap();
                    let (seen, peak, active) = (seen.clone(), peak.clone(), active.clone());
                    tokio::spawn(async move {
                        let req = read_request(&mut socket).await;
                        seen.lock().unwrap().push(req);
                        let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(current, Ordering::SeqCst);
                        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
                        let body = r#"{"version":"0.3.7","builds":{}}"#;
                        let res = format!(
                            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                            body.len()
                        );
                        socket.write_all(res.as_bytes()).await.unwrap();
                        active.fetch_sub(1, Ordering::SeqCst);
                    });
                }
            }
        });
        let dir = tempfile::tempdir().unwrap();
        daemon_release_dir(dir.path());

        let text = publish_release(
            Some(&config(base)),
            &live_in(dir.path()),
            &json!({ "dir": "dist/0.3.7", "kind": "daemon" }),
        )
        .await
        .unwrap();

        assert!(text.starts_with("已发布 dist/0.3.7 中的 11 个文件"), "{text}");
        let uploaded = uploaded(&seen);
        assert_eq!(uploaded.len(), 11);
        assert_eq!(uploaded.last().map(String::as_str), Some(RELEASE_NOTES));
        assert!(!uploaded.iter().any(|name| name.starts_with("Gonggong_")));
        assert_eq!(peak.load(Ordering::SeqCst), 4);
    }

    #[tokio::test]
    async fn refuses_incomplete_or_mixed_version_daemon_releases_before_uploading() {
        let (base, seen) = fake_server(r#"{"version":"0.3.7","builds":{}}"#).await;
        let dir = tempfile::tempdir().unwrap();
        release_dir(dir.path());
        let (api, live) = (config(base), live_in(dir.path()));
        let args = json!({ "dir": "dist/0.3.7", "kind": "daemon" });

        let err = publish_release(Some(&api), &live, &args).await.unwrap_err();
        assert!(err.contains("daemon 快速发布缺少"), "{err}");
        daemon_release_dir(dir.path());
        let mixed = dir.path().join("dist/0.3.7/gg-cast-0.3.7-linux-x86_64");
        std::fs::remove_file(&mixed).unwrap();
        std::fs::write(dir.path().join("dist/0.3.7/gg-cast-0.3.8-linux-x86_64"), "other").unwrap();
        let err = publish_release(Some(&api), &live, &args).await.unwrap_err();
        assert_eq!(err, "daemon 快速发布目录中的产物版本不一致");
        assert!(seen.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn passes_on_the_servers_warning_after_a_dir_without_notes() {
        let (base, _) =
            fake_server(r#"{"version":"0.3.7","builds":{},"warning":"未提供版本说明，请补充 RELEASE_NOTES.md"}"#).await;
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("out")).unwrap();
        std::fs::write(dir.path().join("out/gonggong-0.3.7-linux-x86_64"), "x").unwrap();
        let text = publish_release(Some(&config(base)), &live_in(dir.path()), &json!({ "dir": "out" })).await.unwrap();
        assert_eq!(
            text,
            "已发布 out 中的 1 个文件（共 0.0 MB）到当前空间，当前发布版本 0.3.7\n未提供版本说明，请补充 RELEASE_NOTES.md"
        );
    }

    #[tokio::test]
    async fn waits_for_in_flight_uploads_and_keeps_parallel_dir_failures_retryable() {
        let (base, seen) = fake_server_by(|req| {
            if req.contains("gg-cast-") {
                ("400 Bad Request", r#"{"error":"invalid","message":"版本低于当前发布的 0.3.8"}"#.into())
            } else {
                ("200 OK", r#"{"version":"0.3.7","builds":{}}"#.into())
            }
        })
        .await;
        let dir = tempfile::tempdir().unwrap();
        release_dir(dir.path());

        let err = publish_release(Some(&config(base)), &live_in(dir.path()), &json!({ "dir": "dist/0.3.7" }))
            .await
            .unwrap_err();
        assert!(err.contains("服务器拒绝了 gg-cast-0.3.7-windows-x86_64.exe：版本低于当前发布的 0.3.8"), "{err}");
        assert!(err.contains("未发布 2 个文件：gg-cast-0.3.7-windows-x86_64.exe、RELEASE_NOTES.md"), "{err}");
        assert!(err.contains("已上传 3 个文件；可直接重试同一目录"), "{err}");
        let uploaded = uploaded(&seen);
        assert_eq!(uploaded.len(), 4);
        assert!(!uploaded.iter().any(|name| name == RELEASE_NOTES));
    }

    #[tokio::test]
    async fn refuses_a_release_dir_outside_the_workspace_or_without_artifacts() {
        let (base, seen) = fake_server(r#"{"version":"0.3.7","builds":{}}"#).await;
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        release_dir(dir.path());
        std::fs::write(outside.path().join("gonggong-0.3.7-linux-x86_64"), "x").unwrap();
        std::fs::create_dir_all(dir.path().join("linked")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            outside.path().join("gonggong-0.3.7-linux-x86_64"),
            dir.path().join("linked/gonggong-0.3.7-linux-x86_64"),
        )
        .unwrap();
        let (api, live) = (config(base), live_in(dir.path()));

        let outside_dir = outside.path().to_string_lossy().to_string();
        for d in ["..", "../..", outside_dir.as_str(), "dist/missing", "dist/0.3.7/SHA256SUMS"] {
            let err = publish_release(Some(&api), &live, &json!({ "dir": d })).await;
            assert_eq!(err, Err("目录必须是工作区内已存在的相对目录".into()), "{d}");
        }
        for d in ["dist/0.3.7/github", "linked"] {
            let err = publish_release(Some(&api), &live, &json!({ "dir": d })).await;
            assert_eq!(err, Err(format!("{d} 里没有可发布的产物")), "{d}");
        }
        for args in [json!({ "dir": "dist/0.3.7", "file": "dist/0.3.7/RELEASE_NOTES.md" }), json!({})] {
            let err = publish_release(Some(&api), &live, &args).await;
            assert_eq!(err, Err("参数无效：file 与 dir 需要且只能给一个".into()), "{args}");
        }
        assert!(seen.lock().unwrap().is_empty());
    }

    #[test]
    fn shows_the_owner_which_release_files_one_approval_publishes() {
        let dir = tempfile::tempdir().unwrap();
        release_dir(dir.path());
        let title = "mcp__gonggong__client_release_publish";
        let detail = |raw: Value| release_approval(title, Some(&raw), dir.path());
        let all = Some(format!("发布 dist/0.3.7 中的 5 个文件：{}", RELEASE_ORDER.join("、")));
        assert_eq!(detail(json!({ "dir": "dist/0.3.7" })), all);
        let codex =
            json!({ "server": "gonggong", "tool": "client_release_publish", "arguments": { "dir": "dist/0.3.7" } });
        assert_eq!(release_approval("mcp.gonggong.client_release_publish", Some(&codex), dir.path()), all);
        assert_eq!(
            detail(json!({ "file": "dist/0.3.7/gonggong-0.3.7-macos-aarch64" })),
            Some("发布 dist/0.3.7/gonggong-0.3.7-macos-aarch64".into())
        );

        std::fs::create_dir_all(dir.path().join("many")).unwrap();
        for n in 10..35 {
            std::fs::write(dir.path().join(format!("many/gonggong-0.3.{n}-linux-x86_64")), "x").unwrap();
        }
        let many = detail(json!({ "dir": "many" })).unwrap();
        assert!(many.starts_with("发布 many 中的 25 个文件：gonggong-0.3.10-linux-x86_64、"), "{many}");
        assert!(many.ends_with(" 等 25 个"), "{many}");
        assert_eq!(many.matches("gonggong-").count(), APPROVAL_NAMES);

        daemon_release_dir(dir.path());
        let daemon = detail(json!({ "dir": "dist/0.3.7", "kind": "daemon" })).unwrap();
        assert!(daemon.starts_with("发布 dist/0.3.7 中的 11 个文件："), "{daemon}");
        assert!(!daemon.contains("Gonggong_"), "{daemon}");

        assert_eq!(detail(json!({ "dir": ".." })), None);
        assert_eq!(detail(json!({})), None);
        let other =
            release_approval("mcp__gonggong__preview_static", Some(&json!({ "dir": "dist/0.3.7" })), dir.path());
        assert_eq!(other, None);
    }

    #[test]
    fn recognizes_release_artifacts_like_the_server() {
        for name in [
            "gonggong-0.3.7-macos-aarch64",
            "gonggong-0.3.7-macos-x86_64",
            "gonggong-0.3.7-linux-aarch64",
            "gonggong-0.3.7-windows-x86_64.exe",
            "gg-cast-0.3.7-linux-x86_64",
            "Gonggong_0.3.7_aarch64.dmg",
            "Gonggong_0.3.7_x86_64.dmg",
            "Gonggong_0.3.7_x64-setup.exe",
            "Gonggong_0.3.7_x64-setup.exe.sig",
            "Gonggong_0.3.7_x86_64.app.tar.gz",
            "Gonggong_0.3.7_aarch64.app.tar.gz.sig",
            "RELEASE_NOTES.md",
        ] {
            assert!(is_release_file(name), "{name}");
        }
        for name in [
            "SHA256SUMS",
            "manifest.json",
            "latest.json",
            "gonggong-0.3.7-windows-x86_64",
            "gonggong-0.3.7-linux-x86_64.exe",
            "gonggong-0.3-linux-x86_64",
            "gonggong-0.3.7-windows-aarch64.exe",
            "Gonggong_0.3.7_x64.dmg",
            "Gonggong_0.3.7_aarch64.dmg.sig",
            "release_notes.md",
        ] {
            assert!(!is_release_file(name), "{name}");
        }
    }

    #[tokio::test]
    async fn updates_release_notes_for_the_live_run() {
        let (base, seen) = fake_server(r###"{"version":"0.3.1","releaseNotes":"## 0.3.1"}"###).await;
        let dir = tempfile::tempdir().unwrap();
        let live =
            Fake(Mutex::default(), Mutex::default(), Some(("r1".into(), dir.path().to_path_buf())), Mutex::default());
        let api = config(base);
        let args = json!({ "version": "0.3.1", "releaseNotes": "## 0.3.1\n\n- 修复" });

        let text = update_release_notes(Some(&api), &live, &args).await.unwrap();
        assert_eq!(text, "已更新 0.3.1 的版本说明（14 字）");
        let req = seen.lock().unwrap()[0].clone();
        assert!(req.starts_with("POST /api/daemon/runs/r1/release-notes HTTP/1.1"), "{req}");
        assert!(req.to_ascii_lowercase().contains("authorization: bearer mt_1"));
        assert!(req.contains(r###""releaseNotes":"## 0.3.1\n\n- 修复""###), "{req}");
        assert!(req.contains(r###""version":"0.3.1""###), "{req}");
        assert_eq!(
            update_release_notes(Some(&api), &live, &json!({ "version": "0.3.1", "releaseNotes": " " })).await,
            Err("版本说明不能为空".into())
        );
        assert_eq!(update_release_notes(Some(&api), &Fake::default(), &args).await, Err(NOT_RUNNING.into()));
        assert!(is_builtin("mcp__gonggong__client_release_notes"));
    }

    #[tokio::test]
    async fn sends_a_feishu_card_with_its_workspace_images_for_the_live_run() {
        let (base, seen) = fake_server(r#"{"chat":"研发群"}"#).await;
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("out")).unwrap();
        std::fs::write(dir.path().join("out/chart.png"), "PNGDATA").unwrap();
        let live =
            Fake(Mutex::default(), Mutex::default(), Some(("r1".into(), dir.path().to_path_buf())), Mutex::default());
        let api = config(base);
        let card = json!({ "schema": "2.0", "body": { "elements": [{ "tag": "img", "img_key": "chart" }] } });
        let args = json!({ "card": card, "images": { "chart": "out/chart.png" } });

        let text = send_feishu_card(Some(&api), &live, &args).await.unwrap();
        assert_eq!(text, "已发送飞书卡片到飞书群「研发群」");
        let req = seen.lock().unwrap()[0].clone();
        assert!(req.starts_with("POST /api/daemon/runs/r1/feishu-card HTTP/1.1"), "{req}");
        assert!(req.to_ascii_lowercase().contains("authorization: bearer mt_1"));
        assert!(req.contains(r#"name="card""#) && req.contains(&card.to_string()), "{req}");
        assert!(req.contains(r#"name="image.chart"; filename="chart.png""#) && req.contains("PNGDATA"), "{req}");

        for file in ["../x.png", "out", "out/missing.png"] {
            let args = json!({ "card": card, "images": { "chart": file } });
            let err = send_feishu_card(Some(&api), &live, &args).await;
            assert_eq!(err, Err(format!("图片 {file} 必须是工作区内已存在的文件")), "{file}");
        }
        let refusal = r#"{"error":"conflict","message":"本群未绑定飞书群，无法发送飞书卡片"}"#;
        let (base, _) = fake_server_with("409 Conflict", refusal).await;
        let err = send_feishu_card(Some(&config(base)), &live, &json!({ "card": card })).await;
        assert_eq!(err, Err("飞书卡片未发送：本群未绑定飞书群，无法发送飞书卡片".into()));
        assert_eq!(send_feishu_card(Some(&api), &Fake::default(), &args).await, Err(NOT_RUNNING.into()));
        assert!(is_builtin("mcp__gonggong__feishu_send_card"));
    }

    #[tokio::test(start_paused = true)]
    async fn gives_up_on_a_server_tool_that_does_not_answer_within_the_agents_minute() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let (s, _) = listener.accept().await.unwrap();
            std::future::pending::<()>().await;
            drop(s);
        });
        let dir = tempfile::tempdir().unwrap();
        let live =
            Fake(Mutex::default(), Mutex::default(), Some(("r1".into(), dir.path().to_path_buf())), Mutex::default());
        let started = tokio::time::Instant::now();
        let err = forward(Some(&config(base)), &live, "list_messages", &json!({})).await.unwrap_err();
        assert!(err.starts_with("查询失败"), "{err}");
        assert!(started.elapsed() <= FORWARD_TIMEOUT, "{:?}", started.elapsed());
    }

    #[tokio::test]
    async fn answers_hosted_service_tools_for_the_live_run() {
        let server = AskServer::start(None, services()).await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let live = Arc::new(Fake(
            Mutex::default(),
            Mutex::default(),
            Some(("r1".into(), dir.path().to_path_buf())),
            Mutex::default(),
        ));
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
        let live =
            Fake(Mutex::default(), Mutex::default(), Some(("r1".into(), dir.path().to_path_buf())), Mutex::default());
        let services = services();
        let args = json!({ "dir": "out/report", "title": "报告" });
        let backends = Backends {
            api: Arc::new(Some(config(base))),
            services: services.clone(),
            devtools: crate::wechatide::devtools(),
        };
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

    #[tokio::test]
    async fn opens_a_mini_program_on_its_page_and_publishes_it_through_preview_expose() {
        let (base, seen) = fake_server(r#"{"text":"已发布预览「商城」","isError":false,"attachments":[]}"#).await;
        let (calls, devtools, _data) = crate::wechatide::fake::install(crate::wechatide::fake::standard()).await;
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("mp")).unwrap();
        std::fs::write(dir.path().join("mp/project.config.json"), "{}").unwrap();
        let project = dir.path().join("mp").canonicalize().unwrap().to_string_lossy().to_string();
        let live =
            Fake(Mutex::default(), Mutex::default(), Some(("r1".into(), dir.path().to_path_buf())), Mutex::default());
        let backends = Backends { api: Arc::new(Some(config(base))), services: services(), devtools };

        let args = json!({ "dir": "mp", "page": "pages/goods/detail", "query": "id=42", "title": "商城" });
        assert_eq!(hosted(&backends, &live, "preview_miniprogram", &args).await.unwrap(), "已发布预览「商城」");
        let tools: Vec<(String, Value)> =
            calls.lock().unwrap().iter().filter(|c| c.0 != "initialize").cloned().collect();
        let window = ("open_project_window".to_string(), json!({ "project": project, "windowMode": "liteMode" }));
        assert!(tools.contains(&window), "{tools:?}");
        let url = "/pages/goods/detail?id=42";
        let navigate =
            ("automation_navigate".to_string(), json!({ "project": project, "action": "reLaunch", "url": url }));
        assert!(tools.contains(&navigate), "{tools:?}");
        let req = seen.lock().unwrap()[0].clone();
        assert!(req.starts_with("POST /api/daemon/runs/r1/tools/preview_expose HTTP/1.1"), "{req}");
        let body: Value = serde_json::from_str(req.split_once("\r\n\r\n").unwrap().1).unwrap();
        let expose = json!({ "miniprogram": project, "path": "/pages/goods/detail?id=42", "title": "商城" });
        assert_eq!(body["arguments"], expose);

        // Refused before the devtools are touched: outside the workspace, or not a mini program project.
        let touched = calls.lock().unwrap().len();
        let outside = hosted(&backends, &live, "preview_miniprogram", &json!({ "dir": "..", "title": "x" })).await;
        assert_eq!(outside.unwrap_err(), "目录必须是工作区内已存在的相对目录");
        let plain = hosted(&backends, &live, "preview_miniprogram", &json!({ "title": "x" })).await;
        assert!(plain.unwrap_err().contains("不是小程序项目"));
        assert_eq!(calls.lock().unwrap().len(), touched);
    }

    #[tokio::test]
    async fn publishes_the_card_at_once_when_the_devtools_first_need_a_login() {
        let (base, seen) = fake_server(r#"{"text":"已发布预览「商城」","isError":false,"attachments":[]}"#).await;
        let world = crate::wechatide::fake::World {
            trusted: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            ..Default::default()
        };
        let (calls, devtools, _data) = crate::wechatide::fake::install(crate::wechatide::fake::answering(world)).await;
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("project.config.json"), "{}").unwrap();
        let live =
            Fake(Mutex::default(), Mutex::default(), Some(("r1".into(), dir.path().to_path_buf())), Mutex::default());
        let backends = Backends { api: Arc::new(Some(config(base))), services: services(), devtools };

        let text = hosted(&backends, &live, "preview_miniprogram", &json!({ "title": "商城" })).await.unwrap();
        assert_eq!(text, format!("已发布预览「商城」\n{AWAITING_LOGIN}"));
        assert!(seen.lock().unwrap()[0].starts_with("POST /api/daemon/runs/r1/tools/preview_expose"));
        assert!(calls.lock().unwrap().iter().any(|c| c.0 == "login"));
    }

    #[tokio::test]
    async fn publishes_the_card_within_the_agents_tool_timeout_while_the_devtools_are_still_opening() {
        let (base, seen) = fake_server(r#"{"text":"已发布预览「商城」","isError":false,"attachments":[]}"#).await;
        // Opening a window that never shows, like a first compile or a launch taking minutes.
        let standard = crate::wechatide::fake::standard();
        let slow: crate::wechatide::fake::Reply =
            Box::new(move |key, args| if key == "open_project_window" { Value::Null } else { standard(key, args) });
        let (_, devtools, _data) = crate::wechatide::fake::install(slow).await;
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("project.config.json"), "{}").unwrap();
        let live =
            Fake(Mutex::default(), Mutex::default(), Some(("r1".into(), dir.path().to_path_buf())), Mutex::default());
        let backends = Backends { api: Arc::new(Some(config(base))), services: services(), devtools };

        let started = std::time::Instant::now();
        let text = hosted(&backends, &live, "preview_miniprogram", &json!({ "title": "商城" })).await.unwrap();
        assert!(started.elapsed() < TOOL_BUDGET * 2, "{:?}", started.elapsed());
        assert_eq!(text, format!("已发布预览「商城」\n{STILL_OPENING}"));
        assert!(seen.lock().unwrap()[0].starts_with("POST /api/daemon/runs/r1/tools/preview_expose"));
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
        assert!(is_builtin("mcp__gonggong__skill_create"), "the server checks the run's originator is an admin");
        assert!(!is_builtin("mcp__gonggong__service_start"), "runs a command: the owner decides");
        assert!(!is_builtin("mcp__gonggong__preview_miniprogram"), "runs the project's code in the simulator");
        assert!(!is_builtin("mcp__wiki__list_messages"));
        assert!(!is_builtin("Bash"));
    }
}
