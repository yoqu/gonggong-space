use gonggong::bind;
use gonggong::protocol::MachineInfo;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn machine() -> MachineInfo {
    MachineInfo {
        name: "wanglei-mbp".into(),
        os: "macos".into(),
        arch: "aarch64".into(),
        hardware_id: Some("hw-1".into()),
        ..Default::default()
    }
}

/// One-shot HTTP server: records the request, answers with `status` + JSON `body`.
async fn serve_once(status: &'static str, body: &'static str) -> (String, tokio::task::JoinHandle<String>) {
    gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
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
    let (url, req) =
        serve_once("200 OK", r#"{"token":"mt_abc","machineId":"m1","ownerName":"王磊","restored":true}"#).await;
    let (cfg, restored) = bind::login(&format!("{url}/"), " k7qm-4x2p ", machine()).await.unwrap();
    assert!(restored);
    assert_eq!(cfg.server, url);
    assert_eq!(cfg.token, "mt_abc");
    assert_eq!(cfg.machine_id, "m1");
    assert_eq!(cfg.owner_name, "王磊");
    let req = req.await.unwrap();
    assert!(req.starts_with("POST /api/daemon/login "));
    let body: serde_json::Value = serde_json::from_str(req.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(body["code"], "K7QM-4X2P");
    assert_eq!(body["machine"]["name"], "wanglei-mbp");
    assert_eq!(body["machine"]["hardwareId"], "hw-1");
}

#[tokio::test]
async fn logout_voids_the_token_on_the_server() {
    let (url, req) = serve_once("204 No Content", "").await;
    let config = gonggong::config::Config {
        server: url,
        token: "mt_abc".into(),
        machine_id: "m1".into(),
        owner_name: "王磊".into(),
    };
    bind::logout(&config).await.unwrap();
    let req = req.await.unwrap();
    assert!(req.starts_with("POST /api/daemon/logout "));
    assert!(req.to_ascii_lowercase().contains("authorization: bearer mt_abc"), "{req}");
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
        let err = bind::login(&url, "AAAA-AAAA", machine()).await.unwrap_err().to_string();
        assert!(err.starts_with("绑定失败："), "{err}");
        assert!(err.contains(expect), "{err}");
    }
}

#[tokio::test]
async fn login_reports_unreachable_servers() {
    gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let err = format!("{:#}", bind::login(&url, "AAAA-AAAA", machine()).await.unwrap_err());
    assert!(err.contains("无法连接服务器"), "{err}");
}

#[test]
fn machine_info_describes_this_host() {
    let m = bind::machine_info();
    assert!(!m.name.is_empty() && !m.name.contains('.'));
    assert!(["macos", "linux", "windows"].contains(&m.os.as_str()));
    assert_eq!(m.arch, std::env::consts::ARCH);
    let hw = m.hardware_id.expect("hardware id");
    assert!(hw.len() == 64 && hw.chars().all(|c| c.is_ascii_hexdigit()), "{hw}");
    assert_eq!(bind::machine_info().hardware_id.as_deref(), Some(hw.as_str()), "stable across calls");
    let sys = m.system.expect("system info");
    assert!(sys.memory_bytes.unwrap() > 0);
    assert!(sys.cpu_cores.unwrap() > 0);
    assert!(sys.os_version.is_some());
}

/// Older servers still add their certificate fingerprint; it is ignored.
const FP: &str = "sha256:ab:cd:ef:01";

fn link(server: &str, code: &str) -> bind::Link {
    bind::Link { server: server.into(), code: code.into() }
}

#[test]
fn parses_the_bind_link() {
    let parsed = bind::parse_link("gonggong://bind?server=https%3A%2F%2Fgonggong.corp.cn%2F&code=k7qm-4x2p").unwrap();
    assert_eq!(parsed, link("https://gonggong.corp.cn", "K7QM-4X2P"));
    let with_fp = format!("  gonggong://bind?code=K7QM-4X2P&server=http%3A%2F%2F127.0.0.1%3A8080&fp={FP}\n");
    assert_eq!(bind::parse_link(&with_fp).unwrap(), link("http://127.0.0.1:8080", "K7QM-4X2P"));
    let remote_http = "gonggong://bind?server=http%3A%2F%2Fgg.uyoqu.com%2F&code=K7QM-4X2P";
    assert_eq!(bind::parse_link(remote_http).unwrap(), link("http://gg.uyoqu.com", "K7QM-4X2P"));
    let sub_path = "gonggong://bind?server=https%3A%2F%2Fg.corp%2Fgonggong%2F&code=K7QM-4X2P";
    assert_eq!(bind::parse_link(sub_path).unwrap(), link("https://g.corp/gonggong", "K7QM-4X2P"));
}

#[test]
fn parses_the_login_command() {
    let plain = "gg login --server https://gonggong.corp.cn/ --code k7qm-4x2p";
    assert_eq!(bind::parse_link(plain).unwrap(), link("https://gonggong.corp.cn", "K7QM-4X2P"));
    let mixed = format!("\n gg login --code=K7QM-4X2P \\\n  --fingerprint '{FP}' --server=\"https://g.corp:8443\"  \n");
    assert_eq!(bind::parse_link(&mixed).unwrap(), link("https://g.corp:8443", "K7QM-4X2P"));
    let quoted = "gg login 'gonggong://bind?server=https%3A%2F%2Fg.corp&code=K7QM-4X2P'";
    assert_eq!(bind::parse_link(quoted).unwrap(), link("https://g.corp", "K7QM-4X2P"));
}

#[test]
fn rejects_anything_else() {
    for input in [
        "",
        "K7QM-4X2P",
        "https://gonggong.corp.cn/?code=K7QM-4X2P",
        "gonggong://unbind?server=https%3A%2F%2Fg.corp&code=K7QM-4X2P",
        "gonggong://bind?code=K7QM-4X2P",
        "gonggong://bind?server=https%3A%2F%2Fg.corp",
        "gonggong://bind?server=https%3A%2F%2Fg.corp&code=K7QM",
        "gonggong://bind?server=file%3A%2F%2F%2Fetc&code=K7QM-4X2P",
        // Userinfo, query or fragment would be glued into every request URL.
        "gonggong://bind?server=https%3A%2F%2Fgood%40evil.example&code=K7QM-4X2P",
        "gonggong://bind?server=https%3A%2F%2Fg.corp%2F%3Fx%3D1&code=K7QM-4X2P",
        "gonggong://bind?server=https%3A%2F%2Fg.corp%2F%23x&code=K7QM-4X2P",
        "gonggong://bind?server=null&code=K7QM-4X2P",
        "gg logout --server https://g.corp --code K7QM-4X2P",
        "gg login --server https://g.corp",
        "gg login --server https://g.corp --code K7QM-4X2P --token x",
        "gg login --server --code K7QM-4X2P",
        "rm -rf / ; gg login --server https://g.corp --code K7QM-4X2P",
    ] {
        assert!(bind::parse_link(input).is_err(), "{input:?}");
    }
}
