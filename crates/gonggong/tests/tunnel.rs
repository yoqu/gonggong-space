use futures_util::{SinkExt, StreamExt};
use gonggong::protocol::{TunnelHead, TunnelOpen, TunnelReset};
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
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let tcp = TcpStream::connect(addr).await.unwrap();
        let (ws, _) = tokio_tungstenite::client_async(format!("ws://{addr}/ws/daemon/tunnel"), tcp).await.unwrap();
        tunnel::serve(ws, allow).await
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
        preview_id: preview.into(),
        port,
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
