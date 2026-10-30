//! Preview tunnel frames, mirrored from `packages/protocol/src/tunnel.ts`: `[streamId u32 BE][type u8][payload]`.
use hyper::body::Bytes;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameType {
    Open = 1,
    Head = 2,
    Data = 3,
    End = 4,
    Reset = 5,
}

impl TryFrom<u8> for FrameType {
    type Error = anyhow::Error;

    fn try_from(v: u8) -> anyhow::Result<Self> {
        Ok(match v {
            1 => FrameType::Open,
            2 => FrameType::Head,
            3 => FrameType::Data,
            4 => FrameType::End,
            5 => FrameType::Reset,
            _ => anyhow::bail!("unknown tunnel frame type {v}"),
        })
    }
}

const HEADER: usize = 5;

#[derive(Debug, Clone, PartialEq)]
pub struct Frame {
    pub stream_id: u32,
    pub kind: FrameType,
    pub payload: Bytes,
}

impl Frame {
    pub fn encode(&self) -> Bytes {
        let mut out = Vec::with_capacity(HEADER + self.payload.len());
        out.extend_from_slice(&self.stream_id.to_be_bytes());
        out.push(self.kind as u8);
        out.extend_from_slice(&self.payload);
        out.into()
    }

    pub fn decode(frame: Bytes) -> anyhow::Result<Self> {
        anyhow::ensure!(frame.len() >= HEADER, "tunnel frame too short");
        let stream_id = u32::from_be_bytes(frame[..4].try_into().unwrap());
        let kind = FrameType::try_from(frame[4])?;
        Ok(Frame { stream_id, kind, payload: frame.slice(HEADER..) })
    }
}

// ── Daemon runtime ───────────────────────────────────────────────────────────
use crate::config::Config;
use crate::protocol::{SnapshotTarget, TunnelHead, TunnelOpen, TunnelReset, TunnelTarget};
#[cfg(any(target_os = "macos", target_os = "linux"))]
use crate::protocol::{TerminalClientControl, TerminalDaemonControl};
use crate::t;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use crate::terminal::{TerminalEvent, TerminalManager};
use crate::wechatide::Shot;
use anyhow::Context;
use futures_util::{SinkExt, StreamExt};
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Empty, StreamBody};
use hyper::{Request, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;

/// Open previews of this machine (id → loopback port), from `previews.sync`: nothing else is reachable (plan P9).
pub type Allow = Arc<RwLock<HashMap<String, u16>>>;

pub fn set_allowed(allow: &Allow, previews: HashMap<String, u16>) {
    *allow.write().unwrap() = previews;
}

const MAX_BACKOFF: Duration = Duration::from_secs(60);
/// The server answers each ping; nothing heard for two intervals means a dead link (a half-open socket never closes).
const PING_EVERY: Duration = Duration::from_secs(20);
/// Frames waiting for the socket; a full queue slows down reading local responses.
const OUTBOX: usize = 256;
/// Frames a stream's local end may lag behind; beyond it the stream is reset rather than buffered without bound.
const INBOX: usize = 256;

/// Keeps the tunnel connected for the daemon's lifetime, once a server that serves previews has welcomed it.
/// `home` locates managed workspaces for the files browser's streams.
pub async fn run(
    config: Config,
    allow: Allow,
    home: PathBuf,
    mut offered: tokio::sync::watch::Receiver<bool>,
    #[cfg(any(target_os = "macos", target_os = "linux"))] manager: TerminalManager,
) {
    let mut backoff = Duration::from_secs(1);
    loop {
        if offered.wait_for(|on| *on).await.is_err() {
            return;
        }
        match crate::tls::connect_tunnel(&config).await {
            Ok(ws) => {
                backoff = Duration::from_secs(1);
                #[cfg(any(target_os = "macos", target_os = "linux"))]
                let served = serve_inner(ws, allow.clone(), home.clone(), Some(manager.clone())).await;
                #[cfg(not(any(target_os = "macos", target_os = "linux")))]
                let served = serve_inner(ws, allow.clone(), home.clone()).await;
                if let Err(e) = served {
                    tracing::debug!("tunnel closed: {e:#}");
                }
            }
            Err(e) => tracing::debug!("tunnel connect failed: {e:#}"),
        }
        tokio::time::sleep(crate::service::jitter(backoff)).await;
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

enum Inbound {
    Data(Bytes),
    End,
    Reset,
}

/// One web viewer of a terminal: its output, and the keystrokes typed into it. The stream ends when the shell does,
/// when the viewer falls behind (it reattaches from its last sequence), or when the server drops it.
#[cfg(any(target_os = "macos", target_os = "linux"))]
async fn terminal_stream(
    manager: TerminalManager,
    open: crate::protocol::TerminalOpen,
    out: Out,
    mut input: mpsc::Receiver<Bytes>,
) {
    use crate::protocol::TerminalOpenAction;
    use base64::Engine;
    let data = |session_id: &str, seq: u64, data: Bytes| {
        let data = base64::engine::general_purpose::STANDARD.encode(data);
        serde_json::json!({ "sessionId": session_id, "seq": seq, "data": data })
    };
    let result = async {
        if open.action == TerminalOpenAction::Terminate {
            let head = manager.terminate_open(&open).await.map_err(|e| e.to_string())?;
            out.json(FrameType::Head, &exit(head)).await;
            out.send(FrameType::End, Bytes::new()).await;
            return Ok(());
        }
        let mut attached = manager.open(open).await.map_err(|e| e.to_string())?;
        let session_id = attached.head.session_id.clone();
        out.json(FrameType::Head, &attached.head).await;
        for output in attached.replay.drain(..) {
            if !out.json(FrameType::Data, &data(&session_id, output.seq, output.data)).await {
                return Ok(());
            }
        }
        loop {
            tokio::select! {
                event = attached.events.recv() => match event {
                    Some(TerminalEvent::Output(output)) => {
                        if !out.json(FrameType::Data, &data(&session_id, output.seq, output.data)).await {
                            return Ok(());
                        }
                    }
                    Some(TerminalEvent::Exit { .. }) => {
                        let head = manager.head(&session_id).await.map_err(|e| e.to_string())?;
                        out.json(FrameType::Head, &exit(head)).await;
                        return Ok(());
                    }
                    None => {
                        out.send(FrameType::End, Bytes::new()).await;
                        return Ok(());
                    }
                },
                keys = input.recv() => match keys {
                    Some(keys) => manager.input(&session_id, keys).await.map_err(|e| e.to_string())?,
                    None => return Ok(()),
                },
            }
        }
    }
    .await;
    if let Err(error) = result {
        out.reset(error).await;
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn exit(head: crate::protocol::TerminalHead) -> TerminalDaemonControl {
    TerminalDaemonControl::Exit {
        session_id: head.session_id,
        state: head.status,
        next: head.next,
        exit_code: head.exit_code,
        reason: head.reason,
    }
}

/// Resize, terminate and ping never queue behind keystrokes a busy program has not read yet.
#[cfg(any(target_os = "macos", target_os = "linux"))]
async fn terminal_control(manager: TerminalManager, control: TerminalClientControl, out: Out) {
    let result = match control {
        TerminalClientControl::Ping { session_id } => manager.head(&session_id).await.map(|head| Some(head)),
        TerminalClientControl::Resize { session_id, cols, rows } => {
            manager.resize(&session_id, cols, rows).await.map(|_| None)
        }
        // The viewer's own stream reports the exit.
        TerminalClientControl::Terminate { session_id } => manager.terminate(&session_id).await.map(|_| None),
    };
    match result {
        Ok(Some(head)) => {
            out.json(FrameType::Head, &head).await;
        }
        Ok(None) => {}
        Err(error) => out.reset(error.to_string()).await,
    }
}

fn out_for(id: u32, tx: &mpsc::Sender<Frame>) -> Out {
    Out { id, tx: tx.clone() }
}

#[derive(Clone)]
struct Out {
    id: u32,
    tx: mpsc::Sender<Frame>,
}

impl Out {
    async fn send(&self, kind: FrameType, payload: Bytes) -> bool {
        self.tx.send(Frame { stream_id: self.id, kind, payload }).await.is_ok()
    }

    async fn json(&self, kind: FrameType, value: &impl Serialize) -> bool {
        self.send(kind, serde_json::to_vec(value).expect("serializable").into()).await
    }

    async fn reset(&self, reason: String) {
        self.json(FrameType::Reset, &TunnelReset { reason }).await;
    }
}

/// One tunnel connection: streams opened by the server are forwarded to loopback ports, or answered from workspace
/// files, until the socket closes.
pub async fn serve<S>(ws: WebSocketStream<S>, allow: Allow, home: PathBuf) -> anyhow::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return serve_inner(ws, allow, home, None).await;
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    return serve_inner(ws, allow, home).await;
}

async fn serve_inner<S>(
    ws: WebSocketStream<S>,
    allow: Allow,
    home: PathBuf,
    #[cfg(any(target_os = "macos", target_os = "linux"))] manager: Option<TerminalManager>,
) -> anyhow::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut sink, mut source) = ws.split();
    let (tx, mut rx) = mpsc::channel::<Frame>(OUTBOX);
    let writer = tokio::spawn(async move {
        let mut ping = tokio::time::interval(PING_EVERY);
        loop {
            let msg = tokio::select! {
                frame = rx.recv() => match frame {
                    Some(frame) => Message::Binary(frame.encode()),
                    None => break,
                },
                _ = ping.tick() => Message::Ping(Default::default()),
            };
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });
    let mut streams: HashMap<u32, mpsc::Sender<Inbound>> = HashMap::new();
    // File streams take no request body; the server resets one when the browser drops it (media seeking does
    // that a lot), which must stop reading the file.
    let mut cancels: HashMap<u32, oneshot::Sender<()>> = HashMap::new();
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let mut terminals: HashMap<u32, mpsc::Sender<Bytes>> = HashMap::new();
    let result = async {
        loop {
            let Ok(next) = tokio::time::timeout(PING_EVERY * 2, source.next()).await else {
                anyhow::bail!("tunnel server stopped answering");
            };
            let Some(msg) = next else { break };
            let bytes = match msg? {
                Message::Binary(b) => b,
                Message::Close(_) => break,
                _ => continue,
            };
            let frame = match Frame::decode(bytes) {
                Ok(f) => f,
                Err(e) => {
                    tracing::warn!("bad tunnel frame: {e}");
                    continue;
                }
            };
            let id = frame.stream_id;
            match frame.kind {
                FrameType::Open => {
                    let out = Out { id, tx: tx.clone() };
                    let open = match serde_json::from_slice::<TunnelOpen>(&frame.payload) {
                        Ok(open) => open,
                        Err(e) => {
                            out.reset(t!("open 无效：{e}", e = e)).await;
                            continue;
                        }
                    };
                    let port = match &open.target {
                        TunnelTarget::Terminal { terminal } => {
                            #[cfg(any(target_os = "macos", target_os = "linux"))]
                            {
                                let (itx, irx) = mpsc::channel(INBOX);
                                terminals.insert(id, itx);
                                let manager = manager.clone().expect("terminal manager");
                                let terminal = (**terminal).clone();
                                tokio::spawn(async move { terminal_stream(manager, terminal, out, irx).await });
                            }
                            #[cfg(not(any(target_os = "macos", target_os = "linux")))]
                            out.reset("terminal transport is unavailable on this platform".into()).await;
                            continue;
                        }
                        TunnelTarget::Preview { preview_id, port } => {
                            if allow.read().unwrap().get(preview_id) != Some(port) {
                                out.reset(t!("端口 {port} 未开放预览", port = port)).await;
                                continue;
                            }
                            *port
                        }
                        TunnelTarget::Files { files: target } => {
                            let root = crate::workspace::workspace_dir(
                                &home,
                                &target.group_id,
                                &target.bot_id,
                                &target.workspace,
                            );
                            let (ctx, crx) = oneshot::channel();
                            cancels.retain(|_, c| !c.is_closed());
                            cancels.insert(id, ctx);
                            tokio::spawn(async move {
                                tokio::select! {
                                    result = files(&root, &open, &out) => if let Err(e) = result {
                                        out.reset(format!("{e:#}")).await;
                                    },
                                    _ = crx => {}
                                }
                            });
                            continue;
                        }
                        TunnelTarget::Snapshot { snapshot: SnapshotTarget::Page { preview_id, port } } => {
                            if allow.read().unwrap().get(preview_id) != Some(port) {
                                out.reset(t!("端口 {port} 未开放预览", port = port)).await;
                                continue;
                            }
                            let (port, path) = (*port, open.path.clone());
                            tokio::spawn(async move {
                                match crate::snapshot::capture(port, &path).await {
                                    Ok(Some(png)) => answer(&out, 200, "image/png", png).await,
                                    Ok(None) => {
                                        let msg = t!("本机没有可用于截图的 Chrome / Edge");
                                        answer(&out, 404, "text/plain; charset=utf-8", msg.into()).await
                                    }
                                    Err(e) => out.reset(format!("{e:#}")).await,
                                }
                            });
                            continue;
                        }
                        TunnelTarget::Snapshot {
                            snapshot: SnapshotTarget::Miniprogram { miniprogram, launch, .. },
                        } => {
                            let (project, path, launch) =
                                (PathBuf::from(miniprogram), open.path.clone(), launch.unwrap_or(true));
                            tokio::spawn(async move {
                                let devtools = crate::wechatide::devtools();
                                match crate::wechatide::screenshot(devtools, &project, &path, launch).await {
                                    Ok(Shot::Simulator(jpeg)) => answer(&out, 200, "image/jpeg", jpeg).await,
                                    // Not the page yet: the devtools' login code for the bot's owner.
                                    Ok(Shot::Login(qr)) => answer(&out, 202, "image/jpeg", qr).await,
                                    Err(e) => out.reset(e).await,
                                }
                            });
                            continue;
                        }
                    };
                    let (itx, irx) = mpsc::channel(INBOX);
                    streams.insert(id, itx);
                    tokio::spawn(async move {
                        if let Err(e) = forward(port, open, irx, &out).await {
                            out.reset(format!("{e:#}")).await;
                        }
                    });
                }
                FrameType::Data => {
                    #[cfg(any(target_os = "macos", target_os = "linux"))]
                    if let Some(s) = terminals.get(&id) {
                        // Never wait here: every stream of this machine shares this loop. A viewer whose keystrokes
                        // pile up is dropped and reconnects; its shell keeps running.
                        if s.try_send(frame.payload).is_err() {
                            terminals.remove(&id);
                            let out = Out { id, tx: tx.clone() };
                            tokio::spawn(async move { out.reset("terminal_input_backlog".into()).await });
                        }
                        continue;
                    }
                    if let Some(s) = streams.get(&id)
                        && let Err(mpsc::error::TrySendError::Full(_)) = s.try_send(Inbound::Data(frame.payload))
                        && let Some(s) = streams.remove(&id)
                    {
                        let out = Out { id, tx: tx.clone() };
                        tokio::spawn(async move {
                            out.reset(t!("本机端口接收过慢，已断开").into()).await;
                            let _ = s.send(Inbound::Reset).await;
                        });
                    }
                }
                FrameType::End => {
                    if let Some(s) = streams.remove(&id) {
                        tokio::spawn(async move { s.send(Inbound::End).await });
                    }
                }
                FrameType::Reset => {
                    #[cfg(any(target_os = "macos", target_os = "linux"))]
                    terminals.remove(&id);
                    if let Some(s) = streams.remove(&id) {
                        tokio::spawn(async move { s.send(Inbound::Reset).await });
                    }
                    if let Some(c) = cancels.remove(&id) {
                        let _ = c.send(());
                    }
                }
                FrameType::Head =>
                {
                    #[cfg(any(target_os = "macos", target_os = "linux"))]
                    if terminals.contains_key(&id) {
                        let out = out_for(id, &tx);
                        match serde_json::from_slice::<TerminalClientControl>(&frame.payload) {
                            Ok(control) => {
                                tokio::spawn(terminal_control(
                                    manager.clone().expect("terminal manager"),
                                    control,
                                    out,
                                ));
                            }
                            Err(error) => {
                                terminals.remove(&id);
                                tokio::spawn(async move { out.reset(error.to_string()).await });
                            }
                        }
                    }
                }
            }
        }
        anyhow::Ok(())
    }
    .await;
    writer.abort();
    result
}

/// Dev servers often listen on `localhost`, which may be only `::1`.
async fn connect_local(port: u16) -> std::io::Result<TcpStream> {
    match TcpStream::connect(("127.0.0.1", port)).await {
        Ok(s) => Ok(s),
        Err(_) => TcpStream::connect(("::1", port)).await,
    }
}

type Body = BoxBody<Bytes, std::io::Error>;

/// The request body as the server streams it; a reset aborts the upload.
fn request_body(inbound: mpsc::Receiver<Inbound>) -> Body {
    let frames = futures_util::stream::unfold(inbound, |mut rx| async move {
        match rx.recv().await? {
            Inbound::Data(b) => Some((Ok(hyper::body::Frame::data(b)), rx)),
            Inbound::Reset => Some((Err(std::io::Error::other(t!("请求已取消"))), rx)),
            Inbound::End => None,
        }
    });
    BodyExt::boxed(StreamBody::new(frames))
}

async fn forward(port: u16, open: TunnelOpen, inbound: mpsc::Receiver<Inbound>, out: &Out) -> anyhow::Result<()> {
    let tcp = connect_local(port).await.with_context(|| t!("无法连接本机端口 {port}", port = port))?;
    let (mut sender, conn) = hyper::client::conn::http1::handshake::<_, Body>(TokioIo::new(tcp)).await?;
    tokio::spawn(async move {
        let _ = conn.with_upgrades().await;
    });
    let mut req = Request::builder().method(open.method.as_str()).uri(&open.path);
    for (k, v) in &open.headers {
        req = req.header(k, v);
    }
    // Without a length or chunking the request has no body; streaming one would add chunked encoding.
    let has_body = open
        .headers
        .iter()
        .any(|(k, _)| k.eq_ignore_ascii_case("content-length") || k.eq_ignore_ascii_case("transfer-encoding"));
    let (body, inbound) = if has_body && !open.upgrade {
        (request_body(inbound), None)
    } else {
        (Empty::new().map_err(|never| match never {}).boxed(), Some(inbound))
    };
    let mut res = sender.send_request(req.body(body)?).await?;
    if !(open.upgrade && res.status() == StatusCode::SWITCHING_PROTOCOLS) {
        return relay(res, out).await;
    }
    head(&res, out).await;
    if open.upgrade
        && res.status() == StatusCode::SWITCHING_PROTOCOLS
        && let Some(inbound) = inbound
    {
        let upgraded = hyper::upgrade::on(&mut res).await?;
        return pipe(TokioIo::new(upgraded), inbound, out).await;
    }
    Ok(())
}

/// The files browser's raw bytes: GET / HEAD (with Range) on the workspace's read-only file server; any request
/// body the server sends is ignored.
async fn files(root: &Path, open: &TunnelOpen, out: &Out) -> anyhow::Result<()> {
    anyhow::ensure!(!open.upgrade, t!("工作区文件不支持升级连接"));
    let mut req = Request::builder().method(open.method.as_str()).uri(&open.path);
    for (k, v) in &open.headers {
        req = req.header(k, v);
    }
    relay(crate::static_site::answer(root, &req.body(())?, false).await, out).await
}

async fn answer(out: &Out, status: u16, content_type: &str, body: Vec<u8>) {
    let head = TunnelHead { status, headers: vec![("content-type".into(), content_type.into())] };
    if !out.json(FrameType::Head, &head).await {
        return;
    }
    for chunk in body.chunks(64 * 1024) {
        if !out.send(FrameType::Data, Bytes::copy_from_slice(chunk)).await {
            return;
        }
    }
    out.send(FrameType::End, Bytes::new()).await;
}

async fn head<B>(res: &hyper::Response<B>, out: &Out) {
    let headers = res.headers().iter().map(|(k, v)| (k.to_string(), String::from_utf8_lossy(v.as_bytes()).into()));
    out.json(FrameType::Head, &TunnelHead { status: res.status().as_u16(), headers: headers.collect() }).await;
}

/// Head, then the body as data frames, then End.
async fn relay<B>(res: hyper::Response<B>, out: &Out) -> anyhow::Result<()>
where
    B: hyper::body::Body<Data = Bytes> + Unpin,
    B::Error: std::error::Error + Send + Sync + 'static,
{
    head(&res, out).await;
    let mut body = res.into_body();
    while let Some(frame) = body.frame().await {
        if let Ok(data) = frame?.into_data()
            && !out.send(FrameType::Data, data).await
        {
            return Ok(());
        }
    }
    out.send(FrameType::End, Bytes::new()).await;
    Ok(())
}

/// Raw bytes both ways after a 101; each side's End half-closes, a reset from the server drops the connection.
async fn pipe(
    io: impl AsyncRead + AsyncWrite + Send + 'static,
    mut inbound: mpsc::Receiver<Inbound>,
    out: &Out,
) -> anyhow::Result<()> {
    let (mut r, mut w) = tokio::io::split(io);
    let down = {
        let out = out.clone();
        tokio::spawn(async move {
            let mut buf = vec![0u8; 16 * 1024];
            while let Ok(n) = r.read(&mut buf).await
                && n > 0
            {
                if !out.send(FrameType::Data, Bytes::copy_from_slice(&buf[..n])).await {
                    return;
                }
            }
            out.send(FrameType::End, Bytes::new()).await;
        })
    };
    while let Some(i) = inbound.recv().await {
        match i {
            Inbound::Data(b) => w.write_all(&b).await?,
            Inbound::End => {
                w.shutdown().await?;
                return Ok(down.await?);
            }
            Inbound::Reset => break,
        }
    }
    down.abort();
    Ok(())
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod terminal_tests {
    use super::*;
    use crate::protocol::{TerminalDaemonControl, TerminalOpen, TerminalOpenAction, TerminalStatus, WorkspaceSpec};
    use base64::Engine;
    use tokio::net::{TcpListener, TcpStream};

    type ServerWs = WebSocketStream<TcpStream>;

    struct Fixture {
        _home: tempfile::TempDir,
        work: tempfile::TempDir,
        manager: TerminalManager,
    }

    impl Fixture {
        fn new() -> Self {
            let (home, work) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
            let manager = TerminalManager::new(home.path().to_path_buf());
            Self { _home: home, work, manager }
        }

        fn open(&self, action: TerminalOpenAction, session_id: &str) -> TerminalOpen {
            TerminalOpen {
                action,
                session_id: session_id.into(),
                group_id: "g".into(),
                bot_id: "b".into(),
                workspace: WorkspaceSpec {
                    repo: None,
                    cd_path: Some(self.work.path().to_string_lossy().into_owned()),
                    protect_base: false,
                    extra_dirs: vec![],
                    extra_repos: vec![],
                },
                cols: 80,
                rows: 24,
                after: 0,
                cwd: None,
            }
        }

        /// The server's end of a tunnel that serves this fixture's terminals.
        async fn connect(&self) -> ServerWs {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let (manager, home) = (self.manager.clone(), self._home.path().to_path_buf());
            tokio::spawn(async move {
                let tcp = TcpStream::connect(addr).await.unwrap();
                let (ws, _) = tokio_tungstenite::client_async(format!("ws://{addr}/"), tcp).await.unwrap();
                serve_inner(ws, Allow::default(), home, Some(manager)).await
            });
            let (tcp, _) = listener.accept().await.unwrap();
            tokio_tungstenite::accept_async(tcp).await.unwrap()
        }
    }

    fn encode(stream_id: u32, kind: FrameType, payload: impl Into<Bytes>) -> Message {
        Message::Binary(Frame { stream_id, kind, payload: payload.into() }.encode())
    }

    fn open_frame(stream_id: u32, terminal: TerminalOpen) -> Message {
        let open = TunnelOpen {
            target: TunnelTarget::Terminal { terminal: Box::new(terminal) },
            method: "TERMINAL".into(),
            path: "/".into(),
            headers: vec![],
            upgrade: true,
        };
        encode(stream_id, FrameType::Open, serde_json::to_vec(&open).unwrap())
    }

    async fn next(source: &mut futures_util::stream::SplitStream<ServerWs>) -> Frame {
        loop {
            let msg = tokio::time::timeout(Duration::from_secs(10), source.next())
                .await
                .expect("the tunnel went silent")
                .unwrap()
                .unwrap();
            if let Message::Binary(bytes) = msg {
                return Frame::decode(bytes).unwrap();
            }
        }
    }

    fn output(frame: &Frame) -> Vec<u8> {
        let value: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
        base64::engine::general_purpose::STANDARD.decode(value["data"].as_str().unwrap()).unwrap()
    }

    #[tokio::test]
    async fn a_terminal_whose_input_backs_up_is_reset_without_stalling_the_tunnel() {
        let fixture = Fixture::new();
        let (mut sink, mut source) = fixture.connect().await.split();
        let (first, second) = (uuid::Uuid::new_v4().to_string(), uuid::Uuid::new_v4().to_string());
        sink.send(open_frame(1, fixture.open(TerminalOpenAction::Create, &first))).await.unwrap();
        assert_eq!(next(&mut source).await.kind, FrameType::Head);
        let command = "stty raw -echo; printf 'GG_%s\\n' RAW_READY; sleep 60\r";
        sink.send(encode(1, FrameType::Data, command)).await.unwrap();
        let mut seen = vec![];
        while !String::from_utf8_lossy(&seen).contains("GG_RAW_READY") {
            let frame = next(&mut source).await;
            assert_eq!((frame.stream_id, frame.kind), (1, FrameType::Data));
            seen.extend(output(&frame));
        }

        // A paste the foreground program never reads: far more than the PTY and every queue on the way hold.
        let flood = tokio::spawn(async move {
            for _ in 0..1024 {
                sink.send(encode(1, FrameType::Data, vec![b'x'; 16 * 1024])).await.unwrap();
            }
            sink
        });
        let mut sink = tokio::time::timeout(Duration::from_secs(10), flood)
            .await
            .expect("the tunnel stopped reading behind one terminal")
            .unwrap();
        loop {
            let frame = next(&mut source).await;
            assert_eq!(frame.stream_id, 1);
            if frame.kind == FrameType::Reset {
                break;
            }
        }

        sink.send(open_frame(2, fixture.open(TerminalOpenAction::Create, &second))).await.unwrap();
        let head = loop {
            let frame = next(&mut source).await;
            if frame.stream_id != 1 {
                break frame;
            }
        };
        assert_eq!((head.stream_id, head.kind), (2, FrameType::Head));
        assert_eq!(fixture.manager.head(&first).await.unwrap().status, TerminalStatus::Running);

        for (stream_id, session_id) in [(3, &first), (4, &second)] {
            sink.send(open_frame(stream_id, fixture.open(TerminalOpenAction::Terminate, session_id))).await.unwrap();
            let exit = loop {
                let frame = next(&mut source).await;
                if (frame.stream_id, frame.kind) == (stream_id, FrameType::Head) {
                    break serde_json::from_slice::<TerminalDaemonControl>(&frame.payload).unwrap();
                }
            };
            let TerminalDaemonControl::Exit { state, .. } = exit else { panic!("{exit:?}") };
            assert_eq!(state, TerminalStatus::Closed);
        }
    }

    #[tokio::test]
    async fn a_viewer_that_stops_reading_is_detached_and_the_shell_survives() {
        let fixture = Fixture::new();
        let session_id = uuid::Uuid::new_v4().to_string();
        let (tx, mut frames) = mpsc::channel(OUTBOX);
        let (input, inbox) = mpsc::channel(INBOX);
        let open = fixture.open(TerminalOpenAction::Create, &session_id);
        let stream = tokio::spawn(terminal_stream(fixture.manager.clone(), open, Out { id: 1, tx }, inbox));
        assert_eq!(frames.recv().await.unwrap().kind, FrameType::Head);
        input.send(Bytes::from("exec yes\r")).await.unwrap();
        // The socket stalls while the shell floods: the outbox and the session's event queue both fill up.
        tokio::time::sleep(Duration::from_millis(1500)).await;
        let ended = tokio::time::timeout(Duration::from_secs(15), async {
            while let Some(frame) = frames.recv().await {
                if frame.kind == FrameType::End {
                    return;
                }
            }
            panic!("terminal stream closed without detaching");
        });
        ended.await.expect("the stalled viewer was never detached");
        stream.await.unwrap();
        assert_eq!(fixture.manager.head(&session_id).await.unwrap().status, TerminalStatus::Running);
        fixture.manager.terminate(&session_id).await.unwrap();
    }
}
