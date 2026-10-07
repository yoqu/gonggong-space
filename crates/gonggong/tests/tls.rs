//! A real local rustls server with a self-signed certificate: binding and every request work without pinning.
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

enum Reply {
    Json(&'static str),
    WebSocket,
}

/// HTTPS/WSS server on 127.0.0.1 answering every connection with `reply`; returns its URL.
async fn serve(reply: Reply) -> String {
    let ck = rcgen::generate_simple_self_signed(vec!["localhost".into(), "127.0.0.1".into()]).unwrap();
    let cert: CertificateDer<'static> = ck.cert.der().clone();
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
    url
}

fn machine() -> MachineInfo {
    MachineInfo { name: "mbp".into(), os: "macos".into(), arch: "aarch64".into(), ..Default::default() }
}

fn config(server: &str) -> Config {
    Config { server: server.into(), token: "mt_1".into(), machine_id: "m1".into(), owner_name: "王磊".into() }
}

const LOGIN: &str = r#"{"token":"mt_abc","machineId":"m1","ownerName":"王磊","restored":false}"#;

#[tokio::test]
async fn login_accepts_a_self_signed_certificate() {
    let url = serve(Reply::Json(LOGIN)).await;
    let (cfg, _) = bind::login(&url, "AAAA-AAAA", machine()).await.unwrap();
    assert_eq!(cfg.token, "mt_abc");
}

#[tokio::test]
async fn https_requests_accept_a_self_signed_certificate() {
    let url = serve(Reply::Json("[]")).await;
    assert!(Client::new(&config(&url)).unwrap().list().await.unwrap().is_empty());
}

#[tokio::test]
async fn wss_accepts_a_self_signed_certificate() {
    let url = serve(Reply::WebSocket).await;
    tls::connect_ws(&config(&url)).await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn connecting_gives_up_on_a_server_that_never_answers_the_upgrade() {
    // The kernel completes the TCP handshake, but nobody ever answers the WebSocket upgrade.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let config = config(&url);
    let connect = tokio::time::timeout(std::time::Duration::from_secs(60), tls::connect_ws(&config));
    assert!(connect.await.expect("connect must time out on its own").is_err());
    drop(listener);
}

#[tokio::test(start_paused = true)]
async fn a_server_that_never_answers_fails_the_request_instead_of_hanging_it() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://127.0.0.1:{}/api/health", listener.local_addr().unwrap().port());
    let (got, request) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        let (mut tcp, _) = listener.accept().await.unwrap();
        let mut buf = [0u8; 1024];
        let _ = tcp.read(&mut buf).await;
        let _ = got.send(());
        std::future::pending::<()>().await;
    });
    let err = tokio::time::timeout(std::time::Duration::from_secs(3600), tls::http().unwrap().get(url).send())
        .await
        .expect("the client's own timeout fires first")
        .unwrap_err();
    assert!(err.is_timeout(), "{err:?}");
    request.await.expect("the request reached the server: the response was what stalled");
}
