use aiws::bind;
use aiws::protocol::MachineInfo;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn machine() -> MachineInfo {
    MachineInfo { name: "wanglei-mbp".into(), os: "macos".into(), arch: "aarch64".into() }
}

/// One-shot HTTP server: records the request, answers with `status` + JSON `body`.
async fn serve_once(status: &'static str, body: &'static str) -> (String, tokio::task::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let (mut s, _) = listener.accept().await.unwrap();
        let mut buf = vec![0u8; 8192];
        let mut req = String::new();
        loop {
            let n = s.read(&mut buf).await.unwrap();
            req.push_str(&String::from_utf8_lossy(&buf[..n]));
            if let Some((head, body)) = req.split_once("\r\n\r\n") {
                let len = head
                    .lines()
                    .find_map(|l| {
                        l.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|v| v.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                if body.len() >= len {
                    break;
                }
            }
        }
        let res = format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        s.write_all(res.as_bytes()).await.unwrap();
        req
    });
    (url, task)
}

#[tokio::test]
async fn login_exchanges_the_code_for_a_config() {
    let (url, req) = serve_once("200 OK", r#"{"token":"mt_abc","machineId":"m1","ownerName":"王磊"}"#).await;
    let cfg = bind::login(&format!("{url}/"), " k7qm-4x2p ", machine(), None).await.unwrap();
    assert_eq!(cfg.server, url);
    assert_eq!(cfg.token, "mt_abc");
    assert_eq!(cfg.machine_id, "m1");
    assert_eq!(cfg.owner_name, "王磊");
    let req = req.await.unwrap();
    assert!(req.starts_with("POST /api/daemon/login "));
    let body: serde_json::Value = serde_json::from_str(req.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(body["code"], "K7QM-4X2P");
    assert_eq!(body["machine"]["name"], "wanglei-mbp");
}

#[tokio::test]
async fn login_explains_rejections_in_chinese() {
    for (status, body, expect) in [
        ("410 Gone", r#"{"error":"code_expired","message":"x"}"#, "已失效"),
        ("423 Locked", r#"{"error":"code_locked","message":"x"}"#, "尝试次数过多"),
        ("401 Unauthorized", r#"{"error":"unauthorized","message":"x"}"#, "绑定码无效"),
        ("400 Bad Request", r#"{"error":"invalid","message":"x"}"#, "XXXX-XXXX"),
    ] {
        let (url, _) = serve_once(status, body).await;
        let err = bind::login(&url, "AAAA-AAAA", machine(), None).await.unwrap_err().to_string();
        assert!(err.starts_with("绑定失败："), "{err}");
        assert!(err.contains(expect), "{err}");
    }
}

#[tokio::test]
async fn login_reports_unreachable_servers() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let err = format!("{:#}", bind::login(&url, "AAAA-AAAA", machine(), None).await.unwrap_err());
    assert!(err.contains("无法连接服务器"), "{err}");
}

#[test]
fn machine_info_describes_this_host() {
    let m = bind::machine_info();
    assert!(!m.name.is_empty() && !m.name.contains('.'));
    assert!(["macos", "linux", "windows"].contains(&m.os.as_str()));
    assert_eq!(m.arch, std::env::consts::ARCH);
}
