//! `/api/daemon/sync/:groupId/…` (F15): content-addressed blobs and a version's changes, over the pinned client.
//! Every request is bounded, so a stalled connection cannot hold a replica's lock (and the turns waiting on it).
use crate::bots::ok;
use crate::config::Config;
use crate::protocol::{SYNC_FILE_MAX_BYTES, SYNC_MISSING_MAX, SyncChangesRes, SyncMissingRes};
use crate::{t, tls};
use anyhow::{Result, anyhow};
use std::path::Path;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::time::Instant;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Blob uploads or downloads in flight at once: a big tree is mostly small files, so round trips dominate.
pub const TRANSFERS: usize = 16;
const KEEPALIVE: Duration = Duration::from_secs(30);

/// `meta` bounds a JSON request; a blob transfer gets `meta` plus `per_mb` for each MB.
#[derive(Debug, Clone, Copy)]
struct Timeouts {
    meta: Duration,
    per_mb: Duration,
}

impl Default for Timeouts {
    fn default() -> Self {
        Timeouts { meta: Duration::from_secs(30), per_mb: Duration::from_secs(1) }
    }
}

impl Timeouts {
    fn transfer(&self, bytes: u64) -> Duration {
        self.meta + self.per_mb * bytes.div_ceil(1024 * 1024) as u32
    }
}

pub struct Client {
    http: reqwest::Client,
    server: String,
    token: String,
    timeouts: Timeouts,
}

impl Client {
    pub fn new(config: &Config) -> Result<Self> {
        let http = tls::builder().connect_timeout(CONNECT_TIMEOUT).tcp_keepalive(KEEPALIVE).build()?;
        Ok(Client {
            http,
            server: config.server.trim_end_matches('/').into(),
            token: config.token.clone(),
            timeouts: Timeouts::default(),
        })
    }

    fn url(&self, group: &str, rest: &str) -> String {
        format!("{}/api/daemon/sync/{group}/{rest}", self.server)
    }

    /// Which of `hashes` the server lacks, asked SYNC_MISSING_MAX at a time.
    pub async fn missing(&self, group: &str, hashes: &[String]) -> Result<Vec<String>> {
        let mut out = vec![];
        for chunk in hashes.chunks(SYNC_MISSING_MAX) {
            let req = self.http.post(self.url(group, "blobs/missing")).bearer_auth(&self.token);
            let req = req.timeout(self.timeouts.meta).json(&serde_json::json!({ "hashes": chunk }));
            out.extend(ok(req.send().await?).await?.json::<SyncMissingRes>().await?.missing);
        }
        Ok(out)
    }

    /// Streams the file at `path` up as blob `hash`.
    pub async fn upload(&self, group: &str, hash: &str, path: &Path) -> Result<()> {
        let file = tokio::fs::File::open(path).await?;
        let len = file.metadata().await?.len();
        let req = self.http.put(self.url(group, &format!("blobs/{hash}"))).bearer_auth(&self.token);
        let req = req
            .timeout(self.timeouts.transfer(len))
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .header(reqwest::header::CONTENT_LENGTH, len)
            .body(file);
        ok(req.send().await?).await?;
        Ok(())
    }

    pub async fn download(&self, group: &str, hash: &str) -> Result<Vec<u8>> {
        let (mut res, deadline) = self.blob(group, hash).await?;
        let mut out = vec![];
        while let Some(chunk) = tokio::time::timeout_at(deadline, res.chunk()).await.map_err(|_| timed_out())?? {
            out.extend_from_slice(&chunk);
        }
        Ok(out)
    }

    /// Streams blob `hash` into the file `to`.
    pub async fn download_to(&self, group: &str, hash: &str, to: &Path) -> Result<()> {
        let (mut res, deadline) = self.blob(group, hash).await?;
        let mut file = tokio::fs::File::create(to).await?;
        while let Some(chunk) = tokio::time::timeout_at(deadline, res.chunk()).await.map_err(|_| timed_out())?? {
            file.write_all(&chunk).await?;
        }
        Ok(file.flush().await?)
    }

    /// The response to a blob GET, and when its body must be in by (sized by its length, else the largest file).
    async fn blob(&self, group: &str, hash: &str) -> Result<(reqwest::Response, Instant)> {
        let req = self.http.get(self.url(group, &format!("blobs/{hash}"))).bearer_auth(&self.token);
        let res = tokio::time::timeout(self.timeouts.meta, req.send()).await.map_err(|_| timed_out())??;
        let res = ok(res).await?;
        let deadline = Instant::now() + self.timeouts.transfer(res.content_length().unwrap_or(SYNC_FILE_MAX_BYTES));
        Ok((res, deadline))
    }

    /// The latest entry of each path changed after version `from` (0 = the whole head).
    pub async fn changes(&self, group: &str, from: u64) -> Result<SyncChangesRes> {
        let req = self.http.get(self.url(group, &format!("changes?from={from}"))).bearer_auth(&self.token);
        Ok(ok(req.timeout(self.timeouts.meta).send().await?).await?.json().await?)
    }
}

fn timed_out() -> anyhow::Error {
    anyhow!(t!("同步传输超时"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// A server that accepts connections and never answers.
    async fn silent() -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let mut held = vec![];
            while let Ok((stream, _)) = listener.accept().await {
                held.push(stream);
            }
        });
        (url, task)
    }

    fn config(server: &str) -> Config {
        Config { server: server.into(), token: "t".into(), machine_id: "m".into(), owner_name: "o".into() }
    }

    #[tokio::test]
    async fn requests_to_a_server_that_never_answers_time_out() {
        let (url, _task) = silent().await;
        let mut client = Client::new(&config(&url)).unwrap();
        client.timeouts = Timeouts { meta: Duration::from_millis(300), per_mb: Duration::from_millis(100) };
        let started = Instant::now();
        assert!(client.changes("g", 0).await.is_err());
        assert!(client.missing("g", &["h".into()]).await.is_err());
        let dir = tempfile::tempdir().unwrap();
        assert!(client.download_to("g", "h", &dir.path().join("blob")).await.is_err());
        std::fs::write(dir.path().join("up"), "x").unwrap();
        assert!(client.upload("g", "h", &dir.path().join("up")).await.is_err());
        assert!(started.elapsed() < Duration::from_secs(5), "{:?}", started.elapsed());
    }

    #[test]
    fn transfers_get_more_time_the_larger_they_are() {
        let t = Timeouts::default();
        assert_eq!(t.transfer(0), t.meta);
        assert_eq!(t.transfer(50 * 1024 * 1024), t.meta + t.per_mb * 50);
    }
}
