use crate::config::Config;
use crate::protocol::{DaemonLoginReq, DaemonLoginRes, MachineInfo, SystemInfo};
use crate::tls;
use anyhow::{Context, Result, bail};
use serde::Deserialize;
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
