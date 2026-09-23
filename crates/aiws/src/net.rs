//! 测量延迟与带宽 (spec §8.5): round trips and a download over the same pinned transport as the daemon, reported to
//! the server for the admin 机器与网络 page.
use crate::config::Config;
use anyhow::{Result, bail};
use serde::Serialize;
use std::time::Instant;

/// Download size for the throughput sample (the server caps probes at NET_PROBE_MAX_BYTES = 16 MiB).
pub const PROBE_BYTES: u64 = 8 << 20;
const PINGS: usize = 5;

/// Body of `POST /api/daemon/net` (NetReportReq).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetResult {
    pub latency_ms: f64,
    pub bandwidth_mbps: f64,
}

pub fn median(samples: &mut [f64]) -> f64 {
    samples.sort_by(f64::total_cmp);
    let mid = samples.len() / 2;
    if samples.len().is_multiple_of(2) { (samples[mid - 1] + samples[mid]) / 2.0 } else { samples[mid] }
}

/// Median of PINGS `GET /api/health` round trips, then `PROBE_BYTES` timed from the response head to the last byte.
pub async fn measure(config: &Config) -> Result<NetResult> {
    let http = crate::tls::client(config)?;
    let base = config.server.trim_end_matches('/');
    let mut rtts = Vec::with_capacity(PINGS);
    for _ in 0..PINGS {
        let start = Instant::now();
        http.get(format!("{base}/api/health")).send().await?.error_for_status()?.bytes().await?;
        rtts.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    let url = format!("{base}/api/daemon/net/probe?bytes={PROBE_BYTES}");
    let mut res = crate::bots::ok(http.get(url).bearer_auth(&config.token).send().await?).await?;
    let start = Instant::now();
    let mut got = 0u64;
    while let Some(chunk) = res.chunk().await? {
        got += chunk.len() as u64;
    }
    let secs = start.elapsed().as_secs_f64();
    if got != PROBE_BYTES {
        bail!("测速下载不完整：{got} / {PROBE_BYTES} 字节");
    }
    let round = |v: f64| (v * 10.0).round() / 10.0;
    Ok(NetResult {
        latency_ms: round(median(&mut rtts)),
        bandwidth_mbps: round(got as f64 * 8.0 / secs.max(1e-6) / 1e6),
    })
}

pub async fn report(config: &Config, result: &NetResult) -> Result<()> {
    let url = format!("{}/api/daemon/net", config.server.trim_end_matches('/'));
    let res = crate::tls::client(config)?.post(url).bearer_auth(&config.token).json(result).send().await?;
    crate::bots::ok(res).await.map(drop)
}

/// Measure and report, as `aiws net` and the desktop button do.
pub async fn run(config: &Config) -> Result<NetResult> {
    let result = measure(config).await?;
    report(config, &result).await?;
    tracing::info!("net latency={}ms bandwidth={}Mbps", result.latency_ms, result.bandwidth_mbps);
    Ok(result)
}
