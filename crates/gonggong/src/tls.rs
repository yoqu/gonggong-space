//! HTTPS/WSS verifies the server by the system roots or an explicitly trusted certificate.
use crate::config::{Config, Trust};
use crate::t;
use anyhow::{Context, Result, bail};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{CryptoProvider, verify_tls12_signature, verify_tls13_signature};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime, pem::PemObject};
use rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};
use std::net::IpAddr;
use std::sync::{Arc, Once};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::{Connector, MaybeTlsStream, WebSocketStream};

pub const INSECURE_ENV: &str = "GONGGONG_INSECURE_DEV";

pub fn fingerprint(der: &[u8]) -> String {
    aws_lc_rs::digest::digest(&aws_lc_rs::digest::SHA256, der)
        .as_ref()
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

#[derive(Debug)]
struct Verifier {
    pin: Option<String>,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for Verifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let actual = fingerprint(end_entity);
        if self.pin.as_ref().is_some_and(|pin| *pin != actual) {
            let msg = t!(
                "服务器证书指纹不匹配，拒绝连接：期望 {pin}，实际 {actual}",
                pin = self.pin.as_ref().unwrap(),
                actual = actual
            );
            return Err(rustls::Error::General(msg));
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}

pub struct Transport {
    config: Arc<ClientConfig>,
}

impl Transport {
    fn new(trust: &Trust) -> Result<Self> {
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        let builder = ClientConfig::builder_with_provider(provider.clone()).with_safe_default_protocol_versions()?;
        let config = match trust {
            Trust::System => {
                let mut roots = RootCertStore::empty();
                let native = rustls_native_certs::load_native_certs();
                roots.add_parsable_certificates(native.certs);
                if roots.is_empty() {
                    bail!(t!("无法加载系统 CA 证书，请使用 --ca-file 或 --fingerprint 显式信任服务器证书"));
                }
                builder.with_root_certificates(roots).with_no_client_auth()
            }
            Trust::CaFile { path } => {
                let mut roots = RootCertStore::empty();
                let certs = CertificateDer::pem_file_iter(path)
                    .with_context(|| t!("无法读取 CA 证书文件 {path}", path = path.display()))?
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .with_context(|| t!("CA 证书文件格式错误：{path}", path = path.display()))?;
                for cert in certs {
                    roots.add(cert).with_context(|| t!("CA 证书文件格式错误：{path}", path = path.display()))?;
                }
                if roots.is_empty() {
                    bail!(t!("CA 证书文件没有可用证书：{path}", path = path.display()));
                }
                builder.with_root_certificates(roots).with_no_client_auth()
            }
            Trust::Fingerprint { sha256 } => builder
                .dangerous()
                .with_custom_certificate_verifier(Arc::new(Verifier { pin: Some(sha256.clone()), provider }))
                .with_no_client_auth(),
        };
        Ok(Transport { config: Arc::new(config) })
    }

    fn insecure() -> Self {
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        let config = ClientConfig::builder_with_provider(provider.clone())
            .with_safe_default_protocol_versions()
            .expect("aws-lc-rs supports the default protocol versions")
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(Verifier { pin: None, provider }))
            .with_no_client_auth();
        Transport { config: Arc::new(config) }
    }
}

pub fn validate_server(server: &str) -> Result<()> {
    let url = reqwest::Url::parse(server).with_context(|| t!("服务器地址无效：{server}", server = server))?;
    match url.scheme() {
        "https" => Ok(()),
        "http" if is_loopback(url.host_str().unwrap_or_default()) => Ok(()),
        "http" => bail!(t!("只允许通过 https:// 连接非本机服务器：{server}", server = server)),
        other => bail!(t!("不支持的服务器协议 {scheme}://，请使用 https://", scheme = other)),
    }
}

fn is_loopback(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host.trim_matches(['[', ']']).parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

pub fn transport(server: &str, trust: Option<&Trust>) -> Result<Option<Transport>> {
    validate_server(server)?;
    if !server.starts_with("https:") {
        return Ok(None);
    }
    if std::env::var(INSECURE_ENV).is_ok_and(|v| v == "1") {
        static WARN: Once = Once::new();
        WARN.call_once(|| {
            eprintln!(
                "{}",
                t!("警告：{env}=1，已关闭服务器证书校验，连接可被中间人冒充。只可用于本地开发！", env = INSECURE_ENV)
            )
        });
        return Ok(Some(Transport::insecure()));
    }
    let trust = trust.context(t!("本机配置缺少服务器证书信任设置（tlsTrust），请重新执行 gg login"))?;
    Ok(Some(Transport::new(trust)?))
}

pub fn for_login(server: &str, trust: &Trust) -> Result<Option<Transport>> {
    transport(server, Some(trust))
}

pub fn builder(config: &Config) -> Result<reqwest::ClientBuilder> {
    let builder = reqwest::Client::builder().no_proxy();
    Ok(match transport(&config.server, config.tls_trust.as_ref())? {
        Some(tls) => builder.use_preconfigured_tls((*tls.config).clone()),
        None => builder,
    })
}

pub fn http(config: &Config) -> Result<reqwest::Client> {
    Ok(builder(config)?.connect_timeout(CONNECT_TIMEOUT).read_timeout(READ_TIMEOUT).build()?)
}

pub type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const READ_TIMEOUT: Duration = Duration::from_secs(60);

pub async fn connect_ws(config: &Config) -> Result<Ws> {
    connect_url(config, config.ws_url()).await
}

pub async fn connect_url<R>(config: &Config, request: R) -> Result<Ws>
where
    R: tokio_tungstenite::tungstenite::client::IntoClientRequest + Unpin,
{
    let connector = transport(&config.server, config.tls_trust.as_ref())?.map(|tls| Connector::Rustls(tls.config));
    let connect = tokio_tungstenite::connect_async_tls_with_config(request, None, false, connector);
    let Ok(connected) = tokio::time::timeout(CONNECT_TIMEOUT, connect).await else {
        bail!("{}", t!("连接服务器超时"));
    };
    let (ws, _) = connected?;
    Ok(ws)
}

pub async fn connect_tunnel(config: &Config) -> Result<Ws> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let mut req = config.tunnel_url().into_client_request()?;
    req.headers_mut().insert("authorization", format!("Bearer {}", config.token).parse()?);
    connect_url(config, req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprints_are_uppercase_sha256_pairs() {
        assert_eq!(
            fingerprint(b"abc"),
            "BA:78:16:BF:8F:01:CF:EA:41:41:40:DE:5D:AE:22:23:B0:03:61:A3:96:17:7A:9C:B4:10:FF:61:F2:00:15:AD"
        );
    }
}
