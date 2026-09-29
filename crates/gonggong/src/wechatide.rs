//! WeChat devtools (微信开发者工具) through the MCP server it serves on loopback (plan 结果预览 §13): opens a mini
//! program project on a page and screenshots its simulator.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Map, Value, json};

#[cfg(target_os = "macos")]
mod ax;

/// Shown in the devtools' authorization dialog and its list of authorized clients.
const CLIENT: &str = "Gonggong";
const HEARTBEAT: Duration = Duration::from_secs(3);
/// A session starts within a second or two.
#[cfg(not(test))]
const INIT: Duration = Duration::from_secs(10);
#[cfg(test)]
const INIT: Duration = Duration::from_millis(500);
/// Opening a project compiles it first.
const CALL: Duration = Duration::from_secs(120);
/// How long an app may take to start (it compiles) or show a page, and how often to look.
#[cfg(not(test))]
const SETTLE: Duration = Duration::from_secs(60);
#[cfg(test)]
const SETTLE: Duration = Duration::from_secs(1);
/// A page query answers within a second, or about three while a just-opened app starts; while the app is not up at
/// all (the devtools may be asking whether to trust the project) it hangs, so each one gets this long.
#[cfg(not(test))]
const PROBE: Duration = Duration::from_secs(3);
#[cfg(test)]
const PROBE: Duration = Duration::from_millis(300);
const POLL: Duration = Duration::from_millis(300);
const ATTEMPTS: u32 = 3;
/// How long launched devtools may take to serve their port.
#[cfg(not(test))]
const LAUNCH: Duration = Duration::from_secs(60);
#[cfg(test)]
const LAUNCH: Duration = Duration::from_secs(3);
/// Why an opened project's app may never start: the devtools ask whether to trust the author of a project opened
/// the first time (MCP skips that only with the setting below or a CLI access token), or its compile failed.
const NOT_UP: &str = "小程序没有在模拟器里运行起来。如果微信开发者工具弹出「您信任此项目的作者吗？」：gonggong 会代为点击「信任并运行」，\
但运行 gg 的程序需要在「系统设置 → 隐私与安全性 → 辅助功能」里获得授权；也可以由机器主人手动点一次（每个项目只需一次），\
或在开发者工具「设置 → 安全」开启「自动化接口打开工具时默认信任项目」。否则请查看开发者工具的编译输出。然后重试。";

/// Seconds the simulator renders a page that just showed before it is captured.
const RENDER_WAIT: f64 = 1.0;
#[cfg(target_os = "macos")]
const CLI: &str = "/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide";

/// Answers the devtools' trust prompt for a project it opens; whether it could. Runs blocking (UI automation).
pub type Trust = Arc<dyn Fn(&Path) -> bool + Send + Sync>;

#[derive(Debug, PartialEq)]
pub enum Error {
    /// No devtools answers: not installed, not running, or its service port is off.
    NotRunning,
    /// This client is not authorized yet (or a CLI access token is required).
    Unauthorized,
    /// The session is gone: the devtools restarted (maybe on another port).
    Gone,
    /// Nobody is logged in to the devtools: the login QR code (JPEG) to scan.
    NeedsLogin(Vec<u8>),
    Failed(String),
}

/// A failed call: worth another try, or final.
enum Failure {
    Hiccup(String),
    Other(Error),
}
use Failure::{Hiccup, Other};

impl From<Error> for Failure {
    fn from(e: Error) -> Self {
        Other(e)
    }
}

pub struct Devtools {
    http: reqwest::Client,
    url: String,
    session: String,
    trust: Trust,
    /// The login code being shown (task id, JPEG): it stays valid until scanned or expired.
    login: std::sync::Mutex<Option<(String, Vec<u8>)>>,
}

impl Devtools {
    /// The running devtools whose `.ide` port file lies under one of `roots` (`<root>/<hash>/Default/.ide`).
    pub async fn connect_in(roots: &[PathBuf]) -> Result<Self, Error> {
        let http = reqwest::Client::builder().no_proxy().build().map_err(|e| Error::Failed(e.to_string()))?;
        for port in ports(roots) {
            let alive = http
                .get(format!("http://127.0.0.1:{port}/mcp/heartbeat"))
                .timeout(HEARTBEAT)
                .send()
                .await
                .is_ok_and(|r| r.status().is_success());
            if alive {
                return Self::start(http, format!("http://127.0.0.1:{port}/mcp")).await;
            }
        }
        Err(Error::NotRunning)
    }

    async fn start(http: reqwest::Client, url: String) -> Result<Self, Error> {
        let init = json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {
            "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": { "name": CLIENT, "version": "1.0.0" } } });
        let res = post(&http, &url, None, &init, INIT).await?;
        let session = res.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
        rpc_result(res).await?;
        let ide = Self { http, url, session, trust: Arc::new(|_: &Path| false), login: Default::default() };
        post(
            &ide.http,
            &ide.url,
            Some(&ide.session),
            &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
            INIT,
        )
        .await?;
        Ok(ide)
    }

    /// Calls a devtools tool; its structured result, or the reason it failed. What the devtools fail on their own
    /// (their AppID check over a flaky network, an automator timeout) is retried a few times: our calls are idempotent.
    pub async fn call(&self, tool: &str, args: Value) -> Result<Value, Error> {
        self.call_within(tool, args, CALL).await
    }

    async fn call_within(&self, tool: &str, args: Value, timeout: Duration) -> Result<Value, Error> {
        let mut attempt = 1;
        loop {
            match self.call_once(tool, &args, timeout).await {
                Err(Hiccup(reason)) if attempt < ATTEMPTS => {
                    tracing::debug!(tool, attempt, reason, "devtools hiccup, retrying");
                    attempt += 1;
                    tokio::time::sleep(POLL).await;
                }
                Err(Hiccup(reason)) => return Err(Error::Failed(reason)),
                Err(Other(e)) => return Err(e),
                Ok(v) => return Ok(v),
            }
        }
    }

    async fn call_once(&self, tool: &str, args: &Value, timeout: Duration) -> Result<Value, Failure> {
        let req =
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": tool, "arguments": args } });
        let result = rpc_result(post(&self.http, &self.url, Some(&self.session), &req, timeout).await?).await?;
        let text = result["content"][0]["text"].as_str().unwrap_or_default();
        if result["isError"] == true {
            return Err(Other(Error::Failed(if text.is_empty() { format!("{tool} 失败") } else { text.into() })));
        }
        let value = match result.get("structuredContent") {
            Some(v) => v.clone(),
            None => serde_json::from_str(text).unwrap_or(Value::Null),
        };
        if value["success"] == false {
            let reason = value["message"].as_str().or(value["error"].as_str()).unwrap_or(text).to_string();
            // Logged out, the devtools report an AppID error too: that one is for a login, not another try.
            let hiccup = (value["code"] == "APPID_ERROR" && !reason.contains("登录")) || reason.contains("timeout");
            return Err(if hiccup { Hiccup(reason) } else { Other(Error::Failed(reason)) });
        }
        Ok(value)
    }

    /// Opens `project` in a simulator-only window, on `page` (`pages/x?y=1`) when given; returns once it shows.
    pub async fn open(&self, project: &Path, page: Option<&str>) -> Result<(), Error> {
        let project = project.to_string_lossy();
        let (current, _) = self.ensure(&project).await?;
        match page.filter(|p| !showing(&current, p)) {
            Some(page) => self.go(&project, page).await,
            None => Ok(()),
        }
    }

    /// The page `project` shows, opening its window first unless its app already runs (reopening a window slows the
    /// devtools' next automation call down to seconds); whether it was just opened.
    async fn ensure(&self, project: &str) -> Result<(Value, bool), Error> {
        // While a login code is shown, only its task is polled: each page query then logs the devtools out again,
        // which a login completing meanwhile may not survive.
        let awaiting_login = self.login.lock().unwrap().is_some();
        if !awaiting_login && let Ok(current) = self.current(project).await {
            return Ok((current, false));
        }
        if let Some(qr) = self.login_code().await? {
            return Err(Error::NeedsLogin(qr));
        }
        if awaiting_login && let Ok(current) = self.current(project).await {
            return Ok((current, false));
        }
        self.call("open_project_window", json!({ "project": project, "windowMode": "liteMode" })).await?;
        Ok((self.settle(project, None).await?, true))
    }

    /// The login code to show while nobody is logged in: the pending one until it is scanned or expires.
    async fn login_code(&self) -> Result<Option<Vec<u8>>, Error> {
        let pending = self.login.lock().unwrap().clone();
        if let Some((task, qr)) = pending {
            let result = self.call("polling_task_result", json!({ "taskId": task })).await?;
            match result["status"].as_str() {
                Some("pending") => return Ok(Some(qr)),
                Some("success") => {
                    *self.login.lock().unwrap() = None;
                    return Ok(None);
                }
                // Expired, or cancelled because someone logged in another way (the devtools' window, the CLI).
                _ => *self.login.lock().unwrap() = None,
            }
        }
        let status = self.call("check_wechatide_status", json!({})).await?;
        if status["loginExpired"] != true {
            return Ok(None);
        }
        let req = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": { "name": "login", "arguments": { "type": "image" } } });
        let result = rpc_result(post(&self.http, &self.url, Some(&self.session), &req, CALL).await?).await?;
        let task =
            result["structuredContent"]["taskId"].as_str().ok_or(Error::Failed("登录请求没有返回任务".into()))?;
        let image = result["content"].as_array().into_iter().flatten().find(|c| c["type"] == "image");
        use base64::Engine;
        let qr = image
            .and_then(|c| c["data"].as_str())
            .and_then(|d| base64::engine::general_purpose::STANDARD.decode(d).ok())
            .ok_or(Error::Failed("登录请求没有返回二维码".into()))?;
        *self.login.lock().unwrap() = Some((task.to_string(), qr.clone()));
        Ok(Some(qr))
    }

    async fn current(&self, project: &str) -> Result<Value, Error> {
        let args = json!({ "project": project, "action": "currentPage" });
        let info = self.call_within("automation_runtime_info", args, PROBE).await?;
        Ok(info["currentPage"].clone())
    }

    /// Relaunches the running app on `page`: unlike opening a page from the toolbar, no recompile.
    async fn go(&self, project: &str, page: &str) -> Result<(), Error> {
        let url = format!("/{page}");
        self.call("automation_navigate", json!({ "project": project, "action": "reLaunch", "url": url })).await?;
        self.settle(project, Some(page)).await.map(|_| ())
    }

    /// Waits for `page` to show (any page when None: the app runs) and returns the page showing. While the app is not
    /// up, the devtools may be asking whether to trust the project: that is answered (the tool call was approved).
    async fn settle(&self, project: &str, page: Option<&str>) -> Result<Value, Error> {
        let deadline = std::time::Instant::now() + SETTLE;
        loop {
            match self.current(project).await {
                Ok(current) if current["path"].is_string() && page.is_none_or(|p| showing(&current, p)) => {
                    return Ok(current);
                }
                Ok(_) => {}
                Err(_) => {
                    let (trust, path) = (self.trust.clone(), PathBuf::from(project));
                    if tokio::task::spawn_blocking(move || trust(&path)).await.unwrap_or(false) {
                        tracing::info!(project, "answered the devtools' trust prompt");
                    }
                }
            }
            if std::time::Instant::now() > deadline {
                return Err(Error::Failed(match page {
                    Some(page) => format!("模拟器没有打开页面 {page}"),
                    None => NOT_UP.into(),
                }));
            }
            tokio::time::sleep(POLL).await;
        }
    }

    /// The simulator of `project` on `page` (`/pages/x?y=1`, `/` for the current one) as a JPEG. Opens the project
    /// and moves to the page only when needed: each devtools call takes a second or more.
    pub async fn screenshot(&self, project: &Path, page: &str) -> Result<Vec<u8>, Error> {
        let (project, page) = (project.to_string_lossy(), page.trim_start_matches('/'));
        let wanted = (!page.is_empty()).then_some(page);
        let (current, mut fresh) = self.ensure(&project).await?;
        if let Some(wanted) = wanted.filter(|w| !showing(&current, w)) {
            self.go(&project, wanted).await?;
            fresh = true;
        }
        let file = std::env::temp_dir().join(format!("gg-miniprogram-{}.jpg", uuid::Uuid::new_v4()));
        let mut args = json!({ "project": project, "path": file.to_string_lossy() });
        if fresh {
            args["wait"] = json!(RENDER_WAIT);
        }
        let shot = self.call("simulator_screenshot", args).await;
        let bytes = std::fs::read(&file);
        let _ = std::fs::remove_file(&file);
        shot?;
        bytes.map_err(|e| Error::Failed(format!("读取截图失败：{e}")))
    }
}

/// Whether the simulator's `current` page (`{path, query}`) is `wanted` (`pages/x?y=1`).
fn showing(current: &Value, wanted: &str) -> bool {
    let (path, query) = wanted.split_once('?').unwrap_or((wanted, ""));
    let query: Map<String, Value> = query
        .split('&')
        .filter_map(|kv| kv.split_once('=').or((!kv.is_empty()).then_some((kv, ""))))
        .map(|(k, v)| (k.to_string(), json!(v)))
        .collect();
    current["path"] == path && current["query"].as_object().is_none_or(|q| *q == query)
}

/// Ports from `.ide` files under `roots`, newest file first (an old install may leave a stale one).
fn ports(roots: &[PathBuf]) -> Vec<u16> {
    let mut found: Vec<(std::time::SystemTime, u16)> = roots
        .iter()
        .filter_map(|r| std::fs::read_dir(r).ok())
        .flatten()
        .filter_map(|e| {
            let file = e.ok()?.path().join("Default").join(".ide");
            let port = std::fs::read_to_string(&file).ok()?.trim().parse().ok()?;
            Some((std::fs::metadata(&file).ok()?.modified().ok()?, port))
        })
        .collect();
    found.sort_by_key(|f| std::cmp::Reverse(f.0));
    found.into_iter().map(|(_, p)| p).collect()
}

async fn post(
    http: &reqwest::Client,
    url: &str,
    session: Option<&str>,
    body: &Value,
    timeout: Duration,
) -> Result<reqwest::Response, Error> {
    let mut req = http.post(url).timeout(timeout).header("accept", "application/json, text/event-stream").json(body);
    if let Some(s) = session.filter(|s| !s.is_empty()) {
        req = req.header("mcp-session-id", s);
    }
    let res = req.send().await.map_err(|e| {
        if e.is_timeout() {
            Error::Failed(format!("微信开发者工具 {} 秒内没有响应", timeout.as_secs()))
        } else {
            Error::Gone
        }
    })?;
    match res.status().as_u16() {
        401 | 403 => Err(Error::Unauthorized),
        400 | 404 => Err(Error::Gone),
        s if s >= 400 => Err(Error::Failed(format!("微信开发者工具返回 {s}"))),
        _ => Ok(res),
    }
}

/// The JSON-RPC result of a plain JSON or single-event SSE response.
async fn rpc_result(res: reqwest::Response) -> Result<Value, Error> {
    let body = res.text().await.map_err(|e| Error::Failed(e.to_string()))?;
    let data = body.lines().filter_map(|l| l.strip_prefix("data:")).next_back().unwrap_or(&body);
    let msg: Value = serde_json::from_str(data.trim()).map_err(|_| Error::Failed(format!("无法解析的响应：{body}")))?;
    if let Some(e) = msg.get("error") {
        return Err(Error::Failed(e["message"].as_str().unwrap_or("调用失败").into()));
    }
    Ok(msg["result"].clone())
}

/// Where each devtools install keeps its user data.
fn data_roots() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support/微信开发者工具"));
    #[cfg(windows)]
    let base =
        std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(r"AppData\Local\微信开发者工具\User Data"));
    #[cfg(not(any(target_os = "macos", windows)))]
    let base: Option<PathBuf> = None;
    base.into_iter().collect()
}

/// Runs `$call` with `$ide` bound to the shared session's devtools, connecting (again, once, when the session is
/// gone) as needed.
macro_rules! with_session {
    ($shared:expr, |$ide:ident| $call:expr) => {{
        let mut session = $shared.session.lock().await;
        let mut retried = false;
        loop {
            if session.is_none() {
                *session = Some($shared.connect().await?);
            }
            let $ide = session.as_ref().expect("connected above");
            match $call {
                Err(Error::Gone) if !retried => {
                    retried = true;
                    *session = None;
                }
                done => break done,
            }
        }
    }};
}

/// Starts the devtools; whether they could be.
pub type Launch = Arc<dyn Fn() -> bool + Send + Sync>;

/// The devtools of `roots` (this machine's by default) through one reused MCP session: a new session costs the
/// devtools a check with WeChat's servers. Calls take turns, as the simulator shows one page at a time. Devtools not
/// running are launched.
pub struct Shared {
    roots: Vec<PathBuf>,
    trust: Trust,
    launch: Launch,
    session: tokio::sync::Mutex<Option<Devtools>>,
}

impl Shared {
    pub fn new(roots: Vec<PathBuf>, trust: Trust, launch: Launch) -> Self {
        Self { roots, trust, launch, session: tokio::sync::Mutex::new(None) }
    }

    async fn connect(&self) -> Result<Devtools, Error> {
        let mut ide = match Devtools::connect_in(&self.roots).await {
            Err(Error::NotRunning) if (self.launch)() => self.await_launch().await?,
            other => other?,
        };
        ide.trust = self.trust.clone();
        Ok(ide)
    }

    /// They write their port file, then serve it, a while after starting; the first sessions asked for meanwhile may
    /// never be answered.
    async fn await_launch(&self) -> Result<Devtools, Error> {
        let deadline = std::time::Instant::now() + LAUNCH;
        loop {
            tokio::time::sleep(POLL).await;
            match Devtools::connect_in(&self.roots).await {
                Err(Error::NotRunning | Error::Failed(_)) if std::time::Instant::now() < deadline => {}
                done => return done,
            }
        }
    }

    pub async fn open(&self, project: &Path, page: Option<&str>) -> Result<(), Error> {
        with_session!(self, |ide| ide.open(project, page).await)
    }

    pub async fn screenshot(&self, project: &Path, page: &str) -> Result<Vec<u8>, Error> {
        with_session!(self, |ide| ide.screenshot(project, page).await)
    }
}

static DEVTOOLS: std::sync::LazyLock<Shared> =
    std::sync::LazyLock::new(|| Shared::new(data_roots(), Arc::new(answer_trust_prompt), Arc::new(launch)));

#[cfg(target_os = "macos")]
const APP: &str = "/Applications/wechatwebdevtools.app";

/// Starts the devtools in the background, without taking the owner's focus.
#[cfg(target_os = "macos")]
fn launch() -> bool {
    let started = Path::new(APP).is_dir()
        && std::process::Command::new("open").args(["-g", "-a", APP]).status().is_ok_and(|s| s.success());
    if started {
        tracing::info!("launched the WeChat devtools");
    }
    started
}

#[cfg(not(target_os = "macos"))]
fn launch() -> bool {
    false
}

/// Presses 「信任并运行」 in the devtools window of `project` through macOS accessibility (no pointer, works behind
/// other windows); false without that permission or such a prompt.
#[cfg(target_os = "macos")]
fn answer_trust_prompt(project: &Path) -> bool {
    ax::press_in_window(&window_titles(project), "信任并运行")
}

#[cfg(not(target_os = "macos"))]
fn answer_trust_prompt(_: &Path) -> bool {
    false
}

/// Titles the devtools may give a project's window: its (URL-encoded) project names, or its directory name.
fn window_titles(project: &Path) -> Vec<String> {
    let mut titles: Vec<String> = ["project.config.json", "project.private.config.json"]
        .iter()
        .filter_map(|f| std::fs::read_to_string(project.join(f)).ok())
        .filter_map(|s| serde_json::from_str::<Value>(&s).ok())
        .filter_map(|v| v["projectname"].as_str().map(percent_decode))
        .collect();
    titles.extend(project.file_name().map(|n| n.to_string_lossy().into_owned()));
    titles
}

fn percent_decode(s: &str) -> String {
    let (bytes, mut out, mut i) = (s.as_bytes(), Vec::new(), 0);
    while i < bytes.len() {
        let hex = (bytes[i] == b'%').then(|| s.get(i + 1..i + 3)).flatten();
        match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
            Some(b) => {
                out.push(b);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// What the agent or the card is told; an unauthorized client pops the devtools' authorization dialog for the
/// machine's owner.
fn explain(e: Error) -> String {
    match e {
        Error::NotRunning | Error::Gone => {
            "本机的微信开发者工具未运行，或未开启「设置 → 安全 → 服务端口」（需 2.02 及以上版本）".into()
        }
        Error::Unauthorized => {
            #[cfg(target_os = "macos")]
            let asked = std::process::Command::new(CLI).args(["auth", "-c", CLIENT]).spawn().is_ok();
            #[cfg(not(target_os = "macos"))]
            let asked = false;
            if asked {
                format!("已在本机微信开发者工具里弹出「{CLIENT}」的授权请求，请机器主人点击「允许」后重试")
            } else {
                format!(
                    "请机器主人在微信开发者工具里授权「{CLIENT}」（运行 wechatide auth -c {CLIENT}），或关闭 CLI 访问令牌后重试"
                )
            }
        }
        Error::NeedsLogin(_) => "微信开发者工具未登录".into(),
        Error::Failed(e) => e,
    }
}

/// A mini program's simulator (JPEG), or, while nobody is logged in to the devtools, their login QR code (JPEG) for
/// the bot's owner to scan.
#[derive(Debug, PartialEq)]
pub enum Shot {
    Simulator(Vec<u8>),
    Login(Vec<u8>),
}

/// This machine's devtools.
pub fn devtools() -> &'static Shared {
    &DEVTOOLS
}

/// Opens `project` (a directory with project.config.json) on `page` through `devtools` (launched if needed); the
/// login code to scan first when nobody is logged in.
pub async fn open(devtools: &Shared, project: &Path, page: Option<&str>) -> Result<Option<Vec<u8>>, String> {
    require_project(project)?;
    match devtools.open(project, page).await {
        Ok(()) => Ok(None),
        Err(Error::NeedsLogin(qr)) => Ok(Some(qr)),
        Err(e) => Err(explain(e)),
    }
}

/// The simulator of `project` on `page` through `devtools` (launched and the project opened if needed).
pub async fn screenshot(devtools: &Shared, project: &Path, page: &str) -> Result<Shot, String> {
    require_project(project)?;
    match devtools.screenshot(project, page).await {
        Ok(jpeg) => Ok(Shot::Simulator(jpeg)),
        Err(Error::NeedsLogin(qr)) => Ok(Shot::Login(qr)),
        Err(e) => Err(explain(e)),
    }
}

/// Where gg-cast finds `project`'s simulator: the running devtools' processes, and the titles its window may have.
pub fn simulator_window(project: &Path) -> Result<(Vec<u32>, Vec<String>), String> {
    #[cfg(target_os = "macos")]
    let pids: Vec<u32> = ax::devtools_pids().into_iter().map(|p| p as u32).collect();
    #[cfg(not(target_os = "macos"))]
    let pids: Vec<u32> = vec![];
    if pids.is_empty() {
        return Err("本机的微信开发者工具未运行".into());
    }
    Ok((pids, window_titles(project)))
}

fn require_project(project: &Path) -> Result<(), String> {
    if project.join("project.config.json").is_file() {
        return Ok(());
    }
    Err(format!("{} 不是小程序项目（缺少 project.config.json）", project.display()))
}

#[cfg(test)]
pub(crate) mod fake {
    use serde_json::{Value, json};
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    pub type Calls = Arc<Mutex<Vec<(String, Value)>>>;
    pub type Reply = Box<dyn Fn(&str, &Value) -> Value + Send + Sync>;

    pub struct Fake {
        pub port: u16,
        /// (tool, arguments) of its tool calls, and ("initialize", {}) per new session.
        pub calls: Calls,
        /// Set: like devtools that restarted, it forgets its sessions (400) and stops answering heartbeats.
        pub dead: Arc<AtomicBool>,
    }

    /// A devtools MCP endpoint: answers each JSON-RPC request with `reply(method or tool, arguments)` as an SSE
    /// event, or 401 when `unauthorized`.
    pub async fn fake(unauthorized: bool, reply: Reply) -> Fake {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let calls: Calls = Arc::default();
        let dead = Arc::new(AtomicBool::new(false));
        let (log, gone) = (calls.clone(), dead.clone());
        let session = format!("s{port}");
        tokio::spawn(async move {
            loop {
                let (mut s, _) = listener.accept().await.unwrap();
                let mut buf = vec![0u8; 65536];
                let mut n = 0;
                let (head, body) = loop {
                    n += s.read(&mut buf[n..]).await.unwrap();
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    if let Some((head, body)) = req.split_once("\r\n\r\n") {
                        let len = head
                            .lines()
                            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length: ").map(str::to_string))
                            .map_or(0, |v| v.trim().parse().unwrap());
                        if body.len() >= len {
                            break (head.to_string(), body.to_string());
                        }
                    }
                };
                let known = head.to_ascii_lowercase().contains(&format!("mcp-session-id: {session}"));
                let res = if gone.load(Ordering::SeqCst) {
                    "HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".to_string()
                } else if head.starts_with("GET /mcp/heartbeat") {
                    "HTTP/1.1 200 OK\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".to_string()
                } else if unauthorized {
                    "HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".to_string()
                } else {
                    let rpc: Value = serde_json::from_str(&body).unwrap();
                    let method = rpc["method"].as_str().unwrap();
                    if method == "notifications/initialized" {
                        "HTTP/1.1 202 Accepted\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".to_string()
                    } else {
                        let key = if method == "tools/call" {
                            assert!(known, "a tool call outside the session");
                            let (name, args) = (rpc["params"]["name"].as_str().unwrap(), &rpc["params"]["arguments"]);
                            log.lock().unwrap().push((name.to_string(), args.clone()));
                            name.to_string()
                        } else {
                            log.lock().unwrap().push((method.to_string(), json!({})));
                            method.to_string()
                        };
                        let result = reply(&key, &rpc["params"]["arguments"]);
                        if result.is_null() {
                            // Never answered, like calls into an app that waits for the owner's trust.
                            tokio::spawn(async move {
                                tokio::time::sleep(std::time::Duration::from_secs(600)).await;
                                drop(s);
                            });
                            continue;
                        }
                        let data = json!({ "jsonrpc": "2.0", "id": rpc["id"], "result": result });
                        let body = format!("event: message\ndata: {data}\n\n");
                        format!(
                            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nmcp-session-id: {session}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                            body.len()
                        )
                    }
                };
                s.write_all(res.as_bytes()).await.unwrap();
            }
        });
        Fake { port, calls, dead }
    }

    pub fn ok(v: Value) -> Value {
        json!({ "content": [{ "type": "text", "text": v.to_string() }], "structuredContent": v })
    }

    fn refuse(text: &str) -> Value {
        json!({ "isError": true, "content": [{ "type": "text", "text": text }] })
    }

    /// `<root>/<hash>/Default/.ide` holding `port`.
    pub fn port_file(root: &Path, hash: &str, port: u16) {
        let dir = root.join(hash).join("Default");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(".ide"), port.to_string()).unwrap();
    }

    #[derive(Default)]
    struct Simulator {
        /// Projects whose window is open; the page is the last one's.
        open: std::collections::HashSet<String>,
        page: Value,
        /// A navigation shows a moment later: after one more poll.
        pending: Option<(Value, u8)>,
    }

    /// Devtools with one simulator: closed until `open_project_window`, then on `pages/index/index`; screenshots
    /// hold the page path they show.
    pub fn standard() -> Reply {
        simulator(Arc::new(AtomicBool::new(true)))
    }

    /// Like `standard`, but until `trusted` is set the project's app never starts: the devtools ask whether to trust
    /// its author and leave page queries unanswered meanwhile.
    pub fn simulator(trusted: Arc<AtomicBool>) -> Reply {
        answering(World { trusted, logged_in: Arc::new(AtomicBool::new(true)), ..World::default() })
    }

    /// The owner's side of the fake devtools: whether the project is trusted, whether someone is logged in (scanning
    /// the login code sets it), whether the pending login code expired.
    #[derive(Default, Clone)]
    pub struct World {
        pub trusted: Arc<AtomicBool>,
        pub logged_in: Arc<AtomicBool>,
        pub expired: Arc<AtomicBool>,
        /// Someone logged in another way (the devtools' own window, the CLI): the pending code's task is cancelled.
        pub elsewhere: Arc<AtomicBool>,
    }

    pub fn answering(world: World) -> Reply {
        let World { trusted, logged_in, expired, elsewhere } = world;
        let codes = std::sync::atomic::AtomicUsize::new(0);
        let sim = Mutex::new(Simulator::default());
        Box::new(move |key, args| {
            let mut sim = sim.lock().unwrap();
            match key {
                "initialize" => json!({ "protocolVersion": "2025-03-26", "capabilities": {} }),
                "check_wechatide_status" => {
                    ok(json!({ "success": true, "loginExpired": !logged_in.load(Ordering::SeqCst) }))
                }
                "login" => {
                    assert_eq!(args["type"], "image");
                    let n = codes.fetch_add(1, Ordering::SeqCst) + 1;
                    let task = json!({ "success": true, "taskId": format!("login_{n}"), "status": "pending" });
                    use base64::Engine;
                    let qr = base64::engine::general_purpose::STANDARD.encode(format!("QR{n}"));
                    json!({
                        "content": [
                            { "type": "image", "data": qr, "mimeType": "image/jpeg" },
                            { "type": "text", "text": task.to_string() }
                        ],
                        "structuredContent": task
                    })
                }
                "polling_task_result" => {
                    let status = if elsewhere.load(Ordering::SeqCst) {
                        "cancelled"
                    } else if logged_in.load(Ordering::SeqCst) {
                        "success"
                    } else if expired.swap(false, Ordering::SeqCst) {
                        "expired"
                    } else {
                        "pending"
                    };
                    ok(json!({ "success": true, "taskId": args["taskId"], "status": status }))
                }
                "open_project_window" if !logged_in.load(Ordering::SeqCst) => refuse("请先登录"),
                // Like the real ones: logged out, a page query fails as an AppID error (and logs the IDE out again).
                "automation_runtime_info" if !logged_in.load(Ordering::SeqCst) => {
                    ok(json!({ "success": false, "code": "APPID_ERROR", "error": "需要重新登录" }))
                }
                "open_project_window" => {
                    if sim.open.insert(args["project"].as_str().unwrap().to_string()) {
                        sim.page = json!({ "path": "pages/index/index", "query": {} });
                    }
                    ok(json!({ "success": true }))
                }
                _ if !args["project"].as_str().is_some_and(|p| sim.open.contains(p)) => refuse("项目未打开"),
                "automation_runtime_info" if !trusted.load(Ordering::SeqCst) => Value::Null,
                "automation_navigate" => {
                    assert_eq!(args["action"], "reLaunch");
                    let url = args["url"].as_str().unwrap().trim_start_matches('/');
                    let (path, query) = url.split_once('?').unwrap_or((url, ""));
                    let query: serde_json::Map<String, Value> = query
                        .split('&')
                        .filter_map(|kv| kv.split_once('='))
                        .map(|(k, v)| (k.to_string(), json!(v)))
                        .collect();
                    sim.pending = Some((json!({ "path": path, "query": query }), 1));
                    ok(json!({ "success": true }))
                }
                "automation_runtime_info" => {
                    if let Some((page, left)) = sim.pending.take() {
                        if left == 0 { sim.page = page } else { sim.pending = Some((page, left - 1)) }
                    }
                    ok(json!({ "success": true, "currentPage": sim.page }))
                }
                "simulator_screenshot" => {
                    std::fs::write(args["path"].as_str().unwrap(), sim.page["path"].as_str().unwrap()).unwrap();
                    ok(json!({ "success": true, "path": args["path"] }))
                }
                _ => refuse("未知工具"),
            }
        })
    }

    /// Devtools answering like `reply`, as the daemon would reach them (no trust prompts, no launching).
    pub async fn install(reply: Reply) -> (Calls, &'static super::Shared, tempfile::TempDir) {
        let data = tempfile::tempdir().unwrap();
        let Fake { port, calls, .. } = fake(false, reply).await;
        port_file(data.path(), "h", port);
        let none = std::sync::Arc::new(|_: &Path| false);
        let shared = super::Shared::new(vec![data.path().into()], none, std::sync::Arc::new(|| false));
        (calls, Box::leak(Box::new(shared)), data)
    }
}

#[cfg(test)]
mod tests {
    use super::fake::*;
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use tokio::net::TcpListener;

    async fn connected() -> (Devtools, Calls) {
        let root = tempfile::tempdir().unwrap();
        let f = fake(false, standard()).await;
        port_file(root.path(), "h", f.port);
        let ide = Devtools::connect_in(&[root.path().into()]).await.unwrap();
        f.calls.lock().unwrap().clear();
        (ide, f.calls)
    }

    fn tools(calls: &Calls) -> Vec<String> {
        calls.lock().unwrap().drain(..).map(|c| c.0).collect()
    }

    #[tokio::test]
    async fn connects_to_the_devtools_that_answers_among_stale_port_files() {
        let root = tempfile::tempdir().unwrap();
        let dead = TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap().port();
        port_file(root.path(), "old", dead);
        assert_eq!(Devtools::connect_in(&[root.path().into()]).await.err(), Some(Error::NotRunning));

        let f = fake(false, standard()).await;
        port_file(root.path(), "new", f.port);
        let ide = Devtools::connect_in(&[root.path().into(), PathBuf::from("/nonexistent")]).await.unwrap();
        let info = ide.call("automation_runtime_info", json!({ "project": "/p", "action": "currentPage" })).await;
        assert_eq!(info.err(), Some(Error::Failed("项目未打开".into())));
        assert_eq!(ide.call("open_project_window", json!({ "project": "/p" })).await.unwrap()["success"], true);
    }

    #[tokio::test]
    async fn retries_what_the_devtools_fail_on_their_own_network_a_few_times() {
        let flaky = |fails: usize| -> Reply {
            let n = std::sync::atomic::AtomicUsize::new(0);
            Box::new(move |key, _| match key {
                "initialize" => json!({ "protocolVersion": "2025-03-26", "capabilities": {} }),
                "plain" => ok(json!({ "success": false, "error": "cant find runtimeid" })),
                _ if n.fetch_add(1, Ordering::SeqCst) < fails => ok(json!({
                    "success": false,
                    "code": "APPID_ERROR",
                    "error": "Client network socket disconnected before secure TLS connection was established"
                })),
                _ => ok(json!({ "success": true })),
            })
        };
        for (fails, attempts, done) in [(2, 3, true), (5, 3, false)] {
            let root = tempfile::tempdir().unwrap();
            let f = fake(false, flaky(fails)).await;
            port_file(root.path(), "h", f.port);
            let ide = Devtools::connect_in(&[root.path().into()]).await.unwrap();
            assert_eq!(ide.call("automation_navigate", json!({})).await.is_ok(), done);
            assert_eq!(f.calls.lock().unwrap().iter().filter(|c| c.0 == "automation_navigate").count(), attempts);
            assert_eq!(ide.call("plain", json!({})).await.err(), Some(Error::Failed("cant find runtimeid".into())));
            assert_eq!(f.calls.lock().unwrap().iter().filter(|c| c.0 == "plain").count(), 1, "not a network hiccup");
        }
    }

    #[tokio::test]
    async fn an_unauthorized_client_is_told_apart() {
        let root = tempfile::tempdir().unwrap();
        let f = fake(true, standard()).await;
        port_file(root.path(), "h", f.port);
        assert_eq!(Devtools::connect_in(&[root.path().into()]).await.err(), Some(Error::Unauthorized));
    }

    #[tokio::test]
    async fn opens_a_simulator_window_and_waits_for_the_page_to_show() {
        let (ide, calls) = connected().await;
        ide.open(Path::new("/w/shop"), Some("pages/goods/detail?id=42&from=share")).await.unwrap();
        let log = calls.lock().unwrap().clone();
        assert_eq!(log[0].0, "automation_runtime_info", "not running yet");
        assert_eq!(log[1].0, "check_wechatide_status", "someone is logged in");
        assert_eq!(log[2], ("open_project_window".into(), json!({ "project": "/w/shop", "windowMode": "liteMode" })));
        assert_eq!(log[3].0, "automation_runtime_info", "the app runs before it navigates");
        let url = "/pages/goods/detail?id=42&from=share";
        assert_eq!(
            log[4],
            ("automation_navigate".into(), json!({ "project": "/w/shop", "action": "reLaunch", "url": url }))
        );
        assert_eq!(tools(&calls)[5..], ["automation_runtime_info"; 2]);

        // Running already: reopening its window would slow the devtools' next automation call down to seconds.
        ide.open(Path::new("/w/shop"), None).await.unwrap();
        assert_eq!(tools(&calls), ["automation_runtime_info"]);
        ide.open(Path::new("/w/shop"), Some("pages/goods/detail?id=42&from=share")).await.unwrap();
        assert_eq!(tools(&calls), ["automation_runtime_info"]);
    }

    #[tokio::test]
    async fn screenshots_the_page_opening_the_project_or_navigating_only_when_needed() {
        let (ide, calls) = connected().await;
        let shop = Path::new("/w/shop");

        assert_eq!(ide.screenshot(shop, "/").await.unwrap(), b"pages/index/index");
        assert_eq!(
            tools(&calls),
            [
                "automation_runtime_info",
                "check_wechatide_status",
                "open_project_window",
                "automation_runtime_info",
                "simulator_screenshot"
            ]
        );

        assert_eq!(ide.screenshot(shop, "/pages/index/index").await.unwrap(), b"pages/index/index");
        let log = calls.lock().unwrap().clone();
        assert_eq!(tools(&calls), ["automation_runtime_info", "simulator_screenshot"]);
        assert!(log[1].1.get("wait").is_none(), "the page already shows: no render wait");
        assert!(!Path::new(log[1].1["path"].as_str().unwrap()).exists(), "the temporary file is removed");

        assert_eq!(ide.screenshot(shop, "/pages/me/me?tab=2").await.unwrap(), b"pages/me/me");
        let log = calls.lock().unwrap().clone();
        assert_eq!(
            tools(&calls),
            [
                "automation_runtime_info",
                "automation_navigate",
                "automation_runtime_info",
                "automation_runtime_info",
                "simulator_screenshot"
            ]
        );
        assert_eq!(log[4].1["wait"], RENDER_WAIT);
        assert_eq!(ide.screenshot(shop, "/pages/me/me?tab=2").await.unwrap(), b"pages/me/me");
        assert_eq!(tools(&calls), ["automation_runtime_info", "simulator_screenshot"]);
    }

    #[tokio::test]
    async fn answers_the_trust_prompt_of_the_project_it_opens_and_explains_when_it_cannot() {
        for can in [true, false] {
            let root = tempfile::tempdir().unwrap();
            let trusted = Arc::new(AtomicBool::new(false));
            let f = fake(false, simulator(trusted.clone())).await;
            port_file(root.path(), "h", f.port);
            let asked: Arc<Mutex<Vec<PathBuf>>> = Arc::default();
            let (flag, log) = (trusted.clone(), asked.clone());
            let shared = Shared::new(
                vec![root.path().into()],
                Arc::new(move |project: &Path| {
                    log.lock().unwrap().push(project.into());
                    if can {
                        flag.store(true, Ordering::SeqCst);
                    }
                    can
                }),
                Arc::new(|| false),
            );

            let opened = shared.open(Path::new("/w/shop"), Some("pages/me/me")).await;
            assert!(asked.lock().unwrap().iter().all(|p| p == Path::new("/w/shop")));
            let calls = f.calls.lock().unwrap().clone();
            assert_eq!(calls.iter().filter(|c| c.0 == "initialize").count(), 1, "a slow answer is not a lost session");
            if can {
                opened.unwrap();
                assert!(calls.iter().any(|c| c.0 == "automation_navigate"), "{calls:?}");
            } else {
                let Err(Error::Failed(why)) = opened else { panic!("an app that never starts cannot be opened") };
                assert!(why.contains("信任并运行") && why.contains("辅助功能"), "{why}");
            }
        }
    }

    #[test]
    fn knows_the_titles_the_devtools_give_a_project_window() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("luke-plus-miniprogram");
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.config.json"), r#"{"projectname":"luhu%2B%E5%95%86%E5%9F%8E"}"#).unwrap();
        std::fs::write(project.join("project.private.config.json"), r#"{"projectname":"luke-plus"}"#).unwrap();
        assert_eq!(window_titles(&project), ["luhu+商城", "luke-plus", "luke-plus-miniprogram"]);
        assert_eq!(percent_decode("a%2"), "a%2");
    }

    #[tokio::test]
    async fn leaves_the_trust_prompts_alone_while_the_app_runs() {
        let root = tempfile::tempdir().unwrap();
        let f = fake(false, standard()).await;
        port_file(root.path(), "h", f.port);
        let asked = Arc::new(AtomicBool::new(false));
        let flag = asked.clone();
        let shared = Shared::new(
            vec![root.path().into()],
            Arc::new(move |_: &Path| {
                flag.store(true, Ordering::SeqCst);
                true
            }),
            Arc::new(|| false),
        );
        shared.screenshot(Path::new("/w/shop"), "/pages/me/me").await.unwrap();
        assert!(!asked.load(Ordering::SeqCst));
    }

    fn logged_out() -> World {
        World { trusted: Arc::new(AtomicBool::new(true)), ..World::default() }
    }

    fn shared(root: &Path) -> Shared {
        Shared::new(vec![root.into()], Arc::new(|_: &Path| false), Arc::new(|| false))
    }

    #[tokio::test]
    async fn hands_out_one_login_code_until_it_is_scanned_then_opens_the_project() {
        let root = tempfile::tempdir().unwrap();
        let world = logged_out();
        let f = fake(false, answering(world.clone())).await;
        port_file(root.path(), "h", f.port);
        let shared = shared(root.path());
        let shop = Path::new("/w/shop");

        assert_eq!(shared.screenshot(shop, "/pages/me/me").await.err(), Some(Error::NeedsLogin(b"QR1".to_vec())));
        let tools = |f: &Fake| f.calls.lock().unwrap().iter().map(|c| c.0.clone()).collect::<Vec<_>>();
        let queries = |f: &Fake| tools(f).iter().filter(|t| *t == "automation_runtime_info").count();
        assert_eq!(queries(&f), 1, "a login error is no network hiccup to retry");
        // While the code is shown, only its task is polled: each page query would log the devtools out again.
        assert_eq!(shared.screenshot(shop, "/pages/me/me").await.err(), Some(Error::NeedsLogin(b"QR1".to_vec())));
        assert_eq!(shared.open(shop, None).await.err(), Some(Error::NeedsLogin(b"QR1".to_vec())));
        assert_eq!(queries(&f), 1);
        assert_eq!(tools(&f).iter().filter(|t| *t == "login").count(), 1, "the code shown stays valid");
        assert!(!tools(&f).contains(&"open_project_window".to_string()));

        world.logged_in.store(true, Ordering::SeqCst);
        assert_eq!(shared.screenshot(shop, "/pages/me/me").await.unwrap(), b"pages/me/me");
        assert!(tools(&f).contains(&"open_project_window".to_string()));

        // Logged out again later: an expired code is replaced.
        world.logged_in.store(false, Ordering::SeqCst);
        let other = Path::new("/w/other");
        assert_eq!(shared.open(other, None).await.err(), Some(Error::NeedsLogin(b"QR2".to_vec())));
        world.expired.store(true, Ordering::SeqCst);
        assert_eq!(shared.open(other, None).await.err(), Some(Error::NeedsLogin(b"QR3".to_vec())));
    }

    #[tokio::test]
    async fn a_login_made_elsewhere_ends_the_code_without_asking_for_another() {
        let root = tempfile::tempdir().unwrap();
        let world = logged_out();
        let f = fake(false, answering(world.clone())).await;
        port_file(root.path(), "h", f.port);
        let shared = shared(root.path());
        let shop = Path::new("/w/shop");

        assert_eq!(shared.screenshot(shop, "/").await.err(), Some(Error::NeedsLogin(b"QR1".to_vec())));
        world.logged_in.store(true, Ordering::SeqCst);
        world.elsewhere.store(true, Ordering::SeqCst);
        assert_eq!(shared.screenshot(shop, "/").await.unwrap(), b"pages/index/index");
        let logins = f.calls.lock().unwrap().iter().filter(|c| c.0 == "login").count();
        assert_eq!(logins, 1, "logged in already: no second code");
    }

    #[tokio::test]
    async fn launches_the_devtools_when_they_are_not_running() {
        let root = tempfile::tempdir().unwrap();
        // Just started, they answer heartbeats but swallow the first initialize.
        let (standard, swallowed) = (standard(), AtomicBool::new(false));
        let starting: Reply = Box::new(move |key, args| {
            if key == "initialize" && !swallowed.swap(true, Ordering::SeqCst) {
                Value::Null
            } else {
                standard(key, args)
            }
        });
        let f = fake(false, starting).await;
        let launched = Arc::new(AtomicBool::new(false));
        let (dir, port, flag) = (root.path().to_path_buf(), f.port, launched.clone());
        let shared = Shared::new(
            vec![root.path().into()],
            Arc::new(|_: &Path| false),
            Arc::new(move || {
                flag.store(true, Ordering::SeqCst);
                // They write their port file a moment after starting.
                let dir = dir.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(300));
                    port_file(&dir, "h", port);
                });
                true
            }),
        );
        assert_eq!(shared.screenshot(Path::new("/w/shop"), "/").await.unwrap(), b"pages/index/index");
        assert!(launched.load(Ordering::SeqCst));

        let nowhere = tempfile::tempdir().unwrap();
        let cannot = Shared::new(vec![nowhere.path().into()], Arc::new(|_: &Path| false), Arc::new(|| false));
        assert_eq!(cannot.screenshot(Path::new("/w/shop"), "/").await.err(), Some(Error::NotRunning));
    }

    #[tokio::test]
    async fn keeps_one_session_and_reconnects_once_the_devtools_restarted() {
        let root = tempfile::tempdir().unwrap();
        let old = fake(false, standard()).await;
        port_file(root.path(), "h", old.port);
        let shared = Shared::new(vec![root.path().into()], Arc::new(|_: &Path| false), Arc::new(|| false));
        let project = Path::new("/w/shop");

        shared.screenshot(project, "/").await.unwrap();
        shared.screenshot(project, "/").await.unwrap();
        assert_eq!(old.calls.lock().unwrap().iter().filter(|c| c.0 == "initialize").count(), 1);

        old.dead.store(true, Ordering::SeqCst);
        let new = fake(false, standard()).await;
        port_file(root.path(), "h", new.port);
        assert_eq!(shared.screenshot(project, "/").await.unwrap(), b"pages/index/index");
        assert_eq!(new.calls.lock().unwrap()[0].0, "initialize");
    }
}
