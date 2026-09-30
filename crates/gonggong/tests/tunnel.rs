use futures_util::{SinkExt, StreamExt};
use gonggong::protocol::{
    SnapshotTarget, TunnelHead, TunnelOpen, TunnelReset, TunnelTarget, WorkspaceFiles, WorkspaceSpec,
};
use gonggong::tunnel::{self, Allow, Frame, FrameType};
use http_body_util::{BodyExt, Full, StreamBody};
use hyper::body::{Bytes, Frame as BodyFrame, Incoming};
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;

type ServerWs = WebSocketStream<TcpStream>;

/// A dev server: /hello, /echo (POST body back), /stream (three chunks).
async fn app(
    req: Request<Incoming>,
) -> Result<Response<http_body_util::combinators::BoxBody<Bytes, Infallible>>, Infallible> {
    let res = match req.uri().path() {
        "/hello" => Response::builder()
            .header("set-cookie", "a=1")
            .header("set-cookie", "b=2")
            .header("x-host-seen", req.headers()["host"].to_str().unwrap().to_string())
            .body(Full::new(Bytes::from("hi")).boxed()),
        "/echo" => {
            let body = req.into_body().collect().await.unwrap().to_bytes();
            Response::builder().status(201).body(Full::new(body).boxed())
        }
        _ => {
            let chunks = ["one ", "two ", "three"].map(|c| Ok::<_, Infallible>(BodyFrame::data(Bytes::from(c))));
            Response::builder().body(BodyExt::boxed(StreamBody::new(futures_util::stream::iter(chunks))))
        }
    };
    Ok(res.unwrap())
}

async fn dev_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let (s, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let _ = hyper::server::conn::http1::Builder::new()
                    .serve_connection(TokioIo::new(s), hyper::service::service_fn(app))
                    .await;
            });
        }
    });
    port
}

/// Answers any upgrade with 101 and then echoes raw bytes.
async fn echo_upgrade_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (mut s, _) = listener.accept().await.unwrap();
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            let mut b = [0u8; 1];
            s.read_exact(&mut b).await.unwrap();
            head.push(b[0]);
        }
        assert!(String::from_utf8_lossy(&head).to_ascii_lowercase().contains("upgrade: echo"));
        s.write_all(b"HTTP/1.1 101 Switching Protocols\r\nconnection: upgrade\r\nupgrade: echo\r\n\r\n").await.unwrap();
        let mut buf = [0u8; 1024];
        loop {
            let n = s.read(&mut buf).await.unwrap();
            if n == 0 {
                break;
            }
            s.write_all(&buf[..n]).await.unwrap();
        }
    });
    port
}

/// The server's end of a tunnel connection served by `tunnel::serve`.
async fn connect(allow: Allow) -> ServerWs {
    connect_home(allow, std::env::temp_dir()).await
}

async fn connect_home(allow: Allow, home: std::path::PathBuf) -> ServerWs {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let tcp = TcpStream::connect(addr).await.unwrap();
        let (ws, _) = tokio_tungstenite::client_async(format!("ws://{addr}/ws/daemon/tunnel"), tcp).await.unwrap();
        tunnel::serve(ws, allow, home).await
    });
    let (s, _) = listener.accept().await.unwrap();
    tokio_tungstenite::accept_async(s).await.unwrap()
}

async fn send(ws: &mut ServerWs, stream_id: u32, kind: FrameType, payload: impl Into<Bytes>) {
    let frame = Frame { stream_id, kind, payload: payload.into() };
    ws.send(Message::Binary(frame.encode())).await.unwrap();
}

async fn open(ws: &mut ServerWs, stream_id: u32, open: TunnelOpen) {
    send(ws, stream_id, FrameType::Open, serde_json::to_vec(&open).unwrap()).await;
}

async fn next(ws: &mut ServerWs) -> Frame {
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(10), ws.next()).await.expect("no frame").unwrap().unwrap();
        if let Message::Binary(b) = msg {
            return Frame::decode(b).unwrap();
        }
    }
}

/// Head, then the body until End.
async fn response(ws: &mut ServerWs, stream_id: u32) -> (TunnelHead, String) {
    let head = next(ws).await;
    assert_eq!((head.stream_id, head.kind), (stream_id, FrameType::Head), "{head:?}");
    let head: TunnelHead = serde_json::from_slice(&head.payload).unwrap();
    let mut body = Vec::new();
    loop {
        let f = next(ws).await;
        assert_eq!(f.stream_id, stream_id);
        match f.kind {
            FrameType::Data => body.extend_from_slice(&f.payload),
            FrameType::End => return (head, String::from_utf8(body).unwrap()),
            other => panic!("unexpected {other:?}"),
        }
    }
}

fn req(preview: &str, port: u16, method: &str, path: &str) -> TunnelOpen {
    TunnelOpen {
        target: TunnelTarget::Preview { preview_id: preview.into(), port },
        method: method.into(),
        path: path.into(),
        headers: vec![("host".into(), format!("127.0.0.1:{port}"))],
        upgrade: false,
    }
}

fn allow(pairs: &[(&str, u16)]) -> Allow {
    let allow = Allow::default();
    tunnel::set_allowed(&allow, pairs.iter().map(|(id, port)| (id.to_string(), *port)).collect());
    allow
}

#[tokio::test]
async fn forwards_requests_to_allowed_loopback_ports() {
    let port = dev_server().await;
    let mut ws = connect(allow(&[("p1", port)])).await;

    open(&mut ws, 1, req("p1", port, "GET", "/hello")).await;
    send(&mut ws, 1, FrameType::End, Bytes::new()).await;
    let (head, body) = response(&mut ws, 1).await;
    assert_eq!((head.status, body.as_str()), (200, "hi"));
    let cookies: Vec<_> = head.headers.iter().filter(|(k, _)| k == "set-cookie").map(|(_, v)| v.as_str()).collect();
    assert_eq!(cookies, ["a=1", "b=2"], "repeated headers survive");
    assert!(head.headers.contains(&("x-host-seen".into(), format!("127.0.0.1:{port}"))));

    let mut post = req("p1", port, "POST", "/echo");
    post.headers.push(("content-length".into(), "6".into()));
    open(&mut ws, 3, post).await;
    send(&mut ws, 3, FrameType::Data, "abc").await;
    send(&mut ws, 3, FrameType::Data, "def").await;
    send(&mut ws, 3, FrameType::End, Bytes::new()).await;
    assert_eq!(response(&mut ws, 3).await.1, "abcdef");

    open(&mut ws, 5, req("p1", port, "GET", "/stream")).await;
    send(&mut ws, 5, FrameType::End, Bytes::new()).await;
    assert_eq!(response(&mut ws, 5).await.1, "one two three");
}

#[tokio::test]
async fn resets_a_request_body_the_local_port_does_not_take() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let _held = tokio::spawn(async move {
        let (s, _) = listener.accept().await.unwrap();
        std::future::pending::<()>().await;
        drop(s);
    });
    let mut ws = connect(allow(&[("p1", port)])).await;
    let mut upload = req("p1", port, "POST", "/upload");
    upload.headers.push(("content-length".into(), (1u64 << 30).to_string()));
    open(&mut ws, 1, upload).await;
    let chunk = Bytes::from(vec![0u8; 64 * 1024]);
    let sent = async {
        for _ in 0..1024 {
            send(&mut ws, 1, FrameType::Data, chunk.clone()).await;
        }
    };
    tokio::time::timeout(Duration::from_secs(20), sent).await.expect("the daemon stopped reading the tunnel");
    let f = next(&mut ws).await;
    assert_eq!((f.stream_id, f.kind), (1, FrameType::Reset), "{f:?}");
}

#[tokio::test]
async fn refuses_ports_without_an_open_preview_and_reports_dead_ones() {
    let port = dev_server().await;
    let dead = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let mut ws = connect(allow(&[("p1", port), ("p2", dead)])).await;

    for (id, preview, p) in [(1, "p1", dead), (3, "nope", port)] {
        open(&mut ws, id, req(preview, p, "GET", "/hello")).await;
        let f = next(&mut ws).await;
        assert_eq!((f.stream_id, f.kind), (id, FrameType::Reset));
    }
    open(&mut ws, 5, req("p2", dead, "GET", "/")).await;
    let f = next(&mut ws).await;
    assert_eq!((f.stream_id, f.kind), (5, FrameType::Reset));
    let reset: TunnelReset = serde_json::from_slice(&f.payload).unwrap();
    assert!(reset.reason.contains(&dead.to_string()), "{}", reset.reason);
}

#[tokio::test]
async fn mini_program_snapshots_need_a_project_and_no_open_port() {
    let mut ws = connect(allow(&[])).await;
    let dir = tempfile::tempdir().unwrap();
    let target = SnapshotTarget::Miniprogram {
        preview_id: "p9".into(),
        miniprogram: dir.path().display().to_string(),
        launch: None,
    };
    let shot = TunnelOpen {
        target: TunnelTarget::Snapshot { snapshot: target },
        method: "GET".into(),
        path: "/pages/index/index".into(),
        headers: vec![],
        upgrade: false,
    };
    open(&mut ws, 7, shot).await;
    let f = next(&mut ws).await;
    assert_eq!((f.stream_id, f.kind), (7, FrameType::Reset));
    let reset: TunnelReset = serde_json::from_slice(&f.payload).unwrap();
    assert!(reset.reason.contains("不是小程序项目"), "{}", reset.reason);
}

#[tokio::test]
async fn pipes_upgraded_connections_as_raw_bytes() {
    let port = echo_upgrade_server().await;
    let mut ws = connect(allow(&[("p1", port)])).await;
    let mut o = req("p1", port, "GET", "/ws");
    o.upgrade = true;
    o.headers.extend([("connection".into(), "Upgrade".into()), ("upgrade".into(), "echo".into())]);
    open(&mut ws, 1, o).await;
    let head = next(&mut ws).await;
    assert_eq!(head.kind, FrameType::Head);
    assert_eq!(serde_json::from_slice::<TunnelHead>(&head.payload).unwrap().status, 101);

    send(&mut ws, 1, FrameType::Data, "ping").await;
    let echoed = next(&mut ws).await;
    assert_eq!((echoed.kind, &echoed.payload[..]), (FrameType::Data, &b"ping"[..]));
    send(&mut ws, 1, FrameType::End, Bytes::new()).await;
    assert_eq!(next(&mut ws).await.kind, FrameType::End);
}

/// Raw bytes of a response, for binary bodies.
async fn raw_response(ws: &mut ServerWs, stream_id: u32) -> (TunnelHead, Vec<u8>) {
    let head = next(ws).await;
    assert_eq!((head.stream_id, head.kind), (stream_id, FrameType::Head), "{head:?}");
    let head: TunnelHead = serde_json::from_slice(&head.payload).unwrap();
    let mut body = Vec::new();
    loop {
        let f = next(ws).await;
        match f.kind {
            FrameType::Data => body.extend_from_slice(&f.payload),
            FrameType::End => return (head, body),
            other => panic!("unexpected {other:?}"),
        }
    }
}

/// A files-browser stream into the managed empty workspace of (g1, b1).
fn files(path: &str, headers: Vec<(String, String)>) -> TunnelOpen {
    TunnelOpen {
        target: TunnelTarget::Files {
            files: WorkspaceFiles {
                group_id: "g1".into(),
                bot_id: "b1".into(),
                workspace: WorkspaceSpec { repo: None, cd_path: None },
            },
        },
        method: "GET".into(),
        path: path.into(),
        headers,
        upgrade: false,
    }
}

#[tokio::test]
async fn serves_workspace_files_with_ranges_without_any_open_preview() {
    let home = tempfile::tempdir().unwrap();
    let root = home.path().join("workspaces/g1/b1/_empty");
    std::fs::create_dir_all(root.join("media")).unwrap();
    std::fs::write(root.join("media/demo clip.mp4"), b"0123456789").unwrap();
    std::fs::write(home.path().join("secret.txt"), b"s").unwrap();
    let mut ws = connect_home(Allow::default(), home.path().to_path_buf()).await;
    open(&mut ws, 1, files("/media/demo%20clip.mp4", vec![("range".into(), "bytes=4-".into())])).await;
    send(&mut ws, 1, FrameType::End, Bytes::new()).await;
    let (head, body) = raw_response(&mut ws, 1).await;
    assert_eq!((head.status, body.as_slice()), (206, &b"456789"[..]));
    assert!(head.headers.contains(&("content-range".into(), "bytes 4-9/10".into())));
    assert!(head.headers.contains(&("content-type".into(), "video/mp4".into())));

    open(&mut ws, 3, files("/media/demo%20clip.mp4", vec![("range".into(), "bytes=20-".into())])).await;
    assert_eq!(raw_response(&mut ws, 3).await.0.status, 416);
    open(&mut ws, 5, files("/../../../secret.txt", vec![])).await;
    assert_eq!(raw_response(&mut ws, 5).await.0.status, 404);

    let mut up = files("/media/demo%20clip.mp4", vec![]);
    up.upgrade = true;
    open(&mut ws, 7, up).await;
    assert_eq!(next(&mut ws).await.kind, FrameType::Reset);
}

#[tokio::test]
async fn a_reset_stops_reading_the_workspace_file() {
    let home = tempfile::tempdir().unwrap();
    let root = home.path().join("workspaces/g1/b1/_empty");
    std::fs::create_dir_all(&root).unwrap();
    let size = 48 * 1024 * 1024;
    std::fs::write(root.join("big.webm"), vec![7u8; size]).unwrap();
    let mut ws = connect_home(Allow::default(), home.path().to_path_buf()).await;
    open(&mut ws, 1, files("/big.webm", vec![])).await;
    send(&mut ws, 1, FrameType::End, Bytes::new()).await;
    assert_eq!(next(&mut ws).await.kind, FrameType::Head);
    send(&mut ws, 1, FrameType::Reset, serde_json::to_vec(&TunnelReset { reason: "gone".into() }).unwrap()).await;
    let mut got = 0;
    while let Ok(Some(Ok(Message::Binary(b)))) = tokio::time::timeout(Duration::from_millis(500), ws.next()).await {
        let f = Frame::decode(b).unwrap();
        assert_ne!(f.kind, FrameType::End, "the whole file was sent");
        got += f.payload.len();
    }
    assert!(got < size, "{got}");
}
