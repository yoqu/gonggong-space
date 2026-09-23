use crate::config::Config;
use crate::protocol::{DaemonLoginReq, DaemonLoginRes, MachineInfo};
use anyhow::{Context, Result, bail};
use serde::Deserialize;

/// This machine as reported to the server; the name drops any DNS suffix (`wanglei-mbp.local` → `wanglei-mbp`).
pub fn machine_info() -> MachineInfo {
    let host = gethostname::gethostname().to_string_lossy().into_owned();
    let name = host.split('.').next().filter(|s| !s.is_empty()).unwrap_or("unknown").to_string();
    MachineInfo { name, os: std::env::consts::OS.into(), arch: std::env::consts::ARCH.into() }
}

#[derive(Deserialize)]
struct ApiError {
    error: String,
    message: String,
}

/// Exchanges a one-time bind code for this machine's long-lived token.
pub async fn login(server: &str, code: &str, machine: MachineInfo) -> Result<Config> {
    let server = server.trim_end_matches('/');
    let res = reqwest::Client::new()
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
    Ok(Config { server: server.into(), token: body.token, machine_id: body.machine_id, owner_name: body.owner_name })
}
