use futures_util::{SinkExt, StreamExt};
use gonggong::config::Config;
use gonggong::protocol::{
    AgentInfo, AgentKind, DaemonToServer, MachineInfo, RejectReason, RunDone, RunEvent, RunOutcome, ServerToDaemon,
};
use gonggong::service::{Fatal, Handler, Outbox, Service};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::Message;

#[derive(Clone, Default)]
struct Recorder(Arc<Mutex<Vec<ServerToDaemon>>>, Arc<Mutex<Option<Outbox>>>);
impl Handler for Recorder {
    fn handle(&self, msg: ServerToDaemon, out: &Outbox) {
        if matches!(msg, ServerToDaemon::RunCancel { .. }) {
            out.send(DaemonToServer::Heartbeat);
        }
        *self.1.lock().unwrap() = Some(out.clone());
        self.0.lock().unwrap().push(msg);
    }

    fn active_runs(&self) -> Vec<String> {
        vec!["r-live".into()]
    }
}

fn service(port: u16, handler: Recorder) -> Service<Recorder> {
    with_agents(port, handler, watch::channel(vec![]).1)
}

fn with_agents(port: u16, handler: Recorder, agents: watch::Receiver<Vec<AgentInfo>>) -> Service<Recorder> {
    Service {
        config: Config {
            server: format!("http://127.0.0.1:{port}"),
            token: "mt_1".into(),
            machine_id: "m1".into(),
            owner_name: "王磊".into(),
            cert_sha256: None,
        },
        machine: MachineInfo { name: "m".into(), os: "macos".into(), arch: "aarch64".into(), ..Default::default() },
        agents,
        handler,
        max_backoff: Duration::from_millis(50),
        upgrader: None,
        monitor: Default::default(),
    }
}

async fn text(
    ws: &mut (impl StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin),
) -> serde_json::Value {
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

#[tokio::test]
async fn messages_emitted_while_disconnected_arrive_in_order_after_reconnect() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let rec = Recorder::default();
    let task = tokio::spawn(service(port, rec.clone()).run());

    let (s, _) = listener.accept().await.unwrap();
    let mut ws = tokio_tungstenite::accept_async(s).await.unwrap();
    assert_eq!(text(&mut ws).await["activeRuns"], serde_json::json!(["r-live"]));
    ws.send(Message::text(r#"{"t":"welcome","machineId":"m1","heartbeatSec":60,"upgrade":null}"#)).await.unwrap();
    ws.send(Message::text(r#"{"t":"run.cancel","runId":"r9"}"#)).await.unwrap();
    assert_eq!(text(&mut ws).await["t"], "heartbeat");
    let out = rec.1.lock().unwrap().clone().unwrap();

    // Server goes away mid-run; the turn keeps reporting.
    ws.close(None).await.unwrap();
    drop(ws);
    tokio::time::sleep(Duration::from_millis(200)).await;
    let delta = |d: &str| DaemonToServer::RunEvent {
        run_id: "r1".into(),
        event: RunEvent::Text { delta: d.into(), agent_id: None },
    };
    out.send(delta("sur"));
    out.send(delta("vived"));
    out.send(DaemonToServer::RunDone(RunDone {
        run_id: "r1".into(),
        outcome: RunOutcome::Completed,
        reply: "survived".into(),
        files_changed: 0,
        usage: None,
        session_id: None,
        new_session_reason: None,
        error: None,
        git: None,
        patch: None,
        appends_applied: 0,
    }));
    out.send(DaemonToServer::RunDiscarded { run_id: "r0".into(), ok: true, files: 1, error: None });
    tokio::time::sleep(Duration::from_millis(300)).await;

    let (s, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept()).await.unwrap().unwrap();
    let mut ws = tokio_tungstenite::accept_async(s).await.unwrap();
    let hello = text(&mut ws).await;
    // r1 ended locally: its run.done is on its way, so the server must not reconcile it as lost.
    assert_eq!(hello["activeRuns"], serde_json::json!(["r-live", "r1"]));
    ws.send(Message::text(r#"{"t":"welcome","machineId":"m1","heartbeatSec":60,"upgrade":null}"#)).await.unwrap();
    let got = [text(&mut ws).await, text(&mut ws).await, text(&mut ws).await];
    assert_eq!(got[0]["t"], "run.event");
    assert_eq!(got[0]["event"]["delta"], "survived");
    assert_eq!(got[1]["t"], "run.done");
    assert_eq!(got[1]["reply"], "survived");
    assert_eq!(got[2]["t"], "run.discarded");
    task.abort();
}

#[tokio::test]
async fn reports_agent_detection_changes_after_hello() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let claude = |available| AgentInfo {
        kind: AgentKind::Claude,
        available,
        version: None,
        path: Some("/bin/claude".into()),
        min_version: None,
    };
    let (tx, rx) = watch::channel(vec![claude(false)]);
    let task = tokio::spawn(with_agents(port, Recorder::default(), rx).run());
    let (s, _) = listener.accept().await.unwrap();
    let mut ws = tokio_tungstenite::accept_async(s).await.unwrap();
    assert_eq!(text(&mut ws).await["agents"][0]["available"], false);
    ws.send(Message::text(r#"{"t":"welcome","machineId":"m1","heartbeatSec":1}"#)).await.unwrap();

    assert!(gonggong::daemon::publish_agents(&tx, vec![claude(true)]));
    let update = text(&mut ws).await;
    assert_eq!((update["t"].as_str(), &update["agents"][0]["available"]), (Some("agents.update"), &true.into()));
    // An unchanged detection is not reported: the next message is the heartbeat.
    assert!(!gonggong::daemon::publish_agents(&tx, vec![claude(true)]));
    assert_eq!(text(&mut ws).await["t"], "heartbeat");
    task.abort();
}
