//! Certificate verification against a real local rustls server with a self-signed certificate.
use gonggong::bind;
use gonggong::bots::Client;
use gonggong::config::{Config, Trust};
use gonggong::protocol::MachineInfo;
use gonggong::tls;
use rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer};
use std::path::PathBuf;
use std::sync::Arc;
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;

enum Reply {
    Json(&'static str),
    WebSocket,
    Both,
}

struct Server {
    url: String,
    fingerprint: String,
    pem: String,
}

async fn serve(reply: Reply) -> Server {
    let ck = rcgen::generate_simple_self_signed(vec!["localhost".into(), "127.0.0.1".into()]).unwrap();
    let cert: CertificateDer<'static> = ck.cert.der().clone();
    let fingerprint = tls::fingerprint(&cert);
    let pem = ck.cert.pem();
    let key = PrivatePkcs8KeyDer::from(ck.signing_key.serialize_der());
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::aws_lc_rs::default_provider()))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![cert], key.into())
        .unwrap();
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("https://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let reply = Arc::new(reply);
    tokio::spawn(async move {
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            let (acceptor, reply) = (acceptor.clone(), reply.clone());
            tokio::spawn(async move {
                let Ok(mut s) = acceptor.accept(tcp).await else { return };
                match &*reply {
                    Reply::WebSocket => {
                        let _ws = tokio_tungstenite::accept_async(s).await.unwrap();
                    }
                    reply @ (Reply::Json(_) | Reply::Both) => {
                        let mut buf = vec![0u8; 8192];
                        let _ = s.read(&mut buf).await.unwrap();
                        let req = String::from_utf8_lossy(&buf);
                        if req.starts_with("GET /ws/") {
                            let key = req
                                .lines()
                                .find_map(|line| {
                                    line.to_ascii_lowercase().strip_prefix("sec-websocket-key:").map(|_| line)
                                })
                                .unwrap()
                                .split_once(':')
                                .unwrap()
                                .1
                                .trim();
                            let accept = derive_accept_key(key.as_bytes());
                            let res = format!(
                                "HTTP/1.1 101 Switching Protocols\r\nconnection: upgrade\r\nupgrade: websocket\r\nsec-websocket-accept: {accept}\r\n\r\n"
                            );
                            s.write_all(res.as_bytes()).await.unwrap();
                            s.flush().await.unwrap();
                            std::future::pending::<()>().await;
                            return;
                        }
                        let body = if matches!(reply, Reply::Both) && req.starts_with("POST /api/daemon/login") {
                            LOGIN
                        } else if matches!(reply, Reply::Both) {
                            "[]"
                        } else if let Reply::Json(body) = reply {
                            *body
                        } else {
                            unreachable!()
                        };
                        let res = format!(
                            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                            body.len()
                        );
                        s.write_all(res.as_bytes()).await.unwrap();
                        s.shutdown().await.unwrap();
                    }
                }
            });
        }
    });
    Server { url, fingerprint, pem }
}

fn machine() -> MachineInfo {
    MachineInfo { name: "mbp".into(), os: "macos".into(), arch: "aarch64".into(), ..Default::default() }
}

fn config(server: &str, trust: Option<Trust>) -> Config {
    gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
    Config {
        server: server.into(),
        token: "mt_1".into(),
        machine_id: "m1".into(),
        owner_name: "王磊".into(),
        tls_trust: trust,
    }
}

fn ca_file(pem: &str) -> (TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("server-ca.pem");
    std::fs::write(&path, pem).unwrap();
    (dir, path)
}

const LOGIN: &str = r#"{"token":"mt_abc","machineId":"m1","ownerName":"王磊","restored":false}"#;
const WRONG: &str = "00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF";

#[tokio::test]
async fn self_signed_certificates_are_not_trusted_by_default() {
    let server = serve(Reply::Json(LOGIN)).await;
    let err = bind::login(&server.url, "AAAA-AAAA", machine(), Trust::System).await.unwrap_err();
    assert!(format!("{err:#}").contains("无法连接服务器"), "{err:#}");
    let err = Client::new(&config(&server.url, Some(Trust::System))).unwrap().list().await.unwrap_err();
    assert!(format!("{err:#}").contains("certificate"), "{err:#}");
}

#[tokio::test]
async fn login_rejects_a_wrong_fingerprint_and_records_the_right_one() {
    let server = serve(Reply::Json(LOGIN)).await;
    let wrong = Trust::fingerprint(WRONG).unwrap();
    let err = bind::login(&server.url, "AAAA-AAAA", machine(), wrong).await.unwrap_err();
    assert!(format!("{err:#}").contains("证书指纹不匹配"), "{err:#}");

    let trust = Trust::fingerprint(&format!("sha256:{}", server.fingerprint.to_lowercase())).unwrap();
    let (cfg, _) = bind::login(&server.url, "AAAA-AAAA", machine(), trust.clone()).await.unwrap();
    assert_eq!(cfg.token, "mt_abc");
    assert_eq!(cfg.tls_trust, Some(trust));
}

#[tokio::test]
async fn a_ca_file_is_explicitly_trusted_by_login_https_and_wss() {
    let server = serve(Reply::Both).await;
    let (_dir, path) = ca_file(&server.pem);
    let trust = Trust::ca_file(&path).unwrap();
    let (cfg, _) = bind::login(&server.url, "AAAA-AAAA", machine(), trust).await.unwrap();
    assert!(Client::new(&cfg).unwrap().list().await.unwrap().is_empty());
    tls::connect_ws(&cfg).await.unwrap();
    tls::connect_tunnel(&cfg).await.unwrap();

    let cfg = config(&serve(Reply::Json("[]")).await.url, Some(Trust::ca_file(&path).unwrap()));
    assert!(Client::new(&cfg).unwrap().list().await.is_err());
}

#[tokio::test]
async fn a_fingerprint_is_shared_by_https_wss_and_the_tunnel() {
    let server = serve(Reply::Json("[]")).await;
    let trust = Trust::fingerprint(&server.fingerprint).unwrap();
    let cfg = config(&server.url, Some(trust));
    let res = tls::http(&cfg).unwrap().get(format!("{}/api/health", cfg.server)).send().await.unwrap();
    assert_eq!(res.json::<serde_json::Value>().await.unwrap(), serde_json::json!([]));

    let server = serve(Reply::WebSocket).await;
    let cfg = config(&server.url, Some(Trust::fingerprint(&server.fingerprint).unwrap()));
    tls::connect_ws(&cfg).await.unwrap();
    tls::connect_tunnel(&cfg).await.unwrap();
    tls::connect_url(&cfg, cfg.ws_url().replacen("/ws/daemon", "/api/health", 1)).await.unwrap();
}

#[tokio::test]
async fn old_https_configs_verify_with_system_roots_instead_of_skipping_verification() {
    assert!(tls::http(&config("https://g.corp", None)).is_ok());
    let server = serve(Reply::Json("[]")).await;
    let err = Client::new(&config(&server.url, None)).unwrap().list().await.unwrap_err();
    assert!(format!("{err:#}").contains("certificate"), "{err:#}");
}

#[test]
fn remote_plain_http_is_rejected_but_loopback_remains_available() {
    let err = bind::parse_link("gonggong://bind?server=http%3A%2F%2Fgg.uyoqu.com&code=K7QM-4X2P").unwrap_err();
    assert!(err.to_string().contains("https://"), "{err}");
    assert!(tls::http(&config("http://gg.uyoqu.com", None)).is_err());
    assert!(tls::http(&config("http://127.0.0.1:8787", None)).is_ok());
    assert!(tls::http(&config("http://[::1]:8787", None)).is_ok());
}

#[tokio::test(start_paused = true)]
async fn connecting_gives_up_on_a_server_that_never_answers_the_upgrade() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let config = config(&url, None);
    let connect = tokio::time::timeout(std::time::Duration::from_secs(60), tls::connect_ws(&config));
    assert!(connect.await.expect("connect must time out on its own").is_err());
    drop(listener);
}

#[tokio::test]
async fn a_server_that_never_answers_fails_the_request_instead_of_hanging_it() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://127.0.0.1:{}/api/health", listener.local_addr().unwrap().port());
    let config = config("http://127.0.0.1", None);
    let (got, request) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        let (mut tcp, _) = listener.accept().await.unwrap();
        let mut buf = [0u8; 1024];
        let _ = tcp.read(&mut buf).await;
        let _ = got.send(());
        std::future::pending::<()>().await;
    });
    let send = tokio::spawn(tls::http(&config).unwrap().get(url).send());
    request.await.expect("the request reached the server: the response was what stalled");
    tokio::time::pause();
    let err = tokio::time::timeout(std::time::Duration::from_secs(3600), send)
        .await
        .expect("the client's own timeout fires first")
        .unwrap()
        .unwrap_err();
    assert!(err.is_timeout(), "{err:?}");
}
