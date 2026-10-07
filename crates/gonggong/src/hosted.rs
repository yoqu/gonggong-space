//! Hosted services (built-in `service_start`, plan P3): long-running processes such as dev servers, owned by the daemon
//! instead of the agent so they outlive its turn. Each runs in its own process group; output goes to a ring buffer and
//! `<workspace>/.gonggong/services/<name>.log`. Services never outlive the daemon: their process groups are recorded in
//! `<home>/services.pids` and whatever a previous daemon left behind is ended on start. Static sites
//! (`preview_static`) are hosted the same way but run as a task inside the daemon. A desktop app may run on its own
//! virtual display (Linux, Xvfb; plan P15), started before it and ended with it, so it never takes over the owner's
//! screen.
use crate::protocol::{DaemonToServer, ServiceInfo, ServiceStatus};
use crate::service::Outbox;
use serde::Deserialize;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::Command;
use tokio::sync::{mpsc, watch};

pub const MAX_PER_BOT: usize = 5;
const READY_TIMEOUT: Duration = Duration::from_secs(60);
const STOP_GRACE: Duration = Duration::from_secs(5);
const LOG_LINES: usize = 2000;
const REPLY_LINES: usize = 50;
/// Longer output lines are cut: a process printing without newlines must not grow the daemon unbounded.
const LINE_MAX: usize = 16 * 1024;
/// The log file is rotated to `<name>.log.1` past this size.
const LOG_FILE_MAX: u64 = 4 << 20;
/// Stopped services kept for a server restart.
const ENDED_MAX: usize = 64;

/// The live run a tool call belongs to.
pub struct Scope {
    pub group_id: String,
    pub bot_id: String,
    pub run_id: Option<String>,
    /// Workspace root; service dirs must stay inside it.
    pub root: PathBuf,
    pub out: Outbox,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StartArgs {
    pub name: String,
    pub command: String,
    pub cwd: Option<String>,
    pub port: Option<u16>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub display: Option<Display>,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Display {
    Virtual,
}

/// An Xvfb server of one service: its process (group leader) and display name (`:N`).
#[derive(Clone)]
struct Screen {
    pid: u32,
    name: String,
}

#[derive(Clone)]
pub struct Services(Arc<Inner>);

struct Inner {
    pids: PathBuf,
    /// The Xvfb program (tests use a stand-in).
    xvfb: PathBuf,
    list: Mutex<Vec<Hosted>>,
    /// Stopped ones by id, until their (group, bot, name) starts again: the server may still restart them.
    ended: Mutex<VecDeque<Hosted>>,
}

#[derive(Clone)]
enum Stop {
    Group(u32),
    Task(tokio::task::AbortHandle),
}

/// What a service was started with, for the server's restart (the card's 启动).
struct Origin {
    run_id: Option<String>,
    root: PathBuf,
    how: How,
}

enum How {
    Command(StartArgs),
    Static(String),
}

#[derive(Clone)]
struct Hosted {
    info: Arc<Mutex<ServiceInfo>>,
    origin: Arc<Origin>,
    stop: Stop,
    logs: Arc<Mutex<VecDeque<String>>>,
    started: Instant,
    exited: watch::Receiver<bool>,
    screen: Option<Screen>,
}

impl Hosted {
    fn status(&self) -> ServiceStatus {
        self.info.lock().unwrap().status
    }

    fn live(&self) -> bool {
        matches!(self.status(), ServiceStatus::Starting | ServiceStatus::Running)
    }

    fn tail(&self, n: usize) -> String {
        let logs = self.logs.lock().unwrap();
        logs.iter().skip(logs.len().saturating_sub(n)).cloned().collect::<Vec<_>>().join("\n")
    }
}

impl Services {
    pub fn new(home: &Path) -> Self {
        let pids = home.join("services.pids");
        if let Ok(left) = std::fs::read_to_string(&pids) {
            for pid in left.lines().filter_map(|l| l.trim().parse::<u32>().ok()) {
                kill_group(pid, true);
            }
            let _ = std::fs::remove_file(&pids);
        }
        let inner = Inner { pids, xvfb: "Xvfb".into(), list: Mutex::default(), ended: Mutex::default() };
        Services(Arc::new(inner))
    }

    /// Replaces the Xvfb program (tests), before the first start.
    pub fn xvfb(mut self, program: PathBuf) -> Self {
        Arc::get_mut(&mut self.0).expect("not shared yet").xvfb = program;
        self
    }

    /// A name taken by this (group, bot) is restarted: the old one is ended first; then the per-bot limit applies.
    async fn make_room(&self, scope: &Scope, name: &str) -> Result<(), String> {
        if !valid_name(name) {
            return Err("name 只能用小写字母、数字、连字符，最长 32".into());
        }
        if let Some(old) = self.find(&scope.group_id, &scope.bot_id, name) {
            self.end(old).await;
        }
        self.0.ended.lock().unwrap().retain(|h| {
            let i = h.info.lock().unwrap();
            !(i.group_id == scope.group_id && i.bot_id == scope.bot_id && i.name == name)
        });
        let live = self.0.list.lock().unwrap().iter().filter(|h| h.live() && same_bot(h, &scope.bot_id)).count();
        if live >= MAX_PER_BOT {
            return Err(format!("每个 bot 最多同时托管 {MAX_PER_BOT} 个服务，请先用 service_stop 停掉不用的"));
        }
        Ok(())
    }

    /// Serves `dir` (relative to the workspace) on a loopback port; returns the port.
    pub async fn start_static(&self, scope: Scope, name: &str, dir: &str) -> Result<u16, String> {
        let root = inside(&scope.root, dir)?;
        self.make_room(&scope, name).await?;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| format!("无法监听端口：{e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let task = tokio::spawn(crate::static_site::serve(listener, root));
        let info = ServiceInfo {
            id: uuid::Uuid::new_v4().to_string(),
            group_id: scope.group_id.clone(),
            bot_id: scope.bot_id.clone(),
            run_id: scope.run_id.clone(),
            name: name.into(),
            command: format!("静态站点 {}", if dir.is_empty() { "." } else { dir }),
            cwd: dir.into(),
            port: Some(port),
            status: ServiceStatus::Running,
            exit_code: None,
        };
        scope.out.send(DaemonToServer::ServiceState { service: info.clone() });
        let info = Arc::new(Mutex::new(info));
        let (done_tx, exited) = watch::channel(false);
        let stop = Stop::Task(task.abort_handle());
        {
            let (info, out) = (info.clone(), scope.out.clone());
            tokio::spawn(async move {
                let _ = task.await;
                let snapshot = {
                    let mut i = info.lock().unwrap();
                    i.status = ServiceStatus::Exited;
                    i.clone()
                };
                out.send(DaemonToServer::ServiceState { service: snapshot });
                let _ = done_tx.send(true);
            });
        }
        let logs = Arc::new(Mutex::new(VecDeque::new()));
        let origin = Arc::new(Origin { run_id: scope.run_id, root: scope.root, how: How::Static(dir.into()) });
        let hosted = Hosted { info, origin, stop, logs, started: Instant::now(), exited, screen: None };
        self.0.list.lock().unwrap().push(hosted);
        Ok(port)
    }

    pub async fn start(&self, scope: Scope, args: StartArgs) -> Result<String, String> {
        let dir = inside(&scope.root, args.cwd.as_deref().unwrap_or(""))?;
        self.make_room(&scope, &args.name).await?;
        // Otherwise readiness would pass on someone else's server while ours fails to bind.
        if let Some(port) = args.port
            && connectable(port).await
        {
            return Err(format!("端口 {port} 已被占用，请换一个端口，或先停掉占用它的进程"));
        }
        let log_dir = scope.root.join(".gonggong/services");
        tokio::fs::create_dir_all(&log_dir).await.map_err(|e| format!("无法创建日志目录：{e}"))?;
        let log_path = log_dir.join(format!("{}.log", args.name));
        let log_file = tokio::fs::File::create(&log_path).await.map_err(|e| format!("无法写入日志：{e}"))?;
        let screen = match args.display {
            Some(Display::Virtual) => Some(virtual_display(&self.0.xvfb).await?),
            None => None,
        };

        let mut cmd = shell(&args.command);
        cmd.current_dir(&dir).envs(&args.env).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Some(screen) = &screen {
            // Toolkits (GTK, Electron) prefer Wayland when they see it; the app must open on the virtual display.
            cmd.env("DISPLAY", &screen.name).env("XDG_SESSION_TYPE", "x11").env_remove("WAYLAND_DISPLAY");
        }
        let spawned = cmd.spawn().map_err(|e| format!("启动失败：{e}"));
        let (mut child, pid) =
            match spawned.and_then(|c| c.id().map(|pid| (c, pid)).ok_or("启动失败：进程已退出".into())) {
                Ok(started) => started,
                Err(e) => {
                    if let Some(screen) = &screen {
                        kill_group(screen.pid, true);
                    }
                    return Err(e);
                }
            };
        let info = ServiceInfo {
            id: uuid::Uuid::new_v4().to_string(),
            group_id: scope.group_id.clone(),
            bot_id: scope.bot_id.clone(),
            run_id: scope.run_id.clone(),
            name: args.name.clone(),
            command: args.command.clone(),
            cwd: args.cwd.clone().unwrap_or_default(),
            port: args.port,
            status: ServiceStatus::Starting,
            exit_code: None,
        };
        scope.out.send(DaemonToServer::ServiceState { service: info.clone() });
        let info = Arc::new(Mutex::new(info));
        let logs = Arc::new(Mutex::new(VecDeque::new()));
        let (log, lines) = tokio::sync::mpsc::channel(1024);
        tokio::spawn(write_log(lines, log_path, log_file));
        let pumps = [
            tokio::spawn(pump(child.stdout.take().unwrap(), logs.clone(), log.clone())),
            tokio::spawn(pump(child.stderr.take().unwrap(), logs.clone(), log)),
        ];
        let (done_tx, exited) = watch::channel(false);
        {
            let (info, out, inner, display) = (info.clone(), scope.out.clone(), self.0.clone(), screen.clone());
            tokio::spawn(async move {
                let code = child.wait().await.ok().and_then(|s| s.code());
                if let Some(display) = display {
                    kill_group(display.pid, true);
                }
                // Let the last lines land before anyone reads the tail.
                for p in pumps {
                    let _ = tokio::time::timeout(Duration::from_secs(1), p).await;
                }
                let snapshot = {
                    let mut i = info.lock().unwrap();
                    i.status = if i.status == ServiceStatus::Starting && code != Some(0) {
                        ServiceStatus::Failed
                    } else {
                        ServiceStatus::Exited
                    };
                    i.exit_code = code;
                    i.clone()
                };
                out.send(DaemonToServer::ServiceState { service: snapshot });
                let _ = done_tx.send(true);
                inner.save_pids();
            });
        }
        let stop = Stop::Group(pid);
        let origin = Arc::new(Origin {
            run_id: scope.run_id.clone(),
            root: scope.root.clone(),
            how: How::Command(args.clone()),
        });
        let started = Instant::now();
        let hosted = Hosted { info: info.clone(), origin, stop, logs, started, exited: exited.clone(), screen };
        self.0.list.lock().unwrap().push(hosted);
        self.0.save_pids();

        let ready = match args.port {
            Some(port) => wait_ready(port, exited.clone()).await,
            None => Ready::Yes,
        };
        let id = info.lock().unwrap().id.clone();
        let hosted = self.find_id(&id).expect("just added");
        match ready {
            Ready::Yes => {
                let snapshot = {
                    let mut i = info.lock().unwrap();
                    i.status = ServiceStatus::Running;
                    i.clone()
                };
                scope.out.send(DaemonToServer::ServiceState { service: snapshot });
                let port = args.port.map(|p| format!("，端口 {p} 已就绪")).unwrap_or_default();
                Ok(format!("服务 {} 已启动{port}。最近输出：\n{}", args.name, hosted.tail(REPLY_LINES)))
            }
            Ready::Exited => {
                let code = info.lock().unwrap().exit_code.map(|c| c.to_string()).unwrap_or("未知".into());
                Err(format!("服务 {} 启动失败（退出码 {code}）。最近输出：\n{}", args.name, hosted.tail(REPLY_LINES)))
            }
            Ready::Timeout => {
                self.end(hosted.clone()).await;
                Err(format!(
                    "服务 {} 在 {} 秒内没有监听端口 {}，已停止。最近输出：\n{}",
                    args.name,
                    READY_TIMEOUT.as_secs(),
                    args.port.unwrap_or_default(),
                    hosted.tail(REPLY_LINES)
                ))
            }
        }
    }

    /// Every service still starting or running (hello).
    pub fn live(&self) -> Vec<ServiceInfo> {
        let list = self.0.list.lock().unwrap();
        list.iter().filter(|h| h.live()).map(|h| h.info.lock().unwrap().clone()).collect()
    }

    pub fn list_infos(&self, group: &str, bot: &str) -> Vec<ServiceInfo> {
        let list = self.0.list.lock().unwrap();
        list.iter().map(|h| h.info.lock().unwrap().clone()).filter(|i| i.group_id == group && i.bot_id == bot).collect()
    }

    pub fn list(&self, group: &str, bot: &str) -> String {
        let list = self.0.list.lock().unwrap();
        let lines: Vec<String> = list
            .iter()
            .filter(|h| {
                let i = h.info.lock().unwrap();
                i.group_id == group && i.bot_id == bot
            })
            .map(|h| {
                let i = h.info.lock().unwrap();
                let status = match i.status {
                    ServiceStatus::Starting => "启动中".to_string(),
                    ServiceStatus::Running => format!("运行中 {} 分钟", h.started.elapsed().as_secs() / 60),
                    ServiceStatus::Exited => format!("已退出（{}）", code(i.exit_code)),
                    ServiceStatus::Failed => format!("启动失败（{}）", code(i.exit_code)),
                };
                let port = i.port.map(|p| format!(" · 端口 {p}")).unwrap_or_default();
                let cwd = if i.cwd.is_empty() { String::new() } else { format!(" · 目录 {}", i.cwd) };
                format!("- {} · {status}{port}{cwd} · 命令 {}", i.name, i.command)
            })
            .collect();
        if lines.is_empty() { "你在本群没有托管的服务".into() } else { lines.join("\n") }
    }

    pub fn logs(&self, group: &str, bot: &str, name: &str, tail: Option<usize>) -> Result<String, String> {
        let h = self.find(group, bot, name).ok_or_else(|| format!("没有名为 {name} 的服务"))?;
        let text = h.tail(tail.unwrap_or(100));
        Ok(if text.is_empty() { "（暂无输出）".into() } else { text })
    }

    pub async fn stop(&self, group: &str, bot: &str, name: &str) -> Result<String, String> {
        let h = self.find(group, bot, name).filter(Hosted::live).ok_or_else(|| format!("服务 {name} 不在运行"))?;
        self.end(h).await;
        Ok(format!("服务 {name} 已停止"))
    }

    /// Daemon shutdown: services never outlive it.
    pub async fn stop_all(&self) {
        let all: Vec<Hosted> = self.0.list.lock().unwrap().clone();
        futures_util::future::join_all(all.into_iter().map(|h| self.end(h))).await;
    }

    /// Synchronous stop_all for callers that cannot wait (the desktop's unbind): KILL and abort at once.
    pub fn kill_now(&self) {
        for h in self.0.list.lock().unwrap().iter().filter(|h| h.live()) {
            match &h.stop {
                Stop::Group(pid) => kill_group(*pid, true),
                Stop::Task(task) => task.abort(),
            }
            if let Some(screen) = &h.screen {
                kill_group(screen.pid, true);
            }
        }
    }

    /// service.stop from the server (sidebar 停止, preview idle timeout).
    pub async fn stop_id(&self, id: &str) {
        if let Some(h) = self.find_id(id).filter(Hosted::live) {
            self.end(h).await;
        }
    }

    /// service.restart from the server: starts the service again as it was started, ending it first if still live.
    pub async fn restart_id(&self, id: &str, out: &Outbox) -> Result<String, String> {
        let h = self
            .find_id(id)
            .or_else(|| self.0.ended.lock().unwrap().iter().find(|h| h.info.lock().unwrap().id == id).cloned())
            .ok_or(crate::t!("本机没有这个服务的启动记录（机器重启过），请让 Bot 重新启动"))?;
        let (group_id, bot_id, name) = {
            let i = h.info.lock().unwrap();
            (i.group_id.clone(), i.bot_id.clone(), i.name.clone())
        };
        let o = &h.origin;
        let scope = Scope { group_id, bot_id, run_id: o.run_id.clone(), root: o.root.clone(), out: out.clone() };
        match &o.how {
            How::Command(args) => self.start(scope, args.clone()).await,
            How::Static(dir) => {
                let port = self.start_static(scope, &name, dir).await?;
                Ok(crate::t!("静态站点 {name} 已重新开放，端口 {port}", name = name, port = port))
            }
        }
    }

    /// The virtual display (`:N`) a live service runs on.
    pub fn display(&self, id: &str) -> Option<String> {
        self.find_id(id).filter(Hosted::live)?.screen.map(|s| s.name)
    }

    /// The process (group leader) of a live command service; static sites have none.
    pub fn pid(&self, id: &str) -> Option<u32> {
        let h = self.find_id(id).filter(Hosted::live)?;
        match h.stop {
            Stop::Group(pid) => Some(pid),
            Stop::Task(_) => None,
        }
    }

    fn find(&self, group: &str, bot: &str, name: &str) -> Option<Hosted> {
        let list = self.0.list.lock().unwrap();
        list.iter()
            .rev()
            .find(|h| {
                let i = h.info.lock().unwrap();
                i.group_id == group && i.bot_id == bot && i.name == name
            })
            .cloned()
    }

    fn find_id(&self, id: &str) -> Option<Hosted> {
        self.0.list.lock().unwrap().iter().find(|h| h.info.lock().unwrap().id == id).cloned()
    }

    /// Stops the group (TERM, then KILL after a grace period) or the task, and forgets the entry.
    async fn end(&self, h: Hosted) {
        let mut exited = h.exited.clone();
        match &h.stop {
            _ if !h.live() => {}
            Stop::Task(task) => {
                task.abort();
                let _ = exited.wait_for(|e| *e).await;
            }
            Stop::Group(pid) => {
                kill_group_async(*pid, false).await;
                if tokio::time::timeout(STOP_GRACE, exited.wait_for(|e| *e)).await.is_err() {
                    kill_group_async(*pid, true).await;
                    let _ = exited.wait_for(|e| *e).await;
                }
                // The leader is gone; children that ignored TERM go too.
                kill_group_async(*pid, true).await;
            }
        }
        self.0.list.lock().unwrap().retain(|x| !Arc::ptr_eq(&x.info, &h.info));
        self.0.save_pids();
        let mut ended = self.0.ended.lock().unwrap();
        ended.push_back(h);
        if ended.len() > ENDED_MAX {
            ended.pop_front();
        }
    }
}

impl Inner {
    fn save_pids(&self) {
        let list = self.list.lock().unwrap();
        let pids: String = list
            .iter()
            .filter(|h| h.live())
            .flat_map(|h| {
                let group = match h.stop {
                    Stop::Group(pid) => Some(pid),
                    Stop::Task(_) => None,
                };
                group.into_iter().chain(h.screen.as_ref().map(|s| s.pid))
            })
            .map(|pid| format!("{pid}\n"))
            .collect();
        if let Err(e) = std::fs::write(&self.pids, pids) {
            tracing::warn!("cannot record hosted services: {e}");
        }
    }
}

/// Same rule as `ServiceStartArgs.name`; the name is also the log file's name.
fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && name.len() <= 32
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn same_bot(h: &Hosted, bot: &str) -> bool {
    h.info.lock().unwrap().bot_id == bot
}

fn code(c: Option<i32>) -> String {
    c.map(|c| format!("退出码 {c}")).unwrap_or_else(|| "被信号结束".into())
}

/// `rel` resolved under `root`, refusing anything that leaves it.
pub(crate) fn inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    const OUTSIDE: &str = "目录必须是工作区内已存在的相对目录";
    let root = root.canonicalize().map_err(|e| format!("工作区不可用：{e}"))?;
    let dir = root.join(rel).canonicalize().map_err(|_| OUTSIDE.to_string())?;
    if dir.starts_with(&root) && dir.is_dir() { Ok(dir) } else { Err(OUTSIDE.into()) }
}

async fn pump(stream: impl AsyncRead + Unpin, logs: Arc<Mutex<VecDeque<String>>>, file: mpsc::Sender<String>) {
    let mut reader = BufReader::new(stream);
    let mut buf = Vec::new();
    while let Ok(true) = read_line(&mut reader, &mut buf).await {
        let line = String::from_utf8_lossy(&buf).into_owned();
        let _ = file.send(line.clone()).await;
        let mut logs = logs.lock().unwrap();
        if logs.len() == LOG_LINES {
            logs.pop_front();
        }
        logs.push_back(line);
    }
}

/// Next line into `buf` without its line ending, cut at LINE_MAX; false at end of stream.
async fn read_line(reader: &mut (impl AsyncBufRead + Unpin), buf: &mut Vec<u8>) -> std::io::Result<bool> {
    buf.clear();
    let mut any = false;
    loop {
        let chunk = reader.fill_buf().await?;
        if chunk.is_empty() {
            break;
        }
        any = true;
        let (take, end) = match chunk.iter().position(|b| *b == b'\n') {
            Some(i) => (i + 1, true),
            None => (chunk.len(), false),
        };
        let keep = take.min(LINE_MAX.saturating_sub(buf.len()));
        buf.extend_from_slice(&chunk[..keep]);
        reader.consume(take);
        if end {
            break;
        }
    }
    while buf.last().is_some_and(|b| *b == b'\n' || *b == b'\r') {
        buf.pop();
    }
    Ok(any)
}

/// Writes both pumps' lines to the service log, flushing whenever they pause, and rotates it past LOG_FILE_MAX.
async fn write_log(mut lines: mpsc::Receiver<String>, path: PathBuf, file: tokio::fs::File) {
    let mut out = BufWriter::new(file);
    let mut size = 0;
    while let Some(line) = lines.recv().await {
        let _ = out.write_all(line.as_bytes()).await;
        let _ = out.write_all(b"\n").await;
        size += line.len() as u64 + 1;
        if size > LOG_FILE_MAX {
            let _ = out.flush().await;
            let _ = tokio::fs::rename(&path, path.with_extension("log.1")).await;
            match tokio::fs::File::create(&path).await {
                Ok(f) => (out, size) = (BufWriter::new(f), 0),
                Err(e) => return tracing::warn!("cannot reopen {}: {e}", path.display()),
            }
        }
        if lines.is_empty() {
            let _ = out.flush().await;
        }
    }
    let _ = out.flush().await;
}

const DISPLAY_TIMEOUT: Duration = Duration::from_secs(10);

/// Starts an Xvfb server on a free display it picks itself (`-displayfd`), in its own process group.
async fn virtual_display(program: &Path) -> Result<Screen, String> {
    if !cfg!(target_os = "linux") {
        return Err("虚拟显示（display: virtual）只支持 Linux".into());
    }
    let mut cmd = crate::proc::async_command(program);
    cmd.args(["-displayfd", "1", "-screen", "0", "1280x800x24", "-nolisten", "tcp"]);
    #[cfg(unix)]
    cmd.process_group(0);
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "本机没有 Xvfb，无法使用虚拟显示：请机器主人先安装（Debian/Ubuntu：sudo apt install xvfb）".to_string()
        } else {
            format!("无法启动虚拟显示：{e}")
        }
    })?;
    let pid = child.id().ok_or("虚拟显示启动后立即退出")?;
    let mut lines = BufReader::new(child.stdout.take().expect("piped")).lines();
    let number = tokio::time::timeout(DISPLAY_TIMEOUT, lines.next_line()).await;
    tokio::spawn(async move { child.wait().await });
    match number {
        Ok(Ok(Some(n))) if n.trim().parse::<u32>().is_ok() => Ok(Screen { pid, name: format!(":{}", n.trim()) }),
        _ => {
            kill_group_async(pid, true).await;
            Err("虚拟显示没有启动成功（Xvfb 未报告显示编号）".into())
        }
    }
}

enum Ready {
    Yes,
    Exited,
    Timeout,
}

/// Dev servers often listen on `localhost`, which may be only `::1`.
pub async fn connectable(port: u16) -> bool {
    tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok()
        || tokio::net::TcpStream::connect(("::1", port)).await.is_ok()
}

async fn wait_ready(port: u16, mut exited: watch::Receiver<bool>) -> Ready {
    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        if *exited.borrow() {
            return Ready::Exited;
        }
        if connectable(port).await {
            return Ready::Yes;
        }
        if Instant::now() > deadline {
            return Ready::Timeout;
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(200)) => {}
            _ = exited.changed() => {}
        }
    }
}

#[cfg(unix)]
fn shell(command: &str) -> Command {
    let mut cmd = crate::proc::async_command("sh");
    cmd.arg("-c").arg(command).process_group(0);
    cmd
}

#[cfg(windows)]
fn shell(command: &str) -> Command {
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    let mut cmd = Command::new("cmd");
    cmd.arg("/C").arg(command).creation_flags(CREATE_NEW_PROCESS_GROUP | crate::proc::CREATE_NO_WINDOW);
    cmd
}

/// `kill` / `taskkill` invocation ending the process group led by `pid`.
fn kill_command(pid: u32, force: bool) -> (&'static str, Vec<String>) {
    if cfg!(windows) {
        ("taskkill", vec!["/T".into(), "/F".into(), "/PID".into(), pid.to_string()])
    } else {
        ("kill", vec![if force { "-KILL" } else { "-TERM" }.into(), "--".into(), format!("-{pid}")])
    }
}

/// For callers that cannot wait (daemon start, the desktop's unbind).
fn kill_group(pid: u32, force: bool) {
    let (program, args) = kill_command(pid, force);
    let _ = crate::proc::command(program).args(args).stdout(Stdio::null()).stderr(Stdio::null()).status();
}

async fn kill_group_async(pid: u32, force: bool) {
    let (program, args) = kill_command(pid, force);
    let _ = crate::proc::async_command(program).args(args).stdout(Stdio::null()).stderr(Stdio::null()).status().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lines_are_cut_at_the_cap_and_lose_their_endings() {
        let long = "x".repeat(LINE_MAX + 100);
        let input = format!("a\r\n{long}\nb");
        let mut reader = BufReader::with_capacity(1000, input.as_bytes());
        let mut buf = Vec::new();
        let mut got = vec![];
        while read_line(&mut reader, &mut buf).await.unwrap() {
            got.push(String::from_utf8(buf.clone()).unwrap());
        }
        assert_eq!(got, ["a".to_string(), "x".repeat(LINE_MAX), "b".to_string()]);
    }

    #[tokio::test]
    async fn the_log_file_rotates_past_its_cap() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("web.log");
        let (tx, rx) = mpsc::channel(8);
        let writer = tokio::spawn(write_log(rx, path.clone(), tokio::fs::File::create(&path).await.unwrap()));
        let line = "y".repeat(1 << 20);
        for _ in 0..4 {
            tx.send(line.clone()).await.unwrap();
        }
        tx.send("last".into()).await.unwrap();
        drop(tx);
        writer.await.unwrap();
        assert_eq!(std::fs::metadata(path.with_extension("log.1")).unwrap().len(), 4 * ((1 << 20) + 1));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "last\n");
    }
}
