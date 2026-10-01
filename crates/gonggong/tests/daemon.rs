use futures_util::{SinkExt, StreamExt};
use gonggong::config::Config;
use gonggong::daemon::{Daemon, Options};
use gonggong::lock::{Lock, LockError};
use gonggong::protocol::RejectReason;
use gonggong::service::Fatal;
use gonggong::status::{Conn, Status};
use std::path::Path;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::Message;

fn options(home: &Path, port: u16) -> Options {
    gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
    Options {
        home: home.to_path_buf(),
        config: Config {
            server: format!("http://127.0.0.1:{port}"),
            token: "mt_1".into(),
            machine_id: "m1".into(),
            owner_name: "王磊".into(),
            cert_sha256: None,
        },
        adapter_cmd: None,
        self_upgrade: false,
    }
}

async fn until(rx: &mut watch::Receiver<Status>, what: &str, f: impl Fn(&Status) -> bool) -> Status {
    let got = tokio::time::timeout(Duration::from_secs(5), rx.wait_for(|s| f(s))).await.map(|s| s.unwrap().clone());
    got.unwrap_or_else(|_| panic!("timed out waiting for {what}: {:?}", rx.borrow()))
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

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64
}

#[test]
fn the_lock_admits_one_daemon_per_home_until_released() {
    gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
    let home = tempfile::tempdir().unwrap();
    let lock = Lock::acquire(home.path()).unwrap();
    assert_eq!(std::fs::read_to_string(home.path().join("daemon.lock")).unwrap(), std::process::id().to_string());
    let err = Lock::acquire(home.path()).err().expect("second acquire must fail");
    assert!(matches!(err, LockError::Held { pid: Some(p) } if p == std::process::id()));
    assert!(err.to_string().contains("已有共工空间 daemon 在运行"), "{err}");
    drop(lock);
    // A child forked by a concurrent test may briefly share the descriptor until it execs.
    let reacquired = (0..50).any(|_| {
        Lock::acquire(home.path()).is_ok() || {
            std::thread::sleep(Duration::from_millis(20));
            false
        }
    });
    assert!(reacquired);
}

#[tokio::test]
async fn reports_connection_heartbeat_latency_reconnects_and_wipes_on_revoke() {
    let home = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(home.path().join("workspaces/g1/b1/_empty")).unwrap();
    std::fs::create_dir_all(home.path().join("backups/g1")).unwrap();
    std::fs::write(home.path().join("config.json"), "{}").unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let daemon = Daemon::start(options(home.path(), port)).unwrap();
    let mut rx = daemon.subscribe();
    assert!(matches!(daemon.status().conn, Conn::Connecting | Conn::Offline { .. }));
    let again = Daemon::start(options(home.path(), port)).err().expect("a second daemon on the same home must refuse");
    assert!(again.to_string().contains("已有共工空间 daemon 在运行"), "{again}");

    let (s, _) = listener.accept().await.unwrap();
    let mut ws = tokio_tungstenite::accept_async(s).await.unwrap();
    assert_eq!(text(&mut ws).await["t"], "hello");
    ws.send(Message::text(r#"{"t":"welcome","machineId":"m1","heartbeatSec":1,"upgrade":null}"#)).await.unwrap();
    let online = until(&mut rx, "online", |s| matches!(s.conn, Conn::Online { .. })).await;
    assert_eq!(online.heartbeat_sec, Some(1));
    assert_eq!(text(&mut ws).await["t"], "heartbeat"); // reading also answers the daemon's ping
    let beat =
        until(&mut rx, "heartbeat and latency", |s| s.last_heartbeat_ms.is_some() && s.latency_ms.is_some()).await;
    assert!(beat.last_heartbeat_ms.unwrap() <= now_ms());

    drop(ws);
    let offline = until(&mut rx, "offline", |s| matches!(s.conn, Conn::Offline { .. })).await;
    let Conn::Offline { retry_at_ms, .. } = offline.conn else { unreachable!() };
    assert!(retry_at_ms > now_ms() - 100, "next retry lies ahead");

    let (s, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept()).await.unwrap().unwrap();
    let mut ws = tokio_tungstenite::accept_async(s).await.unwrap();
    assert_eq!(text(&mut ws).await["t"], "hello");
    ws.send(Message::text(r#"{"t":"reject","reason":"revoked","message":"machine token revoked"}"#)).await.unwrap();
    let stopped = tokio::time::timeout(Duration::from_secs(5), daemon.wait()).await.unwrap();
    assert!(matches!(stopped.fatal, Fatal::Rejected { reason: RejectReason::Revoked, .. }));
    assert!(stopped.wiped.contains(&home.path().join("workspaces/g1")));
    assert!(!home.path().join("config.json").exists());
    assert!(home.path().join("backups/g1").exists());
    let Conn::Rejected { reason, wiped, .. } = rx.borrow().conn.clone() else { panic!("not rejected") };
    assert_eq!(reason, RejectReason::Revoked);
    assert_eq!(wiped.len(), 2);

    Daemon::start(options(home.path(), port)).expect("the lock is released once the daemon stopped").stop();
}

#[tokio::test]
async fn a_protocol_reject_stops_without_wiping() {
    let home = tempfile::tempdir().unwrap();
    std::fs::write(home.path().join("config.json"), "{}").unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let daemon = Daemon::start(options(home.path(), port)).unwrap();
    let (s, _) = listener.accept().await.unwrap();
    let mut ws = tokio_tungstenite::accept_async(s).await.unwrap();
    text(&mut ws).await;
    ws.send(Message::text(r#"{"t":"reject","reason":"protocol","message":"需要协议 v2"}"#)).await.unwrap();
    let mut rx = daemon.subscribe();
    let s = until(&mut rx, "rejected", |s| matches!(s.conn, Conn::Rejected { .. })).await;
    assert!(
        matches!(s.conn, Conn::Rejected { reason: RejectReason::Protocol, ref message, ref wiped } if message == "需要协议 v2" && wiped.is_empty())
    );
    assert!(home.path().join("config.json").exists());
    daemon.stop();
}
