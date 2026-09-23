//! Transport to the team server (spec §13, plan D18): HTTPS/WSS with the server's leaf certificate pinned by its
//! SHA-256 instead of a CA chain, so a self-signed server certificate is as trustworthy as a public one. Plain http
//! is accepted only for loopback servers (local dev and tests).
use crate::config::Config;
use anyhow::{Context, Result, bail};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{CryptoProvider, verify_tls12_signature, verify_tls13_signature};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, SignatureScheme};
use std::net::IpAddr;
use std::sync::{Arc, Mutex, Once};
use tokio::net::TcpStream;
use tokio_tungstenite::{Connector, MaybeTlsStream, WebSocketStream};

/// Disables pinning for bound daemons (dev only).
pub const INSECURE_ENV: &str = "AIWS_INSECURE_DEV";

/// `AB:CD:…`, the form `openssl x509 -noout -fingerprint -sha256` prints.
pub fn fingerprint(der: &[u8]) -> String {
    let digest = aws_lc_rs::digest::digest(&aws_lc_rs::digest::SHA256, der);
    digest.as_ref().iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

/// Accepts `sha256:ab:cd…`, `AB:CD…` or bare hex; returns the canonical `AB:CD:…`.
pub fn parse_fingerprint(s: &str) -> Result<String> {
    let s = s.trim();
    let hex: String = s
        .get(..7)
        .filter(|p| p.eq_ignore_ascii_case("sha256:"))
        .map_or(s, |_| &s[7..])
        .chars()
        .filter(|c| *c != ':')
        .collect();
    if hex.len() != 64 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        bail!("证书指纹格式错误，应为 sha256:AB:CD:…（64 位十六进制）");
    }
    let hex = hex.to_ascii_uppercase();
    Ok(hex.as_bytes().chunks(2).map(|p| std::str::from_utf8(p).unwrap()).collect::<Vec<_>>().join(":"))
}

/// Accepts the leaf whose fingerprint equals `pin` (any leaf when `None`) and remembers the one it saw.
#[derive(Debug)]
struct PinVerifier {
    pin: Option<String>,
    seen: Arc<Mutex<Option<String>>>,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for PinVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let actual = fingerprint(end_entity);
        *self.seen.lock().unwrap() = Some(actual.clone());
        match &self.pin {
            Some(pin) if *pin != actual => {
                let msg = format!("服务器证书指纹不匹配，拒绝连接：期望 {pin}，实际 {actual}");
                tracing::error!("{msg}");
                Err(rustls::Error::General(msg))
            }
            _ => Ok(ServerCertVerified::assertion()),
        }
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

/// TLS settings for one https server.
pub struct Pinning {
    config: Arc<ClientConfig>,
    seen: Arc<Mutex<Option<String>>>,
}

impl Pinning {
    fn new(pin: Option<String>) -> Result<Pinning> {
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        let seen = Arc::new(Mutex::new(None));
        let verifier = PinVerifier { pin, seen: seen.clone(), provider: provider.clone() };
        let config = ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(verifier))
            .with_no_client_auth();
        Ok(Pinning { config: Arc::new(config), seen })
    }

    /// Fingerprint of the certificate the server presented on the last handshake.
    pub fn seen(&self) -> Option<String> {
        self.seen.lock().unwrap().clone()
    }
}

/// `Some` for https servers (pinned to `pin`, or trusting on first use when `None`); `None` for loopback http.
pub fn pinning(server: &str, pin: Option<String>) -> Result<Option<Pinning>> {
    let url = reqwest::Url::parse(server).with_context(|| format!("服务器地址无效：{server}"))?;
    match url.scheme() {
        "https" => Ok(Some(Pinning::new(pin)?)),
        "http" if is_loopback(url.host_str().unwrap_or_default()) => Ok(None),
        "http" => bail!("只允许通过 https:// 连接非本机服务器：{server}"),
        other => bail!("不支持的服务器协议 {other}://，请使用 https://"),
    }
}

fn is_loopback(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host.trim_matches(['[', ']']).parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// Pinning of a bound daemon: the fingerprint recorded at login, unless AIWS_INSECURE_DEV=1 disables it.
pub fn bound(config: &Config) -> Result<Option<Pinning>> {
    let insecure = std::env::var(INSECURE_ENV).is_ok_and(|v| v == "1");
    let pin = match (&config.cert_sha256, insecure) {
        (_, true) => {
            static WARN: Once = Once::new();
            WARN.call_once(|| {
                eprintln!("警告：{INSECURE_ENV}=1，已关闭服务器证书固定，连接可被中间人冒充。只可用于本地开发！")
            });
            None
        }
        (Some(pin), false) => Some(pin.clone()),
        (None, false) if config.server.starts_with("https:") => {
            bail!("本机配置缺少服务器证书指纹（certSha256），请重新执行 aiws login")
        }
        (None, false) => None,
    };
    pinning(&config.server, pin)
}

/// HTTP client for the team server. Direct like the daemon WebSocket: an OS-level proxy must not intercept
/// (or 502) an intranet/localhost server.
pub fn http(pinning: Option<&Pinning>) -> Result<reqwest::Client> {
    let builder = reqwest::Client::builder().no_proxy();
    let builder = match pinning {
        Some(p) => builder.use_preconfigured_tls((*p.config).clone()),
        None => builder,
    };
    Ok(builder.build()?)
}

/// HTTP client of a bound daemon.
pub fn client(config: &Config) -> Result<reqwest::Client> {
    http(bound(config)?.as_ref())
}

pub type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// The daemon WebSocket (`wss://` pinned, or `ws://` to loopback).
pub async fn connect_ws(config: &Config) -> Result<Ws> {
    let connector = bound(config)?.map(|p| Connector::Rustls(p.config));
    let (ws, _) = tokio_tungstenite::connect_async_tls_with_config(config.ws_url(), None, false, connector).await?;
    Ok(ws)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ABC: &str = "BA:78:16:BF:8F:01:CF:EA:41:41:40:DE:5D:AE:22:23:B0:03:61:A3:96:17:7A:9C:B4:10:FF:61:F2:00:15:AD";

    #[test]
    fn fingerprints_are_uppercase_sha256_pairs() {
        assert_eq!(fingerprint(b"abc"), ABC);
    }

    #[test]
    fn parses_fingerprints_in_the_usual_spellings() {
        let spellings = [ABC.to_string(), format!("sha256:{ABC}"), format!(" SHA256:{} ", ABC.to_lowercase())];
        for s in spellings.iter().chain([&ABC.replace(':', "")]) {
            assert_eq!(parse_fingerprint(s).unwrap(), ABC, "{s}");
        }
        for bad in ["", "sha256:AB:CD", &ABC.replace('B', "G")] {
            assert!(parse_fingerprint(bad).is_err(), "{bad}");
        }
    }
}
