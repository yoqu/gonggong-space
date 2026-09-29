#![cfg(unix)]

use futures_util::{SinkExt, StreamExt};
use gonggong::protocol::{SnapshotTarget, TunnelHead, TunnelOpen, TunnelTarget};
use gonggong::tunnel::{self, Allow, Frame, FrameType};
use std::os::unix::fs::PermissionsExt;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;

type ServerWs = WebSocketStream<TcpStream>;

async fn connect(allow: Allow) -> ServerWs {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let tcp = TcpStream::connect(addr).await.unwrap();
        let (ws, _) = tokio_tungstenite::client_async(format!("ws://{addr}/ws/daemon/tunnel"), tcp).await.unwrap();
        tunnel::serve(ws, allow, std::env::temp_dir()).await
    });
    let (s, _) = listener.accept().await.unwrap();
    tokio_tungstenite::accept_async(s).await.unwrap()
}

async fn open(ws: &mut ServerWs, stream_id: u32, preview: &str, port: u16) {
    let open = TunnelOpen {
        target: TunnelTarget::Snapshot { snapshot: SnapshotTarget::Page { preview_id: preview.into(), port } },
        method: "GET".into(),
        path: "/login".into(),
        headers: vec![],
        upgrade: false,
    };
    let frame = Frame { stream_id, kind: FrameType::Open, payload: serde_json::to_vec(&open).unwrap().into() };
    ws.send(Message::Binary(frame.encode())).await.unwrap();
}

async fn next(ws: &mut ServerWs) -> Frame {
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(20), ws.next()).await.expect("no frame").unwrap().unwrap();
        if let Message::Binary(b) = msg {
            return Frame::decode(b).unwrap();
        }
    }
}

async fn response(ws: &mut ServerWs) -> (TunnelHead, Vec<u8>) {
    let head = next(ws).await;
    assert_eq!(head.kind, FrameType::Head, "{head:?}");
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

// One test: the browser comes from a process-wide env var.
#[tokio::test]
async fn renders_the_first_screen_of_an_open_preview_with_the_machine_browser() {
    let dir = tempfile::tempdir().unwrap();
    let fake = dir.path().join("chrome");
    std::fs::write(&fake, "#!/bin/sh\nfor a; do last=$a; done\nprintf 'PNG %s' \"$last\" > screenshot.png\n").unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    unsafe { std::env::set_var("GONGGONG_BROWSER", &fake) };
    let allow = Allow::default();
    tunnel::set_allowed(&allow, [("p1".to_string(), 5173)].into());
    let mut ws = connect(allow).await;

    open(&mut ws, 1, "p1", 5173).await;
    let (head, body) = response(&mut ws).await;
    assert_eq!(head.status, 200);
    assert!(head.headers.contains(&("content-type".into(), "image/png".into())));
    assert_eq!(body, b"PNG http://localhost:5173/login");

    open(&mut ws, 3, "p1", 3000).await;
    assert_eq!(next(&mut ws).await.kind, FrameType::Reset);

    unsafe { std::env::set_var("GONGGONG_BROWSER", dir.path().join("missing")) };
    open(&mut ws, 5, "p1", 5173).await;
    assert_eq!(response(&mut ws).await.0.status, 404);
}
