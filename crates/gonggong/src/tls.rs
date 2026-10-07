//! Transport to the team server: http(s)/ws(s) to any host. Binding should just work, so https accepts whatever
//! certificate the server presents (self-signed included) without pinning or CA checks.
use crate::config::Config;
use anyhow::Result;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{CryptoProvider, verify_tls12_signature, verify_tls13_signature};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, SignatureScheme};
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::{Connector, MaybeTlsStream, WebSocketStream};

#[derive(Debug)]
struct AcceptAny(Arc<CryptoProvider>);

impl ServerCertVerifier for AcceptAny {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

static TLS: LazyLock<Arc<ClientConfig>> = LazyLock::new(|| {
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let config = ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .expect("aws-lc-rs supports the default protocol versions")
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAny(provider)))
        .with_no_client_auth();
    Arc::new(config)
});

/// HTTP client for the team server. Direct like the daemon WebSocket: an OS-level proxy must not intercept
/// (or 502) an intranet/localhost server.
pub fn http() -> Result<reqwest::Client> {
    Ok(builder().build()?)
}

/// `http`'s settings, for a client that adds its own (timeouts).
pub fn builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder().no_proxy().use_preconfigured_tls((**TLS).clone())
}

pub type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// A server that accepts TCP but stalls the TLS handshake or the upgrade would otherwise hang the connect forever.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// The daemon WebSocket.
pub async fn connect_ws(config: &Config) -> Result<Ws> {
    connect_url(config.ws_url()).await
}

/// Any WebSocket on the bound server.
pub async fn connect_url<R>(request: R) -> Result<Ws>
where
    R: tokio_tungstenite::tungstenite::client::IntoClientRequest + Unpin,
{
    let connector = Some(Connector::Rustls(TLS.clone()));
    let connect = tokio_tungstenite::connect_async_tls_with_config(request, None, false, connector);
    let Ok(connected) = tokio::time::timeout(CONNECT_TIMEOUT, connect).await else {
        anyhow::bail!("{}", crate::t!("连接服务器超时"));
    };
    let (ws, _) = connected?;
    Ok(ws)
}

/// The preview tunnel (`/ws/daemon/tunnel`), authenticated like the REST calls.
pub async fn connect_tunnel(config: &Config) -> Result<Ws> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let mut req = config.tunnel_url().into_client_request()?;
    req.headers_mut().insert("authorization", format!("Bearer {}", config.token).parse()?);
    connect_url(req).await
}
