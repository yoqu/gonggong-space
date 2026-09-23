use aiws::config::Config;
use aiws::protocol::{DaemonToServer, MachineInfo, RejectReason, ServerToDaemon};
use aiws::service::{Fatal, Handler, Outbox, Service};
use futures_util::{SinkExt, StreamExt};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

#[derive(Clone, Default)]
struct Recorder(Arc<Mutex<Vec<ServerToDaemon>>>);
impl Handler for Recorder {
    fn handle(&self, msg: ServerToDaemon, out: &Outbox) {
        if matches!(msg, ServerToDaemon::RunCancel { .. }) {
            out.send(DaemonToServer::Heartbeat);
        }
        self.0.lock().unwrap().push(msg);
    }
}

fn service(port: u16, handler: Recorder) -> Service<Recorder> {
    Service {
        config: Config { server: format!("http://127.0.0.1:{port}"), token: "mt_1".into(), machine_id: "m1".into(), owner_name: "王磊".into() },
        machine: MachineInfo { name: "m".into(), os: "macos".into(), arch: "aarch64".into() },
        agents: vec![],
        handler,
        max_backoff: Duration::from_millis(50),
    }
}

async fn text(ws: &mut (impl StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin)) -> serde_json::Value {
    loop {
        if let Message::Text(t) = ws.next().await.unwrap().unwrap() {
            return serde_json::from_str(&t).unwrap();
        }
    }
}

#[tokio::test]
async fn handshakes_heartbeats_reconnects_and_stops_on_reject() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let rec = Recorder::default();
    let task = tokio::spawn(service(port, rec.clone()).run());

    // 1st connection: hello carries the token, heartbeats flow, server messages reach the handler.
    let (s, _) = listener.accept().await.unwrap();
    let mut ws = tokio_tungstenite::accept_async(s).await.unwrap();
    let hello = text(&mut ws).await;
    assert_eq!(hello["t"], "hello");
    assert_eq!(hello["token"], "mt_1");
    ws.send(Message::text(r#"{"t":"welcome","machineId":"m1","heartbeatSec":1}"#)).await.unwrap();
    ws.send(Message::text(r#"{"t":"run.cancel","runId":"r9"}"#)).await.unwrap();
    assert_eq!(text(&mut ws).await["t"], "heartbeat"); // reply queued by the handler via Outbox
    assert_eq!(text(&mut ws).await["t"], "heartbeat"); // periodic
    assert_eq!(rec.0.lock().unwrap().len(), 1);
    drop(ws);

    // 2nd connection after the drop: daemon reconnects by itself, then gets revoked.
    let (s, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept()).await.unwrap().unwrap();
    let mut ws = tokio_tungstenite::accept_async(s).await.unwrap();
    assert_eq!(text(&mut ws).await["t"], "hello");
    ws.send(Message::text(r#"{"t":"reject","reason":"revoked","message":"machine token revoked"}"#)).await.unwrap();

    let fatal = tokio::time::timeout(Duration::from_secs(5), task).await.unwrap().unwrap();
    assert!(matches!(fatal, Fatal::Rejected { reason: RejectReason::Revoked, .. }));
}

#[tokio::test]
async fn keeps_retrying_while_server_is_down() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let task = tokio::spawn(service(port, Recorder::default()).run());
    tokio::time::sleep(Duration::from_millis(300)).await;
    let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    let (s, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept()).await.unwrap().unwrap();
    let mut ws = tokio_tungstenite::accept_async(s).await.unwrap();
    assert_eq!(text(&mut ws).await["t"], "hello");
    task.abort();
}
