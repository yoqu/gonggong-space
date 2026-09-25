//! Certificate pinning against a real local rustls server with a self-signed certificate (plan D18).
use gonggong::bind;
use gonggong::bots::Client;
use gonggong::config::Config;
use gonggong::protocol::MachineInfo;
use gonggong::tls;
use rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;

const WRONG: &str =
    "sha256:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF";

enum Reply {
    Json(&'static str),
    WebSocket,
}

/// HTTPS/WSS server on 127.0.0.1 answering every connection with `reply`; returns its URL and certificate fingerprint.
async fn serve(reply: Reply) -> (String, String) {
    let ck = rcgen::generate_simple_self_signed(vec!["localhost".into(), "127.0.0.1".into()]).unwrap();
    let cert: CertificateDer<'static> = ck.cert.der().clone();
    let fp = tls::fingerprint(&cert);
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
                // A client that refuses the certificate aborts the handshake here.
                let Ok(mut s) = acceptor.accept(tcp).await else { return };
                match *reply {
                    Reply::WebSocket => {
                        let _ws = tokio_tungstenite::accept_async(s).await.unwrap();
                    }
                    Reply::Json(body) => {
                        let mut buf = vec![0u8; 8192];
                        let _ = s.read(&mut buf).await.unwrap();
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
    (url, fp)
}

fn machine() -> MachineInfo {
    MachineInfo { name: "mbp".into(), os: "macos".into(), arch: "aarch64".into(), ..Default::default() }
}

fn config(server: &str, pin: Option<&str>) -> Config {
    Config {
        server: server.into(),
        token: "mt_1".into(),
        machine_id: "m1".into(),
        owner_name: "王磊".into(),
        cert_sha256: pin.map(|p| tls::parse_fingerprint(p).unwrap()),
    }
}

const LOGIN: &str = r#"{"token":"mt_abc","machineId":"m1","ownerName":"王磊","restored":false}"#;

#[tokio::test]
async fn login_trusts_the_first_certificate_and_records_it() {
    let (url, fp) = serve(Reply::Json(LOGIN)).await;
    let (cfg, _) = bind::login(&url, "AAAA-AAAA", machine(), None).await.unwrap();
    assert_eq!(cfg.cert_sha256.as_deref(), Some(fp.as_str()));
    assert_eq!(cfg.token, "mt_abc");
}

#[tokio::test]
async fn login_with_a_fingerprint_accepts_only_that_certificate() {
    let (url, fp) = serve(Reply::Json(LOGIN)).await;
    let lower = format!("sha256:{}", fp.to_lowercase());
    let (cfg, _) = bind::login(&url, "AAAA-AAAA", machine(), Some(&lower)).await.unwrap();
    assert_eq!(cfg.cert_sha256, Some(fp));
    let err = format!("{:#}", bind::login(&url, "AAAA-AAAA", machine(), Some(WRONG)).await.unwrap_err());
    assert!(err.contains("证书指纹不匹配"), "{err}");
}

#[tokio::test]
async fn https_requests_verify_the_pinned_fingerprint() {
    let (url, fp) = serve(Reply::Json("[]")).await;
    assert!(Client::new(&config(&url, Some(&fp))).unwrap().list().await.unwrap().is_empty());
    let err = format!("{:#}", Client::new(&config(&url, Some(WRONG))).unwrap().list().await.unwrap_err());
    assert!(err.contains("证书指纹不匹配"), "{err}");
    let err = Client::new(&config(&url, None)).err().unwrap().to_string();
    assert!(err.contains("gg login"), "{err}");
}

#[tokio::test]
async fn wss_verifies_the_pinned_fingerprint() {
    let (url, fp) = serve(Reply::WebSocket).await;
    tls::connect_ws(&config(&url, Some(&fp))).await.unwrap();
    let err = format!("{:#}", tls::connect_ws(&config(&url, Some(WRONG))).await.unwrap_err());
    assert!(err.contains("证书指纹不匹配"), "{err}");
}

#[test]
fn plain_http_is_only_for_loopback() {
    for ok in ["http://127.0.0.1:8787", "http://localhost:8787/", "http://[::1]:8787"] {
        assert!(tls::pinning(ok, None).unwrap().is_none(), "{ok}");
    }
    let err = tls::pinning("http://10.0.0.5:8787", None).err().unwrap().to_string();
    assert!(err.contains("https://"), "{err}");
    assert!(tls::pinning("ftp://example.com", None).is_err());
    assert!(tls::pinning("https://gonggong.corp", None).unwrap().is_some());
}
