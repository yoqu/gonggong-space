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
/// Frames waiting for the socket; a full queue slows down reading local responses.
const OUTBOX: usize = 256;
/// Frames a stream's local end may lag behind; beyond it the stream is reset rather than buffered without bound.
const INBOX: usize = 256;

/// Keeps the tunnel connected for the daemon's lifetime, once a server that serves previews has welcomed it.
/// `home` locates managed workspaces for the files browser's streams.
pub async fn run(config: Config, allow: Allow, home: PathBuf, mut offered: tokio::sync::watch::Receiver<bool>) {
    let mut backoff = Duration::from_secs(1);
    loop {
        if offered.wait_for(|on| *on).await.is_err() {
            return;
        }
        match crate::tls::connect_tunnel(&config).await {
            Ok(ws) => {
                backoff = Duration::from_secs(1);
                if let Err(e) = serve(ws, allow.clone(), home.clone()).await {
                    tracing::debug!("tunnel closed: {e:#}");
                }
            }
            Err(e) => tracing::debug!("tunnel connect failed: {e:#}"),
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

enum Inbound {
    Data(Bytes),
    End,
    Reset,
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
    let (mut sink, mut source) = ws.split();
    let (tx, mut rx) = mpsc::channel::<Frame>(OUTBOX);
    let writer = tokio::spawn(async move {
        while let Some(frame) = rx.recv().await {
            if sink.send(Message::Binary(frame.encode())).await.is_err() {
                break;
            }
        }
    });
    let mut streams: HashMap<u32, mpsc::Sender<Inbound>> = HashMap::new();
    // File streams take no request body; the server resets one when the browser drops it (media seeking does
    // that a lot), which must stop reading the file.
    let mut cancels: HashMap<u32, oneshot::Sender<()>> = HashMap::new();
    let result = async {
        while let Some(msg) = source.next().await {
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
                            out.reset(format!("open 无效：{e}")).await;
                            continue;
                        }
                    };
                    let port = match &open.target {
                        TunnelTarget::Preview { preview_id, port } => {
                            if allow.read().unwrap().get(preview_id) != Some(port) {
                                out.reset(format!("端口 {port} 未开放预览")).await;
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
                                out.reset(format!("端口 {port} 未开放预览")).await;
                                continue;
                            }
                            let (port, path) = (*port, open.path.clone());
                            tokio::spawn(async move {
                                match crate::snapshot::capture(port, &path).await {
                                    Ok(Some(png)) => answer(&out, 200, "image/png", png).await,
                                    Ok(None) => {
                                        let msg = "本机没有可用于截图的 Chrome / Edge";
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
                    if let Some(s) = streams.get(&id)
                        && let Err(mpsc::error::TrySendError::Full(_)) = s.try_send(Inbound::Data(frame.payload))
                        && let Some(s) = streams.remove(&id)
                    {
                        let out = Out { id, tx: tx.clone() };
                        tokio::spawn(async move {
                            out.reset("本机端口接收过慢，已断开".into()).await;
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
                    if let Some(s) = streams.remove(&id) {
                        tokio::spawn(async move { s.send(Inbound::Reset).await });
                    }
                    if let Some(c) = cancels.remove(&id) {
                        let _ = c.send(());
                    }
                }
                FrameType::Head => {}
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
            Inbound::Reset => Some((Err(std::io::Error::other("请求已取消")), rx)),
            Inbound::End => None,
        }
    });
    BodyExt::boxed(StreamBody::new(frames))
}

async fn forward(port: u16, open: TunnelOpen, inbound: mpsc::Receiver<Inbound>, out: &Out) -> anyhow::Result<()> {
    let tcp = connect_local(port).await.with_context(|| format!("无法连接本机端口 {port}"))?;
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
    anyhow::ensure!(!open.upgrade, "工作区文件不支持升级连接");
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
