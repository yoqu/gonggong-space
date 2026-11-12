use gonggong::bind::{self, Connect};
use gonggong::config::Trust;
use gonggong::protocol::{AgentKind, MachineInfo};
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn machine() -> MachineInfo {
    MachineInfo { name: "wanglei-mbp".into(), os: "macos".into(), arch: "aarch64".into(), ..Default::default() }
}

const EXPIRED: (&str, &str) = ("410 Gone", r#"{"error":"code_expired","message":"x"}"#);
const PENDING: &str = r#"{"status":"pending"}"#;
const APPROVED: &str = r#"{"status":"approved","token":"mt_abc","machineId":"m1","ownerName":"王磊","restored":false,"bot":{"id":"b1","name":"王磊的 Claude Code","groupId":"g1"}}"#;

fn created(url: &str, id: &str) -> String {
    format!(
        r#"{{"id":"{id}","secret":"s-{id}","userCode":"AB12","url":"{url}/link/{id}","expiresAt":"2026-11-12T10:15:00.000Z","intervalMs":10}}"#
    )
}

fn path(req: &str) -> &str {
    req.split(' ').nth(1).unwrap()
}

fn body(req: &str) -> serde_json::Value {
    serde_json::from_str(req.split_once("\r\n\r\n").unwrap().1).unwrap()
}

fn opts(home: &Path) -> Connect<'_> {
    Connect { home, code_only: false, open_browser: false }
}

/// Answers one request per connection, in order, and hands back what was asked; answers may name the server.
async fn start(list: impl Fn(&str) -> Vec<(&'static str, String)>) -> (String, tokio::task::JoinHandle<Vec<String>>) {
    gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let answers = list(&url);
    let task = tokio::spawn(async move {
        let mut seen = vec![];
        for (status, body) in answers {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let mut req = String::new();
            loop {
                let n = s.read(&mut buf).await.unwrap();
                req.push_str(&String::from_utf8_lossy(&buf[..n]));
                if let Some((head, rest)) = req.split_once("\r\n\r\n") {
                    let len = head
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap())
                        })
                        .unwrap_or(0usize);
                    if rest.len() >= len {
                        break;
                    }
                }
            }
            let res = format!(
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            s.write_all(res.as_bytes()).await.unwrap();
            seen.push(req);
        }
        seen
    });
    (url, task)
}

#[tokio::test]
async fn an_expired_code_turns_into_a_request_confirmed_on_the_web() {
    let home = tempfile::tempdir().unwrap();
    let (url, seen) = start(|url| {
        vec![
            (EXPIRED.0, EXPIRED.1.into()),
            ("200 OK", created(url, "lr1")),
            ("200 OK", PENDING.into()),
            ("200 OK", APPROVED.into()),
        ]
    })
    .await;
    let login =
        bind::connect(&url, Some("K7QM-4X2P"), machine(), Trust::System, Some(AgentKind::Claude), opts(home.path()))
            .await
            .unwrap();
    assert_eq!(login.config.token, "mt_abc");
    assert_eq!(login.config.server, url);
    assert_eq!(login.bot.unwrap().group_id, "g1");
    let seen = seen.await.unwrap();
    assert_eq!(
        seen.iter().map(|r| path(r)).collect::<Vec<_>>(),
        [
            "/api/daemon/login",
            "/api/daemon/link-requests",
            "/api/daemon/link-requests/lr1/poll",
            "/api/daemon/link-requests/lr1/poll"
        ]
    );
    let req = body(&seen[1]);
    assert_eq!(req["code"], "K7QM-4X2P", "the expired code tells the server whom to ask");
    assert_eq!(req["createBot"], serde_json::json!({ "agent": "claude" }));
    assert_eq!(req["machine"]["name"], "wanglei-mbp");
    assert_eq!(body(&seen[2])["secret"], "s-lr1");
    assert!(!home.path().join("pending-link.json").exists(), "nothing left once bound");
}

#[tokio::test]
async fn code_only_keeps_the_old_error() {
    let home = tempfile::tempdir().unwrap();
    let (url, seen) = start(|_| vec![(EXPIRED.0, EXPIRED.1.into())]).await;
    let opts = Connect { code_only: true, ..opts(home.path()) };
    let err = bind::connect(&url, Some("K7QM-4X2P"), machine(), Trust::System, None, opts).await.err().unwrap();
    assert!(err.to_string().contains("已失效"), "{err}");
    assert_eq!(seen.await.unwrap().len(), 1);
}

#[tokio::test]
async fn running_the_same_command_again_keeps_waiting_on_the_same_request() {
    let home = tempfile::tempdir().unwrap();
    // The first run made the request and was cut off (an agent's 2-minute command limit) while waiting.
    let (url, first) = start(|url| {
        // A long poll interval keeps it waiting after the one pending answer.
        let slow = created(url, "lr1").replace(r#""intervalMs":10"#, r#""intervalMs":60000"#);
        vec![(EXPIRED.0, EXPIRED.1.into()), ("200 OK", slow), ("200 OK", PENDING.into())]
    })
    .await;
    let cut = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        bind::connect(&url, Some("K7QM-4X2P"), machine(), Trust::System, None, opts(home.path())),
    )
    .await;
    assert!(cut.is_err(), "still waiting");
    assert_eq!(first.await.unwrap().len(), 3);
    let saved: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(home.path().join("pending-link.json")).unwrap()).unwrap();
    assert_eq!((saved["id"].as_str(), saved["server"].as_str()), (Some("lr1"), Some(url.as_str())));

    // The rerun polls that request instead of making another; the server is reached at another port, so the saved
    // server is rewritten to it (same server in real life).
    let (url2, seen) = start(|_| vec![(EXPIRED.0, EXPIRED.1.into()), ("200 OK", APPROVED.into())]).await;
    let mut saved = saved;
    saved["server"] = url2.clone().into();
    std::fs::write(home.path().join("pending-link.json"), saved.to_string()).unwrap();
    let login =
        bind::connect(&url2, Some("K7QM-4X2P"), machine(), Trust::System, None, opts(home.path())).await.unwrap();
    assert_eq!(login.config.token, "mt_abc");
    let seen = seen.await.unwrap();
    assert_eq!(path(&seen[1]), "/api/daemon/link-requests/lr1/poll");
    assert!(!home.path().join("pending-link.json").exists());
}

#[tokio::test]
async fn without_a_code_it_asks_the_web_right_away() {
    let home = tempfile::tempdir().unwrap();
    let (url, seen) = start(|url| vec![("200 OK", created(url, "lr1")), ("200 OK", APPROVED.into())]).await;
    bind::connect(&url, None, machine(), Trust::System, None, opts(home.path())).await.unwrap();
    let seen = seen.await.unwrap();
    assert_eq!(path(&seen[0]), "/api/daemon/link-requests");
    assert!(body(&seen[0]).get("code").is_none());
}

#[tokio::test]
async fn an_older_server_keeps_the_old_error() {
    let home = tempfile::tempdir().unwrap();
    let (url, _) = start(|_| {
        vec![(EXPIRED.0, EXPIRED.1.into()), ("404 Not Found", r#"{"error":"not_found","message":"x"}"#.into())]
    })
    .await;
    let err = bind::connect(&url, Some("K7QM-4X2P"), machine(), Trust::System, None, opts(home.path()))
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(err.contains("已失效"), "{err}");
    assert!(!home.path().join("pending-link.json").exists());
}

#[tokio::test]
async fn an_unanswered_request_is_renewed_once_then_gives_up() {
    let home = tempfile::tempdir().unwrap();
    let (url, seen) = start(|url| {
        vec![
            (EXPIRED.0, EXPIRED.1.into()),
            ("200 OK", created(url, "lr1")),
            ("200 OK", r#"{"status":"expired"}"#.into()),
            ("200 OK", created(url, "lr2")),
            ("200 OK", r#"{"status":"expired"}"#.into()),
        ]
    })
    .await;
    let err = bind::connect(&url, Some("K7QM-4X2P"), machine(), Trust::System, None, opts(home.path()))
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(err.contains(&format!("gg login --server {url}")), "{err}");
    assert_eq!(seen.await.unwrap().len(), 5);
    assert!(!home.path().join("pending-link.json").exists());
}

#[tokio::test]
async fn a_denied_request_stops() {
    let home = tempfile::tempdir().unwrap();
    let (url, _) = start(|url| {
        vec![
            (EXPIRED.0, EXPIRED.1.into()),
            ("200 OK", created(url, "lr1")),
            ("200 OK", r#"{"status":"denied"}"#.into()),
        ]
    })
    .await;
    let err = bind::connect(&url, Some("K7QM-4X2P"), machine(), Trust::System, None, opts(home.path()))
        .await
        .err()
        .unwrap()
        .to_string();
    assert!(err.contains("拒绝"), "{err}");
}
