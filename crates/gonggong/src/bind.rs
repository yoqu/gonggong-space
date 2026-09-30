use crate::config::Config;
use crate::protocol::{DaemonLoginReq, DaemonLoginRes, MachineInfo, SystemInfo};
use crate::tls;
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, Networks, System};

/// This machine as reported to the server; the name drops any DNS suffix (`wanglei-mbp.local` → `wanglei-mbp`).
pub fn machine_info() -> MachineInfo {
    let host = gethostname::gethostname().to_string_lossy().into_owned();
    let name = host.split('.').next().filter(|s| !s.is_empty()).unwrap_or("unknown").to_string();
    MachineInfo {
        name,
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        hardware_id: hardware_id(),
        system: Some(system_info()),
    }
}

/// The OS machine id survives network and hostname changes; hashed so the raw id never leaves the host.
/// `GONGGONG_MACHINE_ID` overrides it for several isolated instances on one host (e2e, one GONGGONG_HOME each).
fn hardware_id() -> Option<String> {
    let id = std::env::var("GONGGONG_MACHINE_ID").ok().filter(|s| !s.is_empty()).or_else(|| machine_uid::get().ok())?;
    let id = id.trim();
    (!id.is_empty()).then(|| Sha256::digest(format!("gonggong:{id}")).iter().map(|b| format!("{b:02x}")).collect())
}

fn system_info() -> SystemInfo {
    let mut sys = System::new();
    sys.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
    sys.refresh_cpu_list(CpuRefreshKind::nothing());
    SystemInfo {
        os_version: System::long_os_version(),
        kernel: System::kernel_version(),
        cpu_model: sys.cpus().first().map(|c| c.brand().trim().to_string()).filter(|s| !s.is_empty()),
        cpu_cores: u32::try_from(sys.cpus().len()).ok().filter(|&n| n > 0),
        memory_bytes: Some(sys.total_memory()).filter(|&n| n > 0),
        mac_address: mac_address(),
    }
}

/// Display only: physical-looking interfaces (en*/eth*/wl*) first, virtual ones and loopback have no MAC or rank last.
fn mac_address() -> Option<String> {
    Networks::new_with_refreshed_list()
        .iter()
        .filter(|(_, n)| !n.mac_address().is_unspecified())
        .min_by_key(|(name, _)| (!["en", "eth", "wl"].iter().any(|p| name.starts_with(p)), name.to_string()))
        .map(|(_, n)| n.mac_address().to_string())
}

/// What binding needs, from a 接入链接 `gonggong://bind?server=…&code=…[&fp=…]` (plan J1) or the equivalent
/// `gg login` command line as copied from the Web.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Link {
    /// http(s), without a trailing `/`.
    pub server: String,
    /// Upper case `XXXX-XXXX`.
    pub code: String,
    /// `sha256:AB:CD:…` when the server pinned its certificate in the link.
    pub fingerprint: Option<String>,
}

const LINK_SCHEME: &str = "gonggong";
const LINK_HOST: &str = "bind";

/// Parses a pasted 接入链接 or `gg login --server … --code … [--fingerprint …]` (flags in any order, `--flag=value`
/// too); surrounding whitespace and quotes are ignored. Never binds by itself (plan J3).
pub fn parse_link(input: &str) -> Result<Link> {
    let input = unquote(input.trim());
    if input.starts_with(&format!("{LINK_SCHEME}:")) { link_of_url(input) } else { link_of_command(input) }
}

fn unquote(s: &str) -> &str {
    ['\'', '"'].iter().find_map(|q| s.strip_prefix(*q)?.strip_suffix(*q)).unwrap_or(s)
}

fn link_of_url(input: &str) -> Result<Link> {
    let url = reqwest::Url::parse(input).context("接入链接格式错误")?;
    if url.scheme() != LINK_SCHEME || url.host_str() != Some(LINK_HOST) {
        bail!("不是共工空间的接入链接");
    }
    let param = |name: &str| url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned());
    checked(param("server"), param("code"), param("fp"))
}

fn link_of_command(input: &str) -> Result<Link> {
    let words: Vec<&str> = input.split_whitespace().filter(|w| *w != "\\").collect();
    let [gg, login, args @ ..] = words.as_slice() else {
        bail!("无法识别：请粘贴接入链接或 gg login 命令")
    };
    if *gg != "gg" || *login != "login" {
        bail!("无法识别：请粘贴接入链接或 gg login 命令");
    }
    if let [link] = args
        && !link.starts_with("--")
    {
        return link_of_url(unquote(link));
    }
    let (mut server, mut code, mut fingerprint) = (None, None, None);
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        let Some(flag) = arg.strip_prefix("--") else { bail!("gg login 命令中有无法识别的参数 {arg}") };
        let (name, value) = match flag.split_once('=') {
            Some((name, value)) => (name, value),
            None => (flag, *args.next().filter(|v| !v.starts_with("--")).with_context(|| format!("--{flag} 缺少值"))?),
        };
        let slot = match name {
            "server" => &mut server,
            "code" => &mut code,
            "fingerprint" => &mut fingerprint,
            _ => bail!("gg login 命令中有无法识别的参数 --{name}"),
        };
        *slot = Some(unquote(value).to_string());
    }
    checked(server, code, fingerprint)
}

fn checked(server: Option<String>, code: Option<String>, fingerprint: Option<String>) -> Result<Link> {
    let server = server.context("缺少服务器地址")?;
    let server = server.trim().trim_end_matches('/');
    let url = reqwest::Url::parse(server).with_context(|| format!("服务器地址格式错误：{server}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        bail!("服务器地址必须是 http(s) 地址：{server}");
    }
    // Requests are built as `{server}/api/…`: anything past the path would swallow it.
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        bail!("服务器地址不能包含账号、查询参数或 #：{server}");
    }
    tls::pinning(server, None)?;
    let code = code.context("缺少绑定码")?.trim().to_uppercase();
    let valid = |part: &str| part.len() == 4 && part.chars().all(|c| c.is_ascii_alphanumeric());
    if !code.split_once('-').is_some_and(|(a, b)| valid(a) && valid(b)) {
        bail!("绑定码格式错误，应为 XXXX-XXXX");
    }
    let fingerprint = fingerprint.map(|f| tls::parse_fingerprint(&f).map(|hex| format!("sha256:{hex}"))).transpose()?;
    Ok(Link { server: server.into(), code, fingerprint })
}

#[derive(Deserialize)]
struct ApiError {
    error: String,
    message: String,
}

/// Exchanges a one-time bind code for this machine's long-lived token. For https servers the certificate is pinned:
/// to `fingerprint` when given, otherwise to whatever the server presents now (trust on first use).
/// Returns the config and whether the server restored this host's earlier machine.
pub async fn login(
    server: &str,
    code: &str,
    machine: MachineInfo,
    fingerprint: Option<&str>,
) -> Result<(Config, bool)> {
    let server = server.trim_end_matches('/');
    let pinning = tls::pinning(server, fingerprint.map(tls::parse_fingerprint).transpose()?)?;
    let res = tls::http(pinning.as_ref())?
        .post(format!("{server}/api/daemon/login"))
        .json(&DaemonLoginReq { code: code.trim().to_uppercase(), machine })
        .send()
        .await
        .with_context(|| format!("无法连接服务器 {server}"))?;
    if !res.status().is_success() {
        let status = res.status();
        let reason = match res.json::<ApiError>().await {
            Ok(e) => match e.error.as_str() {
                "code_expired" => "绑定码已失效（已过期或已被使用），请在 Web 端重新生成".into(),
                "code_locked" => "尝试次数过多，绑定码已锁定，请稍后在 Web 端重新生成".into(),
                "unauthorized" => "绑定码无效，请核对后重试".into(),
                "invalid" => "绑定码格式错误，应为 XXXX-XXXX".into(),
                _ => e.message,
            },
            Err(_) => format!("服务器返回 {status}"),
        };
        bail!("绑定失败：{reason}");
    }
    let body: DaemonLoginRes = res.json().await.context("服务器响应无法解析")?;
    let config = Config {
        server: server.into(),
        token: body.token,
        machine_id: body.machine_id,
        owner_name: body.owner_name,
        cert_sha256: pinning.and_then(|p| p.seen()),
    };
    Ok((config, body.restored))
}

/// Voids this machine's token on the server; the machine itself stays so logging in again restores it.
pub async fn logout(config: &Config) -> Result<()> {
    let url = format!("{}/api/daemon/logout", config.server);
    let res = tls::client(config)?.post(url).bearer_auth(&config.token).send().await?;
    crate::bots::ok(res).await.map(drop)
}
