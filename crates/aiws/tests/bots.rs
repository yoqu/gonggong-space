use aiws::bots::{self, Binding, Client};
use aiws::config::Config;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

const BOTS: &str = r#"[
  {"id":"b1","name":"小王的 Claude","agentKind":"claude","binding":"bound","presence":"online","ownerName":"王磊"},
  {"id":"b2","name":"小王的 Codex","agentKind":"codex","binding":"pending_confirm","presence":"pending_confirm","ownerName":"王磊"}
]"#;

/// One-shot HTTP server: answers each connection with the next canned `(status, body)` and returns the request heads.
async fn serve(replies: Vec<(u16, &'static str)>) -> (Config, JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        let mut heads = vec![];
        for (status, body) in replies {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = vec![0; 8192];
            let n = s.read(&mut buf).await.unwrap();
            heads.push(String::from_utf8_lossy(&buf[..n]).into_owned());
            let res = format!(
                "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            s.write_all(res.as_bytes()).await.unwrap();
        }
        heads
    });
    let config = Config {
        server: format!("http://127.0.0.1:{port}/"),
        token: "mt_1".into(),
        machine_id: "m1".into(),
        owner_name: "王磊".into(),
        cert_sha256: None,
    };
    (config, task)
}

#[tokio::test]
async fn lists_bots_with_the_machine_token() {
    let (config, task) = serve(vec![(200, BOTS)]).await;
    let list = Client::new(&config).unwrap().list().await.unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(bots::state_label(&list[0]), "在线");
    assert_eq!(bots::state_label(&list[1]), "待确认 · 运行 aiws bots confirm 小王的 Codex");
    let heads = task.await.unwrap();
    assert!(heads[0].starts_with("GET /api/daemon/bots HTTP/1.1"));
    assert!(heads[0].to_lowercase().contains("authorization: bearer mt_1"));
}

#[tokio::test]
async fn confirms_by_name_and_reports_server_errors() {
    let confirmed =
        r#"{"id":"b2","name":"小王的 Codex","agentKind":"codex","binding":"bound","presence":"agent_missing"}"#;
    let (config, task) = serve(vec![(200, BOTS), (200, confirmed), (200, BOTS)]).await;
    bots::confirm(&config, "小王的 Codex").await.unwrap();
    let err = bots::confirm(&config, "小王的 Claude").await.unwrap_err();
    assert!(err.to_string().contains("无需确认"));
    let heads = task.await.unwrap();
    assert!(heads[1].starts_with("POST /api/daemon/bots/b2/confirm HTTP/1.1"));

    let (config, _task) = serve(vec![(401, r#"{"error":"unauthorized","message":"machine token revoked"}"#)]).await;
    let err = Client::new(&config).unwrap().list().await.unwrap_err();
    assert!(err.to_string().contains("machine token revoked"));
}

#[test]
fn finds_by_id_or_name() {
    let list: Vec<bots::Bot> = serde_json::from_str(BOTS).unwrap();
    assert_eq!(bots::find(&list, "b2").unwrap().binding, Binding::PendingConfirm);
    assert_eq!(bots::find(&list, "小王的 Claude").unwrap().id, "b1");
    assert!(bots::find(&list, "nope").is_err());
}
