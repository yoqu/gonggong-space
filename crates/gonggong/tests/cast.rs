#![cfg(unix)]
use futures_util::{SinkExt, StreamExt};
use gonggong::cast::{self, Casts};
use gonggong::config::Config;
use gonggong::hosted::{Scope, Services, StartArgs};
use gonggong::protocol::{CastPhase, CastTarget, DaemonToServer};
use gonggong::service::Outbox;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio_tungstenite::tungstenite::Message;

fn config(server: String) -> Config {
    Config { server, token: "mt-1".into(), machine_id: "m1".into(), owner_name: "王磊".into(), cert_sha256: None }
}

type Route = Box<dyn Fn(&str) -> (u16, Vec<u8>) + Send + Sync>;

/// A plain HTTP server answering `METHOD path` lines through `route`; keeps the request lines.
async fn fake_api(route: Route) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let (route, log) = (Arc::new(route), seen.clone());
    tokio::spawn(async move {
        loop {
            let (mut s, _) = listener.accept().await.unwrap();
            let (route, log) = (route.clone(), log.clone());
            tokio::spawn(async move {
                let mut buf = vec![0u8; 8192];
                let n = s.read(&mut buf).await.unwrap();
                let head = String::from_utf8_lossy(&buf[..n]).to_string();
                let line = head.lines().next().unwrap_or_default().to_string();
                log.lock().unwrap().push(line.clone());
                let (status, body) = route(&line);
                let res = format!("HTTP/1.1 {status} X\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len());
                s.write_all(res.as_bytes()).await.unwrap();
                s.write_all(&body).await.unwrap();
            });
        }
    });
    (url, seen)
}

/// gg-cast stand-in: records its arguments, token and pid, then acts as `then` says.
fn fake_cast(dir: &Path, then: &str) -> (PathBuf, PathBuf) {
    let seen = dir.join("seen");
    let bin = dir.join("gg-cast");
    let script = format!(
        "#!/bin/sh\necho \"$@\" > {seen}\necho \"$GG_CAST_TOKEN\" >> {seen}\necho $$ >> {seen}\n{then}\n",
        seen = seen.display()
    );
    std::fs::write(&bin, script).unwrap();
    std::fs::set_permissions(&bin, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    (bin, seen)
}

async fn hosted_service(
    services: &Services,
    root: &Path,
    out: &Outbox,
    rx: &mut UnboundedReceiver<DaemonToServer>,
) -> String {
    let scope = Scope { group_id: "g1".into(), bot_id: "b1".into(), run_id: None, root: root.into(), out: out.clone() };
    let args =
        StartArgs { name: "calc".into(), command: "sleep 30".into(), cwd: None, port: None, env: Default::default() };
    services.start(scope, args).await.unwrap();
    match rx.recv().await.unwrap() {
        DaemonToServer::ServiceState { service } => service.id,
        other => panic!("unexpected {other:?}"),
    }
}

async fn next_cast(rx: &mut UnboundedReceiver<DaemonToServer>) -> (CastPhase, Option<String>) {
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(10), rx.recv()).await.expect("no cast.state").unwrap();
        if let DaemonToServer::CastState { preview_id, state, error } = msg {
            assert_eq!(preview_id, "p1");
            return (state, error);
        }
    }
}

fn alive(pid: u32) -> bool {
    std::process::Command::new("kill").args(["-0", &pid.to_string()]).status().unwrap().success()
}

fn token_route(url: &'static str) -> Route {
    Box::new(move |line| {
        assert!(line.starts_with("POST /api/daemon/previews/p1/cast "), "{line}");
        (200, format!(r#"{{"url":"{url}","token":"tok-1"}}"#).into_bytes())
    })
}

#[tokio::test]
async fn publishes_a_watched_service_window_until_nobody_watches() {
    let (home, root, bins) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (out, mut rx) = Outbox::channel();
    let services = Services::new(home.path());
    let service = hosted_service(&services, root.path(), &out, &mut rx).await;
    let (bin, seen) = fake_cast(bins.path(), "echo live\nexec sleep 30");
    let (api, _) = fake_api(token_route("wss://lk.example.com")).await;
    let casts = Casts::new(Some(config(api)), home.path().into(), services.clone(), Some(bin));

    casts.sync(vec![CastTarget { preview_id: "p1".into(), service: service.clone() }], &out);
    assert_eq!(next_cast(&mut rx).await, (CastPhase::Starting, None));
    assert_eq!(next_cast(&mut rx).await, (CastPhase::Live, None));
    let lines: Vec<String> = std::fs::read_to_string(&seen).unwrap().lines().map(String::from).collect();
    let pid = services.pid(&service).unwrap();
    assert!(lines[0].starts_with(&format!("--url wss://lk.example.com --pids {pid}")), "{}", lines[0]);
    assert_eq!(lines[1], "tok-1");
    let cast_pid: u32 = lines[2].parse().unwrap();
    assert!(alive(cast_pid));

    // Watched again: nothing restarts.
    casts.sync(vec![CastTarget { preview_id: "p1".into(), service }], &out);
    casts.sync(vec![], &out);
    tokio::time::timeout(Duration::from_secs(5), async {
        while alive(cast_pid) {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("gg-cast still running");
    assert!(rx.try_recv().is_err(), "no state after stopping");
    services.stop_all().await;
}

#[tokio::test]
async fn reports_why_gg_cast_failed_and_tries_again() {
    let (home, root, bins) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (out, mut rx) = Outbox::channel();
    let services = Services::new(home.path());
    let service = hosted_service(&services, root.path(), &out, &mut rx).await;
    let (bin, _) = fake_cast(bins.path(), "echo 'starting' >&2\necho '本机没有授予「屏幕录制」权限' >&2\nexit 1");
    let (api, _) = fake_api(token_route("wss://lk.example.com")).await;
    let casts = Casts::new(Some(config(api)), home.path().into(), services.clone(), Some(bin));

    casts.sync(vec![CastTarget { preview_id: "p1".into(), service }], &out);
    assert_eq!(next_cast(&mut rx).await, (CastPhase::Starting, None));
    assert_eq!(next_cast(&mut rx).await, (CastPhase::Failed, Some("本机没有授予「屏幕录制」权限".into())));
    assert_eq!(next_cast(&mut rx).await, (CastPhase::Starting, None));
    casts.sync(vec![], &out);
    services.stop_all().await;
}

#[tokio::test]
async fn a_stopped_service_has_no_window_to_publish() {
    let (home, bins) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (out, mut rx) = Outbox::channel();
    let (bin, _) = fake_cast(bins.path(), "exit 0");
    let (api, _) = fake_api(token_route("wss://lk.example.com")).await;
    let casts = Casts::new(Some(config(api)), home.path().into(), Services::new(home.path()), Some(bin));
    casts.sync(vec![CastTarget { preview_id: "p1".into(), service: "gone".into() }], &out);
    assert_eq!(next_cast(&mut rx).await, (CastPhase::Starting, None));
    let (phase, error) = next_cast(&mut rx).await;
    assert_eq!(phase, CastPhase::Failed);
    assert!(error.unwrap().contains("服务已停止"));
    casts.sync(vec![], &out);
}

#[tokio::test]
#[allow(clippy::result_large_err)]
async fn relays_signaling_to_the_servers_livekit_path() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server = format!("http://{}", listener.local_addr().unwrap());
    let paths = Arc::new(Mutex::new(Vec::new()));
    let seen = paths.clone();
    tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_hdr_async(
            tcp,
            |req: &tokio_tungstenite::tungstenite::handshake::server::Request, res| {
                seen.lock().unwrap().push(req.uri().to_string());
                Ok(res)
            },
        )
        .await
        .unwrap();
        while let Some(Ok(m)) = ws.next().await {
            if m.is_binary() || m.is_text() {
                ws.send(m).await.unwrap();
            }
        }
    });
    let relay = cast::Relay::start(config(server)).await.unwrap();
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("{}/rtc/v1?access_token=a", relay.url())).await.unwrap();
    ws.send(Message::Binary(vec![1, 2, 3].into())).await.unwrap();
    let echoed = ws.next().await.unwrap().unwrap();
    assert_eq!(echoed.into_data().to_vec(), vec![1, 2, 3]);
    assert_eq!(paths.lock().unwrap().as_slice(), ["/livekit/rtc/v1?access_token=a"]);
}

#[tokio::test]
async fn downloads_the_published_gg_cast_once_and_checks_it() {
    let home = tempfile::tempdir().unwrap();
    let body = b"#!/bin/sh\necho gg-cast\n".to_vec();
    let sha: String = Sha256::digest(&body).iter().map(|b| format!("{b:02x}")).collect();
    let file = body.clone();
    let (api, seen) = fake_api(Box::new(move |line| {
        if line.starts_with("GET /api/daemon/cast-build ") {
            return (200, format!(r#"{{"version":"0.2.0","url":"/downloads/gg-cast","sha256":"{sha}"}}"#).into_bytes());
        }
        assert!(line.starts_with("GET /downloads/gg-cast "), "{line}");
        (200, file.clone())
    }))
    .await;
    let path = cast::binary(&config(api.clone()), home.path()).await.unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), body);
    assert!(path.starts_with(home.path().join("bin")));
    let again = cast::binary(&config(api), home.path()).await.unwrap();
    assert_eq!(again, path);
    assert_eq!(seen.lock().unwrap().iter().filter(|l| l.contains("/downloads/")).count(), 1);

    let (bad, _) = fake_api(Box::new(|line| {
        if line.starts_with("GET /api/daemon/cast-build ") {
            return (
                200,
                format!(r#"{{"version":"0.3.0","url":"/downloads/x","sha256":"{}"}}"#, "0".repeat(64)).into_bytes(),
            );
        }
        (200, b"tampered".to_vec())
    }))
    .await;
    assert!(cast::binary(&config(bad), home.path()).await.unwrap_err().contains("sha256"));

    let (none, _) = fake_api(Box::new(|_| {
        (404, r#"{"error":"not_found","message":"服务器还没有发布 macos-aarch64 的 gg-cast"}"#.into())
    }))
    .await;
    assert!(cast::binary(&config(none), home.path()).await.unwrap_err().contains("还没有发布"));
}
